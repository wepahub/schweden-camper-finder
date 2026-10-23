/* ── Favoriten, Notizen und Reisen (Datenmodell) ── */

import { storage } from "./storage.js";
import { favoriteFromResult } from "./backup.js";
import { haversine } from "./geo.js";

export const favorites = {
  all: () => storage.favorites(),
  get: id => storage.favorites()[id] || null,
  list: () => Object.values(storage.favorites()).filter(f => f.favorite),

  // Ergebnisliste mit gespeicherten Favoriten/Notizen abgleichen
  apply(results) {
    const all = storage.favorites();
    results.forEach(r => {
      const f = all[r.id];
      r.favorite = Boolean(f?.favorite);
      r.note = f?.note || "";
    });
    return results;
  },

  update(place, patch) {
    const all = storage.favorites();
    const rec = { ...favoriteFromResult(place, all[place.id] || {}), ...patch };
    if (!rec.favorite && !rec.note && !trips.containsFav(place.id)) delete all[place.id];
    else all[place.id] = rec;
    return storage.saveFavorites(all) ? rec : null;
  },

  toggle(place) { return this.update(place, { favorite: !this.get(place.id)?.favorite }); },
  setNote(place, note) { return this.update(place, { note }); },
  restore(rec) {
    const all = storage.favorites();
    all[rec.id] = rec;
    storage.saveFavorites(all);
  }
};

const uid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const trips = {
  all: () => storage.trips(),
  get: id => storage.trips().find(t => t.id === id) || null,
  containsFav: id => storage.trips().some(t => t.stops.includes(id)),

  create(name) {
    const list = storage.trips();
    const trip = { id: uid(), name, createdAt: Date.now(), stops: [] };
    list.push(trip);
    storage.saveTrips(list);
    return trip;
  },

  mutate(id, fn) {
    const list = storage.trips();
    const trip = list.find(t => t.id === id);
    if (!trip) return null;
    fn(trip, list);
    storage.saveTrips(list.filter(t => !t._deleted));
    return trip;
  },

  addStop(id, favId) { return this.mutate(id, t => { if (!t.stops.includes(favId)) t.stops.push(favId); }); },
  removeStop(id, favId) { return this.mutate(id, t => { t.stops = t.stops.filter(s => s !== favId); }); },
  move(id, favId, delta) {
    return this.mutate(id, t => {
      const i = t.stops.indexOf(favId), j = i + delta;
      if (i < 0 || j < 0 || j >= t.stops.length) return;
      [t.stops[i], t.stops[j]] = [t.stops[j], t.stops[i]];
    });
  },
  rename(id, name) { return this.mutate(id, t => { t.name = name; }); },
  remove(id) { return this.mutate(id, t => { t._deleted = true; }); },

  stops(trip) {
    const all = storage.favorites();
    return trip.stops.map(id => all[id]).filter(Boolean);
  },

  // Luftlinie über alle Stopps
  length(trip) {
    const s = this.stops(trip);
    let sum = 0;
    for (let i = 1; i < s.length; i++) sum += haversine(s[i - 1].lat, s[i - 1].lon, s[i].lat, s[i].lon);
    return sum;
  },

  googleMapsUrl(trip) {
    const s = this.stops(trip).slice(0, 10).map(p => `${p.lat},${p.lon}`);
    if (!s.length) return null;
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("destination", s[s.length - 1]);
    if (s.length > 1) url.searchParams.set("origin", s[0]);
    if (s.length > 2) url.searchParams.set("waypoints", s.slice(1, -1).join("|"));
    url.searchParams.set("travelmode", "driving");
    return url.toString();
  }
};
