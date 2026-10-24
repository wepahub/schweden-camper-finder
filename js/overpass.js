/* ── Overpass: Abfrage bauen und mit Server-Fallback laden ── */

import { CATEGORIES, OVERPASS_ENDPOINTS, OVERPASS_TIMEOUT_MS, OVERPASS_SERVER_TIMEOUT, MAX_ELEMENTS } from "./config.js";

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

export function buildQuery(area, categoryKeys, { limit = MAX_ELEMENTS, timeout = OVERPASS_SERVER_TIMEOUT } = {}) {
  const around = aroundClause(area);
  const filters = new Set();
  categoryKeys.forEach(k => CATEGORIES[k]?.filters.forEach(f => filters.add(f)));
  const lines = [...filters].map(f => `  nwr${f}${around};`);
  let q = `[out:json][timeout:${timeout}];\n(\n${lines.join("\n")}\n);\nout center tags qt ${limit};`;
  if (categoryKeys.some(k => CATEGORIES[k]?.hikingRoutes)) {
    // Wanderrouten + nur die Wegstücke im Suchgebiet → echter nächster Einstieg statt Routen-Mittelpunkt
    q += `\n(rel["route"="hiking"]${around};rel["route"="foot"]${around};)->.hr;\n.hr out body center qt 200;\nway(r.hr)${around};\nout geom qt 4000;`;
  }
  return q;
}

export class OverpassError extends Error {
  constructor(message, details) { super(message); this.name = "OverpassError"; this.details = details; }
}

/*
  Antwortzeiten pro Server (gleitender Mittelwert) – der bei dir schnellste
  Server wird zuerst gefragt. Fehler zählen als sehr langsam.
*/
const STATS_KEY = "scf:v4:overpassStats";
let stats = {};
try { stats = JSON.parse(localStorage.getItem(STATS_KEY) || "{}") || {}; } catch { stats = {}; }

function record(endpoint, ms) {
  const prev = stats[endpoint];
  stats[endpoint] = prev == null ? ms : Math.round(prev * 0.6 + ms * 0.4);
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* egal */ }
}

export function orderedEndpoints() {
  // Unbekannte Server behalten ihre Reihenfolge aus der Konfiguration
  return OVERPASS_ENDPOINTS
    .map((e, i) => ({ e, score: stats[e] ?? 8000 + i }))
    .sort((a, b) => a.score - b.score)
    .map(x => x.e);
}

export function resetOverpassStats() { stats = {}; }

/*
  Fragt zuerst den schnellsten Server. Kommt nach hedgeMs keine Antwort, wird
  zusätzlich der nächste Server gefragt („hedged request“); die erste gültige
  Antwort gewinnt, die anderen Anfragen werden abgebrochen. Fällt ein Server
  aus, kommt sofort der nächste dran. Jeder Server hat ein eigenes Timeout.
*/
export function fetchOverpass(query, {
  signal, timeoutMs = OVERPASS_TIMEOUT_MS, hedgeMs = 5000, fetchImpl = fetch, onAttempt
} = {}) {
  const endpoints = orderedEndpoints();
  return new Promise((resolve, reject) => {
    const errors = [];
    const ctrls = [];
    let settled = false, started = 0, failed = 0, hedgeTimer;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      ctrls.forEach(c => c.abort());
      signal?.removeEventListener("abort", onUserAbort);
      fn(value);
    };
    const onUserAbort = () => finish(reject, new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) { onUserAbort(); return; }
    signal?.addEventListener("abort", onUserAbort, { once: true });

    const startNext = () => {
      if (settled || started >= endpoints.length) return;
      const endpoint = endpoints[started++];
      clearTimeout(hedgeTimer);
      if (started < endpoints.length) hedgeTimer = setTimeout(startNext, hedgeMs);
      attempt(endpoint);
    };

    const attempt = async endpoint => {
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
      const t0 = Date.now();
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
        if (settled) return;
        record(endpoint, Date.now() - t0);
        finish(resolve, data);
      } catch (err) {
        if (settled) return; // abgebrochen, weil ein anderer Server schneller war
        record(endpoint, Math.max(timeoutMs, 30000));
        errors.push(`${new URL(endpoint).hostname}: ${timedOut || err.name === "AbortError" ? "Timeout" : err.message}`);
        failed++;
        if (failed >= endpoints.length) finish(reject, new OverpassError("Overpass nicht erreichbar", errors));
        else startNext();
      } finally {
        clearTimeout(timer);
      }
    };

    startNext();
  });
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
  return parts.length ? `[out:json][timeout:25];\n(${parts.join("")});\nout center tags qt;` : null;
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
