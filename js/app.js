const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter"
];

const CATEGORIES = {
  toilets: {
    label: "WC",
    icon: "🚻",
    color: "#3b82f6",
    queries: [["amenity", "toilets"], ["toilets", "yes"]],
    scoreBase: 60
  },
  water: {
    label: "Wasser",
    icon: "💧",
    color: "#06b6d4",
    queries: [["amenity", "drinking_water"], ["drinking_water", "yes"]],
    scoreBase: 45
  },
  camping: {
    label: "Stellplatz/Camping",
    icon: "🏕",
    color: "#22c55e",
    queries: [["tourism", "caravan_site"], ["tourism", "camp_site"]],
    scoreBase: 55
  },
  bathing: {
    label: "Baden",
    icon: "🏖",
    color: "#facc15",
    queries: [["leisure", "swimming_area"], ["natural", "beach"], ["leisure", "beach_resort"]],
    scoreBase: 45
  },
  church: {
    label: "Kirche",
    icon: "⛪",
    color: "#a78bfa",
    queries: [["amenity", "place_of_worship"]],
    extraFilter: tags => !tags.religion || tags.religion === "christian",
    scoreBase: 25
  },
  parking: {
    label: "Parkplatz",
    icon: "🅿",
    color: "#94a3b8",
    queries: [["amenity", "parking"]],
    scoreBase: 30
  },
  picnic: {
    label: "Pause",
    icon: "🧺",
    color: "#fb923c",
    queries: [["tourism", "picnic_site"], ["highway", "rest_area"]],
    scoreBase: 35
  }
};

const MODES = {
  toilet: ["toilets"],
  pause: ["bathing", "picnic", "parking", "toilets", "water"],
  evening: ["camping", "parking", "church", "picnic", "bathing", "toilets", "water"],
  supply: ["toilets", "water"]
};

let map;
let markerLayer;
let currentResults = [];
let currentPlaceLabel = "Kartenmitte";
let showFavoritesOnly = false;

const els = {
  status: document.getElementById("statusText"),
  centerText: document.getElementById("centerText"),
  locateBtn: document.getElementById("locateBtn"),
  placeForm: document.getElementById("placeForm"),
  placeInput: document.getElementById("placeInput"),
  placeResults: document.getElementById("placeResults"),
  searchBtn: document.getElementById("searchBtn"),
  radius: document.getElementById("radiusSelect"),
  chips: [...document.querySelectorAll(".chip")],
  modeBtns: [...document.querySelectorAll(".mode-btn")],
  results: document.getElementById("resultsList"),
  warning: document.getElementById("warningBox"),
  showFavoritesBtn: document.getElementById("showFavoritesBtn"),
  template: document.getElementById("resultItemTemplate")
};

init();

function init() {
  initMap();
  bindUI();
  loadLastResults();
  scheduleMapResize();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js?v=1.3").catch(() => {});
  }
}

function initMap() {
  map = L.map("map", {
    zoomControl: true,
    preferCanvas: true
  }).setView([59.8586, 17.6389], 11); // Uppsala als neutraler Startpunkt

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);

  map.whenReady(() => {
    scheduleMapResize();
    updateCenterText();
  });

  map.on("moveend zoomend", () => {
    currentPlaceLabel = "Kartenmitte";
    updateCenterText();
    scheduleMapResize();
  });
}

function bindUI() {
  window.addEventListener("resize", scheduleMapResize);
  window.addEventListener("orientationchange", scheduleMapResize);
  document.addEventListener("visibilitychange", scheduleMapResize);

  els.locateBtn.addEventListener("click", locateUser);
  els.placeForm.addEventListener("submit", searchPlace);
  els.searchBtn.addEventListener("click", runSearch);

  els.showFavoritesBtn.addEventListener("click", () => {
    showFavoritesOnly = !showFavoritesOnly;
    els.showFavoritesBtn.classList.toggle("active", showFavoritesOnly);
    renderResults();
    renderMap();
  });

  els.chips.forEach(chip => {
    chip.addEventListener("click", () => {
      els.modeBtns.forEach(btn => btn.classList.remove("active"));
      chip.classList.toggle("active");
      scheduleMapResize();
    });
  });

  els.modeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      els.modeBtns.forEach(b => b.classList.toggle("active", b === btn));
      const cats = MODES[btn.dataset.mode];
      els.chips.forEach(chip => chip.classList.toggle("active", cats.includes(chip.dataset.category)));
      scheduleMapResize();
    });
  });
}

function scheduleMapResize() {
  [0, 80, 240, 600, 1200].forEach(delay => {
    setTimeout(() => {
      if (map) map.invalidateSize({ pan: false });
    }, delay);
  });
}

function updateCenterText() {
  const c = map.getCenter();
  els.centerText.textContent = `Suchzentrum: ${currentPlaceLabel} (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})`;
}

function locateUser() {
  if (!navigator.geolocation) {
    els.status.textContent = "Standort wird von diesem Browser nicht unterstützt.";
    return;
  }

  els.status.textContent = "Standort wird gesucht …";

  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      currentPlaceLabel = "Mein Standort";
      map.setView([lat, lon], 14);
      updateCenterText();
      scheduleMapResize();
      els.status.textContent = "Standort gefunden. Suche nutzt jetzt die Kartenmitte.";
    },
    () => {
      els.status.textContent = "Kein GPS-Zugriff. Du kannst einen Ort suchen oder die Karte verschieben.";
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 }
  );
}

async function searchPlace(event) {
  event.preventDefault();
  const query = els.placeInput.value.trim();
  if (!query) return;

  els.status.textContent = `Suche Ort „${query}“ …`;
  els.placeResults.classList.add("hidden");
  els.placeResults.innerHTML = "";

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "6");
    url.searchParams.set("addressdetails", "1");

    const res = await fetch(url.toString(), { headers: { "Accept": "application/json" }});
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

    els.placeResults.innerHTML = "";
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
  }
}

function choosePlace(place) {
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  currentPlaceLabel = shortenPlaceName(place.display_name);
  els.placeInput.value = currentPlaceLabel;
  els.placeResults.classList.add("hidden");
  map.setView([lat, lon], 13);
  updateCenterText();
  scheduleMapResize();
  els.status.textContent = `Suchzentrum auf ${currentPlaceLabel} gesetzt.`;
}

function shortenPlaceName(name) {
  return name.split(",").slice(0, 3).join(",").trim();
}

async function runSearch() {
  const center = map.getCenter(); // WICHTIG: immer Kartenmitte, nicht alter GPS-Standort
  const origin = { lat: center.lat, lon: center.lng };
  const radius = Number(els.radius.value);
  const categories = getActiveCategories();

  if (!categories.length) {
    els.status.textContent = "Bitte mindestens eine Kategorie auswählen.";
    return;
  }

  updateCenterText();
  els.status.textContent = `Suche ${formatDistance(radius)} um ${currentPlaceLabel} …`;
  els.results.innerHTML = '<p class="empty">Daten werden geladen …</p>';

  const showWarning = categories.some(c => ["parking", "church", "picnic"].includes(c));
  els.warning.classList.toggle("hidden", !showWarning);

  try {
    const query = buildOverpassQuery(origin.lat, origin.lon, radius, categories);
    const data = await fetchOverpass(query);

    currentResults = normalizeOverpass(data.elements || [], categories, origin)
      .filter(applySafetyFilters);

    enrichNearbyFeatures(currentResults);

    currentResults.sort((a, b) => a.distance - b.distance || b.score - a.score);

    saveLastResults();
    renderMap();
    renderResults();
    scheduleMapResize();

    els.status.textContent = `${currentResults.length} Treffer um ${currentPlaceLabel} gefunden.`;
  } catch (error) {
    console.error(error);
    els.status.textContent = "Suche fehlgeschlagen. Bitte Radius verkleinern oder erneut versuchen.";
    els.results.innerHTML = '<p class="empty">Keine Daten geladen. Overpass ist manchmal langsam – erneut versuchen oder Radius verkleinern.</p>';
  }
}

function getActiveCategories() {
  return els.chips
    .filter(chip => chip.classList.contains("active"))
    .map(chip => chip.dataset.category);
}

function buildOverpassQuery(lat, lon, radius, categories) {
  const parts = [];
  categories.forEach(catKey => {
    const cat = CATEGORIES[catKey];
    cat.queries.forEach(([key, value]) => {
      parts.push(`node["${key}"="${value}"](around:${radius},${lat},${lon});`);
      parts.push(`way["${key}"="${value}"](around:${radius},${lat},${lon});`);
      parts.push(`relation["${key}"="${value}"](around:${radius},${lat},${lon});`);
    });
  });

  return `[out:json][timeout:30];
(
${parts.map(p => "  " + p).join("\n")}
);
out center tags;`;
}

async function fetchOverpass(query) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ data: query })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Overpass nicht erreichbar");
}

function normalizeOverpass(elements, categories, origin) {
  const seen = new Set();
  const favorites = getFavorites();

  return elements.flatMap(el => {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!lat || !lon) return [];

    const matchedCategory = categories.find(catKey => {
      const cat = CATEGORIES[catKey];
      const tagMatch = cat.queries.some(([key, value]) => tags[key] === value);
      const extraOk = !cat.extraFilter || cat.extraFilter(tags);
      return tagMatch && extraOk;
    });

    if (!matchedCategory) return [];

    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) return [];
    seen.add(id);

    const category = CATEGORIES[matchedCategory];
    const distance = haversine(origin.lat, origin.lon, lat, lon);
    const score = scorePlace(matchedCategory, tags, distance);

    return [{
      id,
      osmType: el.type,
      osmId: el.id,
      categoryKey: matchedCategory,
      categoryLabel: category.label,
      icon: category.icon,
      color: category.color,
      name: tags.name || tags["name:sv"] || tags.operator || category.label,
      lat,
      lon,
      distance,
      tags,
      score,
      favorite: Boolean(favorites[id]?.favorite),
      note: favorites[id]?.note || "",
      googleMapsUrl: `https://www.google.com/maps?q=${lat},${lon}`,
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      nearby: []
    }];
  });
}

function applySafetyFilters(place) {
  const access = place.tags.access;
  if (access === "private" || access === "no") return false;
  if (place.categoryKey === "parking" && ["underground", "multi-storey"].includes(place.tags.parking)) {
    return false;
  }
  return true;
}

function scorePlace(categoryKey, tags, distance) {
  let score = CATEGORIES[categoryKey].scoreBase;

  if (distance < 1000) score += 20;
  else if (distance < 3000) score += 10;

  if (tags.access === "yes" || tags.access === "public") score += 12;
  if (tags.opening_hours === "24/7") score += 12;
  if (tags.fee === "no") score += 8;
  if (tags.toilets === "yes") score += 15;
  if (tags.drinking_water === "yes") score += 12;
  if (tags.shower === "yes") score += 6;
  if (tags.website || tags["contact:website"]) score += 3;

  return score;
}

function enrichNearbyFeatures(results) {
  const useful = ["toilets", "water", "parking", "picnic"];
  results.forEach(place => {
    if (!["bathing", "church", "picnic", "parking", "camping"].includes(place.categoryKey)) return;

    const nearby = results
      .filter(other => other.id !== place.id && useful.includes(other.categoryKey))
      .map(other => ({ ...other, d: haversine(place.lat, place.lon, other.lat, other.lon) }))
      .filter(other => other.d <= 350)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);

    place.nearby = nearby.map(n => `${n.icon} ${n.categoryLabel} ${Math.round(n.d)} m`);
    place.score += nearby.length * 8;
  });
}

function renderMap() {
  markerLayer.clearLayers();

  getVisibleResults().forEach(place => {
    const icon = L.divIcon({
      html: `<div class="marker-dot" style="background:${place.color}">${place.icon}</div>`,
      className: "",
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const popup = `
      <div class="popup-title">${escapeHtml(place.icon + " " + place.name)}</div>
      <div>${escapeHtml(place.categoryLabel)} · ${formatDistance(place.distance)}</div>
      ${place.nearby?.length ? `<div>${escapeHtml(place.nearby.join(" · "))}</div>` : ""}
      <div class="popup-actions">
        <a href="${place.googleMapsUrl}" target="_blank" rel="noopener">In Google Maps öffnen</a>
        <a href="${place.osmUrl}" target="_blank" rel="noopener">In OSM öffnen</a>
      </div>
    `;

    L.marker([place.lat, place.lon], { icon })
      .addTo(markerLayer)
      .bindPopup(popup);
  });
}

function renderResults() {
  const visible = getVisibleResults();

  if (!visible.length) {
    els.results.innerHTML = `<p class="empty">${showFavoritesOnly ? "Noch keine Favoriten gespeichert." : "Keine Treffer für diese Auswahl."}</p>`;
    return;
  }

  els.results.innerHTML = "";

  visible
    .sort((a, b) => a.distance - b.distance || b.score - a.score)
    .forEach(place => {
      const node = els.template.content.cloneNode(true);
      node.querySelector(".result-title").textContent = `${place.icon} ${place.name}`;
      node.querySelector(".result-meta").textContent = `${place.categoryLabel} · ${formatDistance(place.distance)} von der Kartenmitte`;
      node.querySelector(".result-extra").textContent = buildExtraLine(place);

      const link = node.querySelector(".maps-link");
      link.href = place.googleMapsUrl;

      const favBtn = node.querySelector(".fav-btn");
      favBtn.textContent = place.favorite ? "★ Favorit" : "☆ Favorit";
      favBtn.addEventListener("click", () => toggleFavorite(place.id));

      const noteBtn = node.querySelector(".note-btn");
      noteBtn.addEventListener("click", () => editNote(place.id));

      els.results.appendChild(node);
    });
}

function getVisibleResults() {
  if (!showFavoritesOnly) return currentResults;
  return currentResults.filter(r => r.favorite);
}

function buildExtraLine(place) {
  const extras = [];

  if (place.tags.opening_hours) extras.push(`Öffnung: ${place.tags.opening_hours}`);
  if (place.tags.fee) extras.push(`Gebühr: ${place.tags.fee}`);
  if (place.tags.access) extras.push(`Zugang: ${place.tags.access}`);
  if (place.nearby?.length) extras.push(place.nearby.join(" · "));
  if (place.note) extras.push(`Notiz: ${place.note}`);

  if (["parking", "church", "picnic"].includes(place.categoryKey)) {
    extras.push("Beschilderung prüfen.");
  }

  return extras.join(" · ") || "Keine Zusatzinfos in OSM.";
}

function toggleFavorite(id) {
  const place = currentResults.find(r => r.id === id);
  if (!place) return;
  place.favorite = !place.favorite;

  const favorites = getFavorites();
  favorites[id] = { favorite: place.favorite, note: place.note };
  if (!place.favorite && !place.note) delete favorites[id];
  localStorage.setItem("scf:favorites", JSON.stringify(favorites));

  renderMap();
  renderResults();
}

function editNote(id) {
  const place = currentResults.find(r => r.id === id);
  if (!place) return;

  const note = prompt(`Notiz zu ${place.name}:`, place.note || "");
  if (note === null) return;

  place.note = note.trim();

  const favorites = getFavorites();
  favorites[id] = { favorite: place.favorite, note: place.note };
  if (!place.favorite && !place.note) delete favorites[id];
  localStorage.setItem("scf:favorites", JSON.stringify(favorites));

  renderResults();
}

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem("scf:favorites") || "{}");
  } catch {
    return {};
  }
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

    const favorites = getFavorites();
    currentPlaceLabel = saved.label || "Kartenmitte";
    currentResults = saved.results.map(r => ({
      ...r,
      favorite: Boolean(favorites[r.id]?.favorite),
      note: favorites[r.id]?.note || r.note || ""
    }));

    if (saved.center?.lat && saved.center?.lng) {
      map.setView([saved.center.lat, saved.center.lng], 13);
    }

    renderMap();
    renderResults();
    updateCenterText();
    els.status.textContent = "Letzte Treffer geladen.";
  } catch {}
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
