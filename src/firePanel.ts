// Where each detector sits on the fire-alarm panel: loop, zone and address.
//
// Source: the ship's manual — Consilium "Fire Alarm System CS4000/3L,
// Address-list for Fire Detection System" (builder's list, from when the ship
// was built). When a detector goes off, the panel shows its loop / zone /
// address and the LCD text below, so the test list shows the same thing.
//
// The TEC(A) 37 record sheet groups detectors under "Zone" header rows in the
// same order as the manual's zones 1–15 (zone 16 on the sheet is the BWTS room,
// a later retrofit). The number in a detector's tag is its panel address on that
// zone's loop (S 14 → address 14). Where the sheet and the manual disagree, or a
// detector was added after the ship was built, the detector is flagged so the
// user checks it on the panel — nothing here is guessed silently.
import type { DetEdit } from "./fireEdits";

/** Loop per manual zone: zones 1–8 on loop 11, 9–12 on loop 12, 13–15 on loop 13. */
export function loopOfZone(zone: number): number | null {
  if (zone >= 1 && zone <= 8) return 11;
  if (zone >= 9 && zone <= 12) return 12;
  if (zone >= 13 && zone <= 15) return 13;
  return null;
}

// Builder's list, as printed: [zone, first address, LCD texts in address order].
// Each zone's addresses are consecutive from `first`.
const BUILDER: [number, number, string[]][] = [
  [1, 1, ["BRIDGE CONTROL CONSOLE", "BRIDGE CONTROL CONSOLE"]],
  [2, 11, [
    "C-DECK PASSAGE ST'BD", "C-DECK PASSAGE ST'BD", "C-DECK PASSAGE ST'BD",
    "C-DECK C/OFF.'S BED RM", "C-DECK C/OFF.'S DAY RM", "C-DECK CAPTAIN'S DAY RM",
    "C-DECK CAPTAIN'S BED RM", "C-DECK JUNIOR(3)", "C-DECK PILOT", "C-DECK PASSAGE PORT",
    "C-DECK JUNIOR(2)", "C-DECK C/ENG.'S BED RM", "C-DECK C/ENG.'S DAY RM",
    "C-DECK 1ST ENG.'S DAY RM", "C-DECK 1ST ENG.'S BED RM", "C-DECK PASSAGE PORT",
    "C-DECK PASSAGE PORT", "C-DECK JUNIOR(1)", "C-DECK JUNIOR(4)", "C-DECK DUCT & C/TRUNK",
  ]],
  [3, 41, [
    "B-DECK PASSAGE ST'BD", "B-DECK PASSAGE ST'BD", "B-DECK PASSAGE ST'BD",
    "B-DECK CREW(12)", "B-DECK CREW(11)", "B-DECK PETTY(3)", "B-DECK CREW(10)",
    "B-DECK CREW(9)", "B-DECK CREW(8)", "B-DECK PASSAGE PORT", "B-DECK CREW(7)",
    "B-DECK CREW(6)", "B-DECK PETTY(2)", "B-DECK CREW(5)", "B-DECK CREW(4)",
    "B-DECK PASSAGE PORT", "B-DECK PASSAGE PORT", "B-DECK PETTY(1)", "B-DECK DUCT & C/TRUNK",
  ]],
  [4, 71, [
    "A-DECK PASSAGE CENTER", "A-DECK PASSAGE ST'BD", "A-DECK OFFICER'S MESS RM",
    "A-DECK EM'CY GEN. RM", "A-DECK EM'CY GEN. RM", "A-DECK PASSAGE ST'BD",
    "A-DECK OFFICER'S SMOKING RM", "A-DECK DECK OFFICE", "A-DECK CARGO CONT. RM",
    "A-DECK ENGINE OFFICE", "A-DECK CREW'S SMOKING RM", "A-DECK PASSAGE PORT",
    "A-DECK PASSAGE PORT", "A-DECK CREW'S MESS RM", "A-DECK GELLEY", "A-DECK GELLEY",
    "A-DECK DUCT & C/TRUNK",
  ]],
  [5, 91, [
    "UPP-DECK AIR COND. RM", "UPP-DECK GYMNASIUM", "UPP-DECK PASSAGE ST'BD",
    "UPP-DECK CREW(3)", "UPP-DECK PASSAGE ST'BD", "UPP-DECK PASSAGE CENTER",
    "UPP-DECK FIRE CONT. STATION", "UPP-DECK PASSAGE PORT", "UPP-DECK CREW(2)",
    "UPP-DECK CREW(1)", "UPP-DECK PASSAGE PORT", "UPP-DECK HOSPITAL", "UPP-DECK LOBBY",
    "UPP-DECK S/G/R ENTRANCE",
  ]],
  [6, 111, ["UPP-DECK S/G/R ENTRANCE", "S/G/R PORT", "S/G/R PORT", "S/G/R ST'BD", "S/G/R ST'BD", "S/G/R"]],
  [7, 121, ["BOSUN STORE ST'BD", "BOSUN STORE ST'BD", "BOSUN STORE PORT", "BOSUN STORE CENTER", "BOSUN STORE PORT"]],
  [8, 131, ["STAIRWAY A-DECK", "STAIRWAY B-DECK", "STAIRWAY NAV. DECK"]],
  [9, 1, [
    "E/R 1ST-DECK ST'BD", "E/R 1ST-DECK E/R STORE", "E/R 1ST-DECK WORKSHOP",
    "E/R 1ST-DECK WORKSHOP", "E/R 1ST-DECK WORKSHOP", "E/R 1ST-DECK ST'BD",
    "E/R 1ST-DECK E/R ENTRANCE (UPP DK)", "E/R 1ST-DECK E/R ENTRANCE (UPP DK)",
    "E/R 1ST-DECK CENTER", "E/R 1ST-DECK PORT", "E/R 1ST-DECK PORT",
    "E/R 1ST-DECK ENGINE CONTROL CONSOLE", "E/R 1ST-DECK ENGINE CONTROL ROOM",
    "E/R 1ST-DECK ELEC. WORKSHOP", "E/R 1ST-DECK ENGINE CONTROL ROOM",
    "E/R 1ST-DECK ENGINE CONTROL ROOM", "E/R 1ST-DECK PORT", "E/R 1ST-DECK",
  ]],
  [10, 21, [
    "E/R CASING UPP-DK", "E/R CASING A-DK", "E/R CASING B-DK", "E/R CASING B-DK",
    "E/R CASING C-DK", "E/R CASING UPP-DK", "E/R CASING UPP-DK",
  ]],
  [11, 31, [
    "E/R 2ND-DECK PORT", "E/R 2ND-DECK ST'BD", "E/R 2ND-DECK ST'BD", "E/R 2ND-DECK ST'BD",
    "E/R 2ND-DECK ST'BD", "E/R 2ND-DECK HYD.POWER PACK RM", "E/R 2ND-DECK PORT",
    "E/R 2ND-DECK PURIFIER RM", "E/R 2ND-DECK PORT", "E/R 2ND-DECK PORT",
  ]],
  [12, 51, [
    "E/R FLOOR PORT", "E/R FLOOR PORT", "E/R FLOOR PORT", "E/R FLOOR CENTER",
    "E/R FLOOR ST'BD", "E/R FLOOR ST'BD", "E/R FLOOR ST'BD", "E/R FLOOR CENTER",
    "E/R FLOOR CENTER", "E/R FLOOR PORT",
  ]],
  [13, 1, ["CASING A-DECK I.G.G", "CASING A-DECK I.G.G", "CASING UPP-DECK I.G.G"]],
  [14, 11, [
    "E/R 1ST-DK AUX. BOILER", "E/R 1ST-DK AUX. BOILER", "E/R 1ST-DK AUX. BOILER",
    "E/R 1ST-DK INCINERATOR", "E/R 1ST-DK INCINERATOR", "E/R 1ST-DK INCINERATOR",
    "E/R 1ST-DK MAIN ENGINE", "E/R 1ST-DK MAIN ENGINE", "E/R 1ST-DK MAIN ENGINE",
    "E/R 1ST-DK MAIN ENGINE",
  ]],
  [15, 31, [
    "E/R 2ND-DK NO.1/2 GEN. ENGINE", "E/R 2ND-DK NO.1/2 GEN. ENGINE", "E/R 2ND-DK NO.1/2 GEN. ENGINE",
    "E/R 2ND-DK NO.3 GEN. ENGINE", "E/R 2ND-DK NO.3 GEN. ENGINE", "E/R 2ND-DK NO.3 GEN. ENGINE",
    "E/R 2ND-DK PURIFIER RM", "E/R 2ND-DK PURIFIER RM",
  ]],
];

/** loop:address → { zone, LCD text } */
const BY_ADDR = new Map<string, { zone: number; text: string }>();
for (const [zone, first, texts] of BUILDER) {
  const loop = loopOfZone(zone)!;
  texts.forEach((text, i) => BY_ADDR.set(`${loop}:${first + i}`, { zone, text }));
}

/**
 * Detectors where the record sheet's tag is not the panel address, or that are
 * not in the builder's list at all. Keyed by detKey (`sheet:row`).
 *  - `addr` set: the address the manual gives for that spot (tag is a typo).
 *  - `addr: null`: the address can't be read off the manual — check the panel.
 */
const SHEET_VS_MANUAL: Record<string, { addr?: number | null; zone?: number | null; note: string }> = {
  "main:37": { addr: 30, note: "Tag says 130, but the manual has the C-deck duct & C/trunk at address 30." },
  "main:98": { addr: 115, note: "The sheet repeats S 114; the manual has two S/G/R ST'BD detectors, 114 and 115 — this is likely 115." },
  "main:99": { addr: 116, note: "Tag says 125 (a bosun store address); the manual has the S/G/R unit at 116." },
  "main:105": { addr: 125, note: "Tag says 25; the manual lists 125 as BOSUN STORE PORT, the sheet says STBD." },
  "main:145": { addr: null, zone: null, note: "Not in the builder's list. The manual has \"E/R 2ND-DK PURIFIER RM\" on loop 13 · zone 15 · addresses 37/38 — likely this one." },
  "main:146": { addr: null, zone: null, note: "Not in the builder's list. The manual has \"E/R 2ND-DK PURIFIER RM\" on loop 13 · zone 15 · addresses 37/38 — likely this one." },
  "main:23": { note: "The sheet says Captain's bedroom; the manual has address 16 as Captain's DAY room (17 = bed room)." },
  "main:24": { note: "The sheet says Captain's day room; the manual has address 17 as Captain's BED room (16 = day room)." },
  "main:31": { note: "The sheet says 1st Eng. bed room; the manual has address 24 as 1st Eng. DAY room (25 = bed room)." },
  "main:32": { note: "The sheet says 1st Eng. day room; the manual has address 25 as 1st Eng. BED room (24 = day room)." },
  "main:51": { note: "The sheet says Crew (5) — the manual has address 52 as CREW(6); Crew (5) is address 54." },
  "main:164": { note: "The sheet says casing A-deck; the manual has address 3 as CASING UPP-DECK I.G.G." },
  "main:179": { note: "The manual has address 33 as NO.1/2 GEN. ENGINE and 34–36 as NO.3 GEN. ENGINE, not D/G 3 as on the sheet." },
  "main:182": { addr: null, zone: null, note: "BWTS room was fitted after the ship was built — not in the builder's list." },
  "main:183": { addr: null, zone: null, note: "BWTS room was fitted after the ship was built — not in the builder's list." },
};

export interface PanelInfo {
  loop: number | null;
  zone: number | null;
  addr: number | null;
  /** Text the panel's LCD shows for this address (builder's list). */
  text: string | null;
  /** True when the user should confirm it on the panel. */
  verify: boolean;
  /** Why it needs checking, or what differs from the record sheet. */
  note: string | null;
  /** True when the user has entered / confirmed these values themselves. */
  confirmed: boolean;
  /** Battery-operated detector — not wired to the panel at all. */
  standalone: boolean;
}

/** Number at the end of a tag: "S 14" → 14, "SCI 2" → 2, "T.C3" → 3, "MCP" → null. */
function tagNumber(id: string | null | undefined): number | null {
  const m = (id ?? "").match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

/**
 * Panel loop / zone / address for a detector.
 * `d` is the register entry (with any user edit already applied to id/location);
 * `edit` carries panel values the user confirmed on board, which win outright.
 */
export function panelInfo(d: { sheet: string; row: number; zone: number; id?: string | null }, edit?: DetEdit): PanelInfo {
  const key = `${d.sheet}:${d.row}`;
  if (d.sheet === "battery") {
    return { loop: null, zone: null, addr: null, text: null, verify: false, note: null, confirmed: false, standalone: true };
  }
  if (edit && (edit.loop != null || edit.zone != null || edit.addr != null)) {
    const text = edit.loop != null && edit.addr != null ? BY_ADDR.get(`${edit.loop}:${edit.addr}`)?.text ?? null : null;
    return { loop: edit.loop ?? null, zone: edit.zone ?? null, addr: edit.addr ?? null, text,
      verify: false, note: null, confirmed: true, standalone: false };
  }

  const fix = SHEET_VS_MANUAL[key];
  const zone = fix && "zone" in fix ? fix.zone ?? null : (d.zone <= 15 ? d.zone : null);
  const loop = zone != null ? loopOfZone(zone) : null;
  const addr = fix && "addr" in fix ? fix.addr ?? null : tagNumber(d.id);

  if (loop == null || addr == null) {
    return { loop, zone, addr, text: null, verify: true,
      note: fix?.note ?? "Address not readable from the tag — check it on the panel.", confirmed: false, standalone: false };
  }
  const hit = BY_ADDR.get(`${loop}:${addr}`);
  if (!hit || hit.zone !== zone) {
    return { loop, zone, addr, text: null, verify: true,
      note: fix?.note ?? "Not in the builder's list — added after the ship was built. Confirm loop / zone / address on the panel.",
      confirmed: false, standalone: false };
  }
  return { loop, zone, addr, text: hit.text, verify: !!fix, note: fix?.note ?? null,
    confirmed: false, standalone: false };
}

/** "Loop 11 · Zone 2 · Addr 14" — unknown parts shown as "?". */
export function panelLabel(p: PanelInfo): string {
  if (p.standalone) return "Battery-operated · not on the panel";
  const v = (n: number | null) => (n == null ? "?" : String(n));
  return `Loop ${v(p.loop)} · Zone ${v(p.zone)} · Addr ${v(p.addr)}`;
}
