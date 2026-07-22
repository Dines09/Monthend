import { h, topbar, screen, numInput, toast, segmented, type ReadingSpec } from "../ui";
import { db, type BatteryEntry } from "../db";
import { masters } from "../seed";
import { saturdaysInMonth, ymParts, debounce, ddMmmYyyy } from "../util";
import { monthPicker, toolbar } from "./parts";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Per-bank reading rules. 2V cells (GS/GMDSS) sit around 2.11 V; the 12 V banks
// (lifeboat / emergency gen) read like 13.31 V; CCA is a 3-digit count 500–900.
const CELL_2V: ReadingSpec = { min: 2.0, max: 2.5, decimals: 2, intDigits: 1, warn: "Cell voltage should be ~2.0–2.5 V. Check the reading." };
const CELL_12V: ReadingSpec = { min: 10, max: 15, decimals: 2, intDigits: 2, warn: "Battery voltage should be ~10–15 V. Check the reading." };
const CCA_SPEC: ReadingSpec = { min: 500, max: 900, decimals: 0, intDigits: 3, warn: "CCA should be 500–900. Check the reading." };

export async function renderBattery(_p: Record<string, string>, mount: HTMLElement) {
  const today = new Date();
  let curYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  let selDate = "";
  let bankIdx = 0;

  const banks = masters.batteryBanks;
  const dateSelect = h("select", { class: "dayselect" });
  const bankSeg = segmented({
    options: banks.map((b: any) => b.id),
    labels: banks.map((b: any) => shortBankName(b)),
    value: banks[bankIdx].id,
    compact: true,
    onPick: (v) => { bankIdx = banks.findIndex((b: any) => b.id === v); renderBank(); },
  });
  const body = h("div", {});

  function rebuildDates() {
    dateSelect.replaceChildren();
    const { year, month } = ymParts(curYm);
    const sats = saturdaysInMonth(year, month);
    for (const s of sats) dateSelect.append(h("option", { value: s, selected: s === selDate }, `Saturday · ${ddMmmYyyy(s)}`));
    if (!sats.includes(selDate)) selDate = sats[0] ?? "";
    dateSelect.value = selDate;
  }

  async function renderBank() {
    body.replaceChildren();
    if (!selDate) { body.append(h("div", { class: "list-empty" }, "No Saturdays in this month.")); return; }
    const bank = banks[bankIdx];
    const isCCA = bank.measure === "CCA";
    const existing = await db.battery.where("[date+bankId]").equals([selDate, bank.id]).first();
    const readings: BatteryEntry["readings"] = bank.cellLabels.map((label: string, i: number) => {
      const r = existing?.readings?.[i];
      return { label, aux: r?.aux ?? (isCCA ? null : "N/A"), volt: r?.volt ?? null };
    });
    let remarkVal = existing?.remark ?? "GOOD";
    const meta = await db.batteryMeta.get(bank.id);

    // Description of the bank being entered.
    body.append(
      h("div", { class: "card accent" },
        h("div", { style: { fontWeight: 700, marginBottom: "4px" } }, bank.desc),
        meta?.info ? h("div", { class: "hint" }, meta.info) : null)
    );

    // Live total (auto-summed from the cell voltages).
    const totalVal = h("span", { class: "bt-val" }, "0");
    function recalcTotal(): number {
      const sum = readings.reduce((a, r) => a + (typeof r.volt === "number" ? (r.volt as number) : 0), 0);
      totalVal.textContent = sum ? String(round2(sum)) : "0";
      return sum;
    }

    // Voltage rule for this bank: 2 V cells vs. 12 V (lifeboat / emergency) banks.
    const voltSpec = isCCA ? CELL_12V : CELL_2V;

    // Ordered list of inputs so a settled value auto-advances to the next field.
    const order: HTMLInputElement[] = [];
    const focusNext = (from: HTMLInputElement) => {
      const idx = order.indexOf(from);
      for (let j = idx + 1; j < order.length; j++) {
        if (order[j].value.trim() === "") { order[j].focus(); return; }
      }
      (document.activeElement as HTMLElement | null)?.blur?.();
    };

    // Battery graphic: one tappable cell per 2V cell (or per battery for CCA).
    const cols = readings.length <= 2 ? 2 : readings.length <= 6 ? 3 : 4;
    const cellsWrap = h("div", { class: "batt-cells", style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } });
    readings.forEach((r, i) => {
      const cell = h("div", { class: `cell ${r.volt != null ? "filled" : ""}` });
      const warn = h("div", { class: "field-warn" }, "");
      const voltInp = numInput({
        value: r.volt ?? null, placeholder: "—", spec: voltSpec,
        onInput: debounce(async (v) => { readings[i].volt = v; cell.classList.toggle("filled", v != null); recalcTotal(); await persist(); }, 300),
        onSettled: () => focusNext(voltInp),
      });
      order.push(voltInp);
      cell.append(h("div", { class: "cnum" }, isCCA ? r.label : `Cell ${r.label}`), voltInp);
      if (isCCA) {
        const ccaInp = numInput({
          value: typeof r.aux === "number" ? r.aux : null, placeholder: "CCA", spec: CCA_SPEC,
          onInput: debounce(async (v) => { readings[i].aux = v; await persist(); }, 300),
          onSettled: () => focusNext(ccaInp),
        });
        ccaInp.classList.add("cca");
        order.push(ccaInp);
        cell.append(ccaInp);
      }
      cell.append(warn);
      cellsWrap.append(cell);
    });

    const remarkSel = h("select", { onChange: async (e: Event) => { remarkVal = (e.target as HTMLSelectElement).value; await persist(); } },
      ...["GOOD", "SATISFACTORY", "WEAK", "RENEW"].map((x) => h("option", { value: x, selected: remarkVal === x }, x)));

    body.append(
      h("div", { class: "batt" }, h("div", { class: "batt-shell" }, cellsWrap)),
      h("div", { class: "batt-total" }, totalVal, h("span", { class: "bt-unit" }, "V"), h("span", { class: "bt-lab" }, "Total")),
      h("label", { class: "field", style: { marginTop: "14px" } }, h("span", { class: "lab" }, "Remarks"), remarkSel)
    );
    recalcTotal();

    async function persist() {
      const sum = recalcTotal();
      const anyVolt = readings.some((r) => typeof r.volt === "number");
      const cur = await db.battery.where("[date+bankId]").equals([selDate, bank.id]).first();
      const entry: BatteryEntry = {
        id: cur?.id, date: selDate, bankId: bank.id, readings,
        total: anyVolt ? round2(sum) : null, remark: remarkVal,
      };
      if (cur?.id) await db.battery.update(cur.id, entry);
      else await db.battery.add(entry);
      toast("Saved", 700);
    }
  }

  dateSelect.addEventListener("change", () => { selDate = dateSelect.value; renderBank(); });

  mount.append(
    topbar("Battery Log", "TEC(A) 17 · Weekly", "/records"),
    screen(
      toolbar(monthPicker(curYm, (v) => { curYm = v; rebuildDates(); renderBank(); }, today.getFullYear()), h("span", { class: "progress" }, "Sat")),
      dateSelect,
      h("div", { style: { height: "10px" } }),
      bankSeg,
      h("div", { style: { height: "12px" } }),
      body
    )
  );
  rebuildDates();
  await renderBank();
}

function shortBankName(b: any): string {
  const map: Record<string, string> = { gs: "Gen Svc", gmdss: "GMDSS", lbport: "LB Port", lbstbd: "LB Stbd", emgen: "Emg Gen" };
  return map[b.id] ?? b.id;
}
