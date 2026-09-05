// Seam 2 — a pure function, tested for the properties the screen depends on.
//
// The order a Student meets an Exercise's choices in is drawn here and used as
// positions: the word order addresses its fragments by where they sit, so an
// order that lost a position would drop a fragment off the screen and one that
// repeated a position would offer the same word twice while another went
// missing. Neither shows up in a build or a typecheck — both would show up as an
// Exercise that cannot be answered.
//
// The other property is the one the shuffle exists for: no position is nailed
// down. An author that writes the right option first is only a problem if the
// first option on the screen is still the one it wrote first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inOrder, isOrder, shuffle } from '../src/app/shared/choice-order.ts';

/** Draws enough that an arrangement missing from all of them means something. */
const DRAWS = 2000;

test('the authored order is every position once, in the order they were written', () => {
  assert.deepEqual(inOrder(0), []);
  assert.deepEqual(inOrder(1), [0]);
  assert.deepEqual(inOrder(4), [0, 1, 2, 3]);
});

test('a shuffle loses nothing and repeats nothing, at every size', () => {
  for (let count = 0; count <= 8; count += 1) {
    for (let draw = 0; draw < 200; draw += 1) {
      const order = shuffle(count);
      assert.ok(isOrder(order, count), `${count}: ${JSON.stringify(order)}`);
    }
  }
});

test('no choice is nailed to a position: over many draws, each lands in each', () => {
  const count = 4;
  // seen[choice] is the set of positions that choice has been drawn into.
  const seen = Array.from({ length: count }, () => new Set<number>());

  for (let draw = 0; draw < DRAWS; draw += 1) {
    shuffle(count).forEach((choice, at) => seen[choice]?.add(at));
  }

  for (let choice = 0; choice < count; choice += 1) {
    assert.equal(seen[choice]?.size, count, `choice ${choice} never reached every position`);
  }
});

test('every arrangement is reachable, the authored one included', () => {
  // Three choices are six arrangements. The authored one is among them on
  // purpose: a shuffle that refused to draw it would be a shuffle a Student
  // could read something off, and with two fragments it would be no shuffle.
  const drawn = new Set<string>();
  for (let draw = 0; draw < DRAWS; draw += 1) drawn.add(shuffle(3).join(''));

  assert.equal(drawn.size, 6, [...drawn].join(' '));
  assert.ok(drawn.has('012'), 'the authored order never came up');
});

test('a random is only asked for a position it could use', () => {
  // Math.random never returns 1, but this takes any random. One that did would,
  // unclamped, index past the end of the order and swap a position for nothing.
  for (let count = 1; count <= 6; count += 1) {
    assert.ok(isOrder(shuffle(count, () => 1), count), `all-1 random at ${count}`);
    assert.ok(isOrder(shuffle(count, () => 0), count), `all-0 random at ${count}`);
    assert.ok(isOrder(shuffle(count, () => 0.999999), count), `near-1 random at ${count}`);
  }
});

test('a shuffle is not a sort: the draw decides it', () => {
  // The same random, twice, is the same order — the shuffle adds nothing of its
  // own beyond what it is given.
  const feed = () => {
    let at = 0;
    const values = [0.7, 0.1, 0.9, 0.35, 0.55];
    return () => values[at++ % values.length] ?? 0;
  };

  assert.deepEqual(shuffle(5, feed()), shuffle(5, feed()));
});

test('an order read back out of storage is checked for still being one', () => {
  assert.ok(isOrder([0, 1, 2], 3));
  assert.ok(isOrder([2, 0, 1], 3));
  assert.ok(isOrder([], 0));

  // An Admin can edit an Exercise between two visits in one session.
  assert.equal(isOrder([0, 1], 3), false, 'too short for these choices');
  assert.equal(isOrder([0, 1, 2, 3], 3), false, 'too long for these choices');
  assert.equal(isOrder([0, 1, 1], 3), false, 'one choice twice, one missing');
  assert.equal(isOrder([0, 1, 3], 3), false, 'a position that is not there');
  assert.equal(isOrder([0, 1, -1], 3), false, 'a position before the first');
  assert.equal(isOrder([0, 1, 1.5], 3), false, 'a position between two');

  // Anything at all can come back out of storage.
  assert.equal(isOrder(null, 3), false);
  assert.equal(isOrder('012', 3), false);
  assert.equal(isOrder({ 0: 0, 1: 1, 2: 2 }, 3), false);
  assert.equal(isOrder(['0', '1', '2'], 3), false);
});
