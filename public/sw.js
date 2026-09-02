// FieldOps Dashboard 2.7.0 — Connected Operations - Offline Field Service Worker
const CACHE_NAME = 'fieldops-2.7.0-shell-v1';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install Event: Pre-cache static shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[FieldOps SW] Caching app shell for offline field use...');
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: network-first navigation with offline fallback
self.addEventListener('fetch', (event) => {
  // Skip non-GET or chrome-extension requests
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) {
    // Network-first for API with offline fallback
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request).then((response) => {
          if (response) return response;
          return new Response(JSON.stringify({ offline: true, message: 'FieldOps running in offline grid-down mode.' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        });
      })
    );
    return;
  }

  const navigation = event.request.mode === 'navigate' || event.request.destination === 'document';
  event.respondWith(
    fetch(event.request).then((networkResponse) => {
      if (navigation && networkResponse && networkResponse.status === 200) {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', responseToCache));
      }
      return networkResponse;
    }).catch(() => caches.match(navigation ? '/index.html' : event.request))
  );
});
