const CACHE_NAME = 'magasin-nesle-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass-through pour éviter les bugs de cache pendant le développement
  event.respondWith(fetch(event.request));
});
