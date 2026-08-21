// What in a Draft nobody has looked at since Claude wrote it.
//
// design.md § Authoring's rule — generated Drafts never publish unreviewed —
// with something behind it. Structurally the rule already holds: nothing
// publishes itself, and Publish is a deliberate second act. What was missing was
// any difference between a Draft an Admin wrote every word of and one Claude
// produced thirty seconds ago.
//
// **The validity rules cannot help here, and it is worth being precise about
// why.** A Reference Answer that is fluent, plausible and wrong passes every rule
// there is. Nothing in code can catch it. A person can, but only if they are told
// there is something to look at — and the Reference Answer is the specific thing
// that would poison grading, because the Grader receives it as the model answer
// on every single Submission made against that Exercise.
//
// So this is a question about two documents: the one about to be published, and
// the one Claude wrote that it descends from. That makes it a table rather than a
// browser.

import type { LessonDocument } from '../content/lesson-document.ts';
import { isBlank } from '../content/exercise-validity.ts';

/**
 * How many Exercises still carry a Reference Answer exactly as Claude wrote it.
 *
 * Matched by **value**, not by position or by id, and that is deliberate. An
 * Admin who reorders the Practice has reviewed nothing; an Admin who inserts an
 * Exercise by hand has not reviewed the others; an Admin who deletes one has
 * reviewed nothing about the rest. Every one of those moves would fool a
 * positional comparison, and each of them would fool it in the dangerous
 * direction — reporting work as reviewed that nobody read.
 *
 * A blank Reference Answer counts as nothing: it is refused at publish anyway,
 * and two absences matching is not evidence that anybody wrote either.
 *
 * The count can only ever be too high — an Admin who happens to retype a
 * Reference Answer character for character is counted as not having reviewed it.
 * That is the right direction to be wrong in: the cost is one confirmation, and
 * the cost of the other direction is a hallucinated answer reaching a Student.
 */
export function unreviewedReferenceAnswers(
  claudeWrote: LessonDocument,
  aboutToPublish: LessonDocument,
): number {
  const asWritten = new Set(
    claudeWrote.exercises
      .map((exercise) => exercise.referenceAnswer)
      .filter((answer) => !isBlank(answer)),
  );

  return aboutToPublish.exercises.filter(
    (exercise) => !isBlank(exercise.referenceAnswer) && asWritten.has(exercise.referenceAnswer),
  ).length;
}
