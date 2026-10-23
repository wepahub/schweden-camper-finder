import { test } from "node:test";
import assert from "node:assert/strict";
import { buildQuery, aroundClause, fetchOverpass, idsQuery, hashString } from "../js/overpass.js";

test("Abfrage nutzt nwr und dedupliziert Filter", () => {
  const q = buildQuery({ type: "circle", lat: 59.85, lon: 17.63, radius: 5000 }, ["toilets", "water", "toilets"]);
  assert.match(q, /nwr\["amenity"="toilets"\]\(around:5000,59\.85000,17\.63000\);/);
  assert.equal((q.match(/"amenity"="toilets"/g) || []).length, 1);
  assert.match(q, /out tags center qt 1500;/);
  assert.doesNotMatch(q, /route/);
});

test("Wanderwege holen Wegstücke für den nächsten Einstieg", () => {
  const q = buildQuery({ type: "circle", lat: 60, lon: 15, radius: 3000 }, ["hiking"]);
  assert.match(q, /rel\["route"~"\^\(hiking\|foot\)\$"\]\(around:3000,60\.00000,15\.00000\)->\.hr;/);
  assert.match(q, /way\(r\.hr\)\(around:3000/);
  assert.match(q, /out geom/);
});

test("Linien-Abfrage für die Route", () => {
  const c = aroundClause({ type: "line", radius: 1200.4, points: [{ lat: 59, lon: 18 }, { lat: 58, lon: 12 }] });
  assert.equal(c, "(around:1200,59.00000,18.00000,58.00000,12.00000)");
});

test("Server-Fallback: Timeout und Laufzeitfehler führen zum nächsten Server", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    if (calls.length === 1) {
      // hängt, bis das Timeout abbricht
      return new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    }
    if (calls.length === 2) return { ok: true, json: async () => ({ remark: "runtime error: Query timed out", elements: [] }) };
    return { ok: true, json: async () => ({ elements: [{ type: "node", id: 1 }] }) };
  };
  const data = await fetchOverpass("x", { fetchImpl, timeoutMs: 30 });
  assert.equal(calls.length, 3);
  assert.equal(data.elements.length, 1);
});

test("alle Server kaputt → OverpassError mit Details", async () => {
  const fetchImpl = async () => ({ ok: false, status: 504 });
  await assert.rejects(fetchOverpass("x", { fetchImpl, timeoutMs: 50 }), err => {
    assert.equal(err.name, "OverpassError");
    assert.equal(err.details.length, 3);
    return true;
  });
});

test("Abbruch durch Nutzer wird nicht als Serverfehler behandelt", async () => {
  const ctrl = new AbortController();
  const fetchImpl = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    setTimeout(() => ctrl.abort(), 5);
  });
  await assert.rejects(fetchOverpass("x", { fetchImpl, signal: ctrl.signal, timeoutMs: 1000 }), { name: "AbortError" });
});

test("ID-Abfrage für alte Favoriten", () => {
  const q = idsQuery(["node/1", "way/2", "relation/3", "node/4", "bogus/5", "node/x"]);
  assert.match(q, /node\(id:1,4\);way\(id:2\);rel\(id:3\);/);
  assert.equal(idsQuery([]), null);
});

test("Hash ist stabil", () => {
  assert.equal(hashString("abc"), hashString("abc"));
  assert.notEqual(hashString("abc"), hashString("abd"));
  assert.match(hashString(""), /^[0-9a-f]{8}$/);
});
