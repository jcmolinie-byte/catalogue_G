// Service Worker minimal pour permettre l'installation en PWA
const CACHE_NAME = 'magasin-nesle-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Nécessaire pour le critère d'installation PWA
  event.respondWith(fetch(event.request));
});
