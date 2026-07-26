import { h, topbar, screen, toast } from "../ui";
import { db, type OverhaulRow } from "../db";
import { debounce, ddMmmYyyy } from "../util";
import { matchRow, highlight, hitChips, type SearchField, type FieldHit } from "../search";

/**
 * Everything the user might remember about a motor: its name, either bearing
 * number, the rating, the overhaul date, the megger value or the remark.
 * `units` on the rating is what makes "12 KW" search the rating alone instead
 * of matching any bearing number that happens to contain 12.
 */
function overhaulFields(r: OverhaulRow): SearchField[] {
  const f: SearchField[] = [{ label: "Motor", text: r.motor || "", hidden: true }];
  if (r.kw != null) f.push({ label: "Rating", text: `${r.kw} KW`, units: ["kw"] });
  if (r.ndeBearing) f.push({ label: "NDE brg", text: String(r.ndeBearing) });
  if (r.deBearing) f.push({ label: "DE brg", text: String(r.deBearing) });
  if (r.interval) f.push({ label: "Interval", text: String(r.interval) });
  if (r.lastOverhaul) f.push({ label: "Overhauled", text: ddMmmYyyy(String(r.lastOverhaul)) });
  if (r.megger != null) f.push({ label: "Megger", text: `${r.megger} MΩ` });
  if (r.remarks) f.push({ label: "Remarks", text: String(r.remarks) });
  return f;
}

/** Units per chip label, so highlighting stays inside the qualified field. */
const OVERHAUL_UNITS: Record<string, string[]> = { Rating: ["kw"] };

export async function renderOverhaul(_p: Record<string, string>, mount: HTMLElement) {
  let filter = "";
  const listEl = h("div", {});
  const countEl = h("div", { class: "hint search-count" }, "");

  async function load() {
    listEl.replaceChildren();
    const rows = (await db.overhaul.toArray()).sort((a, b) => (a.sn ?? 0) - (b.sn ?? 0));
    const q = filter.trim();
    let shown = 0;
    for (const r of rows) {
      const hits = matchRow(overhaulFields(r), q);
      if (hits === null) continue; // row doesn't satisfy every term
      shown++;
      listEl.append(rowCard(r, q, hits));
    }
    countEl.textContent = q ? `${shown} of ${rows.length} motors match “${q}”` : "";
    if (shown === 0) {
      listEl.append(h("div", { class: "list-empty" },
        h("div", { class: "big" }, "🔍"),
        h("div", {}, q ? `Nothing matches “${q}”.` : "No motors.")));
    }
  }

  function rowCard(r: OverhaulRow, q: string, hits: FieldHit[]): HTMLElement {
    const dateInp = h("input", { type: "date", value: r.lastOverhaul ?? "",
      onChange: debounce(async (e: Event) => { await db.overhaul.update(r.row, { lastOverhaul: (e.target as HTMLInputElement).value || null }); toast("Saved", 800); }, 200) });
    const megInp = h("input", { type: "text", inputmode: "numeric", value: r.megger ?? "", placeholder: "MΩ",
      onInput: debounce(async (e: Event) => { const v = (e.target as HTMLInputElement).value.trim(); await db.overhaul.update(r.row, { megger: v === "" ? undefined : (isNaN(Number(v)) ? v : Number(v)) }); }, 350) });
    const remInp = h("input", { type: "text", value: r.remarks ?? "", placeholder: "Remarks",
      onInput: debounce(async (e: Event) => { await db.overhaul.update(r.row, { remarks: (e.target as HTMLInputElement).value }); }, 350) });
    // While searching, the fields that actually matched are surfaced as chips
    // with the term highlighted — so the user can see at a glance why this
    // motor came up (a bearing number, a date, a rating…).
    const hitRow = hitChips(hits, q, OVERHAUL_UNITS);

    return h(
      "div",
      { class: `card ohcard${q ? " matched" : ""}`, style: { padding: "12px 14px" } },
      h("div", { class: "ohname" },
        `${r.sn}. `, highlight(r.motor || "", q),
        r.kw ? h("span", { class: "ohkw" }, `  (${r.kw} KW)`) : null),
      hitRow,
      h("div", { style: { display: "flex", gap: "8px", fontSize: "11px", color: "var(--muted)", marginBottom: "8px" } },
        h("span", {}, `NDE ${r.ndeBearing || "-"}`), h("span", {}, `DE ${r.deBearing || "-"}`), h("span", {}, `Int ${r.interval || "-"}`)),
      h("div", { class: "grid2" },
        h("label", { class: "field", style: { marginBottom: 0 } }, h("span", { class: "lab" }, "Last overhaul"), dateInp),
        h("label", { class: "field", style: { marginBottom: 0 } }, h("span", { class: "lab" }, "Megger MΩ"), megInp)),
      h("label", { class: "field", style: { marginTop: "10px", marginBottom: 0 } }, h("span", { class: "lab" }, "Remarks"), remInp)
    );
  }

  const search = h("input", {
    type: "search",
    placeholder: "Motor, bearing no., date, rating…",
    "aria-label": "Search the overhaul register",
    onInput: (e: Event) => { filter = (e.target as HTMLInputElement).value; load(); },
  });

  mount.append(
    topbar("Overhaul & Megger", "TEC 05C · As needed", "/records"),
    screen(
      h("p", { class: "hint" }, "Update whenever a motor is overhauled or megger-tested. This register carries forward each month."),
      h("div", { class: "searchbar", style: { marginBottom: "6px" } }, search),
      countEl,
      listEl
    )
  );
  await load();
}
