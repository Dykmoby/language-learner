// Asking for an Explanation — issue #94.
//
// One endpoint for both places a Verdict is reached, for the same reason a
// Dispute has one: a Test's answers are Submissions (ADR 0005), so what is being
// explained is a Submission rather than the screen it was made from.
//
// Every Kind this answers for is judged by a Deterministic Check, which is
// exactly why it exists. A Grader-judged answer already comes back with the
// Grader's own explanation; a wrong multiple choice comes back with the word
// «Неверно» and nothing else, and re-guessing is the only move a Student has
// from there. An Explanation is the missing sentence, and it is asked for rather
// than given — a Student who wants to try again first should be able to.
//
// It writes nothing. There is no row, no attempt, no progression: what is asked
// for here cannot make an Exercise more or less finished than it already was.
// The Explanation lives on the screen it was streamed to and nowhere else.

import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import {
  courses, exercises, exerciseSets, lessons, submissions, tests, isDeterministic,
} from '../db/schema.ts';
import { courseIdOf } from '../content/ownership.ts';
import type { Language } from '../grader/contract.ts';
import { explain, type ExplanationHandle } from '../explain/explain.ts';

type Db = BetterSQLite3Database<typeof schema>;

export type ExplanationRefusal = {
  ok: false;
  reason: 'not_found' | 'not_judged' | 'not_wrong' | 'explained_already';
};

/**
 * The Explanation for one Submission, refused for four reasons.
 *
 * - Someone else's answer is not theirs to ask about, and is missing rather than
 *   forbidden — the same answer the rest of the application gives.
 * - Only a judged answer can be explained. A failed grading was never judged and
 *   a Reveal was never an answer.
 * - A correct answer has nothing to explain, and explaining one would mean
 *   writing a paragraph about why a right answer is wrong.
 * - A Grader-judged Kind is refused as already explained: its Verdict arrived
 *   with `feedback_ru` beside it, and a second explanation of the same answer by
 *   the same model is one more paragraph saying the same thing.
 */
export function explainSubmission(
  db: Db,
  studentId: number,
  submissionId: number,
): ({ ok: true } & ExplanationHandle) | ExplanationRefusal {
  const found = db.select({
    submission: submissions,
    exercise: exercises,
    lessonTitle: lessons.title,
    grammarFocus: lessons.grammarFocus,
    lessonCourseId: lessons.courseId,
    testCourseId: tests.courseId,
  })
    .from(submissions)
    .innerJoin(exercises, eq(exercises.id, submissions.exerciseId))
    .innerJoin(exerciseSets, eq(exerciseSets.id, exercises.exerciseSetId))
    // Both joins, and neither redundant — an Exercise Set is owned by exactly
    // one of a Lesson's Practice and a Test (content/ownership.ts).
    .leftJoin(lessons, eq(lessons.id, exerciseSets.lessonId))
    .leftJoin(tests, eq(tests.id, exerciseSets.testId))
    .where(eq(submissions.id, submissionId))
    .get();

  if (!found || found.submission.studentId !== studentId) return { ok: false, reason: 'not_found' };
  if (found.submission.status !== 'graded') return { ok: false, reason: 'not_judged' };
  if (found.submission.guardedVerdict === 'correct') return { ok: false, reason: 'not_wrong' };
  if (!isDeterministic(found.exercise.kind)) return { ok: false, reason: 'explained_already' };

  const courseId = courseIdOf(found.lessonCourseId, found.testCourseId);
  const course = db.select().from(courses).where(eq(courses.id, courseId)).get();
  if (!course) return { ok: false, reason: 'not_found' };

  return {
    ok: true,
    ...explain({
      // The Course's, both of them: the model that judged this answer is the one
      // that explains it, and at the Course's own Effort (ADR 0002, ADR 0007).
      model: course.graderModel,
      effort: course.graderEffort,
      context: {
        language: course.language as Language,
        level: course.level,
        // Null on a Test, which belongs to the Course rather than to a Lesson.
        lessonTitle: found.lessonTitle,
        grammarFocus: found.grammarFocus,
        kind: found.exercise.kind,
        prompt: found.exercise.prompt,
        choices: found.exercise.choices,
        // The stored answer, which on a fill-gap is the sentence with the gaps
        // filled in rather than the values on their own — what the Student wrote,
        // as they wrote it.
        answer: found.submission.answer,
        referenceAnswer: found.exercise.referenceAnswer,
      },
    }),
  };
}
