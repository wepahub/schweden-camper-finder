/* ────────────────────────────────────────────────
   Schweden Camper Finder – Konfiguration
   ──────────────────────────────────────────────── */

export const APP_VERSION = "4.0.0";

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

// Server bricht nach 25 s ab ([timeout:25]); die App wartet etwas länger, damit eine
// langsame, aber gültige Antwort nicht verloren geht
export const OVERPASS_SERVER_TIMEOUT = 25;
export const OVERPASS_TIMEOUT_MS = 40000;
export const MAX_ELEMENTS = 1500;           // Obergrenze pro Overpass-Antwort
export const PAGE_SIZE = 40;                // Ergebniskarten pro Seite
export const DATA_CACHE_MAX_AGE = 6 * 3600 * 1000;
export const MAX_ROUTE_KM = 900;
export const OFFLINE_AREA_RADIUS = 15000;

export const RADIUS_OPTIONS = [1000, 3000, 5000, 10000, 25000, 50000];
export const CORRIDOR_OPTIONS = [500, 1000, 2000, 5000];

const is = (key, ...values) => t => values.includes(t[key]);
const matches = (key, re) => t => re.test(t[key] || "");

/*
  filters:   Overpass-Tagfilter (werden mit nwr kombiniert). Bewusst nur exakte
             key=value-Filter: Reguläre Ausdrücke zwingen Overpass, alle Objekte mit
             dem Schlüssel weltweit zu durchsuchen – das ist um Größenordnungen langsamer.
  primary:   Element gehört eindeutig zu dieser Kategorie (z. B. amenity=toilets)
  secondary: Element hat die Eigenschaft nur nebenbei (z. B. Tankstelle mit toilets=yes)
  extra:     zusätzlicher Ausschlussfilter
*/
export const CATEGORIES = {
  toilets: {
    icon: "🚻", color: "#2563eb", group: "supply", scoreBase: 60,
    filters: ['["amenity"="toilets"]', '["toilets"="yes"]'],
    primary: is("amenity", "toilets"), secondary: is("toilets", "yes")
  },
  water: {
    icon: "💧", color: "#06b6d4", group: "supply", scoreBase: 50,
    filters: ['["amenity"="drinking_water"]', '["amenity"="water_point"]', '["drinking_water"="yes"]'],
    primary: is("amenity", "drinking_water", "water_point"), secondary: is("drinking_water", "yes")
  },
  dump: {
    icon: "🪣", color: "#a16207", group: "supply", scoreBase: 60,
    filters: ['["amenity"="sanitary_dump_station"]', '["sanitary_dump_station"="yes"]', '["sanitary_dump_station"="public"]', '["sanitary_dump_station"="customers"]'],
    primary: is("amenity", "sanitary_dump_station"),
    secondary: matches("sanitary_dump_station", /^(yes|public|customers)$/)
  },
  fuel: {
    icon: "⛽", color: "#dc2626", group: "supply", scoreBase: 40,
    filters: ['["amenity"="fuel"]'],
    primary: is("amenity", "fuel")
  },
  food: {
    icon: "🛒", color: "#f97316", group: "supply", scoreBase: 40,
    filters: ['["shop"="supermarket"]', '["shop"="convenience"]'],
    primary: is("shop", "supermarket", "convenience")
  },
  shower: {
    icon: "🚿", color: "#38bdf8", group: "supply", scoreBase: 40,
    filters: ['["amenity"="shower"]', '["shower"="yes"]', '["shower"="hot"]'],
    primary: is("amenity", "shower"), secondary: is("shower", "yes", "hot")
  },
  laundry: {
    icon: "👕", color: "#2dd4bf", group: "supply", scoreBase: 35,
    filters: ['["shop"="laundry"]', '["washing_machine"="yes"]'],
    primary: is("shop", "laundry"), secondary: is("washing_machine", "yes")
  },
  charging: {
    icon: "🔌", color: "#84cc16", group: "supply", scoreBase: 35,
    filters: ['["amenity"="charging_station"]'],
    primary: is("amenity", "charging_station")
  },
  pharmacy: {
    icon: "💊", color: "#db2777", group: "supply", scoreBase: 35,
    filters: ['["amenity"="pharmacy"]'],
    primary: is("amenity", "pharmacy")
  },
  repair: {
    icon: "🔧", color: "#475569", group: "supply", scoreBase: 30,
    filters: ['["shop"="car_repair"]', '["shop"="caravan"]', '["shop"="tyres"]'],
    primary: is("shop", "car_repair", "caravan", "tyres")
  },
  recycling: {
    icon: "♻️", color: "#15803d", group: "supply", scoreBase: 25,
    filters: ['["amenity"="recycling"]'],
    primary: is("amenity", "recycling")
  },

  camping: {
    icon: "🏕", color: "#22c55e", group: "night", scoreBase: 55,
    filters: ['["tourism"="caravan_site"]', '["tourism"="camp_site"]'],
    primary: is("tourism", "caravan_site", "camp_site")
  },
  parking: {
    icon: "🅿", color: "#94a3b8", group: "night", scoreBase: 30, signCheck: true,
    filters: ['["amenity"="parking"]'],
    primary: is("amenity", "parking"),
    extra: t => !["underground", "multi-storey", "rooftop"].includes(t.parking)
  },
  picnic: {
    icon: "🧺", color: "#f59e0b", group: "night", scoreBase: 35, signCheck: true,
    filters: ['["tourism"="picnic_site"]', '["highway"="rest_area"]'],
    primary: t => t.tourism === "picnic_site" || t.highway === "rest_area"
  },
  shelter: {
    icon: "🛖", color: "#92400e", group: "night", scoreBase: 40,
    filters: ['["amenity"="shelter"]', '["tourism"="wilderness_hut"]', '["tourism"="alpine_hut"]'],
    primary: t => t.amenity === "shelter" || t.tourism === "wilderness_hut" || t.tourism === "alpine_hut",
    extra: t => t.shelter_type !== "public_transport"
  },
  church: {
    icon: "⛪", color: "#8b5cf6", group: "night", scoreBase: 25, signCheck: true,
    filters: ['["amenity"="place_of_worship"]'],
    primary: is("amenity", "place_of_worship"),
    extra: t => !t.religion || t.religion === "christian"
  },

  bathing: {
    icon: "🏖", color: "#facc15", group: "leisure", scoreBase: 45,
    filters: ['["leisure"="swimming_area"]', '["leisure"="beach_resort"]', '["natural"="beach"]'],
    primary: t => t.leisure === "swimming_area" || t.leisure === "beach_resort" || t.natural === "beach"
  },
  firepit: {
    icon: "🔥", color: "#b91c1c", group: "leisure", scoreBase: 35, fireWarning: true,
    filters: ['["leisure"="firepit"]', '["fireplace"="yes"]'],
    primary: is("leisure", "firepit"), secondary: is("fireplace", "yes")
  },
  viewpoint: {
    icon: "👀", color: "#0d9488", group: "leisure", scoreBase: 35,
    filters: ['["tourism"="viewpoint"]'],
    primary: is("tourism", "viewpoint")
  },
  museum: {
    icon: "🏛", color: "#c026d3", group: "leisure", scoreBase: 40,
    filters: ['["tourism"="museum"]'],
    primary: is("tourism", "museum")
  },
  hiking: {
    icon: "🥾", color: "#4d7c0f", group: "leisure", scoreBase: 35, hikingRoutes: true,
    filters: ['["highway"="trailhead"]'],
    primary: t => t.highway === "trailhead" || /^(hiking|foot)$/.test(t.route || "")
  }
};

export const CATEGORY_GROUPS = ["supply", "night", "leisure"];

export const MODES = {
  toilet:  ["toilets"],
  supply:  ["toilets", "water", "dump", "fuel", "food"],
  evening: ["camping", "parking", "picnic", "shelter", "bathing", "toilets", "water"],
  pause:   ["bathing", "picnic", "viewpoint", "toilets", "water", "food", "museum"],
  nature:  ["hiking", "shelter", "firepit", "viewpoint", "bathing"]
};

export const MODE_ICONS = { toilet: "🚻", supply: "💧", evening: "🌙", pause: "🏖", nature: "🥾" };

export const ROUTE_DEFAULT_CATEGORIES = ["toilets", "water", "dump", "camping", "fuel"];

// Kategorien, die beim Speichern eines Offline-Gebiets geladen werden
export const OFFLINE_CATEGORIES = [
  "toilets", "water", "dump", "fuel", "food", "shower", "camping",
  "parking", "picnic", "shelter", "bathing", "firepit", "pharmacy"
];

export const QUICK_FILTERS = ["free", "open", "h24", "toilets", "water", "motorhome", "lpg", "wheelchair"];

export const TILE_LAYERS = {
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxZoom: 17, subdomains: "abc",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, GIS User Community"
  }
};

export const DEFAULT_CENTER = { lat: 59.8586, lon: 17.6389 }; // Uppsala

// ICA Maxi – unser Lieblingsladen – bekommt eine Sonderbehandlung
export function detectStore(tags) {
  const v = [tags.name, tags.brand, tags.operator, tags["name:sv"], tags.official_name]
    .filter(Boolean).join(" ").toLowerCase();
  if (v.includes("ica maxi") || (v.includes("ica") && v.includes("maxi"))) {
    return { key: "ica-maxi", label: "ICA Maxi", icon: "⭐", color: "#16a34a", bonus: 60 };
  }
  if (/\bica\b/.test(v)) return { key: "ica", label: "ICA", icon: "🛒", color: "#ef4444", bonus: 20 };
  if (v.includes("coop")) return { key: "coop", label: "Coop", icon: "🛒", color: "#0ea5e9", bonus: 8 };
  if (v.includes("willys")) return { key: "willys", label: "Willys", icon: "🛒", color: "#ef4444", bonus: 6 };
  if (v.includes("hemköp") || v.includes("hemkop")) return { key: "hemkop", label: "Hemköp", icon: "🛒", color: "#f59e0b", bonus: 6 };
  if (v.includes("lidl")) return { key: "lidl", label: "Lidl", icon: "🛒", color: "#1d4ed8", bonus: 5 };
  return null;
}
