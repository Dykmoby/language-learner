// In-process concurrency limit for Grader calls (design.md § Grading: at 2, with
// a FIFO queue behind it).
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
