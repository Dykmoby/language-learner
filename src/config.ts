// Configuration comes from the environment file the systemd unit reads, never
// from checked-in values. Nothing here has a secret as a default.

import { homedir } from 'node:os';

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer, got ${JSON.stringify(v)}`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  throw new Error(`${name} must be true or false, got ${JSON.stringify(v)}`);
}

export const config = {
  port: int('PORT', 4100),
  databasePath: str('DATABASE_PATH', 'data/language-learner.db'),

  session: {
    ttlDays: int('SESSION_TTL_DAYS', 30),
    cookieName: str('SESSION_COOKIE_NAME', 'll_session'),
    // Defaults on. Local browser development over plain http sets this false in
    // its env file; the deployed service is behind Caddy's TLS and never does.
    secureCookie: bool('SESSION_COOKIE_SECURE', true),
  },

  throttle: {
    // design.md § Security: exponential backoff, lockout after 5 failures.
    lockoutAfterFailures: int('LOGIN_LOCKOUT_AFTER', 5),
    // In seconds so the value is tunable and its expiry is observable; the
    // Russian message rounds up to whole minutes for the Student.
    lockoutSeconds: int('LOGIN_LOCKOUT_SECONDS', 15 * 60),
    // Failure n waits baseSeconds * 2^(n-1), capped.
    backoffBaseSeconds: int('LOGIN_BACKOFF_BASE_SECONDS', 2),
    backoffMaxSeconds: int('LOGIN_BACKOFF_MAX_SECONDS', 60),
  },

  grader: {
    // design.md § Grading: 90s hard timeout, in-process semaphore at 2.
    timeoutMs: int('GRADER_TIMEOUT_MS', 90_000),
    concurrency: int('GRADER_CONCURRENCY', 2),
  },

  testGrading: {
    // A Test's free-form answers go to Claude in one call, and that call is not a
    // Verdict on one Submission: the spike measured those at 4-7s, and ten answers
    // judged at once is a different order of wait. The Grader's 90s would time out
    // exactly the calls this exists for.
    //
    // It runs in the **grading** lane all the same — it is a Student's own
    // foreground work, stateless per ADR 0004, and an Admin's Generation must
    // never take its slot. The tension worth naming for whoever comes after: at a
    // concurrency of 2, a long batch holds a grading slot for minutes. If that is
    // ever measured leaving a Student waiting mid-Practice, the fix is a lane of
    // its own — not a shorter timeout.
    timeoutMs: int('TEST_GRADING_TIMEOUT_MS', 5 * 60_000),
  },

  authoring: {
    // Its own limit, and its own timeout, because the work is nothing like
    // grading. The spike measured a Verdict at 4-7s; a whole Lesson with ten
    // Exercises at `max` Effort on Opus 5 is minutes. Sharing the Grader's 90s
    // would time out the very calls this exists for, and sharing its two slots
    // would leave a Student in front of a spinner waiting on an Admin's Lesson —
    // with no way of knowing that is what they are waiting for.
    //
    // Twenty minutes rather than ten because MAX_EXERCISES is a hundred: the
    // wait scales with the Practice asked for, and a cap the timeout cannot sit
    // through is a cap that only pretends to be raised. It bounds a call that
    // has stopped coming back; it is not what an ordinary Generation costs.
    timeoutMs: int('AUTHORING_TIMEOUT_MS', 20 * 60_000),
    // One at a time by default: a two-person application has one Admin, and a
    // second concurrent Generation buys nothing but a second minutes-long call
    // against the same subscription.
    concurrency: int('AUTHORING_CONCURRENCY', 1),
  },

  health: {
    // How long a recorded health check stays evidence.
    //
    // A check that last passed a week ago says nothing about whether grading
    // works this afternoon, and a green banner on that basis is worse than no
    // banner. Deliberately wider than the timer's interval, so an ordinary gap
    // between runs — a reboot, a slow night — does not read as an alarm.
    staleAfterMs: int('HEALTH_STALE_AFTER_HOURS', 24) * 60 * 60_000,
  },

  backup: {
    // design.md § Operations: a nightly set into ~/backups, 14 days of them.
    // Under the home directory rather than inside the repo, deliberately — a
    // backup that a rebuild or a `git clean` can take with it is not one.
    directory: str('BACKUP_DIR', `${homedir()}/backups`),
    retentionDays: int('BACKUP_RETENTION_DAYS', 14),
  },

  courseImport: {
    // A whole Course in one file, images included. Generous, because twenty
    // illustrations at the upload cap are legitimately ~54 MB once base64 has
    // had them — and bounded all the same, because the file is read into memory
    // before a word of it is trusted. Worth knowing before raising it: one
    // import briefly holds the body, the text, the parsed graph and the decoded
    // images at once, so peak is several times this number on a Pi. Lower it if
    // the Courses here are smaller than that.
    maxBytes: int('COURSE_IMPORT_MAX_BYTES', 64 * 1024 * 1024),
  },

  uploads: {
    // Outside the build output, deliberately: an image written into .next would
    // not survive the next build, and the point of serving through a route is
    // that the folder outlives every deploy. Beside the database, which is the
    // other thing on this box that must not be rebuilt away.
    directory: str('UPLOAD_DIR', 'data/uploads'),
    // A Theory illustration, not a photo library. Refused before anything
    // reaches disk rather than truncated after.
    maxBytes: int('UPLOAD_MAX_BYTES', 2 * 1024 * 1024),
  },
} as const;
