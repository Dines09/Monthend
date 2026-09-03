import JSZip from "jszip";
import { h, topbar, screen, toast } from "../ui";
import { statusBadge } from "../status";
import { RECORDS } from "../records";
import { GENERATORS, type ExportResult } from "../export/generate";
import { defaultReportYm, monthLabel, MONTHS_FULL, quarterWindow, ym as ymOf } from "../util";
import { downloadBlob } from "../backup";

export async function renderExport(_p: Record<string, string>, mount: HTMLElement) {
  let curYm = defaultReportYm();

  const fileList = h("div", {});
  const yearSel = h("select", {});
  const monthSel = h("select", {});

  // Can't report a month that hasn't happened yet.
  const nowYm = ymOf(new Date());
  const nowYear = Number(nowYm.split("-")[0]);
  const year = Number(curYm.split("-")[0]);
  for (let y = 2026; y <= nowYear; y++) yearSel.append(h("option", { value: String(y), selected: y === year }, String(y)));

  function rebuildMonths() {
    monthSel.replaceChildren();
    const y = Number(yearSel.value);
    let sel = Number(curYm.split("-")[1]);
    // Clamp selection if it lands on a disabled (future) month.
    if (`${y}-${String(sel).padStart(2, "0")}` > nowYm) sel = Number(nowYm.split("-")[1]);
    for (let m = 1; m <= 12; m++) {
      const future = `${y}-${String(m).padStart(2, "0")}` > nowYm;
      monthSel.append(h("option", { value: String(m), selected: m === sel, disabled: future || undefined },
        `${MONTHS_FULL[m - 1]}${future ? " —" : ""}`));
    }
  }

  function syncYm() {
    rebuildMonths();
    curYm = `${yearSel.value}-${String(monthSel.value).padStart(2, "0")}`;
    void renderFiles();
  }
  yearSel.addEventListener("change", syncYm);
  monthSel.addEventListener("change", syncYm);
  rebuildMonths();

  async function renderFiles() {
    fileList.replaceChildren();
    for (const rec of RECORDS) {
      let sub = "";
      if (rec.id === "firedetector") { const q = quarterWindow(curYm); sub = `${q.label} ${q.year}`; }
      else sub = monthLabel(curYm);
      const btn = h("button", { class: "btn secondary", onClick: () => downloadOne(rec.id) }, "Download");
      const tile = h("div", { class: "exportfile" },
        h("div", { class: "icon", style: { fontSize: "24px" } }, rec.icon),
        h("div", { class: "fname" }, rec.title, h("small", {}, `${rec.fileRef} · ${sub}`)),
        btn);
      // How much of this record is filled in for the selected month, so the
      // user can see what is still missing before downloading rather than
      // opening each file to find out.
      const badge = await statusBadge(rec.id, curYm);
      if (badge) tile.append(badge);
      fileList.append(tile);
    }
  }

  async function downloadOne(id: string) {
    toast("Generating…");
    try {
      const res = await GENERATORS[id](curYm);
      downloadBlob(res.blob, res.filename);
      toast(`Saved ${res.filename}`, 2200);
    } catch (e: any) {
      console.error(e);
      toast("Error: " + (e?.message || "failed"), 3000);
    }
  }

  const exportAllBtn = h("button", { class: "btn", onClick: exportAll },
    h("span", { class: "biglabel" }, "⬇ Export All (ZIP)"));

  async function exportAll() {
    exportAllBtn.setAttribute("disabled", "true");
    const orig = exportAllBtn.innerHTML;
    exportAllBtn.replaceChildren(h("div", { class: "spinner" }), document.createTextNode(" Generating…"));
    try {
      const zip = new JSZip();
      const results: ExportResult[] = [];
      for (const rec of RECORDS) {
        const res = await GENERATORS[rec.id](curYm);
        results.push(res);
        zip.file(res.filename, res.blob);
      }
      const { year, month } = { year: Number(curYm.split("-")[0]), month: Number(curYm.split("-")[1]) };
      const zipName = `Monthend ${MONTHS_FULL[month - 1]} ${year}.zip`;
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, zipName);
      toast(`${results.length} files → ${zipName}`, 2600);
    } catch (e: any) {
      console.error(e);
      toast("Error: " + (e?.message || "failed"), 3500);
    } finally {
      exportAllBtn.innerHTML = orig;
      exportAllBtn.removeAttribute("disabled");
    }
  }

  mount.append(
    topbar("Export Month End", "Download Excel files"),
    screen(
      h("div", { class: "card accent" },
        h("div", { class: "lab", style: { fontSize: "13px", marginBottom: "8px", fontWeight: 600 } }, "Reporting month"),
        h("div", { style: { display: "flex", gap: "10px" } }, monthSel, yearSel)),
      exportAllBtn,
      h("p", { class: "hint", style: { textAlign: "center", margin: "12px 0" } }, "or download individual files:"),
      fileList,
      h("p", { class: "hint", style: { marginTop: "16px" } },
        "Cumulative files (temp, vibration, busbar, freon, condition monitoring, overhaul) include the whole year up to this month. ICCP and Battery are month-only. Fire detector uses the 3-month quarter window.")
    )
  );
  await renderFiles();
}
