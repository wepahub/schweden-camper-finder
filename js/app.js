"use strict";

/* ────────────────────────────────────────────────
   Schweden Camper Finder v3.0
   ──────────────────────────────────────────────── */

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter"
];

const CATEGORIES = {
  toilets: { label:"WC", icon:"🚻", color:"#3b82f6", bg:"rgba(59,130,246,.18)", queries:[["amenity","toilets"],["toilets","yes"]], scoreBase:60 },
  water:   { label:"Wasser", icon:"💧", color:"#06b6d4", bg:"rgba(6,182,212,.18)", queries:[["amenity","drinking_water"],["drinking_water","yes"]], scoreBase:45 },
  camping: { label:"Stellplatz", icon:"🏕", color:"#22c55e", bg:"rgba(34,197,94,.18)", queries:[["tourism","caravan_site"],["tourism","camp_site"]], scoreBase:55 },
  bathing: { label:"Baden", icon:"🏖", color:"#facc15", bg:"rgba(250,204,21,.18)", queries:[["leisure","swimming_area"],["natural","beach"],["leisure","beach_resort"]], scoreBase:45 },
  church:  { label:"Kirche", icon:"⛪", color:"#a78bfa", bg:"rgba(167,139,250,.18)", queries:[["amenity","place_of_worship"]], extraFilter: t => !t.religion || t.religion === "christian", scoreBase:25 },
  parking: { label:"Parkplatz", icon:"🅿", color:"#94a3b8", bg:"rgba(148,163,184,.18)", queries:[["amenity","parking"]], scoreBase:30 },
  picnic:  { label:"Pause", icon:"🧺", color:"#fb923c", bg:"rgba(251,146,60,.18)", queries:[["tourism","picnic_site"],["highway","rest_area"]], scoreBase:35 },
  food: {
    label:"Lebensmittel", icon:"🛒", color:"#22c55e", bg:"rgba(34,197,94,.18)",
    queries:[["shop","supermarket"],["shop","convenience"]],
    scoreBase:40
  },
  museum:  { label:"Museum", icon:"🏛", color:"#c084fc", bg:"rgba(192,132,252,.18)", queries:[["tourism","museum"]], scoreBase:45 },
  hiking: {
    label:"Wanderweg", icon:"🥾", color:"#84cc16", bg:"rgba(132,204,22,.18)",
    queries:[["route","hiking"],["route","foot"],["network","lwn"],["network","rwn"],["network","nwn"]],
    extraFilter: t => t.route === "hiking" || t.route === "foot" || ["lwn","rwn","nwn","iwn"].includes(t.network),
    scoreBase:35
  }
};

const MODES = {
  toilet:  ["toilets"],
  pause:   ["bathing","picnic","parking","toilets","water","food","museum","hiking"],
  evening: ["camping","parking","church","picnic","bathing","toilets","water","food"],
  supply:  ["toilets","water","food"]
};

// ICA Maxi detection — our favourite store gets special treatment
function detectStore(tags) {
  const v = [tags.name, tags.brand, tags.operator, tags["name:sv"], tags["official_name"]]
    .filter(Boolean).join(" ").toLowerCase();
  if (v.includes("ica maxi") || (v.includes("ica") && v.includes("maxi"))) {
    return { key:"ica-maxi", label:"ICA Maxi", icon:"⭐", color:"#16a34a", bonus:60 };
  }
  if (v.includes("ica")) return { key:"ica", label:"ICA", icon:"🛒", color:"#ef4444", bonus:20 };
  if (v.includes("coop")) return { key:"coop", label:"Coop", icon:"🛒", color:"#0ea5e9", bonus:8 };
  if (v.includes("willys")) return { key:"willys", label:"Willys", icon:"🛒", color:"#ef4444", bonus:6 };
  if (v.includes("hemköp") || v.includes("hemkop")) return { key:"hemkop", label:"Hemköp", icon:"🛒", color:"#f59e0b", bonus:6 };
  if (v.includes("lidl")) return { key:"lidl", label:"Lidl", icon:"🛒", color:"#1d4ed8", bonus:5 };
  return null;
}

const COMPASS = ["N","NO","O","SO","S","SW","W","NW"];

/* ── STATE ── */
let map, markerCluster, radiusCircle;
let currentResults = [];
let currentPlaceLabel = "Kartenmitte";
let showFavoritesOnly = false;
let sortMode = "distance"; // "distance" | "score"
let lastSearch = null;
let activeAbort = null;
let _resizeTimer;
let _nominatimLast = 0;

/* ── DOM ── */
const els = {
  status:       document.getElementById("statusText"),
  centerText:   document.getElementById("centerText"),
  locateBtn:    document.getElementById("locateBtn"),
  placeForm:    document.getElementById("placeForm"),
  placeInput:   document.getElementById("placeInput"),
  placeResults: document.getElementById("placeResults"),
  searchBtn:    document.getElementById("searchBtn"),
  radius:       document.getElementById("radiusSelect"),
  chips:        [...document.querySelectorAll(".chip")],
  modeBtns:     [...document.querySelectorAll(".mode-btn")],
  results:      document.getElementById("resultsList"),
  resultCount:  document.getElementById("resultCount"),
  warning:      document.getElementById("warningBox"),
  favBtn:       document.getElementById("showFavoritesBtn"),
  loadingBar:   document.getElementById("loadingBar"),
  sortBtn:      document.getElementById("sortBtn"),
  template:     document.getElementById("resultItemTemplate")
};

init();

function init() {
  initMap();
  bindUI();
  loadLastResults();
  scheduleResize();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

/* ── MAP ── */
function initMap() {
  map = L.map("map", { zoomControl: true, preferCanvas: true })
    .setView([59.8586, 17.6389], 11);

  // Standard OSM tiles — clearly readable for navigation
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
  }).addTo(map);

  // Marker cluster group (graceful fallback if plugin missing)
  if (window.L && L.markerClusterGroup) {
    markerCluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: cluster => {
        const n = cluster.getChildCount();
        return L.divIcon({
          html: `<div class="cluster-bubble">${n}</div>`,
          className: "", iconSize: [40, 40]
        });
      }
    });
  } else {
    markerCluster = L.layerGroup();
  }
  map.addLayer(markerCluster);

  map.whenReady(() => { scheduleResize(); updateCenterText(); drawRadius(); });

  map.on("moveend zoomend", () => {
    currentPlaceLabel = "Kartenmitte";
    updateCenterText();
    drawRadius();
  });
}

// Draw / update the search-radius circle around map centre
function drawRadius() {
  if (!map) return;
  const center = map.getCenter();
  const radius = Number(els.radius.value);
  if (radiusCircle) map.removeLayer(radiusCircle);
  radiusCircle = L.circle(center, {
    radius,
    color: "#0e6b3d",
    weight: 2,
    opacity: 0.7,
    fillColor: "#10b981",
    fillOpacity: 0.08,
    interactive: false
  }).addTo(map);
}

function bindUI() {
  window.addEventListener("resize", scheduleResize);
  window.addEventListener("orientationchange", scheduleResize);
  document.addEventListener("visibilitychange", scheduleResize);

  els.locateBtn.addEventListener("click", locateUser);
  els.placeForm.addEventListener("submit", searchPlace);
  els.searchBtn.addEventListener("click", runSearch);
  els.radius.addEventListener("change", drawRadius);

  els.favBtn.addEventListener("click", () => {
    showFavoritesOnly = !showFavoritesOnly;
    els.favBtn.classList.toggle("active", showFavoritesOnly);
    renderMap();
    renderResults();
  });

  if (els.sortBtn) {
    els.sortBtn.addEventListener("click", () => {
      sortMode = sortMode === "distance" ? "score" : "distance";
      els.sortBtn.textContent = sortMode === "distance" ? "↕ Nähe" : "↕ Bewertung";
      applySort();
      renderResults();
    });
  }

  els.chips.forEach(chip => {
    chip.addEventListener("click", () => {
      els.modeBtns.forEach(b => b.classList.remove("active"));
      chip.classList.toggle("active");
    });
  });

  els.modeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      els.modeBtns.forEach(b => b.classList.toggle("active", b === btn));
      const cats = MODES[btn.dataset.mode];
      els.chips.forEach(c => c.classList.toggle("active", cats.includes(c.dataset.category)));
    });
  });
}

function scheduleResize() {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => { if (map) map.invalidateSize({ pan: false }); }, 250);
}

function updateCenterText() {
  const c = map.getCenter();
  els.centerText.textContent = `Suchzentrum: ${currentPlaceLabel} (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})`;
}

function setLoading(on) { els.loadingBar.classList.toggle("on", on); }

/* ── GEOLOCATION ── */
function locateUser() {
  if (!navigator.geolocation) { els.status.textContent = "GPS nicht unterstützt."; return; }
  els.status.textContent = "Standort wird gesucht …";
  els.locateBtn.classList.add("pulse");
  navigator.geolocation.getCurrentPosition(
    pos => {
      currentPlaceLabel = "Mein Standort";
      map.setView([pos.coords.latitude, pos.coords.longitude], 14);
      updateCenterText(); drawRadius(); scheduleResize();
      els.status.textContent = "Standort gefunden.";
      els.locateBtn.classList.remove("pulse");
    },
    () => {
      els.status.textContent = "Kein GPS-Zugriff. Ort suchen oder Karte verschieben.";
      els.locateBtn.classList.remove("pulse");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 }
  );
}

/* ── PLACE SEARCH (Nominatim, throttled) ── */
async function searchPlace(event) {
  event.preventDefault();
  const query = els.placeInput.value.trim();
  if (!query) return;

  // Respect Nominatim's 1 req/sec policy
  const wait = Math.max(0, 1100 - (Date.now() - _nominatimLast));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _nominatimLast = Date.now();

  els.status.textContent = `Suche „${query}" …`;
  els.placeResults.classList.add("hidden");
  els.placeResults.innerHTML = "";
  setLoading(true);

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "6");
    url.searchParams.set("countrycodes", "se,no,fi,dk");
    url.searchParams.set("addressdetails", "1");

    const res = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error("Ortssuche fehlgeschlagen");
    const data = await res.json();

    if (!data.length) { els.status.textContent = "Kein Ort gefunden. Bitte genauer suchen."; return; }
    if (data.length === 1) { choosePlace(data[0]); return; }

    data.forEach(place => {
      const btn = document.createElement("button");
      btn.className = "place-result";
      btn.type = "button";
      btn.textContent = place.display_name;
      btn.addEventListener("click", () => choosePlace(place));
      els.placeResults.appendChild(btn);
    });
    els.placeResults.classList.remove("hidden");
    els.status.textContent = "Bitte einen Ort auswählen.";
  } catch (err) {
    console.error(err);
    els.status.textContent = "Ortssuche fehlgeschlagen. Bitte erneut versuchen.";
  } finally {
    setLoading(false);
  }
}

function choosePlace(place) {
  currentPlaceLabel = place.display_name.split(",").slice(0, 3).join(",").trim();
  els.placeInput.value = currentPlaceLabel;
  els.placeResults.classList.add("hidden");
  map.setView([Number(place.lat), Number(place.lon)], 13);
  updateCenterText(); drawRadius(); scheduleResize();
  els.status.textContent = `Suchzentrum: ${currentPlaceLabel}.`;
}

/* ── MAIN SEARCH ── */
async function runSearch() {
  const center = map.getCenter();
  const origin = { lat: center.lat, lon: center.lng };
  const radius = Number(els.radius.value);
  const categories = getActiveCategories();

  if (!categories.length) { els.status.textContent = "Bitte mindestens eine Kategorie auswählen."; return; }

  // Cancel a still-running search
  if (activeAbort) activeAbort.abort();
  activeAbort = new AbortController();

  lastSearch = { origin, radius, categories };
  showFavoritesOnly = false;
  els.favBtn.classList.remove("active");

  updateCenterText();
  els.status.textContent = `Suche ${formatDist(radius)} um ${currentPlaceLabel} …`;
  els.results.innerHTML = `<p class="empty">Daten werden geladen …</p>`;
  setLoading(true);

  const slowTimer = setTimeout(() => {
    els.status.textContent = "Suche dauert länger als gewöhnlich … (Overpass kann ausgelastet sein)";
  }, 8000);

  const showWarn = categories.some(c => ["parking", "church", "picnic"].includes(c));
  els.warning.classList.toggle("hidden", !showWarn);

  try {
    const query = buildOverpassQuery(origin.lat, origin.lon, radius, categories);
    const data = await fetchOverpass(query, activeAbort.signal);

    currentResults = normalizeOverpass(data.elements || [], categories, origin)
      .filter(applySafetyFilters);

    enrichNearby(currentResults);
    applySort();
    saveLastResults();
    renderMap();
    renderResults();
    updateChipCounts();
    scheduleResize();

    const icaCount = currentResults.filter(r => r.store && r.store.key === "ica-maxi").length;
    els.status.textContent = currentResults.length
      ? `${currentResults.length} Treffer${icaCount ? ` · ${icaCount}× ICA Maxi ⭐` : ""}.`
      : "Keine Treffer. Radius vergrößern oder andere Kategorie wählen.";
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    els.status.textContent = "Suche fehlgeschlagen. Bitte erneut versuchen.";
    els.results.innerHTML = `<p class="empty">Keine Daten geladen. Overpass kann langsam sein – Radius verkleinern oder erneut versuchen.</p>`;
  } finally {
    clearTimeout(slowTimer);
    setLoading(false);
    activeAbort = null;
  }
}

function getActiveCategories() {
  return els.chips.filter(c => c.classList.contains("active")).map(c => c.dataset.category);
}

function applySort() {
  if (sortMode === "score") {
    currentResults.sort((a, b) => b.score - a.score || a.distance - b.distance);
  } else {
    currentResults.sort((a, b) => a.distance - b.distance || b.score - a.score);
  }
}

/* ── OVERPASS ── */
function buildOverpassQuery(lat, lon, radius, categories) {
  const parts = [];
  categories.forEach(k => {
    CATEGORIES[k].queries.forEach(([key, val]) => {
      parts.push(`node["${key}"="${val}"](around:${radius},${lat},${lon});`);
      parts.push(`way["${key}"="${val}"](around:${radius},${lat},${lon});`);
      parts.push(`relation["${key}"="${val}"](around:${radius},${lat},${lon});`);
    });
  });
  return `[out:json][timeout:30];\n(\n${parts.map(p => "  " + p).join("\n")}\n);\nout center tags;`;
}

async function fetchOverpass(query, signal) {
  let lastError;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ data: query }),
        signal
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (e.name === "AbortError") throw e;
      lastError = e;
    }
  }
  throw lastError || new Error("Overpass nicht erreichbar");
}

function normalizeOverpass(elements, categories, origin) {
  const seen = new Set();
  const favs = getFavorites();
  return elements.flatMap(el => {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!lat || !lon) return [];

    const catKey = categories.find(k => {
      const cat = CATEGORIES[k];
      return cat.queries.some(([key, val]) => tags[key] === val) &&
             (!cat.extraFilter || cat.extraFilter(tags));
    });
    if (!catKey) return [];

    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) return [];
    seen.add(id);

    const cat = CATEGORIES[catKey];
    const dist = haversine(origin.lat, origin.lon, lat, lon);
    const bearing = bearingTo(origin.lat, origin.lon, lat, lon);

    // For food category: detect the store brand
    const store = catKey === "food" ? detectStore(tags) : null;

    return [{
      id, osmType: el.type, osmId: el.id,
      catKey, catLabel: cat.label,
      icon: store ? store.icon : cat.icon,
      color: store ? store.color : cat.color,
      bg: cat.bg,
      store,
      name: tags.name || tags["name:sv"] || tags.operator || (store ? store.label : cat.label),
      lat, lon, distance: dist, bearing, tags,
      score: scorePlace(catKey, tags, dist) + (store ? store.bonus : 0),
      favorite: Boolean(favs[id]?.favorite),
      note: favs[id]?.note || "",
      googleMapsUrl: `https://www.google.com/maps?q=${lat},${lon}`,
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      nearby: []
    }];
  });
}

function applySafetyFilters(p) {
  const a = p.tags.access;
  if (a === "private" || a === "no") return false;
  if (p.catKey === "parking" && ["underground", "multi-storey"].includes(p.tags.parking)) return false;
  return true;
}

function scorePlace(k, t, d) {
  let s = CATEGORIES[k].scoreBase;
  if (d < 1000) s += 20; else if (d < 3000) s += 10;
  if (t.access === "yes" || t.access === "public") s += 12;
  if (t.opening_hours === "24/7") s += 12;
  if (t.fee === "no") s += 8;
  if (t.toilets === "yes") s += 15;
  if (t.drinking_water === "yes") s += 12;
  if (t.shower === "yes") s += 6;
  if (t.website || t["contact:website"]) s += 3;
  return s;
}

function enrichNearby(results) {
  const useful = ["toilets", "water", "parking", "picnic"];
  results.forEach(p => {
    if (!["bathing", "church", "picnic", "parking", "camping"].includes(p.catKey)) return;
    p.nearby = results
      .filter(o => o.id !== p.id && useful.includes(o.catKey))
      .map(o => ({ ...o, d: haversine(p.lat, p.lon, o.lat, o.lon) }))
      .filter(o => o.d <= 350)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map(n => `${n.icon} ${n.catLabel} ${Math.round(n.d)} m`);
    p.score += p.nearby.length * 8;
  });
}

/* ── CHIP COUNTS ── */
function updateChipCounts() {
  const counts = {};
  currentResults.forEach(r => { counts[r.catKey] = (counts[r.catKey] || 0) + 1; });
  els.chips.forEach(chip => {
    const k = chip.dataset.category;
    let badge = chip.querySelector(".chip-count");
    if (counts[k]) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "chip-count";
        chip.appendChild(badge);
      }
      badge.textContent = counts[k];
    } else if (badge) {
      badge.remove();
    }
  });
}

/* ── RENDER MAP ── */
function renderMap() {
  markerCluster.clearLayers();
  const visible = getVisible();
  const markers = [];

  visible.forEach(p => {
    const isIca = p.store && p.store.key === "ica-maxi";
    const icon = L.divIcon({
      html: `<div class="marker-dot${isIca ? " marker-ica" : ""}" style="background:${p.color}">${p.icon}</div>`,
      className: "", iconSize: [34, 34], iconAnchor: [17, 17]
    });
    const m = L.marker([p.lat, p.lon], { icon });
    const popup = `
      <p class="popup-title">${esc(p.icon + " " + p.name)}</p>
      <p class="popup-meta">${esc(p.catLabel)} · ${compassArrow(p.bearing)} ${formatDist(p.distance)}${p.nearby && p.nearby.length ? " · " + esc(p.nearby.join(" · ")) : ""}</p>
      <div class="popup-actions">
        <a href="${p.googleMapsUrl}" target="_blank" rel="noopener">In Google Maps öffnen</a>
        <a href="${p.osmUrl}" target="_blank" rel="noopener">OpenStreetMap</a>
      </div>`;
    m.bindPopup(popup);
    m.on("click", () => highlightCard(p.id));
    p._marker = m;
    markers.push(m);
  });

  if (markerCluster.addLayers) markerCluster.addLayers(markers);
  else markers.forEach(m => markerCluster.addLayer(m));
}

/* ── RENDER RESULTS ── */
function renderResults() {
  const visible = getVisible();
  els.resultCount.textContent = visible.length ? `${visible.length}` : "";

  if (!visible.length) {
    els.results.innerHTML = `<p class="empty">${showFavoritesOnly ? "Noch keine Favoriten gespeichert." : "Keine Treffer für diese Auswahl."}</p>`;
    return;
  }

  els.results.innerHTML = "";
  visible.forEach(p => {
    const node = els.template.content.cloneNode(true);
    const card = node.querySelector(".result-card");
    card.dataset.id = p.id;

    const isIca = p.store && p.store.key === "ica-maxi";
    if (isIca) card.classList.add("is-ica");

    const iconWrap = node.querySelector(".card-icon");
    iconWrap.textContent = p.icon;
    iconWrap.style.background = p.bg;

    node.querySelector(".result-title").textContent = p.name;
    node.querySelector(".result-meta").textContent =
      `${p.catLabel} · ${compassArrow(p.bearing)} ${formatDist(p.distance)} ${compassName(p.bearing)}`;

    // Badges
    const badges = [];
    if (isIca) badges.push(`<span class="badge ica">⭐ ICA Maxi</span>`);
    else if (p.store && p.store.key !== "ica-maxi") badges.push(`<span class="badge">${esc(p.store.label)}</span>`);
    const oh = openingStatus(p.tags.opening_hours);
    if (oh) badges.push(`<span class="badge ${oh.cls}">${oh.text}</span>`);
    if (p.tags.opening_hours === "24/7") badges.push(`<span class="badge green">24/7</span>`);
    if (p.tags.fee === "no") badges.push(`<span class="badge green">kostenlos</span>`);
    if (p.tags.drinking_water === "yes") badges.push(`<span class="badge">💧 Wasser</span>`);
    if (p.tags.toilets === "yes") badges.push(`<span class="badge">🚻 WC</span>`);
    if (p.favorite) badges.push(`<span class="badge yellow">★ Favorit</span>`);
    node.querySelector(".result-badges").innerHTML = badges.join("");

    // Extra info
    const extras = [];
    if (p.tags.opening_hours && p.tags.opening_hours !== "24/7") extras.push(`Öffnung: ${p.tags.opening_hours}`);
    if (p.tags.fee && p.tags.fee !== "no") extras.push(`Gebühr: ${p.tags.fee}`);
    if (p.tags.access && !["yes","public"].includes(p.tags.access)) extras.push(`Zugang: ${p.tags.access}`);
    if (p.nearby && p.nearby.length) extras.push(p.nearby.join(" · "));
    if (p.note) extras.push(`📝 ${p.note}`);
    if (["parking", "church", "picnic"].includes(p.catKey)) extras.push("Beschilderung prüfen.");
    node.querySelector(".result-extra").textContent = extras.join(" · ") || "";

    // Links
    node.querySelector(".maps-link").href = p.googleMapsUrl;
    node.querySelector(".osm-link").href = p.osmUrl;

    // Tap card body → fly to marker
    node.querySelector(".card-body").addEventListener("click", () => focusOnMap(p.id));

    // Favorite
    const favBtn = node.querySelector(".fav-btn");
    favBtn.textContent = p.favorite ? "★ Favorit" : "☆ Favorit";
    if (p.favorite) favBtn.classList.add("active");
    favBtn.addEventListener("click", e => { e.stopPropagation(); toggleFav(p.id); });

    // Note
    const noteBtn = node.querySelector(".note-btn");
    if (p.note) noteBtn.textContent = "✏️ Notiz ✓";
    noteBtn.addEventListener("click", e => { e.stopPropagation(); editNote(p.id); });

    // Share (Web Share API)
    const shareBtn = node.querySelector(".share-btn");
    if (shareBtn) {
      if (navigator.share) {
        shareBtn.addEventListener("click", e => {
          e.stopPropagation();
          navigator.share({ title: p.name, text: `${p.name} – ${p.catLabel}`, url: p.googleMapsUrl }).catch(() => {});
        });
      } else {
        shareBtn.remove();
      }
    }

    els.results.appendChild(node);
  });
}

// Fly map to a result and open its popup
function focusOnMap(id) {
  const p = currentResults.find(r => r.id === id);
  if (!p || !p._marker) return;
  map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 15), { duration: 0.6 });
  setTimeout(() => {
    if (markerCluster.zoomToShowLayer) markerCluster.zoomToShowLayer(p._marker, () => p._marker.openPopup());
    else p._marker.openPopup();
  }, 650);
}

// Marker click → scroll to + flash the matching list card
function highlightCard(id) {
  const card = els.results.querySelector(`.result-card[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("flash");
  setTimeout(() => card.classList.remove("flash"), 1200);
}

function getVisible() {
  if (!showFavoritesOnly) return currentResults;
  return currentResults.filter(r => r.favorite);
}

/* ── FAVORITES & NOTES ── */
function toggleFav(id) {
  const p = currentResults.find(r => r.id === id);
  if (!p) return;
  p.favorite = !p.favorite;
  persistFav(p);
  renderMap(); renderResults();
}

function editNote(id) {
  const p = currentResults.find(r => r.id === id);
  if (!p) return;
  const dialog = document.getElementById("noteDialog");
  document.getElementById("noteDialogLabel").textContent = `Notiz: ${p.name}`;
  document.getElementById("noteDialogText").value = p.note || "";
  dialog.showModal();
  dialog.onclose = () => {
    if (dialog.returnValue !== "save") return;
    p.note = document.getElementById("noteDialogText").value.trim();
    persistFav(p);
    renderResults();
  };
}

function persistFav(p) {
  const favs = getFavorites();
  if (p.favorite || p.note) {
    favs[p.id] = { favorite: p.favorite, note: p.note };
  } else {
    delete favs[p.id];
  }
  localStorage.setItem("scf:favorites", JSON.stringify(favs));
}

function getFavorites() {
  try { return JSON.parse(localStorage.getItem("scf:favorites") || "{}"); }
  catch { return {}; }
}

function saveLastResults() {
  try {
    localStorage.setItem("scf:lastResults:v13", JSON.stringify({
      label: currentPlaceLabel,
      center: map.getCenter(),
      results: currentResults.slice(0, 300).map(r => { const c = { ...r }; delete c._marker; return c; })
    }));
  } catch {}
}

function loadLastResults() {
  try {
    const saved = JSON.parse(localStorage.getItem("scf:lastResults:v13") || "null");
    if (!saved || !saved.results || !saved.results.length) return;
    const favs = getFavorites();
    currentPlaceLabel = saved.label || "Kartenmitte";
    currentResults = saved.results.map(r => ({
      ...r,
      favorite: Boolean(favs[r.id]?.favorite),
      note: favs[r.id]?.note || r.note || ""
    }));
    if (saved.center?.lat && saved.center?.lng) map.setView([saved.center.lat, saved.center.lng], 13);
    drawRadius();
    renderMap(); renderResults(); updateChipCounts(); updateCenterText();
    els.status.textContent = "Letzte Ergebnisse geladen.";
  } catch {}
}

/* ── OPENING HOURS (lightweight, common cases only) ── */
function openingStatus(oh) {
  if (!oh) return null;
  if (oh === "24/7") return { cls: "green", text: "jetzt geöffnet" };
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const dayMap = { Mo:1, Tu:2, We:3, Th:4, Fr:5, Sa:6, Su:0, Di:2, Mi:3, Do:4, So:0 };
  const minutes = now.getHours() * 60 + now.getMinutes();
  try {
    const blocks = oh.split(";").map(s => s.trim());
    let parsedAny = false;
    for (const b of blocks) {
      const m = b.match(/^([A-Za-z]{2})(?:-([A-Za-z]{2}))?\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (!m) continue;
      const d1 = dayMap[m[1]], d2 = m[2] ? dayMap[m[2]] : d1;
      if (d1 === undefined || d2 === undefined) continue;
      parsedAny = true;
      const inRange = d1 <= d2 ? (day >= d1 && day <= d2) : (day >= d1 || day <= d2);
      if (!inRange) continue;
      const open = (+m[3]) * 60 + (+m[4]), close = (+m[5]) * 60 + (+m[6]);
      if (minutes >= open && minutes <= close) return { cls: "green", text: "jetzt geöffnet" };
    }
    // Only claim "closed" if we actually understood the format
    return parsedAny ? { cls: "gray", text: "geschlossen" } : null;
  } catch { return null; }
}

/* ── UTILS ── */
function formatDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = d => d * Math.PI / 180;
  const dLat = r(lat2 - lat1), dLon = r(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingTo(lat1, lon1, lat2, lon2) {
  const r = d => d * Math.PI / 180, deg = d => d * 180 / Math.PI;
  const dLon = r(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(r(lat2));
  const x = Math.cos(r(lat1)) * Math.sin(r(lat2)) - Math.sin(r(lat1)) * Math.cos(r(lat2)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

function compassName(bearing) {
  return COMPASS[Math.round(bearing / 45) % 8];
}

function compassArrow(bearing) {
  const arrows = ["↑","↗","→","↘","↓","↙","←","↖"];
  return arrows[Math.round(bearing / 45) % 8];
}

function esc(v) {
  return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}
