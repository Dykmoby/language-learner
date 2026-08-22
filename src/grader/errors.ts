// One Submission's Errors, as rows.
//
// Rows rather than a JSON blob, and ordered: design.md § Progress and statistics
// aggregates over Error Type, and that is a query rather than a deserialisation
// loop. The order is the order the Grader found them in.
//
// It lives here rather than beside either of its callers because both the
// Practice and a Test write these, and two copies of "how an Error becomes a row"
// is how the histogram ends up with two shapes of data in it.

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { submissionErrors } from '../db/schema.ts';
import type { GraderError } from './contract.ts';

/** A database or a transaction on one — both write the same way. */
type Writer = BetterSQLite3Database<typeof schema>;

export function writeSubmissionErrors(
  tx: Writer,
  submissionId: number,
  errors: readonly GraderError[],
): void {
  errors.forEach((error, index) => {
    tx.insert(submissionErrors).values({
      submissionId,
      position: index + 1,
      type: error.type,
      span: error.span,
      explanationRu: error.explanation_ru,
    }).run();
  });
}

/**
 * Replaces whatever Errors a Submission carried.
 *
 * Only a Test's answers ever need this: a row exists before its judgement does,
 * and a batch that is graded again after failing must not leave the Errors of an
 * earlier run beside the new ones.
 */
export function replaceSubmissionErrors(
  tx: Writer,
  submissionId: number,
  errors: readonly GraderError[],
): void {
  tx.delete(submissionErrors).where(eq(submissionErrors.submissionId, submissionId)).run();
  writeSubmissionErrors(tx, submissionId, errors);
}
