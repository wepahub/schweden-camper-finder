/* ── Externe Dienste: Ortssuche (Nominatim), Routing (OSRM), Wetter (Open-Meteo) ── */

let nominatimLast = 0;

// "59.85, 17.63" oder "59.85 17.63" direkt als Koordinate verstehen
export function parseCoordinates(text) {
  const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1].replace(",", ".")), lon = Number(m[2].replace(",", "."));
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` };
}

export async function geocode(query, { lang = "de", signal, limit = 6 } = {}) {
  const coords = parseCoordinates(query);
  if (coords) return [coords];
  // Nominatim-Nutzungsrichtlinie: höchstens 1 Anfrage pro Sekunde
  const wait = Math.max(0, 1100 - (Date.now() - nominatimLast));
  if (wait) await new Promise(r => setTimeout(r, wait));
  nominatimLast = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("countrycodes", "se,no,fi,dk");
  url.searchParams.set("accept-language", lang);
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  return data.map(p => ({
    lat: Number(p.lat), lon: Number(p.lon),
    label: p.display_name.split(",").slice(0, 3).join(",").trim(),
    full: p.display_name
  }));
}

export async function route(from, to, { signal } = {}) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const data = await res.json();
  const r = data.routes?.[0];
  if (data.code !== "Ok" || !r) throw new Error(data.message || "Keine Route gefunden");
  return {
    points: r.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    distance: r.distance,
    duration: r.duration
  };
}

const weatherCache = new Map();

export async function weather(lat, lon, { signal } = {}) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.time < 30 * 60 * 1000) return hit.data;
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(3));
  url.searchParams.set("longitude", lon.toFixed(3));
  url.searchParams.set("current", "temperature_2m,wind_speed_10m,weather_code,precipitation");
  url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "3");
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const d = await res.json();
  const data = {
    current: {
      temp: d.current?.temperature_2m,
      wind: d.current?.wind_speed_10m,
      code: d.current?.weather_code,
      precip: d.current?.precipitation
    },
    daily: (d.daily?.time || []).map((date, i) => ({
      date,
      code: d.daily.weather_code[i],
      max: d.daily.temperature_2m_max[i],
      min: d.daily.temperature_2m_min[i],
      pop: d.daily.precipitation_probability_max?.[i],
      wind: d.daily.wind_speed_10m_max?.[i]
    }))
  };
  weatherCache.set(key, { time: Date.now(), data });
  return data;
}

export function weatherIcon(code) {
  if (code == null) return { icon: "🌡", key: "unknown" };
  if (code === 0) return { icon: "☀️", key: "clear" };
  if (code <= 2) return { icon: "🌤", key: "partly" };
  if (code === 3) return { icon: "☁️", key: "cloudy" };
  if (code <= 48) return { icon: "🌫", key: "fog" };
  if (code <= 57) return { icon: "🌦", key: "drizzle" };
  if (code <= 67) return { icon: "🌧", key: "rain" };
  if (code <= 77) return { icon: "🌨", key: "snow" };
  if (code <= 82) return { icon: "🌦", key: "showers" };
  if (code <= 86) return { icon: "🌨", key: "snow" };
  return { icon: "⛈", key: "thunder" };
}

// Mücken mögen warme, windstille Sommerabende
export function mosquitoRisk(current, date = new Date()) {
  if (!current || current.temp == null || current.wind == null) return false;
  const m = date.getMonth();
  return m >= 5 && m <= 8 && current.temp >= 12 && current.wind < 3.5;
}
