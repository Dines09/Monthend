import { h, topbar, screen, toast, segmented, navigate, progressRing } from "../ui";
import { db, getSetting, setSetting } from "../db";
import { isoDate, parseIso, isSaturday, MONTHS_SHORT, ddMmmYyyy } from "../util";
import { periodHead, bindHeadGestures } from "./periodhead";
import { matchRow, highlight, type SearchField } from "../search";
import {
  currentFireSession,
  sortByWalk,
  kindCounts,
  AREA_LABEL,
  KIND_META,
  SPECIAL_ACCESS,
  type QuarterPlan,
  type ScheduledDet,
  type DetKind,
  type ShipArea,
} from "../fireSchedule";

/** "04 JUL" */
function ddMon(iso: string): string {
  const d = parseIso(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS_SHORT[d.getMonth()].toUpperCase()}`;
}

/**
 * The list is grouped by the physical space you walk through, so the heading is
 * the area (E/R Floor, A Deck, …). Battery-operated units are their own group
 * because they're a separate sheet on the record.
 */
function areaHeading(d: ScheduledDet): string {
  return d.battery ? "Battery-operated" : AREA_LABEL[d.area];
}

/**
 * "What do I need to carry" for a set of detectors — the list of testers, not a
 * tally of detectors. One smoke tester covers every smoke detector on the round,
 * so this only answers *which* of the four items to pick up.
 */
function testerSummary(dets: ScheduledDet[]): HTMLElement {
  const present = new Set(dets.map((d) => d.kind));
  // Interface units need no tester carried, so they never appear in the
  // "what to carry" list — they're a visual check on the round instead.
  const kinds = (Object.keys(KIND_META) as DetKind[])
    .filter((k) => k !== "interface" && present.has(k));
  return h("div", { class: "tester-row" },
    ...kinds.map((k) =>
      h("div", { class: `tester-chip k-${k}` },
        h("span", { class: "tc-ic" }, KIND_META[k].icon),
        h("span", { class: "tc-t" }, KIND_META[k].tester))));
}

/** The special-access spaces (bosun store, BWTS room) present in a list. */
function specialAreas(dets: ScheduledDet[]): ShipArea[] {
  return SPECIAL_ACCESS.filter((a) => dets.some((d) => !d.battery && d.area === a));
}

/**
 * Standing pre-test warning for the alarm round.
 *
 * Testing the detectors sets off the systems wired to the fire alarm, so the
 * emergency stops have to be isolated *before* the first tester is lifted —
 * otherwise the AC and the sanitary fan trip and the round has to stop while
 * they are reset. This is not a per-Saturday condition and it is never
 * dismissed: it shows every time the screen is opened, above the list, so it
 * cannot be walked past.
 */
function isolationWarning(): HTMLElement {
  return h("div", { class: "isolate-warn", role: "alert" },
    h("span", { class: "iw-ic" }, "⛔"),
    h("div", { class: "iw-body" },
      h("div", { class: "iw-title" }, "Isolate emergency stops 3 before testing"),
      h("div", { class: "iw-sub" },
        "Avoids sudden shutdown of the AC, the sanitary fan and the other emergency-stop 3 systems when the alarm sounds.")));
}

/**
 * Warning banner for a round that goes into a space outside the normal
 * accommodation walk. These have to be opened up / arranged in advance, so the
 * user needs to see it before the day rather than on arriving at a locked door.
 */
function accessWarning(dets: ScheduledDet[]): HTMLElement | null {
  const areas = specialAreas(dets);
  if (!areas.length) return null;
  const names = areas.map((a) => AREA_LABEL[a]);
  const list = names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
    : names[0];
  return h("div", { class: "access-warn" },
    h("span", { class: "aw-ic" }, "⚠️"),
    h("div", { class: "aw-body" },
      h("div", { class: "aw-title" }, `${list} on this round`),
      h("div", { class: "aw-sub" },
        "Outside the accommodation walk — arrange access with the deck crew and carry the keys before you start.")));
}

export async function renderFire(_p: Record<string, string>, mount: HTMLElement) {
  const today = new Date();
  const todayIso = isoDate(today);
  const session = currentFireSession(todayIso);
  const plan: QuarterPlan = session.plan;

  let view: "session" | "all" = "session";
  let sessionSat = session.sessionSat;

  /**
   * Date the taps get logged under. A round done late is recorded on the day it
   * was actually walked, so a Saturday already in the past defaults to today
   * rather than back-dating itself to the schedule. Always user-editable.
   */
  const defaultRecordDate = (sat: string) => (sat < todayIso ? todayIso : sat);
  let recordDate = defaultRecordDate(sessionSat);

  // Tests already recorded this quarter: detKey -> latest ISO date.
  async function testedThisQuarter(): Promise<Map<string, string>> {
    const tests = await db.fireTest.toArray();
    const map = new Map<string, string>();
    for (const t of tests) {
      const m = t.testedDate.slice(0, 7);
      if (m < plan.startYm || m > plan.endYm) continue;
      const cur = map.get(t.detKey);
      if (!cur || t.testedDate > cur) map.set(t.detKey, t.testedDate);
    }
    return map;
  }

  async function toggle(d: ScheduledDet, logDate: string) {
    const evs = (await db.fireTest.where("detKey").equals(d.detKey).toArray()).filter((t) => {
      const m = t.testedDate.slice(0, 7);
      return m >= plan.startYm && m <= plan.endYm;
    });
    if (evs.length) {
      await db.fireTest.bulkDelete(evs.map((e) => e.id!));
    } else {
      await db.fireTest.add({ detKey: d.detKey, testedDate: logDate, remarks: "satisfactory" });
      toast(`Tested: ${d.id}`, 900);
    }
    await paint();
  }

  // A single detector row. The location is the actual address on board, so it
  // wraps in full — never truncated — and the tag carries a kind badge telling
  // the user which tester it needs.
  function detRow(d: ScheduledDet, tested: string | undefined, logDate: string, rightChip?: HTMLElement | null) {
    // While searching, the tag and location carry the highlight so the user can
    // see the matched text in place.
    const q = query.trim();
    return h(
      "div",
      {
        class: `det ${tested ? "tested" : ""}`,
        onClick: () => toggle(d, logDate),
      },
      h("div", { class: "cb" }, tested ? "✓" : ""),
      h("div", { class: "info" },
        h("div", { class: "idrow" },
          h("span", { class: "id" }, q ? highlight(d.id || "—", q) : (d.id || "—")),
          h("span", { class: `kind k-${d.kind}` }, KIND_META[d.kind].short)),
        h("div", { class: "loc" }, q ? highlight(d.location || "—", q) : (d.location || "—")),
        // SC/SCI/SC1 are interface units, not smoke detectors — no tester is
        // used on them, so the row says plainly what the job actually is.
        d.kind === "interface"
          ? h("div", { class: "det-note" }, "Interface unit — check this unit, not a smoke detector")
          : null),
      h("div", { class: "detright" },
        rightChip ?? (tested ? h("span", { class: "chip done", style: { fontSize: "10px" } }, ddMon(tested)) : null))
    );
  }

  // Render an area-grouped detector list into `container`, in walk order. Each
  // area heading carries the count and the testers needed for that space.
  function renderZoned(container: HTMLElement, dets: ScheduledDet[], tested: Map<string, string>, logDateFor: (d: ScheduledDet) => string, showSat: boolean) {
    container.replaceChildren();
    let curHead = "";
    let group: ScheduledDet[] = [];
    let headEl: HTMLElement | null = null;
    // The counts for a heading are only known once the group is complete, so the
    // heading element is created first and its chips filled in when it closes.
    const closeGroup = () => {
      if (!headEl || !group.length) return;
      const counts = kindCounts(group);
      const kinds = (Object.keys(KIND_META) as DetKind[]).filter((k) => counts[k] > 0);
      headEl.append(
        h("span", { class: "zh-count" }, String(group.length)),
        h("span", { class: "zh-kinds" },
          ...kinds.map((k) => h("span", { class: `kind k-${k}` }, `${counts[k]} ${KIND_META[k].short}`)))
      );
    };
    for (const d of dets) {
      const head = areaHeading(d);
      if (head !== curHead) {
        closeGroup();
        curHead = head;
        group = [];
        headEl = h("div", { class: "zone-hdr" }, h("span", { class: "zh-name" }, head));
        container.append(headEl);
      }
      group.push(d);
      const right = showSat
        ? h("span", { class: `chip ${tested.has(d.detKey) ? "done" : "pending"}`, style: { fontSize: "10px" } },
            tested.has(d.detKey) ? `✓ ${ddMon(tested.get(d.detKey)!)}` : `→ ${ddMon(plan.satOfDet.get(d.detKey)!)}`)
        : undefined;
      container.append(detRow(d, tested.get(d.detKey), logDateFor(d), right));
    }
    closeGroup();
  }

  // ---- persistent shells re-filled by paint() ----
  const listEl = h("div", {});
  const summaryEl = h("div", {});
  const controlsEl = h("div", {});
  const searchWrap = h("div", {});

  // Free-text filter for the "All" view: matches the tag, the location, or the
  // area name, so "S 51", "51", "boiler" and "e/r floor" all find something.
  let query = "";
  const searchInput = h("input", {
    type: "search", class: "det-search", placeholder: "Search name, number or location…",
    "aria-label": "Search detectors",
  }) as HTMLInputElement;
  const searchCount = h("div", { class: "hint search-count" }, "");
  searchInput.addEventListener("input", () => { query = searchInput.value; paint(); });
  searchWrap.append(h("div", { class: "searchbar" }, searchInput), searchCount);

  /** The searchable fields of a detector, for the shared matcher. */
  function detFields(d: ScheduledDet): SearchField[] {
    return [
      { label: "Tag", text: d.id || "", hidden: true },
      { label: "Location", text: d.location || "" },
      { label: "Area", text: AREA_LABEL[d.area] },
      { label: "Type", text: KIND_META[d.kind].label },
    ];
  }

  /** null when the detector doesn't match; otherwise the fields that did. */
  function matches(d: ScheduledDet) {
    return matchRow(detFields(d), query);
  }

  async function paint() {
    const tested = await testedThisQuarter();
    const sessionDets = plan.bySat.get(sessionSat) ?? [];
    const testedInSession = sessionDets.filter((d) => tested.has(d.detKey)).length;
    const qLabel = `${plan.label} ${plan.year}`;
    // Whole quarter in walk order — the "All" view's source list.
    const allDets = sortByWalk(plan.saturdays.flatMap((s) => plan.bySat.get(s) ?? []));
    // Areas this session covers, in the order they'll be walked.
    const areas = [...new Set(sessionDets.map(areaHeading))];

    // ---- summary card ----
    summaryEl.replaceChildren();
    if (view === "session") {
      const isToday = sessionSat === todayIso;
      summaryEl.append(
        h("div", { class: `fire-hero ${isToday ? "today" : ""}` },
          h("div", { class: "fh-top" },
            h("div", { class: "fh-kicker" }, isToday ? "TODAY · SATURDAY" : "UPCOMING SATURDAY"),
            h("span", { class: `chip ${testedInSession >= sessionDets.length ? "done" : "due"}` },
              `${testedInSession}/${sessionDets.length}`)),
          h("div", { class: "fh-date" }, ddMmmYyyy(sessionSat)),
          h("div", { class: "fh-sub" },
            `${sessionDets.length} detectors · ${areas.length} areas`),
          h("div", { class: "fh-zones" }, areas.join(" → ")),
          // Always shown: the emergency stops must be isolated before the
          // first detector is tested, whichever Saturday this is.
          isolationWarning(),
          // What to carry down for this round.
          h("div", { class: "fh-carry" }, "Take with you"),
          testerSummary(sessionDets),
          // Bosun store / BWTS need access arranged in advance.
          accessWarning(sessionDets))
      );
    } else {
      summaryEl.append(
        h("div", { class: "fire-hero" },
          h("div", { class: "fh-top" },
            h("div", { class: "fh-kicker" }, `${qLabel} · FULL CYCLE`),
            h("span", { class: `chip ${tested.size >= plan.total ? "done" : "due"}` }, `${tested.size}/${plan.total}`)),
          h("div", { class: "fh-sub" }, "Every detector is scheduled once across the quarter's Saturdays. Tap any to mark tested."),
          isolationWarning(),
          h("div", { class: "fh-carry" }, "Full cycle needs"),
          testerSummary(allDets))
      );
    }

    // ---- controls (record-date picker, session view only) ----
    // The round often gets done a day or two after the scheduled Saturday, and
    // it's the actual test date that goes on the record — so the date the taps
    // are logged under is an editable field right above the list.
    controlsEl.replaceChildren();
    if (view === "session") {
      const dateInput = h("input", {
        type: "date", class: "rec-date", value: recordDate, max: todayIso,
        "aria-label": "Date these tests are recorded on",
      }) as HTMLInputElement;
      dateInput.addEventListener("change", () => {
        if (!dateInput.value) { dateInput.value = recordDate; return; }
        recordDate = dateInput.value;
        toast(`Logging on ${ddMmmYyyy(recordDate)}`, 1200);
        paint();
      });
      const fallback = defaultRecordDate(sessionSat);
      const custom = recordDate !== fallback;
      controlsEl.append(
        h("div", { class: "recdate-row" },
          h("span", { class: "rd-lab" }, "Recorded on"),
          dateInput,
          custom
            ? h("button", { class: "rd-reset", type: "button",
                onClick: () => { recordDate = fallback; paint(); } }, "Reset")
            : null),
        h("p", { class: "hint" },
          recordDate !== sessionSat
            ? `Scheduled for ${ddMmmYyyy(sessionSat)} — tests you tap now are logged on ${ddMmmYyyy(recordDate)}.`
            : "Tap each detector as you test it. Did it on another day? Change the date above first.")
      );
    }

    // ---- search (All view only) ----
    searchWrap.style.display = view === "all" ? "" : "none";

    // ---- list ----
    if (view === "session") {
      if (sessionDets.length === 0) {
        listEl.replaceChildren(h("div", { class: "list-empty" }, "No detectors scheduled for this Saturday."));
      } else {
        renderZoned(listEl, sessionDets, tested, () => recordDate, false);
      }
    } else {
      const shown = allDets.filter((d) => matches(d) !== null);
      searchCount.textContent = query.trim()
        ? `${shown.length} of ${allDets.length} detectors match “${query.trim()}”`
        : "";
      if (shown.length === 0) {
        listEl.replaceChildren(h("div", { class: "list-empty" },
          h("div", { class: "big" }, "🔍"),
          h("div", {}, `Nothing matches “${query.trim()}”.`)));
      } else {
        renderZoned(listEl, shown, tested, (d) => plan.satOfDet.get(d.detKey)!, true);
      }
    }

    // Keep the pinned summary, header ring and Saturday panel in step.
    void syncStickyCount();
    void refreshRing();
    if (head.isOpen()) void buildSatPanel();
  }

  const viewSeg = segmented({
    options: ["session", "all"],
    labels: ["This Saturday", `All ${plan.total}`],
    value: view,
    onPick: (v) => { view = v as any; paint(); syncSticky(); },
    compact: true,
  });

  // ---- uniform period header: month chip · Saturday chip · ring ----
  // Same control as every other dated screen. The panel holds this quarter's
  // Saturdays, so the session is picked by tapping a date rather than from a
  // dropdown, and the month wheel jumps between quarters.
  const head = periodHead({
    ym: sessionSat.slice(0, 7),
    open: false,
    onMonth: (ym) => {
      // Jump to the first scheduled Saturday in the chosen month, if any.
      const inMonth = plan.saturdays.filter((s) => s.startsWith(ym));
      if (inMonth.length) { sessionSat = inMonth[0]; recordDate = defaultRecordDate(sessionSat); }
      else toast("No detector round scheduled in that month", 1600);
      head.syncMonth(sessionSat.slice(0, 7));
      syncSatChip(); void buildSatPanel(); paint(); syncSticky();
    },
  });
  const ringWrap = h("div", {});

  const satLab = h("span", { class: "sat-chip-lab" }, "");
  const satChip = h("button", { class: "satchip", type: "button", "aria-label": "Choose Saturday",
    onClick: () => head.toggle() }, h("span", { class: "sat-chip-k" }, "SAT"), satLab);

  function syncSatChip() {
    satLab.textContent = ddMon(sessionSat);
    satChip.classList.toggle("is-today", sessionSat === todayIso);
  }

  /** Panel: every Saturday of the quarter with its tested count. */
  async function buildSatPanel() {
    const tested = await testedThisQuarter();
    head.panel.replaceChildren(
      h("div", { class: "satgrid" },
        ...plan.saturdays.map((s) => {
          const dets = plan.bySat.get(s) ?? [];
          const n = dets.filter((d) => tested.has(d.detKey)).length;
          const done = dets.length > 0 && n >= dets.length;
          return h("button", {
            class: `satcard${s === sessionSat ? " sel" : ""}${done ? " done" : ""}${s > todayIso ? " future" : ""}`,
            type: "button",
            onClick: () => {
              sessionSat = s; recordDate = defaultRecordDate(s);
              syncSatChip(); head.setOpen(false);
              head.syncMonth(s.slice(0, 7));
              void buildSatPanel(); paint(); syncSticky();
            },
          },
            h("span", { class: "st-d" }, String(parseIso(s).getDate()).padStart(2, "0")),
            h("span", { class: "st-m" }, MONTHS_SHORT[parseIso(s).getMonth()].toUpperCase()),
            h("span", { class: "st-n" }, done ? "✓" : `${n}/${dets.length}`));
        })));
  }

  /** Ring over the detectors tested in the selected session. */
  async function refreshRing() {
    const tested = await testedThisQuarter();
    const dets = plan.bySat.get(sessionSat) ?? [];
    const n = dets.filter((d) => tested.has(d.detKey)).length;
    ringWrap.replaceChildren(progressRing(n, dets.length, "left"));
  }

  // ---- sticky session bar ----
  // As the hero card scrolls out of view, the answer to "which Saturday am I on
  // and how far am I" must stay on screen — so a condensed version of it pins
  // under the top bar instead of disappearing with the card.
  const stickyDate = h("span", { class: "fs-date" }, "");
  const stickyMeta = h("span", { class: "fs-meta" }, "");
  const stickyCount = h("span", { class: "chip due fs-count" }, "");
  const stickyBar = h("div", { class: "firesticky" },
    h("div", { class: "fs-body" }, stickyDate, stickyMeta), stickyCount);

  function syncSticky() {
    const dets = view === "session" ? (plan.bySat.get(sessionSat) ?? []) : null;
    if (dets) {
      const areas = [...new Set(dets.map(areaHeading))];
      stickyDate.textContent = ddMon(sessionSat);
      stickyMeta.textContent = `${dets.length} detectors · ${areas.length} areas`;
    } else {
      stickyDate.textContent = `${plan.label} ${plan.year}`;
      stickyMeta.textContent = `${plan.total} detectors · full cycle`;
    }
  }

  /** Fill in the live tested/total count on the sticky bar. */
  async function syncStickyCount() {
    const tested = await testedThisQuarter();
    if (view === "session") {
      const dets = plan.bySat.get(sessionSat) ?? [];
      const n = dets.filter((d) => tested.has(d.detKey)).length;
      stickyCount.textContent = `${n}/${dets.length}`;
      stickyCount.className = `chip ${n >= dets.length && dets.length > 0 ? "done" : "due"} fs-count`;
    } else {
      stickyCount.textContent = `${tested.size}/${plan.total}`;
      stickyCount.className = `chip ${tested.size >= plan.total ? "done" : "due"} fs-count`;
    }
  }

  head.slot.append(satChip);
  head.right.append(ringWrap);

  mount.append(
    topbar("Fire Detector Test", `${plan.label} ${plan.year}`, "/records"),
    screen(
      head.el,
      stickyBar,
      viewSeg,
      h("div", { style: { height: "10px" } }),
      summaryEl,
      controlsEl,
      searchWrap,
      listEl
    )
  );

  // Same gestures as every other dated screen.
  bindHeadGestures(mount.querySelector<HTMLElement>(".screen")!, head);

  // The bar only appears once the hero card it summarises has scrolled away.
  const onScroll = () => stickyBar.classList.toggle("show", window.scrollY > 120);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  const screenEl = mount.querySelector<HTMLElement>(".screen")!;
  new MutationObserver((_m, obs) => {
    if (!screenEl.isConnected) { window.removeEventListener("scroll", onScroll); obs.disconnect(); }
  }).observe(mount, { childList: true });

  syncSatChip();
  syncSticky();
  await buildSatPanel();
  await paint();
  await refreshRing();
  await syncStickyCount();
}

/** How many of the given detectors are already tested this quarter. */
async function testedCount(dets: ScheduledDet[], startYm: string, endYm: string): Promise<number> {
  const keys = new Set(dets.map((d) => d.detKey));
  const tests = await db.fireTest.toArray();
  const done = new Set<string>();
  for (const t of tests) {
    if (!keys.has(t.detKey)) continue;
    const m = t.testedDate.slice(0, 7);
    if (m >= startYm && m <= endYm) done.add(t.detKey);
  }
  return done.size;
}

/**
 * On a Saturday, pop a one-time (per day) reminder of the fire detectors
 * scheduled for today, with a shortcut into the test screen. No-op on other
 * days, once already shown today, or once today's list is fully tested.
 */
export async function maybeShowFireReminder() {
  const today = new Date();
  if (!isSaturday(today)) return;
  const todayIso = isoDate(today);
  if ((await getSetting<string>("fireReminderShown", "")) === todayIso) return;

  const { plan, sessionSat } = currentFireSession(todayIso);
  if (sessionSat !== todayIso) return;
  const dets = plan.bySat.get(todayIso) ?? [];
  if (!dets.length) return;

  const done = await testedCount(dets, plan.startYm, plan.endYm);
  const remaining = dets.length - done;
  if (remaining <= 0) return; // already completed today

  await setSetting("fireReminderShown", todayIso);

  const areas = [...new Set(dets.map(areaHeading))];
  const close = () => {
    back.classList.remove("show");
    setTimeout(() => back.remove(), 240);
  };
  const card = h(
    "div",
    { class: "reminder-card", onClick: (e: Event) => e.stopPropagation() },
    h("div", { class: "rm-ic" }, "🚨"),
    h("div", { class: "rm-title" }, "Fire detector test — today"),
    h("div", { class: "rm-sub" }, `${remaining} of ${dets.length} detectors due · ${areas.length} areas`),
    h("div", { class: "rm-zones" }, areas.join(" → ")),
    testerSummary(dets),
    accessWarning(dets),
    h("div", { class: "rm-actions" },
      h("button", { class: "btn secondary", onClick: () => close() }, "Later"),
      h("button", { class: "btn", onClick: () => { close(); navigate("/rec/fire"); } }, "Open test list"))
  );
  const back = h("div", { class: "reminder-back", onClick: () => close() }, card);
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add("show"));
}
