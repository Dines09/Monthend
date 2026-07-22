import "./style.css";
import { h, initRouter, route, navigate, initTheme } from "./ui";
import { tapFeedback } from "./feedback";
import { ensureSeeded } from "./seed";
import { renderToday } from "./screens/today";
import { renderRecords } from "./screens/records";
import { renderExport } from "./screens/exportScreen";
import { renderSettings } from "./screens/settings";
import { renderIccp } from "./screens/iccp";
import { renderBattery } from "./screens/battery";
import { renderFire, maybeShowFireReminder } from "./screens/fire";
import { renderMotorTemp } from "./screens/motortemp";
import { renderVibration } from "./screens/vibration";
import { renderBusbar } from "./screens/busbar";
import { renderFreon } from "./screens/freon";
import { renderConditionMon } from "./screens/conditionmon";
import { renderOverhaul } from "./screens/overhaul";

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
route("/rec/iccp", renderIccp);
route("/rec/battery", renderBattery);
route("/rec/fire", renderFire);
route("/rec/motortemp", renderMotorTemp);
route("/rec/vibration", renderVibration);
route("/rec/busbar", renderBusbar);
route("/rec/freon", renderFreon);
route("/rec/conditionmon", renderConditionMon);
route("/rec/overhaul", renderOverhaul);

async function boot() {
  initTheme();
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
}

boot();

// register service worker (production only; injected file)
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
