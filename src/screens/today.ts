import { h, topbar, screen, navigate } from "../ui";
import { db } from "../db";
import { isSaturday, isoDate, ym, saturdaysInMonth, ymParts, parseIso, MONTHS_SHORT, ddMmmYyyy } from "../util";
import { currentFireSession } from "../fireSchedule";
import { bankComplete } from "./battery";

// Today only covers what is actually due today: the daily ICCP reading and the
// Saturday safety routine. The monthly records live under Records, and the
// month-end download under Export — neither belongs on this screen.
type Mode = "daily" | "sat";

// The readings a day needs before it counts as done. Mirrors the ICCP screen's
// own rule: shaft potential is only required when the ship is under way (at
// Port/Anchor the shaft isn't turning, so it's fixed at 0).
const ICCP_READINGS = ["draft", "seaTemp", "amp", "volt", "cell1", "cell2"] as const;
const ICCP_STATIONARY = new Set(["Port", "Anchor"]);

/** True when every reading for the day has been entered. */
function iccpComplete(r: any): boolean {
  if (!r) return false;
  const keys: string[] = [...ICCP_READINGS];
  if (!ICCP_STATIONARY.has(r.area ?? "Sea")) keys.push("shaftMv");
  return keys.every((k) => typeof r[k] === "number");
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
  // The daily ICCP reading is always the one shown first — it is taken every
  // single day. On a Saturday the safety routine takes the larger hero tile
  // (it is the bigger job that day), but ICCP is still the open section.
  const primary: Mode = sat ? "sat" : "daily";
  let active: Mode = "daily";

  // ---- gather quick status for the tile badges ----
  const iccpToday = await db.iccpDaily.get(todayIso);
  // A day is "entered" only when EVERY reading is in — a part-filled day is
  // still pending work. `area` is auto-filled on opening the screen, so it must
  // not count towards this at all.
  const iccpDone = iccpComplete(iccpToday);

  const { year, month } = ymParts(curYm);
  const sats = saturdaysInMonth(year, month);
  const battDates = new Set((await db.battery.toArray()).map((e) => e.date));
  const pastSats = sats.filter((s) => s <= todayIso);
  const missed = pastSats.filter((s) => !battDates.has(s));
  const nextSat = sats.find((s) => s > todayIso);
  const batTodayCount = sat
    ? (await db.battery.where("date").equals(todayIso).toArray()).filter(bankComplete).length
    : 0;

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

  // ---- tile descriptors ----
  const badge = (cls: string, txt: string) => h("span", { class: `chip ${cls}` }, txt);
  function tileInfo(mode: Mode): { ic: string; title: string; sub: string; badge: HTMLElement } {
    if (mode === "daily") {
      return {
        ic: "🌊", title: "ICCP / MGPS",
        sub: iccpDone ? "Entered today" : "Daily reading due",
        badge: iccpDone ? badge("done", "✓") : badge("due", "Due"),
      };
    }
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
  const order: Mode[] = ["daily", "sat"];
  const secondary = order.filter((m) => m !== primary);
  const modebar = h(
    "div",
    { class: "modebar" },
    buildTile(primary, true),
    h("div", { class: "mode-row" }, ...secondary.map((m) => buildTile(m, false)))
  );

  const listEl = h("div", {});

  // ---- month-to-date progress, shown as small cards that slide out from under
  // the record card so the user can see at a glance how much is still pending.
  const dim = new Date(year, month, 0).getDate();
  const daysSoFar = Math.min(dim, today.getDate());
  const iccpRows = await db.iccpDaily
    .where("date").between(`${curYm}-00`, `${curYm}-99`).toArray();
  // Fully-entered days only; anything part-filled counts as still pending.
  const iccpEntered = iccpRows.filter(iccpComplete).length;
  const iccpPending = Math.max(0, daysSoFar - iccpEntered);

  // Only fully-entered banks count — a bank with one cell filled is still due.
  const battBySat = new Map<string, number>();
  for (const e of await db.battery.toArray()) {
    if (!e.date.startsWith(curYm) || !bankComplete(e)) continue;
    battBySat.set(e.date, (battBySat.get(e.date) ?? 0) + 1);
  }
  const battDone = pastSats.filter((s) => (battBySat.get(s) ?? 0) >= 5).length;
  const battPending = Math.max(0, pastSats.length - battDone);

  /**
   * One small stat slip. `tone` colours the number: green when nothing is
   * outstanding, amber when something is, plain otherwise.
   */
  function stat(value: string | number, label: string, tone: "good" | "warn" | "plain"): HTMLElement {
    return h("div", { class: `statslip tone-${tone}` },
      h("span", { class: "sc-val" }, String(value)),
      h("span", { class: "sc-lab" }, label));
  }

  function statsFor(mode: Mode): HTMLElement {
    const mon = MONTHS_SHORT[month - 1].toUpperCase();
    if (mode === "daily") {
      return h("div", { class: "statrow" },
        stat(`${iccpEntered}/${daysSoFar}`, `days done in ${mon}`, iccpPending === 0 ? "good" : "plain"),
        stat(iccpPending, iccpPending === 1 ? "day pending" : "days pending",
          iccpPending === 0 ? "good" : "warn"));
    }
    const fireLeft = Math.max(0, fireUpcomingDets.length - fireDoneUpcoming);
    return h("div", { class: "statrow" },
      stat(`${battDone}/${pastSats.length}`, `battery Sats in ${mon}`, battPending === 0 ? "good" : "plain"),
      stat(`${fireDoneUpcoming}/${fireUpcomingDets.length}`, "detectors tested",
        fireUpcomingDets.length > 0 && fireLeft === 0 ? "good" : "plain"),
      ...(fireLeft > 0 ? [stat(fireLeft, "left on the round", "warn")] : []));
  }

  function setMode(mode: Mode) {
    if (mode === active) return;
    active = mode;
    for (const m of order) tiles[m]?.classList.toggle("active", m === active);
    renderList();
  }

  function renderList() {
    listEl.replaceChildren();
    if (active === "daily") {
      listEl.append(
        cardLink("🌊", "ICCP / MGPS Reading",
          `${ddMmmYyyy(todayIso)}${iccpDone ? " · entered" : " · tap to enter today"}`, "/rec/iccp",
          iccpDone ? h("span", { class: "chip done" }, "✓") : h("span", { class: "chip due" }, "Due"))
      );
    } else {
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
    }

    // Stats slide out from beneath the record card above them.
    const stats = statsFor(active);
    listEl.append(stats);
    requestAnimationFrame(() => stats.classList.add("in"));
  }

  mount.append(
    topbar("Month End", `${await vesselName()} · ${ddMmmYyyy(todayIso)}${sat ? " · SATURDAY" : ""}`),
    screen(modebar, h("div", { style: { height: "6px" } }), listEl)
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
