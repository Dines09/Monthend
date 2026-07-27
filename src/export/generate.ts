import ExcelJS from "exceljs";
import { db, getSetting } from "../db";
import { masters } from "../seed";
import { recById } from "../records";
import {
  MONTHS_FULL, ymParts, excelSerial, parseIso, quarterWindow, ddmmyyyy,
  saturdaysInMonth, slipringDefault,
} from "../util";
import {
  busbarMonthCol, freonMonthCol, freonValueFor, motorTempMonthCol, vibrationVelCol, vibrationAccCol,
  cmTempCol, cmVibVelCol, cmVibAccCol, ICCP_COLS, BATTERY_WEEK_COLS, BATTERY_BANKS, colLetter,
} from "./columns";

// Write a live Excel SUM formula (with the JS-computed value as cached result so
// it shows correctly even before Excel recalculates). Uses a first:last range
// (e.g. SUM(C15:C26)) like the original workbooks, not an enumerated cell list.
function setSumFormula(ws: ExcelJS.Worksheet, row: number, col: number, cellRows: number[], result: number | null) {
  const L = colLetter(col);
  const first = cellRows[0];
  const last = cellRows[cellRows.length - 1];
  const ref = first === last ? `${L}${first}` : `${L}${first}:${L}${last}`;
  ws.getCell(row, col).value = { formula: `SUM(${ref})`, result: result ?? 0 } as any;
}

const TEMPLATE_BASE = import.meta.env.BASE_URL + "templates/";

async function loadTemplate(name: string): Promise<ExcelJS.Workbook> {
  const res = await fetch(TEMPLATE_BASE + name);
  if (!res.ok) throw new Error(`template ${name} not found`);
  const buf = await res.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

// Write a value while preserving the cell's existing style/number-format.
function setVal(ws: ExcelJS.Worksheet, row: number, col: number, value: any) {
  const cell = ws.getCell(row, col);
  cell.value = value === undefined ? null : value;
}
function clearRange(ws: ExcelJS.Worksheet, row: number, col: number) {
  ws.getCell(row, col).value = null;
}

async function toBlob(wb: ExcelJS.Workbook): Promise<Blob> {
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export interface ExportResult {
  filename: string;
  blob: Blob;
}

// ---------- Header helpers ----------
function reportDateSerial(ymStr: string): number {
  const { year, month } = ymParts(ymStr);
  const last = new Date(year, month, 0);
  return excelSerial(last);
}

// =================================================================
//  BUSBAR (TEC A 16) — cumulative
// =================================================================
export async function genBusbar(ymStr: string): Promise<ExportResult> {
  const { year, month } = ymParts(ymStr);
  const wb = await loadTemplate("busbar.xlsx");
  const ws = wb.getWorksheet("TEC (16) A")!;
  const vessel = await getSetting("vessel", "SEAWAYS MIRAGE");
  ws.getCell("B4").value = vessel;
  ws.getCell("O5").value = reportDateSerial(ymStr);
  ws.getCell("O6").value = year;

  const phaseOrder = ["U", "V", "W"];
  // Clear + rewrite all 12 months from DB (cumulative)
  for (let m = 1; m <= 12; m++) {
    const col = busbarMonthCol(m);
    const mym = `${year}-${String(m).padStart(2, "0")}`;
    const rows = await db.busbar.where("ym").equals(mym).toArray();
    const map = new Map(rows.map((r) => [`${r.panelRow}:${r.phase}`, r.value]));
    const meta = await db.busbarMeta.get(mym);
    // check date (row 9)
    setVal(ws, 9, col, meta?.checkDate ? excelSerial(parseIso(meta.checkDate)) : null);
    // ECR (row 42)
    setVal(ws, 42, col, meta?.ecr ?? null);
    for (const p of masters.busbarPanels) {
      phaseOrder.forEach((ph, i) => {
        setVal(ws, p.row + i, col, map.get(`${p.row}:${ph}`) ?? null);
      });
    }
  }
  return { filename: fileName("busbar", ymStr), blob: await toBlob(wb) };
}

// =================================================================
//  FREON (TEC A 33) — cumulative with ROB chain
// =================================================================
export async function genFreon(ymStr: string): Promise<ExportResult> {
  const { year } = ymParts(ymStr);
  const wb = await loadTemplate("freon.xlsx");
  const ws = wb.getWorksheet("TEC(A) 33")!;
  ws.getCell("B4").value = await getSetting("vessel", "SEAWAYS MIRAGE");
  ws.getCell("P5").value = reportDateSerial(ymStr);
  ws.getCell("P6").value = year;

  let rob = masters.freonRobStartJan ?? 0;
  for (let m = 1; m <= 12; m++) {
    const col = freonMonthCol(m);
    const mym = `${year}-${String(m).padStart(2, "0")}`;
    const rows = await db.freon.where("ym").equals(mym).toArray();
    const map = new Map(rows.map((r) => [r.systemRow, r.consumed]));
    let totalCons = 0;
    for (const s of masters.freonSystems) {
      // Workshop AC, Inert Gas / Chilling Plant and Cargo Switchboard never
      // carry a figure on this vessel, and Bridge AC only appears when one was
      // entered. `freonValueFor` is the single rule the screen shares, so the
      // sheet and the ROB total can't drift from what the user sees.
      const v = freonValueFor(s.row, map.get(s.row));
      setVal(ws, s.row, col, v);
      totalCons += v ?? 0;
    }
    const meta = await db.freonMeta.get(mym);
    // Write received exactly as recorded (0 included); null only when no value was entered.
    const received = meta?.received ?? 0;
    const receivedCell = meta && meta.received !== undefined && meta.received !== null ? meta.received : null;
    // ROB rows: 19 last month, 20 total consumed, 21 received, 22 rob end
    setVal(ws, 19, col, rob);
    setVal(ws, 20, col, totalCons);
    setVal(ws, 21, col, receivedCell);
    const robEnd = rob - totalCons + received;
    setVal(ws, 22, col, robEnd);
    rob = robEnd;
  }
  return { filename: fileName("freon", ymStr), blob: await toBlob(wb) };
}

// =================================================================
//  MOTOR TEMP (TEC A 12) — cumulative
// =================================================================
export async function genMotorTemp(ymStr: string): Promise<ExportResult> {
  const { year } = ymParts(ymStr);
  const wb = await loadTemplate("motortemp.xlsx");
  const ws = wb.getWorksheet("MOTORS TEMP")!;
  ws.getCell("B4").value = await getSetting("vesselMT", "M.T SEAWAYS MIRAGE");
  ws.getCell("O5").value = reportDateSerial(ymStr);
  ws.getCell("O6").value = year;

  for (let m = 1; m <= 12; m++) {
    const col = motorTempMonthCol(m);
    const mym = `${year}-${String(m).padStart(2, "0")}`;
    const rows = await db.motorTemp.where("ym").equals(mym).toArray();
    const map = new Map(rows.map((r) => [r.motorRow, r.temp]));
    const er = await db.motorErTemp.get(`motortemp:${mym}`);
    setVal(ws, 9, col, er?.value ?? null);
    for (const mo of masters.motorTempMotors) {
      setVal(ws, mo.row, col, map.get(mo.row) ?? null);
    }
  }
  return { filename: fileName("motortemp", ymStr), blob: await toBlob(wb) };
}

// =================================================================
//  VIBRATION (TEC A 15) — cumulative
// =================================================================
export async function genVibration(ymStr: string): Promise<ExportResult> {
  const { year } = ymParts(ymStr);
  const wb = await loadTemplate("vibration.xlsx");
  const ws = wb.getWorksheet("TECH(A)15")!;
  ws.getCell("B5").value = await getSetting("vessel", "SEAWAYS MIRAGE");
  ws.getCell("W7").value = ddmmyyyy(lastDayIso(ymStr));

  for (let m = 1; m <= 12; m++) {
    const velCol = vibrationVelCol(m);
    const accCol = vibrationAccCol(m);
    const mym = `${year}-${String(m).padStart(2, "0")}`;
    const rows = await db.motorVibration.where("ym").equals(mym).toArray();
    const map = new Map(rows.map((r) => [`${r.motorRow}:${r.end}`, r]));
    for (const mo of masters.vibrationMotors) {
      const drive = map.get(`${mo.row}:drive`);
      const free = map.get(`${mo.row}:free`);
      setVal(ws, mo.row, velCol, drive?.vel ?? null);
      setVal(ws, mo.row, accCol, drive?.acc ?? null);
      setVal(ws, mo.row + 1, velCol, free?.vel ?? null);
      setVal(ws, mo.row + 1, accCol, free?.acc ?? null);
    }
  }
  return { filename: fileName("vibration", ymStr), blob: await toBlob(wb) };
}

// =================================================================
//  CONDITION MONITORING — cumulative (Temperature + Vibration sheets)
// =================================================================
export async function genConditionMon(ymStr: string): Promise<ExportResult> {
  const { year } = ymParts(ymStr);
  const wb = await loadTemplate("conditionmon.xlsx");
  const wt = wb.getWorksheet("Temperature")!;
  const wv = wb.getWorksheet("Vibration")!;

  for (let m = 1; m <= 12; m++) {
    const mym = `${year}-${String(m).padStart(2, "0")}`;
    // Temperature
    const tcol = cmTempCol(m);
    const trows = await db.cmTemp.where("ym").equals(mym).toArray();
    const tmap = new Map(trows.map((r) => [r.motorRow, r.temp]));
    const er = await db.motorErTemp.get(`conditionmon:${mym}`);
    setVal(wt, 6, tcol, er?.value ?? null);
    for (const mo of masters.cmTempMotors) {
      setVal(wt, mo.row, tcol, tmap.get(mo.row) ?? null);
      // Diff/Normalised are formula columns — leave the template formulas intact.
    }
    // Vibration
    const vvel = cmVibVelCol(m);
    const vacc = cmVibAccCol(m);
    const vrows = await db.cmVib.where("ym").equals(mym).toArray();
    const vmap = new Map(vrows.map((r) => [r.motorRow, r]));
    for (const mo of masters.cmVibMotors) {
      const r = vmap.get(mo.row);
      setVal(wv, mo.row, vvel, r?.vel ?? null);
      setVal(wv, mo.row, vacc, r?.acc ?? null);
    }
  }
  return { filename: fileName("conditionmon", ymStr), blob: await toBlob(wb) };
}

// =================================================================
//  ICCP / MGPS — month-only
// =================================================================
export async function genIccp(ymStr: string): Promise<ExportResult> {
  const { year, month } = ymParts(ymStr);
  const wb = await loadTemplate("iccp.xlsx");
  const ws = wb.getWorksheet("ICCP+MGPS+SED")!;
  ws.getCell("E5").value = await getSetting("vessel", "Seaways Mirage");
  ws.getCell("W6").value = MONTHS_FULL[month - 1];
  ws.getCell("Z6").value = year;

  const dim = new Date(year, month, 0).getDate();
  const all = await db.iccpDaily.toArray();
  const byDate = new Map(all.map((d) => [d.date, d]));
  for (let day = 1; day <= 31; day++) {
    const r = 11 + day;
    const iso = `${ymStr}-${String(day).padStart(2, "0")}`;
    const rec = day <= dim ? byDate.get(iso) : undefined;
    setVal(ws, r, ICCP_COLS.area, rec?.area ?? null);
    setVal(ws, r, ICCP_COLS.draft, rec?.draft ?? null);
    setVal(ws, r, ICCP_COLS.seaTemp, rec?.seaTemp ?? null);
    setVal(ws, r, ICCP_COLS.amp, rec?.amp ?? null);
    setVal(ws, r, ICCP_COLS.volt, rec?.volt ?? null);
    setVal(ws, r, ICCP_COLS.cell1, rec?.cell1 ?? null);
    setVal(ws, r, ICCP_COLS.cell2, rec?.cell2 ?? null);
    setVal(ws, r, ICCP_COLS.cu1, rec?.cu1 ?? null);
    setVal(ws, r, ICCP_COLS.al1, rec?.al1 ?? null);
    setVal(ws, r, ICCP_COLS.cu2, rec?.cu2 ?? null);
    setVal(ws, r, ICCP_COLS.al2, rec?.al2 ?? null);
    setVal(ws, r, ICCP_COLS.seaChest, rec?.seaChest ?? null);
    setVal(ws, r, ICCP_COLS.shaftMv, rec?.shaftMv ?? null);
  }
  // monthly footer
  const mon = await db.iccpMonthly.get(ymStr);
  if (mon) {
    // observations: rows 47..52, mark "*" under the chosen level column
    const obsRows: [string, number][] = [
      ["foulingStrainer", 47], ["foulingPipeline", 48], ["foulingHeatExch", 49],
      ["corrosionStrainer", 50], ["corrosionPipeline", 51], ["corrosionHeatExch", 52],
    ];
    const levelCol: Record<string, number> = { Nil: 7, Light: 10, Medium: 13, Heavy: 16 };
    for (const [key, row] of obsRows) {
      for (const c of [7, 10, 13, 16]) clearRange(ws, row, c);
      const lvl = mon.obs?.[key];
      if (lvl && levelCol[lvl]) setVal(ws, row, levelCol[lvl], "*");
    }
    if (mon.strainerNote) setVal(ws, 45, 7, mon.strainerNote);
    if (mon.remark) setVal(ws, 55, 1, mon.remark);
  }
  // Slipring weeks (template rows 46–50): stored value first, else a stable
  // 15–20 mV default for weeks that actually occur this month, else blank.
  const weeks = saturdaysInMonth(year, month).length;
  const slip = mon?.slipring ?? [];
  for (let i = 0; i < 5; i++) {
    const v = slip[i] ?? (i < weeks ? slipringDefault(ymStr, i) : null);
    setVal(ws, 46 + i, 26, v);
  }
  return { filename: fileName("iccp", ymStr), blob: await toBlob(wb) };
}

// =================================================================
//  BATTERY LOG — month-only (up to 5 Saturday columns)
// =================================================================
export async function genBattery(ymStr: string): Promise<ExportResult> {
  const { year, month } = ymParts(ymStr);
  const wb = await loadTemplate("battery.xlsx");
  const ws = wb.getWorksheet("Tech(A) 17")!;
  ws.getCell("C4").value = await getSetting("vesselMT", "M.T. SEAWAYS MIRAGE");
  ws.getCell("B6").value = MONTHS_FULL[month - 1];
  ws.getCell("J6").value = excelSerial(new Date(year, month - 1, 1));

  // Saturdays of this month
  const sats: string[] = [];
  const dim = new Date(year, month, 0).getDate();
  for (let d = 1; d <= dim; d++) {
    const date = new Date(year, month - 1, d);
    if (date.getDay() === 6) sats.push(`${ymStr}-${String(d).padStart(2, "0")}`);
  }

  const entries = await db.battery.toArray();
  for (const bank of BATTERY_BANKS) {
    for (let wi = 0; wi < BATTERY_WEEK_COLS.length; wi++) {
      const [auxCol, voltCol] = BATTERY_WEEK_COLS[wi];
      const satDate = sats[wi];
      // date header
      setVal(ws, bank.dateRow, auxCol, satDate ? excelSerial(parseIso(satDate)) : null);
      // clear cells
      for (const r of bank.cellRows) { clearRange(ws, r, auxCol); clearRange(ws, r, voltCol); }
      clearRange(ws, bank.totalRow, voltCol);
      clearRange(ws, bank.remarkRow, auxCol);
      if (!satDate) continue;
      const entry = entries.find((e) => e.date === satDate && e.bankId === bank.id);
      if (!entry) continue;
      let voltSum = 0;
      const filledRows: number[] = [];
      entry.readings.forEach((rd, i) => {
        const r = bank.cellRows[i];
        if (r == null) return;
        setVal(ws, r, auxCol, rd.aux ?? null);
        setVal(ws, r, voltCol, rd.volt ?? null);
        if (typeof rd.volt === "number") { voltSum += rd.volt; filledRows.push(r); }
      });
      // Write a LIVE SUM formula (like the original workbook) over this bank's
      // cell rows in this week's volt column. Cached result = entered total if
      // present, else the computed sum, so it displays before recalculation.
      if (filledRows.length) {
        const cached = entry.total ?? voltSum;
        setSumFormula(ws, bank.totalRow, voltCol, bank.cellRows, cached);
      } else {
        setVal(ws, bank.totalRow, voltCol, entry.total ?? null);
      }
      setVal(ws, bank.remarkRow, auxCol, entry.remark ?? null);
    }
  }
  return { filename: fileName("battery", ymStr), blob: await toBlob(wb) };
}

// =================================================================
//  FIRE DETECTOR (TEC A 37) — quarterly
// =================================================================
export async function genFire(ymStr: string): Promise<ExportResult> {
  const q = quarterWindow(ymStr);
  const wb = await loadTemplate("firedetector.xlsx");
  const wsMain = wb.getWorksheet("Sheet1")!;
  const wsBatt = wb.getWorksheet("Sheet3")!;

  const tests = await db.fireTest.toArray();
  // For each detector, tests within the quarter window and the latest prior test.
  const byDet = new Map<string, { thisQ?: string; prior?: string }>();
  for (const t of tests) {
    const m = t.testedDate.slice(0, 7);
    const rec = byDet.get(t.detKey) ?? {};
    if (m >= q.startYm && m <= q.endYm) {
      if (!rec.thisQ || t.testedDate > rec.thisQ) rec.thisQ = t.testedDate;
    } else if (m < q.startYm) {
      if (!rec.prior || t.testedDate > rec.prior) rec.prior = t.testedDate;
    }
    byDet.set(t.detKey, rec);
  }

  const lastDay = lastDayIso(ymStr);
  wsMain.getCell("H4").value = excelSerial(parseIso(lastDay));
  wsMain.getCell("H5").value = q.year;
  wsBatt.getCell("H4").value = excelSerial(parseIso(lastDay));
  wsBatt.getCell("H5").value = q.year;

  for (const d of masters.fireDetectors) {
    const ws = d.sheet === "battery" ? wsBatt : wsMain;
    const rec = byDet.get(`${d.sheet}:${d.row}`);
    // col E(5) date last tested, F(6) date tested this quarter, G(7) next due, H(8) remarks
    setVal(ws, d.row, 5, rec?.prior ? excelSerial(parseIso(rec.prior)) : null);
    if (rec?.thisQ) {
      setVal(ws, d.row, 6, excelSerial(parseIso(rec.thisQ)));
      // next due = tested + 3 months
      const nd = new Date(parseIso(rec.thisQ)); nd.setMonth(nd.getMonth() + 3);
      setVal(ws, d.row, 7, excelSerial(nd));
      setVal(ws, d.row, 8, rec.remarks ?? "satisfactory");
    } else {
      setVal(ws, d.row, 6, null);
      setVal(ws, d.row, 8, null);
    }
  }
  const filename = `${recById("firedetector").baseName} ${q.label} ${q.year}.xlsx`;
  return { filename, blob: await toBlob(wb) };
}

// =================================================================
//  OVERHAUL (TEC 05C) — carry-forward register
// =================================================================
export async function genOverhaul(ymStr: string): Promise<ExportResult> {
  const wb = await loadTemplate("overhaul.xlsx");
  const ws = wb.getWorksheet("TEC 05C")!;
  ws.getCell("I6").value = reportDateSerial(ymStr);

  const rows = await db.overhaul.toArray();
  for (const r of rows) {
    // J(10) megger, I(9) last overhaul, K(11) remarks
    if (r.lastOverhaul) setVal(ws, r.row, 9, excelSerial(parseIso(r.lastOverhaul)));
    if (r.megger !== undefined && r.megger !== null && r.megger !== "") setVal(ws, r.row, 10, r.megger);
    if (r.remarks !== undefined) setVal(ws, r.row, 11, r.remarks);
  }
  return { filename: fileName("overhaul", ymStr), blob: await toBlob(wb) };
}

// ---------- filename helper ----------
function fileName(recId: string, ymStr: string): string {
  const { year, month } = ymParts(ymStr);
  return `${recById(recId).baseName} ${MONTHS_FULL[month - 1]} ${year}.xlsx`;
}
function lastDayIso(ymStr: string): string {
  const { year, month } = ymParts(ymStr);
  const d = new Date(year, month, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ---------- registry ----------
export const GENERATORS: Record<string, (ym: string) => Promise<ExportResult>> = {
  iccp: genIccp,
  battery: genBattery,
  firedetector: genFire,
  motortemp: genMotorTemp,
  vibration: genVibration,
  busbar: genBusbar,
  freon: genFreon,
  conditionmon: genConditionMon,
  overhaul: genOverhaul,
};
