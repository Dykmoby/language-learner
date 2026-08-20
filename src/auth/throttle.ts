// What happens when someone guesses.
//
// Rows are keyed by whatever username was submitted, including ones that do not
// exist. That is deliberate: if only real accounts were throttled, the throttle
// itself would confirm which names exist, and the login form's careful silence
// about which field was wrong would be undone by its timing.

import { eq, lt } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { loginThrottle } from '../db/schema.ts';
import { config } from '../config.ts';

type Db = BetterSQLite3Database<typeof schema>;

export type ThrottleDecision =
  | { allowed: true }
  | { allowed: false; kind: 'locked' | 'slow'; secondsRemaining: number };

// Failure n must wait base * 2^(n-1), capped. With the default base of 2s that
// is 2, 4, 8, 16 — and the fifth failure locks instead.
function backoffSeconds(failures: number): number {
  if (failures <= 0 || config.throttle.backoffBaseSeconds === 0) return 0;
  const grown = config.throttle.backoffBaseSeconds * 2 ** (failures - 1);
  return Math.min(grown, config.throttle.backoffMaxSeconds);
}

const secondsUntil = (when: Date, now: Date) =>
  Math.max(1, Math.ceil((when.getTime() - now.getTime()) / 1000));

export function checkThrottle(db: Db, username: string, now = new Date()): ThrottleDecision {
  const row = db.select().from(loginThrottle).where(eq(loginThrottle.username, username)).get();
  if (!row) return { allowed: true };

  if (row.lockedUntil && row.lockedUntil > now) {
    return { allowed: false, kind: 'locked', secondsRemaining: secondsUntil(row.lockedUntil, now) };
  }

  // The lockout has run out. It expires on its own — a locked account is a
  // delay, never something the Admin has to clear.
  if (row.lockedUntil) return { allowed: true };

  const waitUntil = new Date(row.lastFailureAt.getTime() + backoffSeconds(row.consecutiveFailures) * 1000);
  if (waitUntil > now) {
    return { allowed: false, kind: 'slow', secondsRemaining: secondsUntil(waitUntil, now) };
  }
  return { allowed: true };
}

export type FailureOutcome = { consecutiveFailures: number; lockedUntil: Date | null };

export function recordFailure(db: Db, username: string, now = new Date()): FailureOutcome {
  const row = db.select().from(loginThrottle).where(eq(loginThrottle.username, username)).get();

  // A lockout that has already expired starts the count again from one, rather
  // than resuming at five and re-locking on the next mistake.
  const priorFailures = row && !(row.lockedUntil && row.lockedUntil <= now) ? row.consecutiveFailures : 0;
  const consecutiveFailures = priorFailures + 1;

  const lockedUntil = consecutiveFailures >= config.throttle.lockoutAfterFailures
    ? new Date(now.getTime() + config.throttle.lockoutSeconds * 1000)
    : null;

  db.insert(loginThrottle)
    .values({ username, consecutiveFailures, lastFailureAt: now, lockedUntil })
    .onConflictDoUpdate({
      target: loginThrottle.username,
      set: { consecutiveFailures, lastFailureAt: now, lockedUntil },
    })
    .run();

  pruneStaleRows(db, now);

  // Returned so the caller can tell the Student they are locked out at the
  // moment it happens, rather than letting them discover it on the next try.
  return { consecutiveFailures, lockedUntil };
}

// A successful sign-in forgets the earlier failures, so a bad-typing day does
// not accumulate toward a lockout weeks later.
export function recordSuccess(db: Db, username: string): void {
  db.delete(loginThrottle).where(eq(loginThrottle.username, username)).run();
}

// Rows are created for usernames that do not exist, so something has to bound
// them. Anything untouched for a day is long past both its backoff and its
// lockout and can tell nobody anything.
function pruneStaleRows(db: Db, now: Date): void {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  db.delete(loginThrottle).where(lt(loginThrottle.lastFailureAt, cutoff)).run();
}
