/* ── Lokale Speicherung (localStorage, immer abgesichert) ── */

import { migrateLegacy } from "./backup.js";

const KEYS = {
  favorites: "scf:v4:favorites",
  trips: "scf:v4:trips",
  settings: "scf:v4:settings",
  last: "scf:v4:last",
  unresolved: "scf:v4:unresolved",
  areas: "scf:v4:areas"
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

let favCache = null;

export const storage = {
  favorites() {
    if (!favCache) favCache = read(KEYS.favorites, {});
    return favCache;
  },
  saveFavorites(favs = favCache) { favCache = favs; return write(KEYS.favorites, favs); },

  trips() { return read(KEYS.trips, []); },
  saveTrips(trips) { return write(KEYS.trips, trips); },

  settings() { return read(KEYS.settings, {}); },
  saveSettings(patch) { return write(KEYS.settings, { ...this.settings(), ...patch }); },

  last() { return read(KEYS.last, null); },
  saveLast(data) {
    if (write(KEYS.last, data)) return true;
    // Speicher voll → mit weniger Ergebnissen erneut versuchen
    return write(KEYS.last, { ...data, results: (data.results || []).slice(0, 80) });
  },

  unresolved() { return read(KEYS.unresolved, []); },
  saveUnresolved(list) { return write(KEYS.unresolved, list); },

  areas() { return read(KEYS.areas, []); },
  saveAreas(list) { return write(KEYS.areas, list); },

  // Übernahme der Daten aus v3.x
  migrate() {
    try {
      if (localStorage.getItem(KEYS.favorites) != null) return;
      const oldFavs = read("scf:favorites", null);
      if (!oldFavs) return;
      const { favorites, unresolved } = migrateLegacy(oldFavs, read("scf:lastResults:v13", null));
      this.saveFavorites(favorites);
      if (unresolved.length) this.saveUnresolved(unresolved);
    } catch { /* ohne Storage nichts zu migrieren */ }
  }
};
