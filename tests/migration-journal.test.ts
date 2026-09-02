// The journal has to be in timestamp order, and nothing else checks it.
//
// Drizzle's SQLite migrator does not walk the journal by index. It reads the
// single newest `created_at` out of `__drizzle_migrations` and applies a
// migration only when that migration's journal `when` is greater than it
// (drizzle-orm/sqlite-core/dialect.js). So a migration that arrives in the
// folder carrying a `when` below one already applied is skipped — no error, no
// log line, and the application then fails at runtime on a column that was never
// created.
//
// That is reachable by ordinary work: two branches each adding a migration, the
// one generated earlier merging second. This asserts the property that makes the
// migrator's rule and the folder's numbering agree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const journal = JSON.parse(
  readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
) as { entries: Array<{ idx: number; tag: string; when: number }> };

test('every migration is newer than the one before it', () => {
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

  for (const [at, entry] of entries.entries()) {
    const previous = entries[at - 1];
    if (previous === undefined) continue;
    assert.ok(
      entry.when > previous.when,
      `${entry.tag} (when ${entry.when}) is not newer than ${previous.tag} (when ${previous.when}) — `
      + 'the migrator compares timestamps, so this one would be applied and then silently skipped',
    );
  }
});

test('every journal entry has a file, and every file has an entry', () => {
  // A gap in the numbering is allowed — two branches in flight leave one — but a
  // migration in the folder that the journal does not name is never applied, and
  // an entry with no file throws on boot.
  const files = readdirSync(new URL('../drizzle', import.meta.url))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.replace(/\.sql$/, ''))
    .sort();

  assert.deepEqual(journal.entries.map((entry) => entry.tag).sort(), files);
});
