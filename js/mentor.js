// ============================================
// Poshaná mentor portal.
//
// Mentors sign in with phone + PIN, which maps to a Firebase Auth
// email/password account created by the admin (see mentorLoginEmail in
// js/admin.js). Firestore rules only return the subscribers and
// consultations belonging to the signed-in mentor, so every query here
// must filter on mentorId to be allowed.
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
  getFirestore, collection, query, where, onSnapshot, doc, getDoc, addDoc, updateDoc, serverTimestamp,
} = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const loginScreen = document.getElementById('login-screen');
const mentorApp = document.getElementById('mentor-app');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

let mentor = null; // { id, name, ... }
let clients = [];
let consultations = [];
let unsubscribers = [];

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '').slice(-10);
}

function mentorLoginEmail(phone) {
  return `m${normalizePhone(phone)}@poshana-mentor.local`;
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
    await signInWithEmailAndPassword(auth, mentorLoginEmail(phone), pin);
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
    mentor = null;
    mentorApp.hidden = true;
    loginScreen.hidden = false;
    return;
  }
  try {
    const login = await getDoc(doc(db, 'mentorLogins', user.uid));
    if (!login.exists()) {
      await signOut(auth);
      loginError.textContent = 'This account is not set up as a mentor.';
      return;
    }
    const mentorId = login.data().mentorId;
    const mentorSnap = await getDoc(doc(db, 'mentors', mentorId));
    mentor = { id: mentorId, ...(mentorSnap.exists() ? mentorSnap.data() : {}) };
    if (mentor.status === 'inactive') {
      await signOut(auth);
      loginError.textContent = 'Your mentor account is inactive. Please contact the admin.';
      return;
    }
  } catch (err) {
    await signOut(auth);
    loginError.textContent = 'Could not load your account: ' + err.message;
    return;
  }

  document.getElementById('mentor-greeting').textContent = `Hi ${mentor.name || 'there'} — here are the clients assigned to you.`;
  loginScreen.hidden = true;
  mentorApp.hidden = false;
  startListening();
});

function stopListening() {
  unsubscribers.forEach((fn) => fn());
  unsubscribers = [];
  clients = [];
  consultations = [];
}

function startListening() {
  const loading = document.getElementById('loading-state');
  loading.hidden = false;
  loading.textContent = 'Loading your clients…';

  unsubscribers.push(onSnapshot(
    query(collection(db, 'subscribers'), where('mentorId', '==', mentor.id)),
    (snap) => {
      clients = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      loading.hidden = true;
      render();
    },
    (err) => { loading.textContent = 'Could not load clients: ' + err.message; },
  ));

  unsubscribers.push(onSnapshot(
    query(collection(db, 'consultations'), where('mentorId', '==', mentor.id)),
    (snap) => {
      consultations = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (toDate(b.date)?.getTime() || 0) - (toDate(a.date)?.getTime() || 0));
      render();
    },
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

function toDateInputValue(ts) {
  const d = toDate(ts);
  if (!d) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function fromDateInputValue(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

const statusLabel = { active: 'Active', paused: 'Paused', cancelled: 'Cancelled' };
const statusBadgeClass = { active: 'badge-new', paused: 'badge-paused', cancelled: 'badge-closed' };

function consultationsFor(clientId) {
  return consultations.filter((c) => c.subscriberId === clientId);
}

// The follow-up date set in the client's most recent consultation.
function nextFollowUp(clientId) {
  const latest = consultationsFor(clientId)[0];
  return latest ? toDate(latest.nextFollowUp) : null;
}

function isFollowUpDue(clientId) {
  const next = nextFollowUp(clientId);
  return !!next && next <= startOfToday();
}

// ---------- Client list ----------
const state = { filter: 'all', search: '' };

document.querySelectorAll('[data-status-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-status-filter]').forEach((b) => b.classList.toggle('active', b === btn));
    state.filter = btn.dataset.statusFilter;
    renderTable();
  });
});

document.getElementById('search-input').addEventListener('input', (e) => {
  state.search = e.target.value.trim().toLowerCase();
  renderTable();
});

function render() {
  document.getElementById('stat-clients').textContent = clients.length;
  document.getElementById('stat-active').textContent = clients.filter((c) => (c.status || 'active') === 'active').length;
  document.getElementById('stat-due').textContent = clients.filter((c) => isFollowUpDue(c.id)).length;
  renderTable();
  if (activeClientId && !clientDrawer.hidden) renderClientDrawer();
}

function renderTable() {
  const tbody = document.getElementById('clients-tbody');
  const filtered = clients.filter((c) => {
    if (state.filter === 'active' && (c.status || 'active') !== 'active') return false;
    if (state.filter === 'due' && !isFollowUpDue(c.id)) return false;
    if (state.search && !`${c.name || ''} ${c.phone || ''}`.toLowerCase().includes(state.search)) return false;
    return true;
  });

  tbody.innerHTML = '';
  document.getElementById('empty-state').hidden = filtered.length > 0 || !document.getElementById('loading-state').hidden;

  filtered.forEach((c) => {
    const status = c.status || 'active';
    const last = consultationsFor(c.id)[0];
    const next = nextFollowUp(c.id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="cell-name">${escapeHtml(c.name || '—')}</td>
      <td>${c.phone ? `<a class="cell-call" href="tel:+91${escapeHtml(normalizePhone(c.phone))}">📞 ${escapeHtml(c.phone)}</a>` : '—'}</td>
      <td>${escapeHtml(c.plan || '—')}</td>
      <td><span class="badge ${statusBadgeClass[status] || 'badge-new'}">${statusLabel[status] || status}</span></td>
      <td>${last ? formatShortDate(last.date) : 'None yet'}</td>
      <td>${next ? formatShortDate(next) + (isFollowUpDue(c.id) ? ' ⚠️' : '') : '—'}</td>
    `;
    tr.querySelector('.cell-call')?.addEventListener('click', (e) => e.stopPropagation());
    tr.addEventListener('click', () => openClientDrawer(c.id));
    tbody.appendChild(tr);
  });
}

// ---------- Client drawer ----------
const clientDrawer = document.getElementById('client-drawer');
const consultForm = document.getElementById('consult-form');
let activeClientId = null;
let editingConsultId = null;

function openClientDrawer(id) {
  activeClientId = id;
  hideConsultForm();
  renderClientDrawer();
  clientDrawer.hidden = false;
}

function closeClientDrawer() {
  clientDrawer.hidden = true;
  activeClientId = null;
  hideConsultForm();
}

document.getElementById('client-drawer-close').addEventListener('click', closeClientDrawer);
document.getElementById('client-drawer-backdrop').addEventListener('click', closeClientDrawer);

function renderClientDrawer() {
  const c = clients.find((x) => x.id === activeClientId);
  if (!c) {
    // Client was unassigned from this mentor while the drawer was open.
    closeClientDrawer();
    return;
  }
  const status = c.status || 'active';
  const badge = document.getElementById('client-badge');
  badge.textContent = statusLabel[status] || status;
  badge.className = 'badge ' + (statusBadgeClass[status] || 'badge-new');

  document.getElementById('client-name').textContent = c.name || 'Unnamed';
  const callBtn = document.getElementById('client-call-btn');
  callBtn.hidden = !c.phone;
  callBtn.href = c.phone ? `tel:+91${normalizePhone(c.phone)}` : '#';
  callBtn.textContent = `📞 Call ${c.name || ''}`.trim();
  document.getElementById('client-phone').textContent = c.phone || '—';
  document.getElementById('client-email').textContent = c.email || '—';
  document.getElementById('client-plan').textContent = c.plan || '—';
  document.getElementById('client-dates').textContent = `${formatShortDate(c.startDate)} – ${formatShortDate(c.endDate)}`;
  document.getElementById('client-address').textContent = c.address || '—';

  const items = consultationsFor(c.id);
  document.getElementById('consult-count').textContent = items.length;
  const list = document.getElementById('consult-list');
  list.innerHTML = '';
  if (items.length === 0) {
    list.innerHTML = '<p class="assigned-empty">No consultations yet. Tap “+ New” after your call to record one.</p>';
    return;
  }
  items.forEach((item) => {
    const lines = [];
    if (item.weight || item.weight === 0) lines.push(`<strong>Weight:</strong> ${escapeHtml(String(item.weight))} kg`);
    if (item.healthNotes) lines.push(`<strong>Health notes:</strong> ${escapeHtml(item.healthNotes)}`);
    if (item.dietAdvice) lines.push(`<strong>Diet advice:</strong> ${escapeHtml(item.dietAdvice)}`);
    if (item.nextFollowUp) lines.push(`<strong>Next follow-up:</strong> ${formatShortDate(item.nextFollowUp)}`);
    const el = document.createElement('div');
    el.className = 'assigned-item consult-item editable';
    el.innerHTML = `
      <div class="assigned-item-top">
        <strong>${formatShortDate(item.date)}</strong>
        <span class="assigned-item-meta">Tap to edit</span>
      </div>
      <div class="assigned-item-meta">${lines.join('<br>') || 'No details.'}</div>
    `;
    el.addEventListener('click', () => showConsultForm(item));
    list.appendChild(el);
  });
}

// ---------- Consultation form ----------
document.getElementById('new-consult-btn').addEventListener('click', () => showConsultForm(null));
document.getElementById('consult-cancel-btn').addEventListener('click', hideConsultForm);

function showConsultForm(item) {
  editingConsultId = item ? item.id : null;
  document.getElementById('consult-form-title').textContent = item ? 'Edit Consultation' : 'New Consultation';
  document.getElementById('consult-date').value = item ? toDateInputValue(item.date) : toDateInputValue(new Date());
  document.getElementById('consult-weight').value = item?.weight ?? '';
  document.getElementById('consult-health').value = item?.healthNotes || '';
  document.getElementById('consult-diet').value = item?.dietAdvice || '';
  document.getElementById('consult-followup').value = item ? toDateInputValue(item.nextFollowUp) : '';
  document.getElementById('consult-save-status').textContent = '';
  consultForm.hidden = false;
  consultForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideConsultForm() {
  consultForm.hidden = true;
  editingConsultId = null;
}

consultForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = document.getElementById('consult-save-status');
  const btn = document.getElementById('consult-save-btn');
  const client = clients.find((x) => x.id === activeClientId);
  const date = fromDateInputValue(document.getElementById('consult-date').value);
  if (!client || !date) {
    status.textContent = 'Please pick a consultation date.';
    return;
  }

  const weightVal = document.getElementById('consult-weight').value;
  const fields = {
    date,
    weight: weightVal === '' ? null : Number(weightVal),
    healthNotes: document.getElementById('consult-health').value.trim(),
    dietAdvice: document.getElementById('consult-diet').value.trim(),
    nextFollowUp: fromDateInputValue(document.getElementById('consult-followup').value),
    updatedAt: serverTimestamp(),
  };

  btn.disabled = true;
  status.textContent = 'Saving…';
  try {
    if (editingConsultId) {
      await updateDoc(doc(db, 'consultations', editingConsultId), fields);
    } else {
      await addDoc(collection(db, 'consultations'), {
        ...fields,
        subscriberId: client.id,
        subscriberName: client.name || '',
        mentorId: mentor.id,
        mentorName: mentor.name || '',
        createdAt: serverTimestamp(),
      });
    }
    status.textContent = '';
    hideConsultForm();
  } catch (err) {
    status.textContent = 'Could not save: ' + err.message;
  } finally {
    btn.disabled = false;
  }
});
