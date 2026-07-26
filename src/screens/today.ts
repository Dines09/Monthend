import { h, topbar, screen, navigate } from "../ui";
import { db } from "../db";
import { isSaturday, isoDate, ym, saturdaysInMonth, ymParts, parseIso, MONTHS_SHORT, ddMmmYyyy } from "../util";
import {
  motorTempStatus, vibrationStatus, busbarStatus, freonStatus, cmStatus, type RecStatus,
} from "../status";
import { currentFireSession } from "../fireSchedule";

// The daily ICCP reading is no longer a mode: it has its own permanent card
// pinned at the bottom of the screen, because it has to be opened every day.
type Mode = "sat" | "monthly";

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
  // On a Saturday the safety routine leads; on any other day the monthly work is
  // what's actually open, so that's what gets shown expanded.
  const primary: Mode = sat ? "sat" : "monthly";
  let active: Mode = primary;

  // ---- gather quick status for the tile badges ----
  const iccpToday = await db.iccpDaily.get(todayIso);
  const iccpDone = !!(iccpToday && (iccpToday.amp != null || iccpToday.area));

  const { year, month } = ymParts(curYm);
  const sats = saturdaysInMonth(year, month);
  const battDates = new Set((await db.battery.toArray()).map((e) => e.date));
  const pastSats = sats.filter((s) => s <= todayIso);
  const missed = pastSats.filter((s) => !battDates.has(s));
  const nextSat = sats.find((s) => s > todayIso);
  const batTodayCount = sat ? await db.battery.where("date").equals(todayIso).count() : 0;

  // Fire-detector roster: which detectors are scheduled for the upcoming (or
  // today's) Saturday, and how many are already tested this quarter.
  const fireSession = currentFireSession(todayIso);
  const fireUpcoming = fireSession.sessionSat;
  const fireUpcomingDets = fireSession.plan.bySat.get(fireUpcoming) ?? [];
  let fireDoneUpcoming = 0;
  {
    const keys = new Set(fireUpcomingDets.map((d) => d.detKey));
    const { startYm, endYm } = fireSession.plan;
    const done = new Set<string>();
    for (const t of await db.fireTest.toArray()) {
      if (!keys.has(t.detKey)) continue;
      const m = t.testedDate.slice(0, 7);
      if (m >= startYm && m <= endYm) done.add(t.detKey);
    }
    fireDoneUpcoming = done.size;
  }
  const fireScheduledToday = sat && fireUpcoming === todayIso ? fireUpcomingDets.length : 0;
  const fireDoneToday = sat && fireUpcoming === todayIso ? fireDoneUpcoming : 0;

  const monthlyDefs: [string, string, string, () => Promise<RecStatus>][] = [
    ["🌡️", "Motor Temp", "/rec/motortemp", () => motorTempStatus(curYm)],
    ["📳", "Motor Vibration", "/rec/vibration", () => vibrationStatus(curYm)],
    ["⚡", "Busbar Temp", "/rec/busbar", () => busbarStatus(curYm)],
    ["❄️", "Freon Consumption", "/rec/freon", () => freonStatus(curYm)],
    ["📊", "Condition Monitoring", "/rec/conditionmon", () => cmStatus(curYm)],
  ];
  const monthlyStatuses = await Promise.all(monthlyDefs.map((d) => d[3]()));
  const monthlyDone = monthlyStatuses.filter((s) => s.state === "done").length;

  // ---- tile descriptors ----
  const badge = (cls: string, txt: string) => h("span", { class: `chip ${cls}` }, txt);
  function tileInfo(mode: Mode): { ic: string; title: string; sub: string; badge: HTMLElement } {
    if (mode === "sat") {
      if (sat) {
        const fireDone = fireScheduledToday === 0 || fireDoneToday >= fireScheduledToday;
        const done = batTodayCount >= 5 && fireDone;
        return { ic: "🛟", title: "Saturday", sub: "Safety routine · today",
          badge: done ? badge("done", "✓") : badge("due", "Due") };
      }
      if (missed.length)
        return { ic: "🛟", title: "Saturday", sub: `${missed.length} missed this month`,
          badge: badge("bad", String(missed.length)) };
      return { ic: "🛟", title: "Saturday",
        sub: nextSat ? `Next: ${dayLabel(nextSat)}` : "All Saturdays done",
        badge: badge("done", "✓") };
    }
    return {
      ic: "📅", title: "Monthly", sub: `${MONTHS_SHORT[month - 1]} · ${monthlyDone}/5 files done`,
      badge: monthlyDone >= 5 ? badge("done", "✓") : badge("due", `${5 - monthlyDone}`),
    };
  }

  const tiles: Partial<Record<Mode, HTMLElement>> = {};
  function buildTile(mode: Mode, hero: boolean): HTMLElement {
    const info = tileInfo(mode);
    const isSafety = mode === "sat";
    const el = h(
      "button",
      {
        class: `modetile ${hero ? "hero" : ""} ${isSafety ? "safety" : ""} ${mode === active ? "active" : ""}`,
        onClick: () => setMode(mode),
      },
      h("span", { class: "mt-ic" }, info.ic),
      h("div", { class: "mt-body" }, h("div", { class: "mt-title" }, info.title), h("div", { class: "mt-sub" }, info.sub)),
      h("span", { class: "mt-badge" }, info.badge)
    );
    tiles[mode] = el;
    return el;
  }

  // hero = the day's primary mode; the other one sits in the row below.
  const order: Mode[] = ["sat", "monthly"];
  const secondary = order.filter((m) => m !== primary);
  const modebar = h(
    "div",
    { class: "modebar" },
    buildTile(primary, true),
    h("div", { class: "mode-row" }, ...secondary.map((m) => buildTile(m, false)))
  );

  const listEl = h("div", {});

  // The daily ICCP / MGPS reading lives in its own permanent card at the bottom
  // of the screen — always visible, never behind a tab, because it's opened
  // every single day regardless of which mode is selected above.
  const dailyCard = h(
    "div",
    { class: `dailydock ${iccpDone ? "done" : ""}`, onClick: () => navigate("/rec/iccp") },
    h("div", { class: "dd-ic" }, "🌊"),
    h("div", { class: "dd-body" },
      h("div", { class: "dd-title" }, "ICCP / MGPS Reading"),
      h("div", { class: "dd-sub" },
        iccpDone ? `${ddMmmYyyy(todayIso)} · entered` : `${ddMmmYyyy(todayIso)} · tap to enter today`)),
    iccpDone ? h("span", { class: "chip done" }, "✓") : h("span", { class: "chip due" }, "Due")
  );

  function setMode(mode: Mode) {
    if (mode === active) return;
    active = mode;
    for (const m of order) tiles[m]?.classList.toggle("active", m === active);
    renderList();
  }

  function renderList() {
    listEl.replaceChildren();
    if (active === "sat") {
      if (sat) {
        listEl.append(
          cardLink("🔋", "Battery Log",
            batTodayCount > 0 ? `${batTodayCount}/5 banks entered` : "Weekly battery test — tap to record", "/rec/battery",
            batTodayCount >= 5 ? h("span", { class: "chip done" }, "✓") : h("span", { class: "chip due" }, "Due")),
          cardLink("🚨", "Fire Detector Test",
            `${fireDoneToday}/${fireScheduledToday} scheduled detectors today`, "/rec/fire",
            fireDoneToday >= fireScheduledToday
              ? h("span", { class: "chip done" }, "✓")
              : h("span", { class: "chip due" }, `${fireDoneToday}/${fireScheduledToday}`))
        );
      } else {
        if (missed.length) {
          listEl.append(
            cardLink("🔋", "Battery Log pending", `${missed.length} Saturday(s) not recorded`, "/rec/battery",
              h("span", { class: "chip bad" }, `${missed.length}`))
          );
        }
        listEl.append(
          h("div", { class: "card" },
            h("p", { class: "hint", style: { margin: 0 } },
              nextSat ? `Next Saturday routine: ${dayLabel(nextSat)}. Battery + fire-detector tests.`
                      : "No more Saturdays this month."))
        );
        listEl.append(cardLink("🔋", "Battery Log", "Open weekly battery record", "/rec/battery"));
        listEl.append(cardLink("🚨", "Fire Detector Test",
          `Next: ${fireUpcomingDets.length} detectors on ${dayLabel(fireUpcoming)}`, "/rec/fire"));
      }
    } else {
      monthlyDefs.forEach(([ic, title, route], i) => {
        listEl.append(cardLink(ic, title, monthlyStatuses[i].label, route, statusChip(monthlyStatuses[i])));
      });
      listEl.append(h("div", { class: "divider" }));
      listEl.append(
        h("div", { class: "card tap accent", onClick: () => navigate("/export") },
          h("div", { class: "card-row" },
            h("div", { class: "icon" }, "⬇️"),
            h("div", { class: "body" }, h("div", { class: "title" }, "Export Month End"),
              h("div", { class: "desc" }, "Download all Excel files for the month")),
            h("div", { class: "chev" }, "›")))
      );
    }
  }

  mount.append(
    topbar("Month End", `${await vesselName()} · ${ddMmmYyyy(todayIso)}${sat ? " · SATURDAY" : ""}`),
    screen(modebar, h("div", { style: { height: "6px" } }), listEl, dailyCard)
  );
  renderList();
}

function dayLabel(iso: string): string {
  const d = parseIso(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS_SHORT[d.getMonth()].toUpperCase()}`;
}

async function vesselName(): Promise<string> {
  const s = await db.settings.get("vessel");
  return (s?.value as string) || "SEAWAYS MIRAGE";
}
