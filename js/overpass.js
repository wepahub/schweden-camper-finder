/* ── Overpass: Abfrage bauen und mit Server-Fallback laden ── */

import { CATEGORIES, OVERPASS_ENDPOINTS, OVERPASS_TIMEOUT_MS, MAX_ELEMENTS } from "./config.js";

const fix = n => Number(n).toFixed(5);

/*
  area = { type: "circle", lat, lon, radius }
       | { type: "line", points: [{lat, lon}], radius }
*/
export function aroundClause(area) {
  const r = Math.round(area.radius);
  if (area.type === "line") {
    return `(around:${r},${area.points.map(p => `${fix(p.lat)},${fix(p.lon)}`).join(",")})`;
  }
  return `(around:${r},${fix(area.lat)},${fix(area.lon)})`;
}

export function buildQuery(area, categoryKeys, { limit = MAX_ELEMENTS, timeout = 25 } = {}) {
  const around = aroundClause(area);
  const filters = new Set();
  categoryKeys.forEach(k => CATEGORIES[k]?.filters.forEach(f => filters.add(f)));
  const lines = [...filters].map(f => `  nwr${f}${around};`);
  let q = `[out:json][timeout:${timeout}];\n(\n${lines.join("\n")}\n);\nout tags center qt ${limit};`;
  if (categoryKeys.some(k => CATEGORIES[k]?.hikingRoutes)) {
    // Wanderrouten + nur die Wegstücke im Suchgebiet → echter nächster Einstieg statt Routen-Mittelpunkt
    q += `\nrel["route"~"^(hiking|foot)$"]${around}->.hr;\n.hr out body center qt 200;\nway(r.hr)${around};\nout geom qt 4000;`;
  }
  return q;
}

export class OverpassError extends Error {
  constructor(message, details) { super(message); this.name = "OverpassError"; this.details = details; }
}

let preferred = null;
try { preferred = localStorage.getItem("scf:v4:endpoint"); } catch { /* ohne Storage */ }

function orderedEndpoints() {
  if (!preferred || !OVERPASS_ENDPOINTS.includes(preferred)) return OVERPASS_ENDPOINTS;
  return [preferred, ...OVERPASS_ENDPOINTS.filter(e => e !== preferred)];
}

/*
  Probiert die Server der Reihe nach. Jeder Server bekommt ein eigenes Timeout,
  damit ein hängender Server nicht die ganze Suche blockiert.
*/
export async function fetchOverpass(query, { signal, timeoutMs = OVERPASS_TIMEOUT_MS, fetchImpl = fetch, onAttempt } = {}) {
  const errors = [];
  for (const endpoint of orderedEndpoints()) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    onAttempt?.(endpoint);
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ data: query }),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Overpass meldet Laufzeitfehler mit HTTP 200 im Feld "remark"
      if (data.remark && /runtime error|timed out|out of memory|error/i.test(data.remark)) {
        throw new Error(data.remark);
      }
      preferred = endpoint;
      try { localStorage.setItem("scf:v4:endpoint", endpoint); } catch { /* egal */ }
      return data;
    } catch (err) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      errors.push(`${new URL(endpoint).hostname}: ${err.name === "AbortError" ? "Timeout" : err.message}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  throw new OverpassError("Overpass nicht erreichbar", errors);
}

export function idsQuery(ids) {
  const byType = { node: [], way: [], relation: [] };
  ids.forEach(id => {
    const [type, num] = id.split("/");
    if (byType[type] && /^\d+$/.test(num)) byType[type].push(num);
  });
  const parts = [];
  if (byType.node.length) parts.push(`node(id:${byType.node.join(",")});`);
  if (byType.way.length) parts.push(`way(id:${byType.way.join(",")});`);
  if (byType.relation.length) parts.push(`rel(id:${byType.relation.join(",")});`);
  return parts.length ? `[out:json][timeout:25];\n(${parts.join("")});\nout tags center qt;` : null;
}

// FNV-1a – kurzer Schlüssel für den Datencache
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
