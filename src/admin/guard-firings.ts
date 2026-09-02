// How often the Coherence Guard actually fires, as a number rather than as a
// thing nobody would notice happening.
//
// design.md § Open risks recorded the gap: *"The Coherence Guard's code path is
// untested against real incoherence: it did not fire once in 24 calls."* The
// pure rule is exhaustively covered in `tests/grader-contract.test.ts`, so the
// gap was never the rule — it was that a firing in production would leave no
// trace anyone reads.
//
// Nothing new is written to record one. [ADR 0003](../../docs/adr/0003-verdict-authority-split.md)
// already requires storing **both** Verdicts precisely so this stays measurable,
// and a firing is exactly a row where the two differ. This module is the read
// nobody had written.
//
// It sits beside the Disputes because a guard firing and an upheld Dispute are
// the two ways the system records that the Grader was wrong — one caught by a
// rule, one caught by a person — and the question they answer is the same one.

import { and, eq, isNotNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { exercises, isDeterministic, submissions, type ExerciseKind } from '../db/schema.ts';
import type { Verdict } from '../grader/contract.ts';

type Db = BetterSQLite3Database<typeof schema>;

/** One judged Submission, as much of it as this derivation looks at. */
export type JudgedSubmission = {
  /**
   * The Kind of the Exercise it answers. Here because a Deterministic Check
   * writes both Verdict columns from one comparison and can never disagree with
   * itself — counting those rows would leave the denominator saying something
   * other than "answers the Grader judged", and quietly understate the rate.
   */
  kind: ExerciseKind;
  proposedVerdict: Verdict | null;
  guardedVerdict: Verdict | null;
  /**
   * The server removed an Error the Grader reported — issue #78's typography
   * drop. Here for the same reason `kind` is: the two Verdicts on such a row
   * differ because this application took the Error out from under the first one,
   * not because the Grader contradicted itself, and counting it would report the
   * typography filter as Grader incoherence.
   */
  typographyDropped: boolean;
};

export type GuardFirings = {
  /** Grader-judged Submissions carrying both Verdicts: what `fired` is out of. */
  judged: number;
  /** Rows where the guarded Verdict differs from the proposed one. */
  fired: number;
  /** «no Errors forces correct» — the guard moved the Verdict to correct. */
  forcedCorrect: number;
  /** «any Error forbids correct» — the guard moved it off correct. */
  forbadeCorrect: number;
};

/**
 * The tally, over rows.
 *
 * Pure, and deliberately not a copy of `coherenceGuard`: it does not re-run the
 * rule and compare, it reads what was stored. A derivation that re-decided the
 * Verdict would report what the guard *would* do today rather than what it did,
 * and the two stop agreeing the moment the rule is ever changed.
 *
 * The two directions are the guard's two rules, and `forbadeCorrect` is defined
 * as the complement rather than as its own condition. Nothing but the guard
 * writes a differing pair, so no third case can arise — but if one ever did,
 * `fired` still equals the two directions added together, which is the property
 * a reader of the screen will assume.
 */
export function tallyGuardFirings(rows: readonly JudgedSubmission[]): GuardFirings {
  const tally: GuardFirings = { judged: 0, fired: 0, forcedCorrect: 0, forbadeCorrect: 0 };

  for (const row of rows) {
    if (isDeterministic(row.kind)) continue;
    if (row.typographyDropped) continue;
    // A failed grading has neither Verdict: there was no judgement, so there is
    // nothing for the guard to have moved.
    if (row.proposedVerdict === null || row.guardedVerdict === null) continue;

    tally.judged += 1;
    if (row.proposedVerdict === row.guardedVerdict) continue;

    tally.fired += 1;
    if (row.guardedVerdict === 'correct') tally.forcedCorrect += 1;
    else tally.forbadeCorrect += 1;
  }

  return tally;
}

/**
 * Every judged Submission in the system, tallied.
 *
 * Across all Courses and both Students, because the question — does this rule
 * ever fire on real output — is about the Grader rather than about anybody's
 * progress.
 */
export function guardFirings(db: Db): GuardFirings {
  const rows = db.select({
    kind: exercises.kind,
    proposedVerdict: submissions.proposedVerdict,
    guardedVerdict: submissions.guardedVerdict,
    typographyDropped: submissions.typographyDropped,
  })
    .from(submissions)
    .innerJoin(exercises, eq(exercises.id, submissions.exerciseId))
    .where(and(
      eq(submissions.status, 'graded'),
      isNotNull(submissions.proposedVerdict),
      isNotNull(submissions.guardedVerdict),
    ))
    .all();

  return tallyGuardFirings(rows);
}
