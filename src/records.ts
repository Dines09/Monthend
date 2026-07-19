// Registry of the 9 record files: metadata for menus, cadence, export filename.

export type Cadence = "daily" | "weekly" | "monthly" | "quarterly" | "event";

export interface RecordDef {
  id: string;
  title: string;
  fileRef: string;
  icon: string;
  cadence: Cadence;
  route: string;
  // export base name; <MONTH> <YEAR> or <QUARTER> appended by exporter
  baseName: string;
  template: string; // template file in public/templates
  cumulative: boolean; // writes whole year vs single month
}

export const RECORDS: RecordDef[] = [
  {
    id: "iccp",
    title: "ICCP / MGPS Daily Log",
    fileRef: "Daily readings",
    icon: "🌊",
    cadence: "daily",
    route: "/rec/iccp",
    baseName: "ICCP(AFT)  MGPS(2CU2AL)",
    template: "iccp.xlsx",
    cumulative: false,
  },
  {
    id: "battery",
    title: "Battery Log",
    fileRef: "TEC(A) 17",
    icon: "🔋",
    cadence: "weekly",
    route: "/rec/battery",
    baseName: "TEC(A) 17 - Battery Log",
    template: "battery.xlsx",
    cumulative: false,
  },
  {
    id: "firedetector",
    title: "Fire Detector Test",
    fileRef: "TEC(A) 37",
    icon: "🚨",
    cadence: "quarterly",
    route: "/rec/fire",
    baseName: "TEC(A) 37 - Fire detector alarm test record",
    template: "firedetector.xlsx",
    cumulative: false,
  },
  {
    id: "motortemp",
    title: "Motor Temp Records",
    fileRef: "TEC(A) 12",
    icon: "🌡️",
    cadence: "monthly",
    route: "/rec/motortemp",
    baseName: "TEC(A) 12 - Motor Temp Records",
    template: "motortemp.xlsx",
    cumulative: true,
  },
  {
    id: "vibration",
    title: "Motor Vibration Record",
    fileRef: "TEC(A) 15",
    icon: "📳",
    cadence: "monthly",
    route: "/rec/vibration",
    baseName: "TEC(A) 15 Motor Vibration Record",
    template: "vibration.xlsx",
    cumulative: true,
  },
  {
    id: "busbar",
    title: "Busbar Temp Record",
    fileRef: "TEC(A) 16",
    icon: "⚡",
    cadence: "monthly",
    route: "/rec/busbar",
    baseName: "TEC(A) 16 - Busbar Temp Record",
    template: "busbar.xlsx",
    cumulative: true,
  },
  {
    id: "freon",
    title: "Freon Consumption",
    fileRef: "TEC(A) 33",
    icon: "❄️",
    cadence: "monthly",
    route: "/rec/freon",
    baseName: "TEC(A) 33 -  Freon consumption record",
    template: "freon.xlsx",
    cumulative: true,
  },
  {
    id: "conditionmon",
    title: "Condition Monitoring",
    fileRef: "Electrical Motors",
    icon: "📊",
    cadence: "monthly",
    route: "/rec/conditionmon",
    baseName: "Condition Monitoring of Electrical Motors",
    template: "conditionmon.xlsx",
    cumulative: true,
  },
  {
    id: "overhaul",
    title: "Overhaul & Megger",
    fileRef: "TEC 05C",
    icon: "🔧",
    cadence: "event",
    route: "/rec/overhaul",
    baseName: "TEC 05C-Motor Overhaul & Megger test Report",
    template: "overhaul.xlsx",
    cumulative: true,
  },
];

export function recById(id: string): RecordDef {
  return RECORDS.find((r) => r.id === id)!;
}
