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
import { h } from "../ui";
import { openMonthWheel, monthName } from "./parts";

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
  /** True just after opening — guards against the opening tap closing it again. */
  justOpened(): boolean;
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
  const monthChip = h("button", { class: "ph-month", type: "button", onClick: () => openWheel() }, monthLabel);

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
    // Title case reads better in a chip than the SHOUTED export spelling.
    monthLabel.textContent = `${monthName(Number(ym.slice(5, 7)))} ${ym.slice(0, 4)}`;
  }

  // The one shared month/year wheel — same control on every screen.
  function openWheel() {
    openMonthWheel(curYm, (ym) => { syncMonth(ym); opts.onMonth(ym); }, opts.maxYm ?? currentYm());
  }

  function setOpen(next: boolean) {
    open = next;
    el.classList.toggle("ph-open", next);
    // When the page is scrolled the panel can't push the content down (there is
    // nothing above it on screen), so it floats over the readings instead. Taps
    // outside then dismiss it, like any overlay.
    el.classList.toggle("ph-overlay", next && window.scrollY > 8);
    if (next) openedAt = Date.now();
  }

  // When the panel was opened, so a scroll/wheel event caused by the very tap
  // that opened it can't immediately close it again.
  let openedAt = 0;
  const justOpened = () => Date.now() - openedAt < 400;

  syncMonth(curYm);
  setOpen(open);

  return {
    el, slot, right, panel,
    setOpen, toggle: () => setOpen(!open), isOpen: () => open, justOpened, syncMonth,
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
    const vertical = Math.abs(dy) > Math.abs(dx) * 1.4;
    // Pulling DOWN while the page is already at the top is the "show me the
    // calendar" gesture. It has to keep working after the user has collapsed
    // the panel — the whole point is that it's the way to get it back.
    if (atTop && vertical && dy > OPEN_PULL) {
      if (!head.isOpen() && !opened) { head.setOpen(true); opened = true; }
      return;
    }
    // Pushing UP at the top tucks it away again.
    if (atTop && vertical && dy < -30) {
      if (head.isOpen()) head.setOpen(false);
      return;
    }
    // Scrolling the content collapses an inline panel; an overlay panel is
    // independent of the page scroll and stays until dismissed.
    if (!atTop && Math.hypot(dx, dy) > 24 && head.isOpen()
        && !head.el.classList.contains("ph-overlay")) {
      head.setOpen(false);
    }
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

  // Scrolling collapses the panel — but never the scroll event fired by the very
  // tap that just opened it (that was the "opens then instantly closes" bug).
  // While the panel floats as an overlay the page scroll is irrelevant to it.
  const onScroll = () => {
    if (head.justOpened() || head.el.classList.contains("ph-overlay")) return;
    if (window.scrollY > 8 && head.isOpen()) head.setOpen(false);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  const onWheel = (e: WheelEvent) => {
    if (head.justOpened()) return;
    if (window.scrollY <= 2 && e.deltaY < -20) head.setOpen(true);
    else if (e.deltaY > 10 && head.isOpen()) head.setOpen(false);
  };
  view.addEventListener("wheel", onWheel, { passive: true });

  // An open overlay panel closes when the user taps anywhere outside it.
  const onDocDown = (e: Event) => {
    if (!head.isOpen() || head.justOpened()) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest(".periodhead")) return; // inside the header — its own handlers deal with it
    head.setOpen(false);
  };
  document.addEventListener("pointerdown", onDocDown, true);

  const dispose = () => {
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("pointerdown", onDocDown, true);
  };
  new MutationObserver((_m, obs) => {
    if (!view.isConnected) { dispose(); obs.disconnect(); }
  }).observe(view.parentNode ?? document.body, { childList: true });

  return dispose;
}
