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

export interface ScheduledDet {
  detKey: string; // `${sheet}:${row}` — matches FireTest.detKey
  sheet: string;
  row: number;
  zone: number;
  battery: boolean; // battery-operated set (its own group, own sheet)
  id: string; // detector name / tag
  location: string;
  dtype: string | null;
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

  const groups = new Map<string, ScheduledDet[]>();
  for (const d of masters.fireDetectors) {
    const sd: ScheduledDet = {
      detKey: `${d.sheet}:${d.row}`,
      sheet: d.sheet,
      row: d.row,
      zone: d.zone,
      battery: d.sheet === "battery",
      id: d.id || `#${d.sn}`,
      location: d.location || "",
      dtype: d.dtype ?? null,
    };
    const k = groupKey(d);
    const arr = groups.get(k);
    if (arr) arr.push(sd);
    else groups.set(k, [sd]);
  }

  const bySat = new Map<string, ScheduledDet[]>();
  const satOfDet = new Map<string, string>();
  for (const s of saturdays) bySat.set(s, []);

  if (N > 0) {
    // Zones largest-first (stable) so heavy zones lead each interleave pass.
    const ordered = [...groups.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
    );
    const maxLen = ordered.reduce((m, [, a]) => Math.max(m, a.length), 0);
    const flat: ScheduledDet[] = [];
    for (let p = 0; p < maxLen; p++) for (const [, arr] of ordered) if (p < arr.length) flat.push(arr[p]);

    const load = new Array(N).fill(0);
    const zoneCount = Array.from({ length: N }, () => new Map<string, number>());
    let cursor = 0;
    for (const d of flat) {
      const zk = groupKey(d);
      let best = -1, bLoad = 0, bZone = 0, bOff = 0;
      for (let off = 0; off < N; off++) {
        const i = (cursor + off) % N;
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

    // Tidy each Saturday's list into zone order (battery-operated last).
    for (const s of saturdays) {
      bySat.get(s)!.sort(
        (a, b) => Number(a.battery) - Number(b.battery) || a.zone - b.zone || a.row - b.row
      );
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
    total: masters.fireDetectors.length,
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

/** Distinct zones present in a Saturday's list, labelled ("3", "B1", …). */
export function zoneLabels(dets: ScheduledDet[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dets) {
    const l = d.battery ? `B${d.zone}` : String(d.zone);
    if (!seen.has(l)) { seen.add(l); out.push(l); }
  }
  return out;
}
