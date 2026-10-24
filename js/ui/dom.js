/* ── Kleine DOM-Helfer ── */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/*
  h("button", { class: "x", onclick: fn, "aria-label": "…" }, "Text", child)
  Text wird immer als Textknoten eingefügt (kein innerHTML → kein XSS).
*/
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

let toastTimer;
export function toast(message, { action, duration = 4500 } = {}) {
  const box = $("#toast");
  clear(box);
  box.append(h("span", {}, message));
  if (action) {
    box.append(h("button", { type: "button", onclick: () => { hide(); action.onClick(); } }, action.label));
  }
  box.classList.add("show");
  clearTimeout(toastTimer);
  const hide = () => box.classList.remove("show");
  if (duration) toastTimer = setTimeout(hide, duration);
}

export function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept) {
  return new Promise(resolve => {
    const input = h("input", { type: "file", accept });
    input.addEventListener("change", () => resolve(input.files?.[0] || null), { once: true });
    input.click();
  });
}

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const isDesktop = () => window.matchMedia("(min-width: 900px)").matches;
