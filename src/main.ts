import "./style.css";
import { h, initRouter, route, navigate } from "./ui";
import { ensureSeeded } from "./seed";
import { renderToday } from "./screens/today";
import { renderRecords } from "./screens/records";
import { renderExport } from "./screens/exportScreen";
import { renderSettings } from "./screens/settings";
import { renderIccp } from "./screens/iccp";
import { renderBattery } from "./screens/battery";
import { renderFire } from "./screens/fire";
import { renderMotorTemp } from "./screens/motortemp";
import { renderVibration } from "./screens/vibration";
import { renderBusbar } from "./screens/busbar";
import { renderFreon } from "./screens/freon";
import { renderConditionMon } from "./screens/conditionmon";
import { renderOverhaul } from "./screens/overhaul";

const app = document.getElementById("app")!;

function bottomNav(): HTMLElement {
  const item = (r: string, ic: string, label: string) =>
    h("button", { "data-route": r, onClick: () => navigate(r) }, h("span", { class: "ic" }, ic), label);
  return h(
    "div",
    { class: "bottomnav" },
    item("/", "📋", "Today"),
    item("/records", "🗂️", "Records"),
    item("/export", "⬇️", "Export"),
    item("/settings", "⚙️", "Settings")
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
}

boot();

// register service worker (production only; injected file)
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
