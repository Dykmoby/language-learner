// Configuration comes from the environment file the systemd unit reads, never
// from checked-in values. Nothing here has a secret as a default.

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
} as const;
