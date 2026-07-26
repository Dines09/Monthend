// Shared search used by every list in the app, so a query behaves the same way
// wherever it is typed.
//
// Two rules the plain "does the name contain the text" filter got wrong:
//
//  1. A qualified number means that field and no other. "12 KW" must match the
//     motor's rating, never a bearing that happens to contain 12. Units are
//     recognised on their own (`12 kw`) or joined (`12kw`).
//  2. Every whitespace term must match somewhere in the row, so extra words
//     narrow the result instead of widening it.

/** One searchable field of a row. */
export interface SearchField {
  /** Short label shown on the "why did this match" chip. */
  label: string;
  /** Text searched and displayed. */
  text: string;
  /**
   * Units this field is measured in (lower-case, no dot). A term carrying one
   * of these units can only match this field.
   */
  units?: string[];
  /** Don't show a chip for this field (e.g. the row's own title). */
  hidden?: boolean;
}

/** A field that matched, for display. */
export interface FieldHit {
  label: string;
  text: string;
}

/** A parsed query term. */
interface Term {
  text: string;
  /** Set when the term named a unit, e.g. "12 kw" → unit "kw", text "12". */
  unit?: string;
}

// Units that can qualify a number, mapped to a canonical form. Keep the keys
// lower-case; matching is done on a lower-cased query.
const UNIT_ALIASES: Record<string, string> = {
  kw: "kw", kws: "kw", kilowatt: "kw", kilowatts: "kw",
  v: "v", volt: "v", volts: "v",
  a: "a", amp: "a", amps: "a", ampere: "a", amperes: "a",
  c: "c", "°c": "c", deg: "c", degree: "c", degrees: "c",
  mv: "mv",
  kg: "kg",
  mm: "mm",
  hz: "hz",
  rpm: "rpm",
  cca: "cca",
};

/**
 * Split a query into terms, attaching a unit to the number it qualifies.
 * "12 kw pump" → [{text:"12", unit:"kw"}, {text:"pump"}]
 * "12kw"       → [{text:"12", unit:"kw"}]
 */
export function parseQuery(q: string): Term[] {
  const raw = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out: Term[] = [];
  for (let i = 0; i < raw.length; i++) {
    const word = raw[i];
    // "12kw" / "63kw" — a number with the unit stuck to it.
    const joined = word.match(/^(\d+(?:\.\d+)?)([a-z°]+)$/);
    if (joined && UNIT_ALIASES[joined[2]]) {
      out.push({ text: joined[1], unit: UNIT_ALIASES[joined[2]] });
      continue;
    }
    // "12 kw" — the next word is a bare unit qualifying this number.
    if (/^\d+(\.\d+)?$/.test(word)) {
      const next = raw[i + 1];
      if (next && UNIT_ALIASES[next]) {
        out.push({ text: word, unit: UNIT_ALIASES[next] });
        i++; // consume the unit word
        continue;
      }
    }
    // A bare unit with nothing to qualify is just a word (e.g. searching "kw").
    out.push({ text: word });
  }
  return out;
}

/**
 * Match a row against a query.
 *
 * Returns `null` when the row doesn't satisfy every term, otherwise the list of
 * fields that carried a term (so the UI can show *why* it matched). An empty
 * query matches everything with no hits.
 */
export function matchRow(fields: SearchField[], q: string): FieldHit[] | null {
  const terms = parseQuery(q);
  if (!terms.length) return [];

  const prepared = fields
    .filter((f) => f.text != null && f.text !== "")
    .map((f) => ({ ...f, hay: f.text.toLowerCase() }));

  // A term with a unit may only be satisfied by a field declaring that unit —
  // that's what stops "12 KW" matching a bearing number containing 12.
  const candidatesFor = (t: Term) =>
    t.unit ? prepared.filter((f) => f.units?.includes(t.unit!)) : prepared;

  if (!terms.every((t) => candidatesFor(t).some((f) => f.hay.includes(t.text)))) return null;

  const hits: FieldHit[] = [];
  const seen = new Set<string>();
  for (const t of terms) {
    for (const f of candidatesFor(t)) {
      if (f.hidden || !f.hay.includes(t.text) || seen.has(f.label)) continue;
      seen.add(f.label);
      hits.push({ label: f.label, text: f.text });
    }
  }
  return hits;
}

/**
 * Render `text` with each matching term wrapped in a `<mark>`. Terms that were
 * unit-qualified only highlight inside a field carrying that unit, so "12 KW"
 * doesn't light up a stray 12 elsewhere on the row.
 */
export function highlight(text: string, q: string, fieldUnits?: string[]): HTMLElement {
  const wrap = document.createElement("span");
  const terms = parseQuery(q).filter((t) => !t.unit || fieldUnits?.includes(t.unit));
  if (!terms.length) { wrap.textContent = text; return wrap; }

  const lower = text.toLowerCase();
  let i = 0, plain = "";
  const flush = () => { if (plain) { wrap.append(document.createTextNode(plain)); plain = ""; } };
  while (i < text.length) {
    // Longest matching term wins, so overlapping terms don't split a word oddly.
    const hit = terms
      .filter((t) => lower.startsWith(t.text, i))
      .sort((a, b) => b.text.length - a.text.length)[0];
    if (hit) {
      flush();
      const mark = document.createElement("mark");
      mark.className = "hl";
      mark.textContent = text.slice(i, i + hit.text.length);
      wrap.append(mark);
      i += hit.text.length;
    } else {
      plain += text[i];
      i++;
    }
  }
  flush();
  return wrap;
}

/** The chips showing which fields matched, for a row in a result list. */
export function hitChips(hits: FieldHit[], q: string, unitsByLabel?: Record<string, string[]>): HTMLElement | null {
  if (!hits.length) return null;
  const row = document.createElement("div");
  row.className = "hitrow";
  for (const hit of hits) {
    const chip = document.createElement("span");
    chip.className = "hitchip";
    const lab = document.createElement("span");
    lab.className = "hc-lab";
    lab.textContent = hit.label;
    chip.append(lab, highlight(hit.text, q, unitsByLabel?.[hit.label]));
    row.append(chip);
  }
  return row;
}
