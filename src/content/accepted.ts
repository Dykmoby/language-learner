// Every answer an Exercise accepts, from both places they can come from.
//
// CONTEXT.md § Deterministic Check: judgement in code compares against Reference
// Answers *and Accepted Variants*. Two sources, one question — the authored list
// an Admin wrote on the form, and the answers an Admin has since confirmed by
// upholding a Dispute.
//
// It lives here rather than in deterministic-check.ts because that module is pure
// by construction, with no database and no knowledge of Submissions, and a test
// asserts it. This is the read that feeds it.
//
// Without this, upholding a Dispute on a fill-gap would write an Accepted Variant
// that nothing ever consults, and the closed feedback loop would silently be open
// for half the Exercise Kinds.

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { acceptedVariants, type ExerciseRow } from '../db/schema.ts';
import type { AcceptedAnswers } from './exercise-validity.ts';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * What an Exercise accepts, one list per position — the single read of the
 * stored column.
 *
 * One line, and worth keeping as a name rather than inlining: it is what makes
 * the shape of the column a thing this module owns, so the next change to it is
 * one function rather than every screen that shows an answer.
 */
export function acceptedPositions(exercise: Pick<ExerciseRow, 'acceptedAnswers'>): AcceptedAnswers {
  return exercise.acceptedAnswers;
}

/** The Accepted Variants of one Exercise, in the order they were confirmed. */
export function variantsOf(db: Db, exerciseId: number): string[] {
  return db.select().from(acceptedVariants)
    .where(eq(acceptedVariants.exerciseId, exerciseId)).all()
    .map((row) => row.value);
}

/**
 * What a Deterministic Check compares an answer against, position by position.
 *
 * The authored values first, so `matched` reports the Admin's canonical wording
 * where both would match — a Submission records what the Student was judged
 * against, and the authored answer is the better thing to record.
 */
export function acceptedAnswersFor(db: Db, exercise: ExerciseRow): AcceptedAnswers {
  return acceptedAnswers(exercise, variantsOf(db, exercise.id));
}

/**
 * The same lists from rows the caller already holds.
 *
 * Pure, so a screen that has both halves in hand does not go back to the
 * database to put them together — and so the order is decided in one place
 * rather than by whichever caller spread them.
 *
 * An Accepted Variant is recorded against the Exercise and carries no position,
 * so it joins every position — which is exactly what it does today, when there
 * is only ever one. #85 is where a Dispute says which gap its variant is for;
 * narrowing it here first would change what an existing Exercise accepts, and
 * this step changes nothing.
 */
export function acceptedAnswers(exercise: ExerciseRow, variants: readonly string[]): AcceptedAnswers {
  const positions = acceptedPositions(exercise);
  if (variants.length === 0) return positions;
  // A Grader-judged Exercise stores no positions, and a Dispute upheld on one
  // still records a variant. Dropping it would lose the only thing the screens
  // that read this have to show.
  if (positions.length === 0) return [[...variants]];
  return positions.map((values) => [...values, ...variants]);
}

/**
 * Everything that already counts as a right answer to this Exercise, the
 * Reference Answer included.
 *
 * A superset of the above, and deliberately a different question: the
 * Deterministic Check compares against what an Exercise *accepts*, while an
 * Admin about to add an Accepted Variant needs to know whether the answer is
 * already right by any route at all — and the Reference Answer is one of those
 * routes. Adding it as a variant would store the author's own answer twice.
 */
export function candidateAnswers(exercise: ExerciseRow, variants: readonly string[]): string[] {
  return [exercise.referenceAnswer, ...acceptedAnswers(exercise, variants).flat()];
}
