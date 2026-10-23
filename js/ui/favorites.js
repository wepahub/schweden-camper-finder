/* ── Tab „Favoriten“: Reisen und alle gespeicherten Orte ── */

import { t } from "../i18n.js";
import { favorites, trips } from "../favorites.js";
import { haversine, bearingTo } from "../geo.js";
import { buildGpx } from "../backup.js";
import { h, clear, download } from "./dom.js";
import { buildCard, catInfo, displayName, dist, iconFor } from "./cards.js";

// Favoriten mit Entfernung/Richtung vom aktuellen Bezugspunkt
export function favoritesWithDistance(origin) {
  return favorites.list().map(f => ({
    ...f,
    distance: haversine(origin.lat, origin.lon, f.lat, f.lon),
    bearing: bearingTo(origin.lat, origin.lon, f.lat, f.lon)
  })).sort((a, b) => a.distance - b.distance);
}

export function gpxForPlaces(places, name) {
  return buildGpx(places.map(p => ({
    lat: p.lat, lon: p.lon, name: displayName(p),
    desc: [catInfo(p.catKey).label, p.note].filter(Boolean).join(" – "),
    type: p.catKey
  })), name);
}

const fileSafe = s => String(s).replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "export";

/*
  ctx: { origin(), cardHandlers, onFocusPlace(p), onShowPlaces(list), onPlanRoute(from, to), refresh() }
*/
export function renderFavoritesTab(ctx) {
  renderTrips(ctx);
  const list = favoritesWithDistance(ctx.origin());
  document.getElementById("favCount").textContent = list.length ? String(list.length) : "";
  const box = clear(document.getElementById("favList"));
  if (!list.length) {
    box.append(h("p", { class: "empty" }, t("fav.empty")));
    return list;
  }
  list.forEach(p => box.append(buildCard(p, ctx.cardHandlers)));
  return list;
}

function renderTrips(ctx) {
  const box = clear(document.getElementById("tripList"));
  const all = trips.all();
  if (!all.length) {
    box.append(h("p", { class: "empty small" }, t("trip.none")));
    return;
  }
  all.forEach(trip => {
    const stops = trips.stops(trip);
    const meta = [t("trip.stops", { n: stops.length })];
    if (stops.length > 1) meta.push(t("trip.total", { km: dist(trips.length(trip)) }));

    const stopList = stops.length
      ? h("ol", { class: "trip-stops" }, stops.map((s, i) =>
          h("li", {},
            h("button", { type: "button", class: "trip-stop-name", onclick: () => ctx.onFocusPlace(s) },
              `${iconFor(s)} ${displayName(s)}`),
            h("span", { class: "trip-stop-tools" },
              h("button", { type: "button", class: "mini", disabled: i === 0, "aria-label": t("trip.up"),
                onclick: () => { trips.move(trip.id, s.id, -1); ctx.refresh(); } }, "↑"),
              h("button", { type: "button", class: "mini", disabled: i === stops.length - 1, "aria-label": t("trip.down"),
                onclick: () => { trips.move(trip.id, s.id, 1); ctx.refresh(); } }, "↓"),
              h("button", { type: "button", class: "mini", "aria-label": t("trip.remove"),
                onclick: () => { trips.removeStop(trip.id, s.id); ctx.refresh(); } }, "✕")
            )
          )))
      : h("p", { class: "empty small" }, t("trip.empty"));

    const gmaps = trips.googleMapsUrl(trip);
    const actions = h("div", { class: "btn-row" },
      stops.length ? h("button", { type: "button", class: "act", onclick: () => ctx.onShowPlaces(stops) }, `🗺 ${t("trip.showOnMap")}`) : null,
      gmaps ? h("a", {
        class: "act act-primary", href: gmaps, target: "_blank", rel: "noopener",
        onclick: () => { if (stops.length > 10) alert(t("trip.tooMany")); }
      }, `🧭 ${t("trip.route")}`) : null,
      stops.length > 1 ? h("button", { type: "button", class: "act",
        onclick: () => ctx.onPlanRoute(stops[0], stops[stops.length - 1]) }, `🛣 ${t("trip.planRoute")}`) : null,
      stops.length ? h("button", { type: "button", class: "act",
        onclick: () => download(`${fileSafe(trip.name)}.gpx`, gpxForPlaces(stops, trip.name), "application/gpx+xml") }, `⬇ ${t("trip.gpx")}`) : null,
      h("button", { type: "button", class: "act", onclick: () => {
        const name = prompt(t("trip.rename"), trip.name);
        if (name && name.trim()) { trips.rename(trip.id, name.trim()); ctx.refresh(); }
      } }, `✏️ ${t("trip.rename")}`),
      h("button", { type: "button", class: "act danger", onclick: () => {
        if (confirm(t("trip.deleteConfirm", { name: trip.name }))) { trips.remove(trip.id); ctx.refresh(); }
      } }, `🗑 ${t("trip.delete")}`)
    );

    const details = h("details", { class: "trip", dataset: { id: trip.id } },
      h("summary", {}, h("strong", {}, trip.name), h("span", { class: "trip-meta" }, meta.join(" · "))),
      stopList, actions);
    if (ctx.openTrips.has(trip.id)) details.open = true;
    details.addEventListener("toggle", () => {
      if (details.open) ctx.openTrips.add(trip.id); else ctx.openTrips.delete(trip.id);
    });
    box.append(details);
  });
}

// Dialog: Ort zu einer Reise hinzufügen
export function openTripDialog(place, { onDone }) {
  const dialog = document.getElementById("tripDialog");
  const list = clear(document.getElementById("tripChoices"));
  const input = document.getElementById("tripNewName");
  input.value = "";
  input.placeholder = t("trip.defaultName", { n: trips.all().length + 1 });

  const choose = trip => {
    favorites.update(place, { favorite: true });
    trips.addStop(trip.id, place.id);
    dialog.close();
    onDone(trip);
  };
  trips.all().forEach(trip => {
    list.append(h("button", { type: "button", class: "choice", onclick: () => choose(trip) },
      h("strong", {}, trip.name), h("span", {}, t("trip.stops", { n: trip.stops.length }))));
  });
  document.getElementById("tripCreateBtn").onclick = () => {
    const name = input.value.trim() || input.placeholder;
    choose(trips.create(name));
  };
  dialog.showModal();
}
