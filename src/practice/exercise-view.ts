// Reading one Exercise of a Practice, whichever one the Student asked for.
//
// Issue #95 opened the Practice up: any Exercise can be opened, finished or not,
// reached or not. What that costs is this module — the Practice used to need no
// read of its own, because the only Exercise anybody could be on was the one the
// page derived on the way in.
//
// It stays one Exercise on the wire. The browser asks for a position and is
// handed that Exercise with what the Student last did to it; the Exercises
// either side of it are a state in the progress bar and nothing more. In
// particular a Reference Answer still only reaches a Student who has finished
// the Exercise or revealed it, which is the rule that made the Practice fetch
// one at a time in the first place.

import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { submissionErrors, type ExerciseRow, type SubmissionRow } from '../db/schema.ts';
import { acceptedAnswersFor } from '../content/accepted.ts';
import { checkGaps } from './deterministic-check.ts';
import { storedGaps } from './judgement.ts';
import { openLesson, submissionsFor, type LessonRefusal } from './lessons.ts';
import type { ExerciseProgress } from './progress.ts';
import { correctedForStudent, errorsForStudent } from './submit.ts';
import type { ErrorView, ExerciseView, PracticeView, ResultFrame } from './wire.ts';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Which Exercise is being asked for: one by its place in the Set, or whichever
 * one the Student is on.
 *
 * 'current' is a request rather than a number because the browser must not be
 * the thing that decides where "current" is — that is derived from Submissions,
 * and a second copy of the derivation in the browser is the drift this
 * application has avoided everywhere else.
 */
export type At = number | 'current';

export function parseAt(raw: string): At | null {
  if (raw === 'current') return 'current';
  const position = Number(raw);
  return Number.isInteger(position) && position > 0 ? position : null;
}

/** Which gaps held, recomputed rather than stored — there is no column for it. */
function gapsOf(db: Db, exercise: ExerciseRow, row: SubmissionRow): boolean[] {
  if (exercise.kind !== 'fill_gap') return [];
  const outcome = checkGaps(storedGaps(row), acceptedAnswersFor(db, exercise), {
    caseSensitive: exercise.caseSensitive,
  });
  return outcome.gaps.map((gap) => gap.correct);
}

function errorsOf(db: Db, submissionId: number): ErrorView[] {
  return db.select().from(submissionErrors)
    .where(eq(submissionErrors.submissionId, submissionId))
    .orderBy(asc(submissionErrors.position))
    .all()
    .map((row) => ({ type: row.type, span: row.span, explanationRu: row.explanationRu }));
}

/**
 * The last judged answer, as the frame the screen already draws.
 *
 * Withheld exactly as it was when it arrived live: the correction until Reveal
 * is offered (issue #81), the Errors until the second failed attempt (issue
 * #97). Reading an old Verdict back must not be a way around either — otherwise
 * «open the next Exercise and come back» is the hint nobody meant to write.
 */
function pastFrame(
  db: Db,
  exercise: ExerciseRow,
  progress: ExerciseProgress,
  rows: readonly SubmissionRow[],
): ResultFrame | null {
  const judged = rows.filter((row) => row.status === 'graded').at(-1);
  if (judged === undefined) return null;

  return {
    t: 'result',
    status: 'graded',
    submissionId: judged.id,
    verdict: judged.guardedVerdict,
    failure: null,
    feedbackRu: judged.feedbackRu,
    corrected: correctedForStudent(judged.corrected, judged.guardedVerdict, progress.revealOffered),
    gaps: gapsOf(db, exercise, judged),
    errors: errorsForStudent(errorsOf(db, judged.id), judged.guardedVerdict, progress.failedAttempts),
    progression: {
      // Nothing moved: this is a Verdict being read, not one being reached.
      advanced: false,
      nextExerciseId: null,
      lessonComplete: false,
      failedAttempts: progress.failedAttempts,
      revealOffered: progress.revealOffered,
    },
  };
}

/**
 * One Exercise of one Practice, with the Student's standing in the whole of it.
 *
 * The segments come back on every read rather than only on the first, because
 * answering changes them and moving between Exercises is how a Student sees that
 * it did.
 */
export function practiceView(
  db: Db,
  studentId: number,
  lessonId: number,
  at: At,
): ({ ok: true } & { view: PracticeView }) | LessonRefusal {
  const opened = openLesson(db, studentId, lessonId);
  if (!opened.ok) return opened;

  const { progress, exercises } = opened;
  const segments = progress.exercises.map((own) => ({ position: own.position, state: own.state }));
  const standing = { segments, counts: progress.counts, complete: progress.complete };

  if (progress.exercises.length === 0) {
    return { ok: true, view: { ...standing, exercise: null } };
  }

  // A finished Practice has no current Exercise, and asking for one is how the
  // screen arrives at a Lesson that is already done. It opens at the first
  // Exercise rather than refusing: there is nothing left to work on and
  // everything left to re-read.
  const wanted = at === 'current'
    ? progress.exercises.find((own) => own.state === 'current')?.position
      ?? progress.exercises[0]!.position
    : at;

  const own = progress.exercises.find((entry) => entry.position === wanted);
  const row = exercises.find((exercise) => exercise.id === own?.exerciseId);
  if (own === undefined || row === undefined) return { ok: false, reason: 'not_found' };

  const rows = submissionsFor(db, studentId, row.id);
  const revealedRow = rows.find((submission) => submission.status === 'revealed');
  const lastJudged = rows.filter((submission) => submission.status === 'graded').at(-1);

  const exercise: ExerciseView = {
    id: row.id,
    position: row.position,
    kind: row.kind,
    prompt: row.prompt,
    choices: row.choices,
    state: own.state,
    revealOffered: own.revealOffered,
    past: pastFrame(db, row, own, rows),
    // The last judged answer's own values, so a finished Exercise shows what was
    // written in it rather than an empty sentence.
    pastAnswers: lastJudged === undefined ? [] : storedGaps(lastJudged),
    // The Reference Answer, and only here: a Reveal is the Student having asked
    // for it, which is the one thing that puts it on this wire.
    revealed: revealedRow === undefined ? null : {
      referenceAnswer: revealedRow.corrected ?? row.referenceAnswer,
      progression: {
        advanced: false,
        nextExerciseId: null,
        lessonComplete: progress.complete,
        failedAttempts: own.failedAttempts,
        revealOffered: own.revealOffered,
      },
    },
    disputed: own.dispute !== null,
  };

  return { ok: true, view: { ...standing, exercise } };
}
