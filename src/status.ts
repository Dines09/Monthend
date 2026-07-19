// Computes "done / pending / due" status per record for the given reported month.
import { db } from "./db";
import { masters } from "./seed";
import { ym, saturdaysInMonth, ymParts, quarterWindow } from "./util";

export interface RecStatus {
  count: number; // entries present for this month
  total: number; // expected total (best-effort)
  label: string; // human summary
  state: "done" | "partial" | "empty";
}

export async function motorTempStatus(ymStr: string): Promise<RecStatus> {
  const rows = await db.motorTemp.where("ym").equals(ymStr).count();
  const total = masters.motorTempMotors.length;
  return summarize(rows, total, "motors");
}
export async function vibrationStatus(ymStr: string): Promise<RecStatus> {
  // count distinct motors with any reading this month
  const rows = await db.motorVibration.where("ym").equals(ymStr).toArray();
  const motors = new Set(rows.filter((r) => r.vel != null || r.acc != null).map((r) => r.motorRow));
  return summarize(motors.size, masters.vibrationMotors.length, "motors");
}
export async function busbarStatus(ymStr: string): Promise<RecStatus> {
  const rows = await db.busbar.where("ym").equals(ymStr).count();
  return summarize(rows, masters.busbarPanels.length * 3, "phases");
}
export async function freonStatus(ymStr: string): Promise<RecStatus> {
  const rows = await db.freon.where("ym").equals(ymStr).count();
  return summarize(rows, masters.freonSystems.length, "systems");
}
export async function cmStatus(ymStr: string): Promise<RecStatus> {
  const t = await db.cmTemp.where("ym").equals(ymStr).count();
  return summarize(t, masters.cmTempMotors.length, "motors");
}
export async function iccpStatus(ymStr: string): Promise<RecStatus> {
  const { year, month } = ymParts(ymStr);
  const all = await db.iccpDaily.toArray();
  const inMonth = all.filter((d) => d.date.startsWith(ymStr));
  const dim = new Date(year, month, 0).getDate();
  return summarize(inMonth.length, dim, "days");
}
export async function batteryStatus(ymStr: string): Promise<RecStatus> {
  const { year, month } = ymParts(ymStr);
  const sats = saturdaysInMonth(year, month);
  const all = await db.battery.toArray();
  const done = new Set(all.filter((e) => sats.includes(e.date)).map((e) => e.date));
  return summarize(done.size, sats.length, "weeks");
}
export async function fireStatus(ymStr: string): Promise<RecStatus> {
  const q = quarterWindow(ymStr);
  const all = await db.fireTest.toArray();
  const inQ = all.filter((t) => {
    const m = t.testedDate.slice(0, 7);
    return m >= q.startYm && m <= q.endYm;
  });
  const tested = new Set(inQ.map((t) => t.detKey));
  return summarize(tested.size, masters.fireDetectors.length, "detectors");
}

function summarize(count: number, total: number, unit: string): RecStatus {
  let state: RecStatus["state"] = "empty";
  if (count >= total && total > 0) state = "done";
  else if (count > 0) state = "partial";
  return { count, total, label: `${count}/${total} ${unit}`, state };
}
