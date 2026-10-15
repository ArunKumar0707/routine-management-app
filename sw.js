/* DayFlow service worker
 * - lets the page show system notifications on Android (required there)
 * - keeps the app usable offline (network first, cached copy as a fallback) */
const CACHE = 'dayflow-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'alerts.js', 'quotes.js', 'push-config.js', 'sounds/sounds.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});

/* Background alerts: the push worker sends an encrypted message at each activity's start time. */
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // If DayFlow is on screen, the page shows its own banner and plays the tone — don't double up (except for the test button).
    if (!data.test && wins.some(w => w.visibilityState === 'visible')) return;
    await self.registration.showNotification(data.title || 'DayFlow', {
      body: data.body || '', tag: data.tag || 'dayflow', renotify: true,
      icon: 'icon-192.png', badge: 'icon-192.png', vibrate: [200, 100, 200],
      data: { url: './index.html' }
    });
  })());
});
