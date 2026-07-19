import { h, topbar, screen, numInput, toast } from "../ui";
import { db, type IccpDaily } from "../db";
import { isoDate, defaultReportYm, ymParts, debounce, parseIso } from "../util";
import { monthPicker, toolbar } from "./parts";

const AREAS = ["Sea", "Port", "Anchor"];

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
      daySelect.append(h("option", { value: iso, selected: iso === selDate }, `Day ${d} · ${iso}`));
    }
    if (!selDate.startsWith(curYm)) { selDate = `${curYm}-01`; daySelect.value = selDate; }
  }

  async function loadDay() {
    const rec = (await db.iccpDaily.get(selDate)) ?? { date: selDate };
    const prevDate = isoDate(new Date(parseIso(selDate).getTime() - 86400000));
    const prev = await db.iccpDaily.get(prevDate);
    form.replaceChildren();

    const field = (lab: string, node: Node) => h("label", { class: "field" }, h("span", { class: "lab" }, lab), node);
    const nf = (key: keyof IccpDaily, ph?: string) =>
      numInput({ value: (rec[key] as number) ?? null, placeholder: ph ?? (prev?.[key] != null ? String(prev[key]) : ""),
        onInput: debounce((v) => save({ [key]: v }), 300) });

    const areaSel = h("select", { onChange: (e: Event) => save({ area: (e.target as HTMLSelectElement).value }) },
      h("option", { value: "", selected: !rec.area }, "—"),
      ...AREAS.map((a) => h("option", { value: a, selected: rec.area === a }, a)));
    const seaChestSel = h("select", { onChange: (e: Event) => save({ seaChest: (e.target as HTMLSelectElement).value }) },
      h("option", { value: "", selected: !rec.seaChest }, "—"),
      ...["P", "S", "P/S"].map((a) => h("option", { value: a, selected: rec.seaChest === a }, a)));

    form.append(
      h("div", { class: "grid2" },
        field("Area of operation", areaSel),
        field("Draft (M)", nf("draft"))),
      h("div", { class: "grid2" },
        field("Sea temp (°C)", nf("seaTemp")),
        field("Sea chest in use", seaChestSel)),
      h("h2", { style: { marginLeft: 0 } }, "ICCP System"),
      h("div", { class: "grid2" },
        field("Output Amp", nf("amp")),
        field("Output Volt", nf("volt"))),
      h("div", { class: "grid2" },
        field("Sensing Cell 1 (mV)", nf("cell1")),
        field("Sensing Cell 2 (mV)", nf("cell2"))),
      h("h2", { style: { marginLeft: 0 } }, "Anti-fouling MGPS (Amp)"),
      h("div", { class: "grid2" },
        field("CU1", nf("cu1")), field("AL1", nf("al1"))),
      h("div", { class: "grid2" },
        field("CU2", nf("cu2")), field("AL2", nf("al2"))),
      h("h2", { style: { marginLeft: 0 } }, "Shaft Earthing"),
      field("Shaft potential (mV)", nf("shaftMv"))
    );
  }

  async function save(patch: Partial<IccpDaily>) {
    const cur = (await db.iccpDaily.get(selDate)) ?? { date: selDate };
    await db.iccpDaily.put({ ...cur, ...patch, date: selDate });
    toast("Saved", 900);
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
