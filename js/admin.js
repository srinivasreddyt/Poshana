// ============================================
// Poshaná admin panel — auth + enquiries dashboard.
//
// The PIN the admin types maps to the password of a single, fixed
// Firebase Auth account (ADMIN_EMAIL). This keeps the login UI a
// simple PIN while Firestore security rules still require a real
// authenticated session (request.auth != null) for read/update —
// the PIN is not just a client-side gate.
// ============================================
const firebaseConfig = {
  apiKey: "AIzaSyA6q2cN75_iHY9-hzyb6C6gObjrUBFOH94",
  authDomain: "poshana-36204.firebaseapp.com",
  projectId: "poshana-36204",
  storageBucket: "poshana-36204.firebasestorage.app",
  messagingSenderId: "658965368041",
  appId: "1:658965368041:web:c19e0d85e79a8a5e013478",
};

const ADMIN_EMAIL = "admin@poshana-admin.local";

const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
const {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
const {
  getFirestore, collection, query, orderBy, onSnapshot, doc, updateDoc, serverTimestamp,
} = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const loginScreen = document.getElementById('login-screen');
const adminApp = document.getElementById('admin-app');
const pinForm = document.getElementById('pin-form');
const pinInput = document.getElementById('pin-input');
const loginError = document.getElementById('login-error');
const logoutBtn = document.getElementById('logout-btn');

let allEnquiries = [];
let unsubscribeSnapshot = null;

// ---------- Auth ----------
pinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = pinInput.value.trim();
  loginError.textContent = '';
  const submitBtn = pinForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Checking…';
  try {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, pin);
  } catch (err) {
    loginError.textContent = 'Incorrect PIN. Please try again.';
    pinInput.value = '';
    pinInput.focus();
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Unlock';
  }
});

logoutBtn.addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginScreen.hidden = true;
    adminApp.hidden = false;
    startListening();
  } else {
    adminApp.hidden = true;
    loginScreen.hidden = false;
    pinInput.value = '';
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
    allEnquiries = [];
  }
});

// ---------- Data ----------
function startListening() {
  const tbody = document.getElementById('enquiries-tbody');
  const loadingState = document.getElementById('loading-state');
  const q = query(collection(db, 'enquiries'), orderBy('createdAt', 'desc'));
  unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
    allEnquiries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadingState.hidden = true;
    renderStats();
    renderTable();
  }, (err) => {
    loadingState.textContent = 'Could not load enquiries: ' + err.message;
  });
}

function renderStats() {
  document.getElementById('stat-total').textContent = allEnquiries.length;
  document.getElementById('stat-new').textContent = allEnquiries.filter((e) => e.status !== 'closed').length;
  document.getElementById('stat-closed').textContent = allEnquiries.filter((e) => e.status === 'closed').length;
}

// ---------- Filters ----------
const state = {
  statusFilter: 'all',
  search: '',
  dateType: 'all',
};

document.querySelectorAll('.status-pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.status-pill').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.statusFilter = btn.dataset.statusFilter;
    renderTable();
  });
});

document.getElementById('search-input').addEventListener('input', (e) => {
  state.search = e.target.value.trim().toLowerCase();
  renderTable();
});

const dateFilterType = document.getElementById('date-filter-type');
const dayInput = document.getElementById('date-filter-day');
const monthInput = document.getElementById('date-filter-month');
const yearInput = document.getElementById('date-filter-year');

dateFilterType.addEventListener('change', () => {
  state.dateType = dateFilterType.value;
  dayInput.hidden = state.dateType !== 'day';
  monthInput.hidden = state.dateType !== 'month';
  yearInput.hidden = state.dateType !== 'year';
  renderTable();
});
[dayInput, monthInput, yearInput].forEach((el) => el.addEventListener('input', renderTable));

document.getElementById('clear-filters-btn').addEventListener('click', () => {
  state.statusFilter = 'all';
  state.search = '';
  state.dateType = 'all';
  document.querySelectorAll('.status-pill').forEach((b) => b.classList.toggle('active', b.dataset.statusFilter === 'all'));
  document.getElementById('search-input').value = '';
  dateFilterType.value = 'all';
  dayInput.hidden = monthInput.hidden = yearInput.hidden = true;
  dayInput.value = monthInput.value = yearInput.value = '';
  renderTable();
});

function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return new Date(ts);
}

function matchesDateFilter(enq) {
  if (state.dateType === 'all') return true;
  const d = toDate(enq.createdAt);
  if (!d) return false;
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  if (state.dateType === 'day') return !!dayInput.value && iso === dayInput.value;
  if (state.dateType === 'month') return !!monthInput.value && iso.slice(0, 7) === monthInput.value;
  if (state.dateType === 'year') return !!yearInput.value && String(d.getFullYear()) === String(yearInput.value);
  return true;
}

function getFilteredEnquiries() {
  return allEnquiries.filter((enq) => {
    if (state.statusFilter === 'new' && enq.status === 'closed') return false;
    if (state.statusFilter === 'closed' && enq.status !== 'closed') return false;
    if (state.search) {
      const haystack = `${enq.name || ''} ${enq.phone || ''}`.toLowerCase();
      if (!haystack.includes(state.search)) return false;
    }
    if (!matchesDateFilter(enq)) return false;
    return true;
  });
}

function formatDate(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function renderTable() {
  const tbody = document.getElementById('enquiries-tbody');
  const emptyState = document.getElementById('empty-state');
  const filtered = getFilteredEnquiries();

  tbody.innerHTML = '';
  emptyState.hidden = filtered.length > 0;

  filtered.forEach((enq) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(enq.createdAt)}</td>
      <td class="cell-name">${escapeHtml(enq.name || '—')}</td>
      <td>${escapeHtml(enq.phone || '—')}</td>
      <td>${escapeHtml(enq.plan || enq.goal || '—')}</td>
      <td>${escapeHtml(enq.source || '—')}</td>
      <td><span class="badge ${enq.status === 'closed' ? 'badge-closed' : 'badge-new'}">${enq.status === 'closed' ? 'Closed' : 'New'}</span></td>
    `;
    tr.addEventListener('click', () => openDrawer(enq.id));
    tbody.appendChild(tr);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Drawer ----------
const drawer = document.getElementById('detail-drawer');
let activeEnquiryId = null;

function openDrawer(id) {
  const enq = allEnquiries.find((e) => e.id === id);
  if (!enq) return;
  activeEnquiryId = id;

  document.getElementById('drawer-name').textContent = enq.name || 'Unnamed';
  document.getElementById('drawer-phone').textContent = enq.phone || '—';
  document.getElementById('drawer-email').textContent = enq.email || '—';
  document.getElementById('drawer-plan').textContent = enq.plan || enq.goal || '—';
  document.getElementById('drawer-source').textContent = enq.source || '—';
  document.getElementById('drawer-date').textContent = formatDate(enq.createdAt);

  const msg = enq.message || enq.notes || '';
  const msgBox = document.getElementById('drawer-message');
  const msgLabel = document.getElementById('drawer-message-label');
  if (msg) {
    msgBox.textContent = msg;
    msgBox.hidden = false;
    msgLabel.hidden = false;
  } else {
    msgBox.hidden = true;
    msgLabel.hidden = true;
  }

  const isClosed = enq.status === 'closed';
  const badge = document.getElementById('drawer-badge');
  badge.textContent = isClosed ? 'Closed' : 'New';
  badge.className = 'badge ' + (isClosed ? 'badge-closed' : 'badge-new');

  document.querySelectorAll('.status-toggle button').forEach((btn) => {
    const matches = (btn.dataset.status === 'closed') === isClosed;
    btn.classList.toggle('active', matches);
  });

  document.getElementById('drawer-comment').value = enq.adminComment || '';
  document.getElementById('drawer-save-status').textContent = '';

  drawer.hidden = false;
}

function closeDrawer() {
  drawer.hidden = true;
  activeEnquiryId = null;
}

document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);

document.querySelectorAll('.status-toggle button').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!activeEnquiryId) return;
    const newStatus = btn.dataset.status;
    document.querySelectorAll('.status-toggle button').forEach((b) => b.classList.toggle('active', b === btn));
    try {
      await updateDoc(doc(db, 'enquiries', activeEnquiryId), {
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
      const badge = document.getElementById('drawer-badge');
      badge.textContent = newStatus === 'closed' ? 'Closed' : 'New';
      badge.className = 'badge ' + (newStatus === 'closed' ? 'badge-closed' : 'badge-new');
      document.getElementById('drawer-save-status').textContent = 'Status updated.';
    } catch (err) {
      document.getElementById('drawer-save-status').textContent = 'Could not update status.';
    }
  });
});

document.getElementById('save-drawer-btn').addEventListener('click', async () => {
  if (!activeEnquiryId) return;
  const saveStatus = document.getElementById('drawer-save-status');
  const comment = document.getElementById('drawer-comment').value;
  saveStatus.textContent = 'Saving…';
  try {
    await updateDoc(doc(db, 'enquiries', activeEnquiryId), {
      adminComment: comment,
      updatedAt: serverTimestamp(),
    });
    saveStatus.textContent = 'Comment saved.';
  } catch (err) {
    saveStatus.textContent = 'Could not save comment.';
  }
});
