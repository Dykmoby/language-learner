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

import { asc, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { acceptedVariants, type ExerciseRow } from '../db/schema.ts';
import type { AcceptedAnswers } from './exercise-validity.ts';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * An Accepted Variant as it is stored: a value, and the Gap it was confirmed for.
 *
 * `gap` is null where there is no position to name — every Kind with one place
 * to answer — and on every variant written before a fill-gap could have more
 * than one Gap. A variant with no position joins every Gap, which is what all of
 * them did before #85.
 *
 * The value and its position travel together everywhere, deliberately: a
 * `string[]` of values and a `number[]` of positions is two lists that can end up
 * different lengths, and the failure would be a teacher-confirmed answer landing
 * at a Gap no teacher chose.
 */
export type Variant = { value: string; gap: number | null };

/**
 * What an Exercise accepts, one list per Gap — the single read of the stored
 * column.
 *
 * One line, and worth keeping as a name rather than inlining: it is what makes
 * the shape of the column a thing this module owns, so the next change to it is
 * one function rather than every screen that shows an answer.
 */
export function acceptedGaps(exercise: Pick<ExerciseRow, 'acceptedAnswers'>): AcceptedAnswers {
  return exercise.acceptedAnswers;
}

/** The Accepted Variants of one Exercise, in the order they were confirmed. */
export function variantsOf(db: Db, exerciseId: number): Variant[] {
  return db.select().from(acceptedVariants)
    .where(eq(acceptedVariants.exerciseId, exerciseId))
    .orderBy(asc(acceptedVariants.id)).all()
    .map((row) => ({ value: row.value, gap: row.gap }));
}

/**
 * The values alone, for the one reader that has no Gaps to place them at: the
 * Grader, which judges a whole answer and is given its Accepted Variants as
 * teacher-confirmed context.
 *
 * Only Grader-judged Kinds reach it, and those store no position anyway — but it
 * is written as a flatten rather than assumed, so a positioned variant that
 * somehow reached a Grader call is still offered rather than silently dropped.
 */
export function variantValues(variants: readonly Variant[]): string[] {
  return variants.map((variant) => variant.value);
}

/**
 * The same, for a whole screenful of Exercises at once.
 *
 * A Test's review shows every Exercise of an attempt and marks each Gap of each
 * one, and the screen is re-fetched every four seconds while a batch is out.
 * Asking per row turns that into one query per Exercise on every poll; this is
 * the same answer in one. Exercises with no variants are absent from the map,
 * which is what an empty list means anyway.
 */
export function variantsOfMany(db: Db, exerciseIds: readonly number[]): Map<number, Variant[]> {
  const byExercise = new Map<number, Variant[]>();
  if (exerciseIds.length === 0) return byExercise;

  for (const row of db.select().from(acceptedVariants)
    .where(inArray(acceptedVariants.exerciseId, [...exerciseIds]))
    .orderBy(asc(acceptedVariants.id)).all()) {
    const variant: Variant = { value: row.value, gap: row.gap };
    const found = byExercise.get(row.exerciseId);
    if (found) found.push(variant);
    else byExercise.set(row.exerciseId, [variant]);
  }
  return byExercise;
}

/**
 * What a Deterministic Check compares an answer against, Gap by Gap.
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
 * **A variant is accepted at its own Gap and nowhere else** — #85. A word an
 * Admin confirmed for the second Gap of «___ have ___ apple» must not start
 * being accepted in the first, which would have the Exercise marking as correct
 * an answer that puts the words in the wrong places: teaching the mistake.
 *
 * A variant with no position still joins every Gap. That is every Kind with one
 * place to answer, where there is no position to name, and every variant written
 * before there was a column to hold one — narrowing those to a Gap nobody chose
 * would change what an existing Exercise accepts.
 */
export function acceptedAnswers(exercise: ExerciseRow, variants: readonly Variant[]): AcceptedAnswers {
  const gaps = acceptedGaps(exercise);
  if (variants.length === 0) return gaps;
  // A Grader-judged Exercise stores no Gaps, and a Dispute upheld on one still
  // records a variant. Dropping it would lose the only thing the screens that
  // read this have to show.
  if (gaps.length === 0) return [variantValues(variants)];
  return gaps.map((values, at) => [
    ...values,
    ...variantValues(variants.filter((variant) => variant.gap === null || variant.gap === at)),
  ]);
}

/**
 * Everything that already counts as a right answer at one Gap of this Exercise,
 * the Reference Answer included.
 *
 * A superset of one entry of the above, and deliberately a different question:
 * the Deterministic Check compares against what an Exercise *accepts*, while an
 * Admin about to add an Accepted Variant needs to know whether the answer is
 * already right by any route at all — and the Reference Answer is one of those
 * routes. Adding it as a variant would store the author's own answer twice.
 *
 * Asked of one Gap, because that is the question a Dispute now answers. `null`
 * asks it of every Gap at once, which is what a Kind with one place to answer
 * means by "this Exercise".
 */
export function candidateAnswers(
  exercise: ExerciseRow,
  variants: readonly Variant[],
  gap: number | null = null,
): string[] {
  const accepted = acceptedAnswers(exercise, variants);
  const values = gap === null ? accepted.flat() : accepted[gap] ?? [];
  return [exercise.referenceAnswer, ...values];
}
