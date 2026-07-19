import { h, topbar, screen, navigate } from "../ui";
import { db } from "../db";
import { isSaturday, isoDate, ym, monthLabel, saturdaysInMonth, ymParts } from "../util";
import { RECORDS } from "../records";
import {
  iccpStatus, batteryStatus, fireStatus, motorTempStatus,
  vibrationStatus, busbarStatus, freonStatus, cmStatus, type RecStatus,
} from "../status";

function statusChip(s: RecStatus): HTMLElement {
  const cls = s.state === "done" ? "done" : s.state === "partial" ? "due" : "pending";
  const txt = s.state === "done" ? "Done" : s.state === "partial" ? s.label : "Pending";
  return h("span", { class: `chip ${cls}` }, txt);
}

function cardLink(icon: string, title: string, desc: string, route: string, right?: HTMLElement): HTMLElement {
  return h(
    "div",
    { class: "card tap", onClick: () => navigate(route) },
    h(
      "div",
      { class: "card-row" },
      h("div", { class: "icon" }, icon),
      h("div", { class: "body" }, h("div", { class: "title" }, title), h("div", { class: "desc" }, desc)),
      right ?? h("div", { class: "chev" }, "›")
    )
  );
}

export async function renderToday(_p: Record<string, string>, mount: HTMLElement) {
  const today = new Date();
  const todayIso = isoDate(today);
  const curYm = ym(today);
  const sat = isSaturday(today);

  const nodes: Node[] = [];

  // ----- Daily section -----
  nodes.push(h("h2", {}, "Daily"));
  const iccpToday = await db.iccpDaily.get(todayIso);
  const iccpDone = iccpToday && (iccpToday.amp != null || iccpToday.area);
  nodes.push(
    cardLink(
      "🌊",
      "ICCP / MGPS Reading",
      todayIso + (iccpDone ? " · entered" : " · tap to enter today"),
      "/rec/iccp",
      iccpDone ? h("span", { class: "chip done" }, "✓") : h("span", { class: "chip due" }, "Due")
    )
  );

  // ----- Weekly (Saturday) section -----
  if (sat) {
    nodes.push(h("h2", {}, "This Saturday"));
    const batToday = await db.battery.where("date").equals(todayIso).count();
    nodes.push(
      cardLink(
        "🔋",
        "Battery Log",
        batToday > 0 ? `${batToday}/5 banks entered` : "Weekly battery test — tap to record",
        "/rec/battery",
        batToday >= 5 ? h("span", { class: "chip done" }, "✓") : h("span", { class: "chip due" }, "Due")
      )
    );
    const fireToday = await db.fireTest.where("testedDate").equals(todayIso).count();
    nodes.push(
      cardLink(
        "🚨",
        "Fire Detector Test",
        fireToday > 0 ? `${fireToday} detectors tested today` : "Weekly detector test — tap to record",
        "/rec/fire",
        fireToday > 0 ? h("span", { class: "chip done" }, `${fireToday}`) : h("span", { class: "chip due" }, "Due")
      )
    );
  } else {
    // Show upcoming Saturday hint + any missed Saturdays this month
    const { year, month } = ymParts(curYm);
    const sats = saturdaysInMonth(year, month).filter((s) => s <= todayIso);
    const battDates = new Set((await db.battery.toArray()).map((e) => e.date));
    const missed = sats.filter((s) => !battDates.has(s));
    if (missed.length) {
      nodes.push(h("h2", {}, "Missed Saturdays"));
      nodes.push(
        cardLink("🔋", "Battery Log pending", `${missed.length} Saturday(s) not recorded`, "/rec/battery",
          h("span", { class: "chip bad" }, `${missed.length}`))
      );
    }
  }

  // ----- Monthly section -----
  nodes.push(h("h2", {}, `Monthly · ${monthLabel(curYm)}`));
  const monthly: [string, string, string, () => Promise<RecStatus>][] = [
    ["🌡️", "Motor Temp", "/rec/motortemp", () => motorTempStatus(curYm)],
    ["📳", "Motor Vibration", "/rec/vibration", () => vibrationStatus(curYm)],
    ["⚡", "Busbar Temp", "/rec/busbar", () => busbarStatus(curYm)],
    ["❄️", "Freon Consumption", "/rec/freon", () => freonStatus(curYm)],
    ["📊", "Condition Monitoring", "/rec/conditionmon", () => cmStatus(curYm)],
  ];
  for (const [ic, title, route, fn] of monthly) {
    const s = await fn();
    nodes.push(cardLink(ic, title, s.label, route, statusChip(s)));
  }

  // ----- Export shortcut -----
  nodes.push(h("div", { class: "divider" }));
  nodes.push(
    h("div", { class: "card tap", onClick: () => navigate("/export"), style: { background: "var(--accent-d)", borderColor: "var(--accent)" } },
      h("div", { class: "card-row" },
        h("div", { class: "icon" }, "⬇️"),
        h("div", { class: "body" }, h("div", { class: "title" }, "Export Month End"),
          h("div", { class: "desc" }, "Download all Excel files for the month")),
        h("div", { class: "chev" }, "›")))
  );

  mount.append(
    topbar("Month End", `${await vesselName()} · ${todayIso}${sat ? " · SATURDAY" : ""}`),
    screen(...nodes)
  );
}

async function vesselName(): Promise<string> {
  const s = await db.settings.get("vessel");
  return (s?.value as string) || "SEAWAYS MIRAGE";
}
