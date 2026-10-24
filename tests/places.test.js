import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify, normalize, applySafety, enrichNearby, passesFilters, sortResults, projectOnRoute, nearestToLine, inArea
} from "../js/places.js";

const origin = { lat: 59.85, lon: 17.63 };

test("Hauptmerkmal schlägt Nebenmerkmal (Campingplatz mit WC bleibt Campingplatz)", () => {
  assert.equal(classify({ tourism: "camp_site", toilets: "yes" }, ["toilets", "camping"]), "camping");
  assert.equal(classify({ amenity: "fuel", toilets: "yes" }, ["toilets", "camping"]), "toilets");
  assert.equal(classify({ amenity: "fuel", toilets: "yes" }, ["fuel", "toilets"]), "fuel");
});

test("Ausschlussfilter", () => {
  assert.equal(classify({ amenity: "parking", parking: "underground" }, ["parking"]), null);
  assert.equal(classify({ amenity: "shelter", shelter_type: "public_transport" }, ["shelter"]), null);
  assert.equal(classify({ amenity: "shelter", shelter_type: "lean_to" }, ["shelter"]), "shelter");
  assert.equal(classify({ amenity: "place_of_worship", religion: "muslim" }, ["church"]), null);
});

test("normalize: Entfernung, ICA Maxi, Duplikate", () => {
  const els = [
    { type: "node", id: 1, lat: 59.851, lon: 17.63, tags: { shop: "supermarket", name: "ICA Maxi Stormarknad" } },
    { type: "node", id: 1, lat: 59.851, lon: 17.63, tags: { shop: "supermarket", name: "ICA Maxi Stormarknad" } },
    { type: "way", id: 2, center: { lat: 59.86, lon: 17.63 }, tags: { amenity: "toilets" } },
    { type: "node", id: 3, lat: 59.86, lon: 17.63, tags: { amenity: "bench" } }
  ];
  const r = normalize(els, ["food", "toilets"], origin);
  assert.equal(r.length, 2);
  const ica = r.find(x => x.catKey === "food");
  assert.equal(ica.store.key, "ica-maxi");
  assert.ok(ica.distance > 100 && ica.distance < 120);
  assert.equal(r.find(x => x.catKey === "toilets").name, null);
});

test("Wanderroute: nächster Einstieg statt Mittelpunkt", () => {
  const els = [
    { type: "relation", id: 9, center: { lat: 62, lon: 15 }, tags: { type: "route", route: "hiking", name: "Leden" },
      members: [{ type: "way", ref: 100 }, { type: "way", ref: 101 }] },
    { type: "way", id: 100, geometry: [{ lat: 59.9, lon: 17.63 }, { lat: 59.88, lon: 17.63 }], tags: { highway: "path" } },
    { type: "way", id: 101, geometry: [{ lat: 59.87, lon: 17.64 }], tags: { highway: "path" } }
  ];
  const r = normalize(els, ["hiking"], origin);
  assert.equal(r.length, 1);
  assert.equal(r[0].entryPoint, true);
  assert.equal(r[0].lat, 59.87);
  assert.ok(r[0].distance < 2500);
});

test("Zugang privat wird ausgefiltert", () => {
  assert.equal(applySafety({ tags: { access: "private" } }), false);
  assert.equal(applySafety({ tags: { access: "customers" } }), true);
});

test("Nützliches in der Nähe (Raster)", () => {
  const els = [
    { type: "node", id: 1, lat: 59.85, lon: 17.63, tags: { leisure: "swimming_area" } },
    { type: "node", id: 2, lat: 59.851, lon: 17.63, tags: { amenity: "toilets" } },
    { type: "node", id: 3, lat: 59.8505, lon: 17.63, tags: { amenity: "toilets" } },
    { type: "node", id: 4, lat: 59.87, lon: 17.63, tags: { amenity: "drinking_water" } }
  ];
  const r = normalize(els, ["bathing", "toilets", "water"], origin);
  const before = r.find(x => x.catKey === "bathing").score;
  enrichNearby(r);
  const bath = r.find(x => x.catKey === "bathing");
  assert.deepEqual(bath.nearby.map(n => n.catKey), ["toilets"]);
  assert.ok(bath.nearby[0].d < 60);
  assert.equal(bath.score, before + 8);
});

test("Schnellfilter", () => {
  const p = { catKey: "camping", tags: { fee: "no", opening_hours: "24/7", motorhome: "yes" }, nearby: [{ catKey: "water", d: 50 }] };
  assert.ok(passesFilters(p, new Set(["free", "open", "h24", "water", "motorhome"])));
  assert.ok(!passesFilters(p, new Set(["toilets"])));
  assert.ok(!passesFilters(p, new Set(["lpg"])));
});

test("Sortierung", () => {
  const list = [{ distance: 5, score: 1 }, { distance: 1, score: 2 }, { distance: 3, score: 9 }];
  assert.deepEqual(sortResults([...list], "distance").map(x => x.distance), [1, 3, 5]);
  assert.deepEqual(sortResults([...list], "score").map(x => x.score), [9, 2, 1]);
});

test("Route: Position entlang und Abstand", () => {
  const line = [{ lat: 59, lon: 17 }, { lat: 59, lon: 18 }];
  const r = projectOnRoute([{ lat: 59.005, lon: 17.5 }, { lat: 59.2, lon: 17.1 }], line);
  assert.ok(r[0].distance < 600 && r[0].along > 25000);
  assert.ok(inArea(r[0], { radius: 1000 }));
  assert.ok(!inArea(r[1], { radius: 1000 }));
  const pick = nearestToLine(line);
  assert.equal(pick([{ lat: 59.5, lon: 17 }, { lat: 59.01, lon: 17.2 }]).lat, 59.01);
});
