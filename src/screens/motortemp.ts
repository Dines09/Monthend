import { h, topbar, screen, numInput, progressRing } from "../ui";
import { db } from "../db";
import { masters } from "../seed";
import { ym as ymOf, defaultReportYm, debounce } from "../util";
import { periodHead, bindHeadGestures } from "./periodhead";
import { matchRow, highlight, hitChips, type SearchField } from "../search";

export async function renderMotorTemp(_p: Record<string, string>, mount: HTMLElement) {
  let curYm = defaultReportYm();
  let filter = "";
  const listEl = h("div", {});
  const ringWrap = h("div", {});
  const countEl = h("div", { class: "hint search-count" }, "");

  // Uniform header: month chip + progress ring, same as every dated screen.
  const head = periodHead({
    ym: curYm, open: false,
    onMonth: (ym) => { curYm = ym; load(); },
  });

  /** The searchable fields of a motor — name, number, mounting and rating. */
  const motorFields = (mo: any): SearchField[] => [
    { label: "Motor", text: mo.name || "", hidden: true },
    ...(mo.no ? [{ label: "No.", text: `#${mo.no}` }] : []),
    ...(mo.mounting ? [{ label: "Mounting", text: String(mo.mounting) }] : []),
    // Declaring the unit is what makes "12 KW" match the rating and nothing else.
    ...(mo.rating ? [{ label: "Rating", text: `${mo.rating} KW`, units: ["kw"] }] : []),
  ];

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
      h("div", { class: "card accent" },
        h("label", { class: "field", style: { marginBottom: 0 } },
          h("span", { class: "lab" }, "Engine Room Temperature (°C)"), erInp))
    );

    const q = filter.trim();
    let shown = 0;
    for (const mo of masters.motorTempMotors) {
      const hits = matchRow(motorFields(mo), q);
      if (hits === null) continue;
      shown++;
      const val = valMap.get(mo.row);
      const inp = numInput({
        value: val ?? null,
        placeholder: prevMap.get(mo.row) != null ? String(prevMap.get(mo.row)) : "",
        onInput: debounce(async (v) => { await saveTemp(curYm, mo.row, v); recount(); }, 350),
      });
      listEl.append(
        h("div", { class: `mrow ${val != null ? "filled" : ""}` },
          h("div", { class: "mname" },
            q ? highlight(mo.name, q) : mo.name,
            h("small", {}, `${mo.no ? "#" + mo.no + " · " : ""}${mo.mounting || ""} ${mo.rating ? "· " + mo.rating + " KW" : ""}`),
            hitChips(hits, q, { Rating: ["kw"] })),
          inp)
      );
    }
    countEl.textContent = q ? `${shown} of ${masters.motorTempMotors.length} motors match “${q}”` : "";
    if (shown === 0) {
      listEl.append(h("div", { class: "list-empty" },
        h("div", { class: "big" }, "🔍"), h("div", {}, `Nothing matches “${q}”.`)));
    }
    recountSync(valMap.size);
  }

  function recountSync(n: number) {
    ringWrap.replaceChildren(progressRing(n, masters.motorTempMotors.length, "left"));
  }
  async function recount() {
    const r = await db.motorTemp.where("ym").equals(curYm).count();
    recountSync(r);
  }

  const search = h("input", {
    type: "search", placeholder: "Motor, number or rating (e.g. 12 KW)…",
    "aria-label": "Search motors",
    onInput: (e: Event) => { filter = (e.target as HTMLInputElement).value; load(); },
  });

  head.right.append(ringWrap);

  mount.append(
    topbar("Motor Temp", "TEC(A) 12", "/records"),
    screen(
      head.el,
      h("div", { class: "searchbar", style: { marginBottom: "6px" } }, search),
      countEl,
      listEl
    )
  );
  bindHeadGestures(mount.querySelector<HTMLElement>(".screen")!, head);
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
