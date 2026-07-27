import { h, topbar, screen, numInput, readingField, toast, segmented, progressRing, achievement, helpTip, longPress, navigate, confirmDialog, doneBar, type ReadingSpec } from "../ui";
import { db, type IccpDaily } from "../db";
import { isoDate, ymParts, debounce, parseIso, saturdaysInMonth, slipringDefault, MONTHS_FULL, DOW_SHORT } from "../util";
import { periodHead, bindHeadGestures } from "./periodhead";

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
  // Two digits, so a single keystroke never counts as "finished" and drops the
  // keyboard while the user is still typing (e.g. 8 on the way to 18).
  shaftMv: { min: 0,    max: 50,   decimals: 0, intDigits: 2, allowOverride: true, warn: "Shaft potential > 50 mV — check your reading again and the shaft earthing / bonding. You can still keep this value if it's correct." },
};

// Count of today's reading fields already filled (for the progress ring and the
// calendar's "done" tick). A reading counts once a number is present. Values
// outside the expected band still count: they're flagged red inline, and the
// user is asked to confirm them when the day completes — blocking completion
// instead would strand anyone whose genuine reading is out of the usual range.
// Shaft potential only counts when the ship is under way.
function progressOf(saved: IccpDaily | undefined): { done: number; total: number } {
  const area = saved?.area ?? "Sea";
  const stationary = STATIONARY.has(area);
  const keys = stationary ? READING_KEYS : [...READING_KEYS, "shaftMv" as keyof IccpDaily];
  const done = keys.filter((k) => typeof saved?.[k] === "number").length;
  return { done, total: keys.length };
}

function isComplete(saved: IccpDaily | undefined): boolean {
  const { done, total } = progressOf(saved);
  return total > 0 && done >= total;
}

/** Human labels for the confirm dialog listing out-of-range readings. */
const FIELD_LABEL: Partial<Record<keyof IccpDaily, string>> = {
  draft: "Draft", seaTemp: "Sea temp", cell1: "Sensing Cell 1", cell2: "Sensing Cell 2",
  amp: "Output Amp", volt: "Output Volt", shaftMv: "Shaft potential",
};

/**
 * Readings that are present but sit outside their normal range. These don't
 * block entry, but the user is asked to confirm them once the day is otherwise
 * complete — so an obvious typo is caught before the day is marked done.
 */
function outOfRangeReadings(saved: IccpDaily | undefined): { label: string; value: number }[] {
  if (!saved) return [];
  const out: { label: string; value: number }[] = [];
  for (const [key, spec] of Object.entries(SPECS) as [keyof IccpDaily, ReadingSpec][]) {
    const v = saved[key];
    if (typeof v !== "number") continue;
    if (v >= spec.min && v <= spec.max) continue;
    out.push({ label: FIELD_LABEL[key] ?? String(key), value: v });
  }
  return out;
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
  // Days the user has confirmed with the Done button in this visit, so leaving
  // and coming back to a finished day doesn't re-offer it.
  const confirmed = new Set<string>();
  // Offered once every reading is present; the celebration only fires when the
  // user taps it. Nothing on this screen auto-completes.
  const done = doneBar({ label: "Done", onDone: () => { confirmed.add(selDate); void celebrate(); } });
  const calWrap = h("div", { class: "cal" });
  const monthlyBtn = h("button", { class: "btn ghost", style: { marginTop: "16px" },
    onClick: () => navigate(`/rec/iccp-monthly/${curYm}`) },
    "Monthly footer (observations, slipring, remark)");

  // Keep the selected day inside the current month (clamp when the month changes).
  function rebuildDays() {
    if (!selDate.startsWith(curYm)) selDate = `${curYm}-01`;
  }

  /**
   * The user tapped Done. Confirm any out-of-range readings, then celebrate.
   * Only ever reached from an explicit tap — never from typing a last digit.
   */
  async function celebrate() {
    const saved = await db.iccpDaily.get(selDate);
    const when = selDate === todayIso ? "today" : `Day ${Number(selDate.slice(-2))}`;
    const odd = outOfRangeReadings(saved);
    // The day is filled, but some readings sit outside their normal band. Ask
    // once before marking it done, so a mistyped figure gets caught.
    if (odd.length) {
      const list = h("div", { class: "oor-list" },
        ...odd.map((o) => h("div", { class: "oor-item" },
          h("span", { class: "oor-lab" }, o.label),
          h("span", { class: "oor-val" }, String(o.value)))));
      const ok = await confirmDialog({
        title: odd.length > 1 ? "Readings are out of range" : "Reading is out of range",
        body: h("div", {},
          h("div", {}, "These are outside the normal range for this vessel:"),
          list,
          h("div", {}, "Submit them anyway?")),
        confirm: "Yes, submit",
        cancel: "Go back",
      });
      // Rejected — let the user fix it and offer Done again.
      if (!ok) { confirmed.delete(selDate); void refreshRing(true); return; }
    }
    achievement("Entry completed!", `ICCP / MGPS saved for ${when}`);
  }

  /**
   * Repaint the ring + calendar, and decide whether to offer the Done button.
   *
   * `offerDone` is false on a plain re-render (opening a day) so the bar doesn't
   * slide up just for looking at a finished day — it's offered in response to
   * the user actually entering the readings.
   */
  async function refreshRing(offerDone: boolean) {
    const saved = await db.iccpDaily.get(selDate);
    const { done: filled, total } = progressOf(saved);
    ringWrap.replaceChildren(progressRing(filled, total, "left"));
    const complete = total > 0 && filled >= total;
    // Keep the calendar's colour + done-tick for this day in sync after an edit.
    void refreshCalendar();
    // All readings in and not yet confirmed → offer Done (after its own delay,
    // so it never covers the keyboard mid-typing). Anything missing → withdraw.
    if (complete && offerDone && !confirmed.has(selDate)) done.arm();
    else if (!complete) done.disarm();
    lastComplete = complete;
  }

  async function loadDay() {
    editingMgps = false;
    // Switching day must never carry a pending Done offer across to the new one.
    done.reset();
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

    // A full reading field (label + validated input + inline warning line).
    // Focus is never moved for the user: they tab or tap to the next field
    // themselves, so the keyboard stays put until they are finished.
    const rf = (key: keyof IccpDaily, label: string) => {
      const { wrap } = readingField(label, {
        value: (rec[key] as number) ?? null,
        placeholder: prev?.[key] != null ? String(prev[key]) : "",
        spec: SPECS[key],
        big: true,
        onInput: debounce(async (v) => { await save({ [key]: v }); await refreshRing(true); }, 300),
        // "Use anyway" on an out-of-range override field (shaft): keep the value
        // and let the Done button be offered.
        onOverride: () => { void refreshRing(true); },
      });
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

  // ---- header: the shared one-line period header ----
  // Month chip · day chip · progress ring all share a single row; the calendar
  // lives in the collapsible panel underneath. Pull down at the top to open it.
  const head = periodHead({
    ym: curYm,
    open: false,
    onMonth: (ym) => {
      curYm = ym; rebuildDays(); syncDayLabel();
      void buildCalendar(); loadDay();
    },
  });

  const dayDow = h("span", { class: "dc-dow" }, "");
  const dayNum = h("span", { class: "dc-n" }, "1");
  const dayChip = h("button", { class: "daychip", type: "button", "aria-label": "Show calendar",
    onClick: () => head.toggle() }, dayDow, dayNum);
  function syncDayLabel() {
    dayNum.textContent = String(Number(selDate.slice(-2)));
    dayDow.textContent = DOW_SHORT[parseIso(selDate).getDay()];
    dayChip.classList.toggle("is-today", selDate === todayIso);
  }

  // Closing after a day pick is a deliberate choice: it should stay closed while
  // the user enters the readings, and not spring back when they scroll up.
  function setCalendar(open: boolean) { open ? head.setOpen(true) : head.closeByUser(); }

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
    if (nextYm !== curYm) { curYm = nextYm; rebuildDays(); head.syncMonth(curYm); void buildCalendar(); }
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
  const legendCounts = new Map<string, HTMLElement>();

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

    legendCounts.clear();
    const legend = h("div", { class: "cal-legend" },
      ...LEGEND.map(([cls, lab]) => {
        const count = h("span", { class: "leg-count" }, "0 days");
        legendCounts.set(cls, count);
        return h("div", { class: "leg" },
          h("div", { class: "leg-head" }, h("span", { class: `leg-dot ${cls}` }), lab),
          count);
      }),
      h("div", { class: "leg" },
        h("div", { class: "leg-head" }, h("span", { class: "leg-dot leg-done" }, "✓"), "Done")));

    // Grid on the left, legend down the right — see `.cal` in style.css.
    calWrap.replaceChildren(h("div", { class: "cal-main" }, dow, grid), legend);
    markSelectedDay();
    await refreshCalendar();
  }

  // Recolour each day by that day's area and add the ✓ badge to completed days.
  async function refreshCalendar() {
    if (dayCells.size === 0) return;
    const rows = await db.iccpDaily
      .where("date").between(`${curYm}-00`, `${curYm}-99`).toArray();
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const tally = new Map<string, number>();
    for (const [iso, cell] of dayCells) {
      const rec = byDate.get(iso);
      cell.classList.remove("a-sea", "a-port", "a-anchor", "done");
      const areaCls = rec?.area ? AREA_CLASS[rec.area] : null;
      if (areaCls) {
        cell.classList.add(areaCls);
        tally.set(areaCls, (tally.get(areaCls) ?? 0) + 1);
      }
      if (isComplete(rec)) cell.classList.add("done");
    }
    for (const [cls, el] of legendCounts) {
      const n = tally.get(cls) ?? 0;
      el.textContent = `${n} day${n === 1 ? "" : "s"}`;
    }
  }

  function markSelectedDay() {
    for (const [iso, cell] of dayCells) cell.classList.toggle("sel", iso === selDate);
  }

  // Assemble the shared header: day chip in the middle slot, ring on the right,
  // calendar in the collapsible panel.
  head.slot.append(dayChip);
  head.right.append(ringWrap);
  head.panel.append(calWrap);

  mount.append(
    topbar("ICCP / MGPS Daily", "Daily readings", "/records"),
    screen(
      head.el,
      h("div", { class: "ph-pull" }, "‹ swipe to change day · pull down for calendar ›"),
      form,
      monthlyBtn,
      done.el
    )
  );

  // Standard gestures: pull down at the top opens the calendar, scrolling
  // collapses it, and a horizontal swipe steps the day.
  const view = mount.querySelector<HTMLElement>(".screen")!;
  bindHeadGestures(view, head, { onSwipeX: (dir) => goDay(dir) });

  rebuildDays();
  syncDayLabel();
  head.syncMonth(curYm);
  await buildCalendar();
  await loadDay();
}

/**
 * ICCP monthly footer — the observations / slipring / remark block that goes at
 * the bottom of the exported sheet. Routed at /rec/iccp-monthly/:ym so the back
 * button and the browser history behave.
 */
export async function renderIccpMonthly(p: Record<string, string>, mount: HTMLElement) {
  const curYm = p.ym || isoDate(new Date()).slice(0, 7);
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

  // Each observation is a row of tappable level chips rather than a dropdown —
  // one tap to set, and the whole month's answers are readable at a glance.
  const obsEls = OBS_ROWS.map(([key, label]) => {
    const chips = LEVELS.map((lvl) => {
      const btn = h("button", { type: "button", class: `lvl lvl-${lvl.toLowerCase()}${obs[key] === lvl ? " on" : ""}` }, lvl);
      btn.addEventListener("click", async () => {
        const cur = (await db.iccpMonthly.get(curYm))?.obs ?? {};
        // Tapping the active chip clears it, so a mis-tap is easy to undo.
        const next = cur[key] === lvl ? null : lvl;
        await save({ obs: { ...cur, [key]: next } });
        chips.forEach((c, i) => c.classList.toggle("on", next === LEVELS[i]));
        await refreshRing(true);
      });
      return btn;
    });
    return h("div", { class: "obs-row" },
      h("div", { class: "obs-lab" }, label),
      h("div", { class: "lvlrow" }, ...chips));
  });

  // One slipring week per Saturday in the month; blank weeks fall back to a
  // stable 15–20 mV prefill (shown as placeholder, used on export).
  const slipEls = Array.from({ length: weeks }, (_, i) =>
    h("label", { class: "field" }, h("span", { class: "lab" }, `Week ${i + 1} (mV)`),
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
      h("div", { class: "mf-head" },
        h("div", { class: "mf-headtxt" },
          h("div", { class: "mf-title" }, "Observations"),
          h("div", { class: "hint" }, "Tap a level for each item. Tap again to clear.")),
        ringWrap),
      h("div", { class: "card group" }, ...obsEls),
      h("div", { class: "card group" },
        h("div", { class: "group-hdr" }, h("span", {}, "Strainer inspection")),
        h("label", { class: "field" },
          h("span", { class: "lab" }, "Inspection note"), strainerInp)),
      h("div", { class: "card group" },
        h("div", { class: "group-hdr" },
          h("span", {}, "Slipring checks"),
          h("span", { class: "group-note" }, `${weeks} week${weeks > 1 ? "s" : ""}`)),
        h("p", { class: "hint", style: { margin: "0 0 10px" } }, "Blank weeks use a 15–20 mV default on export."),
        h("div", { class: "grid2" }, ...slipEls)),
      h("div", { class: "card group" },
        h("div", { class: "group-hdr" }, h("span", {}, "Remark")),
        h("label", { class: "field" }, remarkInp))
    )
  );
  await refreshRing(false);
}
