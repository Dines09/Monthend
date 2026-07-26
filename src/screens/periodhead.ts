// A single sticky "period header" shared by every dated record screen, so the
// month/date control looks and behaves the same everywhere (ICCP, Battery,
// Fire, …) instead of each screen inventing its own.
//
// Layout — one compact row, never a tall block:
//   [ July 2026 ▾ ] [ …screen's own control… ]   [ ring ]
// and underneath it an optional detail panel (a calendar, a session summary)
// that lives in a collapsible wrapper.
//
// Gesture contract (identical on every screen that uses it):
//   • scroll down / any drag  → panel collapses, header shrinks to one line
//   • already at the very top and the user keeps pulling DOWN → panel expands
//     (a short pull; a long, deliberate pull still reaches the browser's own
//     pull-to-refresh, so both gestures stay available)
//   • pull UP while at the top → panel collapses again
import { h, wheelPicker } from "../ui";
import { MONTHS_FULL, ymParts } from "../util";

export interface PeriodHead {
  /** The sticky element to put at the top of the screen. */
  el: HTMLElement;
  /** Slot for the screen's own inline control (day chip, Saturday chip, …). */
  slot: HTMLElement;
  /** Slot for the right-hand indicator (usually a progress ring). */
  right: HTMLElement;
  /** Contents of the collapsible detail panel. */
  panel: HTMLElement;
  /** Open or close the detail panel. */
  setOpen(open: boolean): void;
  toggle(): void;
  isOpen(): boolean;
  /** Re-read `ym` into the month chip's label. */
  syncMonth(ym: string): void;
}

export function periodHead(opts: {
  ym: string;
  /** Called when the user picks a different month. */
  onMonth: (ym: string) => void;
  /** Latest month the user may pick (defaults to the current calendar month). */
  maxYm?: string;
  /** Start with the panel open? Defaults to open. */
  open?: boolean;
}): PeriodHead {
  const monthLabel = h("span", { class: "ph-mlab" });
  const monthChip = h("button", { class: "ph-month", type: "button", onClick: openMonthWheel }, monthLabel);

  const slot = h("div", { class: "ph-slot" });
  const right = h("div", { class: "ph-right" });
  const panel = h("div", { class: "ph-panel" });

  const el = h("div", { class: "periodhead" },
    h("div", { class: "ph-row" }, monthChip, slot, right),
    h("div", { class: "ph-collapse" }, panel));

  let curYm = opts.ym;
  let open = opts.open !== false;

  function syncMonth(ym: string) {
    curYm = ym;
    const { month } = ymParts(ym);
    // Title case reads better in a chip than the SHOUTED export spelling.
    const name = MONTHS_FULL[month - 1];
    monthLabel.textContent = `${name[0]}${name.slice(1).toLowerCase()} ${ym.slice(0, 4)}`;
  }

  function openMonthWheel() {
    const maxYm = opts.maxYm ?? currentYm();
    const year = Number(curYm.slice(0, 4));
    const maxMonth = maxYm.slice(0, 4) === String(year) ? ymParts(maxYm).month : 12;
    const options = MONTHS_FULL.slice(0, maxMonth).map((name, i) => ({
      value: `${year}-${String(i + 1).padStart(2, "0")}`,
      text: `${name[0]}${name.slice(1).toLowerCase()}`,
    }));
    wheelPicker({
      columns: [{ label: String(year), options, value: curYm }],
      onDone: ([ym]) => { syncMonth(ym); opts.onMonth(ym); },
    });
  }

  function setOpen(next: boolean) {
    open = next;
    el.classList.toggle("ph-open", next);
  }

  syncMonth(curYm);
  setOpen(open);

  return {
    el, slot, right, panel,
    setOpen, toggle: () => setOpen(!open), isOpen: () => open, syncMonth,
  };
}

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Wire the standard scroll/pull gestures to a `periodHead` on a screen.
 *
 * Returns a disposer, though it also self-disposes once `view` leaves the DOM
 * (every screen is rebuilt from scratch on navigation).
 */
export function bindHeadGestures(view: HTMLElement, head: PeriodHead, extra?: {
  /** Horizontal swipe handler (e.g. ICCP's change-day). */
  onSwipeX?: (dir: 1 | -1) => void;
}): () => void {
  // A pull past this distance while already at the top opens the panel. Kept
  // well under the browser's own pull-to-refresh threshold so a longer, more
  // deliberate pull still refreshes the page.
  const OPEN_PULL = 62;

  let sx = 0, sy = 0, tracking = false, atTop = false, opened = false;

  const startsOnControl = (t: EventTarget | null) =>
    (t as HTMLElement | null)?.closest?.("input, select, textarea, button, .seg, .tilegrid, .ph-panel");

  const onStart = (x: number, y: number, t: EventTarget | null) => {
    if (startsOnControl(t)) { tracking = false; return; }
    sx = x; sy = y; tracking = true; opened = false;
    atTop = window.scrollY <= 2;
  };

  const onMove = (x: number, y: number) => {
    if (!tracking) return;
    const dx = x - sx, dy = y - sy;
    // Pulling DOWN from the very top is the "show me the calendar" gesture.
    if (atTop && dy > OPEN_PULL && Math.abs(dy) > Math.abs(dx) * 1.4) {
      if (!head.isOpen() && !opened) { head.setOpen(true); opened = true; }
      return;
    }
    // Pushing UP while at the top tucks it away again.
    if (atTop && dy < -30 && Math.abs(dy) > Math.abs(dx) * 1.4) {
      if (head.isOpen()) head.setOpen(false);
      return;
    }
    // Any other real drag (i.e. the user is scrolling the content) collapses it.
    if (!atTop && Math.hypot(dx, dy) > 24 && head.isOpen()) head.setOpen(false);
  };

  const onEnd = (x: number, y: number) => {
    if (!tracking) return;
    tracking = false;
    if (opened) return; // that gesture was the pull-to-open, not a swipe
    const dx = x - sx, dy = y - sy;
    if (extra?.onSwipeX && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      extra.onSwipeX(dx < 0 ? 1 : -1);
    }
  };

  view.addEventListener("touchstart", (e) => {
    const t = e.touches[0]; onStart(t.clientX, t.clientY, e.target);
  }, { passive: true });
  view.addEventListener("touchmove", (e) => {
    const t = e.touches[0]; onMove(t.clientX, t.clientY);
  }, { passive: true });
  view.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0]; onEnd(t.clientX, t.clientY);
  }, { passive: true });
  // Pointer fallback for desktop / mouse-drag testing.
  view.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") onStart(e.clientX, e.clientY, e.target); });
  view.addEventListener("pointermove", (e) => { if (e.pointerType !== "touch") onMove(e.clientX, e.clientY); });
  view.addEventListener("pointerup", (e) => { if (e.pointerType !== "touch") onEnd(e.clientX, e.clientY); });

  // Scrolling away from the top always collapses; a wheel-up at the top opens.
  const onScroll = () => { if (window.scrollY > 8 && head.isOpen()) head.setOpen(false); };
  window.addEventListener("scroll", onScroll, { passive: true });
  const onWheel = (e: WheelEvent) => {
    if (window.scrollY <= 2 && e.deltaY < -20) head.setOpen(true);
    else if (e.deltaY > 10 && head.isOpen()) head.setOpen(false);
  };
  view.addEventListener("wheel", onWheel, { passive: true });

  const dispose = () => window.removeEventListener("scroll", onScroll);
  new MutationObserver((_m, obs) => {
    if (!view.isConnected) { dispose(); obs.disconnect(); }
  }).observe(view.parentNode ?? document.body, { childList: true });

  return dispose;
}
