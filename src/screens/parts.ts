import { h, navigate } from "../ui";
import { MONTHS_FULL, ym as ymOf } from "../util";

/** Month selector for the current seed year (defaults to a given year). */
export function monthPicker(currentYm: string, onChange: (ym: string) => void, year = 2026): HTMLElement {
  const sel = h("select", {
    onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
  });
  for (let m = 1; m <= 12; m++) {
    const v = `${year}-${String(m).padStart(2, "0")}`;
    sel.append(h("option", { value: v, selected: v === currentYm }, `${MONTHS_FULL[m - 1]} ${year}`));
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
