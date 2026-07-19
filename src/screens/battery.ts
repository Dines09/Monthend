import { h, topbar, screen, numInput, toast } from "../ui";
import { db, type BatteryEntry } from "../db";
import { masters } from "../seed";
import { isoDate, defaultReportYm, saturdaysInMonth, ymParts, debounce } from "../util";
import { monthPicker, toolbar } from "./parts";

export async function renderBattery(_p: Record<string, string>, mount: HTMLElement) {
  const today = new Date();
  let curYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  let selDate = "";
  let bankIdx = 0;

  const dateSelect = h("select", {});
  const bankSeg = h("div", { class: "seg", style: { flexWrap: "wrap" } });
  const body = h("div", {});

  function rebuildDates() {
    dateSelect.replaceChildren();
    const { year, month } = ymParts(curYm);
    const sats = saturdaysInMonth(year, month);
    for (const s of sats) dateSelect.append(h("option", { value: s, selected: s === selDate }, `Saturday · ${s}`));
    if (!sats.includes(selDate)) selDate = sats[0] ?? "";
    dateSelect.value = selDate;
  }

  function rebuildBanks() {
    bankSeg.replaceChildren();
    masters.batteryBanks.forEach((b, i) => {
      bankSeg.append(h("button", { class: i === bankIdx ? "active" : "", onClick: () => { bankIdx = i; renderBank(); refreshSeg(); } },
        shortBankName(b)));
    });
  }
  function refreshSeg() {
    bankSeg.querySelectorAll("button").forEach((btn, i) => btn.classList.toggle("active", i === bankIdx));
  }

  async function renderBank() {
    body.replaceChildren();
    if (!selDate) { body.append(h("div", { class: "list-empty" }, "No Saturdays in this month.")); return; }
    const bank = masters.batteryBanks[bankIdx];
    const existing = await db.battery.where("[date+bankId]").equals([selDate, bank.id]).first();
    const readings: BatteryEntry["readings"] = bank.cellLabels.map((label: string, i: number) => {
      const r = existing?.readings?.[i];
      return { label, aux: r?.aux ?? (bank.measure === "Sp. Grv" ? "N/A" : null), volt: r?.volt ?? null };
    });

    const meta = await db.batteryMeta.get(bank.id);
    body.append(
      h("div", { class: "card", style: { background: "var(--accent-d)" } },
        h("div", { style: { fontWeight: 700, marginBottom: "4px" } }, bank.desc),
        meta?.info ? h("div", { class: "hint" }, meta.info) : null)
    );

    const measureIsVoltOnly = bank.measure !== "Sp. Grv";
    for (let i = 0; i < readings.length; i++) {
      const r = readings[i];
      const voltInp = numInput({ value: r.volt ?? null, placeholder: "Volt",
        onInput: debounce(async (v) => { readings[i].volt = v; await persist(); }, 300) });
      let auxNode: Node | null = null;
      if (bank.measure === "CCA") {
        auxNode = numInput({ value: typeof r.aux === "number" ? r.aux : null, placeholder: "CCA",
          onInput: debounce(async (v) => { readings[i].aux = v; await persist(); }, 300) });
      }
      body.append(
        h("div", { class: "mrow" },
          h("div", { class: "mname" }, r.label),
          h("div", { style: { display: "flex", gap: "6px" } }, auxNode, voltInp))
      );
    }

    const totalInp = numInput({ value: existing?.total ?? null, placeholder: "Total Volts",
      onInput: debounce(async (v) => { await persist(v); }, 300) });
    const remarkSel = h("select", { onChange: async (e: Event) => { await persist(undefined, (e.target as HTMLSelectElement).value); } },
      ...["GOOD", "SATISFACTORY", "WEAK", "RENEW"].map((x) => h("option", { value: x, selected: (existing?.remark ?? "GOOD") === x }, x)));
    body.append(
      h("label", { class: "field", style: { marginTop: "10px" } }, h("span", { class: "lab" }, "Total Volts"), totalInp),
      h("label", { class: "field" }, h("span", { class: "lab" }, "Remarks"), remarkSel)
    );

    async function persist(total?: number | null, remark?: string) {
      const cur = await db.battery.where("[date+bankId]").equals([selDate, bank.id]).first();
      const entry: BatteryEntry = {
        id: cur?.id,
        date: selDate,
        bankId: bank.id,
        readings,
        total: total !== undefined ? total : cur?.total ?? null,
        remark: remark !== undefined ? remark : cur?.remark ?? "GOOD",
      };
      if (cur?.id) await db.battery.update(cur.id, entry);
      else await db.battery.add(entry);
      toast("Saved", 800);
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
      h("div", { style: { height: "10px" } }),
      body
    )
  );
  rebuildDates();
  rebuildBanks();
  await renderBank();
}

function shortBankName(b: any): string {
  const map: Record<string, string> = { gs: "Gen Svc", gmdss: "GMDSS", lbport: "LB Port", lbstbd: "LB Stbd", emgen: "Emg Gen" };
  return map[b.id] ?? b.id;
}
