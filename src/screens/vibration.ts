import { h, topbar, screen, numInput, progressRing } from "../ui";
import { db } from "../db";
import { masters } from "../seed";
import { ym as ymOf, defaultReportYm, debounce } from "../util";
import { periodHead, bindHeadGestures } from "./periodhead";
import { matchRow, highlight, hitChips, type SearchField } from "../search";

export async function renderVibration(_p: Record<string, string>, mount: HTMLElement) {
  let curYm = defaultReportYm();
  let filter = "";
  const listEl = h("div", {});
  const ringWrap = h("div", {});
  const countEl = h("div", { class: "hint search-count" }, "");

  const head = periodHead({
    ym: curYm, open: false,
    onMonth: (ym) => { curYm = ym; load(); },
  });

  const motorFields = (mo: any): SearchField[] => [
    { label: "Motor", text: mo.name || "", hidden: true },
    ...(mo.rating ? [{ label: "Rating", text: `${mo.rating} KW`, units: ["kw"] }] : []),
  ];

  async function load() {
    // Last month's readings ride along as grey placeholders, so the user can see
    // what this motor read last time while entering the new figure.
    const [rows, prevRows] = await Promise.all([
      db.motorVibration.where("ym").equals(curYm).toArray(),
      db.motorVibration.where("ym").equals(shiftYm(curYm, -1)).toArray(),
    ]);
    const map = new Map<string, { vel?: number | null; acc?: number | null }>();
    for (const r of rows) map.set(`${r.motorRow}:${r.end}`, { vel: r.vel, acc: r.acc });
    const prevMap = new Map<string, { vel?: number | null; acc?: number | null }>();
    for (const r of prevRows) prevMap.set(`${r.motorRow}:${r.end}`, { vel: r.vel, acc: r.acc });
    render(map, prevMap);
  }

  function render(
    map: Map<string, { vel?: number | null; acc?: number | null }>,
    prevMap: Map<string, { vel?: number | null; acc?: number | null }>
  ) {
    listEl.replaceChildren();
    const q = filter.trim();
    const filledMotors = new Set<number>();
    for (const [k, v] of map) if (v.vel != null || v.acc != null) filledMotors.add(Number(k.split(":")[0]));

    let shown = 0;
    for (const mo of masters.vibrationMotors) {
      const hits = matchRow(motorFields(mo), q);
      if (hits === null) continue;
      shown++;
      const ends: Node[] = [];
      for (const end of ["drive", "free"] as const) {
        const cur = map.get(`${mo.row}:${end}`) ?? {};
        const prev = prevMap.get(`${mo.row}:${end}`) ?? {};
        // Grey hint = last month's value for this exact motor + end. Falls back
        // to the field name when there is no history to show.
        const velInp = numInput({ value: cur.vel ?? null,
          placeholder: prev.vel != null ? String(prev.vel) : "Vel",
          onInput: debounce(async (v) => { await saveVib(curYm, mo.row, end, { vel: v }); recount(); }, 350) });
        const accInp = numInput({ value: cur.acc ?? null,
          placeholder: prev.acc != null ? String(prev.acc) : "Acc",
          onInput: debounce(async (v) => { await saveVib(curYm, mo.row, end, { acc: v }); recount(); }, 350) });
        ends.push(
          h("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" } },
            h("div", { style: { width: "72px", fontSize: "12px", color: "var(--muted)" } }, end === "drive" ? "Drive end" : "Free end"),
            h("div", { class: "twin", style: { display: "flex", gap: "6px", flex: "1" } }, velInp, accInp))
        );
      }
      listEl.append(
        h("div", { class: "card", style: { padding: "12px 14px" } },
          h("div", { style: { fontWeight: "700", fontSize: "14px" } },
            q ? highlight(mo.name, q) : mo.name,
            mo.rating ? h("span", { style: { color: "var(--muted)", fontWeight: "400" } }, `  (${mo.rating} KW)`) : null),
          hitChips(hits, q, { Rating: ["kw"] }),
          ...ends)
      );
    }
    countEl.textContent = q ? `${shown} of ${masters.vibrationMotors.length} motors match “${q}”` : "";
    if (shown === 0) {
      listEl.append(h("div", { class: "list-empty" },
        h("div", { class: "big" }, "🔍"), h("div", {}, `Nothing matches “${q}”.`)));
    }
    setRing(filledMotors.size);
  }

  function setRing(n: number) {
    ringWrap.replaceChildren(progressRing(n, masters.vibrationMotors.length, "left"));
  }

  async function recount() {
    const rows = await db.motorVibration.where("ym").equals(curYm).toArray();
    const s = new Set(rows.filter((r) => r.vel != null || r.acc != null).map((r) => r.motorRow));
    setRing(s.size);
  }

  const search = h("input", {
    type: "search", placeholder: "Motor or rating (e.g. 12 KW)…",
    "aria-label": "Search motors",
    onInput: (e: Event) => { filter = (e.target as HTMLInputElement).value; load(); },
  });

  head.right.append(ringWrap);

  mount.append(
    topbar("Motor Vibration", "TEC(A) 15", "/records"),
    screen(
      head.el,
      h("p", { class: "hint" }, "Two boxes per end: Velocity (Vel) and Acceleration (Acc). Leave blank if motor not running."),
      h("div", { class: "searchbar", style: { marginBottom: "6px" } }, search),
      countEl,
      listEl
    )
  );
  bindHeadGestures(mount.querySelector<HTMLElement>(".screen")!, head);
  await load();
}

function shiftYm(ymStr: string, delta: number): string {
  const [y, m] = ymStr.split("-").map(Number);
  return ymOf(new Date(y, m - 1 + delta, 1));
}

async function saveVib(ymStr: string, motorRow: number, end: "drive" | "free", patch: { vel?: number | null; acc?: number | null }) {
  const existing = await db.motorVibration.where("[ym+motorRow+end]").equals([ymStr, motorRow, end]).first();
  const merged = { vel: existing?.vel ?? null, acc: existing?.acc ?? null, ...patch };
  if (merged.vel == null && merged.acc == null) {
    if (existing?.id) await db.motorVibration.delete(existing.id);
    return;
  }
  if (existing?.id) await db.motorVibration.update(existing.id, merged);
  else await db.motorVibration.add({ ym: ymStr, motorRow, end, ...merged });
}
