// Hisaab Service Worker: offline asset cache + notification click handling
const CACHE_NAME = 'hisaab-shell-v15';
const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'logo-48.png',
  'logo-192.png',
  'logo-512.png',
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'js/config.js',
  'js/firebase-config.js',
  'js/main.js',
  'js/ui.js',
  'js/core/ai.js',
  'js/core/biometric.js',
  'js/core/calc.js',
  'js/core/cloud.js',
  'js/core/crypto.js',
  'js/core/db.js',
  'js/core/draggable.js',
  'js/core/export.js',
  'js/core/insights.js',
  'js/core/lock.js',
  'js/core/log.js',
  'js/core/markdown.js',
  'js/core/models.js',
  'js/core/prefs.js',
  'js/core/recurring.js',
  'js/core/sound.js',
  'js/core/store.js',
  'js/core/sync.js',
  'js/modules/account.js',
  'js/modules/ai.js',
  'js/modules/audit.js',
  'js/modules/chat.js',
  'js/modules/dashboard.js',
  'js/modules/funds.js',
  'js/modules/history.js',
  'js/modules/logs.js',
  'js/modules/manage.js',
  'js/modules/metrics.js',
  'js/modules/recurring.js',
  'js/modules/settings.js',
  'js/modules/statements.js',
  'js/modules/txn-sheet.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Pass Firebase and external requests to network
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('./') || caches.match('index.html'));
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (targetUrl) client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
