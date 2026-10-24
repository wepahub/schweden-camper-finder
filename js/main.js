/* ────────────────────────────────────────────────
   Schweden Camper Finder v4 – Hauptsteuerung
   ──────────────────────────────────────────────── */

import {
  APP_VERSION, CATEGORIES, CATEGORY_GROUPS, MODES, MODE_ICONS, QUICK_FILTERS, RADIUS_OPTIONS,
  CORRIDOR_OPTIONS, ROUTE_DEFAULT_CATEGORIES, DEFAULT_CENTER, PAGE_SIZE, DATA_CACHE_MAX_AGE,
  OVERPASS_TIMEOUT_MS, MAX_ROUTE_KM
} from "./config.js";
import { t, setLanguage, detectLanguage, applyStatic } from "./i18n.js";
import { haversine, simplifyLine, formatDuration, compassArrow } from "./geo.js";
import { buildQuery, fetchOverpass, idsQuery } from "./overpass.js";
import {
  normalize, applySafety, enrichNearby, passesFilters, sortResults, projectOnRoute,
  nearestToLine, inArea, toStorable
} from "./places.js";
import { storage } from "./storage.js";
import { favorites, trips } from "./favorites.js";
import { buildBackup, parseBackup, mergeInto, parseGpx, favoritesFromGpx, favoriteFromResult } from "./backup.js";
import { getCached, putCached, offlineElements } from "./offline.js";
import { geocode, route as fetchRoute } from "./services.js";
import { MapView } from "./mapview.js";
import { $, $$, h, clear, toast, download, pickFile, isDesktop } from "./ui/dom.js";
import { buildCard, buildPopup, buildDetail, markerHtml, displayName, catInfo, dist, compassName, isIcaMaxi } from "./ui/cards.js";
import { initSheet } from "./ui/sheet.js";
import { renderFavoritesTab, openTripDialog, gpxForPlaces } from "./ui/favorites.js";
import { refreshWeather, openWeatherDialog, openAllemansDialog, initMoreTab, sunsetHint } from "./ui/panels.js";

/* ── Einstellungen & Zustand ── */
storage.migrate();
const settings = storage.settings();
setLanguage(detectLanguage(settings.lang));

const validCats = list => Array.isArray(list) ? list.filter(k => CATEGORIES[k]) : null;

const state = {
  tab: "nearby",
  resultTab: "nearby",           // welche Ergebnisse die Karte im Tab „Mehr“ zeigt
  categories: new Set(validCats(settings.categories)?.length ? validCats(settings.categories) : ["toilets"]),
  routeCategories: new Set(validCats(settings.routeCategories)?.length ? validCats(settings.routeCategories) : ROUTE_DEFAULT_CATEGORIES),
  filters: new Set(),
  radius: RADIUS_OPTIONS.includes(settings.radius) ? settings.radius : 5000,
  corridor: CORRIDOR_OPTIONS.includes(settings.corridor) ? settings.corridor : 1000,
  layer: settings.layer || "osm",
  sort: { nearby: "distance", route: "along" },
  searches: { nearby: null, route: null },
  page: { nearby: 1, route: 1 },
  centerLabel: null,             // { label, lat, lon } – gilt, solange die Karte dort bleibt
  user: null,                    // Live-Standort
  locate: "off",                 // off | on | follow
  watchId: null,
  activeMode: null,
  abort: null,
  favShown: [],
  openTrips: new Set()
};

const els = {
  status: $("#statusText"),
  loading: $("#loadingBar"),
  placeForm: $("#placeForm"),
  placeInput: $("#placeInput"),
  placeResults: $("#placeResults"),
  searchHere: $("#searchHereBtn"),
  weatherPill: $("#weatherPill"),
  locateBtn: $("#locateBtn"),
  nearestWcBtn: $("#nearestWcBtn"),
  crosshair: $("#crosshair"),
  sheet: $("#sheet"),
  tabs: $$(".tab"),
  panels: $$(".tab-panel"),
  modeRow: $("#modeRow"),
  chipGroups: $("#chipGroups"),
  routeChips: $("#routeChips"),
  radius: $("#radiusSelect"),
  corridor: $("#corridorSelect"),
  searchBtn: $("#searchBtn"),
  routeForm: $("#routeForm"),
  routeFrom: $("#routeFrom"),
  routeTo: $("#routeTo"),
  routeInfo: $("#routeInfo"),
  routeClear: $("#routeClearBtn"),
  resultsSection: $("#resultsSection"),
  resultCount: $("#resultCount"),
  centerText: $("#centerText"),
  sortBtn: $("#sortBtn"),
  filterRow: $("#filterRow"),
  warning: $("#warningBox"),
  results: $("#resultsList"),
  more: $("#moreResultsBtn")
};

let mapView, sheet;

function init() {
  applyStatic();
  document.title = t("app.title");
  buildModeRow();
  const last = storage.last();
  buildChipGroups(els.chipGroups, state.categories, onCategoryToggle, { open: !last?.searches?.nearby });
  buildChipGroups(els.routeChips, state.routeCategories, () => storage.saveSettings({ routeCategories: [...state.routeCategories] }));
  buildFilterRow();
  buildSelect(els.radius, RADIUS_OPTIONS, state.radius);
  buildSelect(els.corridor, CORRIDOR_OPTIONS, state.corridor);

  const view = settings.view;
  mapView = new MapView($("#map"), {
    center: view ? { lat: view.lat, lon: view.lon } : DEFAULT_CENTER,
    zoom: view?.zoom || 11,
    layer: state.layer,
    labels: { osm: t("map.layers.osm"), topo: t("map.layers.topo"), satellite: t("map.layers.satellite") },
    onMoveEnd,
    onDragStart: () => {
      if (state.locate === "follow") setLocateState("on");
      if (!isDesktop() && sheet.get() !== "peek") sheet.set("peek");
    },
    onLayerChange: key => { state.layer = key; storage.saveSettings({ layer: key }); }
  });

  sheet = initSheet(els.sheet, $("#sheetGrip"), { onChange: () => setTimeout(() => mapView.invalidate(), 260) });

  bindUI();
  initMoreTab({
    getCenter: () => mapView.getCenter(),
    getLabel: currentLabel,
    getLayer: () => state.layer,
    onLanguage: lang => { storage.saveSettings({ lang }); location.reload(); },
    onExport: exportData,
    onImport: importData
  });

  restoreLast();
  switchTab(state.tab, { silent: true });
  renderAll();
  refreshWeather(mapView.getCenter(), currentLabel());
  registerServiceWorker();
  resolveLegacyFavorites();
  window.addEventListener("online", resolveLegacyFavorites);
  window.addEventListener("offline", () => setStatus(t("status.offline")));
  setTimeout(() => mapView.invalidate(), 300);
}

/* ── Aufbau der Bedienelemente ── */
function buildModeRow() {
  clear(els.modeRow);
  Object.keys(MODES).forEach(mode => {
    els.modeRow.append(h("button", {
      type: "button", class: "mode-btn", dataset: { mode }, "aria-pressed": "false",
      onclick: () => applyMode(mode)
    }, `${MODE_ICONS[mode]} ${t(`mode.${mode}`)}`));
  });
}

const chipSummaries = new Map();

// Kategorienauswahl als einklappbarer Block – nach einer Suche stehen die Ergebnisse oben
function buildChipGroups(container, set, onChange, { open = false } = {}) {
  clear(container);
  const summary = h("summary", { class: "cat-summary" });
  const body = h("div", { class: "cat-body" });
  CATEGORY_GROUPS.forEach(group => {
    const chips = Object.entries(CATEGORIES).filter(([, c]) => c.group === group).map(([key, c]) => {
      const chip = h("button", {
        type: "button", class: `chip${set.has(key) ? " active" : ""}`, dataset: { category: key },
        "aria-pressed": String(set.has(key)),
        onclick: () => {
          if (set.has(key)) set.delete(key); else set.add(key);
          syncChips(container, set);
          onChange(key);
        }
      },
        h("span", { class: "dot", style: { background: c.color }, "aria-hidden": "true" }),
        `${c.icon} ${t(`cat.${key}`)}`,
        h("span", { class: "chip-count", hidden: true }));
      return chip;
    });
    body.append(h("p", { class: "group-label" }, t(`group.${group}`)), h("div", { class: "chip-wrap" }, chips));
  });
  const details = h("details", { class: "cat-picker", open }, summary, body);
  container.append(details);
  chipSummaries.set(container, () => {
    clear(summary).append(
      h("span", {}, `${t("cat.pick")} · ${t("cat.active", { n: set.size })}`),
      h("span", { class: "cat-icons", "aria-hidden": "true" }, [...set].map(k => CATEGORIES[k]?.icon).join(""))
    );
  });
  chipSummaries.get(container)();
}

function syncChips(container, set) {
  $$(".chip", container).forEach(c => {
    const on = set.has(c.dataset.category);
    c.classList.toggle("active", on);
    c.setAttribute("aria-pressed", String(on));
  });
  chipSummaries.get(container)?.();
}

function buildFilterRow() {
  clear(els.filterRow);
  QUICK_FILTERS.forEach(f => {
    const btn = h("button", {
      type: "button", class: "filter-chip", "aria-pressed": "false",
      onclick: () => {
        if (state.filters.has(f)) state.filters.delete(f); else state.filters.add(f);
        btn.classList.toggle("active", state.filters.has(f));
        btn.setAttribute("aria-pressed", String(state.filters.has(f)));
        state.page.nearby = state.page.route = 1;
        renderAll();
      }
    }, t(`filter.${f}`));
    els.filterRow.append(btn);
  });
}

function buildSelect(sel, values, current) {
  clear(sel);
  values.forEach(v => sel.append(h("option", { value: v, selected: v === current }, dist(v))));
}

function bindUI() {
  els.tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => {
      switchTab(tab.dataset.tab);
      if (!isDesktop() && sheet.get() === "peek") sheet.set("half");
    });
    // Tastatur: Pfeiltasten wechseln zwischen den Tabs (ARIA-Tablist)
    tab.addEventListener("keydown", e => {
      const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!delta) return;
      e.preventDefault();
      const next = els.tabs[(i + delta + els.tabs.length) % els.tabs.length];
      next.focus();
      next.click();
    });
  });

  els.placeForm.addEventListener("submit", searchPlace);
  els.searchBtn.addEventListener("click", () => runNearbySearch());
  els.searchHere.addEventListener("click", () => runNearbySearch());
  els.radius.addEventListener("change", () => {
    state.radius = Number(els.radius.value);
    storage.saveSettings({ radius: state.radius });
    if (state.tab === "nearby") mapView.showRadius(mapView.getCenter(), state.radius);
    updateSearchHere();
    updateWarning();
  });
  els.corridor.addEventListener("change", () => {
    state.corridor = Number(els.corridor.value);
    storage.saveSettings({ corridor: state.corridor });
  });

  els.sortBtn.addEventListener("click", () => {
    const kind = resultKind();
    const s = state.searches[kind];
    const options = kind === "route" ? ["along", "score", "distance"] : ["distance", "score"];
    state.sort[kind] = options[(options.indexOf(state.sort[kind]) + 1) % options.length];
    if (s) sortResults(s.results, state.sort[kind]);
    state.page[kind] = 1;
    renderAll();
  });
  els.more.addEventListener("click", () => { state.page[resultKind()]++; renderList(); });

  els.routeForm.addEventListener("submit", e => { e.preventDefault(); runRouteSearch(); });
  $("#routeSwap").addEventListener("click", () => {
    [els.routeFrom.value, els.routeTo.value] = [els.routeTo.value, els.routeFrom.value];
  });
  els.routeClear.addEventListener("click", () => {
    state.searches.route = null;
    mapView.showRoute(null);
    els.routeInfo.textContent = "";
    els.routeClear.classList.add("hidden");
    saveLast();
    renderAll();
  });

  els.locateBtn.addEventListener("click", onLocateClick);
  els.nearestWcBtn.addEventListener("click", nearestToilet);
  els.weatherPill.addEventListener("click", openWeatherDialog);
  $("#infoBtn").addEventListener("click", openAllemansDialog);

  $("#newTripBtn").addEventListener("click", () => {
    const name = prompt(t("trip.newName"), t("trip.defaultName", { n: trips.all().length + 1 }));
    if (name && name.trim()) { trips.create(name.trim()); renderAll(); }
  });
  $("#exportJsonBtn").addEventListener("click", () => exportData("json"));
  $("#exportGpxBtn").addEventListener("click", () => exportData("gpx"));
  $("#importBtn").addEventListener("click", importData);

  document.addEventListener("click", e => {
    if (!els.placeForm.contains(e.target)) els.placeResults.classList.add("hidden");
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") els.placeResults.classList.add("hidden");
  });
  window.addEventListener("pagehide", saveView);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveView(); else mapView.invalidate(); });
}

/* ── Tabs ── */
function switchTab(tab, { silent = false } = {}) {
  state.tab = tab;
  if (tab === "nearby" || tab === "route") state.resultTab = tab;
  els.tabs.forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  els.panels.forEach(p => { p.hidden = p.id !== `tab-${tab}`; });
  els.resultsSection.hidden = !(tab === "nearby" || tab === "route");
  els.crosshair.classList.toggle("hidden", tab !== "nearby");
  if (!silent) renderAll();
}

const resultKind = () => (state.tab === "route" || state.tab === "nearby" ? state.tab : state.resultTab);

/* ── Status ── */
function setStatus(text) { els.status.textContent = text; }
function setLoading(on) { els.loading.classList.toggle("on", on); els.loading.setAttribute("aria-busy", String(on)); }

function currentLabel() {
  const c = mapView.getCenter();
  const l = state.centerLabel;
  if (l && haversine(c.lat, c.lon, l.lat, l.lon) < 150) return l.label;
  return t("place.mapCenter");
}

function onMoveEnd(center) {
  if (state.tab === "nearby") mapView.showRadius(center, state.radius);
  updateSearchHere();
  renderCenterText();
  clearTimeout(onMoveEnd.timer);
  onMoveEnd.timer = setTimeout(saveView, 800);
}

function saveView() {
  const c = mapView.getCenter();
  storage.saveSettings({ view: { lat: c.lat, lon: c.lon, zoom: mapView.getZoom() } });
}

function updateSearchHere() {
  const s = state.searches.nearby;
  const c = mapView.getCenter();
  const show = state.tab === "nearby" && s &&
    (haversine(c.lat, c.lon, s.origin.lat, s.origin.lon) > Math.max(250, state.radius * 0.25) || s.area.radius !== state.radius);
  els.searchHere.classList.toggle("hidden", !show);
}

function renderCenterText() {
  const kind = resultKind();
  if (kind === "route") {
    const r = state.searches.route?.route;
    els.centerText.textContent = r ? routeInfoText(r) : "";
    return;
  }
  const s = state.searches.nearby;
  if (s) els.centerText.textContent = `${t("status.center", { place: s.label })} · ${dist(s.area.radius)}`;
  else {
    const c = mapView.getCenter();
    els.centerText.textContent = `${t("status.center", { place: currentLabel() })} (${c.lat.toFixed(4)}, ${c.lon.toFixed(4)})`;
  }
}

/* ── Modi & Kategorien ── */
function applyMode(mode) {
  state.activeMode = mode;
  state.categories = new Set(MODES[mode]);
  syncChips(els.chipGroups, state.categories);
  updateModeButtons();
  storage.saveSettings({ categories: [...state.categories] });
  if (state.tab !== "nearby") switchTab("nearby");
  runNearbySearch();
}

function onCategoryToggle() {
  state.activeMode = null;
  updateModeButtons();
  storage.saveSettings({ categories: [...state.categories] });
  updateWarning();
}

function updateModeButtons() {
  $$(".mode-btn", els.modeRow).forEach(b => {
    const on = b.dataset.mode === state.activeMode;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function updateChipCounts() {
  const fill = (container, search) => {
    const counts = {};
    (search?.results || []).forEach(r => { counts[r.catKey] = (counts[r.catKey] || 0) + 1; });
    $$(".chip", container).forEach(chip => {
      const badge = chip.querySelector(".chip-count");
      const n = counts[chip.dataset.category];
      badge.hidden = !n;
      badge.textContent = n ? String(n) : "";
    });
  };
  fill(els.chipGroups, state.searches.nearby);
  fill(els.routeChips, state.searches.route);
}

function updateWarning() {
  const kind = resultKind();
  const cats = kind === "route" ? state.routeCategories : state.categories;
  const msgs = [];
  if ([...cats].some(k => CATEGORIES[k]?.signCheck)) msgs.push(`⚠️ ${t("warn.signs")}`);
  if ([...cats].some(k => CATEGORIES[k]?.fireWarning)) msgs.push(`🔥 ${t("warn.fire")}`);
  if (kind === "nearby" && state.radius >= 25000 && cats.size > 3) msgs.push(`⏳ ${t("warn.bigRadius")}`);
  clear(els.warning);
  msgs.forEach(m => els.warning.append(h("p", {}, m)));
  els.warning.classList.toggle("hidden", !msgs.length || state.tab === "favorites" || state.tab === "more");
}

/* ── Ortssuche ── */
async function searchPlace(e) {
  e.preventDefault();
  const q = els.placeInput.value.trim();
  if (!q) return;
  setStatus(t("status.placeSearching", { q }));
  clear(els.placeResults);
  els.placeResults.classList.add("hidden");
  setLoading(true);
  try {
    const places = await geocode(q, { lang: document.documentElement.lang });
    if (!places.length) { setStatus(t("status.placeNone")); return; }
    if (places.length === 1) { choosePlace(places[0]); return; }
    places.forEach(p => els.placeResults.append(h("button", {
      type: "button", class: "place-result", role: "option", onclick: () => choosePlace(p)
    }, p.full || p.label)));
    els.placeResults.classList.remove("hidden");
    els.placeResults.querySelector("button")?.focus();
    setStatus(t("status.placeChoose"));
  } catch (err) {
    console.error(err);
    setStatus(t("status.placeFailed"));
  } finally {
    setLoading(false);
  }
}

function choosePlace(p) {
  state.centerLabel = { label: p.label, lat: p.lat, lon: p.lon };
  els.placeInput.value = p.label;
  els.placeResults.classList.add("hidden");
  if (state.tab !== "nearby") switchTab("nearby");
  mapView.setView(p.lat, p.lon, 13, false);
  setStatus(t("status.center", { place: p.label }));
  refreshWeather(p, p.label);
  renderCenterText();
}

/* ── Suche ── */
async function runNearbySearch(center = mapView.getCenter()) {
  const categories = [...state.categories];
  if (!categories.length) { setStatus(t("status.noCategory")); return null; }
  const label = currentLabel();
  const area = { type: "circle", lat: center.lat, lon: center.lon, radius: state.radius };
  setStatus(t("status.searching", { radius: dist(state.radius), place: label }));
  mapView.showRadius(center, state.radius);
  const s = await executeSearch({
    kind: "nearby", area, categories, origin: center, label, maxDistance: state.radius,
    retry: () => runNearbySearch(center)
  });
  if (s) showResults(els.chipGroups, s);
  if (s) {
    refreshWeather(center, label);
    if (state.activeMode === "evening") {
      const hint = sunsetHint(center);
      if (hint) setStatus(`${els.status.textContent} · ${hint}`);
    }
  }
  return s;
}

async function executeSearch({ kind, area, categories, origin, label, route, maxDistance, normalizeOptions, retry }) {
  state.abort?.abort();
  const ctrl = new AbortController();
  state.abort = ctrl;
  setLoading(true);
  if (resultKind() === kind) { clear(els.results).append(h("p", { class: "empty" }, t("results.loading"))); }

  const isLine = area.type === "line";
  const query = buildQuery(area, categories, isLine ? { timeout: 90 } : {});
  let server = "";
  const slowTimer = setTimeout(() => setStatus(t("status.slow", { server })), 8000);

  try {
    let elements, source = "live";
    const cached = await getCached(query, DATA_CACHE_MAX_AGE);
    if (cached) { elements = cached.elements; source = "cache"; }
    else {
      try {
        const data = await fetchOverpass(query, {
          signal: ctrl.signal,
          timeoutMs: isLine ? 105000 : OVERPASS_TIMEOUT_MS,
          onAttempt: ep => { server = new URL(ep).hostname; }
        });
        elements = data.elements || [];
        putCached(query, elements);
      } catch (err) {
        if (err.name === "AbortError") throw err;
        console.warn(err, err.details);
        const stale = await getCached(query, Infinity);
        if (stale) { elements = stale.elements; source = "stale"; }
        else {
          elements = await offlineElements(area);
          if (!elements.length) throw err;
          source = "offline";
        }
      }
    }
    if (ctrl.signal.aborted) return null;

    let results = normalize(elements, categories, origin, normalizeOptions).filter(applySafety);
    if (route) projectOnRoute(results, route.points);
    results = results.filter(p => inArea(p, { radius: maxDistance }));
    enrichNearby(results);
    favorites.apply(results);
    sortResults(results, state.sort[kind]);

    const search = { kind, origin, label, area: { ...area, radius: maxDistance }, categories, results, source, time: Date.now(), route };
    state.searches[kind] = search;
    state.page[kind] = 1;
    saveLast();
    renderAll();

    const ica = results.filter(isIcaMaxi).length;
    const parts = [results.length ? t("status.results", { n: results.length }) : t("status.none")];
    if (ica) parts.push(t("status.icaMaxi", { n: ica }));
    if (source === "cache") parts.push(t("status.fromCache"));
    if (source === "stale") parts.push(t("status.stale"));
    if (source === "offline") parts.push(t("status.offlineArea"));
    setStatus(parts.join(" · "));
    return search;
  } catch (err) {
    if (err.name === "AbortError") return null;
    console.error(err, err.details);
    const allTimeouts = err.details?.length && err.details.every(d => /Timeout|HTTP (429|504)/.test(d));
    setStatus(t(allTimeouts ? "status.busy" : "status.failed"));
    if (resultKind() === kind) clear(els.results).append(h("p", { class: "empty" }, t("results.loadFailed")));
    if (retry) toast(t(allTimeouts ? "status.busy" : "status.failed"), { duration: 10000, action: { label: t("common.retry"), onClick: retry } });
    return null;
  } finally {
    clearTimeout(slowTimer);
    if (state.abort === ctrl) { state.abort = null; setLoading(false); }
  }
}

/* ── Route ── */
function routeInfoText(r) {
  return t("route.info", { from: r.from, to: r.to, dist: dist(r.distance), time: formatDuration(r.duration) });
}

async function resolvePlace(text) {
  if (!text) {
    const pos = await currentPosition().catch(() => null);
    if (pos) return { ...pos, label: t("place.myLocation") };
    const c = mapView.getCenter();
    return { ...c, label: currentLabel() };
  }
  const [p] = await geocode(text, { lang: document.documentElement.lang, limit: 1 });
  if (!p) throw Object.assign(new Error("not found"), { userMessage: t("route.notFound", { q: text }) });
  return p;
}

async function runRouteSearch() {
  const toText = els.routeTo.value.trim();
  if (!toText) { setStatus(t("route.needTo")); els.routeTo.focus(); return; }
  const categories = [...state.routeCategories];
  if (!categories.length) { setStatus(t("status.noCategory")); return; }
  setStatus(t("route.routing"));
  setLoading(true);
  let from, to, r;
  try {
    from = await resolvePlace(els.routeFrom.value.trim());
    to = await resolvePlace(toText);
    r = await fetchRoute(from, to);
  } catch (err) {
    console.error(err);
    setStatus(err.userMessage || t("route.failed"));
    setLoading(false);
    return;
  }
  if (r.distance > MAX_ROUTE_KM * 1000) {
    setStatus(t("route.tooLong", { km: dist(r.distance), max: MAX_ROUTE_KM }));
    setLoading(false);
    return;
  }

  // Feine Linie für Anzeige & Projektion, grobe Linie für die Overpass-Abfrage
  const fine = simplifyLine(r.points, 25);
  let tol = 60, coarse = simplifyLine(r.points, tol);
  while (coarse.length > 120) { tol *= 1.5; coarse = simplifyLine(r.points, tol); }

  const routeData = {
    from: from.label, to: to.label, distance: r.distance, duration: r.duration,
    points: fine, corridor: state.corridor
  };
  mapView.showRoute(fine);
  mapView.fitPoints(fine);
  els.routeInfo.textContent = routeInfoText(routeData);
  els.routeClear.classList.remove("hidden");
  setStatus(t("status.searchingRoute"));

  const s = await executeSearch({
    kind: "route",
    area: { type: "line", points: coarse, radius: state.corridor + tol },
    categories, origin: from, label: `${from.label} → ${to.label}`,
    route: routeData, maxDistance: state.corridor,
    normalizeOptions: { pickPoint: nearestToLine(fine) },
    retry: () => runRouteSearch()
  });
  if (s) showResults(els.routeChips, s);
}

function showResults(chipContainer, search) {
  const picker = chipContainer.querySelector(".cat-picker");
  if (picker) picker.open = false;
  if (!isDesktop() && sheet.get() === "peek" && search.results.length) sheet.set("half");
  requestAnimationFrame(() => {
    const body = $(".sheet-body");
    body.scrollTo({ top: Math.max(0, els.resultsSection.offsetTop - body.offsetTop - 8), behavior: "smooth" });
  });
}

/* ── Rendering ── */
function visibleResults(kind) {
  const s = state.searches[kind];
  if (!s) return [];
  const now = new Date();
  return state.filters.size ? s.results.filter(p => passesFilters(p, state.filters, now)) : s.results;
}

function renderAll() {
  if (state.tab === "favorites") renderFavorites();
  else renderList();
  renderMap();
  updateChipCounts();
  updateWarning();
  updateSearchHere();
  renderCenterText();
}

const cardHandlers = {
  onFocus: p => focusPlace(p),
  onDetails: p => openDetail(p),
  onFav: p => toggleFavorite(p),
  onNote: p => editNote(p),
  onTrip: p => addToTrip(p),
  onShare: p => sharePlace(p)
};

function renderList() {
  const kind = resultKind();
  const s = state.searches[kind];
  const sortLabels = { distance: t("sort.distance"), score: t("sort.score"), along: t("sort.along") };
  els.sortBtn.textContent = `↕ ${sortLabels[state.sort[kind]]}`;
  els.sortBtn.setAttribute("aria-label", `${t("sort.label")}: ${sortLabels[state.sort[kind]]}`);
  clear(els.results);
  els.more.classList.add("hidden");
  if (!s) {
    els.resultCount.textContent = "";
    els.results.append(h("p", { class: "empty" }, t(kind === "route" ? "results.routeEmpty" : "results.empty")));
    return;
  }
  const list = visibleResults(kind);
  els.resultCount.textContent = list.length ? String(list.length) : "";
  if (!list.length) {
    els.results.append(h("p", { class: "empty" }, s.results.length ? t("results.noneFiltered") : t("status.none")));
    return;
  }
  const shown = list.slice(0, state.page[kind] * PAGE_SIZE);
  const now = new Date();
  const frag = document.createDocumentFragment();
  shown.forEach(p => frag.append(buildCard(p, cardHandlers, now)));
  els.results.append(frag);
  const rest = list.length - shown.length;
  if (rest > 0) {
    els.more.textContent = t("results.more", { n: Math.min(rest, PAGE_SIZE) });
    els.more.classList.remove("hidden");
  }
}

function renderFavorites() {
  state.favShown = renderFavoritesTab({
    origin: () => state.user || mapView.getCenter(),
    cardHandlers,
    openTrips: state.openTrips,
    onFocusPlace: p => focusPlace(p),
    onShowPlaces: list => { state.favShown = list; renderMap(); mapView.fitPoints(list); if (!isDesktop()) sheet.set("peek"); },
    onPlanRoute: (a, b) => {
      els.routeFrom.value = `${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}`;
      els.routeTo.value = `${b.lat.toFixed(5)}, ${b.lon.toFixed(5)}`;
      switchTab("route");
    },
    refresh: renderAll
  });
}

function renderMap() {
  let items;
  if (state.tab === "favorites") items = state.favShown;
  else items = visibleResults(resultKind());
  mapView.setMarkers(items.map(p => ({ ...p, title: displayName(p) })), {
    render: markerHtml,
    popup: p => buildPopup(p, { onDetails: openDetail }),
    onClick: p => highlightCard(p.id)
  });
  // Radius nur im Tab „Umgebung“, Route nur im Tab „Route“
  if (state.tab === "nearby") mapView.showRadius(mapView.getCenter(), state.radius);
  else mapView.showRadius(null);
  const r = state.searches.route?.route;
  mapView.showRoute(resultKind() === "route" && state.tab !== "favorites" && r ? r.points : null);
}

function focusPlace(p) {
  if (!isDesktop()) sheet.set("peek");
  const covered = sheet.coveredPx();
  setTimeout(() => {
    if (!mapView.markers.has(p.id)) {
      // Ort ist gerade nicht auf der Karte (z. B. Filter) → nur hinfliegen
      mapView.setView(p.lat, p.lon, 15);
      return;
    }
    mapView.focus(p.id, { offsetY: covered / 2 });
  }, isDesktop() ? 0 : 280);
}

function highlightCard(id) {
  const card = document.querySelector(`.result-card[data-id="${CSS.escape(id)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("flash");
  setTimeout(() => card.classList.remove("flash"), 1200);
}

/* ── Favoriten, Notizen, Reisen ── */
function findPlace(id) {
  for (const s of Object.values(state.searches)) {
    const p = s?.results.find(r => r.id === id);
    if (p) return p;
  }
  return null;
}

function syncPlace(rec, id) {
  const p = findPlace(id);
  if (p) { p.favorite = Boolean(rec?.favorite); p.note = rec?.note || ""; }
}

function toggleFavorite(p) {
  const before = favorites.get(p.id);
  if (!favorites.toggle(p)) { toast(t("more.storageFull")); return; }
  const now = favorites.get(p.id);
  syncPlace(now, p.id);
  p.favorite = Boolean(now?.favorite);
  p.note = now?.note || "";
  if (!p.favorite && before?.favorite) {
    toast(t("fav.removed"), { action: { label: t("fav.undo"), onClick: () => { favorites.restore(before); syncPlace(before, p.id); renderAll(); } } });
  }
  saveLast();
  renderAll();
  refreshOpenDetail(p.id);
}

function editNote(p) {
  const dialog = $("#noteDialog");
  $("#noteDialogLabel").textContent = t("note.title", { name: displayName(p) });
  const text = $("#noteDialogText");
  text.value = favorites.get(p.id)?.note || p.note || "";
  dialog.onclose = () => {
    if (dialog.returnValue !== "save") return;
    const rec = favorites.setNote(p, text.value.trim());
    p.note = rec?.note || "";
    syncPlace(rec || favorites.get(p.id), p.id);
    renderAll();
    refreshOpenDetail(p.id);
  };
  dialog.returnValue = "";
  dialog.showModal();
}

function addToTrip(p) {
  openTripDialog(p, {
    onDone: trip => {
      syncPlace(favorites.get(p.id), p.id);
      p.favorite = true;
      toast(t("trip.added", { trip: trip.name }));
      renderAll();
      refreshOpenDetail(p.id);
    }
  });
}

function sharePlace(p) {
  const url = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
  navigator.share?.({ title: displayName(p), text: t("share.text", { name: displayName(p), cat: catInfo(p.catKey).label }), url }).catch(() => {});
}

let detailId = null;
function openDetail(p) {
  detailId = p.id;
  const dialog = $("#detailDialog");
  renderDetail(p);
  dialog.onclose = () => { detailId = null; };
  if (!dialog.open) dialog.showModal();
}

function renderDetail(p) {
  const box = clear($("#detailContent"));
  box.append(buildDetail(p, {
    ...cardHandlers,
    onCopy: async coords => {
      try { await navigator.clipboard.writeText(coords); toast(t("detail.copied")); } catch { prompt("", coords); }
    }
  }));
}

function refreshOpenDetail(id) {
  if (detailId !== id) return;
  const p = findPlace(id) || (() => {
    const f = favorites.get(id);
    if (!f) return null;
    const o = state.user || mapView.getCenter();
    return { ...f, distance: haversine(o.lat, o.lon, f.lat, f.lon), bearing: 0 };
  })();
  if (p) renderDetail(p);
}

/* ── Export / Import ── */
function exportData(kind) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === "gpx") {
    download(`camper-favoriten-${stamp}.gpx`, gpxForPlaces(favorites.list(), t("fav.title")), "application/gpx+xml");
  } else {
    download(`camper-backup-${stamp}.json`, JSON.stringify(buildBackup(storage.favorites(), trips.all(), APP_VERSION), null, 2), "application/json");
  }
}

async function importData() {
  const file = await pickFile(".json,.gpx,application/json,application/gpx+xml");
  if (!file) return;
  try {
    const text = await file.text();
    const incoming = /\.gpx$/i.test(file.name) || text.trimStart().startsWith("<")
      ? { favorites: favoritesFromGpx(parseGpx(text)), trips: [] }
      : parseBackup(text);
    const favs = storage.favorites();
    const tripList = trips.all();
    const added = mergeInto(favs, tripList, incoming);
    storage.saveFavorites(favs);
    storage.saveTrips(tripList);
    Object.values(state.searches).forEach(s => s && favorites.apply(s.results));
    toast(t("fav.imported", { n: added }));
    renderAll();
  } catch (err) {
    console.error(err);
    toast(t("fav.importFailed"));
  }
}

/* ── Alte Favoriten (v3.x ohne Koordinaten) nachladen ── */
async function resolveLegacyFavorites() {
  const pending = storage.unresolved();
  if (!pending.length || !navigator.onLine) return;
  const query = idsQuery(pending.map(p => p.id));
  if (!query) { storage.saveUnresolved([]); return; }
  try {
    const data = await fetchOverpass(query);
    const els2 = data.elements || [];
    const origin = mapView.getCenter();
    const classified = new Map(normalize(els2, Object.keys(CATEGORIES), origin).map(r => [r.id, r]));
    const favs = storage.favorites();
    let n = 0;
    els2.forEach(el => {
      const id = `${el.type}/${el.id}`;
      const old = pending.find(p => p.id === id);
      if (!old) return;
      const r = classified.get(id) || {
        id, osmType: el.type, osmId: el.id, catKey: "custom", tags: el.tags || {},
        name: el.tags?.name || null, lat: el.lat ?? el.center?.lat, lon: el.lon ?? el.center?.lon
      };
      if (r.lat == null) return;
      favs[id] = favoriteFromResult(r, { favorite: old.favorite, note: old.note });
      n++;
    });
    storage.saveFavorites(favs);
    storage.saveUnresolved([]);
    if (n) { toast(t("fav.resolved", { n })); renderAll(); }
  } catch (err) {
    console.warn("Alte Favoriten konnten nicht nachgeladen werden", err);
  }
}

/* ── Letzte Ergebnisse ── */
function saveLast() {
  const pack = s => s && { ...s, results: s.results.slice(0, 300).map(toStorable) };
  storage.saveLast({
    version: APP_VERSION,
    searches: { nearby: pack(state.searches.nearby), route: pack(state.searches.route) },
    centerLabel: state.centerLabel
  });
}

function restoreLast() {
  const saved = storage.last();
  if (!saved?.searches) return;
  state.centerLabel = saved.centerLabel || null;
  ["nearby", "route"].forEach(kind => {
    const s = saved.searches[kind];
    if (!s?.results) return;
    favorites.apply(s.results);
    sortResults(s.results, state.sort[kind]);
    state.searches[kind] = s;
  });
  const r = state.searches.route?.route;
  if (r) {
    els.routeInfo.textContent = routeInfoText(r);
    els.routeClear.classList.remove("hidden");
  }
  if (state.searches.nearby || state.searches.route) setStatus(t("status.lastLoaded"));
}

/* ── Standort ── */
function currentPosition() {
  if (state.user && Date.now() - state.user.time < 60000) return Promise.resolve(state.user);
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("unsupported")); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, time: Date.now() }),
      reject,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

function setLocateState(s) {
  state.locate = s;
  els.locateBtn.classList.toggle("on", s !== "off");
  els.locateBtn.classList.toggle("follow", s === "follow");
  els.locateBtn.setAttribute("aria-pressed", String(s !== "off"));
}

function onLocateClick() {
  if (!navigator.geolocation) { setStatus(t("status.gpsUnsupported")); return; }
  if (state.locate === "on") {
    setLocateState("follow");
    if (state.user) centerOnUser();
    return;
  }
  if (state.locate === "follow") {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    state.user = null;
    mapView.setUser(null);
    setLocateState("off");
    setStatus(t("locate.stopped"));
    return;
  }
  requestCompass();
  setStatus(t("status.locating"));
  setLocateState("follow");
  let first = true;
  state.watchId = navigator.geolocation.watchPosition(pos => {
    const c = pos.coords;
    const gpsHeading = Number.isFinite(c.heading) && c.speed > 1;
    state.user = {
      lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, time: Date.now(),
      gpsHeading, heading: gpsHeading ? c.heading : state.compass
    };
    mapView.setUser(state.user);
    if (first) {
      first = false;
      centerOnUser(14);
      setStatus(t("status.located"));
      refreshWeather(state.user, t("place.myLocation"));
    } else if (state.locate === "follow") centerOnUser();
  }, () => {
    if (first) {
      setStatus(t("status.noGps"));
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
      setLocateState("off");
    }
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
}

function centerOnUser(zoom) {
  const u = state.user;
  state.centerLabel = { label: t("place.myLocation"), lat: u.lat, lon: u.lon };
  mapView.setView(u.lat, u.lon, zoom || mapView.getZoom());
}

function requestCompass() {
  const listen = () => {
    const handler = e => {
      const heading = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null);
      if (heading == null) return;
      state.compass = heading;
      if (!state.user || state.user.gpsHeading || requestCompass.frame) return;
      requestCompass.frame = requestAnimationFrame(() => {
        requestCompass.frame = 0;
        if (state.user) { state.user.heading = state.compass; mapView.setHeading(state.compass); }
      });
    };
    window.addEventListener("deviceorientationabsolute", handler);
    window.addEventListener("deviceorientation", handler);
  };
  if (requestCompass.done) return;
  requestCompass.done = true;
  const DOE = window.DeviceOrientationEvent;
  if (DOE?.requestPermission) DOE.requestPermission().then(r => { if (r === "granted") listen(); }).catch(() => {});
  else if (DOE) listen();
}

/* ── Nächstes WC ── */
async function nearestToilet() {
  setStatus(t("nearestWc.searching"));
  let origin = state.user;
  if (!origin) origin = await currentPosition().catch(() => null);
  if (origin) {
    state.centerLabel = { label: t("place.myLocation"), lat: origin.lat, lon: origin.lon };
    mapView.setView(origin.lat, origin.lon, 14, false);
  } else origin = mapView.getCenter();

  state.categories = new Set(["toilets"]);
  state.activeMode = "toilet";
  syncChips(els.chipGroups, state.categories);
  updateModeButtons();
  if (state.tab !== "nearby") switchTab("nearby");

  let s = null;
  for (const radius of [2000, 10000]) {
    state.radius = radius;
    buildSelect(els.radius, [...new Set([...RADIUS_OPTIONS, radius])].sort((a, b) => a - b), radius);
    s = await runNearbySearch({ lat: origin.lat, lon: origin.lon });
    if (!s) return;
    if (s.results.length) break;
  }
  const best = [...s.results].sort((a, b) => a.distance - b.distance)[0];
  if (!best) { setStatus(t("nearestWc.none")); return; }
  const msg = t("nearestWc.found", { name: displayName(best), dist: dist(best.distance), dir: `${compassArrow(best.bearing)} ${compassName(best.bearing)}` });
  setStatus(msg);
  toast(msg);
  focusPlace(best);
}

/* ── Service Worker ── */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register("service-worker.js").catch(err => console.warn("SW", err));
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    toast(t("update.available"), { duration: 0, action: { label: t("update.reload"), onClick: () => location.reload() } });
  });
}

init();
