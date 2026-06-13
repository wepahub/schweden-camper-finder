"use strict";

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
  ica: {
    label:"ICA Maxi", icon:"🛒", color:"#ef4444", bg:"rgba(239,68,68,.18)", queries:[["shop","supermarket"]],
    extraFilter: t => {
      const v = [t.name,t.brand,t.operator,t["name:sv"],t["official_name"]].filter(Boolean).join(" ").toLowerCase();
      return v.includes("ica maxi") || (v.includes("ica") && v.includes("maxi"));
    },
    scoreBase:50
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
  pause:   ["bathing","picnic","parking","toilets","water","ica","museum","hiking"],
  evening: ["camping","parking","church","picnic","bathing","toilets","water","ica"],
  supply:  ["toilets","water","ica"]
};

let map, markerLayer;
let currentResults = [];
let currentPlaceLabel = "Kartenmitte";
let showFavoritesOnly = false;
let _resizeTimer;

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
  warning:      document.getElementById("warningBox"),
  favBtn:       document.getElementById("showFavoritesBtn"),
  loadingBar:   document.getElementById("loadingBar"),
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

function initMap() {
  map = L.map("map", { zoomControl: true, preferCanvas: true })
    .setView([59.8586, 17.6389], 11);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);

  map.whenReady(() => {
    scheduleResize();
    updateCenterText();
  });

  map.on("moveend zoomend", () => {
    currentPlaceLabel = "Kartenmitte";
    updateCenterText();
  });
}

function bindUI() {
  window.addEventListener("resize", scheduleResize);
  window.addEventListener("orientationchange", scheduleResize);
  document.addEventListener("visibilitychange", scheduleResize);

  els.locateBtn.addEventListener("click", locateUser);
  els.placeForm.addEventListener("submit", searchPlace);
  els.searchBtn.addEventListener("click", runSearch);

  els.favBtn.addEventListener("click", () => {
    showFavoritesOnly = !showFavoritesOnly;
    els.favBtn.classList.toggle("active", showFavoritesOnly);
    renderResults();
    renderMap();
  });

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
  _resizeTimer = setTimeout(() => {
    if (map) map.invalidateSize({ pan: false });
  }, 250);
}

function updateCenterText() {
  const c = map.getCenter();
  els.centerText.textContent = `Suchzentrum: ${currentPlaceLabel} (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})`;
}

function setLoading(on) {
  els.loadingBar.classList.toggle("on", on);
}

// ── GEOLOCATION ──
function locateUser() {
  if (!navigator.geolocation) {
    els.status.textContent = "GPS nicht unterstützt.";
    return;
  }
  els.status.textContent = "Standort wird gesucht …";
  els.locateBtn.classList.add("pulse");

  navigator.geolocation.getCurrentPosition(
    pos => {
      currentPlaceLabel = "Mein Standort";
      map.setView([pos.coords.latitude, pos.coords.longitude], 14);
      updateCenterText();
      scheduleResize();
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

// ── PLACE SEARCH ──
async function searchPlace(event) {
  event.preventDefault();
  const query = els.placeInput.value.trim();
  if (!query) return;

  els.status.textContent = `Suche „${query}" …`;
  els.placeResults.classList.add("hidden");
  els.placeResults.innerHTML = "";
  setLoading(true);

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "6");
    url.searchParams.set("addressdetails", "1");

    const res = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error("Ortssuche fehlgeschlagen");
    const data = await res.json();

    if (!data.length) {
      els.status.textContent = "Kein Ort gefunden. Bitte genauer suchen.";
      return;
    }

    if (data.length === 1) {
      choosePlace(data[0]);
      return;
    }

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
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  currentPlaceLabel = place.display_name.split(",").slice(0, 3).join(",").trim();
  els.placeInput.value = currentPlaceLabel;
  els.placeResults.classList.add("hidden");
  map.setView([lat, lon], 13);
  updateCenterText();
  scheduleResize();
  els.status.textContent = `Suchzentrum: ${currentPlaceLabel}.`;
}

// ── MAIN SEARCH ──
async function runSearch() {
  const center = map.getCenter();
  const origin = { lat: center.lat, lon: center.lng };
  const radius = Number(els.radius.value);
  const categories = getActiveCategories();

  if (!categories.length) {
    els.status.textContent = "Bitte mindestens eine Kategorie auswählen.";
    return;
  }

  updateCenterText();
  els.status.textContent = `Suche ${formatDist(radius)} um ${currentPlaceLabel} …`;
  els.results.innerHTML = `<p class="empty">Daten werden geladen …</p>`;
  setLoading(true);

  const showWarn = categories.some(c => ["parking", "church", "picnic"].includes(c));
  els.warning.classList.toggle("hidden", !showWarn);

  try {
    const query = buildOverpassQuery(origin.lat, origin.lon, radius, categories);
    const data = await fetchOverpass(query);

    currentResults = normalizeOverpass(data.elements || [], categories, origin)
      .filter(applySafetyFilters);

    enrichNearby(currentResults);
    currentResults.sort((a, b) => a.distance - b.distance || b.score - a.score);

    saveLastResults();
    renderMap();
    renderResults();
    scheduleResize();
    els.status.textContent = `${currentResults.length} Treffer gefunden.`;
  } catch (err) {
    console.error(err);
    els.status.textContent = "Suche fehlgeschlagen. Bitte erneut versuchen.";
    els.results.innerHTML = `<p class="empty">Keine Daten geladen. Overpass kann langsam sein – Radius verkleinern oder erneut versuchen.</p>`;
  } finally {
    setLoading(false);
  }
}

function getActiveCategories() {
  return els.chips
    .filter(c => c.classList.contains("active"))
    .map(c => c.dataset.category);
}

// ── OVERPASS ──
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

async function fetchOverpass(query) {
  let lastError;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const r = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ data: query })
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { lastError = e; }
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
    return [{
      id, osmType: el.type, osmId: el.id,
      catKey, catLabel: cat.label, icon: cat.icon, color: cat.color, bg: cat.bg,
      name: tags.name || tags["name:sv"] || tags.operator || cat.label,
      lat, lon, distance: dist, tags,
      score: scorePlace(catKey, tags, dist),
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

// ── RENDER MAP ──
function renderMap() {
  markerLayer.clearLayers();
  getVisible().forEach(p => {
    const icon = L.divIcon({
      html: `<div class="marker-dot" style="background:${p.color}">${p.icon}</div>`,
      className: "", iconSize: [34, 34], iconAnchor: [17, 17]
    });
    const popup = `
      <p class="popup-title">${esc(p.icon + " " + p.name)}</p>
      <p class="popup-meta">${esc(p.catLabel)} · ${formatDist(p.distance)}${p.nearby?.length ? " · " + esc(p.nearby.join(" · ")) : ""}</p>
      <div class="popup-actions">
        <a href="${p.googleMapsUrl}" target="_blank" rel="noopener">In Google Maps öffnen</a>
        <a href="${p.osmUrl}" target="_blank" rel="noopener">OpenStreetMap</a>
      </div>`;
    L.marker([p.lat, p.lon], { icon }).addTo(markerLayer).bindPopup(popup);
  });
}

// ── RENDER RESULTS ──
function renderResults() {
  const visible = getVisible();
  if (!visible.length) {
    els.results.innerHTML = `<p class="empty">${showFavoritesOnly ? "Noch keine Favoriten gespeichert." : "Keine Treffer für diese Auswahl."}</p>`;
    return;
  }

  els.results.innerHTML = "";
  visible.forEach(p => {
    const node = els.template.content.cloneNode(true);

    node.querySelector(".card-icon").textContent = p.icon;
    node.querySelector(".card-icon").style.background = p.bg;
    node.querySelector(".result-title").textContent = p.name;
    node.querySelector(".result-meta").textContent = `${p.catLabel} · ${formatDist(p.distance)} von der Kartenmitte`;

    // Badges
    const badges = [];
    if (p.tags.opening_hours === "24/7") badges.push(`<span class="badge green">24/7</span>`);
    if (p.tags.fee === "no") badges.push(`<span class="badge green">kostenlos</span>`);
    if (p.tags.drinking_water === "yes") badges.push(`<span class="badge">💧 Wasser</span>`);
    if (p.tags.toilets === "yes") badges.push(`<span class="badge">🚻 WC</span>`);
    if (p.favorite) badges.push(`<span class="badge yellow">★ Favorit</span>`);
    node.querySelector(".result-badges").innerHTML = badges.join("");

    // Extra info
    const extras = [];
    if (p.tags.opening_hours) extras.push(`Öffnung: ${p.tags.opening_hours}`);
    if (p.tags.fee) extras.push(`Gebühr: ${p.tags.fee}`);
    if (p.tags.access) extras.push(`Zugang: ${p.tags.access}`);
    if (p.nearby?.length) extras.push(p.nearby.join(" · "));
    if (p.note) extras.push(`📝 ${p.note}`);
    if (["parking", "church", "picnic"].includes(p.catKey)) extras.push("Beschilderung prüfen.");
    node.querySelector(".result-extra").textContent = extras.join(" · ") || "";

    // Links
    node.querySelector(".maps-link").href = p.googleMapsUrl;
    node.querySelector(".osm-link").href = p.osmUrl;

    // Favorite button
    const favBtn = node.querySelector(".fav-btn");
    favBtn.textContent = p.favorite ? "★ Favorit" : "☆ Favorit";
    if (p.favorite) favBtn.classList.add("active");
    favBtn.addEventListener("click", () => toggleFav(p.id));

    // Note button
    const noteBtn = node.querySelector(".note-btn");
    if (p.note) noteBtn.textContent = "✏️ Notiz ✓";
    noteBtn.addEventListener("click", () => editNote(p.id));

    els.results.appendChild(node);
  });
}

function getVisible() {
  if (!showFavoritesOnly) return currentResults;
  return currentResults.filter(r => r.favorite);
}

// ── FAVORITES & NOTES ──
function toggleFav(id) {
  const p = currentResults.find(r => r.id === id);
  if (!p) return;
  p.favorite = !p.favorite;
  const favs = getFavorites();
  favs[id] = { favorite: p.favorite, note: p.note };
  if (!p.favorite && !p.note) delete favs[id];
  localStorage.setItem("scf:favorites", JSON.stringify(favs));
  renderMap();
  renderResults();
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
    const favs = getFavorites();
    favs[id] = { favorite: p.favorite, note: p.note };
    if (!p.favorite && !p.note) delete favs[id];
    localStorage.setItem("scf:favorites", JSON.stringify(favs));
    renderResults();
  };
}

function getFavorites() {
  try { return JSON.parse(localStorage.getItem("scf:favorites") || "{}"); }
  catch { return {}; }
}

function saveLastResults() {
  try {
    localStorage.setItem("scf:lastResults:v12", JSON.stringify({
      label: currentPlaceLabel,
      center: map.getCenter(),
      results: currentResults.slice(0, 300)
    }));
  } catch {}
}

function loadLastResults() {
  try {
    const saved = JSON.parse(localStorage.getItem("scf:lastResults:v12") || "null");
    if (!saved?.results?.length) return;
    const favs = getFavorites();
    currentPlaceLabel = saved.label || "Kartenmitte";
    currentResults = saved.results.map(r => ({
      ...r,
      favorite: Boolean(favs[r.id]?.favorite),
      note: favs[r.id]?.note || r.note || ""
    }));
    if (saved.center?.lat && saved.center?.lng) {
      map.setView([saved.center.lat, saved.center.lng], 13);
    }
    renderMap();
    renderResults();
    updateCenterText();
    els.status.textContent = "Letzte Ergebnisse geladen.";
  } catch {}
}

// ── UTILS ──
function formatDist(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = d => d * Math.PI / 180;
  const dLat = r(lat2 - lat1), dLon = r(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function esc(v) {
  return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}
