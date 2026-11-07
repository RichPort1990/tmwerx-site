/* The crew app's service worker: keeps the app and the job drawings on the phone for working without signal,
   shows notifications from the office, and sends waiting records when signal comes back (Android). */
'use strict';
importScripts('/crew/outbox.js');
const SHELL = 'tmwerx-shell-v1';
const FILES = 'tmwerx-files-v1';
const SHELL_URLS = [
  '/crew/',
  '/crew/app.js',
  '/crew/outbox.js',
  '/crew/crew.css',
  '/crew/manifest.webmanifest',
  '/icon-192.png',
  '/fonts/fonts.css',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches
      .open(SHELL)
      .then(c => c.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => ![SHELL, FILES].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  // drawings and office photos never change once made: keep them for offline
  if (/^\/api\/crew\/file\/(drawing|photo)\//.test(u.pathname) || u.pathname === '/api/crew/logo') {
    e.respondWith(
      caches.open(FILES).then(async c => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const r = await fetch(e.request);
        if (r.ok) c.put(e.request, r.clone());
        return r;
      })
    );
    return;
  }
  if (u.pathname.startsWith('/api/')) return; // live data: the app keeps its own copy
  // the app itself: the network when there is one (so updates arrive), the saved copy when there isn't
  if (u.pathname.startsWith('/crew') || u.pathname.startsWith('/fonts/') || /^\/icon-|^\/favicon/.test(u.pathname)) {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          if (r.ok) caches.open(SHELL).then(c => c.put(e.request, r.clone()));
          return r;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('/crew/')))
    );
  }
});

self.addEventListener('push', e => {
  let m = {};
  try {
    m = e.data ? e.data.json() : {};
  } catch (x) {
    m = { title: 'TM WerX', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(m.title || 'TM WerX', {
      body: m.body || '',
      tag: m.tag,
      renotify: !!m.tag,
      requireInteraction: !!m.urgent,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: m.urgent ? [400, 150, 400, 150, 400] : [200],
      data: { url: m.url || '/crew/' },
    })
  );
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/crew/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const w = list.find(c => new URL(c.url).pathname.startsWith('/crew'));
      if (w) {
        w.postMessage({ type: 'open', url });
        return w.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
// Android: the phone wakes us when signal returns, even with the app closed
self.addEventListener('sync', e => {
  if (e.tag === 'flush')
    e.waitUntil(TMDB.flush().then(r => (r.offline ? Promise.reject(new Error('still offline')) : null)));
});
self.addEventListener('message', e => {
  if (e.data === 'flush') e.waitUntil(TMDB.flush());
});
