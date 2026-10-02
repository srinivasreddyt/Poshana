// ============================================
// Poshaná — fetch and render the live branches list.
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
const { getFirestore, collection, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const grid = document.getElementById('branches-grid');
const loadingState = document.getElementById('branches-loading');
const emptyState = document.getElementById('branches-empty');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function mapLink(location) {
  if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') return null;
  return `https://www.google.com/maps?q=${location.lat},${location.lng}`;
}

function renderBranches(branches) {
  loadingState.hidden = true;
  grid.innerHTML = '';

  if (branches.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  branches.forEach((branch) => {
    const card = document.createElement('div');
    card.className = 'branch-card';

    const map = mapLink(branch.location);

    card.innerHTML = `
      <div class="branch-card-top">
        <h3 class="branch-city">${escapeHtml(branch.city || 'Poshaná')}</h3>
        <span class="branch-status">${escapeHtml(branch.status || 'Coming Soon')}</span>
      </div>
      ${branch.contactNumber ? `<div class="branch-info-row">📞 <a href="tel:+91${escapeHtml(branch.contactNumber)}">+91 ${escapeHtml(branch.contactNumber)}</a></div>` : ''}
      ${branch.email ? `<div class="branch-info-row">✉️ <a href="mailto:${escapeHtml(branch.email)}">${escapeHtml(branch.email)}</a></div>` : ''}
      ${map ? `<div class="branch-info-row">📍 <a href="${map}" target="_blank" rel="noopener">View on map</a></div>` : ''}
    `;
    grid.appendChild(card);
  });
}

onSnapshot(
  collection(db, 'branches'),
  (snapshot) => {
    const branches = snapshot.docs.map((d) => d.data());
    renderBranches(branches);
  },
  (err) => {
    loadingState.textContent = 'Could not load branches right now. Please try again later.';
  }
);
