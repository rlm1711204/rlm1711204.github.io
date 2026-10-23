/* Service worker — lets Kaasu open without internet.
 * Strategy: try the network first (so you always get updates), fall back to
 * the saved copy when offline. Google and bill-scanner files are not touched. */
const CACHE = 'kaasu-v13';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest',
  'js/parser.js', 'js/store.js', 'js/charts.js', 'js/ocr.js', 'js/drive.js', 'js/ai.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined));
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Google / CDN: browser handles it
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; }
        // The site answered with an error (e.g. hosting switched off): use the saved copy
        // so your entries stay reachable. Only fall back to the error if nothing is saved.
        return fromCache(e.request).then((r) => r || res);
      })
      .catch(() => fromCache(e.request))
  );
});
