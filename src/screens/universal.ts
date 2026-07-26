// Universal search — one box that looks across every record in the app.
//
// Reached from the magnifier beside the theme toggle, so wherever the user is
// they can type "6314", "galley", "12 KW" or "GMDSS" and jump straight to the
// thing they meant, instead of having to remember which of nine screens holds
// it. Results are grouped by record and each row navigates to its screen.
import { h, navigate } from "../ui";
import { db } from "../db";
import { masters } from "../seed";
import { currentFireSession, AREA_LABEL, KIND_META } from "../fireSchedule";
import { matchRow, highlight, hitChips, type SearchField, type FieldHit } from "../search";
import { isoDate, ddMmmYyyy } from "../util";

interface Result {
  /** Group heading, e.g. "Motor Overhaul & Megger". */
  group: string;
  icon: string;
  title: string;
  sub?: string;
  hits: FieldHit[];
  route: string;
  /** Units per chip label, so a qualified term highlights the right field. */
  units?: Record<string, string[]>;
}

/** Everything searchable, gathered once per query. */
async function collect(q: string): Promise<Result[]> {
  const out: Result[] = [];
  const push = (
    group: string, icon: string, route: string,
    fields: SearchField[], title: string, sub: string | undefined,
    units?: Record<string, string[]>
  ) => {
    const hits = matchRow(fields, q);
    if (hits === null) return;
    out.push({ group, icon, title, sub, hits, route, units });
  };

  const KW = { Rating: ["kw"] };

  // --- Overhaul register (bearings, ratings, megger, dates) ---
  for (const r of await db.overhaul.toArray()) {
    const f: SearchField[] = [{ label: "Motor", text: r.motor || "", hidden: true }];
    if (r.kw != null) f.push({ label: "Rating", text: `${r.kw} KW`, units: ["kw"] });
    if (r.ndeBearing) f.push({ label: "NDE brg", text: String(r.ndeBearing) });
    if (r.deBearing) f.push({ label: "DE brg", text: String(r.deBearing) });
    if (r.lastOverhaul) f.push({ label: "Overhauled", text: ddMmmYyyy(String(r.lastOverhaul)) });
    if (r.megger != null) f.push({ label: "Megger", text: `${r.megger} MΩ` });
    if (r.remarks) f.push({ label: "Remarks", text: String(r.remarks) });
    push("Overhaul & Megger", "🔧", "/rec/overhaul", f, `${r.sn}. ${r.motor}`, undefined, KW);
  }

  // --- Motors on the temperature record ---
  for (const mo of masters.motorTempMotors) {
    const f: SearchField[] = [{ label: "Motor", text: mo.name || "", hidden: true }];
    if (mo.rating) f.push({ label: "Rating", text: `${mo.rating} KW`, units: ["kw"] });
    if (mo.mounting) f.push({ label: "Mounting", text: String(mo.mounting) });
    push("Motor Temp · TEC(A) 12", "🌡️", "/rec/motortemp", f, mo.name, undefined, KW);
  }

  // --- Motors on the vibration record ---
  for (const mo of masters.vibrationMotors) {
    const f: SearchField[] = [{ label: "Motor", text: mo.name || "", hidden: true }];
    if (mo.rating) f.push({ label: "Rating", text: `${mo.rating} KW`, units: ["kw"] });
    push("Motor Vibration · TEC(A) 15", "📳", "/rec/vibration", f, mo.name, undefined, KW);
  }

  // --- Condition monitoring motors ---
  for (const mo of masters.cmTempMotors) {
    push("Condition Monitoring", "📊", "/rec/conditionmon",
      [{ label: "Motor", text: mo.name || "", hidden: true }], mo.name, "Temperature");
  }

  // --- Busbar panels ---
  for (const p of masters.busbarPanels) {
    const f: SearchField[] = [{ label: "Panel", text: p.name || "", hidden: true }];
    if (p.load != null) f.push({ label: "Load", text: `${p.load} KW`, units: ["kw"] });
    push("Busbar Temp · TEC(A) 16", "⚡", "/rec/busbar", f, p.name, undefined, { Load: ["kw"] });
  }

  // --- Battery banks ---
  for (const b of masters.batteryBanks as any[]) {
    push("Battery Log · TEC(A) 17", "🔋", "/rec/battery",
      [{ label: "Bank", text: b.desc || b.id, hidden: true }], b.desc || b.id, "Weekly · Saturday");
  }

  // --- Freon systems ---
  for (const s of masters.freonSystems) {
    const f: SearchField[] = [{ label: "System", text: s.name || "", hidden: true }];
    if (s.capacity != null) f.push({ label: "Capacity", text: `${s.capacity} kg`, units: ["kg"] });
    push("Freon · TEC(A) 33", "❄️", "/rec/freon", f, s.name, undefined, { Capacity: ["kg"] });
  }

  // --- Fire detectors (this quarter's plan covers every unit) ---
  const plan = currentFireSession(isoDate(new Date())).plan;
  for (const sat of plan.saturdays) {
    for (const d of plan.bySat.get(sat) ?? []) {
      push("Fire Detectors · TEC(A) 37", "🚨", "/rec/fire", [
        { label: "Tag", text: d.id || "", hidden: true },
        { label: "Location", text: d.location || "" },
        { label: "Area", text: AREA_LABEL[d.area] },
        { label: "Type", text: KIND_META[d.kind].label },
      ], d.id || "—", `Scheduled ${ddMmmYyyy(sat)}`);
    }
  }

  return out;
}

export async function renderUniversalSearch(_p: Record<string, string>, mount: HTMLElement) {
  let query = "";
  const listEl = h("div", {});
  const countEl = h("div", { class: "hint search-count" }, "");

  const input = h("input", {
    type: "search", placeholder: "Motor, detector, bearing no., 12 KW…",
    "aria-label": "Search everything", autocomplete: "off",
  }) as HTMLInputElement;

  // Debounced by a frame's worth of typing: the whole corpus is small enough to
  // scan directly, but this keeps keystrokes smooth on a phone.
  let timer: any;
  input.addEventListener("input", () => {
    query = input.value;
    clearTimeout(timer);
    timer = setTimeout(run, 140);
  });

  async function run() {
    const q = query.trim();
    listEl.replaceChildren();
    if (!q) {
      countEl.textContent = "";
      listEl.append(h("div", { class: "list-empty" },
        h("div", { class: "big" }, "🔎"),
        h("div", {}, "Search across every record — motors, detectors, panels, banks."),
        h("div", { class: "hint", style: { marginTop: "8px" } },
          "Tip: add a unit to search a rating exactly, e.g. “12 KW”.")));
      return;
    }

    const results = await collect(q);
    countEl.textContent = `${results.length} match${results.length === 1 ? "" : "es"} for “${q}”`;
    if (!results.length) {
      listEl.append(h("div", { class: "list-empty" },
        h("div", { class: "big" }, "🔍"), h("div", {}, `Nothing matches “${q}”.`)));
      return;
    }

    // Group by record so the user can see which file a hit belongs to.
    let curGroup = "";
    // Cap the list so a one-letter query can't render thousands of rows.
    for (const r of results.slice(0, 80)) {
      if (r.group !== curGroup) {
        curGroup = r.group;
        listEl.append(h("div", { class: "zone-hdr" }, h("span", { class: "zh-name" }, `${r.icon} ${r.group}`)));
      }
      listEl.append(
        h("div", { class: "card tap us-row", onClick: () => navigate(r.route) },
          h("div", { class: "us-title" }, highlight(r.title, q)),
          r.sub ? h("div", { class: "us-sub" }, r.sub) : null,
          hitChips(r.hits, q, r.units))
      );
    }
    if (results.length > 80) {
      listEl.append(h("p", { class: "hint", style: { textAlign: "center" } },
        `…and ${results.length - 80} more. Add another word to narrow it down.`));
    }
  }

  mount.append(
    h("div", { class: "topbar" },
      h("button", { class: "back", onClick: () => history.back() }, "‹"),
      h("h1", {}, "Search")),
    screenWrap(
      h("div", { class: "searchbar", style: { marginBottom: "6px" } }, input),
      countEl,
      listEl
    )
  );
  input.focus();
  await run();
}

/** Local screen wrapper (avoids importing `screen`, whose name collides). */
function screenWrap(...nodes: Node[]): HTMLElement {
  return h("div", { class: "screen" }, ...nodes);
}
