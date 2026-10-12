// Deterministic quarterly test roster for the fire-detector alarm test.
//
// The file is a quarterly record: every detector must be tested once per 3-month
// cycle (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec). Testing happens on the weekly
// Saturday safety round. This module works out — with no stored state, so it is
// identical on every phone and regenerates each quarter — *which* detectors to
// test on *which* Saturday, so that:
//   • every detector is covered exactly once across the quarter's Saturdays;
//   • the load per Saturday is even (~total / #Saturdays), so the work is spread
//     over the full three months, not finished early;
//   • each Saturday draws from as many different zones as possible;
//   • bigger zones contribute more tests (they simply have more detectors, so
//     they recur on more Saturdays — and occasionally 2 on one day).
import { masters } from "./seed";
import { quarterWindow, saturdaysInMonth, ymParts } from "./util";
import { fireEdit } from "./fireEdits";
import { panelInfo, type PanelInfo } from "./firePanel";

/**
 * Fifteen detectors on the record sheet (rows 141–149, 159–160, 169–172 — the
 * ones with no Sr.No. in column A) were left out of the first import; they are
 * marked `addedIn` in the seed.
 *
 * In the quarter they were added (and any before it) the rest of the roster is
 * dealt exactly as it always was — tests already ticked stay on their Saturday —
 * and the added ones are then spread evenly over every Saturday of the quarter,
 * past ones included, so overdue ones can be picked up on the next round.
 * From the first quarter that starts on/after MERGED_FROM_YM, nothing has been
 * ticked yet, so all detectors are planned together as one even roster.
 */
export const MERGED_FROM_YM = "2027-01";

/** Blank template rows (no tag, no location) are placeholders, not detectors. */
export function isPlaceholder(d: { id?: string | null; location?: string | null }): boolean {
  return !(d.id ?? "").trim() && !(d.location ?? "").trim();
}

/** Real detectors on the register — what every count and total is out of. */
export function realDetectors(): any[] {
  return masters.fireDetectors.filter((d: any) => !isPlaceholder(d));
}

export interface ScheduledDet {
  detKey: string; // `${sheet}:${row}` — matches FireTest.detKey
  sheet: string;
  row: number;
  zone: number;
  battery: boolean; // battery-operated set (its own group, own sheet)
  id: string; // detector name / tag
  location: string;
  dtype: string | null;
  kind: DetKind; // what it is, derived from the tag — decides the tester needed
  area: ShipArea; // physical area, derived from the location text
  panel: PanelInfo; // loop / zone / address on the fire-alarm panel
}

/** Panel info for a register entry, with any user-confirmed values applied. */
export function detPanel(d: { sheet: string; row: number; zone: number; id?: string | null }): PanelInfo {
  return panelInfo(d, fireEdit(`${d.sheet}:${d.row}`));
}

// ---- device kind -------------------------------------------------------
// The tag prefix says what the device is, which decides which tester the
// engineer has to carry: S (and anything unlabelled) is a smoke detector; MCP is
// a manual call point (needs the special key); H is a heat detector; F is a
// flame detector. SC / SCI / SC1 / SCM are NOT detectors at all — they are
// interface units, which are checked rather than tested with a tester.
export type DetKind = "smoke" | "heat" | "flame" | "mcp" | "interface";

export const KIND_META: Record<DetKind, { label: string; short: string; tester: string; icon: string }> = {
  smoke: { label: "Smoke detector", short: "SMOKE", tester: "Smoke tester", icon: "💨" },
  heat:  { label: "Heat detector",  short: "HEAT",  tester: "Heat tester",  icon: "🌡️" },
  flame: { label: "Flame detector", short: "FLAME", tester: "Flame tester", icon: "🔥" },
  mcp:   { label: "Manual call point", short: "MCP", tester: "MCP key",     icon: "🔘" },
  interface: { label: "Interface unit", short: "INTERFACE", tester: "No tester — visual check", icon: "🔌" },
};

/** Interface units are checked, not tested — no tester is carried for them. */
export const INTERFACE_KIND: DetKind = "interface";

/**
 * Classify a detector from its tag (and location as a fallback).
 *
 * Order matters: MCP must be checked before the single letters, and the "SC…"
 * family (SC, SCI, SC1, SCM) must be caught before the bare "S" smoke rule —
 * those are interface units, not smoke detectors. Anything that doesn't match a
 * known prefix — including blank tags — is treated as a smoke detector, which is
 * the overwhelming majority on board.
 */
export function detKind(id: string, location = ""): DetKind {
  const t = `${id} ${location}`.toUpperCase();
  if (/\bMCP\b|MANUAL\s*CALL/.test(t)) return "mcp";
  const tag = id.trim().toUpperCase();
  // Leading letters of the tag, ignoring any number/suffix ("SCI 3" -> "SCI").
  const prefix = (tag.match(/^[A-Z]+/) ?? [""])[0];
  if (prefix === "MCP") return "mcp";
  if (prefix === "H") return "heat";
  if (prefix === "F") return "flame";
  // SC / SCI / SCM — and "SC1", whose digit is stripped by the prefix match.
  if (prefix === "SC" || prefix === "SCI" || prefix === "SCM") return "interface";
  // S, T (time counter unit), blank … all smoke.
  return "smoke";
}

// ---- physical area ordering -------------------------------------------
// The engineer walks the ship bottom-up: engine room floor first, then up
// through the decks and finally the outlying spaces. Sorting the test list this
// way means one continuous walk instead of scrolling back and forth.
export type ShipArea =
  | "er-floor" | "er-2nd" | "er-1st" | "er-casing" | "sgr"
  | "upp" | "bosun" | "bwts" | "a" | "b" | "c" | "bridge" | "other";

// The walk: up through the engine room, steering gear, then the upper deck.
// Bosun store and the BWTS room are entered off the upper deck, so they are done
// there before carrying on up through A, B, C and the bridge.
export const AREA_ORDER: ShipArea[] = [
  "er-floor", "er-2nd", "er-1st", "er-casing", "sgr",
  "upp", "bosun", "bwts", "a", "b", "c", "bridge", "other",
];

// Spaces that are not part of the ordinary accommodation round — they have to be
// opened up / arranged with the deck crew, so the screen warns on the Saturdays
// they come up.
export const SPECIAL_ACCESS: ShipArea[] = ["bosun", "bwts"];

export const AREA_LABEL: Record<ShipArea, string> = {
  "er-floor":  "E/R Floor",
  "er-2nd":    "E/R 2nd Deck",
  "er-1st":    "E/R 1st Deck",
  "er-casing": "E/R Casing",
  sgr:         "Steering Gear Room",
  upp:         "Upper Deck",
  bosun:       "Bosun Store",
  bwts:        "BWTS Room",
  a:           "A Deck",
  b:           "B Deck",
  c:           "C Deck",
  bridge:      "Bridge",
  other:       "Other",
};

/**
 * Work out the physical area from the free-text location on the template.
 * The strings are hand-typed and inconsistent ("E/R 1ST DECK", "E/R 1ST-DK",
 * "UPP-DECK", "A- DECK"), so match loosely and check the most specific
 * patterns first — an E/R location must never fall through to a deck letter.
 */
export function detArea(location: string): ShipArea {
  const t = location.toUpperCase().replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim();

  if (/BWTS/.test(t)) return "bwts";
  if (/BOSUN|BOSON/.test(t)) return "bosun";

  // Engine room + casing come first so "E/R CASING A DECK" isn't read as A deck.
  const er = /\bE\s?\/?\s?R\b|ENGINE ROOM/.test(t);
  if (/CASING/.test(t)) return "er-casing";
  if (er || /MAIN ENGINE|AUX BOILER|GENERATOR|D\/G/.test(t)) {
    if (/FLOOR/.test(t)) return "er-floor";
    if (/2ND (DECK|DK)/.test(t)) return "er-2nd";
    if (/1ST (DECK|DK)/.test(t)) return "er-1st";
    return "er-1st"; // unqualified engine-room spaces sit with the 1st deck walk
  }

  if (/S\s?\/?\s?G\s?\/?\s?R|STEERING GEAR|\bSDR\b/.test(t)) return "sgr";
  // Stairways are not a place of their own: a stairway belongs to the deck it
  // serves ("STAIRWAY A-DECK" is part of the A deck round), so the deck checks
  // below decide it. Only a stairway with no deck named falls through to "other".
  if (/\bUPP\b|UPPER DECK/.test(t)) return "upp";
  if (/\bA DECK\b|\bA DK\b/.test(t)) return "a";
  if (/\bB DECK\b|\bB DK\b/.test(t)) return "b";
  if (/\bC DECK\b|\bC DK\b/.test(t)) return "c";
  if (/BRIDGE|NAV DECK|WHEELHOUSE/.test(t)) return "bridge";
  return "other";
}

/** Sort key for the bottom-up walk: area first, then the template's own order. */
export function areaRank(a: ShipArea): number {
  const i = AREA_ORDER.indexOf(a);
  return i < 0 ? AREA_ORDER.length : i;
}

/**
 * Order a detector list for the walk: E/R floor upwards through the decks, then
 * the outlying spaces, with the battery-operated units last (they are a separate
 * sheet on the record and are checked on their own).
 */
export function sortByWalk(dets: ScheduledDet[]): ScheduledDet[] {
  return [...dets].sort(
    (x, y) =>
      Number(x.battery) - Number(y.battery) ||
      areaRank(x.area) - areaRank(y.area) ||
      x.zone - y.zone ||
      x.row - y.row
  );
}

/** Count of each device kind in a list — drives the "what to carry" summary. */
export function kindCounts(dets: ScheduledDet[]): Record<DetKind, number> {
  const out: Record<DetKind, number> = { smoke: 0, heat: 0, flame: 0, mcp: 0, interface: 0 };
  for (const d of dets) out[d.kind]++;
  return out;
}

export interface QuarterPlan {
  label: string; // e.g. "JULY-SEPTEMBER"
  year: number;
  startYm: string;
  endYm: string;
  saturdays: string[]; // ISO, ordered
  bySat: Map<string, ScheduledDet[]>; // Saturday ISO -> detectors (zone-ordered)
  satOfDet: Map<string, string>; // detKey -> Saturday ISO
  total: number;
}

/** Zone-group key: battery-operated detectors are their own group. */
function groupKey(d: { sheet: string; zone: number }): string {
  return `${d.sheet}|${d.zone}`;
}

/** All Saturdays of the quarter that contains `ymStr` (YYYY-MM), in order. */
export function quarterSaturdays(ymStr: string): string[] {
  const q = quarterWindow(ymStr);
  const start = ymParts(q.startYm).month;
  const end = ymParts(q.endYm).month;
  const out: string[] = [];
  for (let m = start; m <= end; m++) out.push(...saturdaysInMonth(q.year, m));
  return out.sort();
}

/**
 * Build the deterministic roster for the quarter containing `ymStr`.
 *
 * Algorithm:
 *  1. Group detectors by zone (template order preserved within a zone).
 *  2. Order zones largest-first and build a zone-interleaved sequence — pass p
 *     emits detector #p of every zone that still has one. Consecutive detectors
 *     are therefore from different zones, and big zones recur every pass.
 *  3. Deal that sequence out to Saturdays, each detector going to the Saturday
 *     with the fewest detectors so far (keeps the load even), breaking ties by
 *     the Saturday that has the fewest of this detector's zone (spreads zones),
 *     then by nearest to a rotating cursor (spreads across the calendar).
 */
export function buildQuarterPlan(ymStr: string): QuarterPlan {
  const q = quarterWindow(ymStr);
  const saturdays = quarterSaturdays(ymStr);
  const N = saturdays.length;

  const toScheduled = (d: any): ScheduledDet => {
    const id = d.id || `#${d.sn}`;
    const location = d.location || "";
    return {
      detKey: `${d.sheet}:${d.row}`,
      sheet: d.sheet,
      row: d.row,
      zone: d.zone,
      battery: d.sheet === "battery",
      id,
      location,
      dtype: d.dtype ?? null,
      kind: detKind(id, location),
      area: detArea(location),
      panel: detPanel(d),
    };
  };
  /** Zone-interleaved sequence: largest zone first (stable), pass p = detector #p of each zone. */
  const interleave = (dets: ScheduledDet[]): ScheduledDet[] => {
    const groups = new Map<string, ScheduledDet[]>();
    for (const sd of dets) {
      const k = groupKey(sd);
      const arr = groups.get(k);
      if (arr) arr.push(sd);
      else groups.set(k, [sd]);
    }
    const ordered = [...groups.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
    );
    const maxLen = ordered.reduce((m, [, a]) => Math.max(m, a.length), 0);
    const flat: ScheduledDet[] = [];
    for (let p = 0; p < maxLen; p++) for (const [, arr] of ordered) if (p < arr.length) flat.push(arr[p]);
    return flat;
  };

  // The original register is dealt exactly as it always was; the late
  // additions go on afterwards (see MERGED_FROM_YM).
  const original = masters.fireDetectors.filter((d: any) => !d.addedIn).map(toScheduled);
  const late = masters.fireDetectors.filter((d: any) => d.addedIn).map(toScheduled);

  const bySat = new Map<string, ScheduledDet[]>();
  const satOfDet = new Map<string, string>();
  for (const s of saturdays) bySat.set(s, []);

  if (N > 0) {
    const load = new Array(N).fill(0);
    const zoneCount = Array.from({ length: N }, () => new Map<string, number>());
    let cursor = 0;
    const deal = (flat: ScheduledDet[], allowed: (i: number) => boolean) => {
      for (const d of flat) {
        const zk = groupKey(d);
        let best = -1, bLoad = 0, bZone = 0, bOff = 0;
        for (let off = 0; off < N; off++) {
          const i = (cursor + off) % N;
          if (!allowed(i)) continue;
          const l = load[i];
          const z = zoneCount[i].get(zk) ?? 0;
          if (best < 0 || l < bLoad || (l === bLoad && z < bZone) || (l === bLoad && z === bZone && off < bOff)) {
            best = i; bLoad = l; bZone = z; bOff = off;
          }
        }
        load[best]++;
        zoneCount[best].set(zk, (zoneCount[best].get(zk) ?? 0) + 1);
        const sat = saturdays[best];
        bySat.get(sat)!.push(d);
        satOfDet.set(d.detKey, sat);
        cursor = (best + 1) % N;
      }
    };
    if (q.startYm >= MERGED_FROM_YM) {
      // Placeholders aren't detectors; leaving them out keeps the load even.
      const all = [...original, ...late]
        .filter((d) => !isPlaceholder(masters.fireDetectors.find((x: any) => x.sheet === d.sheet && x.row === d.row)))
        .sort((a, b) => Number(a.battery) - Number(b.battery) || a.row - b.row);
      deal(interleave(all), () => true);
    } else {
      deal(interleave(original), () => true);
      deal(interleave(late), () => true);
    }

    // Blank template rows stay in the deal above (so nothing else shifts) but
    // are not detectors, so they never appear on a round.
    for (const s of saturdays) {
      const kept = bySat.get(s)!.filter((d) => {
        const raw = masters.fireDetectors.find((x: any) => x.sheet === d.sheet && x.row === d.row);
        if (raw && isPlaceholder(raw)) { satOfDet.delete(d.detKey); return false; }
        return true;
      });
      // Tidy each Saturday's list into the physical walk order (E/R floor first,
      // then upward through the decks) so the engineer works one space at a time.
      bySat.set(s, sortByWalk(kept));
    }
  }

  return {
    label: q.label,
    year: q.year,
    startYm: q.startYm,
    endYm: q.endYm,
    saturdays,
    bySat,
    satOfDet,
    total: realDetectors().length,
  };
}

export interface FireSession {
  plan: QuarterPlan;
  sessionSat: string; // the Saturday to surface
  isToday: boolean;
}

/**
 * The plan + the Saturday session the app should surface for `todayIso`:
 * today if it is a scheduled Saturday, else the next upcoming Saturday. If the
 * quarter's last Saturday has passed, rolls into the next quarter.
 */
export function currentFireSession(todayIso: string): FireSession {
  let plan = buildQuarterPlan(todayIso.slice(0, 7));
  let sat = plan.saturdays.find((s) => s >= todayIso);
  if (!sat) {
    let ny = ymParts(plan.endYm).year;
    let nm = ymParts(plan.endYm).month + 1;
    if (nm > 12) { nm = 1; ny++; }
    plan = buildQuarterPlan(`${ny}-${String(nm).padStart(2, "0")}`);
    sat = plan.saturdays[0];
  }
  return { plan, sessionSat: sat, isToday: sat === todayIso };
}
