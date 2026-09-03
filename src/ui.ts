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

// Guards against a slow screen painting after the user has already navigated on.
let renderSeq = 0;

async function renderRoute() {
  const path = location.hash.slice(1) || "/";
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const seq = ++renderSeq;
      // Build the new screen off-document, then swap it in as one operation.
      // Clearing the mount first (as this used to) blanked the app for however
      // long the handler's database queries took, which is what made moving to
      // the next screen feel like a stall rather than a transition.
      const staging = h("div", { class: "route-stage" });
      await r.handler(params, staging);
      if (seq !== renderSeq) return; // a newer navigation won — discard this one
      mountEl.replaceChildren(...Array.from(staging.childNodes));
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

/** Magnifier that opens the app-wide search. Sits beside the theme toggle. */
export function searchButton(): HTMLButtonElement {
  const btn = h("button", {
    class: "themebtn searchbtn",
    title: "Search everything",
    "aria-label": "Search everything",
    onClick: () => navigate("/search"),
  }, "🔍");
  return btn;
}

export function topbar(title: string, sub?: string, back?: string): HTMLElement {
  return h(
    "div",
    { class: "topbar" },
    back ? h("button", { class: "back", onClick: () => navigate(back) }, "‹") : null,
    h("h1", {}, title, sub ? h("div", { class: "sub" }, sub) : null),
    searchButton(),
    themeToggle()
  );
}

export function screen(...nodes: (Node | null)[]): HTMLElement {
  return h("div", { class: "screen" }, ...(nodes.filter(Boolean) as Node[]));
}

/**
 * Pull-to-refresh for screens with no periodhead calendar of their own (e.g.
 * Settings). Pulling down while already at the top of the page shows a small
 * spinner that tracks the pull, then runs `onRefresh` once the user releases
 * past the threshold — so there's a visible sign the screen actually redrew,
 * not just a silent re-render.
 */
export function pullToRefresh(view: HTMLElement, onRefresh: () => void | Promise<void>): () => void {
  const TRIGGER = 62;
  const indicator = h("div", { class: "ptr-indicator" }, h("span", { class: "ptr-spinner" }));
  view.prepend(indicator);

  let sy = 0, tracking = false, atTop = false, refreshing = false;

  const setPull = (dy: number) => {
    const clamped = Math.min(dy, TRIGGER * 1.6);
    indicator.style.height = `${clamped}px`;
    indicator.classList.toggle("ptr-ready", clamped >= TRIGGER);
  };

  const reset = () => {
    indicator.style.height = "0px";
    indicator.classList.remove("ptr-ready");
  };

  const onStart = (y: number, t: EventTarget | null) => {
    if ((t as HTMLElement | null)?.closest?.("input, select, textarea, button, .seg")) { tracking = false; return; }
    if (refreshing) { tracking = false; return; }
    sy = y; tracking = true; atTop = window.scrollY <= 2;
  };

  const onMove = (y: number) => {
    if (!tracking || !atTop) return;
    const dy = y - sy;
    if (dy > 0) setPull(dy);
  };

  const onEnd = async (y: number) => {
    if (!tracking) return;
    tracking = false;
    const dy = y - sy;
    if (atTop && dy >= TRIGGER) {
      refreshing = true;
      indicator.classList.add("ptr-spin");
      await onRefresh();
      refreshing = false;
      indicator.classList.remove("ptr-spin");
    }
    reset();
  };

  view.addEventListener("touchstart", (e) => { const t = e.touches[0]; onStart(t.clientY, e.target); }, { passive: true });
  view.addEventListener("touchmove", (e) => { const t = e.touches[0]; onMove(t.clientY); }, { passive: true });
  view.addEventListener("touchend", (e) => { const t = e.changedTouches[0]; void onEnd(t.clientY); }, { passive: true });
  view.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") onStart(e.clientY, e.target); });
  view.addEventListener("pointermove", (e) => { if (e.pointerType !== "touch") onMove(e.clientY); });
  view.addEventListener("pointerup", (e) => { if (e.pointerType !== "touch") void onEnd(e.clientY); });

  return () => indicator.remove();
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

// ---- themed confirm dialog (replaces window.confirm) ----
// Resolves true only if the user taps the confirm button. `danger` paints that
// button red for destructive actions.
export function confirmDialog(opts: {
  title: string;
  body?: string | Node;
  confirm?: string;
  cancel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      back.classList.remove("show");
      setTimeout(() => back.remove(), 220);
      resolve(ok);
    };
    const okBtn = h("button", { class: `btn${opts.danger ? " danger" : ""}`, type: "button",
      onClick: () => finish(true) }, opts.confirm ?? "Confirm");
    const noBtn = h("button", { class: "btn secondary", type: "button",
      onClick: () => finish(false) }, opts.cancel ?? "Cancel");
    const card = h("div", { class: "confirm-card", onClick: (e: Event) => e.stopPropagation() },
      h("div", { class: "cf-title" }, opts.title),
      opts.body ? h("div", { class: "cf-body" }, opts.body as any) : null,
      h("div", { class: "cf-actions" }, noBtn, okBtn));
    const back = h("div", { class: "confirm-back", onClick: () => finish(false) }, card);
    document.body.append(back);
    requestAnimationFrame(() => back.classList.add("show"));
  });
}

// ---- password gate ----
// Guards a destructive action behind a fixed code. Resolves true only when the
// entered code matches. Used so a stray tap can never wipe the records.
export function passwordPrompt(opts: {
  title: string;
  body?: string;
  code: string;
  confirm?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      back.classList.remove("show");
      setTimeout(() => back.remove(), 220);
      resolve(ok);
    };
    const err = h("div", { class: "cf-err" }, "");
    const input = h("input", {
      type: "password", inputmode: "numeric", class: "cf-pass",
      placeholder: opts.code, "aria-label": "Password", autocomplete: "off",
    }) as HTMLInputElement;
    const attempt = () => {
      if (input.value === opts.code) return finish(true);
      err.textContent = "Wrong password.";
      input.value = "";
      input.focus();
      if (hapticsEnabled()) { try { navigator.vibrate?.([30, 60, 30]); } catch { /* ignore */ } }
    };
    input.addEventListener("input", () => { err.textContent = ""; });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") attempt(); });
    const okBtn = h("button", { class: "btn danger", type: "button", onClick: attempt },
      opts.confirm ?? "Confirm");
    const noBtn = h("button", { class: "btn secondary", type: "button",
      onClick: () => finish(false) }, "Cancel");
    const card = h("div", { class: "confirm-card", onClick: (e: Event) => e.stopPropagation() },
      h("div", { class: "cf-title" }, opts.title),
      opts.body ? h("div", { class: "cf-body" }, opts.body) : null,
      input, err,
      h("div", { class: "cf-actions" }, noBtn, okBtn));
    const back = h("div", { class: "confirm-back", onClick: () => finish(false) }, card);
    document.body.append(back);
    requestAnimationFrame(() => { back.classList.add("show"); input.focus(); });
  });
}

// ---- iOS-style wheel picker (centered themed modal) ----
// One or more scrollable columns with a fixed center highlight; the selected
// item sits big in the middle while neighbours fade/shrink into an arc. Snap
// scrolling picks the value. `columns` each have their own options + label
// that stays fixed (e.g. "Day", "2026"). Resolves once the user taps Done.
export interface WheelColumn {
  label?: string; // fixed label shown beside the wheel (e.g. year, unit)
  options: { value: string; text: string }[];
  value: string;
}

const WHEEL_ITEM = 40; // px per row — must match .wheel-item height in CSS
const WHEEL_PAD = 80;  // must match .wheel-pad height (2 rows) in CSS

export function wheelPicker(opts: {
  title?: string;
  columns: WheelColumn[];
  onDone: (values: string[]) => void;
}): void {
  const ITEM = WHEEL_ITEM;
  const cols = opts.columns.map((col) => {
    const list = h("div", { class: "wheel-list" });
    let idx = Math.max(0, col.options.findIndex((o) => o.value === col.value));
    if (idx < 0) idx = 0;
    const items = col.options.map((o, i) =>
      h("div", { class: "wheel-item", "data-i": String(i) }, o.text));
    // Top/bottom spacers so the first/last item can reach the center line.
    list.append(h("div", { class: "wheel-pad" }), ...items, h("div", { class: "wheel-pad" }));

    const scroller = h("div", { class: "wheel-scroll" }, list);

    const paint = () => {
      const center = scroller.scrollTop + scroller.clientHeight / 2;
      items.forEach((el, i) => {
        const mid = ITEM * (i + 0.5) + WHEEL_PAD;
        const dist = Math.abs(center - mid) / ITEM; // rows away from center
        const sel = dist < 0.5;
        el.classList.toggle("sel", sel);
        // Arc feel: shrink + fade + tilt back as items move off center.
        const scale = Math.max(0.62, 1 - dist * 0.16);
        const op = Math.max(0.22, 1 - dist * 0.34);
        const rot = Math.max(-58, Math.min(58, (mid - center) / ITEM * 22));
        el.style.transform = `rotateX(${rot}deg) scale(${scale})`;
        el.style.opacity = String(op);
      });
    };
    const selectedIndex = () =>
      Math.max(0, Math.min(col.options.length - 1, Math.round(scroller.scrollTop / ITEM)));

    let raf = 0;
    scroller.addEventListener("scroll", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; paint(); });
    }, { passive: true });

    const wheel = h("div", { class: "wheel" },
      scroller,
      col.label ? h("div", { class: "wheel-fixed" }, col.label) : null);

    return { wheel, scroller, selectedIndex, initIdx: idx, options: col.options, paint };
  });

  const body = h("div", { class: "wheel-cols" }, ...cols.map((c) => c.wheel));
  const done = h("button", { class: "btn", type: "button" });
  done.textContent = "Done";
  const cancel = h("button", { class: "btn secondary", type: "button" }, "Cancel");
  const sheet = h("div", { class: "wheel-sheet" },
    opts.title ? h("div", { class: "wheel-title" }, opts.title) : null,
    h("div", { class: "wheel-window" }, body, h("div", { class: "wheel-line" })),
    h("div", { class: "wheel-actions" }, cancel, done));
  const back = h("div", { class: "wheel-back" }, sheet);

  const close = () => {
    back.classList.remove("show");
    setTimeout(() => back.remove(), 220);
  };
  cancel.addEventListener("click", close);
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  done.addEventListener("click", () => {
    const values = cols.map((c) => c.options[c.selectedIndex()].value);
    close();
    opts.onDone(values);
  });

  document.body.append(back);
  requestAnimationFrame(() => {
    back.classList.add("show");
    // Position each wheel at its initial value, then paint the arc.
    cols.forEach((c) => { c.scroller.scrollTop = c.initIdx * ITEM; c.paint(); });
  });
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

// ---- reading field validation spec ----
// Describes how one numeric reading should be entered and checked: a valid
// range, how many decimals, and (optionally) when the input is "settled" enough
// to auto-advance to the next field. `warn` gives an out-of-range message.
export interface ReadingSpec {
  min: number;
  max: number;
  decimals?: number; // digits allowed after the point (0 = integer)
  intDigits?: number; // whole-number digits that mark a "full" entry for auto-advance
  warn?: string; // shown (red) when the value is out of range
  // When true, an out-of-range value isn't rejected outright: the field warns
  // but offers a "Use anyway" chip so the user can confirm and keep the reading
  // (e.g. shaft potential > 50 mV that the user has verified).
  allowOverride?: boolean;
}

export function inRange(v: number | null, spec: ReadingSpec): boolean {
  return v == null || (v >= spec.min && v <= spec.max);
}

// numeric input helper
export function numInput(opts: {
  value?: number | null;
  placeholder?: string;
  onInput: (v: number | null) => void;
  step?: string;
  decimal?: boolean;
  readonly?: boolean;
  spec?: ReadingSpec;
  // Called when the user taps "Use anyway" on an out-of-range value (spec.allowOverride).
  onOverride?: (v: number) => void;
}): HTMLInputElement {
  const spec = opts.spec;
  // The value the user has explicitly confirmed via "Use anyway", so we don't
  // keep flagging it red. Reset whenever the raw text changes to something else.
  let overridden: number | null = null;
  const inp = h("input", {
    type: "text",
    inputmode: opts.decimal === false ? "numeric" : "decimal",
    value: opts.value ?? "",
    placeholder: opts.placeholder ?? "",
    readonly: opts.readonly || undefined,
    class: opts.readonly ? "locked" : undefined,
    onInput: (e: Event) => {
      const el = e.target as HTMLInputElement;
      let raw = el.value.trim();
      // Clamp to the allowed number of decimal places while typing so a decimal
      // field like draft only ever holds one digit after the point.
      if (spec && (spec.decimals ?? 0) >= 0) {
        const capped = capDecimals(raw, spec.decimals ?? 0);
        if (capped !== raw) { raw = capped; el.value = capped; }
      }
      if (raw === "") { overridden = null; setInvalid(inp, false); return opts.onInput(null); }
      const n = Number(raw);
      const val = Number.isNaN(n) ? null : n;
      if (spec) {
        const outOfRange = val != null && !inRange(val, spec);
        // A confirmed value stays accepted; any other out-of-range value is bad.
        if (val !== overridden) overridden = null;
        const bad = outOfRange && val !== overridden;
        // For override-capable fields, offer a "Use anyway" chip instead of a
        // plain red block: confirming keeps the value and advances like a valid one.
        const onUseAnyway = (bad && spec.allowOverride && val != null)
          ? () => {
              overridden = val;
              setInvalid(inp, false);
              opts.onOverride?.(val);
            }
          : undefined;
        setInvalid(inp, bad, spec.warn, onUseAnyway);
        opts.onInput(val);
        return;
      }
      opts.onInput(val);
    },
  });
  return inp;
}

// ---- "Done" bar: the user confirms an entry is finished ----
//
// Entry screens used to decide for themselves that the user had finished — the
// moment the last field looked full, focus jumped away, the keyboard dropped and
// a tick appeared. On a two-digit reading that fired after the first digit, so
// the value could not even be typed. Nothing auto-completes now: when every
// reading is present the app *offers* a Done button, and only the user's tap on
// it marks the entry complete.
//
// The delay before it appears is deliberate. Popping up the instant the last
// digit lands would cover the keyboard while the user is still typing (or about
// to correct a typo), so the bar waits ~1s of no further edits.
const DONE_DELAY = 1000;

export interface DoneBar {
  el: HTMLElement;
  /** All readings present — offer the button (after the delay). */
  arm(): void;
  /** Something is missing again — take the offer away immediately. */
  disarm(): void;
  /** Hide it and cancel anything pending (e.g. once the entry is confirmed). */
  reset(): void;
}

export function doneBar(opts: { label?: string; onDone: () => void }): DoneBar {
  let timer: any;
  let shown = false;

  const btn = h("button", { class: "donebar-btn", type: "button" },
    h("span", { class: "db-check" }, "✓"), opts.label ?? "Done");
  const el = h("div", { class: "donebar" }, btn);

  const show = () => {
    if (shown) return;
    shown = true;
    el.classList.add("show");
  };
  const hide = () => {
    clearTimeout(timer);
    if (!shown) return;
    shown = false;
    el.classList.remove("show");
  };

  btn.addEventListener("click", () => {
    // Drop the keyboard on the way out so the celebration lands on a settled
    // screen rather than over a half-covered form.
    (document.activeElement as HTMLElement | null)?.blur?.();
    hide();
    opts.onDone();
  });

  return {
    el,
    arm() {
      if (shown) return;
      clearTimeout(timer);
      timer = setTimeout(show, DONE_DELAY);
    },
    disarm: hide,
    reset: hide,
  };
}

// A field bundle: a validated input plus an inline warning line beneath it that
// shows *why* the value is red — right where the user is looking, not as a toast.
export function readingField(label: string, opts: Parameters<typeof numInput>[0] & { big?: boolean }): {
  wrap: HTMLElement;
  input: HTMLInputElement;
} {
  const input = numInput(opts);
  const warnEl = h("div", { class: "field-warn" }, "");
  const wrap = h("label", { class: `field${opts.big ? " big" : ""}` },
    h("span", { class: "lab" }, label), input, warnEl);
  return { wrap, input };
}

// Trim `raw` so it has at most `decimals` digits after the point.
function capDecimals(raw: string, decimals: number): string {
  const i = raw.indexOf(".");
  if (i < 0) return raw;
  if (decimals === 0) return raw.slice(0, i); // no decimals allowed
  return raw.slice(0, i + 1 + decimals);
}

// Toggle the red "invalid reading" state on a field and show the reason inline
// (a small line right under the input), not as a floating toast. When
// `onUseAnyway` is given, a "Use anyway" chip is shown beside the warning so the
// user can confirm and keep an out-of-range value.
function setInvalid(inp: HTMLInputElement, bad: boolean, warn?: string, onUseAnyway?: () => void) {
  inp.classList.toggle("invalid", bad);
  const wrap = inp.closest(".field, .cell") as HTMLElement | null;
  wrap?.classList.toggle("invalid", bad);
  const warnEl = wrap?.querySelector<HTMLElement>(".field-warn");
  if (!warnEl) return;
  warnEl.replaceChildren();
  if (!bad) return;
  warnEl.append(document.createTextNode(warn ?? "Check this reading."));
  if (onUseAnyway) {
    const chip = h("button", { type: "button", class: "use-anyway" }, "Use anyway");
    chip.addEventListener("click", (e) => { e.preventDefault(); onUseAnyway(); });
    warnEl.append(chip);
  }
}
