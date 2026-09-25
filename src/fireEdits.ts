// User corrections to the fire-detector register (tag number and location).
//
// The register itself comes from the seed file, taken from the original
// TEC(A) 37 sheet. When a detector is renumbered or its location needs more
// detail, the change is stored here as an override keyed by `detKey`
// (`sheet:row` — the template row, which never changes), and applied onto
// `masters.fireDetectors` at start-up. Everything that reads the register —
// the schedule, the test screen, search, the export — then sees the corrected
// values, and the test history (also keyed by detKey) is untouched.
import { masters, detKey } from "./seed";
import { getSetting, setSetting } from "./db";

export interface DetEdit {
  id?: string;
  location?: string;
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

export function isEdited(key: string): boolean {
  return !!edits[key];
}

/**
 * Save a detector's tag and location. Values equal to the original are not
 * stored, so editing a detector back to how it was clears the override.
 */
export async function saveFireEdit(key: string, next: { id: string; location: string }) {
  const o = original.get(key);
  if (!o) return;
  const e: DetEdit = {};
  if (next.id.trim() !== o.id.trim()) e.id = next.id.trim();
  if (next.location.trim() !== o.location.trim()) e.location = next.location.trim();
  if (e.id === undefined && e.location === undefined) delete edits[key];
  else edits[key] = e;
  await setSetting(KEY, edits);
  applyOne(key);
}
