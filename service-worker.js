const CACHE_NAME = "sweden-camper-finder-v1-3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css?v=1.3",
  "./js/app.js?v=1.3",
  "./manifest.webmanifest",
  "./assets/icon.svg"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  if (
    url.hostname.includes("overpass") ||
    url.hostname.includes("openstreetmap.org") ||
    url.hostname.includes("nominatim")
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
