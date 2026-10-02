// ============================================
// Firebase wiring for Poshaná enquiry forms.
//
// TODO: replace this placeholder config with the real one from the
// Firebase console (Project settings > General > Your apps > Web app).
// Leads are written to the "enquiries" collection in Firestore.
// ============================================
const firebaseConfig = {
  apiKey: "REPLACE_WITH_API_KEY",
  authDomain: "REPLACE_WITH_PROJECT.firebaseapp.com",
  projectId: "REPLACE_WITH_PROJECT",
  storageBucket: "REPLACE_WITH_PROJECT.firebasestorage.app",
  messagingSenderId: "REPLACE_WITH_SENDER_ID",
  appId: "REPLACE_WITH_APP_ID",
};

const isConfigured = !Object.values(firebaseConfig).some((v) => v.startsWith('REPLACE_WITH'));

let dbPromise = null;
async function getDb() {
  if (!isConfigured) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const { getFirestore, collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      return { firestore, collection, addDoc, serverTimestamp };
    })();
  }
  return dbPromise;
}

async function submitEnquiry(data, source) {
  const db = await getDb();
  if (!db) {
    throw new Error('not_configured');
  }
  const { firestore, collection, addDoc, serverTimestamp } = db;
  await addDoc(collection(firestore, 'enquiries'), {
    ...data,
    source,
    createdAt: serverTimestamp(),
  });
}

function wireEnquiryForm(form) {
  const status = form.querySelector('.form-status');
  const submitBtn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());

    if (!data.name || !data.phone) {
      showStatus(status, 'error', 'Please fill in your name and phone number.');
      return;
    }

    const originalLabel = submitBtn ? submitBtn.textContent : null;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
    }

    try {
      await submitEnquiry(data, form.dataset.source || 'website');
      showStatus(status, 'success', "Thanks! We've received your details — our team will call you shortly.");
      form.reset();
    } catch (err) {
      if (err.message === 'not_configured') {
        showStatus(status, 'error', `We're setting things up — please call us directly at +91 7416242883 for now.`);
      } else {
        showStatus(status, 'error', 'Something went wrong. Please try again or call us at +91 7416242883.');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    }
  });
}

function showStatus(el, type, message) {
  if (!el) return;
  el.textContent = message;
  el.className = `form-status ${type}`;
}

document.querySelectorAll('form.enquiry-form').forEach(wireEnquiryForm);
