// Backup: one JSON dump of every Dexie table.
//
// The same dump powers both the manual "Backup all data" button in Settings and
// the automatic once-a-day backup that runs on launch. Auto-backup exists because
// the records only live in this phone's IndexedDB — clearing site data or losing
// the handset loses the month with it, and nobody remembers to press a button.
import { db, getSetting, setSetting } from "./db";
import { toast } from "./ui";

/** Day of the last successful auto-backup, as YYYY-MM-DD. */
const LAST_AUTO_KEY = "autoBackupDate";

export async function buildBackupBlob(): Promise<Blob> {
  const dump: Record<string, any> = {};
  for (const table of db.tables) dump[table.name] = await table.toArray();
  return new Blob([JSON.stringify(dump)], { type: "application/json" });
}

export function backupFilename(d = new Date()): string {
  return `monthend-backup-${localDay(d)}.json`;
}

/** Local (not UTC) YYYY-MM-DD — the ship's day is what the user counts by. */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Manual backup (Settings button). Always runs, and counts as today's backup. */
export async function exportBackup() {
  const blob = await buildBackupBlob();
  downloadBlob(blob, backupFilename());
  await setSetting(LAST_AUTO_KEY, localDay(new Date()));
  toast("Backup downloaded");
}

/** The day the last backup (auto or manual) was written, or "" if never. */
export async function lastBackupDay(): Promise<string> {
  return await getSetting(LAST_AUTO_KEY, "");
}

/**
 * Run the daily backup if today's hasn't happened yet.
 *
 * Called once on boot. A download started before the first paint is often
 * dropped by the browser, so the caller schedules this after the app is up.
 */
export async function maybeAutoBackup(): Promise<void> {
  const today = localDay(new Date());
  if ((await lastBackupDay()) === today) return;
  // A backup of an empty database would overwrite nothing useful and would just
  // train the user to ignore the notification.
  const rows = await db.iccpDaily.count();
  if (rows === 0) return;
  try {
    const blob = await buildBackupBlob();
    downloadBlob(blob, backupFilename());
    // Only mark the day done once the download actually fired, so a failure
    // retries on the next launch instead of silently skipping the day.
    await setSetting(LAST_AUTO_KEY, today);
    toast("Daily backup saved to your downloads", 2600);
  } catch {
    /* out of space / download blocked — try again next launch */
  }
}
