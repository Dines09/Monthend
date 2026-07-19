// Month -> column mappings per template (1-based column indices), derived from the June originals.

// Busbar (TEC A 16): sheet "TEC (16) A". Jan=E(5) ... Dec=P(16). Data rows per panel; check date row 9; ECR row 42.
export const busbarMonthCol = (month: number) => 4 + month; // Jan(1)->5

// Freon (TEC A 33): sheet "TEC(A) 33". Jan=D(4) ... Dec=O(15).
export const freonMonthCol = (month: number) => 3 + month; // Jan->4

// Motor Temp (TEC A 12): sheet "MOTORS TEMP". Jan=E(5) ... Dec=P(16). ER temp row 9.
export const motorTempMonthCol = (month: number) => 4 + month; // Jan->5

// Vibration (TEC A 15): sheet "TECH(A)15". Jan Vel=E(5)/Acc=F(6); each month = 2 cols.
export const vibrationVelCol = (month: number) => 5 + (month - 1) * 2; // Jan->5
export const vibrationAccCol = (month: number) => vibrationVelCol(month) + 1;

// Condition monitoring Temperature sheet: Jan Temp=D(4), then each month spans 3 cols (Temp/Diff/Norm).
export const cmTempCol = (month: number) => 4 + (month - 1) * 3; // Jan->4 (D). ER temp row 6.
// Condition monitoring Vibration sheet: Jan Vel=C(3)/Acc=D(4); each month 2 cols.
export const cmVibVelCol = (month: number) => 3 + (month - 1) * 2; // Jan->3
export const cmVibAccCol = (month: number) => cmVibVelCol(month) + 1;

// ICCP daily: sheet "ICCP+MGPS+SED". Day d -> row 11 + d. Columns:
export const ICCP_COLS = {
  area: 2, draft: 4, seaTemp: 6, amp: 8, volt: 10, cell1: 12, cell2: 14,
  cu1: 16, al1: 18, cu2: 20, al2: 22, seaChest: 24, shaftMv: 26,
} as const;

// Battery: sheet "Tech(A) 17". Week columns: (aux col, volt col) pairs.
export const BATTERY_WEEK_COLS: [number, number][] = [
  [2, 3], [4, 5], [6, 7], [8, 9], [10, 11],
];
// Battery bank layout (rows) — mirrors seed extraction.
export const BATTERY_BANKS = [
  { id: "gs", dateRow: 13, cellRows: range(15, 26), totalRow: 27, remarkRow: 28 },
  { id: "gmdss", dateRow: 33, cellRows: range(35, 46), totalRow: 47, remarkRow: 48 },
  { id: "lbport", dateRow: 53, cellRows: [55, 56], totalRow: 58, remarkRow: 59 },
  { id: "lbstbd", dateRow: 64, cellRows: [66, 67], totalRow: 69, remarkRow: 70 },
  { id: "emgen", dateRow: 75, cellRows: [81, 82], totalRow: 86, remarkRow: 87 },
];

function range(a: number, b: number): number[] {
  const out = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

export function colLetter(col: number): string {
  let s = "";
  while (col > 0) {
    const r = (col - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}
