import { getAuth, signOut, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const STORES = ['總公司','鑫耀鑫','鑫營','新生北','景新','梁鑫','泉州','府中','心惦','巷日','大直','福城','幸福','新莊'];

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
      // 配方：每 1 單位本品項需要的其他品項數量 [{ id, qty }]
      const recipe = (Array.isArray(e.recipe) ? e.recipe : [])
        .filter(r => r && r.id && Number(r.qty) > 0)
        .map(r => ({ id: r.id, qty: Number(r.qty) }));
      const item = {
        id: d.id, name: e.name || '', kind, category: e.category || '',
        unit: e.unit || '', spec: e.spec || '', stock: Number(e.stock) || 0,
        safety: Number(e.safety) || 0, sort: e.sort ?? 999, recipe,
        supplier: e.supplier || ''
      };
      return { ...item, ...subUnit(item) };
    })
    // 不同廠商可以有同名品項；同名時顯示名稱加上廠商以便區分（label）
    .map((i, _, all) => ({
      ...i,
      label: i.supplier && all.some(o => o.id !== i.id && o.name === i.name) ? `${i.name}（${i.supplier}）` : i.name
    }))
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.sort - b.sort || a.name.localeCompare(b.name, 'zh-Hant'));
}

// 廠商名單：suppliers 集合裡建立的廠商，加上品項上已填寫的廠商名稱（舊資料）
export async function loadSuppliers(db, items = []) {
  const snap = await getDocs(collection(db, 'suppliers'));
  const list = snap.docs.map(d => ({ id: d.id, name: d.data().name || '' })).filter(s => s.name);
  items.forEach(i => {
    if (i.supplier && !list.some(s => s.name === i.supplier)) list.push({ id: '', name: i.supplier });
  });
  return list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

// 跟廠商叫貨的品項：食材，或有填廠商、沒有配方的成品（例：外購的貢丸）
export const isPurchased = (i) => i.kind === '食材' || (!!i.supplier && !i.recipe.length);

// 配方不能繞回自己（例：A 用 B、B 又用 A）；recipe 為 id 這個品項準備存入的新配方
export function recipeCycle(items, id, recipe) {
  const byId = (x) => items.find(i => i.id === x);
  const seen = new Set();
  const walk = (cid) => {
    if (cid === id) return true;
    if (seen.has(cid)) return false;
    seen.add(cid);
    return (byId(cid)?.recipe || []).some(r => walk(r.id));
  };
  return recipe.some(r => walk(r.id));
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
  const pages = isAdmin
    ? [['inventory.html','📦','盤點'],['order.html','🧾','叫貨計算'],['stock.html','🗃️','品項庫存'],['recipe.html','🧪','配方設定'],['ingredient.html','🥬','食材'],['account.html','👥','帳號管理']]
    : isManager
    ? [['inventory.html','📦','盤點'],['order.html','🧾','叫貨計算'],['stock.html','🗃️','品項庫存'],['recipe.html','🧪','配方設定'],['ingredient.html','🥬','食材']]
    : [];

  const nav = document.getElementById('sb-nav');
  if (nav) {
    nav.innerHTML = pages.map(([href, ic, label]) =>
      `<a href="${href}" class="nav-item${href===activePage?' active':''}"><span class="ic">${ic}</span>${label}</a>`
    ).join('');
    if (canReview) {
      nav.innerHTML += `<button class="nav-item" onclick="openPwdModal()"><span class="ic">🔒</span>修改密碼</button>`;
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
