export const MONTHS_FULL = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

export function debounce<T extends (...a: any[]) => void>(fn: T, ms = 300): T {
  let t: any;
  return ((...args: any[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T;
}
