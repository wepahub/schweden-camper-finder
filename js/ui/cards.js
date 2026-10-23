/* ── Darstellung eines Ortes: Texte, Badges, Ergebniskarte, Detailansicht ── */

import { CATEGORIES } from "../config.js";
import { t, getLanguage } from "../i18n.js";
import { formatDist, compassArrow, compassIndex } from "../geo.js";
import { openingStatus, formatMinutes } from "../hours.js";
import { h, isIOS } from "./dom.js";

const COMPASS = {
  de: ["N", "NO", "O", "SO", "S", "SW", "W", "NW"],
  en: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
  sv: ["N", "NO", "Ö", "SO", "S", "SV", "V", "NV"]
};
export const compassName = b => (COMPASS[getLanguage()] || COMPASS.de)[compassIndex(b)];
export const dist = m => formatDist(m, getLanguage());

export function catInfo(key) {
  const c = CATEGORIES[key];
  return c ? { icon: c.icon, color: c.color, label: t(`cat.${key}`) } : { icon: "📌", color: "#64748b", label: t("cat.custom") };
}
export const isIcaMaxi = p => p.store?.key === "ica-maxi";
export const iconFor = p => p.store?.icon || catInfo(p.catKey).icon;
export const colorFor = p => p.store?.color || catInfo(p.catKey).color;
export const displayName = p => p.name || t("common.unnamed", { cat: catInfo(p.catKey).label });

const YES = v => v === "yes" || v === "designated";

export function metaText(p) {
  const cat = catInfo(p.catKey).label;
  if (p.offRoute) return `${cat} · ${t("card.along", { km: Math.round((p.along || 0) / 1000), off: dist(p.distance) })}`;
  if (p.distance == null) return cat;
  const entry = p.entryPoint ? ` · ${t("card.entry")}` : "";
  return `${cat} · ${compassArrow(p.bearing)} ${dist(p.distance)} ${compassName(p.bearing)}${entry}`;
}

export function hoursBadge(oh, now = new Date()) {
  const s = openingStatus(oh, now);
  if (!s) return null;
  if (s.alwaysOpen) return { text: "24/7", cls: "green" };
  if (s.open) return { text: s.closesAt != null ? t("badge.closesAt", { t: formatMinutes(s.closesAt) }) : t("badge.open"), cls: "green" };
  if (s.opensAt != null) {
    return { text: t(s.opensTomorrow ? "badge.opensTomorrow" : "badge.opensAt", { t: formatMinutes(s.opensAt) }), cls: "gray" };
  }
  return { text: t("badge.closed"), cls: "gray" };
}

export function badgesFor(p, now = new Date()) {
  const tg = p.tags || {};
  const b = [];
  if (isIcaMaxi(p)) b.push({ text: "⭐ ICA Maxi", cls: "ica" });
  else if (p.store) b.push({ text: p.store.label, cls: "" });
  const hb = hoursBadge(tg.opening_hours, now);
  if (hb) b.push(hb);
  if (tg.fee === "no") b.push({ text: t("badge.free"), cls: "green" });
  else if (tg.fee === "yes") b.push({ text: t("badge.fee"), cls: "gray" });
  if (YES(tg.motorhome)) b.push({ text: `🚐 ${t("badge.motorhome")}`, cls: "green" });
  else if (tg.motorhome === "no") b.push({ text: `🚫 ${t("badge.noMotorhome")}`, cls: "red" });
  if (tg.tourism === "camp_site" && tg.tents === "yes" && tg.caravans === "no" && tg.motorhome === "no") {
    b.push({ text: `⛺ ${t("badge.tentOnly")}`, cls: "red" });
  }
  if (tg["fuel:lpg"] === "yes") b.push({ text: `🔥 ${t("badge.lpg")}`, cls: "green" });
  if (tg.power_supply === "yes") b.push({ text: `🔌 ${t("badge.power")}`, cls: "" });
  if (p.catKey !== "dump" && /^(yes|public|customers)$/.test(tg.sanitary_dump_station || "")) b.push({ text: `🪣 ${t("badge.dump")}`, cls: "" });
  if (p.catKey !== "water" && tg.drinking_water === "yes") b.push({ text: `💧 ${t("badge.water")}`, cls: "" });
  if (p.catKey !== "toilets" && tg.toilets === "yes") b.push({ text: `🚻 ${t("badge.toilets")}`, cls: "" });
  if (p.catKey !== "shower" && (tg.shower === "yes" || tg.shower === "hot")) b.push({ text: `🚿 ${t("badge.shower")}`, cls: "" });
  const mh = parseFloat(String(tg.maxheight || "").replace(",", "."));
  if (Number.isFinite(mh) && mh > 0 && mh < 4.5) b.push({ text: t("badge.maxheight", { h: mh.toLocaleString(getLanguage()) }), cls: "yellow" });
  if (tg.wheelchair === "yes") b.push({ text: `♿ ${t("badge.wheelchair")}`, cls: "" });
  if (p.favorite) b.push({ text: `★ ${t("badge.favorite")}`, cls: "yellow" });
  return b;
}

export function nearbyText(p) {
  return (p.nearby || []).map(n => `${catInfo(n.catKey).icon} ${catInfo(n.catKey).label} ${dist(n.d)}`).join(" · ");
}

export function extrasFor(p) {
  const tg = p.tags || {};
  const ex = [];
  if (tg.opening_hours && tg.opening_hours !== "24/7") ex.push(t("extra.hours", { v: tg.opening_hours }));
  if (tg.fee && !["yes", "no"].includes(tg.fee)) ex.push(t("extra.fee", { v: tg.fee }));
  if (tg.access && !["yes", "public", "permissive"].includes(tg.access)) ex.push(t("extra.access", { v: tg.access }));
  const nb = nearbyText(p);
  if (nb) ex.push(nb);
  if (p.note) ex.push(`📝 ${p.note}`);
  if (CATEGORIES[p.catKey]?.signCheck) ex.push(t("extra.signs"));
  return ex.join(" · ");
}

export function navUrl(p, app) {
  const ll = `${p.lat},${p.lon}`;
  switch (app) {
    case "apple": return `https://maps.apple.com/?daddr=${ll}`;
    case "waze": return `https://waze.com/ul?ll=${ll}&navigate=yes`;
    case "geo": return `geo:${ll}?q=${ll}(${encodeURIComponent(displayName(p))})`;
    default: return `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
  }
}
export const primaryNavUrl = p => navUrl(p, isIOS() ? "apple" : "google");
export function osmUrl(p) {
  if (p.osmType && p.osmId) return `https://www.openstreetmap.org/${p.osmType}/${p.osmId}`;
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=17/${p.lat}/${p.lon}`;
}

export function safeUrl(v) {
  if (!v) return null;
  const s = String(v).trim().split(";")[0];
  if (/^https?:\/\//i.test(s)) return s;
  if (/^www\./i.test(s)) return `https://${s}`;
  return null;
}

function badgeNodes(p, now) {
  return badgesFor(p, now).map(b => h("span", { class: `badge ${b.cls}` }, b.text));
}

export function markerHtml(p) {
  const ica = isIcaMaxi(p);
  // Icon und Farbe stammen aus der eigenen Konfiguration, nicht aus OSM-Daten
  return {
    html: `<div class="marker-dot${ica ? " marker-ica" : ""}${p.favorite ? " marker-fav" : ""}" style="background:${colorFor(p)}">${iconFor(p)}</div>`,
    highlight: ica
  };
}

/*
  handlers: { onFocus, onDetails, onFav, onNote, onShare, onTrip }
*/
export function buildCard(p, handlers, now = new Date()) {
  const color = colorFor(p);
  const name = displayName(p);
  const extra = extrasFor(p);
  const body = h("div", {
    class: "card-body", role: "button", tabindex: "0",
    "aria-label": `${name}, ${metaText(p)}`,
    onclick: () => handlers.onFocus?.(p),
    onkeydown: e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlers.onFocus?.(p); } }
  },
    h("div", { class: "card-top" },
      h("div", { class: "card-icon", style: { background: `${color}2e` }, "aria-hidden": "true" }, iconFor(p)),
      h("div", { class: "card-info" },
        h("strong", { class: "result-title" }, name),
        h("span", { class: "result-meta" }, metaText(p)),
        h("span", { class: "result-badges" }, badgeNodes(p, now)),
        extra ? h("span", { class: "result-extra" }, extra) : null
      )
    )
  );

  const actions = h("div", { class: "card-actions" },
    h("a", { class: "act act-primary", href: primaryNavUrl(p), target: "_blank", rel: "noopener" }, `🧭 ${t("card.nav")}`),
    h("button", { type: "button", class: "act", onclick: () => handlers.onDetails?.(p) }, `ℹ️ ${t("card.details")}`),
    h("button", {
      type: "button", class: `act fav-btn${p.favorite ? " active" : ""}`, "aria-pressed": String(Boolean(p.favorite)),
      onclick: () => handlers.onFav?.(p)
    }, `${p.favorite ? "★" : "☆"} ${t("card.fav")}`),
    h("button", { type: "button", class: "act", onclick: () => handlers.onNote?.(p) }, `✏️ ${t("card.note")}${p.note ? " ✓" : ""}`),
    handlers.onTrip ? h("button", { type: "button", class: "act", onclick: () => handlers.onTrip(p) }, `🗺 ${t("card.trip")}`) : null,
    navigator.share ? h("button", { type: "button", class: "act", onclick: () => handlers.onShare?.(p) }, `↗ ${t("card.share")}`) : null
  );

  return h("article", { class: `result-card${isIcaMaxi(p) ? " is-ica" : ""}`, dataset: { id: p.id } },
    body, h("div", { class: "card-divider" }), actions);
}

export function buildPopup(p, { onDetails }) {
  return h("div", { class: "popup" },
    h("p", { class: "popup-title" }, `${iconFor(p)} ${displayName(p)}`),
    h("p", { class: "popup-meta" }, metaText(p)),
    h("div", { class: "popup-actions" },
      h("a", { href: primaryNavUrl(p), target: "_blank", rel: "noopener" }, `🧭 ${t("common.navigate")}`),
      h("button", { type: "button", onclick: () => onDetails(p) }, `ℹ️ ${t("common.details")}`)
    )
  );
}

const yesNo = v => (v === "yes" ? t("value.yes") : v === "no" ? t("value.no") : v);

export function buildDetail(p, handlers, now = new Date()) {
  const tg = p.tags || {};
  const rows = [];
  const row = (key, value) => { if (value != null && value !== "") rows.push([t(key), value]); };

  if (tg.opening_hours) {
    const hb = hoursBadge(tg.opening_hours, now);
    row("detail.hours", h("span", {}, tg.opening_hours, hb ? h("span", { class: `badge ${hb.cls}` }, hb.text) : null));
  }
  const street = [tg["addr:street"], tg["addr:housenumber"]].filter(Boolean).join(" ");
  const city = [tg["addr:postcode"], tg["addr:city"]].filter(Boolean).join(" ");
  row("detail.address", [street, city].filter(Boolean).join(", "));
  const phone = tg.phone || tg["contact:phone"];
  if (phone) row("detail.phone", h("a", { href: `tel:${phone.split(";")[0].replace(/\s/g, "")}` }, phone));
  const web = safeUrl(tg.website || tg["contact:website"] || tg.url);
  if (web) row("detail.website", h("a", { href: web, target: "_blank", rel: "noopener" }, web.replace(/^https?:\/\//, "")));
  const email = tg.email || tg["contact:email"];
  if (email && /^[^\s@]+@[^\s@]+$/.test(email)) row("detail.email", h("a", { href: `mailto:${email}` }, email));
  row("detail.fee", tg.fee ? [yesNo(tg.fee), tg.charge].filter(Boolean).join(" · ") : null);
  row("detail.capacity", tg.capacity);
  row("detail.motorhome", tg.motorhome && yesNo(tg.motorhome));
  row("detail.caravans", tg.caravans && yesNo(tg.caravans));
  row("detail.power", tg.power_supply && yesNo(tg.power_supply));
  row("detail.shower", tg.shower && yesNo(tg.shower));
  row("detail.toilets", p.catKey !== "toilets" && tg.toilets ? yesNo(tg.toilets) : null);
  row("detail.water", tg.drinking_water && yesNo(tg.drinking_water));
  row("detail.dump", p.catKey !== "dump" && tg.sanitary_dump_station ? yesNo(tg.sanitary_dump_station) : null);
  row("detail.lpg", tg["fuel:lpg"] && yesNo(tg["fuel:lpg"]));
  row("detail.maxheight", tg.maxheight ? `${tg.maxheight} m` : null);
  row("detail.wheelchair", tg.wheelchair && yesNo(tg.wheelchair));
  row("detail.dog", tg.dog && yesNo(tg.dog));
  row("detail.internet", tg.internet_access && yesNo(tg.internet_access));
  row("detail.network", tg.network);
  row("detail.operator", tg.operator);
  row("detail.description", tg.description || tg["description:de"] || tg["description:en"]);
  row("detail.nearby", nearbyText(p));
  const coords = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
  row("detail.coordinates", h("span", {}, coords, " ",
    h("button", { type: "button", class: "link-btn", onclick: () => handlers.onCopy?.(coords) }, `📋 ${t("detail.copy")}`)));

  const navApps = [["google", "Google Maps"], ["apple", t("nav.apple")], ["waze", "Waze"]];
  if (/Android/i.test(navigator.userAgent)) navApps.push(["geo", t("nav.other")]);

  return h("div", { class: "detail" },
    h("div", { class: "detail-head" },
      h("div", { class: "card-icon big", style: { background: `${colorFor(p)}2e` }, "aria-hidden": "true" }, iconFor(p)),
      h("div", {},
        h("h2", { id: "detailTitle" }, displayName(p)),
        h("p", { class: "result-meta" }, metaText(p)),
        h("span", { class: "result-badges" }, badgeNodes(p, now))
      )
    ),
    p.note ? h("p", { class: "detail-note" }, `📝 ${p.note}`) : null,
    rows.length ? h("dl", { class: "detail-rows" }, rows.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])) : null,
    h("h3", {}, t("detail.navigateWith")),
    h("div", { class: "detail-actions" },
      navApps.map(([app, label]) => h("a", { class: "act act-primary", href: navUrl(p, app), target: "_blank", rel: "noopener" }, label))
    ),
    h("h3", {}, t("detail.links")),
    h("div", { class: "detail-actions" },
      h("button", { type: "button", class: `act fav-btn${p.favorite ? " active" : ""}`, onclick: () => handlers.onFav?.(p) },
        `${p.favorite ? "★" : "☆"} ${t("card.fav")}`),
      h("button", { type: "button", class: "act", onclick: () => handlers.onNote?.(p) }, `✏️ ${t("card.note")}`),
      h("button", { type: "button", class: "act", onclick: () => handlers.onTrip?.(p) }, `🗺 ${t("card.trip")}`),
      navigator.share ? h("button", { type: "button", class: "act", onclick: () => handlers.onShare?.(p) }, `↗ ${t("card.share")}`) : null,
      h("a", { class: "act", href: osmUrl(p), target: "_blank", rel: "noopener" }, "🗺 OpenStreetMap")
    )
  );
}
