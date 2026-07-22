import { h, topbar, screen, numInput, toast, segmented } from "../ui";
import { db } from "../db";
import { masters } from "../seed";
import { ym as ymOf, defaultReportYm, debounce } from "../util";
import { monthPicker, toolbar } from "./parts";

export async function renderConditionMon(_p: Record<string, string>, mount: HTMLElement) {
  let curYm = defaultReportYm();
  let tab: "temp" | "vib" = "temp";
  const body = h("div", {});
  const prog = h("span", { class: "progress" });

  async function load() {
    body.replaceChildren();
    if (tab === "temp") await renderTemp();
    else await renderVib();
  }

  async function renderTemp() {
    const rows = await db.cmTemp.where("ym").equals(curYm).toArray();
    const valMap = new Map(rows.map((r) => [r.motorRow, r.temp]));
    const erRow = await db.motorErTemp.get(`conditionmon:${curYm}`);

    const erInp = numInput({ value: erRow?.value ?? null, placeholder: "°C",
      onInput: debounce(async (v) => {
        if (v == null) await db.motorErTemp.delete(`conditionmon:${curYm}`);
        else await db.motorErTemp.put({ key: `conditionmon:${curYm}`, ym: curYm, source: "conditionmon", value: v });
      }, 350) });
    body.append(
      h("div", { class: "card accent" },
        h("label", { class: "field", style: { marginBottom: 0 } },
          h("span", { class: "lab" }, "Engine Room Temperature (°C)"), erInp)),
      h("button", { class: "btn secondary", style: { marginBottom: "12px" }, onClick: copyTempFromTEC12 }, "⤵ Copy temps from TEC(A) 12")
    );

    // Empty motors float to the top so the user can quickly fill the ones that
    // didn't come across on copy; filled motors keep their template order below.
    const tempMotors = [...masters.cmTempMotors].sort(
      (a, b) => (valMap.get(a.row) == null ? 0 : 1) - (valMap.get(b.row) == null ? 0 : 1)
    );
    for (const mo of tempMotors) {
      const val = valMap.get(mo.row);
      const inp = numInput({ value: val ?? null, placeholder: mo.idealTemp ? `ideal ${mo.idealTemp}` : "",
        onInput: debounce(async (v) => { await saveCmTemp(curYm, mo.row, v); recountTemp(); }, 350) });
      body.append(
        h("div", { class: `mrow ${val != null ? "filled" : ""}` },
          h("div", { class: "mname" }, mo.name, mo.idealTemp ? h("small", {}, `Ideal ${mo.idealTemp}°C`) : null),
          inp)
      );
    }
    recountTemp();
  }

  async function renderVib() {
    const rows = await db.cmVib.where("ym").equals(curYm).toArray();
    const map = new Map(rows.map((r) => [r.motorRow, { vel: r.vel, acc: r.acc }]));
    body.append(
      h("button", { class: "btn secondary", style: { marginBottom: "12px" }, onClick: copyVibFromTEC15 }, "⤵ Copy vibration from TEC(A) 15")
    );
    const isEmpty = (row: number) => { const c = map.get(row); return !c || (c.vel == null && c.acc == null); };
    // Empty motors float to the top; filled ones keep template order below.
    const vibMotors = [...masters.cmVibMotors].sort(
      (a, b) => (isEmpty(a.row) ? 0 : 1) - (isEmpty(b.row) ? 0 : 1)
    );
    for (const mo of vibMotors) {
      const cur = map.get(mo.row) ?? {};
      const velInp = numInput({ value: cur.vel ?? null, placeholder: "Vel",
        onInput: debounce(async (v) => { await saveCmVib(curYm, mo.row, { vel: v }); recountVib(); }, 350) });
      const accInp = numInput({ value: cur.acc ?? null, placeholder: "Acc",
        onInput: debounce(async (v) => { await saveCmVib(curYm, mo.row, { acc: v }); recountVib(); }, 350) });
      body.append(
        h("div", { class: `mrow ${cur.vel != null || cur.acc != null ? "filled" : ""}` },
          h("div", { class: "mname" }, mo.name),
          h("div", { class: "twin", style: { display: "flex", gap: "6px" } }, velInp, accInp))
      );
    }
    recountVib();
  }

  async function recountTemp() { prog.textContent = `${await db.cmTemp.where("ym").equals(curYm).count()}/${masters.cmTempMotors.length} temps`; }
  async function recountVib() {
    const rows = await db.cmVib.where("ym").equals(curYm).toArray();
    const s = new Set(rows.filter((r) => r.vel != null || r.acc != null).map((r) => r.motorRow));
    prog.textContent = `${s.size}/${masters.cmVibMotors.length} vib`;
  }

  // Copy helpers: map Condition Monitoring motors to their TEC 12 / TEC 15
  // counterparts via explicit row→row tables (see CM_TEMP_TO_TEC12 / CM_VIB_TO_TEC15).
  // These handle the naming differences (word order, abbreviations) that a plain
  // name match cannot. Motors with no mapping stay blank for manual entry.
  async function copyTempFromTEC12() {
    const src = await db.motorTemp.where("ym").equals(curYm).toArray();
    const byRow = new Map(src.map((r) => [r.motorRow, r.temp]));
    let n = 0;
    for (const mo of masters.cmTempMotors) {
      const srcRow = CM_TEMP_TO_TEC12[mo.row];
      if (srcRow == null) continue;
      const t = byRow.get(srcRow);
      if (t != null) { await saveCmTemp(curYm, mo.row, t); n++; }
    }
    toast(n ? `Copied ${n} temperatures` : "No values found in TEC(A) 12 for this month");
    load();
  }
  async function copyVibFromTEC15() {
    const src = await db.motorVibration.where("ym").equals(curYm).toArray();
    // TEC15 has drive/free; condition monitoring uses a single Vel/Acc (drive end).
    const byRow = new Map<number, { vel?: number | null; acc?: number | null }>();
    for (const r of src) { if (r.end === "drive") byRow.set(r.motorRow, { vel: r.vel, acc: r.acc }); }
    let n = 0;
    for (const mo of masters.cmVibMotors) {
      const srcRow = CM_VIB_TO_TEC15[mo.row];
      if (srcRow == null) continue;
      const v = byRow.get(srcRow);
      if (v && (v.vel != null || v.acc != null)) { await saveCmVib(curYm, mo.row, v); n++; }
    }
    toast(n ? `Copied ${n} motors` : "No values found in TEC(A) 15 for this month");
    load();
  }

  const seg = segmented({
    options: ["temp", "vib"], labels: ["Temperature", "Vibration"], value: tab,
    onPick: (v) => { tab = v as "temp" | "vib"; load(); },
  });

  mount.append(
    topbar("Condition Monitoring", "Electrical Motors", "/records"),
    screen(
      toolbar(monthPicker(curYm, (v) => { curYm = v; load(); }), prog),
      seg,
      h("p", { class: "hint", style: { marginTop: "10px" } }, "Diff & normalised columns are auto-calculated in Excel — only enter raw values."),
      body
    )
  );
  await load();
}

// Explicit motor mappings: Condition Monitoring row → source template row.
// Reviewed & approved by the ETO. A CM motor omitted here has no counterpart in
// the source and is left blank on copy (e.g. No.3 Main CSW Pump, both incinerator
// motors in temp, Economiser Feed in vibration).
//
// CM Temperature rows 7–33  →  TEC(A) 12 (motor temperature record) rows.
const CM_TEMP_TO_TEC12: Record<number, number> = {
  7: 93,   // No.1 Main Air Compressor        → MAIN AIR COMPR. MOTOR NO.1
  8: 94,   // No.2 Main Air Compressor        → MAIN AIR COMPR. MOTOR NO.2
  9: 95,   // No.1 Main Cooling S.W. Pump     → MAIN CSW PUMP MOTOR NO.1
  10: 96,  // No.2 Main Cooling S.W. Pump     → MAIN CSW PUMP MOTOR NO.2
  // 11 No.3 Main Cooling S.W. Pump           → (no No.3 in TEC 12) — blank
  12: 42,  // FWG Ejector pump                → F.W GENERATOR EJECTOR PP
  13: 65,  // No.1 IGG Blower                 → IGG BLOWER NO:1
  14: 66,  // No.2 IGG Blower                 → IGG BLOWER NO:2
  // 15 Incinerator Flue Gas Fan              → (no match in TEC 12) — blank
  // 16 Incinerator Blower Motor              → (no match in TEC 12) — blank
  17: 23,  // No.1 Deck Seal Pump             → DECK W.SEAL P/P NO:1
  18: 24,  // No.2 Deck Seal Pump             → DECK W.SEAL P/P NO:2
  19: 69,  // IGG Scrubber Pump               → IGG SCRUBBER COOL SW. PP
  20: 51,  // No.1 G/E L.O. Priming Pump      → GE LO PRIMMING P/P NO:1
  21: 52,  // No.2 G/E L.O. Priming Pump      → GE LO PRIMMING P/P NO:2
  22: 53,  // No.3 G/E L.O. Priming Pump      → GE LO PRIMMING P/P NO:3
  23: 82,  // No.1 M/E FO Circulating Pump    → M/E & G/E F.O. CIRC. PP NO.1
  24: 83,  // No.2 M/E FO Circulating Pump    → M/E & G/E F.O. CIRC. PP NO.2
  25: 34,  // Economiser Feed water Pump      → ECON.FEED W.P/P
  26: 114, // STP Blower                      → SEWAGE PLANT BLOWER
  27: 115, // STP Discharge Pump              → SEWAGE PLANT DISCH P/P
  28: 112, // STP Ejector Pump #1             → SEWAGE EJECTOR P/P NO:1
  29: 113, // STP Ejector Pump #2             → SEWAGE EJECTOR P/P NO:2
  30: 97,  // No.1 Main LO Pump               → MAIN L.O PP NO.1
  31: 98,  // No.2 Main LO Pump               → MAIN L.O PP NO.2
  32: 118, // No.1 Steering Gear              → STEERING GEAR NO.1
  33: 119, // No.2 Steering Gear              → STEERING GEAR NO.2
};

// CM Vibration rows 10–36  →  TEC(A) 15 (motor vibration record) rows (drive end).
const CM_VIB_TO_TEC15: Record<number, number> = {
  10: 159, // No.1 Main Air Compressor        → MAIN AIR COMRESSOR NO 1
  11: 161, // No.2 Main Air Compressor        → MAIN AIR COMRESSOR NO1 2
  12: 113, // No.1 Main Cooling S.W. Pump     → MAIN COOLING SEA WATER PUMP NO 1
  13: 115, // No.2 Main Cooling S.W. Pump     → MAIN COOLING SEA WATER PUMP NO 2
  // 14 No.3 Main Cooling S.W. Pump           → (no No.3 in TEC 15) — blank
  15: 61,  // FWG Ejector pump                → FWG EJECTOR PUMP MOTOR
  16: 85,  // No.1 IGG Blower                 → IGG BLOWER NO.1 MOTOR
  17: 87,  // No.2 IGG Blower                 → IGG BLOWER NO.2 MOTOR
  // 18 Incinerator Flue Gas Fan / 19 Blower  → (no match in TEC 15) — blank
  20: 33,  // No.1 Deck Seal Pump             → DECK WATER SEAL PUMP NO 1
  21: 35,  // No.2 Deck Seal Pump             → DECK WATER SEAL PUMP NO 2
  22: 141, // IGG Scrubber Pump               → SCRUBBER COOLING SEA WATER PUMP
  23: 63,  // No.1 G/E L.O. Priming Pump      → GE LO PRIMING PUMP NO.1 MOTOR
  24: 65,  // No.2 G/E L.O. Priming Pump      → GE LO PRIMING PUMP NO.2 MOTOR
  25: 67,  // No.3 G/E L.O. Priming Pump      → GE LO PRIMING PUMP NO.3 MOTOR
  26: 127, // No.1 M/E FO Circulating Pump    → ME FO CIRCULATING PUMP NO 1
  27: 129, // No.2 M/E FO Circulating Pump    → ME FO CIRCULATING PUMP NO 2
  // 28 Economiser Feed water Pump            → (no match in TEC 15) — blank
  29: 143, // STP Blower                      → Sewage Plant Blower motor
  // 30 STP Discharge Pump                    → (no match in TEC 15) — blank
  31: 145, // STP Ejector Pump #1             → SEWAGE PLANT EJECTOR MOTOR NO.1
  32: 147, // STP Ejector Pump #2             → SEWAGE PLANT EJECTOR MOTOR NO.2
  33: 119, // No.1 Main LO Pump               → MAIN LUB OIL PUMP NO 1
  34: 121, // No.2 Main LO Pump               → MAIN LUB OIL PUMP NO 2
  35: 153, // No.1 Steering Gear              → STEERING GEAR HYD. P/P NO.1 MOTOR
  36: 151, // No.2 Steering Gear              → STEERING GEAR HYD. P/P NO. 2 MOTOR
};

async function saveCmTemp(ymStr: string, motorRow: number, v: number | null) {
  const e = await db.cmTemp.where("[ym+motorRow]").equals([ymStr, motorRow]).first();
  if (v == null) { if (e?.id) await db.cmTemp.delete(e.id); return; }
  if (e?.id) await db.cmTemp.update(e.id, { temp: v }); else await db.cmTemp.add({ ym: ymStr, motorRow, temp: v });
}
async function saveCmVib(ymStr: string, motorRow: number, patch: { vel?: number | null; acc?: number | null }) {
  const e = await db.cmVib.where("[ym+motorRow]").equals([ymStr, motorRow]).first();
  const merged = { vel: e?.vel ?? null, acc: e?.acc ?? null, ...patch };
  if (merged.vel == null && merged.acc == null) { if (e?.id) await db.cmVib.delete(e.id); return; }
  if (e?.id) await db.cmVib.update(e.id, merged); else await db.cmVib.add({ ym: ymStr, motorRow, ...merged });
}
