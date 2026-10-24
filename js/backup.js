/* ── Favoriten-Datenformat: Export/Import (JSON, GPX) und Migration ── */

import { hashString } from "./overpass.js";

const KEEP_TAGS = [
  "name", "opening_hours", "fee", "toilets", "drinking_water", "shower", "motorhome", "caravans",
  "power_supply", "sanitary_dump_station", "fuel:lpg", "website", "contact:website", "phone",
  "contact:phone", "tourism", "amenity", "access", "wheelchair", "description"
];

export function favoriteFromResult(r, existing = {}) {
  const tags = {};
  KEEP_TAGS.forEach(k => { if (r.tags?.[k] != null) tags[k] = r.tags[k]; });
  return {
    id: r.id,
    name: r.name || existing.name || null,
    catKey: r.catKey || existing.catKey || "custom",
    lat: r.lat, lon: r.lon,
    tags,
    favorite: existing.favorite ?? false,
    note: existing.note ?? "",
    addedAt: existing.addedAt || Date.now()
  };
}

export function buildBackup(favorites, trips, version) {
  return {
    app: "schweden-camper-finder",
    version,
    exportedAt: new Date().toISOString(),
    favorites: Object.values(favorites),
    trips
  };
}

export function parseBackup(text) {
  const data = JSON.parse(text);
  if (!data || data.app !== "schweden-camper-finder" || !Array.isArray(data.favorites)) {
    throw new Error("invalid backup");
  }
  const favorites = data.favorites.filter(f =>
    f && typeof f.id === "string" && Number.isFinite(f.lat) && Number.isFinite(f.lon));
  const trips = Array.isArray(data.trips)
    ? data.trips.filter(t => t && typeof t.id === "string" && Array.isArray(t.stops))
    : [];
  return { favorites, trips };
}

export function mergeInto(favorites, trips, incoming) {
  let added = 0;
  incoming.favorites.forEach(f => {
    const cur = favorites[f.id];
    if (!cur) added++;
    favorites[f.id] = {
      ...f, ...cur,
      favorite: Boolean(cur?.favorite || f.favorite),
      note: cur?.note || f.note || "",
      lat: f.lat ?? cur?.lat, lon: f.lon ?? cur?.lon
    };
  });
  incoming.trips.forEach(t => {
    const cur = trips.find(x => x.id === t.id);
    if (cur) cur.stops = [...new Set([...cur.stops, ...t.stops])];
    else trips.push({ id: t.id, name: String(t.name || "Reise"), createdAt: t.createdAt || Date.now(), stops: t.stops.slice() });
  });
  return added;
}

const xmlEsc = s => String(s ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const xmlUnesc = s => String(s ?? "")
  .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replaceAll("&amp;", "&");

export function buildGpx(points, name = "Schweden Camper Finder") {
  const wpts = points.map(p => [
    `  <wpt lat="${Number(p.lat).toFixed(6)}" lon="${Number(p.lon).toFixed(6)}">`,
    `    <name>${xmlEsc(p.name)}</name>`,
    p.desc ? `    <desc>${xmlEsc(p.desc)}</desc>` : null,
    p.type ? `    <type>${xmlEsc(p.type)}</type>` : null,
    `  </wpt>`
  ].filter(Boolean).join("\n"));
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Schweden Camper Finder" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xmlEsc(name)}</name><time>${new Date().toISOString()}</time></metadata>
${wpts.join("\n")}
</gpx>
`;
}

export function parseGpx(text) {
  const out = [];
  const re = /<wpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/wpt>)/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = m[1], body = m[2] || "";
    const lat = Number(/\blat\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1]);
    const lon = Number(/\blon\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const tag = t => {
      const v = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(body)?.[1];
      return v ? xmlUnesc(v.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim()) : "";
    };
    out.push({ lat, lon, name: tag("name"), desc: tag("desc") || tag("cmt") });
  }
  return out;
}

export function favoritesFromGpx(points) {
  return points.map(p => ({
    id: `gpx/${hashString(`${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.name}`)}`,
    name: p.name || null, catKey: "custom", lat: p.lat, lon: p.lon, tags: {},
    favorite: true, note: p.desc || "", addedAt: Date.now()
  }));
}

/*
  Alte Favoriten (bis v3.1) speicherten nur { favorite, note } ohne Koordinaten.
  Was in den alten letzten Ergebnissen steckt, wird direkt übernommen;
  der Rest wird als "unresolved" markiert und später über Overpass nachgeladen.
*/
export function migrateLegacy(oldFavs, oldLastResults) {
  const favorites = {};
  const unresolved = [];
  const byId = new Map((oldLastResults?.results || []).map(r => [r.id, r]));
  Object.entries(oldFavs || {}).forEach(([id, v]) => {
    if (!v || (!v.favorite && !v.note)) return;
    const r = byId.get(id);
    if (r && Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      favorites[id] = favoriteFromResult(r, { favorite: Boolean(v.favorite), note: v.note || "" });
    } else {
      unresolved.push({ id, favorite: Boolean(v.favorite), note: v.note || "" });
    }
  });
  return { favorites, unresolved };
}
