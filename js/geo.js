/* ── Geometrie, Entfernungen, Sonnenzeiten ── */

const R_EARTH = 6371000;
const rad = d => d * Math.PI / 180;
const deg = r => r * 180 / Math.PI;

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingTo(lat1, lon1, lat2, lon2) {
  const dLon = rad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const ARROWS = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
export const compassIndex = bearing => Math.round(bearing / 45) % 8;
export const compassArrow = bearing => ARROWS[compassIndex(bearing)];

export function formatDist(m, lang = "de") {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  const digits = km < 100 ? 1 : 0;
  return `${km.toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}

export function formatDuration(seconds) {
  const min = Math.round(seconds / 60);
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

// Lokale, flache Projektion in Metern (für kurze Strecken ausreichend genau)
function projector(lat0) {
  const kx = Math.cos(rad(lat0)) * 111320, ky = 110540;
  return p => ({ x: p.lon * kx, y: p.lat * ky });
}

// Douglas-Peucker-Vereinfachung, Toleranz in Metern
export function simplifyLine(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const proj = projector(points[0].lat);
  const xy = points.map(proj);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(xy[i], xy[a], xy[b]).dist;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx, y = a.y + t * dy;
  return { dist: Math.hypot(p.x - x, p.y - y), t };
}

// Vereinfacht eine Linie so lange, bis sie höchstens maxPoints Punkte hat
export function simplifyToMax(points, maxPoints, startTolerance = 50) {
  let tol = startTolerance, out = simplifyLine(points, tol);
  while (out.length > maxPoints) { tol *= 1.6; out = simplifyLine(points, tol); }
  return out;
}

export function lineLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += haversine(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  return sum;
}

/*
  Projiziert einen Punkt auf eine Linie.
  Liefert { along: Meter ab Start, offset: Meter Abstand zur Linie }.
*/
export function projectOnLine(point, line, cumulative = cumulativeLengths(line)) {
  const proj = projector(point.lat);
  const p = proj(point);
  let best = { along: 0, offset: Infinity };
  for (let i = 1; i < line.length; i++) {
    const a = proj(line[i - 1]), b = proj(line[i]);
    const { dist, t } = segmentDistance(p, a, b);
    if (dist < best.offset) {
      best = { offset: dist, along: cumulative[i - 1] + t * (cumulative[i] - cumulative[i - 1]) };
    }
  }
  if (line.length === 1) best = { along: 0, offset: haversine(point.lat, point.lon, line[0].lat, line[0].lon) };
  return best;
}

export function cumulativeLengths(line) {
  const out = [0];
  for (let i = 1; i < line.length; i++) {
    out.push(out[i - 1] + haversine(line[i - 1].lat, line[i - 1].lon, line[i].lat, line[i].lon));
  }
  return out;
}

// Nächster Punkt einer Punktliste zu einem Ursprung
export function nearestPoint(origin, points) {
  let best = null, bestD = Infinity;
  for (const p of points) {
    const d = haversine(origin.lat, origin.lon, p.lat, p.lon);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best ? { point: best, distance: bestD } : null;
}

/* ── Kacheln (für Offline-Vorladen) ── */
export function lonToTileX(lon, z) { return Math.floor((lon + 180) / 360 * 2 ** z); }
export function latToTileY(lat, z) {
  const r = rad(lat);
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z);
}

export function boundsAround(lat, lon, radius) {
  const dLat = radius / 110540;
  const dLon = radius / (111320 * Math.cos(rad(lat)));
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
}

export function tilesForBounds(b, zooms) {
  const tiles = [];
  for (const z of zooms) {
    const x1 = lonToTileX(b.west, z), x2 = lonToTileX(b.east, z);
    const y1 = latToTileY(b.north, z), y2 = latToTileY(b.south, z);
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) tiles.push({ z, x, y });
  }
  return tiles;
}

/* ── Sonnenauf-/-untergang (nach SunCalc, V. Agafonkin, BSD) ── */
const dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009;
const obliquity = rad(23.4397);
const toDays = date => date.valueOf() / dayMs - 0.5 + J1970 - J2000;
const fromJulian = j => new Date((j + 0.5 - J1970) * dayMs);
const solarMeanAnomaly = d => rad(357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
  const C = rad(1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + rad(102.9372) + Math.PI;
}

/*
  Liefert { sunrise, sunset } als Date, oder { polarDay: true } (Mitternachtssonne)
  bzw. { polarNight: true } für den Tag von `date`.
*/
export function sunTimes(date, lat, lon) {
  const noonLocal = new Date(date);
  noonLocal.setHours(12, 0, 0, 0);
  const lw = rad(-lon), phi = rad(lat);
  const d = toDays(noonLocal);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(L));
  const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const h0 = rad(-0.833);
  const cosW = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW < -1) return { polarDay: true };
  if (cosW > 1) return { polarNight: true };
  const w = Math.acos(cosW);
  const a = J0 + (w + lw) / (2 * Math.PI) + n;
  const Jset = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
}
