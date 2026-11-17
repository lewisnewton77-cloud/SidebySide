/* Side by Side service worker: makes the site installable and quick to reopen.
   - the app page: network first, so updates arrive on the next launch; the cached copy is used offline
   - three.js and fonts: cached after first use
   - stored artwork (/api/art/img/...): cached after first use
   - everything else under /api: always live */
const V = 'sbs-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sbs-') && k !== V && k !== 'sbs-art').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function networkFirst(req) {
  const c = await caches.open(V);
  try { const r = await fetch(req); if (r.ok) c.put('/', r.clone()); return r; }
  catch (_) { return (await c.match('/')) || Response.error(); }
}
async function cacheFirst(req, name) {
  const c = await caches.open(name), hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === 'opaque') c.put(req, r.clone());
  return r;
}
async function staleWhileRevalidate(req) {
  const c = await caches.open(V), hit = await c.match(req);
  const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
  return hit || net;
}
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (req.mode === 'navigate' && u.origin === location.origin) return e.respondWith(networkFirst(req));
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/api/art/img/')) return e.respondWith(cacheFirst(req, 'sbs-art'));
    if (u.pathname.startsWith('/api/')) return;
    return e.respondWith(staleWhileRevalidate(req));
  }
  if (u.hostname === 'cdn.jsdelivr.net') return e.respondWith(cacheFirst(req, V));
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') return e.respondWith(staleWhileRevalidate(req));
});
