self.importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
self.importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js');

self.skipWaiting();
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.workbox.precaching.cleanupOutdatedCaches();
self.workbox.precaching.precacheAndRoute(self.__WB_MANIFEST);

const { NavigationRoute, registerRoute } = self.workbox.routing;
registerRoute(
  new NavigationRoute(
    async ({ event }) => {
      const cache = await caches.open('workbox-precache-v2');
      const response = await cache.match('/index.html', { ignoreSearch: true });
      return response || fetch(event.request);
    },
    { denylist: [/^\/api\//] }
  )
);
