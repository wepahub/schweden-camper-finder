/* ── Service Worker: App offline verfügbar, Updates kommen sofort an ── */

const VERSION = "4.0.1";
const SHELL_CACHE = `scf-shell-${VERSION}`;
const TILE_CACHE = "scf-tiles-v1";
const KEEP = [SHELL_CACHE, TILE_CACHE, "scf-data-v1", "scf-areas-v1"];
const TILE_LIMIT = 3000;
const TILE_HOSTS = ["tile.openstreetmap.org", "tile.opentopomap.org", "server.arcgisonline.com"];

const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/main.js",
  "./js/config.js",
  "./js/i18n.js",
  "./js/geo.js",
  "./js/hours.js",
  "./js/overpass.js",
  "./js/places.js",
  "./js/storage.js",
  "./js/backup.js",
  "./js/favorites.js",
  "./js/offline.js",
  "./js/services.js",
  "./js/mapview.js",
  "./js/ui/dom.js",
  "./js/ui/cards.js",
  "./js/ui/sheet.js",
  "./js/ui/favorites.js",
  "./js/ui/panels.js",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/images/layers.png",
  "./vendor/leaflet/images/layers-2x.png",
  "./vendor/markercluster/leaflet.markercluster.js",
  "./vendor/markercluster/MarkerCluster.css",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  // Neue Version sofort aktivieren – dank „Netz zuerst“ passen Seite und Dateien immer zusammen
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (TILE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
    event.respondWith(tileFirst(req));
    return;
  }
  // Live-Daten (Overpass, Nominatim, OSRM, Open-Meteo) nie über den SW cachen
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const net = fetch(req).then(res => {
    if (res.ok && res.type === "basic") cache.put(req, res.clone());
    return res;
  });
  try {
    return await withTimeout(net, 4000);
  } catch {
    const hit = (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === "navigate" ? await cache.match("./index.html") : null);
    if (hit) return hit;
    // Kein Cache (z. B. erster Besuch bei langsamem Netz) → auf das Netz warten
    return net.catch(() => Response.error());
  }
}

let tilePuts = 0;
async function tileFirst(req) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    // Nur echte CORS-Antworten speichern (opake Antworten belegen sehr viel Speicher)
    if (res.ok && res.type === "cors") {
      cache.put(req, res.clone()).then(() => {
        if (++tilePuts % 50 === 0) trimTiles(cache);
      }).catch(() => {});
    }
    return res;
  } catch {
    return Response.error();
  }
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length <= TILE_LIMIT) return;
  await Promise.all(keys.slice(0, keys.length - TILE_LIMIT).map(k => cache.delete(k)));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}
