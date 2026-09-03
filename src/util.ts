export const MONTHS_FULL = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Weekday abbreviations indexed by Date.getDay() (0 = Sunday). */
export const DOW_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function ym(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
export function ymParts(ymStr: string): { year: number; month: number } {
  const [y, m] = ymStr.split("-").map(Number);
  return { year: y, month: m };
}
export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function parseIso(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function isSaturday(date: Date): boolean {
  return date.getDay() === 6;
}
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
export function lastDayOfMonth(year: number, month: number): Date {
  return new Date(year, month, 0);
}
/** All Saturdays (as ISO) in a given year-month. */
export function saturdaysInMonth(year: number, month: number): string[] {
  const out: string[] = [];
  const dim = daysInMonth(year, month);
  for (let d = 1; d <= dim; d++) {
    const date = new Date(year, month - 1, d);
    if (date.getDay() === 6) out.push(isoDate(date));
  }
  return out;
}

/**
 * Reported month for month-end export:
 * If today is the 1st–14th -> previous month (still closing last month).
 * Otherwise -> current month.
 */
export function defaultReportYm(today = new Date()): string {
  const d = today.getDate();
  const date = new Date(today.getFullYear(), today.getMonth(), 1);
  if (d <= 14) date.setMonth(date.getMonth() - 1);
  return ym(date);
}

export function monthLabel(ymStr: string): string {
  const { year, month } = ymParts(ymStr);
  return `${MONTHS_FULL[month - 1]} ${year}`;
}

/** DD.MM.YYYY for text date cells (battery "last test" style). */
export function ddmmyyyy(iso: string): string {
  const { getFullYear, getMonth, getDate } = parseIso(iso);
  const d = parseIso(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

/** Human date as DD MMM YYYY (e.g. 2026-07-04 -> "04 JUL 2026"). */
export function ddMmmYyyy(iso: string): string {
  const d = parseIso(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS_SHORT[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
}

/** Excel serial date number (1900 system) for a JS Date. */
export function excelSerial(date: Date): number {
  const epoch = Date.UTC(1899, 11, 30);
  const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((utc - epoch) / 86400000);
}

export function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  return String(n);
}

/** Quarter window for the fire-detector file, e.g. 2026-07 -> {range:"JULY-SEPTEMBER", ...}. */
export function quarterWindow(ymStr: string): { label: string; startYm: string; endYm: string; year: number } {
  const { year, month } = ymParts(ymStr);
  const qStartMonth = Math.floor((month - 1) / 3) * 3 + 1; // 1,4,7,10
  const qEndMonth = qStartMonth + 2;
  const label = `${MONTHS_FULL[qStartMonth - 1]}-${MONTHS_FULL[qEndMonth - 1]}`;
  return {
    label,
    startYm: `${year}-${String(qStartMonth).padStart(2, "0")}`,
    endYm: `${year}-${String(qEndMonth).padStart(2, "0")}`,
    year,
  };
}

/** Number of weeks (Saturdays) in a month — drives the slipring week count. */
export function weeksInMonth(year: number, month: number): number {
  return saturdaysInMonth(year, month).length;
}

/**
 * Deterministic prefill for a slipring week reading (15–20 mV). Stable for a
 * given month+week so the on-screen placeholder and the exported value agree
 * without persisting anything. Used when the user leaves a week blank.
 */
export function slipringDefault(ymStr: string, weekIndex: number): number {
  let hsh = 2166136261;
  const s = `${ymStr}#${weekIndex}`;
  for (let k = 0; k < s.length; k++) {
    hsh ^= s.charCodeAt(k);
    hsh = Math.imul(hsh, 16777619);
  }
  return 15 + (Math.abs(hsh) % 6); // 15..20 inclusive
}

/**
 * The calendar days belonging to slipring week `weekIndex` of a month.
 *
 * A "week" on this sheet is the stretch of days ending on that week's Saturday:
 * week 1 runs from the 1st to the first Saturday, week 2 from the day after
 * that to the second Saturday, and so on. The last week also picks up any days
 * after the final Saturday, so every day of the month lands in exactly one
 * week and none is left out of the averages.
 */
export function slipringWeekDays(ymStr: string, weekIndex: number): string[] {
  const { year, month } = ymParts(ymStr);
  const sats = saturdaysInMonth(year, month);
  if (weekIndex < 0 || weekIndex >= sats.length) return [];
  const dim = daysInMonth(year, month);
  const startDay = weekIndex === 0 ? 1 : parseIso(sats[weekIndex - 1]).getDate() + 1;
  const isLast = weekIndex === sats.length - 1;
  const endDay = isLast ? dim : parseIso(sats[weekIndex]).getDate();
  const out: string[] = [];
  for (let d = startDay; d <= endDay; d++) {
    out.push(`${ymStr}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Average shaft potential (mV) over a slipring week, from the daily readings.
 *
 * Returns null when the week has no reading to average — the caller decides
 * what to do with an empty week. Days at Port/Anchor record a shaft potential
 * of 0 because the shaft isn't turning; those are real readings and are
 * included, otherwise a month spent alongside would report no value at all.
 */
export function slipringAverage(
  ymStr: string,
  weekIndex: number,
  shaftByDate: Map<string, number | null | undefined>
): number | null {
  const vals: number[] = [];
  for (const iso of slipringWeekDays(ymStr, weekIndex)) {
    const v = shaftByDate.get(iso);
    if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(mean);
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms = 300): T {
  let t: any;
  return ((...args: any[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}
