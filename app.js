import { getAuth, signOut, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const STORES = ['總公司','鑫耀鑫','鑫營','新生北','景新','梁鑫','泉州','府中','心惦','巷日','大直','福城','幸福','新莊'];

// 配方可用的重量單位（1 台斤 = 16 兩）
export const WEIGHT_UNITS = ['台斤', '兩'];

// 配方一行換算成材料本身單位的數量；用台斤／兩但材料沒設換算時，沿用上次儲存的數量
export function recipeQty(r, material) {
  if (!r.u) return r.amt;
  const catty = r.u === '台斤' ? r.amt : r.amt / 16;
  return material?.catty > 0 ? catty / material.catty : (r.qty || 0);
}

// 配方一行的顯示文字，例：「2.5 台斤」「0.5 桶」
export function recipeAmtText(r, material) {
  return r.u ? `${fmtQty(r.amt)} ${r.u}` : qtyText(material || { unit: '' }, r.amt);
}

// 成品：店面叫貨的品項；食材：向廠商叫貨
// 「半成品」已停用：資料保留在資料庫，但 loadStockItems 不回傳，所有畫面都不顯示
export const KINDS = ['成品', '食材'];
const HIDDEN_KINDS = ['半成品'];

export async function loadStockItems(db) {
  const snap = await getDocs(collection(db, 'stockItems'));
  return snap.docs
    .filter(d => !HIDDEN_KINDS.includes(d.data().kind))
    .map(d => {
      const e = d.data();
      const kind = e.kind === '原物料' ? '食材' : (KINDS.includes(e.kind) ? e.kind : '成品');
      // 配方：一批要用的材料 [{ id, amt, u, qty }]
      //   amt + u：輸入的用量與單位（u 為空＝材料本身的單位，或「台斤」「兩」）
      //   qty：換算成材料本身單位的數量（下面依材料的台斤換算重新計算）
      const recipe = (Array.isArray(e.recipe) ? e.recipe : [])
        .filter(r => r && (r.id || r.name) && Number(r.amt ?? r.qty) > 0)
        .map(r => ({ id: r.id || '', name: r.id ? '' : (r.name || ''), amt: Number(r.amt ?? r.qty), u: WEIGHT_UNITS.includes(r.u) ? r.u : '', qty: Number(r.qty) || 0 }));
      const item = {
        id: d.id, name: e.name || '', kind, category: e.category || '',
        unit: e.unit || '', spec: e.spec || '', stock: Number(e.stock) || 0,
        safety: Number(e.safety) || 0, sort: e.sort ?? 999, recipe,
        // 配方是一批的用量，這一批可以做出 yield 單位的本品項（舊資料沒有就是 1）
        yield: Number(e.yield) > 0 ? Number(e.yield) : 1,
        // 整批生產：一次至少做一整批（配方的產出量），不能拆開做，例如辣椒一次 3 小鍋
        wholeBatch: !!e.wholeBatch,
        supplier: e.supplier || '',
        // 內部使用：只出現在盤點，不出現在叫貨計算、不需要配方（例：煮雞產出的雞油）
        internal: !!e.internal,
        // 副產品：煮其他東西時順便產出（例：煮雞撈的雞湯），不需配方；byproductOf 記錄來源，如「煮雞」
        byproduct: !!e.byproduct,
        byproductOf: e.byproductOf || '',
        // 台斤換算：1 單位（桶、箱…）等於幾台斤；0 表示未設定
        catty: Number(e.catty) > 0 ? Number(e.catty) : 0
      };
      return { ...item, ...subUnit(item) };
    })
    .map((i, _, all) => ({
      ...i,
      // 不同廠商可以有同名品項；同名時顯示名稱加上廠商以便區分（label）
      label: i.supplier && all.some(o => o.id !== i.id && o.name === i.name) ? `${i.name}（${i.supplier}）` : i.name,
      // 以材料目前的台斤換算重新算出用量，換算改了配方會自動跟著變
      // 其他（不計庫存）的行數量為 0，不影響叫貨
      recipe: i.recipe.map(r => ({ ...r, qty: r.id ? recipeQty(r, all.find(o => o.id === r.id)) : 0 }))
    }))
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hant'));
}

// 廠商名單：suppliers 集合裡建立的廠商，加上品項上已填寫的廠商名稱（舊資料）
export async function loadSuppliers(db, items = []) {
  const snap = await getDocs(collection(db, 'suppliers'));
  // lead：要提前幾天叫（今天叫明天到＝1、今天叫後天到＝2）
  // rules：{品項id: { min: 最低叫貨量, with: 要搭配一起叫的品項id }}
  // off：不送貨的星期（0＝週日 … 6＝週六）；note：最低叫貨量、幾點前要叫等備註
  const list = snap.docs.map(d => ({ id: d.id, name: d.data().name || '', off: d.data().off || [], note: d.data().note || '', rules: d.data().rules || {}, lead: Number(d.data().lead) || 1 })).filter(s => s.name);
  items.forEach(i => {
    if (i.supplier && !list.some(s => s.name === i.supplier)) list.push({ id: '', name: i.supplier, off: [], note: '', rules: {}, lead: 1 });
  });
  return list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

export const WEEKDAYS = '日一二三四五六';
// 例：「週一休息」「週六、週日休息」；每天都送則回傳空字串
export const offText = (off) => off?.length ? `週${[...off].sort().map(d => WEEKDAYS[d]).join('、週')}休息` : '';

// 跟廠商叫貨的品項：食材，或有填廠商、沒有配方的成品（例：外購的貢丸）
export const isPurchased = (i) => !i.internal && (i.kind === '食材' || (!!i.supplier && !i.recipe.length));

// ── 叫貨與生產的推算（叫貨計算、盤點差異共用）──
const ymdStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymdStr(d); };
export const dow = (s) => new Date(s + 'T00:00:00').getDay();
export const supOf = (it) => it.supplier || '未設定廠商';
// 叫貨數量無條件進位到整數（雙單位品項進位到整數小單位）
export const roundUpQty = (it, q) => it.per ? Math.ceil(q * it.per - 1e-9) / it.per : Math.ceil(q - 1e-9);

// 從成品往下展開配方：每一層都補足到安全庫存，扣掉現有庫存，不夠的才往下推算材料。
// stockOf：品項 → 當時庫存（預設用目前庫存）
// 回傳 make（要做）、buy（要叫）、demand（每個品項這次會用掉／出掉多少）
export function planNeeds(items, qty, stockOf = (it) => it.stock) {
  const byId = (id) => items.find(i => i.id === id);
  const demand = {};
  Object.entries(qty || {}).forEach(([id, q]) => { if (byId(id)) demand[id] = q; });

  // 依配方排順序：用到某材料的品項一定比該材料先算
  const order = [];
  const seen = new Set();
  const visit = (it) => {
    if (seen.has(it.id)) return;
    seen.add(it.id);
    it.recipe.forEach(r => { const c = byId(r.id); if (c) visit(c); });
    order.push(it);
  };
  items.forEach(visit);
  order.reverse();

  const make = [], buy = [];
  order.forEach(it => {
    if (it.internal) return;
    const need = demand[it.id] || 0;
    const stock = stockOf(it);
    if (isPurchased(it)) {
      const q = Math.max(0, need + it.safety - stock);
      if (q > 1e-9) buy.push({ it, need, q, stock });
      return;
    }
    // 自己做的成品也要做到補足安全庫存，數量無條件進位
    const raw = need + it.safety - stock;
    if (raw <= 1e-9) return;
    // 整批生產的品項，做的量進位到整批（例：辣椒一批 3 小鍋，要 1 小鍋也做 3 小鍋）
    const q = it.wholeBatch && it.recipe.length ? Math.ceil(raw / it.yield - 1e-9) * it.yield : roundUpQty(it, raw);
    make.push({ it, need, q, stock, noRecipe: !it.recipe.length && !it.byproduct });
    it.recipe.forEach(r => { if (r.id) demand[r.id] = (demand[r.id] || 0) + q * r.qty / it.yield; });
  });
  return { make, buy, demand };
}

// 某天的店面叫貨量：有輸入就用；沒輸入就用最近一天有輸入的量估
// days：{日期: {成品id: 數量}}
function qtyOn(days, d) {
  if (days[d]) return { q: days[d], est: false };
  const known = Object.keys(days).sort();
  const near = known.filter(k => k <= d).pop() || known[0];
  return near ? { q: days[near], est: true } : null;
}
function sumQty(days, dates) {
  const all = {};
  let est = false, none = false;
  dates.forEach(d => {
    const r = qtyOn(days, d);
    if (!r) { none = true; return; }
    est = est || r.est;
    Object.entries(r.q).forEach(([id, q]) => { all[id] = (all[id] || 0) + q; });
  });
  return { all, est, none };
}

// 某天要跟各廠商叫的貨：依「幾天後到貨」「下次到貨日」各自計算
//   到貨前這幾天的出貨要先扣掉；但到貨前如果這家有送貨，那是之前叫的貨，當作已經照系統叫過
// supCfg：{廠商名稱: { off, rules, lead, note }}
export function supplierPlan(items, supCfg, day, days, stockOf = (it) => it.stock) {
  const byId = (id) => items.find(i => i.id === id);
  const cfgOf = (sup) => supCfg[sup] || { off: [], rules: {}, lead: 1, note: '' };
  const offOn = (sup, d) => (cfgOf(sup).off || []).includes(dow(d));
  const sups = [...new Set(items.filter(isPurchased).map(supOf))];
  const cache = {};
  return sups.map(sup => {
    const cfg = cfgOf(sup);
    const lead = cfg.lead || 1;
    const arrive = addDays(day, lead);
    if (offOn(sup, arrive)) {
      // 這天叫的話到貨那天不送：找下一個可以叫的日子
      let k = 1;
      while (k < 8 && offOn(sup, addDays(day, k + lead))) k++;
      return { sup, cfg, skip: true, nextOrder: addDays(day, k), nextArrive: addDays(day, k + lead) };
    }
    let n = 1;
    while (n < 7 && offOn(sup, addDays(arrive, n))) n++;
    // 到貨前要靠現有庫存撐的日子：從隔天到「之前叫的貨送到」的前一天
    const pre = [];
    for (let i = 1; i < lead; i++) { const d = addDays(day, i); if (!offOn(sup, d)) break; pre.push(d); }
    const cover = Array.from({ length: n }, (_, i) => addDays(arrive, i));
    const key = pre.length + '|' + lead + '|' + n;
    if (!cache[key]) {
      const sq = sumQty(days, [...pre, ...cover]);
      cache[key] = { ...sq, buy: sq.none && !Object.keys(sq.all).length ? [] : planNeeds(items, sq.all, stockOf).buy };
    }
    const c = cache[key];
    const rows = c.buy.filter(b => supOf(b.it) === sup).map(b => ({ ...b }));
    // 叫貨規則：最低叫貨量、不能單獨叫
    rows.forEach(b => {
      const r = cfg.rules?.[b.it.id] || {};
      b.order = Math.max(roundUpQty(b.it, b.q), r.min || 0);
      b.minUp = r.min > 0 && b.order > roundUpQty(b.it, b.q);
    });
    rows.forEach(b => {
      const r = cfg.rules?.[b.it.id] || {};
      const w = r.with && byId(r.with);
      if (w && !rows.some(x => x.it.id === w.id)) {
        const wr = cfg.rules?.[w.id] || {};
        b.alone = `不能單獨叫，要搭配${w.name}；這次不用叫${w.name}，可以下次再一起叫，或一起叫${w.name}${wr.min > 0 ? ` ${qtyText(w, wr.min)}` : ''}`;
      }
    });
    return { sup, cfg, lead, arrive, n, pre, cover, rows, est: c.est, none: c.none && !Object.keys(c.all).length };
  }).sort((a, b) => (a.skip ? 1 : 0) - (b.skip ? 1 : 0) || (a.rows?.length ? 0 : 1) - (b.rows?.length ? 0 : 1) || a.sup.localeCompare(b.sup, 'zh-Hant'));
}

// 盤點差異：照系統算的量推「這天晚上應該剩多少」
//   應該剩 ＝ 前一天晚上盤點 ＋ 照生產單做的 ＋ 照叫貨單今天到的 － 店面出貨 － 生產用掉的
// snapAt(日期)：{品項id: 那天最後一次盤點的數量}；days：{店面到貨日: {成品id: 數量}}
// 回傳 {品項id: { expect, made, arrived, used }}；內部使用、前一天沒盤點的品項不算
export function expectedStock(items, supCfg, day, days, snapAt) {
  const prev = snapAt(addDays(day, -1));
  const stockFrom = (snap) => (it) => snap[it.id] ?? 0;
  const { make, demand } = planNeeds(items, days[day] || {}, stockFrom(prev));
  const made = {}, arrived = {};
  make.forEach(m => { made[m.it.id] = (made[m.it.id] || 0) + m.q; });
  // 今天到的貨：每家廠商在「今天 − 提前天數」那天照系統叫的量
  const leads = [...new Set(items.filter(isPurchased).map(i => (supCfg[supOf(i)]?.lead) || 1))];
  leads.forEach(lead => {
    const od = addDays(day, -lead);
    supplierPlan(items, supCfg, od, days, stockFrom(snapAt(od)))
      .filter(t => !t.skip && t.lead === lead && t.arrive === day)
      .forEach(t => t.rows.forEach(b => { arrived[b.it.id] = (arrived[b.it.id] || 0) + b.order; }));
  });
  const out = {};
  items.forEach(it => {
    if (it.internal || prev[it.id] === undefined) return;
    const m = made[it.id] || 0, a = arrived[it.id] || 0, u = demand[it.id] || 0;
    out[it.id] = { prev: prev[it.id], made: m, arrived: a, used: u, expect: Math.max(0, prev[it.id] + m + a - u) };
  });
  return out;
}
// 差異要不要提醒：超過 1 個最小單位，而且超過應有量的 5%
export const diffAlert = (it, expect, counted) => {
  const d = Math.abs(counted - expect);
  return d >= (it.per ? 1 / it.per : 1) - 1e-9 && d > expect * 0.05;
};

// 配方不能繞回自己（例：A 用 B、B 又用 A）；recipe 為 id 這個品項準備存入的新配方
export function recipeCycle(items, id, recipe) {
  const byId = (x) => items.find(i => i.id === x);
  const seen = new Set();
  const walk = (cid) => {
    if (cid === id) return true;
    if (seen.has(cid)) return false;
    seen.add(cid);
    return (byId(cid)?.recipe || []).some(r => r.id && walk(r.id));
  };
  return recipe.some(r => r.id && walk(r.id));
}

// 規格寫「N小單位／大單位」且大單位就是品項單位時（例：7包／箱、2.5小鍋／長鍋），
// 盤點與異動改成「大單位＋小單位」兩格；per = 每個大單位等於幾個小單位
// 「份」是每盤的份量說明（10份／盤），不是盤點單位，不拆兩格
const NOT_COUNT_UNITS = ['份'];
export function subUnit(i) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([^\d\s／/]+)\s*[／/]\s*(\S+?)\s*$/.exec(i.spec || '');
  if (!m || m[3] !== i.unit || m[2] === i.unit || NOT_COUNT_UNITS.includes(m[2])) return { per: 0, sub: '' };
  const per = parseFloat(m[1]);
  return per > 1 ? { per, sub: m[2] } : { per: 0, sub: '' };
}

// 大單位數量（可含小數）拆成整數大單位與剩下的小單位
export function splitBox(q, per) {
  const small = q * per;
  const b = Math.floor((small + 1e-6) / per);
  return { b, p: Math.round((small - b * per) * 100) / 100 };
}

// 顯示數量：雙單位品項顯示「2 箱 3 包」「1 長鍋 1 小鍋」
export function qtyText(i, q) {
  if (i.per) {
    const neg = q < 0;
    const { b, p } = splitBox(Math.abs(q), i.per);
    // 不滿一個大單位時只顯示小單位（「4 包」而不是「0 箱 4 包」）
    if (!b && p) return `${neg ? '−' : ''}${fmtQty(p)} ${i.sub}`;
    return `${neg ? '−' : ''}${b} ${i.unit}${p ? ` ${fmtQty(p)} ${i.sub}` : ''}`;
  }
  return `${q < 0 ? '−' : ''}${fmtQty(Math.abs(q))} ${i.unit}`;
}

export function fmtQty(n) {
  return (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString('zh-TW');
}

export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}


export function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(() => { t.className = 'toast'; }, 2800);
}

const ADMIN_EMAILS = ['a51095693@complaint.local'];
const MANAGER_TITLES = ['廠長', '副廠長'];

export async function getUserData(db, user) {
  const cacheKey = 'ud_' + user.uid;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }
  const idNo = user.email.split('@')[0];
  let name = idNo, jobTitle = '', store = '';
  try {
    const snap = await getDoc(doc(db, 'accounts', user.uid));
    if (snap.exists()) {
      if (snap.data().name) name = snap.data().name;
      jobTitle = snap.data().role || '';
      store = snap.data().store || '';
    }
  } catch(e) {}
  let role = 'employee';
  if (ADMIN_EMAILS.includes(user.email)) role = 'admin';
  else if (MANAGER_TITLES.includes(jobTitle)) role = 'manager';
  const userData = { name, idNo, email: user.email, role, jobTitle, store, uid: user.uid };
  sessionStorage.setItem(cacheKey, JSON.stringify(userData));
  return userData;
}

export function renderSidebar(ud, activePage, auth) {
  const isAdmin = ud.role === 'admin';
  const isManager = ud.role === 'manager';
  const canReview = isAdmin || isManager;
  // 分組：每天要做的事放最上面，設定類放下面
  const pages = (isAdmin || isManager) ? [
    '每天',
    ['inventory.html','📦','盤點'],['order.html','🧾','叫貨計算'],
    '設定',
    ['stock.html','🗃️','品項庫存'],['recipe.html','🧪','配方設定'],['ingredient.html','🥬','食材與廠商'],
    ...(isAdmin ? ['管理', ['account.html','👥','帳號管理']] : [])
  ] : [];

  const nav = document.getElementById('sb-nav');
  if (nav) {
    nav.innerHTML = pages.map(p => typeof p === 'string'
      ? `<div class="nav-group">${p}</div>`
      : `<a href="${p[0]}" class="nav-item${p[0]===activePage?' active':''}"><span class="ic">${p[1]}</span>${p[2]}</a>`
    ).join('');
    if (canReview) {
      nav.innerHTML += `<div class="nav-group">帳號</div><button class="nav-item" onclick="openPwdModal()"><span class="ic">🔒</span>修改密碼</button>`;
    }
    nav.innerHTML += `<button class="nav-item" onclick="doSignOut()"><span class="ic">🚪</span>登出</button>`;
  }

  const userArea = document.getElementById('sb-user-area');
  if (userArea) {
    const roleLabel = isAdmin ? '管理員' : `${ud.store || ''}${ud.jobTitle || '員工'}`;
    userArea.innerHTML = `<div class="uname">${ud.name}</div><div class="urole">${roleLabel}</div>`;
  }

  if (auth && canReview) initPasswordChange(auth);
}

function initPasswordChange(auth) {
  if (document.getElementById('pwdModal')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <div class="modal-bg" id="pwdModal">
    <div class="modal" style="max-width:360px;">
      <div class="modal-title">🔒 修改密碼</div>
      <div style="margin-bottom:12px;">
        <label class="form-label">目前密碼 *</label>
        <input type="text" autocomplete="username" style="display:none" aria-hidden="true" tabindex="-1">
        <input type="password" autocomplete="current-password" class="form-control" id="pwdOld" placeholder="輸入目前密碼">
      </div>
      <div style="margin-bottom:12px;">
        <label class="form-label">新密碼 *</label>
        <input type="password" autocomplete="new-password" class="form-control" id="pwdNew" placeholder="至少 6 個字元">
      </div>
      <div style="margin-bottom:16px;">
        <label class="form-label">確認新密碼 *</label>
        <input type="password" autocomplete="new-password" class="form-control" id="pwdNew2" placeholder="再輸入一次新密碼">
      </div>
      <div class="flex gap-2">
        <button class="btn btn-primary w-full" id="pwdSaveBtn">儲存</button>
        <button class="btn btn-outline" id="pwdCancelBtn">取消</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(wrap.firstElementChild);

  const modal = document.getElementById('pwdModal');
  const close = () => modal.classList.remove('open');
  window.openPwdModal = () => {
    ['pwdOld','pwdNew','pwdNew2'].forEach(id => document.getElementById(id).value = '');
    modal.classList.add('open');
  };
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.getElementById('pwdCancelBtn').addEventListener('click', close);

  document.getElementById('pwdSaveBtn').addEventListener('click', async () => {
    const oldPwd = document.getElementById('pwdOld').value;
    const newPwd = document.getElementById('pwdNew').value;
    const newPwd2 = document.getElementById('pwdNew2').value;
    if (!oldPwd || !newPwd || !newPwd2) { showToast('請填寫所有欄位', 'error'); return; }
    if (newPwd.length < 6) { showToast('新密碼至少 6 個字元', 'error'); return; }
    if (newPwd !== newPwd2) { showToast('兩次輸入的新密碼不一致', 'error'); return; }
    const btn = document.getElementById('pwdSaveBtn');
    btn.disabled = true; btn.textContent = '儲存中…';
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, oldPwd);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, newPwd);
      showToast('密碼已更新', 'success');
      close();
    } catch(err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        showToast('目前密碼不正確', 'error');
      } else {
        showToast('修改失敗，請重試', 'error');
      }
    } finally {
      btn.disabled = false; btn.textContent = '儲存';
    }
  });
}
