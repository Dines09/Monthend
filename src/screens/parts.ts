import { h, navigate } from "../ui";
import { MONTHS_FULL, ym as ymOf } from "../util";

/**
 * Month selector for a year. Months after `maxYm` (default: the current
 * calendar month) are disabled — you can't build a month-end for a month that
 * hasn't happened yet.
 */
export function monthPicker(currentYm: string, onChange: (ym: string) => void, year = 2026, maxYm = ymOf(new Date())): HTMLElement {
  const sel = h("select", {
    onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
  });
  for (let m = 1; m <= 12; m++) {
    const v = `${year}-${String(m).padStart(2, "0")}`;
    const future = v > maxYm;
    sel.append(h("option", { value: v, selected: v === currentYm, disabled: future || undefined },
      `${MONTHS_FULL[m - 1]} ${year}${future ? " —" : ""}`));
  }
  return sel;
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
