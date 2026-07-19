import Dexie, { type Table } from "dexie";

// ---- Record row types (as stored in IndexedDB) ----

export interface Setting {
  key: string;
  value: any;
}

// ICCP/MGPS daily reading (one per calendar day)
export interface IccpDaily {
  date: string; // YYYY-MM-DD
  area?: string; // Anchor / Port / Sea
  draft?: number;
  seaTemp?: number;
  amp?: number;
  volt?: number;
  cell1?: number;
  cell2?: number;
  cu1?: number;
  al1?: number;
  cu2?: number;
  al2?: number;
  seaChest?: string;
  shaftMv?: number;
}

// ICCP monthly footer (observations, slipring, remark)
export interface IccpMonthly {
  ym: string; // YYYY-MM
  strainerNote?: string;
  obs?: Record<string, string | null>;
  slipring?: (number | null)[];
  remark?: string;
}

// Motor temperature monthly value
export interface MotorTemp {
  id?: number;
  ym: string;
  motorRow: number;
  temp: number;
}
export interface ErTemp {
  key: string; // `${ym}` for a given source
  ym: string;
  source: "motortemp" | "conditionmon";
  value: number;
}

// Motor vibration monthly value
export interface MotorVibration {
  id?: number;
  ym: string;
  motorRow: number;
  end: "drive" | "free";
  vel?: number | null;
  acc?: number | null;
}

// Busbar temp reading
export interface BusbarReading {
  id?: number;
  ym: string;
  panelRow: number;
  phase: "U" | "V" | "W";
  value: number;
}
export interface BusbarMeta {
  ym: string;
  checkDate?: string;
  ecr?: number;
}

// Freon
export interface FreonConsumed {
  id?: number;
  ym: string;
  systemRow: number;
  consumed: number;
}
export interface FreonMeta {
  ym: string;
  received?: number;
}

// Condition monitoring temp
export interface CmTemp {
  id?: number;
  ym: string;
  motorRow: number;
  temp: number;
}
export interface CmVib {
  id?: number;
  ym: string;
  motorRow: number;
  vel?: number | null;
  acc?: number | null;
}

// Battery weekly reading (one row per bank per Saturday)
export interface BatteryEntry {
  id?: number;
  date: string; // Saturday YYYY-MM-DD
  bankId: string;
  readings: { label: string; aux?: string | number | null; volt?: number | null }[];
  total?: number | null;
  remark?: string;
}
export interface BatteryMeta {
  bankId: string;
  info?: string; // last load test / last renewed text
  info2?: string;
}

// Fire detector test event
export interface FireTest {
  id?: number;
  detKey: string; // `${sheet}:${row}`
  testedDate: string; // YYYY-MM-DD
  remarks?: string;
}

// Overhaul register row (editable)
export interface OverhaulRow {
  row: number; // template row (stable key)
  sn?: number;
  motor: string;
  kw?: any;
  weatherproof?: string;
  ndeBearing?: string;
  deBearing?: string;
  interval?: string;
  lastOverhaul?: string | null;
  megger?: any;
  remarks?: string;
  note?: string;
}

export class MonthEndDB extends Dexie {
  settings!: Table<Setting, string>;
  iccpDaily!: Table<IccpDaily, string>;
  iccpMonthly!: Table<IccpMonthly, string>;
  motorTemp!: Table<MotorTemp, number>;
  motorErTemp!: Table<ErTemp, string>;
  motorVibration!: Table<MotorVibration, number>;
  busbar!: Table<BusbarReading, number>;
  busbarMeta!: Table<BusbarMeta, string>;
  freon!: Table<FreonConsumed, number>;
  freonMeta!: Table<FreonMeta, string>;
  cmTemp!: Table<CmTemp, number>;
  cmVib!: Table<CmVib, number>;
  battery!: Table<BatteryEntry, number>;
  batteryMeta!: Table<BatteryMeta, string>;
  fireTest!: Table<FireTest, number>;
  overhaul!: Table<OverhaulRow, number>;

  constructor() {
    super("monthend");
    this.version(1).stores({
      settings: "key",
      iccpDaily: "date",
      iccpMonthly: "ym",
      motorTemp: "++id, ym, motorRow, [ym+motorRow]",
      motorErTemp: "key, ym",
      motorVibration: "++id, ym, motorRow, [ym+motorRow+end]",
      busbar: "++id, ym, panelRow, [ym+panelRow+phase]",
      busbarMeta: "ym",
      freon: "++id, ym, systemRow, [ym+systemRow]",
      freonMeta: "ym",
      cmTemp: "++id, ym, motorRow, [ym+motorRow]",
      cmVib: "++id, ym, motorRow, [ym+motorRow]",
      battery: "++id, date, bankId, [date+bankId]",
      batteryMeta: "bankId",
      fireTest: "++id, detKey, testedDate",
      overhaul: "row",
    });
  }
}

export const db = new MonthEndDB();

// ---- generic helpers for upsert on composite keys ----

export async function setSetting(key: string, value: any) {
  await db.settings.put({ key, value });
}
export async function getSetting<T = any>(key: string, fallback?: T): Promise<T> {
  const row = await db.settings.get(key);
  return (row?.value ?? fallback) as T;
}
