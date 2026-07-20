import { h, topbar, screen, numInput, toast } from "../ui";
import { db, type IccpDaily } from "../db";
import { isoDate, defaultReportYm, ymParts, debounce, parseIso } from "../util";
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

export async function renderIccp(_p: Record<string, string>, mount: HTMLElement) {
  const today = new Date();
  let curYm = isoDate(today).startsWith(defaultReportYm()) ? defaultReportYm() : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  // default to current month for daily entry
  curYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  let selDate = isoDate(today);

  const daySelect = h("select", {});
  const form = h("div", {});
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

  async function loadDay() {
    const saved = await db.iccpDaily.get(selDate);
    const prevDate = isoDate(new Date(parseIso(selDate).getTime() - 86400000));
    const prev = await db.iccpDaily.get(prevDate);

    // Effective values shown to the user: saved value first, else carried
    // forward from the previous day, else a sensible default. These "guessed"
    // slow-changing fields are persisted so exports have them without the user
    // re-entering anything each day.
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
      cu1: saved?.cu1 ?? mgps.cu1,
      al1: saved?.al1 ?? mgps.al1,
      cu2: saved?.cu2 ?? mgps.cu2,
      al2: saved?.al2 ?? mgps.al2,
      shaftMv: stationary ? 0 : saved?.shaftMv,
      seaTemp: saved?.seaTemp,
      amp: saved?.amp,
      volt: saved?.volt,
      cell1: saved?.cell1,
      cell2: saved?.cell2,
    };

    // Persist the auto-filled slow-changing fields on first visit / when they
    // were just derived (so a day the user only glances at still exports right).
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
        onInput: debounce((v) => save({ [key]: v }), 300),
      });

    // Segmented control — big tappable choices instead of a tiny dropdown.
    const segment = (opts: string[], current: string, onPick: (v: string) => void) =>
      h("div", { class: "seg big" },
        ...opts.map((o) => h("button", { type: "button", class: o === current ? "active" : "",
          onClick: () => { if (o !== current) onPick(o); } }, o)));

    const areaSeg = segment(AREAS, area, async (v) => { await save({ area: v }); await loadDay(); });
    // Changing the sea chest re-derives the MGPS readings, so clear the old
    // auto-filled cu/al before reloading (loadDay only fills when unset).
    const chestSeg = segment(SEA_CHESTS, seaChest, async (v) => {
      await save({ seaChest: v, cu1: undefined, al1: undefined, cu2: undefined, al2: undefined });
      await loadDay();
    });

    // Read-only tile showing an auto-derived value (MGPS + locked shaft).
    const tile = (lab: string, val: number | null, unit?: string) =>
      h("div", { class: "tile" },
        h("div", { class: "tval" }, val == null ? "—" : String(val), unit ? h("span", { class: "tunit" }, unit) : null),
        h("div", { class: "tlab" }, lab));

    // ---- Section 1: prefilled / auto values (verify at a glance) ----
    const prefilled = h("div", { class: "card group" },
      h("div", { class: "group-hdr" }, h("span", {}, "Auto-filled"), h("span", { class: "group-note" }, "carried forward · tap to change")),
      field("Area of operation", areaSeg),
      field("Sea chest in use", chestSeg),
      h("div", { class: "tlabhdr" }, "Anti-fouling MGPS (Amp)"),
      h("div", { class: "tilegrid" },
        tile("CU 1", rec.cu1 ?? null), tile("AL 1", rec.al1 ?? null),
        tile("CU 2", rec.cu2 ?? null), tile("AL 2", rec.al2 ?? null)),
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
        h("span", { class: "progress" }, "Day")
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
  const rec = (await db.iccpMonthly.get(curYm)) ?? { ym: curYm };
  const obs = rec.obs ?? {};
  const slip = rec.slipring ?? [null, null, null, null, null];

  const OBS_ROWS: [string, string][] = [
    ["foulingStrainer", "Fouling in Strainer"],
    ["foulingPipeline", "Fouling in Pipeline"],
    ["foulingHeatExch", "Fouling in Heat Exch."],
    ["corrosionStrainer", "Corrosion in Strainer"],
    ["corrosionPipeline", "Corrosion in Pipeline"],
    ["corrosionHeatExch", "Corrosion in Heat Exch."],
  ];
  const LEVELS = ["Nil", "Light", "Medium", "Heavy"];

  async function save(patch: any) {
    const cur = (await db.iccpMonthly.get(curYm)) ?? { ym: curYm };
    await db.iccpMonthly.put({ ...cur, ...patch, ym: curYm });
  }

  const obsEls = OBS_ROWS.map(([key, label]) => {
    const sel = h("select", { onChange: async (e: Event) => {
      const o = { ...(await db.iccpMonthly.get(curYm))?.obs, [key]: (e.target as HTMLSelectElement).value || null };
      await save({ obs: o });
    } },
      h("option", { value: "", selected: !obs[key] }, "—"),
      ...LEVELS.map((l) => h("option", { value: l, selected: obs[key] === l }, l)));
    return h("label", { class: "field" }, h("span", { class: "lab" }, label), sel);
  });

  const slipEls = slip.map((v: number | null, i: number) =>
    h("label", { class: "field" }, h("span", { class: "lab" }, `Slipring week ${i + 1} (mV)`),
      numInput({ value: v, onInput: debounce(async (nv) => {
        const cur = (await db.iccpMonthly.get(curYm))?.slipring ?? [null, null, null, null, null];
        cur[i] = nv; await save({ slipring: cur });
      }, 350) })));

  const strainerInp = h("input", { value: rec.strainerNote ?? "", placeholder: "Strainer inspected LOW: … HIGH: …",
    onInput: debounce((e: Event) => save({ strainerNote: (e.target as HTMLInputElement).value }), 400) });
  const remarkInp = h("textarea", { rows: 3, value: rec.remark ?? "", placeholder: "Remark",
    onInput: debounce((e: Event) => save({ remark: (e.target as HTMLTextAreaElement).value }), 400) });

  mount.append(
    topbar("ICCP Monthly Footer", curYm, "/rec/iccp"),
    screen(
      h("h2", { style: { marginLeft: 0 } }, "Observations"),
      ...obsEls,
      h("label", { class: "field" }, h("span", { class: "lab" }, "Strainer inspection note"), strainerInp),
      h("h2", { style: { marginLeft: 0 } }, "Slipring checks"),
      ...slipEls,
      h("label", { class: "field" }, h("span", { class: "lab" }, "Remark"), remarkInp)
    )
  );
}
