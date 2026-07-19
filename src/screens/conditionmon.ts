import { h, topbar, screen, numInput, toast } from "../ui";
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
      h("div", { class: "card", style: { background: "var(--accent-d)" } },
        h("label", { class: "field", style: { marginBottom: 0 } },
          h("span", { class: "lab" }, "Engine Room Temperature (°C)"), erInp)),
      h("button", { class: "btn secondary", style: { marginBottom: "12px" }, onClick: copyTempFromTEC12 }, "⤵ Copy temps from TEC(A) 12")
    );

    for (const mo of masters.cmTempMotors) {
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
    for (const mo of masters.cmVibMotors) {
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

  // Copy helpers: match by motor name against TEC 12 / TEC 15 masters.
  async function copyTempFromTEC12() {
    const src = await db.motorTemp.where("ym").equals(curYm).toArray();
    const srcByName = new Map<string, number>();
    for (const r of src) {
      const m = masters.motorTempMotors.find((x) => x.row === r.motorRow);
      if (m) srcByName.set(norm(m.name), r.temp);
    }
    let n = 0;
    for (const mo of masters.cmTempMotors) {
      const t = srcByName.get(norm(mo.name));
      if (t != null) { await saveCmTemp(curYm, mo.row, t); n++; }
    }
    toast(n ? `Copied ${n} temperatures` : "No matching motors found");
    load();
  }
  async function copyVibFromTEC15() {
    const src = await db.motorVibration.where("ym").equals(curYm).toArray();
    // TEC15 has drive/free; condition monitoring uses a single Vel/Acc (drive end).
    const byName = new Map<string, { vel?: number | null; acc?: number | null }>();
    for (const r of src) {
      if (r.end !== "drive") continue;
      const m = masters.vibrationMotors.find((x) => x.row === r.motorRow);
      if (m) byName.set(norm(m.name), { vel: r.vel, acc: r.acc });
    }
    let n = 0;
    for (const mo of masters.cmVibMotors) {
      const v = byName.get(norm(mo.name));
      if (v && (v.vel != null || v.acc != null)) { await saveCmVib(curYm, mo.row, v); n++; }
    }
    toast(n ? `Copied ${n} motors` : "No matching motors found");
    load();
  }

  const seg = h("div", { class: "seg" },
    h("button", { class: "active", onClick: (e: Event) => setTab("temp", e) }, "Temperature"),
    h("button", { onClick: (e: Event) => setTab("vib", e) }, "Vibration"));
  function setTab(t: "temp" | "vib", e: Event) {
    tab = t;
    seg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    (e.target as HTMLElement).classList.add("active");
    load();
  }

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

function norm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }

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
