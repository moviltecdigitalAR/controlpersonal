// Service Worker — Control de Acceso
// Estrategia: Cache First para assets estáticos, Network First para API

const CACHE_NAME = 'control-acceso-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/config.js',
  '/js/fingerprint.js',
  '/js/geo.js',
  '/js/auth.js',
  '/js/api.js',
  '/js/app.js',
  '/js/dashboard.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Instalar: cachear assets estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activar: limpiar caches viejos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: Cache First para estáticos, Network para API y Google
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // No interceptar llamadas a APIs externas
  if (
    url.hostname === 'script.google.com' ||
    url.hostname.includes('google') ||
    url.hostname.includes('googleapis') ||
    url.pathname.includes('/macros/')
  ) {
    return; // dejar pasar sin interceptar
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html').then(r => r || caches.match('/'));
        }
      });
    })
  );
});
