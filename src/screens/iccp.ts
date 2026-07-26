import { h, topbar, screen, numInput, readingField, toast, segmented, progressRing, achievement, helpTip, longPress, wheelPicker, type ReadingSpec } from "../ui";
import { db, type IccpDaily } from "../db";
import { isoDate, defaultReportYm, ymParts, debounce, parseIso, saturdaysInMonth, slipringDefault, MONTHS_FULL } from "../util";

const AREAS = ["Sea", "Port", "Anchor"];
const SEA_CHESTS = ["P", "S", "P/S"];

// Calendar day colouring by where the ship was that day. The class is added to
// the day circle; the actual colours live in style.css (theme-aware).
//   Sea → light blue · Port → green · Anchor → orange
const AREA_CLASS: Record<string, string> = { Sea: "a-sea", Port: "a-port", Anchor: "a-anchor" };
const LEGEND: [string, string][] = [["a-sea", "Sea"], ["a-port", "Port"], ["a-anchor", "Anchor"]];

// Anti-fouling MGPS readings depend on which sea chest is in use.
// P: Cu1 leads; S: readings swap between the two cells.
const MGPS: Record<string, { cu1: number; al1: number; cu2: number; al2: number }> = {
  P: { cu1: 1.2, al1: 1.4, cu2: 0.2, al2: 0.4 },
  S: { cu1: 0.2, al1: 0.4, cu2: 1.2, al2: 1.4 },
};
// P/S in use -> keep the P (leading) set; no swap.
MGPS["P/S"] = MGPS.P;

// Ship is stationary at Port/Anchor -> shaft is not turning -> shaft potential is 0.
const STATIONARY = new Set(["Port", "Anchor"]);

// Today's readings the user actually enters (excludes auto-filled fields).
const READING_KEYS: (keyof IccpDaily)[] = ["draft", "seaTemp", "amp", "volt", "cell1", "cell2"];

// Per-field validation + entry rules. Out-of-range values turn the field red and
// a settled valid value auto-advances focus to the next field in ADVANCE_ORDER.
const SPECS: Partial<Record<keyof IccpDaily, ReadingSpec>> = {
  draft:   { min: 5.5,  max: 15.5, decimals: 1, intDigits: 2, warn: "Draft looks off — should be 5.5–15.5 M. Check the reading." },
  seaTemp: { min: 0,    max: 40,   decimals: 0, intDigits: 2, warn: "Sea temp out of range — should be 0–40 °C. Check the reading." },
  cell1:   { min: 150,  max: 250,  decimals: 0, intDigits: 3, warn: "Sensing Cell 1 out of range — should be 150–250 mV. Check the reading." },
  cell2:   { min: 150,  max: 250,  decimals: 0, intDigits: 3, warn: "Sensing Cell 2 out of range — should be 150–250 mV. Check the reading." },
  amp:     { min: 0,    max: 200,  decimals: 1, intDigits: 2, warn: "Output Amp out of range — should be up to 200 A. Check the reading." },
  volt:    { min: 2,    max: 40,   decimals: 1, intDigits: 2, warn: "Output Volt out of range — should be 2–40 V. Check the reading." },
  shaftMv: { min: 0,    max: 50,   decimals: 0, allowOverride: true, warn: "Shaft potential > 50 mV — check your reading again and the shaft earthing / bonding. You can still keep this value if it's correct." },
};

// Focus jumps to the next field once the current one is validly settled.
// Order matches the on-screen fields: draft, sea temp, then the ICCP system
// block (Output Amp -> Output Volt -> Sensing Cell 1 -> Sensing Cell 2), shaft.
const ADVANCE_ORDER: (keyof IccpDaily)[] = ["draft", "seaTemp", "amp", "volt", "cell1", "cell2", "shaftMv"];

// Count of today's reading fields already filled (for the progress ring and the
// calendar's "done" tick). A field only counts when its value is present AND
// within the valid range, so a half-typed / out-of-range last reading won't trip
// the "completed" state early. Shaft potential only counts when under way.
function progressOf(saved: IccpDaily | undefined): { done: number; total: number } {
  const area = saved?.area ?? "Sea";
  const stationary = STATIONARY.has(area);
  const keys = stationary ? READING_KEYS : [...READING_KEYS, "shaftMv" as keyof IccpDaily];
  const done = keys.filter((k) => {
    const v = saved?.[k];
    if (v == null) return false;
    const spec = SPECS[k];
    if (!spec) return true;
    // Override-capable readings (e.g. shaft potential) count as done once a
    // value is present — the range check is only an advisory warning there.
    if (spec.allowOverride) return typeof v === "number";
    return typeof v === "number" && v >= spec.min && v <= spec.max;
  }).length;
  return { done, total: keys.length };
}

function isComplete(saved: IccpDaily | undefined): boolean {
  const { done, total } = progressOf(saved);
  return total > 0 && done >= total;
}

export async function renderIccp(_p: Record<string, string>, mount: HTMLElement) {
  const today = new Date();
  const todayIso = isoDate(today);
  // default to current month for daily entry
  let curYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  let selDate = todayIso;
  let editingMgps = false;
  let lastComplete = false;

  const form = h("div", {});
  const ringWrap = h("div", {});
  const calWrap = h("div", { class: "cal" });
  const monthlyBtn = h("button", { class: "btn ghost", style: { marginTop: "16px" }, onClick: () => openMonthly(curYm) }, "Monthly footer (observations, slipring, remark)");

  // Keep the selected day inside the current month (clamp when the month changes).
  function rebuildDays() {
    if (!selDate.startsWith(curYm)) selDate = `${curYm}-01`;
  }

  async function refreshRing(fireOnComplete: boolean) {
    const saved = await db.iccpDaily.get(selDate);
    const { done, total } = progressOf(saved);
    ringWrap.replaceChildren(progressRing(done, total, "left"));
    const complete = total > 0 && done >= total;
    // Keep the calendar's colour + done-tick for this day in sync after an edit.
    void refreshCalendar();
    if (fireOnComplete && complete && !lastComplete) {
      const when = selDate === todayIso ? "today" : `Day ${Number(selDate.slice(-2))}`;
      // Dismiss the on-screen keyboard first, then wait ~1.2s after the last
      // reading settles before celebrating — so the tick lands centered and
      // never pops up mid-typing of the final value.
      (document.activeElement as HTMLElement | null)?.blur?.();
      setTimeout(() => achievement("Entry completed!", `ICCP / MGPS saved for ${when}`), 1200);
    }
    lastComplete = complete;
  }

  async function loadDay() {
    editingMgps = false;
    const saved = await db.iccpDaily.get(selDate);
    const prevDate = isoDate(new Date(parseIso(selDate).getTime() - 86400000));
    const prev = await db.iccpDaily.get(prevDate);

    // Effective values shown to the user: saved first, else carried forward from
    // the previous day, else a sensible default. Slow-changing fields (incl. the
    // MGPS readings) carry forward so an edit "sticks" as the new daily normal.
    const area = saved?.area ?? prev?.area ?? "Sea";
    const seaChest = saved?.seaChest ?? prev?.seaChest ?? "S";
    const draft = saved?.draft ?? prev?.draft ?? null;
    const stationary = STATIONARY.has(area);
    const mgps = MGPS[seaChest] ?? MGPS.S;

    const rec: IccpDaily = {
      date: selDate,
      area,
      seaChest,
      draft: draft ?? undefined,
      cu1: saved?.cu1 ?? prev?.cu1 ?? mgps.cu1,
      al1: saved?.al1 ?? prev?.al1 ?? mgps.al1,
      cu2: saved?.cu2 ?? prev?.cu2 ?? mgps.cu2,
      al2: saved?.al2 ?? prev?.al2 ?? mgps.al2,
      shaftMv: stationary ? 0 : saved?.shaftMv,
      seaTemp: saved?.seaTemp,
      amp: saved?.amp,
      volt: saved?.volt,
      cell1: saved?.cell1,
      cell2: saved?.cell2,
    };

    // Persist auto-filled slow-changing fields on first visit / when derived, so a
    // day the user only glances at still exports right.
    const autoPatch: Partial<IccpDaily> = {
      area, seaChest, cu1: rec.cu1, al1: rec.al1, cu2: rec.cu2, al2: rec.al2,
      ...(draft != null ? { draft } : {}),
      ...(stationary ? { shaftMv: 0 } : {}),
    };
    if (needsAutoSave(saved, autoPatch)) await save(autoPatch, true);

    form.replaceChildren();

    // Big, glove-friendly labelled field.
    const field = (lab: string, node: Node) => h("label", { class: "field big" }, h("span", { class: "lab" }, lab), node);

    // Registry of reading inputs so a settled value can auto-advance focus to the
    // next field the user still has to fill.
    const inputs = new Map<keyof IccpDaily, HTMLInputElement>();
    const focusNext = (from: keyof IccpDaily) => {
      const start = ADVANCE_ORDER.indexOf(from);
      if (start < 0) return;
      for (let i = start + 1; i < ADVANCE_ORDER.length; i++) {
        const el = inputs.get(ADVANCE_ORDER[i]);
        if (el && !el.readOnly && el.value.trim() === "") { el.focus(); return; }
      }
      // Nothing left to fill — drop the keyboard so the completion tick can land.
      (document.activeElement as HTMLElement | null)?.blur?.();
    };

    // A full reading field (label + validated input + inline warning line). The
    // input is registered for auto-advance.
    const rf = (key: keyof IccpDaily, label: string) => {
      const { wrap, input } = readingField(label, {
        value: (rec[key] as number) ?? null,
        placeholder: prev?.[key] != null ? String(prev[key]) : "",
        spec: SPECS[key],
        big: true,
        onInput: debounce(async (v) => { await save({ [key]: v }); await refreshRing(true); }, 300),
        onSettled: () => focusNext(key),
        // "Use anyway" on an out-of-range override field (shaft): keep the value,
        // advance focus, and let the completion tick fire.
        onOverride: () => { focusNext(key); void refreshRing(true); },
      });
      inputs.set(key, input);
      return wrap;
    };

    const areaSeg = segmented({ options: AREAS, value: area, big: true,
      onPick: async (v) => { await save({ area: v }); await loadDay(); } });
    // Changing the sea chest re-derives the MGPS readings from the map for the new
    // chest (explicit values, so carry-forward doesn't keep the old set).
    const chestSeg = segmented({ options: SEA_CHESTS, value: seaChest, big: true,
      onPick: async (v) => { await save({ seaChest: v, ...(MGPS[v] ?? MGPS.S) }); await loadDay(); } });

    // Read-only value tile (view mode) / editable input (long-press edit mode).
    const tile = (lab: string, val: number | null, unit?: string) =>
      h("div", { class: "tile" },
        h("div", { class: "tval" }, val == null ? "—" : String(val), unit ? h("span", { class: "tunit" }, unit) : null),
        h("div", { class: "tlab" }, lab));

    const MGPS_CELLS: [keyof IccpDaily, string][] = [["cu1", "CU 1"], ["al1", "AL 1"], ["cu2", "CU 2"], ["al2", "AL 2"]];
    const mgpsGrid = h("div", { class: "tilegrid" });
    const editNote = h("div", { class: "editnote" }, "");

    function renderMgps() {
      mgpsGrid.className = `tilegrid ${editingMgps ? "editing" : ""}`;
      if (editingMgps) {
        mgpsGrid.replaceChildren(
          ...MGPS_CELLS.map(([key, lab]) =>
            h("div", { class: "tile" },
              numInput({ value: (rec[key] as number) ?? null,
                onInput: debounce((v) => { (rec as any)[key] = v; save({ [key]: v }); }, 300) }),
              h("div", { class: "tlab" }, lab)))
        );
        editNote.textContent = "Editing — new values carry forward as your daily default.";
      } else {
        mgpsGrid.replaceChildren(...MGPS_CELLS.map(([key, lab]) => tile(lab, (rec[key] as number) ?? null)));
        editNote.textContent = "";
      }
    }
    renderMgps();
    // Long-press the readings to edit them; help chip explains it.
    longPress(mgpsGrid, () => { if (!editingMgps) { editingMgps = true; renderMgps(); toast("Editing MGPS readings", 1400); } });

    const editToggle = h("button", { class: "helptip", type: "button", style: { width: "auto", padding: "0 8px", borderRadius: "999px" },
      onClick: () => { editingMgps = !editingMgps; renderMgps(); } }, "edit");

    // ---- Section 1: prefilled / auto values (verify at a glance) ----
    const prefilled = h("div", { class: "card group" },
      h("div", { class: "group-hdr" }, h("span", {}, "Auto-filled"), h("span", { class: "group-note" }, "carried forward · tap to change")),
      field("Area of operation", areaSeg),
      field("Sea chest in use", chestSeg),
      h("div", { class: "tlabrow" },
        h("div", { class: "tlabhdr" }, "Anti-fouling MGPS (Amp)"),
        helpTip("These readings are set by the sea chest and carry forward. Long-press them (or tap ‘edit’) to change — your new values become the daily default."),
        editToggle),
      mgpsGrid,
      editNote,
      stationary
        ? h("div", {},
            h("div", { class: "tlabhdr" }, "Shaft Earthing"),
            h("div", { class: "tilegrid one" }, tile("Shaft potential", 0, "mV")),
            h("div", { class: "hint", style: { marginTop: "2px" } }, `At ${area.toLowerCase()} — shaft not turning, so 0 mV.`))
        : null,
    );

    // ---- Section 2: today's varying readings (user enters) ----
    const readings = h("div", { class: "card group" },
      h("div", { class: "group-hdr" }, h("span", {}, "Today's readings"), h("span", { class: "group-note" }, "enter values")),
      h("div", { class: "grid2" },
        rf("draft", "Draft (M)"),
        rf("seaTemp", "Sea temp (°C)")),
      h("div", { class: "tlabhdr" }, "ICCP System"),
      h("div", { class: "grid2" },
        rf("amp", "Output Amp"),
        rf("volt", "Output Volt")),
      h("div", { class: "grid2" },
        rf("cell1", "Sensing Cell 1 (mV)"),
        rf("cell2", "Sensing Cell 2 (mV)")),
      stationary ? null : h("div", {},
        h("div", { class: "tlabhdr" }, "Shaft Earthing"),
        rf("shaftMv", "Shaft potential (mV)")),
    );

    form.append(prefilled, readings);

    // If this day is already fully entered, show a persistent "completed" banner
    // at the top when re-opening it (distinct from the one-time celebration).
    const prog = progressOf(rec);
    if (prog.total > 0 && prog.done >= prog.total) {
      const when = selDate === todayIso ? "today" : `Day ${Number(selDate.slice(-2))}`;
      form.prepend(h("div", { class: "done-banner" },
        h("span", { class: "db-tick" }, "✓"),
        h("span", {}, `Entry completed for ${when}`)));
    }

    await refreshRing(false);
  }

  async function save(patch: Partial<IccpDaily>, silent = false) {
    const cur = (await db.iccpDaily.get(selDate)) ?? { date: selDate };
    await db.iccpDaily.put({ ...cur, ...patch, date: selDate });
    if (!silent) toast("Saved", 900);
  }

  // True if any key in the auto-fill patch differs from what's already stored.
  function needsAutoSave(saved: IccpDaily | undefined, patch: Partial<IccpDaily>): boolean {
    if (!saved) return true;
    return Object.entries(patch).some(([k, v]) => (saved as any)[k] !== v);
  }

  // ---- header: month chip + a compact day chip that toggles the calendar ----
  // The calendar starts collapsed so the readings get the full scroll height; the
  // day chip (the selected day number, top-right under the ring) expands it.
  let calExpanded = false;

  const dayNum = h("span", { class: "dc-n" }, "1");
  const dayChip = h("button", { class: "daychip", type: "button", "aria-label": "Show calendar",
    onClick: toggleCalendar }, dayNum, h("span", { class: "dc-cal" }, "📅"));
  function syncDayLabel() { dayNum.textContent = String(Number(selDate.slice(-2))); }

  function setCalendar(open: boolean) {
    calExpanded = open;
    dayhead.classList.toggle("cal-open", open);
    dayChip.setAttribute("aria-label", open ? "Hide calendar" : "Show calendar");
  }
  function toggleCalendar() { setCalendar(!calExpanded); }

  const monthLabel = h("div", { class: "mnum" });
  const monthChip = h("button", { class: "monthchip", type: "button", onClick: openMonthWheel }, monthLabel);
  function syncMonthLabel() {
    const { month } = ymParts(curYm);
    monthLabel.textContent = `${MONTHS_FULL[month - 1]} ${curYm.slice(0, 4)}`;
  }

  // Month wheel: months scroll, the year stays fixed beside them. Changing the
  // month rebuilds the calendar and clamps the selected day into the new month.
  function openMonthWheel() {
    const year = today.getFullYear();
    const maxM = today.getMonth() + 1; // don't allow future months
    const options = MONTHS_FULL.slice(0, maxM).map((name, i) => ({
      value: `${year}-${String(i + 1).padStart(2, "0")}`, text: name,
    }));
    wheelPicker({
      columns: [{ label: String(year), options, value: curYm }],
      onDone: ([ym]) => {
        curYm = ym; syncMonthLabel(); rebuildDays(); syncDayLabel();
        void buildCalendar(); loadDay();
      },
    });
  }

  // Switch to a specific ISO day (used by the calendar taps and swipe). Handles
  // crossing into another month and refreshes the header + calendar highlight.
  // `fromCalendar` collapses the calendar again after a pick, so the readings get
  // the full scroll height back.
  function selectDay(iso: string, opts: { buzz?: boolean; fromCalendar?: boolean } = {}) {
    const { buzz = true, fromCalendar = false } = opts;
    if (iso > todayIso) { toast("That's in the future", 1200); return; }
    if (fromCalendar) setCalendar(false);
    if (iso === selDate) return;
    const nextYm = iso.slice(0, 7);
    selDate = iso;
    if (nextYm !== curYm) { curYm = nextYm; rebuildDays(); syncMonthLabel(); void buildCalendar(); }
    syncDayLabel();
    markSelectedDay();
    loadDay();
    if (buzz && navigator.vibrate) { try { navigator.vibrate(8); } catch { /* ignore */ } }
  }

  // Move by ±1 day, crossing month boundaries within the visible year.
  function goDay(delta: number) {
    const nextIso = isoDate(new Date(parseIso(selDate).getTime() + delta * 86400000));
    selectDay(nextIso);
  }

  // ---- month calendar (day circles, coloured by area, ✓ on completed days) ----
  // Build the whole grid for the current month once; refreshCalendar() only
  // recolours/re-ticks the cells afterwards so an edit doesn't rebuild the DOM.
  const dayCells = new Map<string, HTMLButtonElement>();

  async function buildCalendar() {
    const { year, month } = ymParts(curYm);
    const dim = new Date(year, month, 0).getDate();
    // JS getDay(): 0=Sun..6=Sat. We lay the grid out Monday-first, so shift Sun
    // to the end (Mon=0 .. Sun=6) to know how many leading blanks the 1st needs.
    const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;

    const dow = h("div", { class: "cal-dow" },
      ...["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => h("span", {}, d)));
    const grid = h("div", { class: "cal-grid" });
    dayCells.clear();
    for (let i = 0; i < firstDow; i++) grid.append(h("span", { class: "cal-blank" }));
    for (let d = 1; d <= dim; d++) {
      const iso = `${curYm}-${String(d).padStart(2, "0")}`;
      const future = iso > todayIso;
      const cell = h("button", {
        class: "cal-day", type: "button", disabled: future || undefined,
        "aria-label": `Day ${d}`,
        onClick: () => selectDay(iso, { fromCalendar: true }),
      }, h("span", { class: "cd-n" }, String(d)), h("span", { class: "cd-tick" }, "✓"));
      dayCells.set(iso, cell);
      grid.append(cell);
    }

    const legend = h("div", { class: "cal-legend" },
      ...LEGEND.map(([cls, lab]) => h("span", { class: "leg" },
        h("span", { class: `leg-dot ${cls}` }), lab)),
      h("span", { class: "leg" }, h("span", { class: "leg-dot leg-done" }, "✓"), "Done"));

    calWrap.replaceChildren(dow, grid, legend);
    markSelectedDay();
    await refreshCalendar();
  }

  // Recolour each day by that day's area and add the ✓ badge to completed days.
  async function refreshCalendar() {
    if (dayCells.size === 0) return;
    const rows = await db.iccpDaily
      .where("date").between(`${curYm}-00`, `${curYm}-99`).toArray();
    const byDate = new Map(rows.map((r) => [r.date, r]));
    for (const [iso, cell] of dayCells) {
      const rec = byDate.get(iso);
      cell.classList.remove("a-sea", "a-port", "a-anchor", "done");
      const areaCls = rec?.area ? AREA_CLASS[rec.area] : null;
      if (areaCls) cell.classList.add(areaCls);
      if (isComplete(rec)) cell.classList.add("done");
    }
  }

  function markSelectedDay() {
    for (const [iso, cell] of dayCells) cell.classList.toggle("sel", iso === selDate);
  }

  // Header: month chip on the left; on the right the progress ring with the day
  // chip beneath it (tap the day number to open the calendar). The calendar sits
  // below, collapsed by default (a .cal-open class on dayhead reveals it).
  const dayhead = h("div", { class: "dayhead" },
    h("div", { class: "dh-top" },
      h("div", { class: "dh-month" }, monthChip),
      h("div", { class: "dh-right" },
        h("div", { class: "dh-ring" }, ringWrap),
        dayChip)),
    h("div", { class: "cal-collapse" }, calWrap),
  );

  mount.append(
    topbar("ICCP / MGPS Daily", "Daily readings", "/records"),
    screen(
      dayhead,
      h("div", { class: "swipehint" }, "‹ swipe an empty area to change day ›"),
      form,
      monthlyBtn
    )
  );

  // ---- swipe left/right on empty space to change day ----
  // Uses touch/pointer start+end coords. Ignores swipes that begin on an
  // interactive control (input/select/button/segment/tiles) so it never fights
  // with typing or the segmented controls, but works anywhere else on the screen.
  const view = mount.querySelector<HTMLElement>(".screen")!;
  let sx = 0, sy = 0, tracking = false;
  const startsOnControl = (t: EventTarget | null) =>
    (t as HTMLElement | null)?.closest?.("input, select, textarea, button, .seg, .tilegrid");
  const onStart = (x: number, y: number, t: EventTarget | null) => {
    if (startsOnControl(t)) { tracking = false; return; }
    sx = x; sy = y; tracking = true;
  };
  const onEnd = (x: number, y: number) => {
    if (!tracking) return;
    tracking = false;
    const dx = x - sx, dy = y - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      goDay(dx < 0 ? 1 : -1); // swipe left -> next day, right -> previous day
    }
  };
  view.addEventListener("touchstart", (e) => {
    const t = e.touches[0]; onStart(t.clientX, t.clientY, e.target);
  }, { passive: true });
  view.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0]; onEnd(t.clientX, t.clientY);
  }, { passive: true });
  // Pointer fallback for desktop / mouse-drag testing.
  view.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") onStart(e.clientX, e.clientY, e.target); });
  view.addEventListener("pointerup", (e) => { if (e.pointerType !== "touch") onEnd(e.clientX, e.clientY); });

  rebuildDays();
  syncDayLabel();
  syncMonthLabel();
  await buildCalendar();
  await loadDay();
}

async function openMonthly(curYm: string) {
  const mount = document.getElementById("view")!;
  mount.replaceChildren();
  const { year, month } = ymParts(curYm);
  const weeks = Math.max(1, saturdaysInMonth(year, month).length);
  const rec = (await db.iccpMonthly.get(curYm)) ?? { ym: curYm };
  const obs = rec.obs ?? {};
  const slip = rec.slipring ?? [];

  const OBS_ROWS: [string, string][] = [
    ["foulingStrainer", "Fouling in Strainer"],
    ["foulingPipeline", "Fouling in Pipeline"],
    ["foulingHeatExch", "Fouling in Heat Exch."],
    ["corrosionStrainer", "Corrosion in Strainer"],
    ["corrosionPipeline", "Corrosion in Pipeline"],
    ["corrosionHeatExch", "Corrosion in Heat Exch."],
  ];
  const LEVELS = ["Nil", "Light", "Medium", "Heavy"];

  const ringWrap = h("div", {});
  let lastComplete = false;
  async function refreshRing(fire: boolean) {
    const o = (await db.iccpMonthly.get(curYm))?.obs ?? {};
    const done = OBS_ROWS.filter(([k]) => o[k]).length;
    ringWrap.replaceChildren(progressRing(done, OBS_ROWS.length, "left"));
    const complete = done >= OBS_ROWS.length;
    if (fire && complete && !lastComplete) achievement("Monthly footer complete!", "ICCP observations recorded");
    lastComplete = complete;
  }

  async function save(patch: any) {
    const cur = (await db.iccpMonthly.get(curYm)) ?? { ym: curYm };
    await db.iccpMonthly.put({ ...cur, ...patch, ym: curYm });
  }

  const obsEls = OBS_ROWS.map(([key, label]) => {
    const sel = h("select", { onChange: async (e: Event) => {
      const o = { ...(await db.iccpMonthly.get(curYm))?.obs, [key]: (e.target as HTMLSelectElement).value || null };
      await save({ obs: o });
      await refreshRing(true);
    } },
      h("option", { value: "", selected: !obs[key] }, "—"),
      ...LEVELS.map((l) => h("option", { value: l, selected: obs[key] === l }, l)));
    return h("label", { class: "field" }, h("span", { class: "lab" }, label), sel);
  });

  // One slipring week per Saturday in the month; blank weeks fall back to a
  // stable 15–20 mV prefill (shown as placeholder, used on export).
  const slipEls = Array.from({ length: weeks }, (_, i) =>
    h("label", { class: "field" }, h("span", { class: "lab" }, `Slipring week ${i + 1} (mV)`),
      numInput({ value: slip[i] ?? null, placeholder: String(slipringDefault(curYm, i)),
        onInput: debounce(async (nv) => {
          const cur = (await db.iccpMonthly.get(curYm))?.slipring ?? [];
          while (cur.length < weeks) cur.push(null);
          cur[i] = nv; await save({ slipring: cur });
        }, 350) })));

  const strainerInp = h("input", { value: rec.strainerNote ?? "", placeholder: "Strainer inspected LOW: … HIGH: …",
    onInput: debounce((e: Event) => save({ strainerNote: (e.target as HTMLInputElement).value }), 400) });
  const remarkInp = h("textarea", { rows: 3, value: rec.remark ?? "", placeholder: "Remark",
    onInput: debounce((e: Event) => save({ remark: (e.target as HTMLTextAreaElement).value }), 400) });

  mount.append(
    topbar("ICCP Monthly Footer", curYm, "/rec/iccp"),
    screen(
      toolbar(h("span", { class: "progress" }, "Observations"), ringWrap),
      h("h2", { style: { marginLeft: 0 } }, "Observations"),
      ...obsEls,
      h("label", { class: "field" }, h("span", { class: "lab" }, "Strainer inspection note"), strainerInp),
      h("h2", { style: { marginLeft: 0 } }, "Slipring checks"),
      h("p", { class: "hint", style: { marginTop: "-4px" } }, `${weeks} week${weeks > 1 ? "s" : ""} this month. Blank weeks use a 15–20 mV default.`),
      ...slipEls,
      h("label", { class: "field" }, h("span", { class: "lab" }, "Remark"), remarkInp)
    )
  );
  await refreshRing(false);
}
