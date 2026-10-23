import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DICTIONARIES, t, setLanguage } from "../js/i18n.js";
import { CATEGORIES, MODES, QUICK_FILTERS, CATEGORY_GROUPS } from "../js/config.js";

const files = ["index.html", ...readdirSync("js").filter(f => f.endsWith(".js")).map(f => `js/${f}`),
  ...readdirSync("js/ui").map(f => `js/ui/${f}`)];

function usedKeys() {
  const keys = new Set();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bt\("([\w.]+)"/g)) keys.add(m[1]);
    for (const m of src.matchAll(/data-i18n(?:-placeholder|-aria|-title)?="([\w.]+)"/g)) keys.add(m[1]);
  }
  Object.keys(CATEGORIES).forEach(k => keys.add(`cat.${k}`));
  Object.keys(MODES).forEach(k => keys.add(`mode.${k}`));
  QUICK_FILTERS.forEach(k => keys.add(`filter.${k}`));
  CATEGORY_GROUPS.forEach(k => keys.add(`group.${k}`));
  ["tent", "vehicle", "offroad", "fire", "waste", "nature"].forEach(k => { keys.add(`allemans.${k}.t`); keys.add(`allemans.${k}.d`); });
  ["clear", "partly", "cloudy", "fog", "drizzle", "rain", "snow", "showers", "thunder", "unknown"].forEach(k => keys.add(`weather.code.${k}`));
  ["osm", "topo", "satellite"].forEach(k => keys.add(`map.layers.${k}`));
  return keys;
}

test("alle verwendeten Schlüssel gibt es auf Deutsch", () => {
  const missing = [...usedKeys()].filter(k => !(k in DICTIONARIES.de));
  assert.deepEqual(missing, []);
});

test("Englisch und Schwedisch sind vollständig", () => {
  for (const lang of ["en", "sv"]) {
    const missing = Object.keys(DICTIONARIES.de).filter(k => k !== "app.title" && !(k in DICTIONARIES[lang]));
    assert.deepEqual(missing, [], lang);
  }
});

test("Platzhalter stimmen in allen Sprachen überein", () => {
  const vars = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(",");
  for (const [key, de] of Object.entries(DICTIONARIES.de)) {
    for (const lang of ["en", "sv"]) {
      if (DICTIONARIES[lang][key] != null) assert.equal(vars(DICTIONARIES[lang][key]), vars(de), `${lang}:${key}`);
    }
  }
});

test("t ersetzt Platzhalter und fällt auf Deutsch zurück", () => {
  setLanguage("sv");
  assert.equal(t("status.results", { n: 3 }), "3 träffar");
  assert.equal(t("app.title"), "Schweden Camper Finder");
  setLanguage("de");
});
