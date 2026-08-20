import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDatabasePath } from './helpers/temp-db.ts';
import { openDatabase } from '../src/db/client.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { seedStudents, DEFAULT_ACCOUNTS } from '../src/db/seed.ts';
import { students } from '../src/db/schema.ts';
import { eq } from 'drizzle-orm';

function freshDatabase() {
  const { path, cleanup } = tempDatabasePath();
  const handle = openDatabase(path);
  runMigrations(handle);
  return { ...handle, path, cleanup: () => { handle.close(); cleanup(); } };
}

test('the connection opens in WAL mode', () => {
  // design.md § Operations — a Student reading a Lesson is never blocked behind
  // a write on a single-disk Pi.
  const dbh = freshDatabase();
  try {
    const mode = dbh.sqlite.pragma('journal_mode', { simple: true });
    assert.equal(String(mode).toLowerCase(), 'wal');
  } finally {
    dbh.cleanup();
  }
});

test('the seed script creates the two accounts, with the Admin flag only on igor', () => {
  const dbh = freshDatabase();
  try {
    const results = seedStudents(dbh.db, DEFAULT_ACCOUNTS.map((a) => ({ ...a, password: 'correct horse battery' })));
    assert.deepEqual(results.map((r) => r.action), ['created', 'created']);

    const rows = dbh.db.select().from(students).all();
    assert.equal(rows.length, 2);

    const igor = rows.find((r) => r.username === 'igor');
    assert.ok(igor, 'igor exists');
    assert.equal(igor.isAdmin, true, 'igor holds the Admin role');

    const other = rows.find((r) => r.username !== 'igor');
    assert.ok(other, 'the second account exists');
    assert.equal(other.isAdmin, false, 'the second account is a Student only');
  } finally {
    dbh.cleanup();
  }
});

test('stored password hashes are argon2id', () => {
  const dbh = freshDatabase();
  try {
    seedStudents(dbh.db, [{ username: 'igor', password: 'correct horse battery', isAdmin: true }]);
    const row = dbh.db.select().from(students).where(eq(students.username, 'igor')).get();
    assert.ok(row, 'igor was created');
    assert.match(row.passwordHash, /^\$argon2id\$/, 'the hash names argon2id');
    assert.ok(!row.passwordHash.includes('correct horse battery'), 'the password itself is not stored');
  } finally {
    dbh.cleanup();
  }
});

test('re-running the seed leaves an existing account untouched and says so', () => {
  const dbh = freshDatabase();
  try {
    seedStudents(dbh.db, [{ username: 'igor', password: 'first password', isAdmin: true }]);
    const before = dbh.db.select().from(students).where(eq(students.username, 'igor')).get()!;

    const results = seedStudents(dbh.db, [{ username: 'igor', password: 'second password', isAdmin: true }]);
    assert.deepEqual(results.map((r) => r.action), ['skipped'], 'the result reports the skip');

    const after = dbh.db.select().from(students).where(eq(students.username, 'igor')).get()!;
    assert.equal(after.passwordHash, before.passwordHash, 'setting up the Pi twice does not reset a password');
  } finally {
    dbh.cleanup();
  }
});

test('an explicit override re-seeds an existing account', () => {
  const dbh = freshDatabase();
  try {
    seedStudents(dbh.db, [{ username: 'igor', password: 'first password', isAdmin: true }]);
    const before = dbh.db.select().from(students).where(eq(students.username, 'igor')).get()!;

    const results = seedStudents(dbh.db, [{ username: 'igor', password: 'second password', isAdmin: true }], { force: true });
    assert.deepEqual(results.map((r) => r.action), ['reseeded']);

    const after = dbh.db.select().from(students).where(eq(students.username, 'igor')).get()!;
    assert.notEqual(after.passwordHash, before.passwordHash, 'the password actually changed');
    assert.equal(after.id, before.id, 're-seeding updates the account rather than replacing it');
  } finally {
    dbh.cleanup();
  }
});

test('migrations are applied by a runner that does not seed', () => {
  // Two separate concerns: a fresh migrated database has the Student table and
  // no Students in it.
  const dbh = freshDatabase();
  try {
    assert.deepEqual(dbh.db.select().from(students).all(), []);
  } finally {
    dbh.cleanup();
  }
});

test('running migrations twice is a no-op rather than an error', () => {
  const dbh = freshDatabase();
  try {
    runMigrations(dbh);
    assert.deepEqual(dbh.db.select().from(students).all(), []);
  } finally {
    dbh.cleanup();
  }
});
