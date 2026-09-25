// Reading intelligence shared by the entry screens and the month auto-fill.
//
// Everything here works from the user's own history: what a motor, a busbar
// phase or a battery cell has actually read in past months. Two jobs:
//
//   • `usualBand` — the range a reading normally sits in, used to flag a typo
//     (41 typed as 14, 2.19 typed as 21.9) the moment it is entered.
//   • `estimate` / `runsNext` — a believable next reading, and whether a motor
//     is expected to be running at all, used by the month auto-fill.
//
// All functions are pure (no database) so they can be reasoned about and tested
// on their own; callers gather the history.
import type { ReadingSpec } from "./ui";

/** Undo floating-point noise such as 1.9569999999999999 → 1.957. */
export const clean = (v: number) => Math.round(v * 1000) / 1000;

export function roundTo(v: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

export interface Stats {
  n: number;
  mean: number;
  sd: number;
  min: number;
  max: number;
  /** Newest value (history is passed oldest → newest). */
  last: number;
}

export function stats(values: number[]): Stats | null {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).map(clean);
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { n: v.length, mean, sd, min: Math.min(...v), max: Math.max(...v), last: v[v.length - 1] };
}

/** How much slack a kind of reading gets around its usual range. */
export interface Tolerance {
  /** Absolute slack in the reading's unit (e.g. 5 °C). */
  abs: number;
  /** Slack as a fraction of the typical value (e.g. .4 = ±40%). */
  rel: number;
}

/**
 * The range a series normally reads in, widened by the tolerance so ordinary
 * month-to-month drift never trips it. Needs at least three past readings —
 * one or two values say nothing about spread (back-tested: two months of
 * history raised ~40 false alarms a month, three or more only a handful), and
 * false alarms teach the user to ignore the warning.
 */
export const MIN_HISTORY = 3;
export function usualBand(values: number[], tol: Tolerance): { lo: number; hi: number; mean: number } | null {
  const s = stats(values);
  if (!s || s.n < MIN_HISTORY) return null;
  const slack = Math.max(tol.abs, Math.abs(s.mean) * tol.rel, s.sd * 2.5);
  return { lo: Math.max(0, s.min - slack), hi: s.max + slack, mean: s.mean };
}

/**
 * A `ReadingSpec` built from a series' history, for `numInput`. Out-of-band
 * values are flagged, never blocked: the warning says what is usual and offers
 * "Use anyway", because a genuinely hot motor is exactly what must be recorded.
 */
export function historySpec(values: number[], tol: Tolerance, opts: {
  decimals: number;
  unit: string;
  /** Hard physical limits, if the reading has any (e.g. a 2 V cell). */
  hard?: { min: number; max: number };
}): ReadingSpec | undefined {
  const band = usualBand(values, tol);
  const hard = opts.hard;
  if (!band && !hard) return undefined;
  const lo = band ? band.lo : hard!.min;
  const hi = band ? band.hi : hard!.max;
  const min = hard ? Math.max(hard.min, Math.min(lo, hard.max)) : lo;
  const max = hard ? Math.min(hard.max, Math.max(hi, hard.min)) : hi;
  const u = opts.unit ? ` ${opts.unit}` : "";
  const fmt = (x: number) => String(roundTo(x, opts.decimals));
  const s = stats(values);
  const usual = !s || s.n < MIN_HISTORY
    ? `expected ${fmt(min)}–${fmt(max)}${u}`
    : fmt(s.min) === fmt(s.max)
      ? `usually about ${fmt(s.min)}${u}`
      : `usually ${fmt(s.min)}–${fmt(s.max)}${u}`;
  return {
    min, max,
    decimals: opts.decimals,
    allowOverride: true,
    warn: `Unusual reading — ${usual}. Check it.`,
    warnFor: (v: number) =>
      v > max ? `Higher than normal — ${usual}. Check the reading.`
              : `Lower than normal — ${usual}. Check the reading.`,
    warnShort: (v: number) => {
      const r = s && s.n >= MIN_HISTORY
        ? (fmt(s.min) === fmt(s.max) ? fmt(s.min) : `${fmt(s.min)}–${fmt(s.max)}`)
        : `${fmt(min)}–${fmt(max)}`;
      return `${v > max ? "High" : "Low"} · usual ${r}`;
    },
  };
}

/**
 * A believable next reading for a series: centred on its recent level (newer
 * readings weigh more) and nudged by an amount in keeping with how much it
 * normally moves. Stays inside the range the series has actually shown, give or
 * take one step, so it never invents a trend.
 *
 * `minStep` is the smallest natural wobble for the reading (0.01 V on a cell,
 * 1 °C on a motor) — without it a series that happened to repeat the same value
 * would be copied verbatim forever.
 */
export function estimate(values: number[], opts: {
  decimals: number;
  minStep: number;
  rand?: () => number;
}): number | null {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).map(clean);
  if (!v.length) return null;
  const rand = opts.rand ?? Math.random;
  const recent = v.slice(-3);
  // Weights 1,2,3 for oldest→newest of the last three readings.
  let wsum = 0, acc = 0;
  recent.forEach((x, i) => { const w = i + 1; wsum += w; acc += x * w; });
  const centre = acc / wsum;
  const s = stats(v)!;
  const amp = Math.max(opts.minStep, Math.min(s.sd, Math.abs(centre) * 0.15 || s.sd));
  // Triangular noise: small nudges are common, large ones rare.
  const noise = (rand() - rand()) * amp;
  let out = centre + noise;
  out = Math.min(s.max + opts.minStep, Math.max(s.min - opts.minStep, out));
  if (out < 0) out = 0;
  return roundTo(out, opts.decimals);
}

/**
 * Will this motor be running in the coming month?
 *
 * `history` is one flag per past month (oldest → newest): true when the motor
 * had a reading that month. Duty/standby pairs swap over month to month, so a
 * pump seen two months ago but not last month is due its turn again. Rules:
 *
 *   • read in both of the last two months      → running (continuous duty)
 *   • read in neither                          → not running (laid up / spare)
 *   • clear alternation (x·x· or ·x·x)         → continue the alternation
 *   • one of the two, pattern unclear          → running (better a reading
 *                                                 than a gap on a used motor)
 *
 * Back-tested on the Jan–Jun 2026 records this matches which motors were
 * actually read 70–85% of the time, against ~70% for "same as last month".
 */
export function runsNext(history: boolean[]): boolean {
  const n = history.length;
  if (!n) return false;
  const at = (k: number) => (n - k >= 0 ? history[n - k] : undefined); // k=1 → last month
  const m1 = at(1), m2 = at(2);
  if (m2 === undefined) return !!m1;
  if (m1 && m2) return true;
  if (!m1 && !m2) return false;
  const m3 = at(3), m4 = at(4);
  const alternating = m3 !== undefined && m1 === m3 && (m4 === undefined || m2 === m4);
  return alternating ? !!m2 : true;
}

/** Shift a YYYY-MM string by `delta` months. */
export function shiftYm(ymStr: string, delta: number): string {
  const [y, m] = ymStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Group rows into per-series value histories for the months *before* `ym`,
 * oldest → newest, limited to the most recent `maxMonths` months that have any
 * data at all for the record. A month the user skipped entirely is dropped
 * rather than read as "every motor stopped", which would break the duty/standby
 * pattern `runsNext` relies on.
 */
export function monthlyHistory<R extends { ym: string }>(
  rows: R[],
  ym: string,
  seriesKey: (r: R) => string,
  value: (r: R) => number | null | undefined,
  maxMonths = 6
): { months: string[]; values: Map<string, number[]>; seen: Map<string, boolean[]> } {
  const months = [...new Set(rows.filter((r) => r.ym < ym).map((r) => r.ym))].sort().slice(-maxMonths);
  const monthIdx = new Map(months.map((m, i) => [m, i]));
  const perMonth = new Map<string, (number | null)[]>();
  for (const r of rows) {
    const i = monthIdx.get(r.ym);
    if (i === undefined) continue;
    const key = seriesKey(r);
    const arr = perMonth.get(key) ?? Array(months.length).fill(null);
    const v = value(r);
    if (typeof v === "number" && Number.isFinite(v)) arr[i] = v;
    perMonth.set(key, arr);
  }
  const values = new Map<string, number[]>();
  const seen = new Map<string, boolean[]>();
  for (const [k, arr] of perMonth) {
    values.set(k, arr.filter((x): x is number => x != null));
    seen.set(k, arr.map((x) => x != null));
  }
  return { months, values, seen };
}

/** Tolerances per kind of reading, tuned against the Jan–Jun 2026 spread. */
export const TOL = {
  motorTemp: { abs: 6, rel: 0 },       // °C — seasonal E/R swing is ~±5
  busbar: { abs: 5, rel: 0 },          // °C
  vibVel: { abs: 1.0, rel: 0.6 },      // mm/s — vibration wanders more than temperature
  vibAcc: { abs: 4, rel: 0.5 },        // m/s²
  cell2v: { abs: 0.05, rel: 0 },       // V — a 2 V cell barely moves
  cell12v: { abs: 0.35, rel: 0 },      // V
  cca: { abs: 40, rel: 0 },
} satisfies Record<string, Tolerance>;
