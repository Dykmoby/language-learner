// The one read of the accepted-answers column, and what it does with the two
// ways the column can be found written.
//
// #82 retypes accepted answers as a list per position, so a fill-gap with
// several gaps can hold the values accepted at each. The retype goes in as
// expand, migrate, contract, and this is the seam the expand step adds: every
// caller reads through `acceptedPositions`, and only `acceptedPositions` knows
// that rows written before the migration hold one flat list of whole answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptedPositions } from '../src/content/accepted.ts';

test('a flat list is the single position it has always been', () => {
  // The honest special case, not a different meaning: an Exercise with one place
  // to answer has one position holding every value accepted there.
  assert.deepEqual(acceptedPositions({ acceptedAnswers: ['is', "'s"] }), [['is', "'s"]]);
});

test('a list per position is read as it is stored', () => {
  assert.deepEqual(
    acceptedPositions({ acceptedAnswers: [['is', "'s"], ['a', 'one']] }),
    [['is', "'s"], ['a', 'one']],
  );
});

test('nothing accepted is no positions, rather than one empty one', () => {
  // A Grader-judged Exercise accepts nothing here, and must not gain a position
  // that the validity rules would then have to explain away.
  assert.deepEqual(acceptedPositions({ acceptedAnswers: [] }), []);
});
