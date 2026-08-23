// The nightly backup: one dated set holding both halves of the state.
//
// design.md § Operations commits to a nightly `.backup` into `~/backups` with
// 14-day retention, and is explicit that the upload folder is state too — *"a
// database backup that does not include them restores Lessons whose images are
// gone."* So a set is the database and the images together, or it is not a set.
//
// Two things here are not negotiable:
//
//   1. **The database is copied through better-sqlite3's `.backup()`.** The
//      database runs in WAL mode and the service is serving while this runs;
//      copying the file out from under an active WAL is how a backup ends up
//      subtly unrestorable, with the last hours of writes sitting in a `-wal`
//      that was never copied. `.backup()` is an online backup and takes the
//      whole thing, consistently, while it is being written to.
//   2. **A set is named only once it is whole.** Everything is written into
//      `<name>.partial` and renamed at the end, so a run interrupted halfway
//      through — a reboot, a full disk — leaves something that cannot be
//      mistaken for a good set by whoever is restoring at three in the morning.
//
// Node rather than bash, matching `../db/migrate.ts` and `../db/seed.ts`: it is
// what gets access to the `.backup()` API at all, and it is what makes the
// naming and the retention rules testable the way the rest of this repo is.

import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config } from '../config.ts';
import { openDatabase } from '../db/client.ts';

// --- The rules ---------------------------------------------------------------

// `2026-08-22T031500Z`. Fixed width and UTC, so the names sort as text in the
// order they were taken and stay unambiguous across a clock change — `ls` is the
// index, and a restore procedure should not have to parse anything to find the
// newest set.
const SET_NAME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z(\.partial)?$/;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function backupSetName(at: Date): string {
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`
    + `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`;
}

/** When a set was taken, read back out of its name, or null if the name is not ours. */
function takenAt(entry: string): Date | null {
  const match = SET_NAME.exec(entry);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second),
  ));
}

/**
 * Which entries of the destination directory to delete.
 *
 * Pure, over names — the destination is a directory in somebody's home, and a
 * job that deletes what it does not recognise is how a backup destroys the thing
 * it was pointed at by mistake. Anything that is not a set name this module
 * wrote is left exactly where it is, including the weekly copy someone dropped
 * beside the sets.
 *
 * An abandoned `.partial` is pruned by its own date like any other set: it is
 * ours, it is dated, and nothing else will ever clean it up.
 */
export function setsToPrune(
  entries: readonly string[],
  now: Date,
  retentionDays: number,
): string[] {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => {
    const taken = takenAt(entry);
    return taken !== null && taken.getTime() < cutoff;
  });
}

// --- The run -----------------------------------------------------------------

export type BackupRequest = {
  databasePath: string;
  uploadDir: string;
  /** Where sets are written. Everything inside it that is not a set is left alone. */
  destination: string;
  retentionDays: number;
  now?: Date;
};

export type BackupReport = {
  /** The full path of the finished set. */
  path: string;
  databaseBytes: number;
  uploadCount: number;
  uploadBytes: number;
  /** Set names deleted by retention, in the order they were removed. */
  pruned: string[];
};

export async function runBackup(request: BackupRequest): Promise<BackupReport> {
  const now = request.now ?? new Date();

  // A missing source is a failure, not an empty backup. `openDatabase` would
  // happily create the file, and a run that quietly wrote an empty database into
  // a dated set — then pruned a real one to make room — is the worst thing this
  // script could do.
  if (!existsSync(request.databasePath)) {
    throw new Error(`no database at ${request.databasePath}`);
  }

  const finished = join(request.destination, backupSetName(now));
  const partial = `${finished}.partial`;
  // Fails here, before any work, when the destination cannot be written.
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });

  const databaseCopy = join(partial, basename(request.databasePath));
  const handle = openDatabase(request.databasePath);
  try {
    // The online backup. Not a file copy — see the header.
    await handle.sqlite.backup(databaseCopy);
  } finally {
    handle.close();
  }

  // The other half of the state. The folder is created even when there is
  // nothing in it yet, so every set has the same shape and a restore never has
  // to ask whether this one has images.
  const uploads = join(partial, 'uploads');
  mkdirSync(uploads, { recursive: true });
  if (existsSync(request.uploadDir)) {
    cpSync(request.uploadDir, uploads, { recursive: true });
  }

  const stored = readdirSync(uploads, { withFileTypes: true }).filter((entry) => entry.isFile());
  const report: Omit<BackupReport, 'pruned'> = {
    path: finished,
    databaseBytes: statSync(databaseCopy).size,
    uploadCount: stored.length,
    uploadBytes: stored.reduce((total, entry) => total + statSync(join(uploads, entry.name)).size, 0),
  };

  // Whole, and only now named as such.
  rmSync(finished, { recursive: true, force: true });
  renameSync(partial, finished);

  // Pruned after the new set has landed, never before: a retention rule that ran
  // first would be free to delete the last good set and then fail to write a new
  // one.
  const pruned: string[] = [];
  for (const entry of setsToPrune(readdirSync(request.destination), now, request.retentionDays)) {
    rmSync(join(request.destination, entry), { recursive: true, force: true });
    pruned.push(entry);
  }

  return { ...report, pruned };
}

// CLI: node src/ops/backup.ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = await runBackup({
      databasePath: config.databasePath,
      uploadDir: config.uploads.directory,
      destination: config.backup.directory,
      retentionDays: config.backup.retentionDays,
    });
    const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    console.log(
      `backup: ${report.path} — database ${mb(report.databaseBytes)}, `
      + `${report.uploadCount} uploads ${mb(report.uploadBytes)}`
      + (report.pruned.length === 0 ? '' : `, pruned ${report.pruned.join(' ')}`),
    );
  } catch (error) {
    // Loudly, and non-zero. A backup job that exits clean having backed up
    // nothing is worse than one that never ran: `systemctl --failed` and the
    // journal are the only places anybody would ever find out.
    console.error(`backup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
