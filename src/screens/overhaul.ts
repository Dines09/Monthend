import { h, topbar, screen, toast } from "../ui";
import { db, type OverhaulRow } from "../db";
import { debounce } from "../util";

export async function renderOverhaul(_p: Record<string, string>, mount: HTMLElement) {
  let filter = "";
  const listEl = h("div", {});

  async function load() {
    listEl.replaceChildren();
    const rows = (await db.overhaul.toArray()).sort((a, b) => (a.sn ?? 0) - (b.sn ?? 0));
    const f = filter.trim().toLowerCase();
    let shown = 0;
    for (const r of rows) {
      if (f && !(r.motor || "").toLowerCase().includes(f)) continue;
      shown++;
      listEl.append(rowCard(r));
    }
    if (shown === 0) listEl.append(h("div", { class: "list-empty" }, "No motors match."));
  }

  function rowCard(r: OverhaulRow): HTMLElement {
    const dateInp = h("input", { type: "date", value: r.lastOverhaul ?? "",
      onChange: debounce(async (e: Event) => { await db.overhaul.update(r.row, { lastOverhaul: (e.target as HTMLInputElement).value || null }); toast("Saved", 800); }, 200) });
    const megInp = h("input", { type: "text", inputmode: "numeric", value: r.megger ?? "", placeholder: "MΩ",
      onInput: debounce(async (e: Event) => { const v = (e.target as HTMLInputElement).value.trim(); await db.overhaul.update(r.row, { megger: v === "" ? undefined : (isNaN(Number(v)) ? v : Number(v)) }); }, 350) });
    const remInp = h("input", { type: "text", value: r.remarks ?? "", placeholder: "Remarks",
      onInput: debounce(async (e: Event) => { await db.overhaul.update(r.row, { remarks: (e.target as HTMLInputElement).value }); }, 350) });
    return h(
      "div",
      { class: "card", style: { padding: "12px 14px" } },
      h("div", { style: { fontWeight: 700, fontSize: "14px", marginBottom: "8px" } },
        `${r.sn}. ${r.motor}`,
        r.kw ? h("span", { style: { color: "var(--muted)", fontWeight: 400 } }, `  (${r.kw} KW)`) : null),
      h("div", { style: { display: "flex", gap: "8px", fontSize: "11px", color: "var(--muted)", marginBottom: "8px" } },
        h("span", {}, `NDE ${r.ndeBearing || "-"}`), h("span", {}, `DE ${r.deBearing || "-"}`), h("span", {}, `Int ${r.interval || "-"}`)),
      h("div", { class: "grid2" },
        h("label", { class: "field", style: { marginBottom: 0 } }, h("span", { class: "lab" }, "Last overhaul"), dateInp),
        h("label", { class: "field", style: { marginBottom: 0 } }, h("span", { class: "lab" }, "Megger MΩ"), megInp)),
      h("label", { class: "field", style: { marginTop: "10px", marginBottom: 0 } }, h("span", { class: "lab" }, "Remarks"), remInp)
    );
  }

  const search = h("input", { type: "search", placeholder: "Search motor…", oninput: (e: Event) => { filter = (e.target as HTMLInputElement).value; load(); } });

  mount.append(
    topbar("Overhaul & Megger", "TEC 05C · As needed", "/records"),
    screen(
      h("p", { class: "hint" }, "Update whenever a motor is overhauled or megger-tested. This register carries forward each month."),
      h("div", { class: "searchbar", style: { marginBottom: "10px" } }, search),
      listEl
    )
  );
  await load();
}
