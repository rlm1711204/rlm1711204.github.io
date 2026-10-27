/* Service worker — lets Kaasu open without internet.
 * Strategy: try the network first (so you always get updates), fall back to
 * the saved copy when offline. Google and bill-scanner files are not touched.
 *
 * Kaasu sits at the root of rlm1711204.github.io, and other apps live in
 * folders of the same site (e.g. /pdf-photo-toolkit/). So this worker only
 * looks after Kaasu's own files, and only ever clears Kaasu's own saved
 * copies — the other apps keep theirs. */
const CACHE = 'kaasu-v23';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest',
  'js/parser.js', 'js/store.js', 'js/charts.js', 'js/ocr.js', 'js/camera.js', 'js/drive.js', 'js/ai.js', 'js/look.js', 'js/lock.js', 'js/help.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

/* Kaasu's own pages and files; anything else on the site belongs to another app. */
const BASE = new URL('./', self.location).pathname;            // "/"
const OWN = ['', 'index.html', 'manifest.webmanifest', 'sw.js'];
const OWN_FOLDERS = ['css/', 'js/', 'icons/'];
function isKaasu(url) {
  if (!url.pathname.startsWith(BASE)) return false;
  const rest = url.pathname.slice(BASE.length);
  return OWN.includes(rest) || OWN_FOLDERS.some((f) => rest.startsWith(f));
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kaasu-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined));
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Google / CDN: browser handles it
  if (!isKaasu(url)) return;                                              // another app on this site: hands off
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
