// ============================================
// Poshaná delivery executive portal.
//
// Executives sign in with phone + PIN, which maps to a Firebase Auth
// email/password account created by the admin (see loginKinds in
// js/admin.js). They see every subscriber in their own branch (their own
// ones first, via the filter), and nothing from other branches. Firestore
// rules only allow the query filtered on their branchId.
//
// Deliveries are tracked per subscriber per day in deliveries/{subId}_{date},
// with a breakfast / lunch / dinner field each set to who delivered it (or
// null). Any executive in the branch can tick them, so they can cover for
// each other. There are no deliveries on Sundays.
// ============================================
import { createTypeahead } from './typeahead.js';

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
  getFirestore, collection, query, where, onSnapshot, doc, getDoc, setDoc, serverTimestamp,
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
let deliveries = new Map(); // subscriberId -> delivery doc for state.date
let unsubscribers = [];
let unsubscribeDeliveries = null;

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
  if (unsubscribeDeliveries) unsubscribeDeliveries();
  unsubscribeDeliveries = null;
  deliveries = new Map();
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
  listenDeliveries();
}

// Re-subscribes to the delivery docs of the selected date.
function listenDeliveries() {
  if (unsubscribeDeliveries) unsubscribeDeliveries();
  unsubscribeDeliveries = null;
  deliveries = new Map();
  if (!exec?.branchId || !state.date) {
    render();
    return;
  }
  const date = state.date;
  unsubscribeDeliveries = onSnapshot(
    query(collection(db, 'deliveries'), where('branchId', '==', exec.branchId), where('date', '==', date)),
    (snap) => {
      if (date !== state.date) return;
      deliveries = new Map(snap.docs.map((d) => [d.data().subscriberId, d.data()]));
      render();
    },
    (err) => { document.getElementById('date-note').textContent = 'Could not load deliveries: ' + err.message; },
  );
  render();
}

// ---------- Helpers ----------
function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function parseYmd(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isSunday(value) {
  return parseYmd(value).getDay() === 0;
}

// Meals can only be ticked on or after the day they are due.
function isFuture(value) {
  return value > ymd(new Date());
}

// Whether the subscription window [startDate, endDate] includes the date.
function coversDate(sub, value) {
  const start = toDate(sub.startDate);
  if (!start) return false;
  const end = toDate(sub.endDate) || start;
  return ymd(start) <= value && value <= ymd(end);
}

// Meals are delivered on the selected date only to active subscribers whose
// subscription covers it, and never on Sundays.
function isDeliverable(sub) {
  return !!state.date && !isSunday(state.date) && (sub.status || 'active') === 'active' && coversDate(sub, state.date);
}

const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];

async function toggleMeal(sub, meal, checked, input) {
  if (isFuture(state.date)) {
    input.checked = !checked;
    return;
  }
  input.disabled = true;
  try {
    await setDoc(doc(db, 'deliveries', `${sub.id}_${state.date}`), {
      subscriberId: sub.id,
      subscriberName: sub.name || '',
      branchId: exec.branchId,
      date: state.date,
      [meal]: checked ? { by: exec.id, byName: exec.name || '', at: serverTimestamp() } : null,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    input.checked = !checked;
    alert('Could not save: ' + err.message);
  } finally {
    input.disabled = false;
  }
}

function formatTime(ts) {
  const d = toDate(ts);
  return d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
}
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

// Exact coordinates when the admin saved them, otherwise the address text.
function mapsUrl(sub) {
  const query = sub.location ? `${sub.location.lat},${sub.location.lng}` : sub.address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
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
// date: 'YYYY-MM-DD' (defaults to today); empty shows every subscriber.
// subscriberId: set when a subscriber is picked from the search suggestions.
const state = { status: 'all', execFilter: 'mine', search: '', subscriberId: null, date: ymd(new Date()) };

const dateInput = document.getElementById('date-filter');
dateInput.value = state.date;

function setDate(value) {
  state.date = value;
  dateInput.value = value;
  if (exec) listenDeliveries();
}

dateInput.addEventListener('change', () => setDate(dateInput.value));
document.getElementById('date-today').addEventListener('click', () => setDate(ymd(new Date())));
[['date-prev', -1], ['date-next', 1]].forEach(([id, step]) => {
  document.getElementById(id).addEventListener('click', () => {
    const d = state.date ? parseYmd(state.date) : new Date();
    d.setDate(d.getDate() + step);
    setDate(ymd(d));
  });
});

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

function matchesSearch(sub, query) {
  return `${sub.name || ''} ${sub.phone || ''} ${sub.address || ''}`.toLowerCase().includes(query);
}

// Typing narrows the list and suggests matching subscribers (among those
// the other filters show); picking one shows just that subscriber.
createTypeahead({
  input: document.getElementById('search-input'),
  list: document.getElementById('search-suggestions'),
  suggest: (q) => filteredSubs({ ignoreSearch: true })
    .filter((s) => matchesSearch(s, q))
    .slice(0, 8)
    .map((s) => ({ id: s.id, label: s.name || 'Unnamed', meta: [s.phone, s.address].filter(Boolean).join(' · ') })),
  emptyText: 'No matching subscriber',
  onType: (q) => {
    state.search = q;
    state.subscriberId = null;
    renderTable();
  },
  onPick: (item) => {
    state.search = '';
    state.subscriberId = item.id;
    renderTable();
  },
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

function filteredSubs({ ignoreSearch = false } = {}) {
  return subs.filter((s) => {
    if (state.date && !coversDate(s, state.date)) return false;
    if (state.status !== 'all' && (s.status || 'active') !== state.status) return false;
    if (!matchesExecFilter(s)) return false;
    if (ignoreSearch) return true;
    if (state.subscriberId && s.id !== state.subscriberId) return false;
    if (state.search && !matchesSearch(s, state.search)) return false;
    return true;
  });
}

function renderTable() {
  const tbody = document.getElementById('subs-tbody');
  const filtered = filteredSubs();

  const showMeals = !!state.date && !isSunday(state.date);
  document.querySelectorAll('.meal-col').forEach((th) => { th.hidden = !showMeals; });
  const future = !!state.date && isFuture(state.date);
  const note = document.getElementById('date-note');
  note.hidden = !state.date || (!isSunday(state.date) && !future);
  note.textContent = isSunday(state.date || ymd(new Date()))
    ? 'Sunday — no deliveries (cheat day).'
    : 'Upcoming day — meals can be marked delivered on the day itself.';

  const deliverable = filtered.filter(isDeliverable);
  const delivered = deliverable.reduce((n, s) => n + MEALS.filter(([meal]) => deliveries.get(s.id)?.[meal]).length, 0);
  document.getElementById('stat-delivered-box').hidden = !showMeals;
  document.getElementById('stat-delivered').textContent = `${delivered}/${deliverable.length * MEALS.length}`;

  document.getElementById('stat-shown').textContent = filtered.length;
  tbody.innerHTML = '';
  document.getElementById('empty-state').hidden = filtered.length > 0 || !document.getElementById('loading-state').hidden;

  filtered.forEach((s) => {
    const status = s.status || 'active';
    const record = deliveries.get(s.id) || {};
    const mealCells = !showMeals ? '' : MEALS.map(([meal, label]) => {
      if (!isDeliverable(s)) return '<td class="meal-cell">—</td>';
      const done = record[meal];
      const title = done ? `${label} delivered by ${done.byName || 'an executive'}${done.at ? ' at ' + formatTime(done.at) : ''}`
        : future ? 'Can be marked on the day' : `Mark ${label.toLowerCase()} delivered`;
      return `<td class="meal-cell"><label class="meal-check" title="${escapeHtml(title)}"><input type="checkbox" data-meal="${meal}" aria-label="${label}"${done ? ' checked' : ''}${future ? ' disabled' : ''}></label></td>`;
    }).join('');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="cell-name">${escapeHtml(s.name || '—')}</td>
      ${mealCells}
      <td>${s.phone ? `<a class="cell-call" href="tel:+91${escapeHtml(normalizePhone(s.phone))}">📞 ${escapeHtml(s.phone)}</a>` : '—'}</td>
      <td>${escapeHtml(s.address || '—')}</td>
      <td>${escapeHtml(s.plan || '—')}</td>
      <td><span class="badge ${statusBadgeClass[status] || 'badge-new'}">${statusLabel[status] || status}</span></td>
      <td>${escapeHtml(execLabel(s))}</td>
    `;
    tr.querySelector('.cell-call')?.addEventListener('click', (e) => e.stopPropagation());
    tr.querySelectorAll('.meal-check').forEach((label) => label.addEventListener('click', (e) => e.stopPropagation()));
    tr.querySelectorAll('.meal-check input').forEach((input) => {
      input.addEventListener('change', () => toggleMeal(s, input.dataset.meal, input.checked, input));
    });
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
  mapBtn.hidden = !s.address && !s.location;
  mapBtn.href = s.address || s.location ? mapsUrl(s) : '#';
  mapBtn.textContent = s.location ? '📍 Open exact location in Maps' : '📍 Open address in Maps';
  document.getElementById('sub-location').textContent = s.location
    ? `${s.location.lat}, ${s.location.lng}`
    : 'Not saved — map uses the address';

  document.getElementById('sub-phone').textContent = s.phone || '—';
  document.getElementById('sub-address').textContent = s.address || '—';
  document.getElementById('sub-branch').textContent = s.branchName || '—';
  document.getElementById('sub-plan').textContent = s.plan || '—';
  document.getElementById('sub-dates').textContent = `${formatShortDate(s.startDate)} – ${formatShortDate(s.endDate)}`;
  document.getElementById('sub-exec').textContent = execLabel(s);

  const section = document.getElementById('sub-delivery-section');
  section.hidden = !state.date;
  if (!state.date) return;
  document.getElementById('sub-delivery-date').textContent = formatShortDate(parseYmd(state.date));
  const list = document.getElementById('sub-delivery-list');
  if (isSunday(state.date)) {
    list.innerHTML = '<p class="assigned-empty">No deliveries on Sunday.</p>';
  } else if (!isDeliverable(s)) {
    list.innerHTML = '<p class="assigned-empty">No delivery due — subscription not active on this date.</p>';
  } else {
    const record = deliveries.get(s.id) || {};
    list.innerHTML = MEALS.map(([meal, label]) => {
      const done = record[meal];
      const detail = done ? `✅ Delivered by ${escapeHtml(done.byName || 'an executive')}${done.at ? ' at ' + formatTime(done.at) : ''}` : '⬜ Not delivered yet';
      return `<div class="drawer-meta-row"><span>${label}</span><span>${detail}</span></div>`;
    }).join('');
  }
}
