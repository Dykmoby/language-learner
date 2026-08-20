import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore } from '../src/grader/semaphore.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));

test('it admits up to its limit at once', async () => {
  const semaphore = new Semaphore(2);
  const first = await semaphore.acquire();
  const second = await semaphore.acquire();
  assert.equal(semaphore.inFlight, 2);
  first();
  second();
  assert.equal(semaphore.inFlight, 0);
});

test('a third caller waits until a permit is released', async () => {
  const semaphore = new Semaphore(2);
  const first = await semaphore.acquire();
  await semaphore.acquire();

  let admitted = false;
  const third = semaphore.acquire().then((release) => { admitted = true; return release; });

  await tick();
  assert.equal(admitted, false, 'the third caller is held behind the limit');
  assert.equal(semaphore.queued, 1);

  first();
  await third;
  assert.equal(admitted, true, 'and is admitted the moment a permit frees up');
});

test('waiters are admitted in the order they arrived', async () => {
  // FIFO, not whichever the runtime happens to wake first: a Submission that
  // queued first must not be overtaken by one that arrived later.
  const semaphore = new Semaphore(1);
  const held = await semaphore.acquire();

  const admitted: number[] = [];
  const waiters = [1, 2, 3, 4].map((n) =>
    semaphore.acquire().then((release) => { admitted.push(n); return release; }),
  );

  await tick();
  assert.deepEqual(admitted, [], 'all four are waiting');

  held();
  for (const waiter of waiters) (await waiter)();

  assert.deepEqual(admitted, [1, 2, 3, 4]);
});

test('releasing twice does not hand out a permit that was never taken', async () => {
  const semaphore = new Semaphore(1);
  const release = await semaphore.acquire();
  release();
  release();
  assert.equal(semaphore.inFlight, 0);

  await semaphore.acquire();
  assert.equal(semaphore.inFlight, 1, 'the limit still holds after a double release');
  let admitted = false;
  void semaphore.acquire().then(() => { admitted = true; });
  await tick();
  assert.equal(admitted, false);
});

test('run() releases its permit even when the work throws', async () => {
  const semaphore = new Semaphore(1);
  await assert.rejects(semaphore.run(async () => { throw new Error('grading blew up'); }), /grading blew up/);
  assert.equal(semaphore.inFlight, 0, 'a failed call must not leak a permit and wedge the queue');
});
