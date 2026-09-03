import "./style.css";
import { h, initRouter, route, navigate, initTheme } from "./ui";
import { tapFeedback } from "./feedback";
import { ensureSeeded } from "./seed";
import { maybeAutoBackup } from "./backup";
import { renderToday } from "./screens/today";
import { renderRecords } from "./screens/records";
import { renderExport } from "./screens/exportScreen";
import { renderSettings } from "./screens/settings";
import { renderIccp, renderIccpMonthly } from "./screens/iccp";
import { renderBattery } from "./screens/battery";
import { renderFire, maybeShowFireReminder } from "./screens/fire";
import { renderMotorTemp } from "./screens/motortemp";
import { renderVibration } from "./screens/vibration";
import { renderBusbar } from "./screens/busbar";
import { renderFreon } from "./screens/freon";
import { renderConditionMon } from "./screens/conditionmon";
import { renderOverhaul } from "./screens/overhaul";
import { renderUniversalSearch } from "./screens/universal";

const app = document.getElementById("app")!;

function bottomNav(): HTMLElement {
  const item = (r: string, ic: string, label: string) =>
    h("button", { "data-route": r, onClick: () => { tapFeedback(); navigate(r); } }, h("span", { class: "ic" }, ic), label);
  // Sliding highlight pill that moves under the active item (macOS-dock feel).
  const pill = h("div", { class: "nav-pill" });
  return h(
    "div",
    { class: "bottomnav" },
    h(
      "div",
      { class: "dock" },
      pill,
      item("/", "📋", "Today"),
      item("/records", "🗂️", "Records"),
      item("/export", "⬇️", "Export"),
      item("/settings", "⚙️", "Settings")
    )
  );
}

// Register routes
route("/", renderToday);
route("/records", renderRecords);
route("/export", renderExport);
route("/settings", renderSettings);
route("/search", renderUniversalSearch);
route("/rec/iccp", renderIccp);
route("/rec/iccp-monthly/:ym", renderIccpMonthly);
route("/rec/battery", renderBattery);
route("/rec/fire", renderFire);
route("/rec/motortemp", renderMotorTemp);
route("/rec/vibration", renderVibration);
route("/rec/busbar", renderBusbar);
route("/rec/freon", renderFreon);
route("/rec/conditionmon", renderConditionMon);
route("/rec/overhaul", renderOverhaul);

/**
 * Block the zoom gestures the CSS can't reach.
 *
 * iOS Safari ignores both `user-scalable=no` and `touch-action` for its own
 * pinch and double-tap zoom, so those two have to be cancelled here; otherwise
 * a mistap while entering readings leaves the page zoomed and the user has to
 * fight it back. Ctrl+wheel is the desktop equivalent.
 */
function lockZoom() {
  for (const ev of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  }
  document.addEventListener("touchmove", (e) => {
    if ((e as TouchEvent).touches.length > 1) e.preventDefault();
  }, { passive: false });
  // Double-tap to zoom: a second tap within 300ms of the first. Cancelling the
  // touchend also cancels the synthetic click, so controls are left alone —
  // tapping a day twice quickly on the calendar must still register.
  let lastTap = 0;
  document.addEventListener("touchend", (e) => {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea, select, button, a, label, .seg")) { lastTap = 0; return; }
    const now = Date.now();
    if (now - lastTap < 300) e.preventDefault();
    lastTap = now;
  }, { passive: false });
  document.addEventListener("wheel", (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false });
}

async function boot() {
  initTheme();
  lockZoom();
  app.append(
    h(
      "div",
      { class: "loading-full" },
      h("div", { class: "spinner" }),
      h("div", {}, "Loading records…")
    )
  );

  await ensureSeeded();

  app.replaceChildren();
  const mount = h("div", { id: "view" });
  app.append(mount, bottomNav());
  initRouter(mount);

  // Saturday: remind which fire detectors are scheduled for today (once/day).
  maybeShowFireReminder();

  // Daily backup. Deferred a few seconds: a download fired during boot is often
  // dropped by the browser, and it must never delay the first screen.
  setTimeout(() => { void maybeAutoBackup(); }, 4000);
}

boot();

// Register the service worker (production only; the file is generated at build
// time). Once it has installed, the app runs entirely from the cache — no
// network is needed again until a new version is published.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js");
      // Update checks are deliberately NOT run at boot. The app is used at sea
      // with no connection for days: an update check on every launch is a
      // request that can only fail, and while it is failing the browser has
      // already shown its offline UI. A new build is picked up whenever the
      // browser revalidates sw.js on its own, and the user can force a check
      // from Settings. Only look when the browser says a connection appeared.
      const checkForUpdate = () => { if (navigator.onLine) reg.update().catch(() => {}); };
      window.addEventListener("online", checkForUpdate);
      // A fresh worker finished installing while an old one is still serving.
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) notifyUpdate(reg);
        });
      });
    } catch { /* offline or unsupported — the app still runs from cache */ }
  });

  // Reload once the new worker takes control, so the user lands on the new build.
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

/** Offer the waiting update rather than forcing a reload mid-entry. */
function notifyUpdate(reg: ServiceWorkerRegistration) {
  const bar = h("div", { class: "updatebar" },
    h("span", {}, "A new version is available."),
    h("button", {
      class: "btn",
      onClick: () => reg.waiting?.postMessage("skip-waiting"),
    }, "Update"));
  document.body.append(bar);
  requestAnimationFrame(() => bar.classList.add("show"));
}
