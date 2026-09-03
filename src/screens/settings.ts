import { h, topbar, screen, toast, passwordPrompt, pullToRefresh, navigate } from "../ui";
import { db, getSetting, setSetting } from "../db";
import { debounce } from "../util";
import { hapticsEnabled, setHaptics, tapFeedback } from "../feedback";
import { exportBackup, lastBackupDay } from "../backup";

export async function renderSettings(_p: Record<string, string>, mount: HTMLElement) {
  const vessel = await getSetting("vessel", "SEAWAYS MIRAGE");
  const vesselMT = await getSetting("vesselMT", "M.T. SEAWAYS MIRAGE");
  const checkedBy = await getSetting("checkedBy", "ETO");
  const chiefEngineer = await getSetting("chiefEngineer", "");
  const ato = await getSetting("ato", "");
  const lastBackup = await lastBackupDay();

  const field = (lab: string, node: Node) => h("label", { class: "field" }, h("span", { class: "lab" }, lab), node);
  const txt = (key: string, val: string) =>
    h("input", { value: val, onInput: debounce((e: Event) => { setSetting(key, (e.target as HTMLInputElement).value); toast("Saved", 800); }, 400) });

  mount.append(
    topbar("Settings", "App configuration"),
    screen(
      h("h2", { style: { marginLeft: 0 } }, "Vessel"),
      field("Vessel name (headers)", txt("vessel", vessel)),
      field("Vessel name (M.T. …)", txt("vesselMT", vesselMT)),
      field("Checked / Prepared by", txt("checkedBy", checkedBy)),

      h("h2", { style: { marginLeft: 0 } }, "Signatories"),
      h("p", { class: "hint", style: { margin: "0 0 10px" } },
        "These names are printed in the signature blocks of the reports that carry them — the motor temp and overhaul sheets, and the Chief Engineer line on the ICCP log. Change them here when the officers change and every export follows."),
      field("Chief Engineer", txt("chiefEngineer", chiefEngineer)),
      field("ATO / Electrical Officer", txt("ato", ato)),

      h("h2", { style: { marginLeft: 0 } }, "Feedback"),
      h("label", { class: "toggle-row" },
        h("div", {},
          h("div", { class: "title" }, "Tap sound & vibration"),
          h("div", { class: "desc" }, "Light click + buzz when navigating")),
        (() => {
          const cb = h("input", { type: "checkbox", class: "switch", checked: hapticsEnabled(),
            onChange: (e: Event) => { const on = (e.target as HTMLInputElement).checked; setHaptics(on); if (on) tapFeedback(); } });
          return cb;
        })()),

      h("h2", { style: { marginLeft: 0 } }, "Data"),
      h("div", { class: "card" },
        h("div", { class: "hint", style: { marginBottom: "10px" } }, "Historic Jan–June 2026 data is seeded from your original files. Your daily entries add on top."),
        h("div", { class: "hint", style: { marginBottom: "10px" } },
          "A backup downloads automatically once a day. ",
          lastBackup ? h("strong", {}, `Last backup: ${lastBackup}`) : h("strong", {}, "No backup yet.")),
        h("button", { class: "btn secondary", onClick: exportBackup }, "⬇ Backup all data (JSON)"),
        h("div", { style: { height: "8px" } }),
        h("label", { class: "btn secondary", style: { position: "relative", overflow: "hidden" } }, "⬆ Restore from backup",
          h("input", { type: "file", accept: "application/json", style: { position: "absolute", inset: 0, opacity: 0 }, onChange: importBackup }))),

      h("h2", { style: { marginLeft: 0 } }, "Danger zone"),
      h("button", { class: "btn", style: { background: "var(--bad)", color: "#fff" }, onClick: resetAll }, "Reset app (re-seed from originals)"),

      h("h2", { style: { marginLeft: 0 } }, "Updates"),
      h("div", { class: "card" },
        h("div", { class: "hint", style: { marginBottom: "10px" } },
          "The app never needs a connection to run — everything is stored on this phone. Check for a new version only when you have signal."),
        h("button", { class: "btn secondary", onClick: checkForUpdate }, "↻ Check for updates")),

      h("h2", { style: { marginLeft: 0 } }, "About"),
      h("div", { class: "card" },
        h("div", { class: "card-row" },
          h("div", { class: "body" },
            h("div", { class: "title" }, "App version"),
            h("div", { class: "desc" }, `Built ${__BUILD_DATE__}`)),
          h("span", { class: "chip done", style: { fontSize: "14px" } }, `v${__APP_VERSION__}`))),

      h("p", { class: "hint", style: { marginTop: "20px", textAlign: "center" } },
        "This web app is developed by ETO.", h("br"), "Month End PWA · works offline once installed")
    )
  );

  // Settings has no periodhead calendar to pull open like the record screens
  // do, so it gets its own pull-to-refresh: re-runs the router on this route
  // to re-read the saved values and backup status, with a visible spinner +
  // toast so a refresh is obviously something that happened, not a silent
  // no-op.
  pullToRefresh(mount, () => {
    navigate("/settings");
    toast("Settings refreshed", 1200);
  });
}

async function importBackup(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) {
      if (data[table.name]) { await table.clear(); await table.bulkAdd(data[table.name]); }
    }
  });
  toast("Restored — reloading…");
  setTimeout(() => location.reload(), 800);
}

/**
 * Code that has to be entered before the records can be wiped. It is shown in
 * the prompt itself — the point of the gate is to stop a mis-tap or an idle
 * poke at the phone from destroying a month's entries, not to keep a secret
 * from the person who owns the device.
 */
const RESET_CODE = "0000";

async function resetAll() {
  // Password-gated: this throws away every entry the user has made, so a
  // mis-tap — or someone else poking at the phone — must not be enough.
  const ok = await passwordPrompt({
    title: "Reset app?",
    body: `This clears every entry you have made and re-seeds from the original files. Enter the reset password to continue (${RESET_CODE}).`,
    code: RESET_CODE,
    confirm: "Reset everything",
  });
  if (!ok) return;
  await db.delete();
  location.reload();
}

/**
 * Manual update check. The app deliberately does not look for a new build on
 * launch (see main.ts) because it is normally offline, so this is the way a
 * new version gets picked up when there is signal.
 */
async function checkForUpdate() {
  if (!("serviceWorker" in navigator)) return toast("Updates are not supported here", 2000);
  if (!navigator.onLine) return toast("No connection — the app still works offline", 2400);
  toast("Checking…", 1200);
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return toast("Not installed yet", 2000);
    await reg.update();
    // An update that found something fires `updatefound` and main.ts shows the
    // Update bar; if nothing is waiting, the build is already the latest.
    toast(reg.installing || reg.waiting ? "Downloading update…" : "Already up to date", 2200);
  } catch {
    toast("Could not check — try again with a better connection", 2600);
  }
}
