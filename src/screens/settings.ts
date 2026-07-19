import { h, topbar, screen, toast, navigate } from "../ui";
import { db, getSetting, setSetting } from "../db";
import { debounce } from "../util";

export async function renderSettings(_p: Record<string, string>, mount: HTMLElement) {
  const vessel = await getSetting("vessel", "SEAWAYS MIRAGE");
  const vesselMT = await getSetting("vesselMT", "M.T. SEAWAYS MIRAGE");
  const checkedBy = await getSetting("checkedBy", "ETO");

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

      h("h2", { style: { marginLeft: 0 } }, "Data"),
      h("div", { class: "card" },
        h("div", { class: "hint", style: { marginBottom: "10px" } }, "Historic Jan–June 2026 data is seeded from your original files. Your daily entries add on top."),
        h("button", { class: "btn secondary", onClick: exportBackup }, "⬇ Backup all data (JSON)"),
        h("div", { style: { height: "8px" } }),
        h("label", { class: "btn secondary", style: { position: "relative", overflow: "hidden" } }, "⬆ Restore from backup",
          h("input", { type: "file", accept: "application/json", style: { position: "absolute", inset: 0, opacity: 0 }, onChange: importBackup }))),

      h("h2", { style: { marginLeft: 0 } }, "Danger zone"),
      h("button", { class: "btn", style: { background: "var(--bad)", color: "#fff" }, onClick: resetAll }, "Reset app (re-seed from originals)"),

      h("p", { class: "hint", style: { marginTop: "20px", textAlign: "center" } }, "Month End PWA · works offline once installed")
    )
  );
}

async function exportBackup() {
  const dump: Record<string, any> = {};
  for (const table of db.tables) dump[table.name] = await table.toArray();
  const blob = new Blob([JSON.stringify(dump)], { type: "application/json" });
  downloadBlob(blob, `monthend-backup-${new Date().toISOString().slice(0, 10)}.json`);
  toast("Backup downloaded");
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

async function resetAll() {
  if (!confirm("This clears all entries and re-seeds from the original June files. Continue?")) return;
  await db.delete();
  location.reload();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
