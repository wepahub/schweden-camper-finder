import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGpx, parseGpx, favoritesFromGpx, buildBackup, parseBackup, mergeInto, migrateLegacy, favoriteFromResult
} from "../js/backup.js";

test("GPX hin und zurück, inklusive Sonderzeichen", () => {
  const gpx = buildGpx([{ lat: 59.1, lon: 17.2, name: "Bad <Ö> & Co", desc: "Notiz \"x\"", type: "bathing" }], "Reise");
  assert.match(gpx, /&lt;Ö&gt; &amp; Co/);
  const pts = parseGpx(gpx);
  assert.equal(pts.length, 1);
  assert.equal(pts[0].name, "Bad <Ö> & Co");
  assert.equal(pts[0].desc, "Notiz \"x\"");
  assert.equal(pts[0].lat, 59.1);
});

test("GPX von anderen Apps (lon vor lat, self-closing, CDATA)", () => {
  const pts = parseGpx(`<gpx><wpt lon='12.5' lat='57.7'><name><![CDATA[Ställplats]]></name><cmt>gratis</cmt></wpt><wpt lat="1" lon="2"/></gpx>`);
  assert.equal(pts.length, 2);
  assert.equal(pts[0].name, "Ställplats");
  assert.equal(pts[0].desc, "gratis");
  const favs = favoritesFromGpx(pts);
  assert.match(favs[0].id, /^gpx\//);
  assert.equal(favs[0].favorite, true);
});

test("JSON-Backup prüfen und zusammenführen", () => {
  const fav = { id: "node/1", lat: 59, lon: 18, name: "A", favorite: true, note: "" };
  const json = JSON.stringify(buildBackup({ "node/1": fav }, [{ id: "t1", name: "Sommer", stops: ["node/1"] }], "4.0.0"));
  const data = parseBackup(json);
  const favs = { "node/1": { ...fav, note: "behalten" } };
  const trips = [{ id: "t1", name: "Sommer", stops: ["node/2"] }];
  const added = mergeInto(favs, trips, data);
  assert.equal(added, 0);
  assert.equal(favs["node/1"].note, "behalten");
  assert.deepEqual(trips[0].stops, ["node/2", "node/1"]);
  assert.throws(() => parseBackup('{"foo":1}'));
});

test("Migration aus v3.1", () => {
  const old = { "node/1": { favorite: true, note: "" }, "node/2": { favorite: false, note: "x" }, "node/3": { favorite: false, note: "" } };
  const last = { results: [{ id: "node/1", lat: 59, lon: 18, catKey: "toilets", name: "WC", tags: { amenity: "toilets", foo: "bar" } }] };
  const { favorites, unresolved } = migrateLegacy(old, last);
  assert.equal(favorites["node/1"].lat, 59);
  assert.equal(favorites["node/1"].tags.foo, undefined);
  assert.deepEqual(unresolved, [{ id: "node/2", favorite: false, note: "x" }]);
});

test("favoriteFromResult behält bestehende Notiz", () => {
  const f = favoriteFromResult({ id: "n/1", lat: 1, lon: 2, catKey: "water", tags: {} }, { note: "n", favorite: true, addedAt: 5 });
  assert.equal(f.note, "n");
  assert.equal(f.addedAt, 5);
});
