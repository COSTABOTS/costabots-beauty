const CACHE_NAME = 'costabots-beauty-brand-v3';
const IS_LOCAL_DEV = ['localhost', '127.0.0.1', '::1'].includes(self.location.hostname);
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/branding/costabots-beauty-logo-source.png',
  '/branding/ui-symbol-transparent-256.png',
  '/branding/ui-symbol-transparent-512.png',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/branding/pwa-192x192.png',
  '/branding/pwa-512x512.png',
  '/branding/maskable-192x192.png',
  '/branding/maskable-512x512.png',
];

self.addEventListener('install', (event) => {
  if (IS_LOCAL_DEV) {
    self.skipWaiting();
    return;
  }

  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  if (IS_LOCAL_DEV) {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((client) => client.navigate(client.url))),
    );
    return;
  }

  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (IS_LOCAL_DEV) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (requestUrl.hostname === '127.0.0.1' || requestUrl.hostname === 'localhost') {
    event.respondWith(fetch(event.request));
    return;
  }

  if (requestUrl.pathname.startsWith('/logos/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/'))),
  );
});
