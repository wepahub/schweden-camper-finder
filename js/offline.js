/* ── Datencache für Overpass-Antworten und gespeicherte Offline-Gebiete ── */

import { OFFLINE_CATEGORIES, OFFLINE_AREA_RADIUS, TILE_LAYERS } from "./config.js";
import { buildQuery, fetchOverpass, hashString } from "./overpass.js";
import { haversine, boundsAround, tilesForBounds } from "./geo.js";
import { storage } from "./storage.js";

const DATA_CACHE = "scf-data-v1";
const AREA_CACHE = "scf-areas-v1";
const hasCaches = () => typeof caches !== "undefined";
const dataKey = q => `https://scf.cache/overpass/${hashString(q)}`;
const areaKey = id => `https://scf.cache/area/${id}`;

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json", "x-scf-time": String(Date.now()) }
  });
}

export async function getCached(query, maxAge) {
  if (!hasCaches()) return null;
  try {
    const res = await (await caches.open(DATA_CACHE)).match(dataKey(query));
    if (!res) return null;
    const time = Number(res.headers.get("x-scf-time")) || 0;
    if (Date.now() - time > maxAge) return null;
    return { elements: await res.json(), time };
  } catch { return null; }
}

export async function putCached(query, elements) {
  if (!hasCaches()) return;
  try {
    const cache = await caches.open(DATA_CACHE);
    await cache.put(dataKey(query), jsonResponse(elements));
    // Cache klein halten: nur die letzten 40 Abfragen
    const keys = await cache.keys();
    if (keys.length > 40) await Promise.all(keys.slice(0, keys.length - 40).map(k => cache.delete(k)));
  } catch { /* Quota voll – egal */ }
}

/* ── Offline-Gebiete ── */

export function listAreas() { return storage.areas(); }

export async function saveArea({ center, label, radius = OFFLINE_AREA_RADIUS, layer = "osm", onProgress }) {
  if (!hasCaches()) throw new Error("Cache API nicht verfügbar");
  const query = buildQuery({ type: "circle", lat: center.lat, lon: center.lon, radius }, OFFLINE_CATEGORIES, { limit: 8000, timeout: 90 });
  onProgress?.({ step: "data" });
  const data = await fetchOverpass(query, { timeoutMs: 90000 });
  const elements = data.elements || [];
  const id = `a${Date.now().toString(36)}`;
  await (await caches.open(AREA_CACHE)).put(areaKey(id), jsonResponse(elements));

  // Wenige Übersichts-Kacheln vorladen (Zoom 9–12). Der Service Worker legt sie im
  // Kachel-Cache ab; Detailkacheln werden beim normalen Ansehen automatisch gespeichert.
  const tpl = TILE_LAYERS[layer] || TILE_LAYERS.osm;
  const tiles = tilesForBounds(boundsAround(center.lat, center.lon, radius), [9, 10, 11, 12]);
  let done = 0;
  for (const t of tiles) {
    const url = tpl.url.replace("{s}", "a").replace("{z}", t.z).replace("{x}", t.x).replace("{y}", t.y);
    try { await fetch(url, { mode: "cors" }); } catch { /* offline/blockiert */ }
    done++;
    onProgress?.({ step: "tiles", done, total: tiles.length });
  }

  const meta = { id, label, center, radius, savedAt: Date.now(), count: elements.length };
  storage.saveAreas([...storage.areas(), meta]);
  return meta;
}

export async function deleteArea(id) {
  storage.saveAreas(storage.areas().filter(a => a.id !== id));
  if (hasCaches()) try { await (await caches.open(AREA_CACHE)).delete(areaKey(id)); } catch { /* egal */ }
}

function areaOverlaps(meta, area) {
  if (area.type === "line") {
    return area.points.some(p => haversine(p.lat, p.lon, meta.center.lat, meta.center.lon) <= meta.radius + area.radius);
  }
  return haversine(area.lat, area.lon, meta.center.lat, meta.center.lon) <= meta.radius + area.radius;
}

// Alle gespeicherten Elemente aus Gebieten, die das Suchgebiet berühren
export async function offlineElements(area) {
  if (!hasCaches()) return [];
  const metas = storage.areas().filter(m => areaOverlaps(m, area));
  if (!metas.length) return [];
  const cache = await caches.open(AREA_CACHE);
  const seen = new Set(), out = [];
  for (const m of metas) {
    try {
      const res = await cache.match(areaKey(m.id));
      if (!res) continue;
      (await res.json()).forEach(el => {
        const k = `${el.type}/${el.id}`;
        if (!seen.has(k)) { seen.add(k); out.push(el); }
      });
    } catch { /* kaputter Eintrag */ }
  }
  return out;
}

export async function clearCaches() {
  if (!hasCaches()) return;
  const keep = new Set([AREA_CACHE]);
  const names = await caches.keys();
  await Promise.all(names.filter(n => n.startsWith("scf-data") || n.startsWith("scf-tiles")).filter(n => !keep.has(n)).map(n => caches.delete(n)));
}
