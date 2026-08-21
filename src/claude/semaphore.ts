// In-process concurrency limit for SDK calls.
//
// Grading and authoring each hold their own, at their own limits (design.md
// § Grading puts grading at 2 with a FIFO queue behind it). Two limits rather
// than one because the two kinds of work are nothing alike: a Verdict is 4-7s,
// and a Generation at max Effort on Opus 5 is minutes. Sharing a limit lets an
// Admin's Lesson occupy a grading slot while a Student sits in front of a
// spinner with no way of knowing that is what they are waiting for.
//
// FIFO matters: a Submission that queued first must not be overtaken by one that
// arrived later, or a Student watching a spinner waits on someone else's answer.

export class Semaphore {
  #limit: number;
  #inFlight = 0;
  #waiting: Array<() => void> = [];

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error(`limit must be a positive integer, got ${limit}`);
    this.#limit = limit;
  }

  get inFlight(): number { return this.#inFlight; }
  get queued(): number { return this.#waiting.length; }

  async acquire(): Promise<() => void> {
    if (this.#inFlight >= this.#limit) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    this.#inFlight++;

    // Idempotent: a double release must not conjure a permit that was never
    // taken, which would quietly raise the limit for everyone after it.
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#inFlight--;
      this.#waiting.shift()?.();
    };
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }
}
