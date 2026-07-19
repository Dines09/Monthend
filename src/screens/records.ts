import { h, topbar, screen, navigate } from "../ui";
import { RECORDS, type Cadence } from "../records";

const cadenceLabel: Record<Cadence, string> = {
  daily: "Daily",
  weekly: "Weekly (Saturday)",
  monthly: "Monthly",
  quarterly: "Quarterly (Saturday)",
  event: "As needed",
};

export async function renderRecords(_p: Record<string, string>, mount: HTMLElement) {
  const cards = RECORDS.map((r) =>
    h(
      "div",
      { class: "card tap", onClick: () => navigate(r.route) },
      h(
        "div",
        { class: "card-row" },
        h("div", { class: "icon" }, r.icon),
        h(
          "div",
          { class: "body" },
          h("div", { class: "title" }, r.title),
          h("div", { class: "desc" }, `${r.fileRef} · ${cadenceLabel[r.cadence]}`)
        ),
        h("div", { class: "chev" }, "›")
      )
    )
  );

  mount.append(
    topbar("Records", "Select a file to enter data"),
    screen(
      h("p", { class: "hint", style: { marginTop: "4px" } }, "Choose any record to add or edit its data. Export combines everything into the month-end Excel files."),
      ...cards
    )
  );
}
