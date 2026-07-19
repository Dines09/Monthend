import seedRaw from "./seed-data.json";
import {
  db,
  setSetting,
  getSetting,
  type MotorTemp,
  type MotorVibration,
  type BusbarReading,
  type FreonConsumed,
  type CmTemp,
  type CmVib,
  type BatteryEntry,
  type OverhaulRow,
} from "../db";

export const seed = seedRaw as any;

// Master lists (from the June templates) — used by entry screens & exporters.
export const masters = {
  settings: seed.settings,
  busbarPanels: seed.busbar.panels as { row: number; name: string; load: any }[],
  freonSystems: seed.freon.systems as { row: number; no: any; name: string; capacity: any; remarks: any }[],
  freonExtraRemark: seed.freon.extraRemark,
  freonRobStartJan: seed.freon.robStartJan as number,
  motorTempMotors: seed.motortemp.motors as { row: number; no: any; name: string; mounting: any; rating: any }[],
  vibrationMotors: seed.vibration.motors as { row: number; refNo: any; name: string; rating: any }[],
  vibrationTool: seed.vibration.toolDetails,
  cmTempMotors: seed.conditionmon.tempMotors as { row: number; no: any; name: string; idealTemp: any }[],
  cmVibMotors: seed.conditionmon.vibMotors as { row: number; no: any; name: string }[],
  batteryBanks: seed.battery.banks as any[],
  fireDetectors: seed.firedetector.detectors as any[],
  fireHeader: seed.firedetector.header,
  fireHeaderBattery: seed.firedetector.headerBattery,
  iccpHeader: seed.iccp.header,
  overhaulRows: seed.overhaul.rows as OverhaulRow[],
};

export function detKey(d: { sheet: string; row: number }) {
  return `${d.sheet}:${d.row}`;
}

/** One-time seeding of historic Jan–Jun 2026 data into IndexedDB. */
export async function ensureSeeded() {
  const done = await getSetting<boolean>("seeded", false);
  if (done) return;

  // settings
  for (const [k, v] of Object.entries(seed.settings)) await setSetting(k, v);
  await setSetting("iccpHeader", seed.iccp.header);
  await setSetting("vibrationTool", seed.vibration.toolDetails);
  await setSetting("fireHeader", seed.firedetector.header);
  await setSetting("fireHeaderBattery", seed.firedetector.headerBattery);
  await setSetting("fireCurrentQuarter", seed.firedetector.currentQuarter);

  // Busbar
  await db.busbar.bulkAdd(
    (seed.busbar.readings as any[]).map((r) => ({ ym: r.ym, panelRow: r.panelRow, phase: r.phase, value: r.value } as BusbarReading))
  );
  {
    const metas: Record<string, any> = {};
    for (const [ym, d] of Object.entries(seed.busbar.checkDates)) (metas[ym] ??= { ym }).checkDate = d;
    for (const [ym, v] of Object.entries(seed.busbar.ecr)) (metas[ym] ??= { ym }).ecr = v;
    await db.busbarMeta.bulkPut(Object.values(metas) as any);
  }

  // Freon
  await db.freon.bulkAdd(
    (seed.freon.consumed as any[]).map((r) => ({ ym: r.ym, systemRow: r.systemRow, consumed: r.consumed } as FreonConsumed))
  );
  await db.freonMeta.bulkPut(
    Object.entries(seed.freon.received).map(([ym, received]) => ({ ym, received })) as any
  );

  // Motor temp
  await db.motorTemp.bulkAdd(
    (seed.motortemp.temps as any[]).map((r) => ({ ym: r.ym, motorRow: r.motorRow, temp: r.temp } as MotorTemp))
  );
  await db.motorErTemp.bulkPut(
    Object.entries(seed.motortemp.erTemp).map(([ym, value]) => ({ key: `motortemp:${ym}`, ym, source: "motortemp" as const, value: value as number }))
  );

  // Vibration
  await db.motorVibration.bulkAdd(
    (seed.vibration.readings as any[]).map((r) => ({ ym: r.ym, motorRow: r.motorRow, end: r.end, vel: r.vel, acc: r.acc } as MotorVibration))
  );

  // Condition monitoring
  await db.cmTemp.bulkAdd((seed.conditionmon.temps as any[]).map((r) => ({ ym: r.ym, motorRow: r.motorRow, temp: r.temp } as CmTemp)));
  await db.motorErTemp.bulkPut(
    Object.entries(seed.conditionmon.erTemp).map(([ym, value]) => ({ key: `conditionmon:${ym}`, ym, source: "conditionmon" as const, value: value as number }))
  );
  await db.cmVib.bulkAdd((seed.conditionmon.vibs as any[]).map((r) => ({ ym: r.ym, motorRow: r.motorRow, vel: r.vel, acc: r.acc } as CmVib)));

  // ICCP daily + monthly
  await db.iccpDaily.bulkPut(seed.iccp.daily as any);
  await db.iccpMonthly.bulkPut(seed.iccp.monthly.map((m: any) => ({ ...m, ym: m.ym })) as any);

  // Battery entries + meta
  await db.battery.bulkAdd(
    (seed.battery.entries as any[]).map((e) => ({ date: e.date, bankId: e.bankId, readings: e.readings, total: e.total, remark: e.remark } as BatteryEntry))
  );
  await db.batteryMeta.bulkPut(
    (seed.battery.banks as any[]).map((b) => ({ bankId: b.id, info: b.info, info2: b.info2 }))
  );

  // Fire detector tests (seed the "tested this quarter" dates as events)
  const fireEvents: any[] = [];
  for (const d of seed.firedetector.detectors as any[]) {
    if (d.testedThisQ) fireEvents.push({ detKey: detKey(d), testedDate: d.testedThisQ, remarks: d.remarks ?? "satisfactory" });
  }
  if (fireEvents.length) await db.fireTest.bulkAdd(fireEvents);

  // Overhaul register
  await db.overhaul.bulkPut(seed.overhaul.rows as OverhaulRow[]);

  await setSetting("seeded", true);
}
