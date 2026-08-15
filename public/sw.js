self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    })
  );
  self.clients.claim().then(() => {
    self.registration.unregister().then(() => {
      console.log('[Service Worker] Unregistered successfully to bypass cache.');
    });
  });
});
