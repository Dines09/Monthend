import { h, topbar, screen, toast } from "../ui";
import { db } from "../db";
import { masters, detKey } from "../seed";
import { isoDate, defaultReportYm, ymParts, saturdaysInMonth, quarterWindow, monthLabel } from "../util";

export async function renderFire(_p: Record<string, string>, mount: HTMLElement) {
  const today = new Date();
  let selDate = isoDate(today);
  let filter = "";

  const dateSelect = h("select", {});
  const listEl = h("div", {});
  const prog = h("span", { class: "progress" });

  // Build Saturday options across current quarter + today
  function rebuildDates() {
    dateSelect.replaceChildren();
    const curYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const q = quarterWindow(curYm);
    const opts = new Set<string>();
    for (let m = ymParts(q.startYm).month; m <= ymParts(q.endYm).month; m++) {
      for (const s of saturdaysInMonth(q.year, m)) if (s <= isoDate(today) || m >= today.getMonth() + 1) opts.add(s);
    }
    opts.add(isoDate(today));
    const sorted = [...opts].sort();
    for (const s of sorted) dateSelect.append(h("option", { value: s, selected: s === selDate }, `${s}${s === isoDate(today) ? " · today" : ""}`));
    dateSelect.value = selDate;
  }

  async function load() {
    listEl.replaceChildren();
    const q = quarterWindow(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
    const tests = await db.fireTest.toArray();
    // detectors tested this quarter (any date in range)
    const testedThisQ = new Map<string, string>(); // detKey -> date
    for (const t of tests) {
      const m = t.testedDate.slice(0, 7);
      if (m >= q.startYm && m <= q.endYm) testedThisQ.set(t.detKey, t.testedDate);
    }
    // tested specifically on selected date
    const testedToday = new Set(tests.filter((t) => t.testedDate === selDate).map((t) => t.detKey));

    const f = filter.trim().toLowerCase();
    let curZone = -1;
    let shown = 0;
    for (const d of masters.fireDetectors) {
      const label = `${d.id ?? ""} ${d.location ?? ""}`.toLowerCase();
      if (f && !label.includes(f)) continue;
      shown++;
      if (d.zone !== curZone) {
        curZone = d.zone;
        listEl.append(h("div", { class: "zone-hdr" }, `${d.sheet === "battery" ? "Battery-operated · " : ""}Zone ${d.zone}`));
      }
      const key = detKey(d);
      const isTestedToday = testedToday.has(key);
      const qDate = testedThisQ.get(key);
      const row = h(
        "div",
        { class: `det ${isTestedToday ? "tested" : ""}`, onClick: () => toggle(d, key) },
        h("div", { class: "cb" }, isTestedToday ? "✓" : ""),
        h("div", { class: "info" },
          h("div", { class: "id" }, d.id || `#${d.sn}`),
          h("div", { class: "loc" }, d.location || "")),
        qDate && !isTestedToday ? h("span", { class: "chip done", style: { fontSize: "10px" } }, `Q: ${qDate.slice(5)}`) : null
      );
      listEl.append(row);
    }
    if (shown === 0) listEl.append(h("div", { class: "list-empty" }, "No detectors match."));
    prog.textContent = `${testedThisQ.size}/${masters.fireDetectors.length} this quarter`;
  }

  async function toggle(d: any, key: string) {
    const existing = await db.fireTest.where("detKey").equals(key).and((t) => t.testedDate === selDate).first();
    if (existing?.id) {
      await db.fireTest.delete(existing.id);
    } else {
      await db.fireTest.add({ detKey: key, testedDate: selDate, remarks: "satisfactory" });
      toast(`Tested: ${d.id || d.location}`, 900);
    }
    load();
  }

  dateSelect.addEventListener("change", () => { selDate = dateSelect.value; load(); });
  const search = h("input", { type: "search", placeholder: "Search ID or location…", oninput: (e: Event) => { filter = (e.target as HTMLInputElement).value; load(); } });

  const curYmStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  mount.append(
    topbar("Fire Detector Test", quarterWindow(curYmStr).label + " " + today.getFullYear(), "/records"),
    screen(
      h("div", { class: "toolbar" }, dateSelect, prog),
      h("p", { class: "hint" }, "Pick the Saturday session, then tap each detector tested. Each detector is covered once per 3-month cycle."),
      h("div", { class: "searchbar", style: { marginBottom: "10px" } }, search),
      listEl
    )
  );
  rebuildDates();
  await load();
}
