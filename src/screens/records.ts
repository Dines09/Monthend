import { h, topbar, screen, navigate } from "../ui";
import { RECORDS, type Cadence } from "../records";
import { statusBadge } from "../status";
import { defaultReportYm, monthLabel } from "../util";

const cadenceLabel: Record<Cadence, string> = {
  daily: "Daily",
  weekly: "Weekly (Saturday)",
  monthly: "Monthly",
  quarterly: "Quarterly (Saturday)",
  event: "As needed",
};

export async function renderRecords(_p: Record<string, string>, mount: HTMLElement) {
  // Progress is reported against the month the app is currently closing out —
  // the same month Export defaults to — so the two screens never disagree
  // about what is finished.
  const curYm = defaultReportYm();

  const cards = await Promise.all(RECORDS.map(async (r) => {
    const badge = await statusBadge(r.id, curYm);
    return h(
      "div",
      { class: "card tap rec-card", onClick: () => navigate(r.route) },
      badge,
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
    );
  }));

  mount.append(
    topbar("Records", "Select a file to enter data"),
    screen(
      h("p", { class: "hint", style: { marginTop: "4px" } },
        `Choose any record to add or edit its data. Progress shown for ${monthLabel(curYm)}.`),
      ...cards
    )
  );
}
