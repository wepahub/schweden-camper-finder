import { test } from "node:test";
import assert from "node:assert/strict";
import {
  haversine, bearingTo, compassArrow, formatDist, formatDuration, simplifyLine, simplifyToMax,
  projectOnLine, lineLength, sunTimes, tilesForBounds, boundsAround, nearestPoint
} from "../js/geo.js";

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b} (±${tol})`);

test("haversine Uppsala–Stockholm ≈ 64 km", () => {
  near(haversine(59.8586, 17.6389, 59.3293, 18.0686), 64500, 1500);
});

test("Himmelsrichtung", () => {
  near(bearingTo(59, 18, 60, 18), 0, 0.01);
  near(bearingTo(59, 18, 59, 19), 90, 1);
  assert.equal(compassArrow(44), "↗");
  assert.equal(compassArrow(350), "↑");
});

test("Formatierung", () => {
  assert.equal(formatDist(350), "350 m");
  assert.equal(formatDist(2345, "de"), "2,3 km");
  assert.equal(formatDist(2345, "en"), "2.3 km");
  assert.equal(formatDist(123456, "de"), "123 km");
  assert.equal(formatDuration(3 * 3600 + 5 * 60), "3 h 05 min");
  assert.equal(formatDuration(600), "10 min");
});

test("Linie vereinfachen behält Ecken", () => {
  const line = [];
  for (let i = 0; i <= 100; i++) line.push({ lat: 59, lon: 18 + i * 0.001 });
  for (let i = 1; i <= 100; i++) line.push({ lat: 59 + i * 0.001, lon: 18.1 });
  const s = simplifyLine(line, 10);
  assert.equal(s.length, 3);
  assert.ok(simplifyToMax(line, 2).length <= 2);
});

test("Projektion auf Linie: Position und Abstand", () => {
  const line = [{ lat: 59, lon: 18 }, { lat: 59, lon: 18.2 }];
  const p = projectOnLine({ lat: 59.01, lon: 18.1 }, line);
  near(p.offset, 1113, 15);
  near(p.along, lineLength(line) / 2, 30);
});

test("nächster Punkt", () => {
  const r = nearestPoint({ lat: 59, lon: 18 }, [{ lat: 60, lon: 18 }, { lat: 59.1, lon: 18 }]);
  assert.equal(r.point.lat, 59.1);
});

test("Sonnenzeiten Stockholm Mittsommer & Mitternachtssonne in Kiruna", () => {
  const sthlm = sunTimes(new Date("2026-06-21T12:00:00Z"), 59.33, 18.07);
  // Sonnenuntergang ca. 20:08 UTC
  near(sthlm.sunset.getUTCHours() * 60 + sthlm.sunset.getUTCMinutes(), 20 * 60 + 8, 10);
  near(sthlm.sunrise.getUTCHours() * 60 + sthlm.sunrise.getUTCMinutes(), 1 * 60 + 31, 10);
  assert.equal(sunTimes(new Date("2026-06-21T12:00:00Z"), 67.85, 20.22).polarDay, true);
  assert.equal(sunTimes(new Date("2026-12-21T12:00:00Z"), 69.0, 20.0).polarNight, true);
});

test("Kacheln für Gebiet", () => {
  const tiles = tilesForBounds(boundsAround(59.86, 17.64, 15000), [9, 10, 11, 12]);
  assert.ok(tiles.length > 4 && tiles.length < 80, String(tiles.length));
});
