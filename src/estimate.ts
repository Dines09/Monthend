// Month auto-fill ("estimated readings").
//
// For a month the user couldn't get round to, fills the blank readings of five
// records from the user's own history: Battery Log, Motor Temp, Motor
// Vibration, Busbar Temp and Condition Monitoring. Nothing already entered is
// ever changed — only empty cells get a value.
//
// Values come from `smart.ts`: each reading is centred on what that exact
// motor / phase / cell read recently, nudged by its normal month-to-month
// wobble. Motors follow their duty/standby rotation (`runsNext`), so a pump
// that sat idle is left blank just as the user would have left it.
//
// The work is split into a *plan* (computed once, shown to the user as a
// summary) and an *apply* step that writes exactly that plan, so what the
// dialog promised is what lands. The last fill is logged so it can be undone.
import { db, getSetting, setSetting, type BatteryEntry } from "./db";
import { masters } from "./seed";
import { saturdaysInMonth, ymParts } from "./util";
import { estimate, monthlyHistory, runsNext, roundTo, stats } from "./smart";

type TableName =
  | "battery" | "motorTemp" | "motorErTemp" | "motorVibration"
  | "busbar" | "busbarMeta" | "cmTemp" | "cmVib";

/** One write in a plan: the row as it will be stored, and what it replaces. */
interface Op {
  table: TableName;
  /** Existing row being completed (with its primary key), or null for a new row. */
  before: any | null;
  after: any;
}

export interface FillSection {
  id: string;
  title: string;
  icon: string;
  /** Number of individual readings this fill adds. */
  readings: number;
  /** Short human summary, e.g. "4 Saturdays · 5 banks". */
  detail: string;
}

export interface FillPlan {
  ym: string;
  ops: Op[];
  sections: FillSection[];
  total: number;
}

const has = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// ---------------------------------------------------------------- battery

function ratedCca(desc: string): number | null {
  const m = /(\d{3,4})\s*CCA/i.exec(desc ?? "");
  return m ? Number(m[1]) : null;
}

async function planBattery(ym: string, ops: Op[]): Promise<FillSection> {
  const { year, month } = ymParts(ym);
  const sats = saturdaysInMonth(year, month);
  const all = await db.battery.toArray();
  let readings = 0;
  // CCA figures recorded on ANY of the CCA banks, used for a bank that has
  // neither its own CCA history nor a rating in its description (the emergency
  // generator battery is given in Ah) — the banks are the same make and size.
  const ccaBanks = new Set(masters.batteryBanks.filter((b: any) => b.measure === "CCA").map((b: any) => b.id));
  const fleetCca = all.filter((e) => ccaBanks.has(e.bankId) && e.date < sats[0])
    .flatMap((e) => e.readings.map((r) => r.aux)).filter(has).slice(-16);
  const fleetBase = fleetCca.length ? fleetCca
    : masters.batteryBanks.map((b: any) => ratedCca(b.desc)).filter(has);
  const touchedSats = new Set<string>();

  for (const bank of masters.batteryBanks) {
    const isCCA = bank.measure === "CCA";
    const mine = all.filter((e) => e.bankId === bank.id).sort((a, b) => a.date.localeCompare(b.date));
    for (const sat of sats) {
      // History = the user's real readings before this Saturday (last 8 weeks).
      const past = mine.filter((e) => e.date < sat).slice(-8);
      const existing = mine.find((e) => e.date === sat) ?? null;
      const cells = bank.cellLabels as string[];
      const next: BatteryEntry = existing
        ? structuredClone(existing)
        : { date: sat, bankId: bank.id, readings: [], remark: "GOOD" };
      let added = 0;
      cells.forEach((label, i) => {
        const cur = next.readings[i] ?? { label, aux: isCCA ? null : "N/A", volt: null };
        if (!has(cur.volt)) {
          const hist = past.map((e) => e.readings?.[i]?.volt).filter(has);
          const v = estimate(hist, { decimals: 2, minStep: 0.01 });
          if (v != null) { cur.volt = v; added++; }
        }
        if (isCCA && !has(cur.aux)) {
          const hist = past.map((e) => e.readings?.[i]?.aux).filter(has);
          // No CCA ever recorded → start from the battery's rated figure, else
          // from what the sister banks read.
          const rated = ratedCca(bank.desc);
          const base = hist.length ? hist : rated != null ? [rated] : fleetBase;
          const v = estimate(base, { decimals: 0, minStep: hist.length ? 3 : 8 });
          if (v != null) { cur.aux = v; added++; }
        }
        if (!isCCA && (cur.aux == null || cur.aux === "")) cur.aux = "N/A";
        cur.label = cur.label ?? label;
        next.readings[i] = cur;
      });
      if (!added) continue;
      if (!next.remark) next.remark = "GOOD";
      const volts = next.readings.map((r) => r.volt).filter(has);
      next.total = volts.length ? roundTo(volts.reduce((a, b) => a + b, 0), 2) : null;
      ops.push({ table: "battery", before: existing, after: next });
      readings += added;
      touchedSats.add(sat);
    }
  }
  return {
    id: "battery", title: "Battery Log", icon: "🔋", readings,
    detail: readings ? `${touchedSats.size} Saturday${touchedSats.size === 1 ? "" : "s"} · ${masters.batteryBanks.length} banks` : "Already complete",
  };
}

// ------------------------------------------------------- E/R temperature

async function planErTemp(ym: string, source: "motortemp" | "conditionmon", ops: Op[], prefer?: number | null): Promise<number> {
  const key = `${source}:${ym}`;
  const existing = await db.motorErTemp.get(key);
  if (existing && has(existing.value)) return 0;
  let v: number | null = prefer ?? null;
  if (v == null) {
    const rows = (await db.motorErTemp.toArray()).filter((r) => r.source === source && r.ym < ym)
      .sort((a, b) => a.ym.localeCompare(b.ym)).slice(-6);
    v = estimate(rows.map((r) => r.value), { decimals: 0, minStep: 1 });
  }
  if (v == null) return 0;
  ops.push({ table: "motorErTemp", before: existing ?? null, after: { key, ym, source, value: v } });
  return 1;
}

// ------------------------------------------------------------ motor temp

async function planMotorTemp(ym: string, ops: Op[]): Promise<{ section: FillSection; er: number | null }> {
  const rows = await db.motorTemp.toArray();
  const cur = new Set(rows.filter((r) => r.ym === ym).map((r) => r.motorRow));
  const { values, seen } = monthlyHistory(rows, ym, (r) => String(r.motorRow), (r) => r.temp);
  let readings = 0;
  for (const mo of masters.motorTempMotors) {
    if (cur.has(mo.row)) continue;
    const k = String(mo.row);
    if (!runsNext(seen.get(k) ?? [])) continue;
    const v = estimate(values.get(k) ?? [], { decimals: 0, minStep: 1 });
    if (v == null) continue;
    ops.push({ table: "motorTemp", before: null, after: { ym, motorRow: mo.row, temp: v } });
    readings++;
  }
  const erBefore = ops.length;
  readings += await planErTemp(ym, "motortemp", ops);
  const erOp = ops.length > erBefore ? ops[ops.length - 1] : null;
  const er = erOp ? erOp.after.value : (await db.motorErTemp.get(`motortemp:${ym}`))?.value ?? null;
  return {
    section: {
      id: "motortemp", title: "Motor Temp Records", icon: "🌡️", readings,
      detail: readings ? `${readings} readings incl. E/R temp` : "Already complete",
    },
    er,
  };
}

// ------------------------------------------------------------- vibration

async function planVibration(ym: string, ops: Op[]): Promise<FillSection> {
  const rows = (await db.motorVibration.toArray()).filter((r) => has(r.vel) || has(r.acc));
  const curRows = rows.filter((r) => r.ym === ym);
  // Running is decided per motor (either end read counts), then each end's
  // Vel and Acc are estimated from that end's own history.
  const { seen } = monthlyHistory(rows, ym, (r) => String(r.motorRow), () => 1);
  const hist = (end: string, f: "vel" | "acc") =>
    monthlyHistory(rows.filter((r) => r.end === end), ym, (r) => String(r.motorRow), (r) => r[f]).values;
  const H = {
    drive: { vel: hist("drive", "vel"), acc: hist("drive", "acc") },
    free: { vel: hist("free", "vel"), acc: hist("free", "acc") },
  };
  let readings = 0, motors = 0;
  for (const mo of masters.vibrationMotors) {
    const k = String(mo.row);
    const mine = curRows.filter((r) => r.motorRow === mo.row);
    const alreadyRead = mine.length > 0;
    if (!alreadyRead && !runsNext(seen.get(k) ?? [])) continue;
    let any = false;
    for (const end of ["drive", "free"] as const) {
      const existing = mine.find((r) => r.end === end) ?? null;
      const next = { ym, motorRow: mo.row, end, vel: existing?.vel ?? null, acc: existing?.acc ?? null };
      let added = 0;
      if (!has(next.vel)) { const v = estimate(H[end].vel.get(k) ?? [], { decimals: 2, minStep: 0.05 }); if (v != null) { next.vel = v; added++; } }
      if (!has(next.acc)) { const v = estimate(H[end].acc.get(k) ?? [], { decimals: 2, minStep: 0.2 }); if (v != null) { next.acc = v; added++; } }
      if (!added) continue;
      ops.push({ table: "motorVibration", before: existing, after: existing ? { ...existing, ...next } : next });
      readings += added; any = true;
    }
    if (any) motors++;
  }
  return {
    id: "vibration", title: "Motor Vibration", icon: "📳", readings,
    detail: readings ? `${motors} running motors · both ends` : "Already complete",
  };
}

// ---------------------------------------------------------------- busbar

async function planBusbar(ym: string, ops: Op[]): Promise<FillSection> {
  const rows = await db.busbar.toArray();
  const cur = new Set(rows.filter((r) => r.ym === ym).map((r) => `${r.panelRow}:${r.phase}`));
  const { values } = monthlyHistory(rows, ym, (r) => `${r.panelRow}:${r.phase}`, (r) => r.value);
  let readings = 0;
  for (const p of masters.busbarPanels) {
    // The three phases of one panel run at almost the same temperature, so they
    // share one panel-level estimate plus a small per-phase wobble — three
    // independent guesses would spread further apart than real busbars do.
    const panelHist = (["U", "V", "W"] as const).flatMap((ph) => values.get(`${p.row}:${ph}`) ?? []);
    const base = estimate(panelHist, { decimals: 1, minStep: 0.4 });
    if (base == null) continue;
    for (const ph of ["U", "V", "W"] as const) {
      if (cur.has(`${p.row}:${ph}`)) continue;
      const own = stats(values.get(`${p.row}:${ph}`) ?? []);
      const pan = stats(panelHist)!;
      const offset = own ? own.mean - pan.mean : 0; // this phase's usual lean
      const v = roundTo(base + offset + (Math.random() - 0.5) * 0.4, 1);
      ops.push({ table: "busbar", before: null, after: { ym, panelRow: p.row, phase: ph, value: v } });
      readings++;
    }
  }
  // Meta: E/R-control-room temperature and the date of the check.
  const meta = await db.busbarMeta.get(ym);
  const next = { ym, checkDate: meta?.checkDate, ecr: meta?.ecr };
  let metaAdded = 0;
  if (!has(next.ecr)) {
    const hist = (await db.busbarMeta.toArray()).filter((m) => m.ym < ym && has(m.ecr))
      .sort((a, b) => a.ym.localeCompare(b.ym)).slice(-6).map((m) => m.ecr!);
    const v = estimate(hist, { decimals: 0, minStep: 1 });
    if (v != null) { next.ecr = v; metaAdded++; }
  }
  if (!next.checkDate) {
    // Same day of the month the check is usually done on (the 1st by default).
    const last = (await db.busbarMeta.toArray()).filter((m) => m.ym < ym && m.checkDate)
      .sort((a, b) => a.ym.localeCompare(b.ym)).pop();
    const { year, month } = ymParts(ym);
    const dim = new Date(year, month, 0).getDate();
    const lastDay = last?.checkDate ? Number(last.checkDate.slice(8, 10)) : 1;
    // A check logged on the last day of its month means "month end" — keep that.
    const lastDim = last?.checkDate ? new Date(Number(last.checkDate.slice(0, 4)), Number(last.checkDate.slice(5, 7)), 0).getDate() : 0;
    const day = lastDay === lastDim ? dim : Math.min(lastDay, dim);
    next.checkDate = `${ym}-${String(day).padStart(2, "0")}`;
    metaAdded++;
  }
  if (metaAdded) ops.push({ table: "busbarMeta", before: meta ?? null, after: next });
  readings += metaAdded;
  return {
    id: "busbar", title: "Busbar Temp", icon: "⚡", readings,
    detail: readings ? `${masters.busbarPanels.length} panels × 3 phases · ECR · date` : "Already complete",
  };
}

// --------------------------------------------------- condition monitoring

async function planConditionMon(ym: string, ops: Op[], erFromTec12: number | null): Promise<FillSection> {
  let readings = 0;
  // Temperature
  const tRows = await db.cmTemp.toArray();
  const tCur = new Set(tRows.filter((r) => r.ym === ym).map((r) => r.motorRow));
  const T = monthlyHistory(tRows, ym, (r) => String(r.motorRow), (r) => r.temp);
  for (const mo of masters.cmTempMotors) {
    if (tCur.has(mo.row)) continue;
    const k = String(mo.row);
    if (!runsNext(T.seen.get(k) ?? [])) continue;
    const v = estimate(T.values.get(k) ?? [], { decimals: 0, minStep: 1 });
    if (v == null) continue;
    ops.push({ table: "cmTemp", before: null, after: { ym, motorRow: mo.row, temp: v } });
    readings++;
  }
  // Same engine room, same month: reuse the TEC(A) 12 figure when there is one.
  readings += await planErTemp(ym, "conditionmon", ops, erFromTec12);

  // Vibration
  const vRows = (await db.cmVib.toArray()).filter((r) => has(r.vel) || has(r.acc));
  const vCur = vRows.filter((r) => r.ym === ym);
  const seen = monthlyHistory(vRows, ym, (r) => String(r.motorRow), () => 1).seen;
  const vel = monthlyHistory(vRows, ym, (r) => String(r.motorRow), (r) => r.vel).values;
  const acc = monthlyHistory(vRows, ym, (r) => String(r.motorRow), (r) => r.acc).values;
  for (const mo of masters.cmVibMotors) {
    const k = String(mo.row);
    const existing = vCur.find((r) => r.motorRow === mo.row) ?? null;
    if (!existing && !runsNext(seen.get(k) ?? [])) continue;
    const next = { ym, motorRow: mo.row, vel: existing?.vel ?? null, acc: existing?.acc ?? null };
    let added = 0;
    if (!has(next.vel)) { const v = estimate(vel.get(k) ?? [], { decimals: 2, minStep: 0.05 }); if (v != null) { next.vel = v; added++; } }
    if (!has(next.acc)) { const v = estimate(acc.get(k) ?? [], { decimals: 2, minStep: 0.2 }); if (v != null) { next.acc = v; added++; } }
    if (!added) continue;
    ops.push({ table: "cmVib", before: existing, after: existing ? { ...existing, ...next } : next });
    readings += added;
  }
  return {
    id: "conditionmon", title: "Condition Monitoring", icon: "📊", readings,
    detail: readings ? "Temperature + vibration" : "Already complete",
  };
}

// ------------------------------------------------------------------ public

/** Work out everything a fill of `ym` would write, without writing it. */
export async function planFill(ym: string): Promise<FillPlan> {
  const ops: Op[] = [];
  const battery = await planBattery(ym, ops);
  const mt = await planMotorTemp(ym, ops);
  const vib = await planVibration(ym, ops);
  const bus = await planBusbar(ym, ops);
  const cm = await planConditionMon(ym, ops, mt.er);
  const sections = [battery, mt.section, vib, bus, cm];
  return { ym, ops, sections, total: sections.reduce((a, s) => a + s.readings, 0) };
}

interface LogEntry { table: TableName; pk: string | number; before: any | null }
interface FillLog { ym: string; at: string; total: number; entries: LogEntry[] }
const LOG_KEY = "estimateLog";

const pkOf = (table: TableName, row: any): string | number =>
  table === "motorErTemp" ? row.key : table === "busbarMeta" ? row.ym : row.id;

/** Write a plan in one transaction and remember how to take it back. */
export async function applyFill(plan: FillPlan): Promise<number> {
  const entries: LogEntry[] = [];
  const tables = [...new Set(plan.ops.map((o) => o.table))].map((t) => db.table(t));
  await db.transaction("rw", [...tables, db.settings], async () => {
    for (const op of plan.ops) {
      const t = db.table(op.table);
      if (op.before) {
        const pk = pkOf(op.table, op.before);
        await t.put({ ...op.after, ...(op.table === "motorErTemp" || op.table === "busbarMeta" ? {} : { id: pk }) });
        entries.push({ table: op.table, pk, before: op.before });
      } else {
        const pk = await t.put(op.after);
        entries.push({ table: op.table, pk: pk as any, before: null });
      }
    }
    const log: FillLog = { ym: plan.ym, at: new Date().toISOString(), total: plan.total, entries };
    await setSetting(LOG_KEY, log);
  });
  return plan.total;
}

export async function lastFill(): Promise<{ ym: string; at: string; total: number } | null> {
  const log = await getSetting<FillLog | null>(LOG_KEY, null);
  return log?.entries?.length ? { ym: log.ym, at: log.at, total: log.total } : null;
}

/**
 * Put back exactly what the last fill changed. Rows it created are deleted;
 * rows it completed get their earlier contents back — including any readings
 * the user has typed into them since, which is why the dialog says so.
 */
export async function undoLastFill(): Promise<number> {
  const log = await getSetting<FillLog | null>(LOG_KEY, null);
  if (!log?.entries?.length) return 0;
  const tables = [...new Set(log.entries.map((e) => e.table))].map((t) => db.table(t));
  await db.transaction("rw", [...tables, db.settings], async () => {
    for (const e of [...log.entries].reverse()) {
      const t = db.table(e.table);
      if (e.before) await t.put(e.before);
      else await t.delete(e.pk);
    }
    await setSetting(LOG_KEY, null);
  });
  return log.total;
}
