import { getAuth, signOut, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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

export async function getUserData(db, user) {
  const cacheKey = 'ud_' + user.uid;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }
  const idNo = user.email.split('@')[0];
  const role = ADMIN_EMAILS.includes(user.email) ? 'admin' : 'employee';
  let name = idNo;
  try {
    const snap = await getDoc(doc(db, 'accounts', user.uid));
    if (snap.exists() && snap.data().name) name = snap.data().name;
  } catch(e) {}
  const userData = { name, idNo, email: user.email, role, uid: user.uid };
  sessionStorage.setItem(cacheKey, JSON.stringify(userData));
  return userData;
}

export function renderSidebar(ud, activePage, auth) {
  const isAdmin = ud.role === 'admin';
  const pages = isAdmin
    ? [['admin.html','📋','所有客訴'],['account.html','👥','帳號管理']]
    : [['submit.html','📝','提交客訴'],['my.html','📋','我的客訴']];

  const nav = document.getElementById('sb-nav');
  if (nav) {
    nav.innerHTML = pages.map(([href, ic, label]) =>
      `<a href="${href}" class="nav-item${href===activePage?' active':''}"><span class="ic">${ic}</span>${label}</a>`
    ).join('');
    if (isAdmin) {
      nav.innerHTML += `<button class="nav-item" onclick="openPwdModal()"><span class="ic">🔒</span>修改密碼</button>`;
    }
    nav.innerHTML += `<button class="nav-item" onclick="doSignOut()"><span class="ic">🚪</span>登出</button>`;
  }

  const userArea = document.getElementById('sb-user-area');
  if (userArea) {
    userArea.innerHTML = `<div class="uname">${ud.name}</div><div class="urole">${isAdmin?'管理員':'員工'}</div>`;
  }

  if (auth && isAdmin) initPasswordChange(auth);
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
        <input type="password" class="form-control" id="pwdOld" placeholder="輸入目前密碼">
      </div>
      <div style="margin-bottom:12px;">
        <label class="form-label">新密碼 *</label>
        <input type="password" class="form-control" id="pwdNew" placeholder="至少 6 個字元">
      </div>
      <div style="margin-bottom:16px;">
        <label class="form-label">確認新密碼 *</label>
        <input type="password" class="form-control" id="pwdNew2" placeholder="再輸入一次新密碼">
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
