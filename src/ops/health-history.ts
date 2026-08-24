// The health check, kept.
//
// `../grader/health-check.ts` answers whether grading works right now, and it is
// exhaustive about what it found. What it has never had is a memory: the answer
// lived in the component state of whoever pressed the button, so closing the tab
// threw it away and the dashboard never had one at all. design.md § Operations
// is explicit about why that matters — *"otherwise the first person to discover
// expired credentials is a student mid-Lesson."*
//
// So every run is recorded, and the dashboard reads the latest one instead of
// spending a paid Grader call to render a page. Which turns "is grading working"
// into a question about evidence rather than about the last outcome, and that
// distinction is what `healthStanding` exists to make.

import { desc } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { healthChecks, type HealthCheckRow, type HealthCheckSource } from '../db/schema.ts';
import { config } from '../config.ts';
// Type only: this module must not drag the SDK in behind a page render.
import type { HealthResult } from '../grader/health-check.ts';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Records one run.
 *
 * Called on every path that runs the check — the Admin's button and the timer
 * alike — because a result that is sometimes kept is a memory nobody can read a
 * conclusion out of.
 */
export function recordHealthCheck(
  db: Db,
  result: HealthResult,
  source: HealthCheckSource,
  now: Date = new Date(),
): HealthCheckRow {
  return db.insert(healthChecks).values({
    healthy: result.healthy,
    wallMs: result.wallMs,
    reason: result.reason,
    likelyCredentials: result.likelyCredentials,
    likelyEgress: result.likelyEgress,
    likelyRateLimit: result.likelyRateLimit,
    source,
    ranAt: now,
  }).returning().get();
}

/**
 * Records one run, and says whether it could be.
 *
 * Separate from `recordHealthCheck` because the two callers want opposite
 * things from a failure. Every run costs a real, paid Grader call, and the
 * commonest way this throws is a deploy where the code is live and the step-8
 * migration has not been applied — precisely when the answer is worth having.
 * So the answer is never lost to the failure to write it down: the caller
 * returns or prints what it found, and reports separately that it could not be
 * kept.
 */
export function tryRecordHealthCheck(
  db: Db,
  result: HealthResult,
  source: HealthCheckSource,
  now: Date = new Date(),
): { kept: true } | { kept: false; reason: string } {
  try {
    recordHealthCheck(db, result, source, now);
    return { kept: true };
  } catch (error) {
    return { kept: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** The most recent run, or null on a system where the check has never been run. */
export function latestHealthCheck(db: Db): HealthCheckRow | null {
  // By `ranAt` rather than by id: the two agree today, and only one of them
  // still means "most recent" if a run is ever recorded out of order.
  return db.select().from(healthChecks).orderBy(desc(healthChecks.ranAt), desc(healthChecks.id))
    .limit(1).get() ?? null;
}

export type HealthStanding =
  | { state: 'never'; check: null; ageMs: null }
  | { state: 'healthy' | 'unhealthy' | 'stale'; check: HealthCheckRow; ageMs: number };

/**
 * What the dashboard should say, from the latest run and the clock.
 *
 * Four states rather than a boolean, because two of them are not about the
 * Grader at all:
 *
 * - **never** — nothing has run. Not a failure, and must not be dressed as one.
 * - **stale** — the last run is too old to be evidence about now. A check that
 *   passed a week ago says nothing about this afternoon, and a green banner on
 *   that basis is worse than no banner. Age is deliberately checked before the
 *   outcome: a stale failure is red either way, and the likeliest reading of one
 *   is that whatever was meant to be re-running has stopped too.
 * - **healthy** / **unhealthy** — a recent run, reported as it stands.
 *
 * Pure, and takes `now` and the window: the dashboard's colour is then something
 * a test can pin without waiting a day for it.
 */
export function healthStanding(
  latest: HealthCheckRow | null,
  now: Date,
  staleAfterMs: number,
): HealthStanding {
  if (latest === null) return { state: 'never', check: null, ageMs: null };

  // Clamped: the Pi's clock jumps when it comes back from being off, and a run
  // stamped in the future is a fact about the clock, not a negative age.
  const ageMs = Math.max(0, now.getTime() - latest.ranAt.getTime());
  if (ageMs > staleAfterMs) return { state: 'stale', check: latest, ageMs };
  return { state: latest.healthy ? 'healthy' : 'unhealthy', check: latest, ageMs };
}

/** The standing as the screens ask for it: the latest run, against the configured window. */
export function currentHealthStanding(db: Db, now: Date = new Date()): HealthStanding {
  return healthStanding(latestHealthCheck(db), now, config.health.staleAfterMs);
}
