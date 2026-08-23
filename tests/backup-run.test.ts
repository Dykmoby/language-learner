// One run of the backup, against a real database that is open and being written
// to — which is the only interesting case. A backup taken from a quiet database
// proves nothing about the one this script will actually meet: WAL mode, the
// service serving, and the last hours of writes sitting in a `-wal` file that a
// naive copy would leave behind.
//
// The restore is performed here rather than described: the copy is opened and
// read, because a backup nobody has restored is not a backup.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents } from '../src/db/seed.ts';
import { seedCourseContent } from '../src/content/seed-content.ts';
import { backupSetName, runBackup } from '../src/ops/backup.ts';
import { courses, students } from '../src/db/schema.ts';
import { DETERMINISTIC_COURSE } from './helpers/fixtures.ts';

const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function scratch(): { databasePath: string; uploadDir: string; destination: string } {
  const root = mkdtempSync(join(tmpdir(), 'language-learner-backup-'));
  roots.push(root);
  const paths = {
    databasePath: join(root, 'state', 'language-learner.db'),
    uploadDir: join(root, 'state', 'uploads'),
    destination: join(root, 'backups'),
  };
  mkdirSync(paths.uploadDir, { recursive: true });
  return paths;
}

// A live database, seeded through the same modules the Pi runs, left open on
// purpose so the backup is taken from underneath an active connection.
function liveDatabase(databasePath: string) {
  const handle = openDatabase(databasePath);
  runMigrations(handle);
  seedStudents(handle.db, [{ username: 'igor', password: 'correct horse battery', isAdmin: true }]);
  seedCourseContent(handle.db, DETERMINISTIC_COURSE);
  return handle;
}

test('a set holds both halves of the state, and the copy opens and reads', async () => {
  const paths = scratch();
  const live = liveDatabase(paths.databasePath);

  writeFileSync(join(paths.uploadDir, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'), Buffer.alloc(64, 7));
  writeFileSync(join(paths.uploadDir, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg'), Buffer.alloc(32, 9));

  // Written after the last checkpoint and never committed to the main file by
  // hand: this row lives in the WAL, and a `cp` of the `.db` would lose it.
  live.db.insert(students).values({
    username: 'written-into-the-wal', passwordHash: 'x', isAdmin: false, createdAt: new Date(),
  }).run();

  const report = await runBackup({ ...paths, retentionDays: 14, now: new Date('2026-08-22T03:00:00Z') });

  assert.equal(report.path, join(paths.destination, '2026-08-22T030000Z'));
  assert.equal(report.uploadCount, 2, 'the images travel with the database');
  assert.ok(report.databaseBytes > 0);
  assert.deepEqual(
    readdirSync(paths.destination),
    ['2026-08-22T030000Z'],
    'nothing half-written is left behind under a name that looks finished',
  );

  live.close();

  // The restore, performed rather than described.
  const restored = openDatabase(join(report.path, 'language-learner.db'));
  try {
    const seeded = restored.db.select().from(courses)
      .where(eq(courses.title, DETERMINISTIC_COURSE.title)).get();
    assert.equal(seeded?.title, DETERMINISTIC_COURSE.title, 'the restored database reads');

    const fromTheWal = restored.db.select().from(students)
      .where(eq(students.username, 'written-into-the-wal')).get();
    assert.ok(fromTheWal, 'and holds the writes that had not been checkpointed yet');
  } finally {
    restored.close();
  }

  const images = readdirSync(join(report.path, 'uploads')).sort();
  assert.deepEqual(images, ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg']);
});

test('retention deletes old sets and nothing else in the folder', async () => {
  const paths = scratch();
  const live = liveDatabase(paths.databasePath);
  const now = new Date('2026-08-22T03:00:00Z');
  const day = 24 * 60 * 60 * 1000;

  mkdirSync(paths.destination, { recursive: true });
  const old = backupSetName(new Date(now.getTime() - 20 * day));
  const recent = backupSetName(new Date(now.getTime() - 2 * day));
  for (const name of [old, recent]) mkdirSync(join(paths.destination, name));
  // The weekly copy someone pulled off the Pi by hand, sitting beside the sets.
  writeFileSync(join(paths.destination, 'weekly-copy-notes.txt'), 'kept');

  const report = await runBackup({ ...paths, retentionDays: 14, now });
  live.close();

  assert.deepEqual(report.pruned, [old]);
  assert.deepEqual(
    readdirSync(paths.destination).sort(),
    [backupSetName(now), recent, 'weekly-copy-notes.txt'].sort(),
  );
});

test('a run that cannot write its destination fails, and says so non-zero', () => {
  const paths = scratch();
  liveDatabase(paths.databasePath).close();
  // A file where the destination directory should be: the set cannot be created.
  writeFileSync(paths.destination, 'not a directory');

  const run = spawnSync(process.execPath, ['src/ops/backup.ts'], {
    env: {
      ...process.env,
      DATABASE_PATH: paths.databasePath,
      UPLOAD_DIR: paths.uploadDir,
      BACKUP_DIR: paths.destination,
    },
    encoding: 'utf8',
  });

  assert.equal(run.status, 1, 'it exits non-zero rather than clean having backed up nothing');
  assert.match(run.stderr, /backup failed/);
});

test('a missing database is a failure, not an empty backup', async () => {
  const paths = scratch();
  // Nothing has ever been migrated here. Backing this up would write an empty
  // database into a dated set — and then prune a real one to make room for it.
  await assert.rejects(
    runBackup({ ...paths, retentionDays: 14 }),
    /no database at/,
  );
  assert.ok(!existsSync(paths.destination), 'and it fails before creating anything');
});
