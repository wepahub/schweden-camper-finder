import { test } from "node:test";
import assert from "node:assert/strict";
import { openingStatus, parseOpeningHours, formatMinutes } from "../js/hours.js";

// 2026-07-15 ist ein Mittwoch
const at = (iso) => new Date(iso);

test("24/7 ist immer offen", () => {
  assert.deepEqual(openingStatus("24/7", at("2026-07-15T03:00")), { open: true, alwaysOpen: true });
});

test("einfacher Wochentagsbereich", () => {
  const oh = "Mo-Fr 08:00-20:00";
  assert.equal(openingStatus(oh, at("2026-07-15T10:00")).open, true);
  assert.equal(openingStatus(oh, at("2026-07-15T10:00")).closesAt, 20 * 60);
  assert.equal(openingStatus(oh, at("2026-07-15T21:00")).open, false);
  // Samstag geschlossen, öffnet erst Montag → kein "morgen"
  const sat = openingStatus(oh, at("2026-07-18T10:00"));
  assert.equal(sat.open, false);
  assert.equal(sat.opensAt, undefined);
});

test("öffnet später heute / morgen", () => {
  const oh = "Mo-Su 09:00-18:00";
  assert.deepEqual(openingStatus(oh, at("2026-07-15T07:30")), { open: false, opensAt: 540, uncertain: false });
  const late = openingStatus(oh, at("2026-07-15T19:00"));
  assert.equal(late.opensTomorrow, true);
  assert.equal(late.opensAt, 540);
});

test("mehrere Regeln, Tageslisten und mehrere Zeitspannen", () => {
  const oh = "Mo,We,Fr 08:00-12:00,13:00-17:00; Sa 10:00-14:00";
  assert.equal(openingStatus(oh, at("2026-07-15T12:30")).open, false); // Mittagspause
  assert.equal(openingStatus(oh, at("2026-07-15T13:30")).open, true);
  assert.equal(openingStatus(oh, at("2026-07-14T10:00")).open, false); // Dienstag
  assert.equal(openingStatus(oh, at("2026-07-18T11:00")).open, true); // Samstag
});

test("über Mitternacht", () => {
  const oh = "Fr-Sa 18:00-02:00";
  assert.equal(openingStatus(oh, at("2026-07-17T23:00")).open, true); // Freitag
  const sat1am = openingStatus(oh, at("2026-07-18T01:00")); // Samstag 1 Uhr, von Freitag
  assert.equal(sat1am.open, true);
  assert.equal(sat1am.closesAt, 120);
  assert.equal(openingStatus(oh, at("2026-07-19T01:00")).open, true); // Sonntag 1 Uhr, von Samstag
  assert.equal(openingStatus(oh, at("2026-07-20T01:00")).open, false); // Montag
});

test("Wochenbereich über das Wochenende", () => {
  const oh = "Sa-Mo 10:00-16:00";
  assert.equal(openingStatus(oh, at("2026-07-19T11:00")).open, true); // So
  assert.equal(openingStatus(oh, at("2026-07-20T11:00")).open, true); // Mo
  assert.equal(openingStatus(oh, at("2026-07-21T11:00")).open, false); // Di
});

test("off überschreibt frühere Regel", () => {
  const oh = "Mo-Su 08:00-22:00; Su off";
  assert.equal(openingStatus(oh, at("2026-07-19T12:00")).open, false);
  assert.equal(openingStatus(oh, at("2026-07-18T12:00")).open, true);
});

test("saisonale Monate (Campingplatz)", () => {
  const oh = "May-Sep: Mo-Su 08:00-21:00";
  assert.equal(openingStatus(oh, at("2026-07-15T12:00")).open, true);
  assert.equal(openingStatus(oh, at("2026-11-15T12:00")).open, false);
  assert.equal(openingStatus("Jun-Aug 24/7", at("2026-07-01T03:00")).open, true);
});

test("PH wird ignoriert, Tage daneben bleiben gültig", () => {
  assert.equal(openingStatus("Mo-Fr 08:00-17:00; PH off", at("2026-07-15T09:00")).open, true);
  assert.equal(openingStatus("Mo-Fr,PH 08:00-17:00", at("2026-07-15T09:00")).open, true);
});

test("zusätzliche Regel mit Komma", () => {
  const oh = "Mo-Fr 08:00-12:00, We 14:00-18:00";
  assert.equal(openingStatus(oh, at("2026-07-15T15:00")).open, true);
  assert.equal(openingStatus(oh, at("2026-07-15T10:00")).open, true);
  assert.equal(openingStatus(oh, at("2026-07-14T15:00")).open, false);
});

test("offenes Ende", () => {
  const s = openingStatus("Mo-Su 10:00+", at("2026-07-15T22:00"));
  assert.equal(s.open, true);
  assert.equal(s.uncertain, true);
});

test("Nur Uhrzeit gilt für jeden Tag", () => {
  assert.equal(openingStatus("06:00-22:00", at("2026-07-19T07:00")).open, true);
});

test("unbekannte Formate → null statt falschem „geschlossen“", () => {
  for (const v of ["sunrise-sunset", 'Mo-Fr 08:00-17:00 "nach Absprache"', "Dec 24 off", "week 1-20 Mo 10:00-12:00", "", null, "by appointment"]) {
    assert.equal(openingStatus(v, at("2026-07-15T12:00")), null, String(v));
  }
});

test("Parser-Cache liefert dasselbe Ergebnis", () => {
  assert.equal(parseOpeningHours("Mo 10:00-11:00"), parseOpeningHours("Mo 10:00-11:00"));
});

test("formatMinutes", () => {
  assert.equal(formatMinutes(0), "00:00");
  assert.equal(formatMinutes(1290), "21:30");
  assert.equal(formatMinutes(1440), "00:00");
});
