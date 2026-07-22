// FieldOps Dashboard V2.0 - Offline Field Service Worker
const CACHE_NAME = 'fieldops-v2-cache-v1';

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

// Fetch Event: Stale-While-Revalidate Strategy for offline resilience
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

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
