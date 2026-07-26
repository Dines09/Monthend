import { h, topbar, screen, toast } from "../ui";
import { db, type OverhaulRow } from "../db";
import { debounce, ddMmmYyyy } from "../util";

/**
 * The searchable fields of an overhaul row, each with the label shown on a
 * match chip. Searching covers everything the user might remember about a motor
 * — its name, either bearing number, the rating, the overhaul date, the megger
 * value or the remark — not just the name.
 */
const SEARCH_FIELDS: { key: keyof OverhaulRow; label: string; fmt?: (v: any) => string }[] = [
  { key: "motor", label: "Motor" },
  { key: "kw", label: "Rating", fmt: (v) => `${v} KW` },
  { key: "ndeBearing", label: "NDE brg" },
  { key: "deBearing", label: "DE brg" },
  { key: "interval", label: "Interval" },
  { key: "lastOverhaul", label: "Overhauled", fmt: (v) => ddMmmYyyy(String(v)) },
  { key: "megger", label: "Megger", fmt: (v) => `${v} MΩ` },
  { key: "remarks", label: "Remarks" },
];

/** A field whose text contains the query, with the display value to show. */
interface FieldHit { label: string; text: string }

/**
 * Which fields of `r` match `q`. Every whitespace-separated term must appear
 * somewhere in the row, so "6314 pump" narrows rather than widens; the hits
 * returned are the fields that matched the *last* meaningful term set, i.e.
 * any field containing any term.
 */
function fieldHits(r: OverhaulRow, q: string): FieldHit[] | null {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const fields = SEARCH_FIELDS.map((f) => {
    const raw = r[f.key];
    if (raw == null || raw === "") return null;
    const text = f.fmt ? f.fmt(raw) : String(raw);
    return { label: f.label, text, hay: `${text} ${raw}`.toLowerCase() };
  }).filter(Boolean) as { label: string; text: string; hay: string }[];

  // Each term has to be found somewhere in the row for it to qualify.
  if (!terms.every((t) => fields.some((f) => f.hay.includes(t)))) return null;
  // Report the fields that actually carried a term, so the user sees *why* the
  // row matched — that's the part that was missing before.
  return fields
    .filter((f) => terms.some((t) => f.hay.includes(t)))
    .map(({ label, text }) => ({ label, text }));
}

/** Render `text` with every occurrence of any term wrapped in a <mark>. */
function highlight(text: string, q: string): HTMLElement {
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const wrap = h("span", {});
  if (!terms.length) { wrap.textContent = text; return wrap; }
  const lower = text.toLowerCase();
  // Walk the string, at each position taking the longest term that matches.
  let i = 0, plain = "";
  const flush = () => { if (plain) { wrap.append(document.createTextNode(plain)); plain = ""; } };
  while (i < text.length) {
    const hit = terms
      .filter((t) => lower.startsWith(t, i))
      .sort((a, b) => b.length - a.length)[0];
    if (hit) {
      flush();
      wrap.append(h("mark", { class: "hl" }, text.slice(i, i + hit.length)));
      i += hit.length;
    } else {
      plain += text[i];
      i++;
    }
  }
  flush();
  return wrap;
}

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
      const hits = q ? fieldHits(r, q) : [];
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
    const hitRow = hits.length
      ? h("div", { class: "hitrow" },
          ...hits.map((hit) => h("span", { class: "hitchip" },
            h("span", { class: "hc-lab" }, hit.label),
            highlight(hit.text, q))))
      : null;

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
