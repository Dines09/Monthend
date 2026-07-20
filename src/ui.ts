// Tiny DOM helpers + router + toast.
import { hapticsEnabled } from "./feedback";

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, any> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && k !== "list") (el as any)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement) {
  el.replaceChildren();
}

let toastTimer: any;
export function toast(msg: string, ms = 1800) {
  let t = document.querySelector<HTMLElement>(".toast");
  if (!t) {
    t = h("div", { class: "toast" });
    document.body.append(t);
  }
  t.textContent = msg;
  requestAnimationFrame(() => t!.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t!.classList.remove("show"), ms);
}

// ---- hash router ----
export type RouteHandler = (params: Record<string, string>, mount: HTMLElement) => void | Promise<void>;
const routes: { re: RegExp; keys: string[]; handler: RouteHandler }[] = [];

export function route(pattern: string, handler: RouteHandler) {
  const keys: string[] = [];
  const re = new RegExp(
    "^" +
      pattern.replace(/:[^/]+/g, (m) => {
        keys.push(m.slice(1));
        return "([^/]+)";
      }) +
      "$"
  );
  routes.push({ re, keys, handler });
}

export function navigate(path: string) {
  if (location.hash.slice(1) === path) renderRoute();
  else location.hash = path;
}

let mountEl: HTMLElement;
export function initRouter(mount: HTMLElement) {
  mountEl = mount;
  window.addEventListener("hashchange", renderRoute);
  renderRoute();
}

async function renderRoute() {
  const path = location.hash.slice(1) || "/";
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      clear(mountEl);
      await r.handler(params, mountEl);
      window.scrollTo(0, 0);
      updateNav(path);
      return;
    }
  }
  navigate("/");
}

function updateNav(path: string) {
  let activeBtn: HTMLElement | null = null;
  document.querySelectorAll<HTMLElement>(".bottomnav button").forEach((b) => {
    const target = b.dataset.route!;
    const active = target === "/" ? path === "/" : path.startsWith(target);
    b.classList.toggle("active", active);
    if (active) activeBtn = b;
  });
  moveNavPill(activeBtn);
}

// Slide the highlight pill under the active dock item.
function moveNavPill(btn: HTMLElement | null) {
  const pill = document.querySelector<HTMLElement>(".nav-pill");
  const dock = document.querySelector<HTMLElement>(".dock");
  if (!pill || !dock) return;
  if (!btn) { pill.style.opacity = "0"; return; }
  const place = () => {
    pill.style.opacity = "1";
    pill.style.width = `${btn.offsetWidth}px`;
    pill.style.height = `${btn.offsetHeight}px`;
    // Position exactly over the active button box (offsetLeft/Top are relative
    // to the dock, so the highlight sits evenly around the icon + label).
    pill.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
  };
  // Wait a frame if layout isn't measured yet (first paint).
  if (btn.offsetWidth) place();
  else requestAnimationFrame(place);
}

// ---- theme (light / dark) ----
const THEME_KEY = "monthend-theme";
export type Theme = "dark" | "light";

export function getTheme(): Theme {
  return (localStorage.getItem(THEME_KEY) as Theme) || "dark";
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(THEME_KEY, t);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = t === "light" ? "#0f5c8a" : "#0f3d5c";
}

export function initTheme() {
  applyTheme(getTheme());
}

export function themeToggle(): HTMLButtonElement {
  const btn = h("button", {
    class: "themebtn",
    title: "Toggle light / dark",
    "aria-label": "Toggle light or dark mode",
    onClick: () => {
      const next: Theme = getTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      btn.textContent = next === "dark" ? "☀️" : "🌙";
    },
  });
  btn.textContent = getTheme() === "dark" ? "☀️" : "🌙";
  return btn;
}

export function topbar(title: string, sub?: string, back?: string): HTMLElement {
  return h(
    "div",
    { class: "topbar" },
    back ? h("button", { class: "back", onClick: () => navigate(back) }, "‹") : null,
    h("h1", {}, title, sub ? h("div", { class: "sub" }, sub) : null),
    themeToggle()
  );
}

export function screen(...nodes: (Node | null)[]): HTMLElement {
  return h("div", { class: "screen" }, ...(nodes.filter(Boolean) as Node[]));
}

// ---- animated segmented control ----
// A pill-style selector whose highlight slides smoothly under the active
// option (no measuring: the thumb is exactly one segment wide and translates
// by whole-segment multiples via CSS custom props).
export function segmented(opts: {
  options: string[];
  value: string;
  onPick: (value: string, index: number) => void;
  labels?: string[];
  big?: boolean;
  compact?: boolean;
}): HTMLElement {
  const { options, value, onPick, labels, big, compact } = opts;
  let activeIdx = Math.max(0, options.indexOf(value));
  const thumb = h("div", { class: "seg-thumb" });
  const btns = options.map((o, i) =>
    h(
      "button",
      {
        type: "button",
        class: i === activeIdx ? "active" : "",
        onClick: () => {
          if (i === activeIdx) return;
          activeIdx = i;
          seg.style.setProperty("--i", String(i));
          btns.forEach((b, j) => b.classList.toggle("active", j === i));
          onPick(o, i);
        },
      },
      labels?.[i] ?? o
    )
  );
  const seg = h("div", { class: `seg${big ? " big" : ""}${compact ? " compact" : ""}` }, thumb, ...btns);
  seg.style.setProperty("--n", String(options.length));
  seg.style.setProperty("--i", String(activeIdx));
  return seg;
}

// ---- circular progress ring with a count in the middle ----
export function progressRing(done: number, total: number, label = "done"): HTMLElement {
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const complete = total > 0 && done >= total;
  const r = 20, c = 2 * Math.PI * r;
  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("class", "ring-svg");
  const track = document.createElementNS(svgNs, "circle");
  track.setAttribute("cx", "24"); track.setAttribute("cy", "24"); track.setAttribute("r", String(r));
  track.setAttribute("class", "ring-track");
  const arc = document.createElementNS(svgNs, "circle");
  arc.setAttribute("cx", "24"); arc.setAttribute("cy", "24"); arc.setAttribute("r", String(r));
  arc.setAttribute("class", "ring-arc");
  arc.setAttribute("stroke-dasharray", String(c));
  arc.setAttribute("stroke-dashoffset", String(c * (1 - pct)));
  svg.append(track, arc);
  return h(
    "div",
    { class: `ring ${complete ? "done" : ""}` },
    svg,
    h(
      "div",
      { class: "ring-txt" },
      complete ? h("span", { class: "ring-tick" }, "✓")
               : h("span", { class: "ring-num" }, String(Math.max(0, total - done))),
      h("span", { class: "ring-lab" }, complete ? "done" : label)
    )
  );
}

// ---- achievement overlay: center tick + partial dim, auto-dismiss ----
let achievementUp = false;
export function achievement(msg = "All entries complete!", sub = "") {
  if (achievementUp) return;
  achievementUp = true;
  if (hapticsEnabled()) { try { navigator.vibrate?.([12, 40, 18]); } catch { /* ignore */ } }
  const card = h(
    "div",
    { class: "ach-card" },
    h("div", { class: "ach-tick" }, h("span", {}, "✓")),
    h("div", { class: "ach-title" }, msg),
    sub ? h("div", { class: "ach-sub" }, sub) : null
  );
  const back = h("div", { class: "ach-back" }, card);
  const close = () => {
    back.classList.remove("show");
    setTimeout(() => { back.remove(); achievementUp = false; }, 280);
  };
  back.addEventListener("click", close);
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add("show"));
  setTimeout(close, 2600);
}

// ---- long-press gesture (cancels if the finger moves or scrolls) ----
export function longPress(el: HTMLElement, cb: () => void, ms = 500) {
  let timer: any, sx = 0, sy = 0;
  const cancel = () => clearTimeout(timer);
  el.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; timer = setTimeout(cb, ms); });
  el.addEventListener("pointermove", (e) => { if (Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("pointerleave", cancel);
}

// ---- small "?" help chip that reveals an inline explanation ----
export function helpTip(text: string): HTMLElement {
  const btn = h("button", { class: "helptip", type: "button", "aria-label": "Help" }, "?");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toast(text, 4200);
  });
  return btn;
}

// numeric input helper
export function numInput(opts: {
  value?: number | null;
  placeholder?: string;
  onInput: (v: number | null) => void;
  step?: string;
  decimal?: boolean;
  readonly?: boolean;
}): HTMLInputElement {
  const inp = h("input", {
    type: "text",
    inputmode: opts.decimal === false ? "numeric" : "decimal",
    value: opts.value ?? "",
    placeholder: opts.placeholder ?? "",
    readonly: opts.readonly || undefined,
    class: opts.readonly ? "locked" : undefined,
    onInput: (e: Event) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      if (raw === "") return opts.onInput(null);
      const n = Number(raw);
      opts.onInput(Number.isNaN(n) ? null : n);
    },
  });
  return inp;
}
