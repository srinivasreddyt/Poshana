// ============================================
// Poshaná admin panel — auth + enquiries dashboard.
//
// The PIN the admin types maps to the password of a single, fixed
// Firebase Auth account (ADMIN_EMAIL). This keeps the login UI a
// simple PIN while Firestore security rules still require a real
// authenticated session (request.auth != null) for read/update —
// the PIN is not just a client-side gate.
// ============================================
import { visitDetailsHtml, profileHtml, findProfileSource } from './consultation-format.js';
import { createTypeahead } from './typeahead.js';

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
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword,
} = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
const {
  getFirestore, collection, query, where, orderBy, onSnapshot, doc, getDoc, updateDoc, addDoc, setDoc, deleteDoc, getDocs, serverTimestamp,
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
let allSubscribers = [];
let unsubscribeSubSnapshot = null;
let allDeliveryExecs = [];
let unsubscribeDeSnapshot = null;
let allMentors = [];
let unsubscribeMentorSnapshot = null;
let allBranches = [];
let unsubscribeBranchSnapshot = null;
let selectedBranch = 'all';
try { selectedBranch = localStorage.getItem('poshana-admin-branch') || 'all'; } catch (e) { /* storage unavailable */ }

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
    startListeningSubscribers();
    startListeningDeliveryExecs();
    startListeningMentors();
    startListeningBranches();
  } else {
    adminApp.hidden = true;
    loginScreen.hidden = false;
    pinInput.value = '';
    if (unsubscribeSnapshot) {
      unsubscribeSnapshot();
      unsubscribeSnapshot = null;
    }
    if (unsubscribeSubSnapshot) {
      unsubscribeSubSnapshot();
      unsubscribeSubSnapshot = null;
    }
    if (unsubscribeDeSnapshot) {
      unsubscribeDeSnapshot();
      unsubscribeDeSnapshot = null;
    }
    if (unsubscribeMentorSnapshot) {
      unsubscribeMentorSnapshot();
      unsubscribeMentorSnapshot = null;
    }
    allEnquiries = [];
    allSubscribers = [];
    allDeliveryExecs = [];
    allMentors = [];
    if (unsubscribeBranchSnapshot) {
      unsubscribeBranchSnapshot();
      unsubscribeBranchSnapshot = null;
    }
    allBranches = [];
    stopReportListener();
    reportTabOpened = false;
  }
});

// ---------- Tabs ----------
document.querySelectorAll('.admin-nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-nav-item').forEach((b) => b.classList.toggle('active', b === btn));
    const tab = btn.dataset.tab;
    document.getElementById('tab-enquiries').hidden = tab !== 'enquiries';
    document.getElementById('tab-subscribers').hidden = tab !== 'subscribers';
    document.getElementById('tab-mentors').hidden = tab !== 'mentors';
    document.getElementById('tab-delivery').hidden = tab !== 'delivery';
    document.getElementById('tab-branches').hidden = tab !== 'branches';
    document.getElementById('tab-reports').hidden = tab !== 'reports';
    if (tab === 'reports') ensureReportListener();
  });
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

function todayParts() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return { y, m, d };
}

dateFilterType.addEventListener('change', () => {
  state.dateType = dateFilterType.value;
  dayInput.hidden = state.dateType !== 'day';
  monthInput.hidden = state.dateType !== 'month';
  yearInput.hidden = state.dateType !== 'year';

  const { y, m, d } = todayParts();
  if (state.dateType === 'day' && !dayInput.value) dayInput.value = `${y}-${m}-${d}`;
  if (state.dateType === 'month' && !monthInput.value) monthInput.value = `${y}-${m}`;
  if (state.dateType === 'year' && !yearInput.value) yearInput.value = `${y}`;

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

// ---------- Branches ----------
function startListeningBranches() {
  unsubscribeBranchSnapshot = onSnapshot(collection(db, 'branches'), (snapshot) => {
    allBranches = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => branchLabel(a).localeCompare(branchLabel(b)));
    populateBranchSwitcher();
    rerenderBranchScoped();
  });
}

function branchLabel(b) {
  return b.city || 'Unnamed branch';
}

function inBranch(record) {
  return selectedBranch === 'all' || record.branchId === selectedBranch;
}

function populateBranchSwitcher() {
  const select = document.getElementById('branch-switcher');
  select.innerHTML = '<option value="all">All branches</option>';
  allBranches.forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = branchLabel(b);
    select.appendChild(opt);
  });
  if (selectedBranch !== 'all' && !allBranches.some((b) => b.id === selectedBranch)) selectedBranch = 'all';
  select.value = selectedBranch;
}

document.getElementById('branch-switcher').addEventListener('change', (e) => {
  selectedBranch = e.target.value;
  try { localStorage.setItem('poshana-admin-branch', selectedBranch); } catch (err) { /* storage unavailable */ }
  rerenderBranchScoped();
});

function rerenderBranchScoped() {
  syncBranchFilters();
  refreshAssigneeFilters();
  renderSubStats();
  renderSubscribersTable();
  renderMentorStats();
  renderMentorTable();
  renderDeStats();
  renderDeTable();
  renderBranchTable();
  renderReport();
}

function refreshAssigneeFilters() {
  populateAssigneeFilter('sub-mentor-filter', allMentors.filter(inBranch), 'mentorFilter', 'All Mentors', 'No Mentor');
  populateAssigneeFilter('sub-de-filter', allDeliveryExecs.filter(inBranch), 'deFilter', 'All Executives', 'Unassigned');
}

// New records default to the branch currently selected in the sidebar; with
// "All branches" selected the admin must pick one (the select is required).
function populateBranchSelect(selectId, currentId) {
  const select = document.getElementById(selectId);
  select.innerHTML = '<option value="">Select branch</option>';
  allBranches.forEach((b) => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = branchLabel(b);
    select.appendChild(opt);
  });
  select.value = currentId || (selectedBranch !== 'all' ? selectedBranch : '');
}

function readBranch(selectId) {
  const select = document.getElementById(selectId);
  const branch = allBranches.find((b) => b.id === select.value);
  return { branchId: branch ? branch.id : null, branchName: branch ? branchLabel(branch) : null };
}

// Mentor / delivery exec options for the subscriber form: people in the
// subscriber's branch (or with no branch yet). When opening an existing
// subscriber, keepCurrent also keeps their current assignee listed.
function populateSubAssignees(mentorId, deId, keepCurrent) {
  const branchId = document.getElementById('sub-branch').value;
  const allowed = (p, currentId) => !p.branchId || p.branchId === branchId || (keepCurrent && p.id === currentId);
  populateAssigneeSelect('sub-mentor', allMentors.filter((p) => allowed(p, mentorId)), mentorId, 'specialization');
  populateAssigneeSelect('sub-delivery-exec', allDeliveryExecs.filter((p) => allowed(p, deId)), deId, 'area');
}

document.getElementById('sub-branch').addEventListener('change', () => {
  populateSubAssignees(document.getElementById('sub-mentor').value, document.getElementById('sub-delivery-exec').value, false);
});

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

// ============================================
// Subscribers
// ============================================
function startListeningSubscribers() {
  const loadingState = document.getElementById('sub-loading-state');
  const q = query(collection(db, 'subscribers'), orderBy('startDate', 'desc'));
  unsubscribeSubSnapshot = onSnapshot(q, (snapshot) => {
    allSubscribers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadingState.hidden = true;
    renderSubStats();
    renderSubscribersTable();
    renderDeTable();
    renderMentorTable();
    renderBranchTable();
    renderReport();
    if (activeDeId && !deDrawer.hidden) renderAssignedList('de', 'deliveryExecId', activeDeId, closeDeDrawer);
    if (activeMentorId && !mentorDrawer.hidden) renderAssignedList('mentor', 'mentorId', activeMentorId, closeMentorDrawer);
  }, (err) => {
    loadingState.textContent = 'Could not load subscribers: ' + err.message;
  });
}

function renderSubStats() {
  const subs = allSubscribers.filter(inBranch);
  document.getElementById('sub-stat-total').textContent = subs.length;
  document.getElementById('sub-stat-active').textContent = subs.filter((s) => s.status === 'active').length;
  document.getElementById('sub-stat-essential').textContent = subs.filter((s) => s.plan === 'Essential').length;
  document.getElementById('sub-stat-balanced').textContent = subs.filter((s) => s.plan === 'Balanced').length;
  document.getElementById('sub-stat-complete').textContent = subs.filter((s) => s.plan === 'Complete Wellness').length;
}

// ---------- Subscriber filters ----------
const subState = {
  statusFilter: 'all',
  search: '',
  subscriberId: null, // set when a subscriber is picked from the search suggestions
  planFilter: 'all',
  mentorFilter: 'all',
  deFilter: 'all',
  dateType: 'all',
};

document.querySelectorAll('[data-sub-status-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-sub-status-filter]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    subState.statusFilter = btn.dataset.subStatusFilter;
    renderSubscribersTable();
  });
});

// Typing narrows the table and lists matching subscribers; picking one
// shows just that subscriber.
const subSearch = createTypeahead({
  input: document.getElementById('sub-search-input'),
  list: document.getElementById('sub-search-suggestions'),
  suggest: (q) => suggestSubscribers(q, (s) => subBranchFilter.matches(s)),
  emptyText: 'No matching subscriber',
  onType: (q) => {
    subState.search = q;
    subState.subscriberId = null;
    renderSubscribersTable();
  },
  onPick: (item) => {
    subState.search = '';
    subState.subscriberId = item.id;
    renderSubscribersTable();
  },
});

// ---------- Subscriber search ----------
function matchesNameOrPhone(sub, query) {
  return `${sub.name || ''} ${sub.phone || ''}`.toLowerCase().includes(query);
}

// Type-ahead items for subscribers in the sidebar's branch whose name or
// phone matches; `extraFilter` narrows them further.
function suggestSubscribers(query, extraFilter = () => true) {
  return allSubscribers
    .filter((s) => inBranch(s) && extraFilter(s) && matchesNameOrPhone(s, query))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .slice(0, 8)
    .map((s) => ({ id: s.id, label: s.name || 'Unnamed', meta: [s.phone, s.branchName, s.plan].filter(Boolean).join(' · ') }));
}

// ---------- Branch type-ahead filter ----------
// Used by the Subscribers, Mentors and Delivery Executives tabs. From 2
// letters on it suggests matching branches and narrows the table to them;
// picking a suggestion filters to that branch. It only shows while the
// sidebar is on "All branches" (see syncBranchFilters).
function matchingBranches(query) {
  return query.length < 2 ? [] : allBranches.filter((b) => branchLabel(b).toLowerCase().includes(query));
}

function createBranchFilter(prefix, onChange) {
  const input = document.getElementById(`${prefix}-branch-filter`);
  let query = '';
  let branchId = null;

  const typeahead = createTypeahead({
    input,
    list: document.getElementById(`${prefix}-branch-suggestions`),
    suggest: (q) => matchingBranches(q).map((b) => ({ id: b.id, label: branchLabel(b) })),
    emptyText: 'No matching branch',
    onType: (q) => {
      query = q;
      branchId = null;
      onChange();
    },
    onPick: (item) => {
      query = item.label.toLowerCase();
      branchId = item.id;
      onChange();
    },
  });

  function reset() {
    query = '';
    branchId = null;
    typeahead.reset();
  }

  return {
    reset,
    sync() {
      const showAll = selectedBranch === 'all';
      input.parentElement.hidden = !showAll;
      if (!showAll) reset();
    },
    matches(record) {
      if (branchId) return record.branchId === branchId;
      if (query.length < 2) return true;
      return matchingBranches(query).some((b) => b.id === record.branchId);
    },
  };
}

const subBranchFilter = createBranchFilter('sub', () => renderSubscribersTable());
const mentorBranchFilter = createBranchFilter('mentor', () => renderMentorTable());
const deBranchFilter = createBranchFilter('de', () => renderDeTable());

function syncBranchFilters() {
  [subBranchFilter, mentorBranchFilter, deBranchFilter].forEach((f) => f.sync());
}

document.getElementById('sub-plan-filter').addEventListener('change', (e) => {
  subState.planFilter = e.target.value;
  renderSubscribersTable();
});

document.getElementById('sub-mentor-filter').addEventListener('change', (e) => {
  subState.mentorFilter = e.target.value;
  renderSubscribersTable();
});

document.getElementById('sub-de-filter').addEventListener('change', (e) => {
  subState.deFilter = e.target.value;
  renderSubscribersTable();
});

// Rebuilt whenever the mentor / delivery exec list changes; keeps the current
// selection, falling back to "all" if that person was removed.
function populateAssigneeFilter(selectId, people, stateKey, allLabel, noneLabel) {
  const select = document.getElementById(selectId);
  select.innerHTML = '';
  [['all', allLabel], ['unassigned', noneLabel], ...people.map((p) => [p.id, p.name])].forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  });
  const current = subState[stateKey];
  const stillExists = current === 'all' || current === 'unassigned' || people.some((p) => p.id === current);
  if (!stillExists) subState[stateKey] = 'all';
  select.value = subState[stateKey];
}

function matchesAssignee(filterValue, assignedId) {
  if (filterValue === 'all') return true;
  if (filterValue === 'unassigned') return !assignedId;
  return assignedId === filterValue;
}

const subDateFilterType = document.getElementById('sub-date-filter-type');
const subDayInput = document.getElementById('sub-date-filter-day');
const subMonthInput = document.getElementById('sub-date-filter-month');
const subYearInput = document.getElementById('sub-date-filter-year');

subDateFilterType.addEventListener('change', () => {
  subState.dateType = subDateFilterType.value;
  subDayInput.hidden = subState.dateType !== 'day';
  subMonthInput.hidden = subState.dateType !== 'month';
  subYearInput.hidden = subState.dateType !== 'year';

  const { y, m, d } = todayParts();
  if (subState.dateType === 'day' && !subDayInput.value) subDayInput.value = `${y}-${m}-${d}`;
  if (subState.dateType === 'month' && !subMonthInput.value) subMonthInput.value = `${y}-${m}`;
  if (subState.dateType === 'year' && !subYearInput.value) subYearInput.value = `${y}`;

  renderSubscribersTable();
});
[subDayInput, subMonthInput, subYearInput].forEach((el) => el.addEventListener('input', renderSubscribersTable));

document.getElementById('sub-clear-filters-btn').addEventListener('click', () => {
  subState.statusFilter = 'all';
  subState.search = '';
  subState.subscriberId = null;
  subState.planFilter = 'all';
  subState.mentorFilter = 'all';
  subState.deFilter = 'all';
  subState.dateType = 'all';
  subBranchFilter.reset();
  document.querySelectorAll('[data-sub-status-filter]').forEach((b) => b.classList.toggle('active', b.dataset.subStatusFilter === 'all'));
  subSearch.reset();
  document.getElementById('sub-plan-filter').value = 'all';
  document.getElementById('sub-mentor-filter').value = 'all';
  document.getElementById('sub-de-filter').value = 'all';
  subDateFilterType.value = 'all';
  subDayInput.hidden = subMonthInput.hidden = subYearInput.hidden = true;
  subDayInput.value = subMonthInput.value = subYearInput.value = '';
  renderSubscribersTable();
});

// A subscriber "matches" a day/month/year when their [startDate, endDate]
// window overlaps that period — e.g. someone who started in September on a
// 3-month plan still shows up under a November or December filter.
function matchesSubDateFilter(sub) {
  if (subState.dateType === 'all') return true;
  const start = toDate(sub.startDate);
  const end = toDate(sub.endDate) || start;
  if (!start) return false;

  let periodStart, periodEnd;
  if (subState.dateType === 'day') {
    if (!subDayInput.value) return false;
    const [y, m, d] = subDayInput.value.split('-').map(Number);
    periodStart = new Date(y, m - 1, d);
    periodEnd = new Date(y, m - 1, d, 23, 59, 59);
  } else if (subState.dateType === 'month') {
    if (!subMonthInput.value) return false;
    const [y, m] = subMonthInput.value.split('-').map(Number);
    periodStart = new Date(y, m - 1, 1);
    periodEnd = new Date(y, m, 0, 23, 59, 59);
  } else if (subState.dateType === 'year') {
    if (!subYearInput.value) return false;
    const y = Number(subYearInput.value);
    periodStart = new Date(y, 0, 1);
    periodEnd = new Date(y, 11, 31, 23, 59, 59);
  } else {
    return true;
  }

  return start <= periodEnd && end >= periodStart;
}

function getFilteredSubscribers() {
  return allSubscribers.filter((sub) => {
    if (!inBranch(sub)) return false;
    if (!subBranchFilter.matches(sub)) return false;
    if (subState.statusFilter !== 'all' && sub.status !== subState.statusFilter) return false;
    if (subState.planFilter !== 'all' && sub.plan !== subState.planFilter) return false;
    if (!matchesAssignee(subState.mentorFilter, sub.mentorId)) return false;
    if (!matchesAssignee(subState.deFilter, sub.deliveryExecId)) return false;
    if (subState.subscriberId && sub.id !== subState.subscriberId) return false;
    if (subState.search && !matchesNameOrPhone(sub, subState.search)) return false;
    if (!matchesSubDateFilter(sub)) return false;
    return true;
  });
}

function formatShortDate(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatCurrency(amount) {
  if (amount === undefined || amount === null || amount === '') return '—';
  return '₹' + Number(amount).toLocaleString('en-IN');
}

const subStatusLabel = { active: 'Active', paused: 'Paused', cancelled: 'Cancelled' };
const subStatusBadgeClass = { active: 'badge-new', paused: 'badge-paused', cancelled: 'badge-closed' };

function renderSubscribersTable() {
  const tbody = document.getElementById('subscribers-tbody');
  const emptyState = document.getElementById('sub-empty-state');
  const filtered = getFilteredSubscribers();

  document.getElementById('sub-stat-shown').textContent = filtered.length;
  tbody.innerHTML = '';
  emptyState.hidden = filtered.length > 0;

  filtered.forEach((sub) => {
    const tr = document.createElement('tr');
    const status = sub.status || 'active';
    tr.innerHTML = `
      <td class="cell-name">${escapeHtml(sub.name || '—')}</td>
      <td>${escapeHtml(sub.phone || '—')}</td>
      <td>${escapeHtml(sub.branchName || '—')}</td>
      <td>${escapeHtml(sub.plan || '—')}</td>
      <td>${formatShortDate(sub.startDate)}</td>
      <td>${formatShortDate(sub.endDate)}</td>
      <td>${formatCurrency(sub.amount)}</td>
      <td><span class="badge ${subStatusBadgeClass[status] || 'badge-new'}">${subStatusLabel[status] || status}</span></td>
      <td>${escapeHtml(sub.mentorName || '—')}</td>
      <td>${escapeHtml(sub.deliveryExecName || '—')}</td>
    `;
    tr.addEventListener('click', () => openSubscriberDrawer(sub.id));
    tbody.appendChild(tr);
  });
}

// ---------- Subscriber drawer (add / edit) ----------
const subDrawer = document.getElementById('subscriber-drawer');
const subForm = document.getElementById('subscriber-form');
const subComputedEnd = document.getElementById('sub-computed-end');
let activeSubscriberId = null;

function toDateInputValue(ts) {
  const d = toDate(ts);
  if (!d) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function computeEndDate(startDateStr, durationMonths) {
  const [y, m, d] = startDateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(start);
  end.setMonth(end.getMonth() + Number(durationMonths));
  end.setDate(end.getDate() - 1);
  return end;
}

function updateComputedEndPreview() {
  const startVal = document.getElementById('sub-start-date').value;
  const duration = document.getElementById('sub-duration').value;
  if (!startVal) {
    subComputedEnd.textContent = '';
    return;
  }
  const end = computeEndDate(startVal, duration);
  subComputedEnd.textContent = 'Subscription ends: ' + end.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
document.getElementById('sub-start-date').addEventListener('input', updateComputedEndPreview);
document.getElementById('sub-duration').addEventListener('change', updateComputedEndPreview);

function populateAssigneeSelect(selectId, people, selectedId, detailKey) {
  const select = document.getElementById(selectId);
  select.innerHTML = '<option value="">Unassigned</option>';
  people.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name + (p[detailKey] ? ' — ' + p[detailKey] : '');
    opt.dataset.name = p.name || '';
    select.appendChild(opt);
  });
  select.value = selectedId || '';
}

// Returns the selected person's id and name, or nulls when unassigned.
function readAssigneeSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select.value) return { id: null, name: null };
  return { id: select.value, name: select.options[select.selectedIndex].dataset.name };
}

function openSubscriberDrawer(id) {
  activeSubscriberId = id || null;
  const sub = id ? allSubscribers.find((s) => s.id === id) : null;

  document.getElementById('sub-drawer-title').textContent = sub ? 'Edit Subscriber' : 'Add Subscriber';
  populateBranchSelect('sub-branch', sub?.branchId);
  document.getElementById('sub-name').value = sub?.name || '';
  document.getElementById('sub-phone').value = sub?.phone || '';
  document.getElementById('sub-email').value = sub?.email || '';
  document.getElementById('sub-plan').value = sub?.plan || 'Balanced';
  document.getElementById('sub-address').value = sub?.address || '';
  document.getElementById('sub-lat').value = sub?.location?.lat ?? '';
  document.getElementById('sub-lng').value = sub?.location?.lng ?? '';
  syncSubLocationPreview();
  document.getElementById('sub-start-date').value = sub ? toDateInputValue(sub.startDate) : '';
  document.getElementById('sub-duration').value = sub?.durationMonths || '1';
  document.getElementById('sub-amount').value = sub?.amount ?? '';
  document.getElementById('sub-status').value = sub?.status || 'active';
  populateSubAssignees(sub?.mentorId, sub?.deliveryExecId, true);
  document.getElementById('sub-notes').value = sub?.notes || '';
  document.getElementById('sub-save-status').textContent = '';
  updateComputedEndPreview();
  loadSubscriberConsultations(activeSubscriberId);

  subDrawer.hidden = false;
}

async function loadSubscriberConsultations(subId) {
  const section = document.getElementById('sub-consult-section');
  const list = document.getElementById('sub-consult-list');
  if (!subId) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = '<p class="assigned-empty">Loading…</p>';
  try {
    const snap = await getDocs(query(collection(db, 'consultations'), where('subscriberId', '==', subId)));
    if (activeSubscriberId !== subId) return;
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));
    const profileSource = findProfileSource(items);
    document.getElementById('sub-profile').innerHTML = profileSource
      ? profileHtml(profileSource.profile)
      : '<p class="assigned-empty">Not recorded yet — the mentor captures it during the first consultation.</p>';
    document.getElementById('sub-consult-count').textContent = items.length;
    list.innerHTML = items.length
      ? items.map((c) => consultationCardHtml(c, profileSource)).join('')
      : '<p class="assigned-empty">No consultations recorded yet.</p>';
  } catch (err) {
    list.innerHTML = `<p class="assigned-empty">Could not load consultations: ${escapeHtml(err.message)}</p>`;
  }
}

function consultationCardHtml(c, profileSource) {
  return `
    <div class="assigned-item consult-item">
      <div class="assigned-item-top">
        <strong>${formatShortDate(c.date)}${c.id === profileSource?.id ? ' · First consultation' : ''}</strong>
        <span class="assigned-item-meta">${escapeHtml(c.mentorName || '')}</span>
      </div>
      <div class="assigned-item-meta">${visitDetailsHtml(c, profileSource?.profile?.height)}</div>
    </div>`;
}

function closeSubscriberDrawer() {
  subDrawer.hidden = true;
  activeSubscriberId = null;
}

// Optional delivery coordinates: both or neither, within valid ranges.
// Returns { location } on success or { error }.
function readSubLocation() {
  const latVal = document.getElementById('sub-lat').value.trim();
  const lngVal = document.getElementById('sub-lng').value.trim();
  if (latVal === '' && lngVal === '') return { location: null };
  const lat = Number(latVal);
  const lng = Number(lngVal);
  if (latVal === '' || lngVal === '' || !Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { error: 'Enter both latitude (-90 to 90) and longitude (-180 to 180), or leave both empty.' };
  }
  return { location: { lat, lng } };
}

function syncSubLocationPreview() {
  const link = document.getElementById('sub-location-preview');
  const { location } = readSubLocation();
  link.hidden = !location;
  if (location) link.href = `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
}
['sub-lat', 'sub-lng'].forEach((id) => document.getElementById(id).addEventListener('input', syncSubLocationPreview));

document.getElementById('add-subscriber-btn').addEventListener('click', () => openSubscriberDrawer(null));
document.getElementById('sub-drawer-close').addEventListener('click', closeSubscriberDrawer);
document.getElementById('sub-drawer-backdrop').addEventListener('click', closeSubscriberDrawer);

subForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveStatus = document.getElementById('sub-save-status');
  const saveBtn = document.getElementById('sub-save-btn');

  const name = document.getElementById('sub-name').value.trim();
  const phone = document.getElementById('sub-phone').value.trim();
  const startDateVal = document.getElementById('sub-start-date').value;
  const durationMonths = Number(document.getElementById('sub-duration').value);

  if (!name || !phone || !startDateVal) {
    saveStatus.textContent = 'Name, phone and start date are required.';
    return;
  }
  const { location, error: locationError } = readSubLocation();
  if (locationError) {
    saveStatus.textContent = locationError;
    return;
  }

  const [startY, startM, startD] = startDateVal.split('-').map(Number);
  const startDate = new Date(startY, startM - 1, startD);
  const endDate = computeEndDate(startDateVal, durationMonths);

  const mentor = readAssigneeSelect('sub-mentor');
  const deliveryExec = readAssigneeSelect('sub-delivery-exec');

  const data = {
    name,
    phone,
    ...readBranch('sub-branch'),
    email: document.getElementById('sub-email').value.trim(),
    plan: document.getElementById('sub-plan').value,
    address: document.getElementById('sub-address').value.trim(),
    location,
    startDate,
    durationMonths,
    endDate,
    amount: document.getElementById('sub-amount').value ? Number(document.getElementById('sub-amount').value) : null,
    status: document.getElementById('sub-status').value,
    mentorId: mentor.id,
    mentorName: mentor.name,
    deliveryExecId: deliveryExec.id,
    deliveryExecName: deliveryExec.name,
    notes: document.getElementById('sub-notes').value.trim(),
    updatedAt: serverTimestamp(),
  };

  saveBtn.disabled = true;
  saveStatus.textContent = 'Saving…';
  try {
    if (activeSubscriberId) {
      await updateDoc(doc(db, 'subscribers', activeSubscriberId), data);
    } else {
      await addDoc(collection(db, 'subscribers'), { ...data, createdAt: serverTimestamp() });
    }
    saveStatus.textContent = 'Saved.';
  } catch (err) {
    saveStatus.textContent = 'Could not save: ' + err.message;
  } finally {
    saveBtn.disabled = false;
  }
});

// ============================================
// Delivery Executives
// ============================================
function startListeningDeliveryExecs() {
  const loadingState = document.getElementById('de-loading-state');
  const q = query(collection(db, 'deliveryExecutives'), orderBy('name', 'asc'));
  unsubscribeDeSnapshot = onSnapshot(q, (snapshot) => {
    allDeliveryExecs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadingState.hidden = true;
    renderDeStats();
    renderDeTable();
    renderBranchTable();
    refreshAssigneeFilters();
    renderSubscribersTable();
    renderReport();
    if (activeDeId && !deDrawer.hidden) {
      const de = allDeliveryExecs.find((x) => x.id === activeDeId);
      renderLogin('de', de);
      renderIdProof('de', de);
    }
  }, (err) => {
    loadingState.textContent = 'Could not load delivery executives: ' + err.message;
  });
}

function renderDeStats() {
  const execs = allDeliveryExecs.filter(inBranch);
  document.getElementById('de-stat-total').textContent = execs.length;
  document.getElementById('de-stat-active').textContent = execs.filter((d) => d.status !== 'inactive').length;
}

// ---------- Delivery executive filters ----------
const deState = {
  statusFilter: 'all',
  search: '',
  vehicleFilter: 'all',
};

document.querySelectorAll('[data-de-status-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-de-status-filter]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    deState.statusFilter = btn.dataset.deStatusFilter;
    renderDeTable();
  });
});

document.getElementById('de-search-input').addEventListener('input', (e) => {
  deState.search = e.target.value.trim().toLowerCase();
  renderDeTable();
});

document.getElementById('de-vehicle-filter').addEventListener('change', (e) => {
  deState.vehicleFilter = e.target.value;
  renderDeTable();
});

document.getElementById('de-clear-filters-btn').addEventListener('click', () => {
  deState.statusFilter = 'all';
  deState.search = '';
  deState.vehicleFilter = 'all';
  document.querySelectorAll('[data-de-status-filter]').forEach((b) => b.classList.toggle('active', b.dataset.deStatusFilter === 'all'));
  document.getElementById('de-search-input').value = '';
  document.getElementById('de-vehicle-filter').value = 'all';
  deBranchFilter.reset();
  renderDeTable();
});

function getFilteredDeliveryExecs() {
  return allDeliveryExecs.filter((de) => {
    if (!inBranch(de)) return false;
    if (!deBranchFilter.matches(de)) return false;
    const status = de.status || 'active';
    if (deState.statusFilter !== 'all' && status !== deState.statusFilter) return false;
    if (deState.vehicleFilter !== 'all' && de.vehicle !== deState.vehicleFilter) return false;
    if (deState.search) {
      const haystack = `${de.name || ''} ${de.phone || ''} ${de.area || ''}`.toLowerCase();
      if (!haystack.includes(deState.search)) return false;
    }
    return true;
  });
}

const deStatusLabel = { active: 'Active', inactive: 'Inactive' };
const deStatusBadgeClass = { active: 'badge-new', inactive: 'badge-closed' };

function renderDeTable() {
  const tbody = document.getElementById('de-tbody');
  const emptyState = document.getElementById('de-empty-state');
  if (!tbody || !emptyState) return;
  const filtered = getFilteredDeliveryExecs();

  document.getElementById('de-stat-shown').textContent = filtered.length;
  tbody.innerHTML = '';
  emptyState.hidden = filtered.length > 0;

  filtered.forEach((de) => {
    const tr = document.createElement('tr');
    const status = de.status || 'active';
    const subCount = allSubscribers.filter((s) => s.deliveryExecId === de.id).length;
    tr.innerHTML = `
      <td class="cell-name">${escapeHtml(de.name || '—')}</td>
      <td>${escapeHtml(de.phone || '—')}</td>
      <td>${escapeHtml(de.branchName || '—')}</td>
      <td>${escapeHtml(de.area || '—')}</td>
      <td>${escapeHtml(de.vehicle || '—')}</td>
      <td>${subCount}</td>
      <td><span class="badge ${deStatusBadgeClass[status] || 'badge-new'}">${deStatusLabel[status] || status}</span></td>
    `;
    tr.addEventListener('click', () => openDeDrawer(de.id));
    tbody.appendChild(tr);
  });
}

// ---------- Delivery executive drawer (add / edit) ----------
const deDrawer = document.getElementById('de-drawer');
const deForm = document.getElementById('de-form');
let activeDeId = null;

function openDeDrawer(id) {
  activeDeId = id || null;
  const de = id ? allDeliveryExecs.find((d) => d.id === id) : null;

  document.getElementById('de-drawer-title').textContent = de ? 'Edit Delivery Executive' : 'Add Delivery Executive';
  populateBranchSelect('de-branch', de?.branchId);
  document.getElementById('de-name').value = de?.name || '';
  document.getElementById('de-phone').value = de?.phone || '';
  document.getElementById('de-email').value = de?.email || '';
  document.getElementById('de-area').value = de?.area || '';
  document.getElementById('de-vehicle').value = de?.vehicle || 'Bike';
  document.getElementById('de-status').value = de?.status || 'active';
  document.getElementById('de-notes').value = de?.notes || '';
  document.getElementById('de-save-status').textContent = '';

  renderAssignedList('de', 'deliveryExecId', id, closeDeDrawer);
  renderLogin('de', de);
  renderIdProof('de', de);

  deDrawer.hidden = false;
}

// Lists the subscribers whose `field` (mentorId / deliveryExecId) points at
// ownerId, inside the `${prefix}-assigned-*` section of a drawer. Clicking one
// closes that drawer and opens the subscriber.
function renderAssignedList(prefix, field, ownerId, closeOwnerDrawer) {
  const section = document.getElementById(`${prefix}-assigned-section`);
  const list = document.getElementById(`${prefix}-assigned-list`);
  const countEl = document.getElementById(`${prefix}-assigned-count`);

  if (!ownerId) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const assigned = allSubscribers.filter((s) => s[field] === ownerId);
  countEl.textContent = assigned.length;
  list.innerHTML = '';

  if (assigned.length === 0) {
    list.innerHTML = '<p class="assigned-empty">No subscribers assigned yet.</p>';
    return;
  }

  assigned.forEach((sub) => {
    const status = sub.status || 'active';
    const item = document.createElement('div');
    item.className = 'assigned-item';
    item.innerHTML = `
      <div class="assigned-item-top">
        <strong>${escapeHtml(sub.name || 'Unnamed')}</strong>
        <span class="badge ${subStatusBadgeClass[status] || 'badge-new'}">${subStatusLabel[status] || status}</span>
      </div>
      <div class="assigned-item-meta">
        ${escapeHtml(sub.phone || '—')} · ${escapeHtml(sub.plan || '—')}<br>
        ${formatShortDate(sub.startDate)} – ${formatShortDate(sub.endDate)}
        ${sub.address ? '<br>' + escapeHtml(sub.address) : ''}
      </div>
    `;
    item.addEventListener('click', () => {
      closeOwnerDrawer();
      openSubscriberDrawer(sub.id);
    });
    list.appendChild(item);
  });
}

function closeDeDrawer() {
  deDrawer.hidden = true;
  activeDeId = null;
}

document.getElementById('add-de-btn').addEventListener('click', () => openDeDrawer(null));
document.getElementById('de-drawer-close').addEventListener('click', closeDeDrawer);
document.getElementById('de-drawer-backdrop').addEventListener('click', closeDeDrawer);

deForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveStatus = document.getElementById('de-save-status');
  const saveBtn = document.getElementById('de-save-btn');

  const name = document.getElementById('de-name').value.trim();
  const phone = document.getElementById('de-phone').value.trim();

  if (!name || !phone) {
    saveStatus.textContent = 'Name and phone are required.';
    return;
  }

  const data = {
    name,
    phone,
    ...readBranch('de-branch'),
    email: document.getElementById('de-email').value.trim(),
    area: document.getElementById('de-area').value.trim(),
    vehicle: document.getElementById('de-vehicle').value,
    status: document.getElementById('de-status').value,
    notes: document.getElementById('de-notes').value.trim(),
    updatedAt: serverTimestamp(),
  };

  saveBtn.disabled = true;
  saveStatus.textContent = 'Saving…';
  try {
    if (activeDeId) {
      await updateDoc(doc(db, 'deliveryExecutives', activeDeId), data);
    } else {
      await addDoc(collection(db, 'deliveryExecutives'), { ...data, createdAt: serverTimestamp() });
    }
    saveStatus.textContent = 'Saved.';
  } catch (err) {
    saveStatus.textContent = 'Could not save: ' + err.message;
  } finally {
    saveBtn.disabled = false;
  }
});

// ============================================
// Mentors
// ============================================
function startListeningMentors() {
  const loadingState = document.getElementById('mentor-loading-state');
  const q = query(collection(db, 'mentors'), orderBy('name', 'asc'));
  unsubscribeMentorSnapshot = onSnapshot(q, (snapshot) => {
    allMentors = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    loadingState.hidden = true;
    renderMentorStats();
    renderMentorTable();
    renderBranchTable();
    refreshAssigneeFilters();
    renderSubscribersTable();
    if (activeMentorId && !mentorDrawer.hidden) {
      const m = allMentors.find((x) => x.id === activeMentorId);
      renderMentorLogin(m);
      renderIdProof('mentor', m);
    }
  }, (err) => {
    loadingState.textContent = 'Could not load mentors: ' + err.message;
  });
}

function renderMentorStats() {
  const mentors = allMentors.filter(inBranch);
  document.getElementById('mentor-stat-total').textContent = mentors.length;
  document.getElementById('mentor-stat-active').textContent = mentors.filter((m) => m.status !== 'inactive').length;
}

// ---------- Mentor filters ----------
const mentorState = {
  statusFilter: 'all',
  search: '',
};

document.querySelectorAll('[data-mentor-status-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-mentor-status-filter]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    mentorState.statusFilter = btn.dataset.mentorStatusFilter;
    renderMentorTable();
  });
});

document.getElementById('mentor-search-input').addEventListener('input', (e) => {
  mentorState.search = e.target.value.trim().toLowerCase();
  renderMentorTable();
});

document.getElementById('mentor-clear-filters-btn').addEventListener('click', () => {
  mentorState.statusFilter = 'all';
  mentorState.search = '';
  document.querySelectorAll('[data-mentor-status-filter]').forEach((b) => b.classList.toggle('active', b.dataset.mentorStatusFilter === 'all'));
  document.getElementById('mentor-search-input').value = '';
  mentorBranchFilter.reset();
  renderMentorTable();
});

function getFilteredMentors() {
  return allMentors.filter((m) => {
    if (!inBranch(m)) return false;
    if (!mentorBranchFilter.matches(m)) return false;
    const status = m.status || 'active';
    if (mentorState.statusFilter !== 'all' && status !== mentorState.statusFilter) return false;
    if (mentorState.search) {
      const haystack = `${m.name || ''} ${m.phone || ''} ${m.specialization || ''}`.toLowerCase();
      if (!haystack.includes(mentorState.search)) return false;
    }
    return true;
  });
}

function renderMentorTable() {
  const tbody = document.getElementById('mentor-tbody');
  const emptyState = document.getElementById('mentor-empty-state');
  const filtered = getFilteredMentors();

  document.getElementById('mentor-stat-shown').textContent = filtered.length;
  tbody.innerHTML = '';
  emptyState.hidden = filtered.length > 0;

  filtered.forEach((m) => {
    const tr = document.createElement('tr');
    const status = m.status || 'active';
    const subCount = allSubscribers.filter((s) => s.mentorId === m.id).length;
    const experience = m.experience || m.experience === 0 ? `${m.experience} yrs` : '—';
    tr.innerHTML = `
      <td class="cell-name">${escapeHtml(m.name || '—')}</td>
      <td>${escapeHtml(m.phone || '—')}</td>
      <td>${escapeHtml(m.branchName || '—')}</td>
      <td>${escapeHtml(m.specialization || '—')}</td>
      <td>${experience}</td>
      <td>${subCount}</td>
      <td><span class="badge ${deStatusBadgeClass[status] || 'badge-new'}">${deStatusLabel[status] || status}</span></td>
    `;
    tr.addEventListener('click', () => openMentorDrawer(m.id));
    tbody.appendChild(tr);
  });
}

// ---------- Mentor drawer (add / edit) ----------
const mentorDrawer = document.getElementById('mentor-drawer');
const mentorForm = document.getElementById('mentor-form');
let activeMentorId = null;

function openMentorDrawer(id) {
  activeMentorId = id || null;
  const m = id ? allMentors.find((x) => x.id === id) : null;

  document.getElementById('mentor-drawer-title').textContent = m ? 'Edit Mentor' : 'Add Mentor';
  populateBranchSelect('mentor-branch', m?.branchId);
  document.getElementById('mentor-name').value = m?.name || '';
  document.getElementById('mentor-phone').value = m?.phone || '';
  document.getElementById('mentor-email').value = m?.email || '';
  document.getElementById('mentor-specialization').value = m?.specialization || '';
  document.getElementById('mentor-experience').value = m?.experience ?? '';
  document.getElementById('mentor-status').value = m?.status || 'active';
  document.getElementById('mentor-notes').value = m?.notes || '';
  document.getElementById('mentor-save-status').textContent = '';

  renderAssignedList('mentor', 'mentorId', id, closeMentorDrawer);
  renderMentorLogin(m);
  renderIdProof('mentor', m);

  mentorDrawer.hidden = false;
}

// ---------- Mentor & delivery executive logins ----------
// Mentors sign in on mentor.html and delivery executives on delivery.html,
// both with phone + PIN. Under the hood that is a Firebase Auth
// email/password account whose email is derived from the phone number (must
// match loginEmail in js/mentor.js / js/delivery.js).
function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

const loginKinds = {
  mentor: {
    who: 'mentor',
    page: 'mentor.html',
    email: (phone) => `m${normalizePhone(phone)}@poshana-mentor.local`,
    collection: 'mentors',
    loginsCollection: 'mentorLogins',
    idField: 'mentorId',
    active: () => allMentors.find((x) => x.id === activeMentorId),
  },
  de: {
    who: 'executive',
    page: 'delivery.html',
    email: (phone) => `d${normalizePhone(phone)}@poshana-delivery.local`,
    collection: 'deliveryExecutives',
    loginsCollection: 'deliveryLogins',
    idField: 'deliveryExecId',
    active: () => allDeliveryExecs.find((x) => x.id === activeDeId),
  },
};

function renderLogin(prefix, record) {
  const section = document.getElementById(`${prefix}-login-section`);
  const info = document.getElementById(`${prefix}-login-info`);
  const createBox = document.getElementById(`${prefix}-login-create`);
  const { who, page } = loginKinds[prefix];
  document.getElementById(`${prefix}-login-pin`).value = '';
  document.getElementById(`${prefix}-login-status`).textContent = '';

  if (!record) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const loginBtn = document.getElementById(`${prefix}-login-btn`);
  if (record.loginUid && normalizePhone(record.phone) !== record.loginPhone) {
    info.textContent = `The login still uses the old phone ${record.loginPhone}. Set a new PIN to move it to ${normalizePhone(record.phone)} — the old number will stop working.`;
    loginBtn.textContent = 'Move Login';
    createBox.hidden = false;
  } else if (record.loginUid) {
    info.textContent = `Login active — ${who} signs in at ${page} with phone ${record.loginPhone} and their PIN.`;
    createBox.hidden = true;
  } else {
    info.textContent = `No login yet. Set a PIN to let this ${who} sign in with their phone number.`;
    loginBtn.textContent = 'Create Login';
    createBox.hidden = false;
  }
}

function renderMentorLogin(m) {
  renderLogin('mentor', m);
}

// Creating a user with the client SDK signs that user in, so it's done on a
// throwaway secondary app to keep the admin's own session intact.
let secondaryAuth = null;
function getSecondaryAuth() {
  if (!secondaryAuth) {
    secondaryAuth = getAuth(initializeApp(firebaseConfig, 'mentor-login-creator'));
  }
  return secondaryAuth;
}

Object.entries(loginKinds).forEach(([prefix, kind]) => {
  document.getElementById(`${prefix}-login-btn`).addEventListener('click', async () => {
    const status = document.getElementById(`${prefix}-login-status`);
    const btn = document.getElementById(`${prefix}-login-btn`);
    const record = kind.active();
    const pin = document.getElementById(`${prefix}-login-pin`).value.trim();
    const phone = normalizePhone(record?.phone);

    if (!record) return;
    if (phone.length !== 10) {
      status.textContent = `Save a valid 10-digit phone number for this ${kind.who} first.`;
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      status.textContent = 'PIN must be exactly 6 digits.';
      return;
    }

    btn.disabled = true;
    status.textContent = 'Creating login…';
    const tempAuth = getSecondaryAuth();
    try {
      const cred = await createUserWithEmailAndPassword(tempAuth, kind.email(phone), pin);
      const uid = cred.user.uid;
      await signOut(tempAuth);
      await setDoc(doc(db, kind.loginsCollection, uid), { [kind.idField]: record.id, phone, createdAt: serverTimestamp() });
      // Moving to a new phone: the old auth account can't be deleted from the
      // browser, but without its login doc it can no longer see anything.
      if (record.loginUid && record.loginUid !== uid) await deleteDoc(doc(db, kind.loginsCollection, record.loginUid));
      await updateDoc(doc(db, kind.collection, record.id), { loginUid: uid, loginPhone: phone, updatedAt: serverTimestamp() });
      status.textContent = 'Login created.';
    } catch (err) {
      status.textContent = err.code === 'auth/email-already-in-use'
        ? 'A login already exists for this phone number.'
        : 'Could not create login: ' + err.message;
    } finally {
      btn.disabled = false;
    }
  });
});

// ---------- Mentor & delivery executive ID proofs ----------
// The file itself lives in idProofs/{collection}_{personId} as a data URL
// (admin-only, and kept out of the people listeners so they stay small);
// the person's record only carries idProof: { fileName, mimeType, uploadedAt }.
// Firestore documents max out at 1 MiB, so photos are shrunk to JPEG and
// PDFs must be under MAX_ID_PROOF_BYTES.
const MAX_ID_PROOF_BYTES = 700 * 1024;
const MAX_ID_PROOF_DATA_URL = 950 * 1024;

function idProofDocId(prefix, record) {
  return `${loginKinds[prefix].collection}_${record.id}`;
}

function renderIdProof(prefix, record) {
  const section = document.getElementById(`${prefix}-idproof-section`);
  document.getElementById(`${prefix}-idproof-status`).textContent = '';
  if (!record) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const proof = record.idProof;
  document.getElementById(`${prefix}-idproof-info`).textContent = proof
    ? `${proof.fileName} · uploaded ${formatShortDate(proof.uploadedAt)}`
    : 'No ID proof uploaded yet. Upload a photo or PDF of their Aadhaar, PAN, driving licence or similar.';
  document.getElementById(`${prefix}-idproof-view`).hidden = !proof;
  document.getElementById(`${prefix}-idproof-remove`).hidden = !proof;
  document.getElementById(`${prefix}-idproof-upload-label`).textContent = proof ? 'Replace' : 'Upload';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Re-encodes a photo as JPEG, shrinking dimensions / quality until it fits.
async function compressImage(file) {
  const img = new Image();
  img.src = await readFileAsDataUrl(file);
  await img.decode();
  let scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.55]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= MAX_ID_PROOF_DATA_URL) return dataUrl;
    }
    scale *= 0.75;
  }
  throw new Error('Image is too large even after compressing.');
}

Object.entries(loginKinds).forEach(([prefix, kind]) => {
  const status = () => document.getElementById(`${prefix}-idproof-status`);

  document.getElementById(`${prefix}-idproof-file`).addEventListener('change', async (e) => {
    const input = e.target;
    const file = input.files[0];
    input.value = '';
    const record = kind.active();
    if (!file || !record) return;

    let dataUrl;
    let mimeType = file.type;
    let fileName = file.name;
    try {
      if (file.type.startsWith('image/')) {
        status().textContent = 'Compressing…';
        dataUrl = await compressImage(file);
        mimeType = 'image/jpeg';
        fileName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      } else if (file.type === 'application/pdf') {
        if (file.size > MAX_ID_PROOF_BYTES) {
          status().textContent = 'PDF must be under 700 KB. Try a photo of the ID instead.';
          return;
        }
        dataUrl = await readFileAsDataUrl(file);
      } else {
        status().textContent = 'Please choose a photo or a PDF.';
        return;
      }
      status().textContent = 'Uploading…';
      await setDoc(doc(db, 'idProofs', idProofDocId(prefix, record)), {
        personId: record.id,
        collection: kind.collection,
        fileName,
        mimeType,
        dataUrl,
        uploadedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, kind.collection, record.id), {
        idProof: { fileName, mimeType, uploadedAt: serverTimestamp() },
        updatedAt: serverTimestamp(),
      });
      status().textContent = 'Uploaded.';
    } catch (err) {
      status().textContent = 'Could not upload: ' + err.message;
    }
  });

  // The tab is opened before the await so popup blockers allow it.
  document.getElementById(`${prefix}-idproof-view`).addEventListener('click', async () => {
    const record = kind.active();
    if (!record) return;
    const win = window.open('', '_blank');
    try {
      const snap = await getDoc(doc(db, 'idProofs', idProofDocId(prefix, record)));
      if (!snap.exists()) throw new Error('file not found');
      const blob = await (await fetch(snap.data().dataUrl)).blob();
      const url = URL.createObjectURL(blob);
      if (win) win.location = url;
      else window.location.assign(url);
    } catch (err) {
      if (win) win.close();
      status().textContent = 'Could not open: ' + err.message;
    }
  });

  document.getElementById(`${prefix}-idproof-remove`).addEventListener('click', async () => {
    const record = kind.active();
    if (!record || !confirm(`Remove ${record.name || 'this person'}'s ID proof?`)) return;
    try {
      await deleteDoc(doc(db, 'idProofs', idProofDocId(prefix, record)));
      await updateDoc(doc(db, kind.collection, record.id), { idProof: null, updatedAt: serverTimestamp() });
    } catch (err) {
      status().textContent = 'Could not remove: ' + err.message;
    }
  });
});

function closeMentorDrawer() {
  mentorDrawer.hidden = true;
  activeMentorId = null;
}

document.getElementById('add-mentor-btn').addEventListener('click', () => openMentorDrawer(null));
document.getElementById('mentor-drawer-close').addEventListener('click', closeMentorDrawer);
document.getElementById('mentor-drawer-backdrop').addEventListener('click', closeMentorDrawer);

mentorForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveStatus = document.getElementById('mentor-save-status');
  const saveBtn = document.getElementById('mentor-save-btn');

  const name = document.getElementById('mentor-name').value.trim();
  const phone = document.getElementById('mentor-phone').value.trim();

  if (!name || !phone) {
    saveStatus.textContent = 'Name and phone are required.';
    return;
  }

  const experienceVal = document.getElementById('mentor-experience').value;
  const data = {
    name,
    phone,
    ...readBranch('mentor-branch'),
    email: document.getElementById('mentor-email').value.trim(),
    specialization: document.getElementById('mentor-specialization').value.trim(),
    experience: experienceVal === '' ? null : Number(experienceVal),
    status: document.getElementById('mentor-status').value,
    notes: document.getElementById('mentor-notes').value.trim(),
    updatedAt: serverTimestamp(),
  };

  saveBtn.disabled = true;
  saveStatus.textContent = 'Saving…';
  try {
    if (activeMentorId) {
      await updateDoc(doc(db, 'mentors', activeMentorId), data);
    } else {
      await addDoc(collection(db, 'mentors'), { ...data, createdAt: serverTimestamp() });
    }
    saveStatus.textContent = 'Saved.';
  } catch (err) {
    saveStatus.textContent = 'Could not save: ' + err.message;
  } finally {
    saveBtn.disabled = false;
  }
});

// ============================================
// Branches tab
// ============================================
// Unlike the other tabs, this lists every branch regardless of the sidebar
// branch switcher. Records store a copy of their branch's name (branchName),
// so renaming a branch's city updates those copies too.
function renderBranchTable() {
  const tbody = document.getElementById('branch-tbody');
  document.getElementById('branch-stat-total').textContent = allBranches.length;
  document.getElementById('branch-empty-state').hidden = allBranches.length > 0;
  tbody.innerHTML = '';

  allBranches.forEach((b) => {
    const count = (list) => list.filter((x) => x.branchId === b.id).length;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="cell-name">${escapeHtml(branchLabel(b))}</td>
      <td>${escapeHtml(b.contactNumber || '—')}</td>
      <td>${escapeHtml(b.email || '—')}</td>
      <td><span class="badge ${b.status === 'Open' ? 'badge-new' : 'badge-paused'}">${escapeHtml(b.status || '—')}</span></td>
      <td>${count(allSubscribers)}</td>
      <td>${count(allMentors)}</td>
      <td>${count(allDeliveryExecs)}</td>
    `;
    tr.addEventListener('click', () => openBranchDrawer(b.id));
    tbody.appendChild(tr);
  });

  if (activeBranchId && !branchDrawer.hidden) renderBranchMembers(activeBranchId);
}

const branchDrawer = document.getElementById('branch-drawer');
const branchForm = document.getElementById('branch-form');
let activeBranchId = null;

function openBranchDrawer(id) {
  activeBranchId = id || null;
  const b = id ? allBranches.find((x) => x.id === id) : null;

  document.getElementById('branch-drawer-title').textContent = b ? `Edit ${branchLabel(b)}` : 'Add Branch';
  document.getElementById('branch-city').value = b?.city || '';
  document.getElementById('branch-contact').value = b?.contactNumber || '';
  document.getElementById('branch-email').value = b?.email || '';
  document.getElementById('branch-status').value = b?.status === 'Open' ? 'Open' : 'Coming Soon';
  document.getElementById('branch-lat').value = b?.location?.lat ?? '';
  document.getElementById('branch-lng').value = b?.location?.lng ?? '';
  document.getElementById('branch-save-status').textContent = '';

  renderBranchMembers(id);
  branchDrawer.hidden = false;
}

function closeBranchDrawer() {
  branchDrawer.hidden = true;
  activeBranchId = null;
}

document.getElementById('add-branch-btn').addEventListener('click', () => openBranchDrawer(null));
document.getElementById('branch-drawer-close').addEventListener('click', closeBranchDrawer);
document.getElementById('branch-drawer-backdrop').addEventListener('click', closeBranchDrawer);

// Lists a branch's subscribers, mentors and delivery executives; clicking one
// closes this drawer and opens that record's own drawer.
function renderBranchMembers(branchId) {
  const section = document.getElementById('branch-members');
  if (!branchId) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const groups = [
    { prefix: 'sub', list: allSubscribers, meta: (s) => [s.phone, s.plan, s.status], open: openSubscriberDrawer },
    { prefix: 'mentor', list: allMentors, meta: (m) => [m.phone, m.specialization, m.status], open: openMentorDrawer },
    { prefix: 'de', list: allDeliveryExecs, meta: (d) => [d.phone, d.area, d.vehicle, d.status], open: openDeDrawer },
  ];
  groups.forEach(({ prefix, list, meta, open }) => {
    const members = list.filter((x) => x.branchId === branchId);
    document.getElementById(`branch-${prefix}-count`).textContent = members.length;
    const box = document.getElementById(`branch-${prefix}-list`);
    box.innerHTML = members.length ? '' : '<p class="assigned-empty">None yet.</p>';
    members.forEach((rec) => {
      const item = document.createElement('div');
      item.className = 'assigned-item';
      item.innerHTML = `
        <div class="assigned-item-top"><strong>${escapeHtml(rec.name || 'Unnamed')}</strong></div>
        <div class="assigned-item-meta">${escapeHtml(meta(rec).filter(Boolean).join(' · ') || '—')}</div>
      `;
      item.addEventListener('click', () => {
        closeBranchDrawer();
        open(rec.id);
      });
      box.appendChild(item);
    });
  });
}

branchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveStatus = document.getElementById('branch-save-status');
  const saveBtn = document.getElementById('branch-save-btn');
  const city = document.getElementById('branch-city').value.trim();
  const contactNumber = document.getElementById('branch-contact').value.trim();
  if (!city || !contactNumber) {
    saveStatus.textContent = 'City and contact number are required.';
    return;
  }
  const duplicate = allBranches.find((b) => b.id !== activeBranchId && branchLabel(b).toLowerCase() === city.toLowerCase());
  if (duplicate) {
    saveStatus.textContent = `A ${city} branch already exists.`;
    return;
  }

  const latVal = document.getElementById('branch-lat').value;
  const lngVal = document.getElementById('branch-lng').value;
  const data = {
    city,
    contactNumber,
    email: document.getElementById('branch-email').value.trim(),
    status: document.getElementById('branch-status').value,
    location: latVal !== '' && lngVal !== '' ? { lat: Number(latVal), lng: Number(lngVal) } : null,
    updatedAt: serverTimestamp(),
  };

  saveBtn.disabled = true;
  saveStatus.textContent = 'Saving…';
  try {
    if (activeBranchId) {
      const previousName = branchLabel(allBranches.find((b) => b.id === activeBranchId) || {});
      await updateDoc(doc(db, 'branches', activeBranchId), data);
      if (previousName !== city) {
        const renamed = [...allSubscribers, ...allMentors, ...allDeliveryExecs]
          .filter((r) => r.branchId === activeBranchId);
        const collectionOf = (r) => (allSubscribers.includes(r) ? 'subscribers' : allMentors.includes(r) ? 'mentors' : 'deliveryExecutives');
        await Promise.all(renamed.map((r) => updateDoc(doc(db, collectionOf(r), r.id), { branchName: city })));
      }
    } else {
      const ref = await addDoc(collection(db, 'branches'), { ...data, createdAt: serverTimestamp() });
      activeBranchId = ref.id;
      document.getElementById('branch-drawer-title').textContent = `Edit ${city}`;
      renderBranchMembers(ref.id);
    }
    saveStatus.textContent = 'Saved.';
  } catch (err) {
    saveStatus.textContent = 'Could not save: ' + err.message;
  } finally {
    saveBtn.disabled = false;
  }
});

// ============================================
// Delivery reports
// ============================================
// Delivery executives tick meals in delivery.html, stored as
// deliveries/{subscriberId}_{YYYY-MM-DD} with breakfast / lunch / dinner
// fields set to { by, byName, at } (or null). A meal is "due" on every
// Monday–Saturday inside the subscription window, up to today.
const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];

function parseDateInput(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(value, n) {
  const d = parseDateInput(value);
  d.setDate(d.getDate() + n);
  return toDateInputValue(d);
}

function isSundayValue(value) {
  return parseDateInput(value).getDay() === 0;
}

// Every 'YYYY-MM-DD' from `from` to `to`, inclusive.
function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function formatMealTime(ts) {
  const d = toDate(ts);
  return d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
}

// The period is picked like the other tabs' date filters (all time / day /
// month / year), plus a custom from–to range; it resolves to [from, to].
const reportState = { from: '', to: '', search: '', subscriberId: null, execFilter: 'all' };
let reportDeliveries = []; // delivery docs in [from, to]
let unsubscribeReportSnapshot = null;
let reportListenedRange = '';
let reportTabOpened = false; // deliveries are only loaded once the tab is used

const reportPeriodType = document.getElementById('report-period-type');
const reportDayInput = document.getElementById('report-day');
const reportMonthInput = document.getElementById('report-month');
const reportYearInput = document.getElementById('report-year');
const reportRangeInputs = document.getElementById('report-range-inputs');
const reportFromInput = document.getElementById('report-from');
const reportToInput = document.getElementById('report-to');

// "All time" spans every delivery that could have been recorded; due meals
// are still only counted up to today.
const REPORT_EPOCH = '2020-01-01';
const REPORT_END = '2100-12-31';

function resolveReportPeriod() {
  const today = toDateInputValue(new Date());
  switch (reportPeriodType.value) {
    case 'all':
      return [REPORT_EPOCH, REPORT_END];
    case 'day':
      return [reportDayInput.value, reportDayInput.value];
    case 'month': {
      if (!reportMonthInput.value) return ['', ''];
      const [y, m] = reportMonthInput.value.split('-').map(Number);
      return [toDateInputValue(new Date(y, m - 1, 1)), toDateInputValue(new Date(y, m, 0))];
    }
    case 'year': {
      const y = Number(reportYearInput.value);
      return y >= 2000 && y <= 2100 ? [`${y}-01-01`, `${y}-12-31`] : ['', ''];
    }
    default:
      return [reportFromInput.value, reportToInput.value];
  }
}

function reportPeriodLabel() {
  const { from, to } = reportState;
  const type = reportPeriodType.value;
  if (type === 'all') return 'All time';
  if (type === 'month' && from) return parseDateInput(from).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  if (type === 'year' && from) return from.slice(0, 4);
  if (from && from === to) return formatShortDate(parseDateInput(from));
  return from && to ? `${formatShortDate(parseDateInput(from))} – ${formatShortDate(parseDateInput(to))}` : '—';
}

function applyReportPeriod() {
  [reportState.from, reportState.to] = resolveReportPeriod();
  if (reportTabOpened) ensureReportListener();
  renderReport();
}

// Shows the input for the chosen period type, defaulting it to the current
// day / month / year (the same behaviour as the other date filters).
function syncReportPeriodInputs() {
  const type = reportPeriodType.value;
  reportDayInput.hidden = type !== 'day';
  reportMonthInput.hidden = type !== 'month';
  reportYearInput.hidden = type !== 'year';
  reportRangeInputs.hidden = type !== 'range';

  const { y, m, d } = todayParts();
  if (type === 'day' && !reportDayInput.value) reportDayInput.value = `${y}-${m}-${d}`;
  if (type === 'month' && !reportMonthInput.value) reportMonthInput.value = `${y}-${m}`;
  if (type === 'year' && !reportYearInput.value) reportYearInput.value = `${y}`;
  if (type === 'range') {
    if (!reportFromInput.value) reportFromInput.value = `${y}-${m}-01`;
    if (!reportToInput.value) reportToInput.value = `${y}-${m}-${d}`;
  }
}

reportPeriodType.addEventListener('change', () => {
  syncReportPeriodInputs();
  applyReportPeriod();
});
[reportDayInput, reportMonthInput, reportYearInput, reportFromInput, reportToInput].forEach((input) => {
  input.addEventListener('input', applyReportPeriod);
});
// Typing narrows the report to matching names / phones and lists them;
// picking one shows just that subscriber.
createTypeahead({
  input: document.getElementById('report-search'),
  list: document.getElementById('report-search-suggestions'),
  suggest: (q) => suggestSubscribers(q),
  emptyText: 'No matching subscriber',
  onType: (q) => {
    reportState.search = q;
    reportState.subscriberId = null;
    renderReport();
  },
  onPick: (item) => {
    reportState.search = '';
    reportState.subscriberId = item.id;
    renderReport();
  },
});
document.getElementById('report-exec-filter').addEventListener('change', (e) => {
  reportState.execFilter = e.target.value;
  renderReport();
});

syncReportPeriodInputs();
[reportState.from, reportState.to] = resolveReportPeriod();

// Listens to the deliveries of the selected range; started the first time
// the Reports tab is opened, and re-pointed when the range changes.
function ensureReportListener() {
  reportTabOpened = true;
  const { from, to } = reportState;
  const key = `${from}|${to}`;
  if (unsubscribeReportSnapshot && reportListenedRange === key) return;
  stopReportListener();
  if (!from || !to || from > to) {
    renderReport();
    return;
  }
  reportListenedRange = key;
  const loading = document.getElementById('report-loading-state');
  loading.hidden = false;
  loading.textContent = 'Loading deliveries…';
  unsubscribeReportSnapshot = onSnapshot(
    query(collection(db, 'deliveries'), where('date', '>=', from), where('date', '<=', to)),
    (snap) => {
      reportDeliveries = snap.docs.map((d) => d.data());
      loading.hidden = true;
      renderReport();
    },
    (err) => { loading.textContent = 'Could not load deliveries: ' + err.message; },
  );
}

function stopReportListener() {
  if (unsubscribeReportSnapshot) unsubscribeReportSnapshot();
  unsubscribeReportSnapshot = null;
  reportListenedRange = '';
  reportDeliveries = [];
}

function populateReportExecFilter() {
  const select = document.getElementById('report-exec-filter');
  const execs = allDeliveryExecs.filter(inBranch);
  select.innerHTML = '';
  [['all', 'All Executives'], ['unassigned', 'Unassigned'], ...execs.map((d) => [d.id, d.name])].forEach(([value, label]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  });
  if (!['all', 'unassigned'].includes(reportState.execFilter) && !execs.some((d) => d.id === reportState.execFilter)) reportState.execFilter = 'all';
  select.value = reportState.execFilter;
}

// Map of subscriberId -> Map of date -> delivery doc.
function deliveriesBySubscriber() {
  const bySub = new Map();
  reportDeliveries.forEach((rec) => {
    if (!bySub.has(rec.subscriberId)) bySub.set(rec.subscriberId, new Map());
    bySub.get(rec.subscriberId).set(rec.date, rec);
  });
  return bySub;
}

// The due dates of a subscriber inside [from, to]: Monday–Saturday within
// the subscription window, never after today.
function dueDates(sub, from, to) {
  const start = toDate(sub.startDate);
  if (!start) return [];
  const end = toDate(sub.endDate) || start;
  const today = toDateInputValue(new Date());
  const first = [from, toDateInputValue(start)].sort()[1];
  const last = [to, toDateInputValue(end), today].sort()[0];
  return first > last ? [] : datesBetween(first, last).filter((d) => !isSundayValue(d));
}

function buildReportRow(sub, days) {
  const { from, to } = reportState;
  const counts = { breakfast: 0, lunch: 0, dinner: 0 };
  let lastDelivery = '';
  days.forEach((rec, date) => {
    MEALS.forEach(([meal]) => {
      if (!rec[meal]) return;
      counts[meal] += 1;
      if (date > lastDelivery) lastDelivery = date;
    });
  });
  // Today's unticked meals are still pending rather than missed.
  const today = toDateInputValue(new Date());
  const due = dueDates(sub, from, to);
  const unticked = (d) => MEALS.filter(([meal]) => !days.get(d)?.[meal]).length;
  const missed = due.filter((d) => d < today).reduce((n, d) => n + unticked(d), 0);
  const pending = due.includes(today) ? unticked(today) : 0;
  const delivered = counts.breakfast + counts.lunch + counts.dinner;
  return { sub, counts, delivered, daysDue: due.length, expected: due.length * MEALS.length, missed, pending, lastDelivery };
}

function getReportRows() {
  const { from, to, search, execFilter, subscriberId } = reportState;
  if (!from || !to || from > to) return [];
  const bySub = deliveriesBySubscriber();
  return allSubscribers
    .filter(inBranch)
    .filter((s) => matchesAssignee(execFilter, s.deliveryExecId))
    .filter((s) => (subscriberId ? s.id === subscriberId : !search || matchesNameOrPhone(s, search)))
    .map((s) => buildReportRow(s, bySub.get(s.id) || new Map()))
    .filter((r) => r.daysDue > 0 || r.delivered > 0)
    .sort((a, b) => (a.sub.name || '').localeCompare(b.sub.name || ''));
}

// Share of due meals delivered, leaving out today's still-pending ones.
function deliveryRate({ expected, missed, pending }) {
  const settled = expected - pending;
  return settled ? Math.round(((settled - missed) / settled) * 100) + '%' : '—';
}

function renderReport() {
  populateReportExecFilter();
  const rows = getReportRows();
  const total = (key) => rows.reduce((n, r) => n + r[key], 0);
  const totals = { expected: total('expected'), missed: total('missed'), pending: total('pending') };
  document.getElementById('report-stat-subs').textContent = rows.length;
  document.getElementById('report-stat-delivered').textContent = total('delivered');
  document.getElementById('report-stat-expected').textContent = totals.expected;
  document.getElementById('report-stat-missed').textContent = totals.missed;
  document.getElementById('report-stat-rate').textContent = deliveryRate(totals);

  const tbody = document.getElementById('report-tbody');
  tbody.innerHTML = '';
  const loading = document.getElementById('report-loading-state');
  document.getElementById('report-empty-state').hidden = rows.length > 0 || !loading.hidden;
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="cell-name">${escapeHtml(r.sub.name || '—')}</td>
      <td>${escapeHtml(r.sub.branchName || '—')}</td>
      <td>${escapeHtml(r.sub.plan || '—')}</td>
      <td>${escapeHtml(r.sub.deliveryExecName || '—')}</td>
      <td>${r.daysDue}</td>
      <td>${r.counts.breakfast}</td>
      <td>${r.counts.lunch}</td>
      <td>${r.counts.dinner}</td>
      <td><strong>${r.delivered}</strong> / ${r.expected}</td>
      <td class="${r.missed ? 'report-missed' : ''}">${r.missed}</td>
      <td>${r.lastDelivery ? formatShortDate(parseDateInput(r.lastDelivery)) : '—'}</td>
    `;
    tr.addEventListener('click', () => openReportDrawer(r.sub.id));
    tbody.appendChild(tr);
  });

  if (activeReportSubId && !reportDrawer.hidden) renderReportDrawer();
}

// ---------- CSV ----------
function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById('report-csv-btn').addEventListener('click', () => {
  const rows = getReportRows();
  downloadCsv(`poshana-deliveries-${reportState.from}-to-${reportState.to}.csv`, [
    ['Name', 'Phone', 'Branch', 'Plan', 'Executive', 'Days due', 'Breakfast', 'Lunch', 'Dinner', 'Delivered', 'Expected', 'Missed', 'Delivery rate', 'Last delivery'],
    ...rows.map((r) => [
      r.sub.name, r.sub.phone, r.sub.branchName, r.sub.plan, r.sub.deliveryExecName, r.daysDue,
      r.counts.breakfast, r.counts.lunch, r.counts.dinner, r.delivered, r.expected, r.missed,
      deliveryRate(r), r.lastDelivery,
    ]),
  ]);
});

// ---------- Report drawer (one subscriber, day by day) ----------
const reportDrawer = document.getElementById('report-drawer');
let activeReportSubId = null;

function openReportDrawer(id) {
  activeReportSubId = id;
  renderReportDrawer();
  reportDrawer.hidden = false;
}

function closeReportDrawer() {
  reportDrawer.hidden = true;
  activeReportSubId = null;
}

document.getElementById('report-drawer-close').addEventListener('click', closeReportDrawer);
document.getElementById('report-drawer-backdrop').addEventListener('click', closeReportDrawer);
document.getElementById('report-drawer-open-sub').addEventListener('click', () => {
  const id = activeReportSubId;
  closeReportDrawer();
  openSubscriberDrawer(id);
});

// Days shown for one subscriber: the subscription days inside the range
// (Sundays included, marked as off) plus any day with a delivery recorded.
function reportDays(sub, days) {
  const { from, to } = reportState;
  const start = toDate(sub.startDate);
  const end = toDate(sub.endDate) || start;
  const set = new Set(days.keys());
  if (start) {
    const first = [from, toDateInputValue(start)].sort()[1];
    const last = [to, toDateInputValue(end)].sort()[0];
    if (first <= last) datesBetween(first, last).forEach((d) => set.add(d));
  }
  return Array.from(set).sort();
}

function renderReportDrawer() {
  const sub = allSubscribers.find((s) => s.id === activeReportSubId);
  if (!sub) {
    closeReportDrawer();
    return;
  }
  const days = deliveriesBySubscriber().get(sub.id) || new Map();
  const row = buildReportRow(sub, days);
  const today = toDateInputValue(new Date());

  document.getElementById('report-drawer-title').textContent = sub.name || 'Unnamed';
  document.getElementById('report-drawer-period').textContent =
    `${reportPeriodLabel()} · ${sub.plan || '—'} · ${sub.deliveryExecName || 'No executive'}`;
  document.getElementById('report-drawer-summary').innerHTML = [
    ['Delivered', `${row.delivered} / ${row.expected}`],
    ['Missed', row.missed],
    ['Rate', deliveryRate(row)],
    ['Breakfast', row.counts.breakfast],
    ['Lunch', row.counts.lunch],
    ['Dinner', row.counts.dinner],
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');

  const tbody = document.getElementById('report-days-tbody');
  const dates = reportDays(sub, days);
  tbody.innerHTML = dates.length ? '' : '<tr><td colspan="4" class="assigned-empty">No subscription days in this period.</td></tr>';
  dates.forEach((date) => {
    const rec = days.get(date) || {};
    const label = parseDateInput(date).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
    const tr = document.createElement('tr');
    if (isSundayValue(date) && !MEALS.some(([meal]) => rec[meal])) {
      tr.innerHTML = `<td>${label}</td><td colspan="3" class="report-off">Sunday — no delivery</td>`;
    } else {
      tr.innerHTML = `<td>${label}</td>` + MEALS.map(([meal]) => {
        const done = rec[meal];
        if (done) return `<td class="report-done">✓ ${escapeHtml(formatMealTime(done.at))}<br><small>${escapeHtml(done.byName || '')}</small></td>`;
        if (date > today) return '<td class="report-off">—</td>';
        return date === today ? '<td class="report-off">Pending</td>' : '<td class="report-missed">✗ Missed</td>';
      }).join('');
    }
    tbody.appendChild(tr);
  });
}

document.getElementById('report-drawer-csv-btn').addEventListener('click', () => {
  const sub = allSubscribers.find((s) => s.id === activeReportSubId);
  if (!sub) return;
  const days = deliveriesBySubscriber().get(sub.id) || new Map();
  const today = toDateInputValue(new Date());
  const header = ['Date', 'Day'];
  MEALS.forEach(([, label]) => header.push(label, `${label} by`, `${label} time`));
  const rows = reportDays(sub, days).map((date) => {
    const rec = days.get(date) || {};
    const out = [date, parseDateInput(date).toLocaleDateString('en-IN', { weekday: 'short' })];
    MEALS.forEach(([meal]) => {
      const done = rec[meal];
      const status = done ? 'Delivered' : isSundayValue(date) ? 'Sunday' : date > today ? '' : date === today ? 'Pending' : 'Missed';
      out.push(status, done?.byName || '', done ? formatMealTime(done.at) : '');
    });
    return out;
  });
  const safeName = (sub.name || 'subscriber').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  downloadCsv(`poshana-deliveries-${safeName}-${reportState.from}-to-${reportState.to}.csv`, [header, ...rows]);
});
