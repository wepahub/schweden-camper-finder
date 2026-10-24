/* ── Karte (Leaflet): Kartenstile, Marker, Radius, Route, Live-Standort ── */

import { TILE_LAYERS } from "./config.js";

export class MapView {
  constructor(el, { center, zoom = 11, layer = "osm", labels, onMoveEnd, onDragStart, onLayerChange }) {
    this.markers = new Map();
    this.map = L.map(el, { zoomControl: false, preferCanvas: true, worldCopyJump: true })
      .setView([center.lat, center.lon], zoom);
    L.control.zoom({ position: "topright" }).addTo(this.map);

    this.layers = {};
    Object.entries(TILE_LAYERS).forEach(([key, cfg]) => {
      this.layers[key] = L.tileLayer(cfg.url, {
        maxZoom: cfg.maxZoom, subdomains: cfg.subdomains || "abc",
        attribution: cfg.attribution, crossOrigin: "anonymous"
      });
    });
    (this.layers[layer] || this.layers.osm).addTo(this.map);
    const named = {};
    Object.keys(this.layers).forEach(k => { named[labels[k]] = this.layers[k]; });
    this.layerControl = L.control.layers(named, null, { position: "topright" }).addTo(this.map);
    this.map.on("baselayerchange", e => {
      const key = Object.keys(this.layers).find(k => this.layers[k] === e.layer);
      onLayerChange?.(key);
    });

    this.cluster = L.markerClusterGroup ? L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      chunkedLoading: true,
      iconCreateFunction: c => L.divIcon({
        html: `<div class="cluster-bubble">${c.getChildCount()}</div>`,
        className: "", iconSize: [40, 40]
      })
    }) : L.layerGroup();
    this.map.addLayer(this.cluster);

    // SVG statt Canvas, damit der Kreis während der Suche per CSS pulsieren kann
    this.radiusCircle = L.circle([center.lat, center.lon], {
      radius: 5000, color: "#1f7a4d", weight: 2, opacity: 0.8, dashArray: "6 6",
      fillColor: "#22c55e", fillOpacity: 0.06, interactive: false,
      renderer: L.svg(), className: "search-radius"
    });
    this.routeLayer = L.layerGroup().addTo(this.map);
    this.userLayer = L.layerGroup().addTo(this.map);

    this.map.on("moveend", () => onMoveEnd?.(this.getCenter()));
    this.map.on("dragstart", () => onDragStart?.());
  }

  getCenter() { const c = this.map.getCenter(); return { lat: c.lat, lon: c.lng }; }
  getZoom() { return this.map.getZoom(); }
  setView(lat, lon, zoom = this.map.getZoom(), animate = true) { this.map.setView([lat, lon], zoom, { animate }); }
  invalidate() { this.map.invalidateSize({ pan: false }); }
  setLayer(key) {
    Object.values(this.layers).forEach(l => this.map.removeLayer(l));
    (this.layers[key] || this.layers.osm).addTo(this.map);
  }
  setLayerLabels(labels) {
    this.map.removeControl(this.layerControl);
    const named = {};
    Object.keys(this.layers).forEach(k => { named[labels[k]] = this.layers[k]; });
    this.layerControl = L.control.layers(named, null, { position: "topright" }).addTo(this.map);
  }

  showRadius(center, radius) {
    if (!center) { this.map.removeLayer(this.radiusCircle); return; }
    this.radiusCircle.setLatLng([center.lat, center.lon]).setRadius(radius);
    if (!this.map.hasLayer(this.radiusCircle)) this.radiusCircle.addTo(this.map);
  }

  showRoute(points, corridor) {
    this.routeLayer.clearLayers();
    if (!points?.length) return;
    const latlngs = points.map(p => [p.lat, p.lon]);
    L.polyline(latlngs, { color: "#0e6b3d", weight: 10, opacity: 0.18, interactive: false }).addTo(this.routeLayer);
    L.polyline(latlngs, { color: "#16a34a", weight: 4, opacity: 0.9, interactive: false }).addTo(this.routeLayer);
    const mk = (p, cls) => L.marker([p.lat, p.lon], {
      icon: L.divIcon({ html: `<div class="route-end ${cls}"></div>`, className: "", iconSize: [18, 18], iconAnchor: [9, 9] }),
      interactive: false, keyboard: false
    }).addTo(this.routeLayer);
    mk(points[0], "start");
    mk(points[points.length - 1], "end");
    this.corridor = corridor;
  }

  fitPoints(points, padding = [40, 40]) {
    if (!points.length) return;
    const b = L.latLngBounds(points.map(p => [p.lat, p.lon]));
    this.map.fitBounds(b, { padding, maxZoom: 15 });
  }

  /*
    items: [{ id, lat, lon }], render(item) → { html, highlight }
    popup(item) → HTMLElement
  */
  setMarkers(items, { render, popup, onClick }) {
    if (this.pendingFocus) { this.map.off("moveend", this.pendingFocus); this.pendingFocus = null; }
    this.cluster.clearLayers();
    this.markers.clear();
    const list = items.map(p => {
      const { html, highlight } = render(p);
      const m = L.marker([p.lat, p.lon], {
        icon: L.divIcon({ html, className: highlight ? "marker-hl" : "", iconSize: [34, 34], iconAnchor: [17, 17] }),
        title: p.title || "", riseOnHover: true
      });
      m.bindPopup(() => popup(p), { maxWidth: 260 });
      m.on("click", () => onClick?.(p));
      this.markers.set(p.id, m);
      return m;
    });
    if (this.cluster.addLayers) this.cluster.addLayers(list);
    else list.forEach(m => this.cluster.addLayer(m));
  }

  // Zum Marker fliegen; offsetY verschiebt das Ziel nach oben (z. B. wegen Bottom Sheet)
  focus(id, { offsetY = 0, openPopup = true } = {}) {
    const m = this.markers.get(id);
    if (!m) return;
    const zoom = Math.max(this.map.getZoom(), 15);
    const target = this.map.unproject(this.map.project(m.getLatLng(), zoom).add([0, offsetY]), zoom);
    if (this.pendingFocus) this.map.off("moveend", this.pendingFocus);
    this.pendingFocus = () => {
      this.pendingFocus = null;
      // Marker kann inzwischen durch eine neue Suche ersetzt worden sein
      if (!openPopup || this.markers.get(id) !== m || !this.cluster.hasLayer(m)) return;
      if (this.cluster.zoomToShowLayer) this.cluster.zoomToShowLayer(m, () => m.openPopup());
      else m.openPopup();
    };
    this.map.once("moveend", this.pendingFocus);
    this.map.flyTo(target, zoom, { duration: 0.6 });
  }

  closePopup() { this.map.closePopup(); }

  setUser(pos) {
    if (!pos) { this.userLayer.clearLayers(); this.userMarker = this.userAccuracy = null; return; }
    const ll = [pos.lat, pos.lon];
    if (!this.userMarker) {
      this.userAccuracy = L.circle(ll, { radius: pos.accuracy || 30, color: "#2563eb", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(this.userLayer);
      this.userMarker = L.marker(ll, {
        icon: L.divIcon({ html: `<div class="user-dot"><div class="user-heading"></div></div>`, className: "", iconSize: [22, 22], iconAnchor: [11, 11] }),
        interactive: false, keyboard: false, zIndexOffset: 1000
      }).addTo(this.userLayer);
    } else {
      this.userMarker.setLatLng(ll);
      this.userAccuracy.setLatLng(ll).setRadius(pos.accuracy || 30);
    }
    this.setHeading(pos.heading);
  }

  setHeading(heading) {
    const el = this.userMarker?.getElement()?.querySelector(".user-dot");
    if (!el) return;
    const has = Number.isFinite(heading);
    el.classList.toggle("has-heading", has);
    if (has) el.style.setProperty("--heading", `${heading}deg`);
  }
}
