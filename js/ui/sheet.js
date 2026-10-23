/* ── Bottom Sheet (Handy): zum Hochziehen, drei Stufen ── */

import { isDesktop } from "./dom.js";

const STATES = ["peek", "half", "full"];

export function initSheet(sheet, grip, { onChange } = {}) {
  let state = "peek";
  let drag = null;
  let suppressClickUntil = 0;

  const container = () => sheet.parentElement.clientHeight;
  const peekPx = () => parseFloat(getComputedStyle(sheet).getPropertyValue("--peek")) || 150;
  const heightFor = s => {
    const H = container();
    if (s === "full") return H - 8;
    if (s === "half") return Math.max(peekPx(), Math.round(H * 0.56));
    return peekPx();
  };

  function apply(animate = true) {
    if (isDesktop()) { sheet.style.height = ""; sheet.dataset.state = "desktop"; return; }
    sheet.classList.toggle("no-anim", !animate);
    sheet.style.height = `${heightFor(state)}px`;
    sheet.dataset.state = state;
  }

  function set(next, animate = true) {
    if (!STATES.includes(next)) return;
    const changed = next !== state;
    state = next;
    apply(animate);
    if (changed) onChange?.(state);
  }

  grip.addEventListener("pointerdown", e => {
    if (isDesktop() || e.button > 0) return;
    drag = { y: e.clientY, h: sheet.getBoundingClientRect().height, t: performance.now(), moved: false };
    sheet.classList.add("no-anim");
  });

  window.addEventListener("pointermove", e => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 6) return;
    if (!drag.moved) grip.setPointerCapture?.(e.pointerId);
    drag.moved = true;
    const hgt = Math.min(container() - 8, Math.max(peekPx() - 40, drag.h - dy));
    sheet.style.height = `${hgt}px`;
  });

  const end = e => {
    if (!drag) return;
    const d = drag;
    drag = null;
    sheet.classList.remove("no-anim");
    if (!d.moved) return; // normaler Klick (z. B. auf einen Tab)
    const dy = e.clientY - d.y;
    const velocity = dy / Math.max(1, performance.now() - d.t); // px/ms, positiv = nach unten
    const current = sheet.getBoundingClientRect().height;
    let next;
    if (velocity > 0.6) next = state === "full" ? "half" : "peek";
    else if (velocity < -0.6) next = state === "peek" ? "half" : "full";
    else next = STATES.reduce((best, s) => Math.abs(heightFor(s) - current) < Math.abs(heightFor(best) - current) ? s : best, "peek");
    suppressClickUntil = performance.now() + 350; // Ziehen soll keinen Tab-Klick auslösen
    set(next);
    apply();
  };
  grip.addEventListener("click", ev => {
    if (performance.now() < suppressClickUntil) { ev.stopPropagation(); ev.preventDefault(); }
  }, { capture: true });
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);

  grip.addEventListener("keydown", e => {
    if (e.target !== grip.querySelector(".sheet-handle")) return;
    if (e.key === "ArrowUp") { e.preventDefault(); set(STATES[Math.min(2, STATES.indexOf(state) + 1)]); }
    if (e.key === "ArrowDown") { e.preventDefault(); set(STATES[Math.max(0, STATES.indexOf(state) - 1)]); }
  });
  grip.querySelector(".sheet-handle")?.addEventListener("click", () => {
    set(state === "peek" ? "half" : state === "half" ? "full" : "peek");
  });

  window.addEventListener("resize", () => apply(false));
  apply(false);

  return {
    set,
    get: () => state,
    // Wie viele Pixel der Karte vom Sheet verdeckt werden (für Marker-Fokus)
    coveredPx: () => (isDesktop() ? 0 : Math.max(0, sheet.getBoundingClientRect().height - peekPx()))
  };
}
