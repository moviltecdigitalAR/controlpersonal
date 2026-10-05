// Service Worker — Control de Acceso
// Estrategia: NETWORK FIRST para todo (actualizaciones inmediatas),
// con cache como fallback offline. Así los deploys nuevos llegan siempre.

const CACHE_NAME = 'control-acceso-v4';

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
  '/js/operacion.js',
  '/js/dashboard.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Instalar: precachear assets para offline
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activar: limpiar caches viejos SIEMPRE (fuerza la nueva versión)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: Network First — si hay internet usa la versión nueva,
// si no hay red cae al cache (modo offline / PWA)
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // No interceptar llamadas a APIs externas
  if (
    url.hostname === 'script.google.com' ||
    url.hostname.includes('google') ||
    url.hostname.includes('googleapis') ||
    url.pathname.includes('/macros/')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Guardar en cache la versión fresca
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Sin conexión: servir del cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html').then(r => r || caches.match('/'));
          }
        });
      })
  );
});
