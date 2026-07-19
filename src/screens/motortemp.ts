import { h, topbar, screen, numInput } from "../ui";
import { db } from "../db";
import { masters } from "../seed";
import { ym as ymOf, defaultReportYm, debounce } from "../util";
import { monthPicker, toolbar } from "./parts";

export async function renderMotorTemp(_p: Record<string, string>, mount: HTMLElement) {
  let curYm = defaultReportYm();
  let filter = "";
  const listEl = h("div", {});
  const prog = h("span", { class: "progress" });

  async function load() {
    const rows = await db.motorTemp.where("ym").equals(curYm).toArray();
    const prev = await db.motorTemp.where("ym").equals(shiftYm(curYm, -1)).toArray();
    const valMap = new Map(rows.map((r) => [r.motorRow, r.temp]));
    const prevMap = new Map(prev.map((r) => [r.motorRow, r.temp]));
    const erRow = await db.motorErTemp.get(`motortemp:${curYm}`);
    render(valMap, prevMap, erRow?.value ?? null);
  }

  function render(valMap: Map<number, number>, prevMap: Map<number, number>, erVal: number | null) {
    listEl.replaceChildren();

    // E/R temp
    const erInp = numInput({ value: erVal, placeholder: "°C",
      onInput: debounce(async (v) => {
        if (v == null) await db.motorErTemp.delete(`motortemp:${curYm}`);
        else await db.motorErTemp.put({ key: `motortemp:${curYm}`, ym: curYm, source: "motortemp", value: v });
      }, 350) });
    listEl.append(
      h("div", { class: "card", style: { background: "var(--accent-d)" } },
        h("label", { class: "field", style: { marginBottom: 0 } },
          h("span", { class: "lab" }, "Engine Room Temperature (°C)"), erInp))
    );

    const f = filter.trim().toLowerCase();
    let shown = 0;
    for (const mo of masters.motorTempMotors) {
      if (f && !mo.name.toLowerCase().includes(f)) continue;
      shown++;
      const val = valMap.get(mo.row);
      const inp = numInput({
        value: val ?? null,
        placeholder: prevMap.get(mo.row) != null ? String(prevMap.get(mo.row)) : "",
        onInput: debounce(async (v) => { await saveTemp(curYm, mo.row, v); recount(); }, 350),
      });
      listEl.append(
        h("div", { class: `mrow ${val != null ? "filled" : ""}` },
          h("div", { class: "mname" }, mo.name,
            h("small", {}, `${mo.no ? "#" + mo.no + " · " : ""}${mo.mounting || ""} ${mo.rating ? "· " + mo.rating + " KW" : ""}`)),
          inp)
      );
    }
    if (shown === 0) listEl.append(h("div", { class: "list-empty" }, "No motors match."));
    recountSync(valMap.size);
  }

  function recountSync(n: number) { prog.textContent = `${n}/${masters.motorTempMotors.length} motors`; }
  async function recount() {
    const r = await db.motorTemp.where("ym").equals(curYm).count();
    recountSync(r);
  }

  const search = h("input", { type: "search", placeholder: "Search motor…", oninput: (e: Event) => { filter = (e.target as HTMLInputElement).value; load(); } });

  mount.append(
    topbar("Motor Temp", "TEC(A) 12", "/records"),
    screen(
      toolbar(monthPicker(curYm, (v) => { curYm = v; load(); }), prog),
      h("div", { class: "searchbar", style: { marginBottom: "10px" } }, search),
      listEl
    )
  );
  await load();
}

async function saveTemp(ymStr: string, motorRow: number, v: number | null) {
  const existing = await db.motorTemp.where("[ym+motorRow]").equals([ymStr, motorRow]).first();
  if (v == null) { if (existing?.id) await db.motorTemp.delete(existing.id); return; }
  if (existing?.id) await db.motorTemp.update(existing.id, { temp: v });
  else await db.motorTemp.add({ ym: ymStr, motorRow, temp: v });
}

function shiftYm(ymStr: string, delta: number): string {
  const [y, m] = ymStr.split("-").map(Number);
  return ymOf(new Date(y, m - 1 + delta, 1));
}
