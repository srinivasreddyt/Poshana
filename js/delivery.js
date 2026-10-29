// ============================================
// Poshaná delivery executive portal.
//
// Executives sign in with phone + PIN, which maps to a Firebase Auth
// email/password account created by the admin (see loginKinds in
// js/admin.js). They see every subscriber in their own branch (their own
// ones first, via the filter), and nothing from other branches. Firestore
// rules only allow the query filtered on their branchId.
// ============================================
const firebaseConfig = {
  apiKey: "AIzaSyA6q2cN75_iHY9-hzyb6C6gObjrUBFOH94",
  authDomain: "poshana-36204.firebaseapp.com",
  projectId: "poshana-36204",
  storageBucket: "poshana-36204.firebasestorage.app",
  messagingSenderId: "658965368041",
  appId: "1:658965368041:web:c19e0d85e79a8a5e013478",
};

const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
const {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
const {
  getFirestore, collection, query, where, onSnapshot, doc, getDoc,
} = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const loginScreen = document.getElementById('login-screen');
const deliveryApp = document.getElementById('delivery-app');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

let exec = null; // { id, name, branchId, ... }
let subs = []; // every subscriber in the executive's branch
let unsubscribers = [];

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

function loginEmail(phone) {
  return `d${normalizePhone(phone)}@poshana-delivery.local`;
}

// ---------- Auth ----------
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const phone = normalizePhone(document.getElementById('login-phone').value);
  const pin = document.getElementById('login-pin').value.trim();
  if (phone.length !== 10) {
    loginError.textContent = 'Enter your 10-digit phone number.';
    return;
  }
  const btn = loginForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    await signInWithEmailAndPassword(auth, loginEmail(phone), pin);
  } catch (err) {
    loginError.textContent = 'Incorrect phone number or PIN.';
    document.getElementById('login-pin').value = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  }
});

document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  stopListening();
  if (!user) {
    exec = null;
    deliveryApp.hidden = true;
    loginScreen.hidden = false;
    return;
  }
  try {
    const login = await getDoc(doc(db, 'deliveryLogins', user.uid));
    if (!login.exists()) {
      await signOut(auth);
      loginError.textContent = 'This account is not set up as a delivery executive.';
      return;
    }
    const execId = login.data().deliveryExecId;
    const execSnap = await getDoc(doc(db, 'deliveryExecutives', execId));
    exec = { id: execId, ...(execSnap.exists() ? execSnap.data() : {}) };
    if (exec.status === 'inactive') {
      await signOut(auth);
      loginError.textContent = 'Your account is inactive. Please contact the admin.';
      return;
    }
  } catch (err) {
    await signOut(auth);
    loginError.textContent = 'Could not load your account: ' + err.message;
    return;
  }

  document.getElementById('de-greeting').textContent = `Hi ${exec.name || 'there'}${exec.branchName ? ` — ${exec.branchName} branch` : ''}.`;
  loginScreen.hidden = true;
  deliveryApp.hidden = false;
  startListening();
});

function stopListening() {
  unsubscribers.forEach((fn) => fn());
  unsubscribers = [];
  subs = [];
}

function startListening() {
  const loading = document.getElementById('loading-state');
  loading.hidden = false;
  if (!exec.branchId) {
    loading.textContent = 'You are not assigned to a branch yet. Please contact the admin.';
    render();
    return;
  }
  loading.textContent = 'Loading subscribers…';

  unsubscribers.push(onSnapshot(
    query(collection(db, 'subscribers'), where('branchId', '==', exec.branchId)),
    (snap) => {
      subs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      loading.hidden = true;
      render();
    },
    (err) => { loading.textContent = 'Could not load subscribers: ' + err.message; },
  ));
}

// ---------- Helpers ----------
function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return new Date(ts);
}

function formatShortDate(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function execLabel(sub) {
  if (!sub.deliveryExecId) return 'Unassigned';
  if (sub.deliveryExecId === exec.id) return 'Me';
  return sub.deliveryExecName || 'Another executive';
}

const statusLabel = { active: 'Active', paused: 'Paused', cancelled: 'Cancelled' };
const statusBadgeClass = { active: 'badge-new', paused: 'badge-paused', cancelled: 'badge-closed' };

// ---------- Subscriber list ----------
// execFilter: 'mine' (default), 'all', 'unassigned', or another executive's id.
const state = { status: 'all', execFilter: 'mine', search: '' };

document.querySelectorAll('[data-status-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-status-filter]').forEach((b) => b.classList.toggle('active', b === btn));
    state.status = btn.dataset.statusFilter;
    renderTable();
  });
});

const execFilter = document.getElementById('exec-filter');
execFilter.addEventListener('change', () => {
  state.execFilter = execFilter.value;
  renderTable();
});

document.getElementById('search-input').addEventListener('input', (e) => {
  state.search = e.target.value.trim().toLowerCase();
  renderTable();
});

// Other executives are taken from the subscribers they deliver to.
function populateExecFilter() {
  const others = new Map();
  subs.forEach((s) => {
    if (s.deliveryExecId && s.deliveryExecId !== exec.id) others.set(s.deliveryExecId, s.deliveryExecName || 'Another executive');
  });
  const options = [
    ['mine', 'My subscribers'],
    ['all', 'All in my branch'],
    ...Array.from(others).sort((a, b) => a[1].localeCompare(b[1])),
    ['unassigned', 'Unassigned'],
  ];
  execFilter.innerHTML = '';
  options.forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    execFilter.appendChild(opt);
  });
  if (!options.some(([value]) => value === state.execFilter)) state.execFilter = 'mine';
  execFilter.value = state.execFilter;
}

function matchesExecFilter(sub) {
  if (state.execFilter === 'all') return true;
  if (state.execFilter === 'mine') return sub.deliveryExecId === exec.id;
  if (state.execFilter === 'unassigned') return !sub.deliveryExecId;
  return sub.deliveryExecId === state.execFilter;
}

function render() {
  const mine = subs.filter((s) => s.deliveryExecId === exec.id);
  document.getElementById('stat-mine').textContent = mine.length;
  document.getElementById('stat-mine-active').textContent = mine.filter((s) => (s.status || 'active') === 'active').length;
  populateExecFilter();
  renderTable();
  if (activeSubId && !subDrawer.hidden) renderSubDrawer();
}

function renderTable() {
  const tbody = document.getElementById('subs-tbody');
  const filtered = subs.filter((s) => {
    if (state.status !== 'all' && (s.status || 'active') !== state.status) return false;
    if (!matchesExecFilter(s)) return false;
    if (state.search && !`${s.name || ''} ${s.phone || ''} ${s.address || ''}`.toLowerCase().includes(state.search)) return false;
    return true;
  });

  document.getElementById('stat-shown').textContent = filtered.length;
  tbody.innerHTML = '';
  document.getElementById('empty-state').hidden = filtered.length > 0 || !document.getElementById('loading-state').hidden;

  filtered.forEach((s) => {
    const status = s.status || 'active';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="cell-name">${escapeHtml(s.name || '—')}</td>
      <td>${s.phone ? `<a class="cell-call" href="tel:+91${escapeHtml(normalizePhone(s.phone))}">📞 ${escapeHtml(s.phone)}</a>` : '—'}</td>
      <td>${escapeHtml(s.address || '—')}</td>
      <td>${escapeHtml(s.plan || '—')}</td>
      <td><span class="badge ${statusBadgeClass[status] || 'badge-new'}">${statusLabel[status] || status}</span></td>
      <td>${escapeHtml(execLabel(s))}</td>
    `;
    tr.querySelector('.cell-call')?.addEventListener('click', (e) => e.stopPropagation());
    tr.addEventListener('click', () => openSubDrawer(s.id));
    tbody.appendChild(tr);
  });
}

// ---------- Subscriber drawer (read-only) ----------
const subDrawer = document.getElementById('sub-drawer');
let activeSubId = null;

function openSubDrawer(id) {
  activeSubId = id;
  renderSubDrawer();
  subDrawer.hidden = false;
}

function closeSubDrawer() {
  subDrawer.hidden = true;
  activeSubId = null;
}

document.getElementById('sub-drawer-close').addEventListener('click', closeSubDrawer);
document.getElementById('sub-drawer-backdrop').addEventListener('click', closeSubDrawer);

function renderSubDrawer() {
  const s = subs.find((x) => x.id === activeSubId);
  if (!s) {
    // Subscriber moved out of this executive's view while the drawer was open.
    closeSubDrawer();
    return;
  }
  const status = s.status || 'active';
  const badge = document.getElementById('sub-badge');
  badge.textContent = statusLabel[status] || status;
  badge.className = 'badge ' + (statusBadgeClass[status] || 'badge-new');

  document.getElementById('sub-name').textContent = s.name || 'Unnamed';
  const callBtn = document.getElementById('sub-call-btn');
  callBtn.hidden = !s.phone;
  callBtn.href = s.phone ? `tel:+91${normalizePhone(s.phone)}` : '#';
  callBtn.textContent = `📞 Call ${s.name || ''}`.trim();
  const mapBtn = document.getElementById('sub-map-btn');
  mapBtn.hidden = !s.address;
  mapBtn.href = s.address ? mapsUrl(s.address) : '#';

  document.getElementById('sub-phone').textContent = s.phone || '—';
  document.getElementById('sub-address').textContent = s.address || '—';
  document.getElementById('sub-branch').textContent = s.branchName || '—';
  document.getElementById('sub-plan').textContent = s.plan || '—';
  document.getElementById('sub-dates').textContent = `${formatShortDate(s.startDate)} – ${formatShortDate(s.endDate)}`;
  document.getElementById('sub-exec').textContent = execLabel(s);
}
