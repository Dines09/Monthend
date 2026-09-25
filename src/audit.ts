// Pre-export sanity check: every reading of the month compared with what that
// same motor / phase / cell has read before. The entry screens already flag an
// odd value as it is typed, but a value can still slip through (typed on a
// hurried day, "Use anyway" pressed, restored from a backup) — this is the last
// look before the files leave the phone.
import { db } from "./db";
import { masters } from "./seed";
import { saturdaysInMonth, ymParts } from "./util";
import { monthlyHistory, usualBand, roundTo, TOL, type Tolerance } from "./smart";

export interface Oddity {
  recId: string;
  route: string;
  icon: string;
  what: string;   // e.g. "AHU BLOWER MOTOR"
  value: string;  // e.g. "94 °C"
  usual: string;  // e.g. "26–28 °C"
}

const fmt = (v: number, d: number) => String(roundTo(v, d));

function check(
  out: Oddity[], base: Omit<Oddity, "value" | "usual">,
  v: number | null | undefined, hist: number[], tol: Tolerance, unit: string, d: number
) {
  if (typeof v !== "number") return;
  const band = usualBand(hist, tol);
  if (!band || (v >= band.lo && v <= band.hi)) return;
  const lo = Math.min(...hist), hi = Math.max(...hist);
  const u = unit ? ` ${unit}` : "";
  out.push({ ...base, value: `${fmt(v, d)}${u}`, usual: lo === hi ? `about ${fmt(lo, d)}${u}` : `${fmt(lo, d)}–${fmt(hi, d)}${u}` });
}

export async function auditMonth(ym: string): Promise<Oddity[]> {
  const out: Oddity[] = [];
  const [mt, vib, bus, cmT, cmV, batt] = await Promise.all([
    db.motorTemp.toArray(), db.motorVibration.toArray(), db.busbar.toArray(),
    db.cmTemp.toArray(), db.cmVib.toArray(), db.battery.toArray(),
  ]);

  // Motor temperatures
  {
    const H = monthlyHistory(mt, ym, (r) => String(r.motorRow), (r) => r.temp).values;
    const name = new Map(masters.motorTempMotors.map((m) => [m.row, m.name]));
    for (const r of mt.filter((x) => x.ym === ym)) {
      check(out, { recId: "motortemp", route: "/rec/motortemp", icon: "🌡️", what: name.get(r.motorRow) ?? `Row ${r.motorRow}` },
        r.temp, H.get(String(r.motorRow)) ?? [], TOL.motorTemp, "°C", 1);
    }
  }
  // Vibration (per end)
  {
    const key = (r: { motorRow: number; end: string }) => `${r.motorRow}:${r.end}`;
    const V = monthlyHistory(vib, ym, key, (r) => r.vel).values;
    const A = monthlyHistory(vib, ym, key, (r) => r.acc).values;
    const name = new Map(masters.vibrationMotors.map((m) => [m.row, m.name]));
    for (const r of vib.filter((x) => x.ym === ym)) {
      const base = { recId: "vibration", route: "/rec/vibration", icon: "📳",
        what: `${name.get(r.motorRow) ?? `Row ${r.motorRow}`} · ${r.end === "drive" ? "DE" : "FE"}` };
      check(out, { ...base, what: `${base.what} Vel` }, r.vel, V.get(key(r)) ?? [], TOL.vibVel, "mm/s", 2);
      check(out, { ...base, what: `${base.what} Acc` }, r.acc, A.get(key(r)) ?? [], TOL.vibAcc, "", 2);
    }
  }
  // Busbar
  {
    const H = monthlyHistory(bus, ym, (r) => `${r.panelRow}:${r.phase}`, (r) => r.value).values;
    const name = new Map(masters.busbarPanels.map((p) => [p.row, p.name]));
    for (const r of bus.filter((x) => x.ym === ym)) {
      check(out, { recId: "busbar", route: "/rec/busbar", icon: "⚡", what: `${name.get(r.panelRow)} · ${r.phase}` },
        r.value, H.get(`${r.panelRow}:${r.phase}`) ?? [], TOL.busbar, "°C", 1);
    }
  }
  // Condition monitoring
  {
    const T = monthlyHistory(cmT, ym, (r) => String(r.motorRow), (r) => r.temp).values;
    const name = new Map(masters.cmTempMotors.map((m) => [m.row, m.name]));
    for (const r of cmT.filter((x) => x.ym === ym)) {
      check(out, { recId: "conditionmon", route: "/rec/conditionmon", icon: "📊", what: `${name.get(r.motorRow)} temp` },
        r.temp, T.get(String(r.motorRow)) ?? [], TOL.motorTemp, "°C", 1);
    }
    const V = monthlyHistory(cmV, ym, (r) => String(r.motorRow), (r) => r.vel).values;
    const A = monthlyHistory(cmV, ym, (r) => String(r.motorRow), (r) => r.acc).values;
    const vname = new Map(masters.cmVibMotors.map((m) => [m.row, m.name]));
    for (const r of cmV.filter((x) => x.ym === ym)) {
      const what = vname.get(r.motorRow) ?? `Row ${r.motorRow}`;
      const base = { recId: "conditionmon", route: "/rec/conditionmon", icon: "📊" };
      check(out, { ...base, what: `${what} Vel` }, r.vel, V.get(String(r.motorRow)) ?? [], TOL.vibVel, "mm/s", 2);
      check(out, { ...base, what: `${what} Acc` }, r.acc, A.get(String(r.motorRow)) ?? [], TOL.vibAcc, "", 2);
    }
  }
  // Battery cells: each Saturday against the eight weeks before it.
  {
    const { year, month } = ymParts(ym);
    for (const sat of saturdaysInMonth(year, month)) {
      for (const e of batt.filter((x) => x.date === sat)) {
        const bank = masters.batteryBanks.find((b: any) => b.id === e.bankId);
        const past = batt.filter((x) => x.bankId === e.bankId && x.date < sat)
          .sort((a, b) => a.date.localeCompare(b.date)).slice(-8);
        const tol = bank?.measure === "CCA" ? TOL.cell12v : TOL.cell2v;
        e.readings.forEach((r, i) => {
          const hist = past.map((p) => p.readings?.[i]?.volt).filter((v): v is number => typeof v === "number");
          check(out, { recId: "battery", route: "/rec/battery", icon: "🔋",
            what: `${e.bankId.toUpperCase()} ${r.label.startsWith("Battery") ? r.label : `cell ${r.label}`} · ${sat.slice(8)}/${sat.slice(5, 7)}` },
            typeof r.volt === "number" ? r.volt : null, hist, tol, "V", 2);
        });
      }
    }
  }
  return out;
}
