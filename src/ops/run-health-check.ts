// The health check, unattended.
//
// The dashboard has a memory; this is what fills it without anyone pressing
// anything, so an expired credential or a broken egress path surfaces before a
// Student meets it mid-Lesson (design.md § Operations).
//
// It runs under a systemd timer, through the same environment file the service
// reads — and that matters more than it looks. ADR 0001's whole point is that
// the credentials path works only in the shape it actually ships: the right
// HOME, and the outbound proxy that systemd units do not inherit from the
// profile. A check that ran in some other environment would prove the wrong
// thing, and prove it green.
//
// **Exit code.** Zero whenever the result was recorded, healthy or not. The
// timer's job is to write down what it found; a Grader outage is not a failure
// of that job, and reporting it as one would put an outage into `systemctl
// --failed` — where the response is a restart, and where a restart is another
// paid call against an API that is already saying no. The unhealthy result is
// the output, and the dashboard is where it is meant to be read. A non-zero exit
// means the check could not be run or could not be kept.

import { fileURLToPath } from 'node:url';
import { config } from '../config.ts';
import { openDatabase } from '../db/client.ts';
import { runHealthCheck } from '../grader/health-check.ts';
import { recordHealthCheck } from './health-history.ts';

// CLI: node src/ops/run-health-check.ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const handle = openDatabase(config.databasePath);
  try {
    // Never throws: the Grader module's terminal result is a discriminated
    // union, so an unhealthy check is a value rather than an exception.
    const result = await runHealthCheck();
    recordHealthCheck(handle.db, result, 'timer');

    const seconds = (result.wallMs / 1000).toFixed(1);
    if (result.healthy) {
      console.log(`health check: healthy in ${seconds}s, ${result.detail.contextTokens ?? '?'} context tokens`);
    } else {
      // The journal gets the whole reason. ADR 0001 records this text as
      // misleading to a person, which is why the heuristics are printed beside
      // it rather than the text being trusted on its own.
      const guesses = [
        result.likelyCredentials ? 'likely credentials' : null,
        result.likelyEgress ? 'likely egress' : null,
      ].filter((guess) => guess !== null);
      console.error(
        `health check: UNHEALTHY in ${seconds}s — ${result.reason ?? 'no reason given'}`
        + (guesses.length === 0 ? '' : ` [${guesses.join(', ')}]`),
      );
    }
  } finally {
    handle.close();
  }
}
