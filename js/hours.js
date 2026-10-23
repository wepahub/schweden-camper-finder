/*
  Öffnungszeiten (OSM opening_hours) – kompakter Parser für die häufigen Fälle:
  24/7, Wochentage (Listen, Bereiche, auch über das Wochenende), Monate
  (z. B. saisonale Campingplätze "May-Sep"), mehrere Zeitspannen, Zeiten über
  Mitternacht, "off"/"closed", offene Enden ("10:00+") und PH/SH (ignoriert).
  Alles andere (sunrise, Kommentare, Kalenderwochen …) → null = unbekannt.
*/

const DAYS = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 0 };
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function tokenize(input) {
  const tokens = [];
  const re = /\s*(24\/7|\d{1,2}:\d{2}|\|\||[A-Za-z]+|[-,:;+])/y;
  let pos = 0;
  const str = input.trim();
  while (pos < str.length) {
    re.lastIndex = pos;
    const m = re.exec(str);
    if (!m) return null;
    pos = re.lastIndex;
    const raw = m[1], low = raw.toLowerCase();
    if (raw === "24/7") tokens.push({ t: "always" });
    else if (/^\d/.test(raw)) {
      const [h, mi] = raw.split(":").map(Number);
      if (h > 48 || mi > 59) return null;
      tokens.push({ t: "time", v: h * 60 + mi });
    } else if (low in DAYS) tokens.push({ t: "day", v: DAYS[low] });
    else if (low in MONTHS) tokens.push({ t: "month", v: MONTHS[low] });
    else if (low === "ph" || low === "sh") tokens.push({ t: "holiday" });
    else if (low === "off" || low === "closed") tokens.push({ t: "off" });
    else if (low === "open") tokens.push({ t: "open" });
    else if ("-,:;+".includes(raw) || raw === "||") tokens.push({ t: raw });
    else return null; // sunrise, week, easter, Kommentare …
  }
  return tokens;
}

function rangeSet(from, to, size) {
  const set = new Set();
  for (let i = from; ; i = (i + 1) % size) { set.add(i); if (i === to) break; }
  return set;
}

function parseRules(tokens) {
  const rules = [];
  let i = 0;
  const peek = (o = 0) => tokens[i + o];
  const isSelectorStart = tok => tok && (tok.t === "day" || tok.t === "month" || tok.t === "holiday");

  function parseList(type, size) {
    const set = new Set();
    let holidays = 0, items = 0;
    for (;;) {
      const tok = peek();
      if (!tok) break;
      if (type === "day" && tok.t === "holiday") { i++; holidays++; items++; }
      else if (tok.t === type) {
        i++; items++;
        if (peek()?.t === "-" && peek(1)?.t === type) {
          const to = peek(1).v; i += 2;
          rangeSet(tok.v, to, size).forEach(v => set.add(v));
        } else set.add(tok.v);
      } else return null;
      if (peek()?.t === "," && (peek(1)?.t === type || (type === "day" && peek(1)?.t === "holiday"))) { i++; continue; }
      break;
    }
    if (peek()?.t === ":") i++;
    return { set, holidaysOnly: holidays > 0 && holidays === items };
  }

  function parseRule(additional) {
    const rule = { months: null, days: null, spans: null, off: false, additional, skip: false };
    if (peek()?.t === "month") {
      const r = parseList("month", 12);
      if (!r) return null;
      rule.months = r.set;
    }
    if (peek()?.t === "day" || peek()?.t === "holiday") {
      const r = parseList("day", 7);
      if (!r) return null;
      if (r.holidaysOnly) rule.skip = true;
      rule.days = r.set;
    }
    const tok = peek();
    if (tok?.t === "always" || tok?.t === "open") { i++; rule.spans = [{ from: 0, to: 1440 }]; }
    else if (tok?.t === "off") { i++; rule.off = true; rule.spans = []; }
    else if (tok?.t === "time") {
      rule.spans = [];
      for (;;) {
        const a = peek();
        if (a?.t !== "time") return null;
        i++;
        if (peek()?.t === "-" && peek(1)?.t === "time") {
          let to = peek(1).v; i += 2;
          if (to <= a.v) to += 1440; // über Mitternacht
          if (peek()?.t === "+") { i++; rule.openEnd = true; }
          rule.spans.push({ from: a.v, to });
        } else if (peek()?.t === "+") {
          i++; rule.openEnd = true;
          rule.spans.push({ from: a.v, to: 1440 });
        } else return null;
        if (peek()?.t === "," && peek(1)?.t === "time") { i++; continue; }
        break;
      }
    } else if (!tok || tok.t === ";" || tok.t === "||" || tok.t === ",") {
      if (!rule.days && !rule.months) return null;
      rule.spans = [{ from: 0, to: 1440 }];
    } else return null;
    return rule;
  }

  while (i < tokens.length) {
    let rule = parseRule(false);
    if (!rule) return null;
    rules.push(rule);
    while (peek()?.t === "," && isSelectorStart(peek(1))) {
      i++;
      rule = parseRule(true);
      if (!rule) return null;
      rules.push(rule);
    }
    const tok = peek();
    if (!tok) break;
    if (tok.t === "||") break; // Fallback-Regeln ignorieren
    if (tok.t !== ";") return null;
    i++;
  }
  return rules.length ? rules : null;
}

const cache = new Map();
export function parseOpeningHours(value) {
  if (!value || typeof value !== "string") return null;
  if (cache.has(value)) return cache.get(value);
  const tokens = tokenize(value);
  const rules = tokens && tokens.length ? parseRules(tokens) : null;
  if (cache.size > 500) cache.clear();
  cache.set(value, rules);
  return rules;
}

function spansForDay(rules, date) {
  let spans = null;
  const day = date.getDay(), month = date.getMonth();
  for (const r of rules) {
    if (r.skip) continue;
    if (r.months && !r.months.has(month)) continue;
    if (r.days && !r.days.has(day)) continue;
    if (r.additional && spans) spans = spans.concat(r.spans);
    else spans = r.spans.slice();
  }
  return spans || [];
}

/*
  Liefert null (unbekannt) oder
  { open, alwaysOpen?, closesAt?, opensAt?, opensTomorrow?, uncertain? }
  Zeiten in Minuten ab Mitternacht.
*/
export function openingStatus(value, now = new Date()) {
  const rules = parseOpeningHours(value);
  if (!rules) return null;
  const uncertain = rules.some(r => r.openEnd);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);

  const today = spansForDay(rules, now);
  const prev = spansForDay(rules, yesterday);

  const alwaysOpen = rules.every(r => r.skip || (!r.months && !r.days && r.spans.length === 1 && r.spans[0].from === 0 && r.spans[0].to >= 1440 && !r.off));
  if (alwaysOpen && rules.some(r => !r.skip)) return { open: true, alwaysOpen: true };

  for (const s of prev) {
    if (s.to > 1440 && minutes < s.to - 1440) return { open: true, closesAt: s.to - 1440, uncertain };
  }
  for (const s of today) {
    if (minutes >= s.from && minutes < s.to) {
      if (s.from === 0 && s.to >= 1440) return { open: true, closesAt: null, uncertain };
      return { open: true, closesAt: s.to % 1440, uncertain };
    }
  }
  const later = today.filter(s => s.from > minutes).sort((a, b) => a.from - b.from)[0];
  if (later) return { open: false, opensAt: later.from, uncertain };
  const next = spansForDay(rules, tomorrow).sort((a, b) => a.from - b.from)[0];
  if (next) return { open: false, opensAt: next.from, opensTomorrow: true, uncertain };
  return { open: false, uncertain };
}

export function formatMinutes(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
