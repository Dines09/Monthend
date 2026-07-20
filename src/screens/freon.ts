import { h, topbar, screen, numInput } from "../ui";
import { db } from "../db";
import { masters } from "../seed";
import { ym as ymOf, defaultReportYm, debounce } from "../util";
import { monthPicker, toolbar } from "./parts";

export async function renderFreon(_p: Record<string, string>, mount: HTMLElement) {
  let curYm = defaultReportYm();
  const body = h("div", {});
  const prog = h("span", { class: "progress" });

  async function load() {
    body.replaceChildren();
    const rows = await db.freon.where("ym").equals(curYm).toArray();
    const prev = await db.freon.where("ym").equals(shiftYm(curYm, -1)).toArray();
    const valMap = new Map(rows.map((r) => [r.systemRow, r.consumed]));
    const prevMap = new Map(prev.map((r) => [r.systemRow, r.consumed]));
    const meta = await db.freonMeta.get(curYm);

    let filled = 0;
    for (const s of masters.freonSystems) {
      const val = valMap.get(s.row);
      if (val != null) filled++;
      const inp = numInput({
        value: val ?? null,
        placeholder: prevMap.get(s.row) != null ? String(prevMap.get(s.row)) : "0",
        onInput: debounce(async (v) => { await saveFreon(curYm, s.row, v); recount(); }, 350),
      });
      body.append(
        h("div", { class: "mrow" },
          h("div", { class: "mname" }, s.name, s.capacity != null ? h("small", {}, `Capacity ${s.capacity} kg`) : null),
          inp)
      );
    }

    // received this month
    const recInp = numInput({ value: meta?.received ?? null, placeholder: "0",
      onInput: debounce(async (v) => { await db.freonMeta.put({ ym: curYm, received: v ?? undefined }); }, 350) });
    body.append(
      h("div", { class: "card", style: { marginTop: "12px" } },
        h("label", { class: "field", style: { marginBottom: 0 } },
          h("span", { class: "lab" }, "Freon received this month (kg)"), recInp))
    );

    // ROB computed preview
    const robPreview = await computeRob(curYm);
    body.append(
      h("div", { class: "card accent" },
        h("div", { class: "hint" },
          `ROB last month: ${robPreview.robStart} kg`, h("br"),
          `Total consumed: ${robPreview.consumed} kg`, h("br"),
          `Received: ${robPreview.received} kg`, h("br"),
          h("strong", {}, `ROB end of month: ${robPreview.robEnd} kg`)))
    );

    prog.textContent = `${filled}/${masters.freonSystems.length} systems`;
    async function recount() {
      const r = await db.freon.where("ym").equals(curYm).count();
      prog.textContent = `${r}/${masters.freonSystems.length} systems`;
      const rp = await computeRob(curYm);
      // update preview card text
    }
  }

  mount.append(
    topbar("Freon Consumption", "TEC(A) 33", "/records"),
    screen(
      toolbar(monthPicker(curYm, (v) => { curYm = v; load(); }), prog),
      h("p", { class: "hint" }, "Enter kg consumed per system. ROB (remaining on board) is auto-calculated from previous months + received."),
      body
    )
  );
  await load();
}

async function saveFreon(ymStr: string, systemRow: number, v: number | null) {
  const existing = await db.freon.where("[ym+systemRow]").equals([ymStr, systemRow]).first();
  if (v == null) {
    if (existing?.id) await db.freon.delete(existing.id);
    return;
  }
  if (existing?.id) await db.freon.update(existing.id, { consumed: v });
  else await db.freon.add({ ym: ymStr, systemRow, consumed: v });
}

/** Compute ROB chain from Jan seed start through the given month. */
export async function computeRob(targetYm: string): Promise<{ robStart: number; consumed: number; received: number; robEnd: number }> {
  const year = Number(targetYm.split("-")[0]);
  let rob = masters.freonRobStartJan ?? 0;
  let result = { robStart: rob, consumed: 0, received: 0, robEnd: rob };
  for (let m = 1; m <= 12; m++) {
    const ymStr = `${year}-${String(m).padStart(2, "0")}`;
    const cons = (await db.freon.where("ym").equals(ymStr).toArray()).reduce((a, r) => a + (r.consumed || 0), 0);
    const meta = await db.freonMeta.get(ymStr);
    const received = meta?.received ?? 0;
    const robStart = rob;
    const robEnd = robStart - cons + received;
    if (ymStr === targetYm) result = { robStart, consumed: cons, received, robEnd };
    rob = robEnd;
    if (ymStr === targetYm) break;
  }
  return result;
}

function shiftYm(ymStr: string, delta: number): string {
  const [y, m] = ymStr.split("-").map(Number);
  return ymOf(new Date(y, m - 1 + delta, 1));
}
