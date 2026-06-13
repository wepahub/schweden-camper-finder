const CACHE_NAME = "scf-v3-1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css?v=3.1",
  "./js/app.js?v=3.1",
  "./manifest.webmanifest",
  "./assets/icon.svg"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(APP_SHELL)));
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
  // Never cache live data or map tiles
  if (url.hostname.includes("overpass") ||
      url.hostname.includes("openstreetmap.org") ||
      url.hostname.includes("nominatim") ||
      url.hostname.includes("unpkg.com")) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
