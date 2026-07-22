import { h, topbar, screen, toast, segmented, navigate } from "../ui";
import { db, getSetting, setSetting } from "../db";
import { isoDate, parseIso, isSaturday, MONTHS_SHORT, ddMmmYyyy } from "../util";
import {
  currentFireSession,
  zoneLabels,
  type QuarterPlan,
  type ScheduledDet,
} from "../fireSchedule";

/** "04 JUL" */
function ddMon(iso: string): string {
  const d = parseIso(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS_SHORT[d.getMonth()].toUpperCase()}`;
}
function zoneHeading(d: ScheduledDet): string {
  return d.battery ? "Battery-operated" : `Zone ${d.zone}`;
}

export async function renderFire(_p: Record<string, string>, mount: HTMLElement) {
  const today = new Date();
  const todayIso = isoDate(today);
  const session = currentFireSession(todayIso);
  const plan: QuarterPlan = session.plan;

  let view: "session" | "all" = "session";
  let sessionSat = session.sessionSat;
  let recordDate = sessionSat; // date the taps are logged on (editable — e.g. Sunday)

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

  // A single detector row (checkbox + name + location, optional right-hand chip).
  function detRow(d: ScheduledDet, tested: string | undefined, logDate: string, rightChip?: HTMLElement | null) {
    return h(
      "div",
      { class: `det ${tested ? "tested" : ""}`, onClick: () => toggle(d, logDate) },
      h("div", { class: "cb" }, tested ? "✓" : ""),
      h("div", { class: "info" },
        h("div", { class: "id" }, d.id),
        h("div", { class: "loc" }, d.location || "—")),
      rightChip ?? (tested ? h("span", { class: "chip done", style: { fontSize: "10px" } }, ddMon(tested)) : null)
    );
  }

  // Render a zone-grouped detector list into `container`.
  function renderZoned(container: HTMLElement, dets: ScheduledDet[], tested: Map<string, string>, logDateFor: (d: ScheduledDet) => string, showSat: boolean) {
    container.replaceChildren();
    let curHead = "";
    for (const d of dets) {
      const head = zoneHeading(d);
      if (head !== curHead) {
        curHead = head;
        container.append(h("div", { class: "zone-hdr" }, head));
      }
      const right = showSat
        ? h("span", { class: `chip ${tested.has(d.detKey) ? "done" : "pending"}`, style: { fontSize: "10px" } },
            tested.has(d.detKey) ? `✓ ${ddMon(tested.get(d.detKey)!)}` : `→ ${ddMon(plan.satOfDet.get(d.detKey)!)}`)
        : undefined;
      container.append(detRow(d, tested.get(d.detKey), logDateFor(d), right));
    }
  }

  // ---- persistent shells re-filled by paint() ----
  const listEl = h("div", {});
  const summaryEl = h("div", {});
  const controlsEl = h("div", {});

  async function paint() {
    const tested = await testedThisQuarter();
    const sessionDets = plan.bySat.get(sessionSat) ?? [];
    const testedInSession = sessionDets.filter((d) => tested.has(d.detKey)).length;
    const qLabel = `${plan.label} ${plan.year}`;

    // ---- summary card ----
    summaryEl.replaceChildren();
    if (view === "session") {
      const zl = zoneLabels(sessionDets);
      const isToday = sessionSat === todayIso;
      summaryEl.append(
        h("div", { class: `fire-hero ${isToday ? "today" : ""}` },
          h("div", { class: "fh-top" },
            h("div", { class: "fh-kicker" }, isToday ? "TODAY · SATURDAY" : "UPCOMING SATURDAY"),
            h("span", { class: `chip ${testedInSession >= sessionDets.length ? "done" : "due"}` },
              `${testedInSession}/${sessionDets.length}`)),
          h("div", { class: "fh-date" }, ddMmmYyyy(sessionSat)),
          h("div", { class: "fh-sub" },
            `${sessionDets.length} detectors · ${zl.length} zones`),
          h("div", { class: "fh-zones" }, `Zones: ${zl.join(", ")}`))
      );
    } else {
      summaryEl.append(
        h("div", { class: "fire-hero" },
          h("div", { class: "fh-top" },
            h("div", { class: "fh-kicker" }, `${qLabel} · FULL CYCLE`),
            h("span", { class: `chip ${tested.size >= plan.total ? "done" : "due"}` }, `${tested.size}/${plan.total}`)),
          h("div", { class: "fh-sub" }, "Every detector is scheduled once across the quarter's Saturdays. Tap any to mark tested."))
      );
    }

    // ---- controls (session picker + record-date, session view only) ----
    controlsEl.replaceChildren();
    if (view === "session") {
      const picker = h("select", { class: "sat-select" });
      for (const s of plan.saturdays) {
        const cnt = (plan.bySat.get(s) ?? []).length;
        const doneCnt = (plan.bySat.get(s) ?? []).filter((d) => tested.has(d.detKey)).length;
        const mark = s === todayIso ? " · today" : "";
        picker.append(h("option", { value: s, selected: s === sessionSat },
          `${ddMon(s)}${mark} — ${doneCnt}/${cnt}${doneCnt >= cnt ? " ✓" : ""}`));
      }
      picker.value = sessionSat;
      picker.addEventListener("change", () => { sessionSat = picker.value; recordDate = sessionSat; paint(); });

      const dateInput = h("input", { type: "date", value: recordDate, class: "rec-date" }) as HTMLInputElement;
      dateInput.addEventListener("change", () => { if (dateInput.value) { recordDate = dateInput.value; paint(); } });
      const custom = recordDate !== sessionSat;

      controlsEl.append(
        h("div", { class: "fire-controls" },
          h("label", { class: "fc-field" }, h("span", { class: "fc-lab" }, "Session"), picker),
          h("label", { class: "fc-field" },
            h("span", { class: "fc-lab" }, "Log tests on"), dateInput)),
        h("p", { class: "hint" },
          custom
            ? `Custom date — taps below are recorded on ${ddMmmYyyy(recordDate)}, not the scheduled Saturday.`
            : "Tap each detector as you test it. Did it on another day? Change “Log tests on”.")
      );
    }

    // ---- list ----
    if (view === "session") {
      if (sessionDets.length === 0) {
        listEl.replaceChildren(h("div", { class: "list-empty" }, "No detectors scheduled for this Saturday."));
      } else {
        renderZoned(listEl, sessionDets, tested, () => recordDate, false);
      }
    } else {
      const all = plan.saturdays.flatMap((s) => plan.bySat.get(s) ?? []);
      all.sort((a, b) => Number(a.battery) - Number(b.battery) || a.zone - b.zone || a.row - b.row);
      renderZoned(listEl, all, tested, (d) => plan.satOfDet.get(d.detKey)!, true);
    }
  }

  const viewSeg = segmented({
    options: ["session", "all"],
    labels: ["This Saturday", `All ${plan.total}`],
    value: view,
    onPick: (v) => { view = v as any; paint(); },
    compact: true,
  });

  mount.append(
    topbar("Fire Detector Test", `${plan.label} ${plan.year}`, "/records"),
    screen(
      viewSeg,
      h("div", { style: { height: "10px" } }),
      summaryEl,
      controlsEl,
      listEl
    )
  );
  await paint();
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

  const zl = zoneLabels(dets);
  const close = () => {
    back.classList.remove("show");
    setTimeout(() => back.remove(), 240);
  };
  const card = h(
    "div",
    { class: "reminder-card", onClick: (e: Event) => e.stopPropagation() },
    h("div", { class: "rm-ic" }, "🚨"),
    h("div", { class: "rm-title" }, "Fire detector test — today"),
    h("div", { class: "rm-sub" }, `${remaining} of ${dets.length} detectors due · ${zl.length} zones`),
    h("div", { class: "rm-zones" }, `Zones ${zl.join(", ")}`),
    h("div", { class: "rm-actions" },
      h("button", { class: "btn secondary", onClick: () => close() }, "Later"),
      h("button", { class: "btn", onClick: () => { close(); navigate("/rec/fire"); } }, "Open test list"))
  );
  const back = h("div", { class: "reminder-back", onClick: () => close() }, card);
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add("show"));
}
