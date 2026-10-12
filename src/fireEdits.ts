// User corrections to the fire-detector register (tag number, location and
// panel loop / zone / address).
//
// The register itself comes from the seed file, taken from the original
// TEC(A) 37 sheet. When a detector is renumbered or its location needs more
// detail, the change is stored here as an override keyed by `detKey`
// (`sheet:row` — the template row, which never changes), and applied onto
// `masters.fireDetectors` at start-up. Everything that reads the register —
// the schedule, the test screen, search, the export — then sees the corrected
// values, and the test history (also keyed by detKey) is untouched.
//
// Panel loop / zone / address are not on the record sheet; they come from the
// ship's manual (see firePanel.ts). Where the manual can't place a detector the
// user reads the values off the panel and stores them here.
import { masters, detKey } from "./seed";
import { getSetting, setSetting } from "./db";

export interface DetEdit {
  id?: string;
  location?: string;
  loop?: number;
  zone?: number;
  addr?: number;
}

const KEY = "fireDetectorEdits";

/** The register as it came from the original sheet, before any edits. */
const original = new Map<string, { id: string; location: string }>(
  masters.fireDetectors.map((d: any) => [detKey(d), { id: d.id ?? "", location: d.location ?? "" }])
);

let edits: Record<string, DetEdit> = {};

function applyOne(key: string) {
  const d = masters.fireDetectors.find((x: any) => detKey(x) === key);
  const o = original.get(key);
  if (!d || !o) return;
  const e = edits[key] ?? {};
  d.id = e.id !== undefined ? e.id : (o.id || null);
  d.location = e.location !== undefined ? e.location : o.location;
}

/** Load stored edits onto the in-memory register. Call once after seeding. */
export async function loadFireEdits() {
  edits = await getSetting<Record<string, DetEdit>>(KEY, {});
  for (const key of Object.keys(edits)) applyOne(key);
}

export function originalDet(key: string) {
  return original.get(key);
}

/** True when the tag or location differs from the record sheet (goes into the export). */
export function isEdited(key: string): boolean {
  const e = edits[key];
  return !!e && (e.id !== undefined || e.location !== undefined);
}

/** The stored override for a detector, if any. */
export function fireEdit(key: string): DetEdit | undefined {
  return edits[key];
}

/**
 * Save a detector's tag, location and (optionally) panel loop / zone / address.
 * Tag and location equal to the original are not stored, so editing a detector
 * back to how it was clears the override. Panel values are stored only when
 * given; passing `panel: null` clears them.
 */
export async function saveFireEdit(
  key: string,
  next: { id: string; location: string; panel?: { loop?: number; zone?: number; addr?: number } | null }
) {
  const o = original.get(key);
  if (!o) return;
  const prev = edits[key] ?? {};
  const e: DetEdit = {};
  if (next.id.trim() !== o.id.trim()) e.id = next.id.trim();
  if (next.location.trim() !== o.location.trim()) e.location = next.location.trim();
  const panel = next.panel === undefined ? { loop: prev.loop, zone: prev.zone, addr: prev.addr } : next.panel;
  if (panel) {
    if (panel.loop != null) e.loop = panel.loop;
    if (panel.zone != null) e.zone = panel.zone;
    if (panel.addr != null) e.addr = panel.addr;
  }
  if (Object.keys(e).length === 0) delete edits[key];
  else edits[key] = e;
  await setSetting(KEY, edits);
  applyOne(key);
}
