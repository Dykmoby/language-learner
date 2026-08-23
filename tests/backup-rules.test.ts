// Naming and retention, with no filesystem anywhere near them.
//
// Both are rules rather than operations: what a set is called decides whether it
// can be found and sorted a year from now, and what gets pruned decides whether
// a backup nobody has looked at deletes the only copy of something. Neither is
// worth testing through a directory.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupSetName, setsToPrune } from '../src/ops/backup.ts';

const DAY = 24 * 60 * 60 * 1000;
// Deliberately carrying milliseconds, as a real run does. A `now` on a whole
// second would hide the gap between the clock and a set name truncated to
// seconds, and that gap is exactly where the retention edge lives.
const NOW = new Date('2026-08-22T03:15:00.437Z');

test('a set is named for the instant it was taken, in UTC', () => {
  assert.equal(backupSetName(new Date('2026-08-22T03:15:00Z')), '2026-08-22T031500Z');
  assert.equal(backupSetName(new Date('2026-01-02T00:00:09Z')), '2026-01-02T000009Z');
});

test('names sort as text in the order they were taken', () => {
  // The whole reason for a fixed-width UTC name: `ls` is the index, and a
  // restore procedure that has to parse dates to find the newest set is one more
  // thing to get wrong at the worst possible moment.
  const taken = [
    new Date('2026-08-22T03:15:00Z'),
    new Date('2026-09-01T03:15:00Z'),
    new Date('2026-08-09T23:59:59Z'),
    new Date('2027-01-01T00:00:00Z'),
  ].map(backupSetName);

  assert.deepEqual([...taken].sort(), [taken[2], taken[0], taken[1], taken[3]]);
});

test('sets older than the retention window are pruned; the edge is kept', () => {
  const entries = [
    backupSetName(new Date(NOW.getTime() - 15 * DAY)),
    backupSetName(new Date(NOW.getTime() - 14 * DAY)),
    backupSetName(new Date(NOW.getTime() - 1 * DAY)),
    backupSetName(NOW),
  ];

  assert.deepEqual(
    setsToPrune(entries, NOW, 14),
    [entries[0]],
    'exactly fourteen days old is still inside a fourteen-day window',
  );
});

test('an interrupted set is pruned by its own date, not left behind for ever', () => {
  const abandoned = `${backupSetName(new Date(NOW.getTime() - 20 * DAY))}.partial`;
  const inFlight = `${backupSetName(NOW)}.partial`;

  assert.deepEqual(setsToPrune([abandoned, inFlight], NOW, 14), [abandoned]);
});

test('anything that is not a set name is never touched', () => {
  // The destination is a directory in someone's home. Deleting what it does not
  // recognise is how a backup job destroys the thing it was pointed at by
  // mistake.
  const strangers = ['notes.txt', 'weekly-copy', '2026-08-22', 'lost+found', '.DS_Store'];
  assert.deepEqual(setsToPrune([...strangers, backupSetName(new Date(NOW.getTime() - 99 * DAY))], NOW, 14),
    [backupSetName(new Date(NOW.getTime() - 99 * DAY))]);
});

test('a retention window of zero days still keeps the set just taken', () => {
  // Nobody should configure this, but a rule that deleted the backup it had just
  // written would be worse than one that refused to prune at all — and `now`
  // here carries milliseconds, so this is the real arithmetic rather than a
  // whole-second one that would hide the gap.
  assert.deepEqual(setsToPrune([backupSetName(NOW)], NOW, 0), []);
});
