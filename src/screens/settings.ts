import { h, topbar, screen, toast, passwordPrompt, pullToRefresh, navigate } from "../ui";
import { db, getSetting, setSetting } from "../db";
import { debounce } from "../util";
import { hapticsEnabled, setHaptics, tapFeedback } from "../feedback";
import { exportBackup, lastBackupDay } from "../backup";

export async function renderSettings(_p: Record<string, string>, mount: HTMLElement) {
  const vessel = await getSetting("vessel", "SEAWAYS MIRAGE");
  const vesselMT = await getSetting("vesselMT", "M.T. SEAWAYS MIRAGE");
  const checkedBy = await getSetting("checkedBy", "ETO");
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

/** Code that has to be entered before the records can be wiped. */
const RESET_CODE = "0000";

async function resetAll() {
  // Password-gated: this throws away every entry the user has made, so a
  // mis-tap — or someone else poking at the phone — must not be enough.
  const ok = await passwordPrompt({
    title: "Reset app?",
    body: "This clears every entry you have made and re-seeds from the original files. Enter the reset password to continue.",
    code: RESET_CODE,
    confirm: "Reset everything",
  });
  if (!ok) return;
  await db.delete();
  location.reload();
}
