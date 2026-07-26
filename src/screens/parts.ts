import { h, navigate, wheelPicker } from "../ui";
import { MONTHS_FULL, ym as ymOf } from "../util";

/** Title-case month name for on-screen chips ("July", not "JULY"). */
export function monthName(month: number): string {
  const n = MONTHS_FULL[month - 1];
  return `${n[0]}${n.slice(1).toLowerCase()}`;
}

/** The years the user may pick from: 2026 (first season) up to this year. */
export function selectableYears(maxYm = ymOf(new Date())): number[] {
  const last = Number(maxYm.slice(0, 4));
  const out: number[] = [];
  for (let y = 2026; y <= Math.max(2026, last); y++) out.push(y);
  return out;
}

/**
 * Open the shared month/year scroll wheel. Month and year are separate columns
 * so a new year appears automatically once it starts; months after `maxYm` in
 * the newest year are filtered out — you can't report a month that hasn't
 * happened. Every screen uses this, so the picker feels identical everywhere.
 */
export function openMonthWheel(currentYm: string, onPick: (ym: string) => void, maxYm = ymOf(new Date())) {
  const years = selectableYears(maxYm);
  const curYear = Number(currentYm.slice(0, 4));
  const curMonth = Number(currentYm.slice(5, 7));

  // Months available in the currently-shown year. Re-derived on Done so that
  // picking a past year re-enables its later months.
  const monthsFor = (year: number) => {
    const maxMonth = year === Number(maxYm.slice(0, 4)) ? Number(maxYm.slice(5, 7)) : 12;
    return Array.from({ length: year > Number(maxYm.slice(0, 4)) ? 0 : maxMonth }, (_, i) => ({
      value: String(i + 1).padStart(2, "0"),
      text: monthName(i + 1),
    }));
  };

  wheelPicker({
    columns: [
      {
        options: monthsFor(curYear),
        value: String(curMonth).padStart(2, "0"),
        // With a single season there's nothing to scroll, so the year sits
        // beside the months as a fixed label instead of its own wheel.
        ...(years.length > 1 ? {} : { label: String(years[0]) }),
      },
      ...(years.length > 1
        ? [{ options: years.map((y) => ({ value: String(y), text: String(y) })), value: String(curYear) }]
        : []),
    ],
    onDone: (vals) => {
      const month = vals[0];
      const year = vals[1] ?? String(years[0]);
      let ym = `${year}-${month}`;
      // Guard the corner case of picking a later month in the newest year after
      // switching years inside the sheet.
      if (ym > maxYm) ym = maxYm;
      onPick(ym);
    },
  });
}

/**
 * The uniform month chip used across every dated screen — a compact rounded
 * button showing "July 2026" that opens the scroll wheel above.
 */
export function monthChip(currentYm: string, onChange: (ym: string) => void, maxYm = ymOf(new Date())): HTMLElement {
  const label = h("span", { class: "ph-mlab" });
  const btn = h("button", { class: "ph-month", type: "button" }, label);
  const sync = (ym: string) => {
    label.textContent = `${monthName(Number(ym.slice(5, 7)))} ${ym.slice(0, 4)}`;
  };
  let cur = currentYm;
  sync(cur);
  btn.addEventListener("click", () =>
    openMonthWheel(cur, (ym) => { cur = ym; sync(ym); onChange(ym); }, maxYm));
  return btn;
}

export function toolbar(...nodes: (Node | null)[]): HTMLElement {
  return h("div", { class: "toolbar" }, ...(nodes.filter(Boolean) as Node[]));
}

export function progressLabel(count: number, total: number, unit: string): HTMLElement {
  return h("span", { class: "progress" }, `${count}/${total} ${unit}`);
}

export function motorRow(opts: {
  name: string;
  sub?: string;
  filled: boolean;
  right: Node;
}): HTMLElement {
  return h(
    "div",
    { class: `mrow ${opts.filled ? "filled" : ""}` },
    h("div", { class: "mname" }, opts.name, opts.sub ? h("small", {}, opts.sub) : null),
    opts.right
  );
}

export function backTop(title: string) {
  return { title, back: "/records" };
}
