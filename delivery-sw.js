// ============================================
// Service worker for the installable delivery portal (delivery.html).
//
// Only the portal's own files are handled, network-first: online, the
// executive always gets the latest version; offline, the cached copy still
// opens the app. Everything else (other site pages, Firebase) passes
// straight through. Bump CACHE when the file list changes.
// ============================================
const CACHE = 'poshana-delivery-v1';
const SHELL = [
  'delivery.html',
  'delivery.webmanifest',
  'css/styles.css',
  'css/admin.css',
  'js/delivery.js',
  'js/typeahead.js',
  'assets/logo-icon.png',
  'assets/favicon.png',
  'assets/app/icon-192.png',
  'assets/app/icon-512.png',
  'assets/app/apple-touch-icon.png',
];
const SHELL_URLS = new Set(SHELL.map((path) => new URL(path, self.registration.scope).href));
const PAGE_URL = new URL('delivery.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('poshana-delivery-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// delivery.html may also be served as /delivery (clean URLs).
function shellKey(request) {
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  if (url.href === PAGE_URL.replace(/\.html$/, '')) return PAGE_URL;
  return SHELL_URLS.has(url.href) ? url.href : null;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const key = shellKey(event.request);
  if (!key) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) cache.put(key, response.clone());
      return response;
    } catch (err) {
      const cached = await cache.match(key);
      if (!cached) throw err;
      // A cached redirect can't answer a navigation, so hand back a plain copy.
      return cached.redirected ? new Response(cached.body, cached) : cached;
    }
  })());
});
