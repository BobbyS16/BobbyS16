importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js')

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

self.skipWaiting()
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

const navigationRoute = new NavigationRoute(
  async ({ event }) => {
    const cache = await caches.open('workbox-precache-v2')
    const response = await cache.match('/index.html', { ignoreSearch: true })
    return response || fetch(event.request)
  },
  {
    denylist: [/^\/api\//],
  }
)
registerRoute(navigationRoute)
