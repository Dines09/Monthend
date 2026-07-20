import { h, topbar, screen, numInput, toast, segmented, progressRing, achievement, helpTip, longPress } from "../ui";
import { db, type IccpDaily } from "../db";
import { isoDate, defaultReportYm, ymParts, debounce, parseIso, saturdaysInMonth, slipringDefault } from "../util";
import { monthPicker, toolbar } from "./parts";

const AREAS = ["Sea", "Port", "Anchor"];
const SEA_CHESTS = ["P", "S", "P/S"];

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

export async function renderIccp(_p: Record<string, string>, mount: HTMLElement) {
  const today = new Date();
  const todayIso = isoDate(today);
  // default to current month for daily entry
  let curYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  let selDate = todayIso;
  let editingMgps = false;
  let lastComplete = false;

  const daySelect = h("select", { class: "dayselect" });
  const form = h("div", {});
  const ringWrap = h("div", {});
  const monthlyBtn = h("button", { class: "btn ghost", style: { marginTop: "16px" }, onClick: () => openMonthly(curYm) }, "Monthly footer (observations, slipring, remark)");

  function rebuildDays() {
    daySelect.replaceChildren();
    const { year, month } = ymParts(curYm);
    const dim = new Date(year, month, 0).getDate();
    for (let d = 1; d <= dim; d++) {
      const iso = `${curYm}-${String(d).padStart(2, "0")}`;
      daySelect.append(h("option", { value: iso, selected: iso === selDate }, `Day ${d}`));
    }
    if (!selDate.startsWith(curYm)) { selDate = `${curYm}-01`; daySelect.value = selDate; }
  }

  // Count of today's reading fields already filled (for the progress ring).
  function progressOf(saved: IccpDaily | undefined): { done: number; total: number } {
    const area = saved?.area ?? "Sea";
    const stationary = STATIONARY.has(area);
    const keys = stationary ? READING_KEYS : [...READING_KEYS, "shaftMv" as keyof IccpDaily];
    const done = keys.filter((k) => saved?.[k] != null).length;
    return { done, total: keys.length };
  }

  async function refreshRing(fireOnComplete: boolean) {
    const saved = await db.iccpDaily.get(selDate);
    const { done, total } = progressOf(saved);
    ringWrap.replaceChildren(progressRing(done, total, "left"));
    const complete = total > 0 && done >= total;
    if (fireOnComplete && complete && !lastComplete) {
      const when = selDate === todayIso ? "today" : `Day ${Number(selDate.slice(-2))}`;
      // Dismiss the on-screen keyboard first, then celebrate ~1.3s later so the
      // tick lands centered instead of being shoved up by the keyboard.
      (document.activeElement as HTMLElement | null)?.blur?.();
      setTimeout(() => achievement("Entry completed!", `ICCP / MGPS saved for ${when}`), 1300);
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
    const nf = (key: keyof IccpDaily) =>
      numInput({
        value: (rec[key] as number) ?? null,
        placeholder: prev?.[key] != null ? String(prev[key]) : "",
        onInput: debounce(async (v) => { await save({ [key]: v }); await refreshRing(true); }, 300),
      });

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
        field("Draft (M)", nf("draft")),
        field("Sea temp (°C)", nf("seaTemp"))),
      h("div", { class: "tlabhdr" }, "ICCP System"),
      h("div", { class: "grid2" },
        field("Output Amp", nf("amp")),
        field("Output Volt", nf("volt"))),
      h("div", { class: "grid2" },
        field("Sensing Cell 1 (mV)", nf("cell1")),
        field("Sensing Cell 2 (mV)", nf("cell2"))),
      stationary ? null : h("div", {},
        h("div", { class: "tlabhdr" }, "Shaft Earthing"),
        field("Shaft potential (mV)", nf("shaftMv"))),
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

  daySelect.addEventListener("change", () => { selDate = daySelect.value; loadDay(); });

  mount.append(
    topbar("ICCP / MGPS Daily", "Daily readings", "/records"),
    screen(
      toolbar(
        monthPicker(curYm, (v) => { curYm = v; rebuildDays(); loadDay(); }, today.getFullYear()),
        ringWrap
      ),
      daySelect,
      h("div", { style: { height: "12px" } }),
      form,
      monthlyBtn
    )
  );
  rebuildDays();
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
