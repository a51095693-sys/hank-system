import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

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

export function getUserData(db, user) {
  const cacheKey = 'ud_' + user.uid;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }
  const idNo = user.email.split('@')[0];
  const role = ADMIN_EMAILS.includes(user.email) ? 'admin' : 'employee';
  const userData = { name: idNo, idNo, email: user.email, role };
  sessionStorage.setItem(cacheKey, JSON.stringify(userData));
  return userData;
}

export function renderSidebar(ud, activePage) {
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
      nav.innerHTML += `<button class="nav-item" onclick="doSignOut()"><span class="ic">🚪</span>登出</button>`;
    } else {
      nav.innerHTML += `<button class="nav-item" onclick="doSignOut()"><span class="ic">🚪</span>登出</button>`;
    }
  }

  const userArea = document.getElementById('sb-user-area');
  if (userArea) {
    userArea.innerHTML = `<div class="uname">${ud.name}</div><div class="urole">${isAdmin?'管理員':'員工'}</div>`;
  }
}
