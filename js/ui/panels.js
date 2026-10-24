/* ── Wetter & Sonne, Jedermannsrecht, Tab „Mehr“ ── */

import { APP_VERSION } from "../config.js";
import { t, getLanguage, LANGUAGES } from "../i18n.js";
import { sunTimes, formatDuration } from "../geo.js";
import { weather, weatherIcon, mosquitoRisk } from "../services.js";
import { listAreas, saveArea, deleteArea, clearCaches } from "../offline.js";
import { h, clear, toast } from "./dom.js";

const timeFmt = d => d.toLocaleTimeString(getLanguage(), { hour: "2-digit", minute: "2-digit" });

/* ── Wetter ── */
const wx = { place: null, label: "", data: null, sun: null, ctrl: null };

export async function refreshWeather(place, label) {
  wx.place = place; wx.label = label;
  wx.sun = sunTimes(new Date(), place.lat, place.lon);
  wx.data = null;
  renderPill();
  if (!navigator.onLine) return;
  wx.ctrl?.abort();
  wx.ctrl = new AbortController();
  try {
    wx.data = await weather(place.lat, place.lon, { signal: wx.ctrl.signal });
    renderPill();
  } catch { /* Wetter ist optional */ }
}

function sunShort(sun) {
  if (sun.polarDay) return "🌞 24 h";
  if (sun.polarNight) return "🌑";
  return `🌅 ${timeFmt(sun.sunset)}`;
}

function renderPill() {
  const pill = document.getElementById("weatherPill");
  if (!wx.sun) { pill.classList.add("hidden"); return; }
  const parts = [];
  if (wx.data?.current?.temp != null) {
    parts.push(`${weatherIcon(wx.data.current.code).icon} ${Math.round(wx.data.current.temp)}°`);
  }
  parts.push(sunShort(wx.sun));
  if (wx.data && mosquitoRisk(wx.data.current)) parts.push("🦟");
  pill.textContent = parts.join(" · ");
  pill.setAttribute("aria-label", t("weather.title"));
  pill.classList.remove("hidden");
}

export function sunsetHint(place) {
  const sun = sunTimes(new Date(), place.lat, place.lon);
  if (sun.polarDay) return t("weather.polarDay");
  if (!sun.sunset) return "";
  const diff = (sun.sunset - Date.now()) / 1000;
  return diff > 0 ? t("weather.sunsetIn", { t: timeFmt(sun.sunset), d: formatDuration(diff) }) : "";
}

export function openWeatherDialog() {
  const box = clear(document.getElementById("weatherContent"));
  const sun = wx.sun;
  box.append(h("p", { class: "muted" }, t("weather.forPlace", { place: wx.label })));
  const cur = wx.data?.current;
  if (cur) {
    const wi = weatherIcon(cur.code);
    box.append(h("div", { class: "wx-now" },
      h("span", { class: "wx-icon", "aria-hidden": "true" }, wi.icon),
      h("div", {},
        h("strong", {}, `${Math.round(cur.temp)} °C · ${t(`weather.code.${wi.key}`)}`),
        h("span", {}, t("weather.wind", { v: cur.wind?.toLocaleString(getLanguage(), { maximumFractionDigits: 1 }) })))));
    if (mosquitoRisk(cur)) box.append(h("p", { class: "warning" }, `🦟 ${t("weather.mosquito")}`));
  } else {
    box.append(h("p", { class: "muted" }, t("weather.offline")));
  }
  if (sun) {
    if (sun.polarDay) box.append(h("p", {}, `🌞 ${t("weather.polarDay")}`));
    else if (sun.polarNight) box.append(h("p", {}, `🌑 ${t("weather.polarNight")}`));
    else box.append(h("dl", { class: "detail-rows" },
      h("dt", {}, `🌄 ${t("weather.sunrise")}`), h("dd", {}, timeFmt(sun.sunrise)),
      h("dt", {}, `🌅 ${t("weather.sunset")}`), h("dd", {}, timeFmt(sun.sunset))));
  }
  if (wx.data?.daily?.length) {
    box.append(h("div", { class: "wx-days" }, wx.data.daily.map((d, i) => {
      const wi = weatherIcon(d.code);
      const label = i === 0 ? t("weather.today") : i === 1 ? t("weather.tomorrow")
        : new Date(`${d.date}T12:00`).toLocaleDateString(getLanguage(), { weekday: "long" });
      return h("div", { class: "wx-day" },
        h("strong", {}, label),
        h("span", { class: "wx-icon", title: t(`weather.code.${wi.key}`) }, wi.icon),
        h("span", {}, `${Math.round(d.max)}° / ${Math.round(d.min)}°`),
        d.pop != null ? h("span", { class: "muted" }, t("weather.rain", { v: d.pop })) : null);
    })));
  }
  box.append(h("p", { class: "muted small" }, "Open-Meteo.com"));
  document.getElementById("weatherDialog").showModal();
}

/* ── Jedermannsrecht ── */
export function openAllemansDialog() {
  const box = clear(document.getElementById("infoContent"));
  box.append(
    h("h2", {}, `⚖️ ${t("allemans.title")}`),
    h("p", {}, t("allemans.intro")),
    ...[["⛺", "tent"], ["🚐", "vehicle"], ["🚗", "offroad"], ["🔥", "fire"], ["🪣", "waste"], ["🌲", "nature"]].map(([icon, k]) =>
      h("section", { class: "info-item" },
        h("h3", {}, `${icon} ${t(`allemans.${k}.t`)}`),
        h("p", {}, t(`allemans.${k}.d`)))),
    h("p", { class: "muted small" }, t("allemans.source"))
  );
  document.getElementById("infoDialog").showModal();
}

/* ── Tab „Mehr“ ── */
export function initMoreTab({ getCenter, getLabel, getLayer, onLanguage, onExport, onImport }) {
  const sel = document.getElementById("langSelect");
  clear(sel);
  Object.entries(LANGUAGES).forEach(([k, v]) => sel.append(h("option", { value: k, selected: k === getLanguage() }, v)));
  sel.addEventListener("change", () => onLanguage(sel.value));

  document.getElementById("versionText").textContent = t("more.version", { v: APP_VERSION });

  const saveBtn = document.getElementById("saveAreaBtn");
  const progress = document.getElementById("areaProgress");
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try {
      const meta = await saveArea({
        center: getCenter(), label: getLabel(), layer: getLayer(),
        onProgress: p => {
          progress.textContent = p.step === "data" ? t("more.savingData") : t("more.savingTiles", { done: p.done, total: p.total });
        }
      });
      toast(t("more.saved", { label: meta.label, n: meta.count }));
    } catch (err) {
      console.error(err);
      toast(t("more.saveFailed"));
    } finally {
      saveBtn.disabled = false;
      progress.textContent = "";
      renderAreas();
    }
  });

  document.getElementById("exportJsonBtn2").addEventListener("click", () => onExport("json"));
  document.getElementById("importBtn2").addEventListener("click", onImport);
  document.getElementById("clearCacheBtn").addEventListener("click", async () => {
    await clearCaches();
    toast(t("more.cacheCleared"));
  });
  document.getElementById("allemansBtn").addEventListener("click", openAllemansDialog);
  renderAreas();
}

function renderAreas() {
  const box = clear(document.getElementById("areaList"));
  const areas = listAreas();
  if (!areas.length) { box.append(h("p", { class: "empty small" }, t("more.noAreas"))); return; }
  areas.forEach(a => box.append(h("div", { class: "area-row" },
    h("div", {},
      h("strong", {}, a.label),
      h("span", { class: "muted small" }, t("more.areaMeta", {
        n: a.count, date: new Date(a.savedAt).toLocaleDateString(getLanguage())
      }))),
    h("button", { type: "button", class: "act danger", onclick: async () => { await deleteArea(a.id); renderAreas(); } },
      `🗑 ${t("more.delete")}`))));
}
