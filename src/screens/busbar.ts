import { h, topbar, screen, numInput, toast } from "../ui";
import { db } from "../db";
import { masters } from "../seed";
import { ym as ymOf, defaultReportYm, debounce } from "../util";
import { monthPicker, toolbar, progressLabel } from "./parts";

const PHASES: ("U" | "V" | "W")[] = ["U", "V", "W"];
const PHASE_LABEL: Record<string, string> = { U: "Black U", V: "White V", W: "Red W" };

export async function renderBusbar(_p: Record<string, string>, mount: HTMLElement) {
  let curYm = defaultReportYm();

  const body = h("div", {});
  const prog = h("span", { class: "progress" });

  async function load() {
    body.replaceChildren();
    const rows = await db.busbar.where("ym").equals(curYm).toArray();
    const prevYm = shiftYm(curYm, -1);
    const prev = await db.busbar.where("ym").equals(prevYm).toArray();
    const valMap = new Map(rows.map((r) => [`${r.panelRow}:${r.phase}`, r.value]));
    const prevMap = new Map(prev.map((r) => [`${r.panelRow}:${r.phase}`, r.value]));
    const meta = await db.busbarMeta.get(curYm);

    let filled = 0;
    const total = masters.busbarPanels.length * 3;

    // ECR + check date meta card
    const checkDateInp = h("input", { type: "date", value: meta?.checkDate ?? "" ,
      onChange: async (e: Event) => { await db.busbarMeta.put({ ym: curYm, checkDate: (e.target as HTMLInputElement).value || undefined, ecr: (await db.busbarMeta.get(curYm))?.ecr }); toast("Saved"); }});
    const ecrInp = numInput({ value: meta?.ecr ?? null, placeholder: "ECR °C",
      onInput: debounce(async (v) => { const m = await db.busbarMeta.get(curYm); await db.busbarMeta.put({ ym: curYm, checkDate: m?.checkDate, ecr: v ?? undefined }); }, 400) });
    body.append(
      h("div", { class: "card" },
        h("label", { class: "field" }, h("span", { class: "lab" }, "Date of check"), checkDateInp),
        h("label", { class: "field", style: { marginBottom: "0" } }, h("span", { class: "lab" }, "ECR Temperature (°C)"), ecrInp))
    );

    for (const p of masters.busbarPanels) {
      const rowsEls: Node[] = [];
      for (const ph of PHASES) {
        const key = `${p.row}:${ph}`;
        const val = valMap.get(key);
        if (val != null) filled++;
        const prevVal = prevMap.get(key);
        const inp = numInput({
          value: val ?? null,
          placeholder: prevVal != null ? String(prevVal) : "",
          onInput: debounce(async (v) => {
            await saveBusbar(curYm, p.row, ph, v);
            recount();
          }, 350),
        });
        rowsEls.push(
          h("div", { class: "mrow filled", style: { border: "none", background: "transparent", padding: "4px 0", margin: 0 } },
            h("div", { class: "mname" }, PHASE_LABEL[ph]),
            inp)
        );
      }
      body.append(
        h("div", { class: "card" },
          h("div", { style: { fontWeight: "700", marginBottom: "8px" } }, `${p.name}`,
            p.load ? h("span", { style: { color: "var(--muted)", fontWeight: "400", fontSize: "13px" } }, `  (${p.load} KW)`) : null),
          ...rowsEls)
      );
    }
    prog.textContent = `${filled}/${total} phases`;

    async function recount() {
      const r = await db.busbar.where("ym").equals(curYm).count();
      prog.textContent = `${r}/${total} phases`;
    }
  }

  mount.append(
    topbar("Busbar Temp", "TEC(A) 16", "/records"),
    screen(
      toolbar(monthPicker(curYm, (v) => { curYm = v; load(); }), prog),
      h("p", { class: "hint" }, "Placeholder shows last month's value. 8 panels × 3 phases + ECR temp."),
      body
    )
  );
  await load();
}

async function saveBusbar(ymStr: string, panelRow: number, phase: "U" | "V" | "W", v: number | null) {
  const existing = await db.busbar.where("[ym+panelRow+phase]").equals([ymStr, panelRow, phase]).first();
  if (v == null) {
    if (existing?.id) await db.busbar.delete(existing.id);
    return;
  }
  if (existing?.id) await db.busbar.update(existing.id, { value: v });
  else await db.busbar.add({ ym: ymStr, panelRow, phase, value: v });
}

function shiftYm(ymStr: string, delta: number): string {
  const [y, m] = ymStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return ymOf(d);
}
