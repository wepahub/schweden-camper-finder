/* ── OSM-Elemente → Ergebnisse: Kategorie, Entfernung, Bewertung, Filter ── */

import { CATEGORIES, detectStore } from "./config.js";
import { haversine, bearingTo, nearestPoint, projectOnLine, cumulativeLengths } from "./geo.js";
import { openingStatus } from "./hours.js";

export function classify(tags, categoryKeys) {
  for (const k of categoryKeys) {
    const c = CATEGORIES[k];
    if (c && c.primary(tags) && (!c.extra || c.extra(tags))) return k;
  }
  for (const k of categoryKeys) {
    const c = CATEGORIES[k];
    if (c?.secondary && c.secondary(tags) && (!c.extra || c.extra(tags))) return k;
  }
  return null;
}

/*
  pickPoint(points) wählt bei Wanderrouten den relevanten Punkt aus den
  Wegstücken (Standard: nächster Punkt zum Ursprung).
*/
export function normalize(elements, categoryKeys, origin, { pickPoint } = {}) {
  const wayGeom = new Map();
  for (const el of elements) {
    if (el.type === "way" && Array.isArray(el.geometry)) wayGeom.set(el.id, el.geometry);
  }
  const choose = pickPoint || (pts => nearestPoint(origin, pts)?.point);
  const seen = new Set();
  const out = [];

  for (const el of elements) {
    if (el.type === "way" && el.geometry && !el.center) continue; // nur Geometrie für Wanderrouten
    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    const tags = el.tags || {};
    const catKey = classify(tags, categoryKeys);
    if (!catKey) continue;

    let lat = el.lat ?? el.center?.lat;
    let lon = el.lon ?? el.center?.lon;
    let entryPoint = false;
    if (el.type === "relation" && CATEGORIES[catKey].hikingRoutes && Array.isArray(el.members)) {
      const pts = [];
      el.members.forEach(m => { if (m.type === "way" && wayGeom.has(m.ref)) pts.push(...wayGeom.get(m.ref)); });
      const p = pts.length ? choose(pts) : null;
      if (p) { lat = p.lat; lon = p.lon; entryPoint = true; }
    }
    if (lat == null || lon == null) continue;
    seen.add(id);

    const distance = haversine(origin.lat, origin.lon, lat, lon);
    const store = catKey === "food" ? detectStore(tags) : null;
    out.push({
      id, osmType: el.type, osmId: el.id, catKey, lat, lon, entryPoint,
      distance, bearing: bearingTo(origin.lat, origin.lon, lat, lon),
      name: tags.name || tags["name:sv"] || tags.brand || tags.operator || tags.ref || null,
      store, tags,
      score: scorePlace(catKey, tags, distance) + (store ? store.bonus : 0),
      nearby: []
    });
  }
  return out;
}

export function applySafety(p) {
  const a = p.tags.access;
  return a !== "private" && a !== "no";
}

const YES = v => v === "yes" || v === "designated";

export function scorePlace(catKey, t, d) {
  let s = CATEGORIES[catKey].scoreBase;
  if (d < 1000) s += 20; else if (d < 3000) s += 10;
  if (t.access === "yes" || t.access === "public") s += 12;
  if (t.opening_hours === "24/7") s += 12;
  if (t.fee === "no") s += 8;
  if (t.toilets === "yes") s += 15;
  if (t.drinking_water === "yes") s += 12;
  if (t.shower === "yes" || t.shower === "hot") s += 6;
  if (/^(yes|public|customers)$/.test(t.sanitary_dump_station || "")) s += 12;
  if (t.power_supply === "yes") s += 6;
  if (YES(t.motorhome) || YES(t.caravans)) s += 15;
  if (t.motorhome === "no") s -= 40;
  if (t["fuel:lpg"] === "yes") s += 15;
  if (t.website || t["contact:website"]) s += 3;
  return s;
}

const NEARBY_TYPES = ["toilets", "water", "dump", "shower", "parking", "picnic"];
const NEARBY_HOSTS = ["bathing", "church", "picnic", "parking", "camping", "shelter", "viewpoint", "firepit", "hiking"];

// Nützliches in der Nähe (≤ maxDist) – über ein Raster statt jeder-gegen-jeden
export function enrichNearby(results, maxDist = 350) {
  if (!results.length) return;
  const lat0 = results[0].lat;
  const stepLat = maxDist / 110540, stepLon = maxDist / (111320 * Math.cos(lat0 * Math.PI / 180));
  const key = (a, b) => `${a}:${b}`;
  const grid = new Map();
  results.forEach(r => {
    if (!NEARBY_TYPES.includes(r.catKey)) return;
    const k = key(Math.floor(r.lat / stepLat), Math.floor(r.lon / stepLon));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(r);
  });
  results.forEach(p => {
    p.nearby = [];
    if (!NEARBY_HOSTS.includes(p.catKey)) return;
    const gy = Math.floor(p.lat / stepLat), gx = Math.floor(p.lon / stepLon);
    const found = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      (grid.get(key(gy + dy, gx + dx)) || []).forEach(o => {
        if (o.id === p.id) return;
        const d = haversine(p.lat, p.lon, o.lat, o.lon);
        if (d <= maxDist) found.push({ catKey: o.catKey, d: Math.round(d) });
      });
    }
    // pro Typ nur das nächste
    const best = new Map();
    found.forEach(f => { if (!best.has(f.catKey) || best.get(f.catKey).d > f.d) best.set(f.catKey, f); });
    p.nearby = [...best.values()].sort((a, b) => a.d - b.d).slice(0, 4);
    p.score += p.nearby.length * 8;
  });
}

const hasNearby = (p, cat) => p.nearby?.some(n => n.catKey === cat);

export const FILTER_TESTS = {
  free:       p => p.tags.fee === "no",
  open:       (p, now) => Boolean(openingStatus(p.tags.opening_hours, now)?.open),
  h24:        p => p.tags.opening_hours === "24/7",
  toilets:    p => p.catKey === "toilets" || p.tags.toilets === "yes" || hasNearby(p, "toilets"),
  water:      p => p.catKey === "water" || p.tags.drinking_water === "yes" || hasNearby(p, "water"),
  motorhome:  p => YES(p.tags.motorhome) || YES(p.tags.caravans) || p.tags.tourism === "caravan_site",
  lpg:        p => p.tags["fuel:lpg"] === "yes",
  wheelchair: p => p.tags.wheelchair === "yes"
};

export function passesFilters(p, filters, now = new Date()) {
  for (const f of filters) if (FILTER_TESTS[f] && !FILTER_TESTS[f](p, now)) return false;
  return true;
}

export function sortResults(results, mode) {
  const cmp = {
    score: (a, b) => b.score - a.score || a.distance - b.distance,
    along: (a, b) => (a.along ?? 0) - (b.along ?? 0) || a.distance - b.distance,
    distance: (a, b) => a.distance - b.distance || b.score - a.score
  }[mode] || ((a, b) => a.distance - b.distance);
  return results.sort(cmp);
}

// Ergebnisse entlang einer Route: Position auf der Route + Abstand zur Route
export function projectOnRoute(results, line) {
  const cum = cumulativeLengths(line);
  results.forEach(r => {
    const { along, offset } = projectOnLine(r, line, cum);
    r.along = along;
    r.distance = offset;
    r.offRoute = true;
  });
  return results;
}

// Auswahl des Wanderweg-Punkts, der der Route am nächsten liegt
export function nearestToLine(line) {
  const cum = cumulativeLengths(line);
  return pts => {
    let best = null, bestD = Infinity;
    const step = Math.max(1, Math.floor(pts.length / 200));
    for (let i = 0; i < pts.length; i += step) {
      const d = projectOnLine(pts[i], line, cum).offset;
      if (d < bestD) { bestD = d; best = pts[i]; }
    }
    return best;
  };
}

export function inArea(p, area) {
  const limit = area.radius * 1.05;
  return p.distance <= limit;
}

export function toStorable(r) {
  const { _marker, ...rest } = r;
  return rest;
}
