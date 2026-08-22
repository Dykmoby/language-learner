// What the browser and the routes agree on for a Test.
//
// Two shapes, and the difference between them is the whole of what a Test is: an
// Exercise being *worked* carries no Reference Answer and no accepted answers —
// the same rule the Practice keeps, because a right answer sitting in the page
// source is a right answer the Student can read — and an Exercise being
// *reviewed* carries everything, because the attempt is closed and the review is
// what the Test was for.

import type { ExerciseKind } from '../db/schema.ts';
import type { Verdict } from '../grader/contract.ts';
import type { ErrorView } from '../practice/wire.ts';
import type { AttemptState } from './score.ts';

export type { ErrorView };

/** An Exercise as the Student meets it: nothing here answers it. */
export type TestExerciseView = {
  exerciseId: number;
  position: number;
  kind: ExerciseKind;
  prompt: string;
  choices: string[];
};

/** One answer, as the browser sends the whole attempt at once. */
export type AttemptAnswer = {
  exerciseId: number;
  answer: string;
};

export type AttemptExerciseView = {
  exerciseId: number;
  position: number;
  kind: ExerciseKind;
  prompt: string;
  /** What the Student was offered, so a wrong option can be marked among them. */
  choices: string[];
  answer: string;
  /** 'awaiting_grading' and 'grading_failed' are not wrong answers and never render as one. */
  status: 'graded' | 'grading_failed' | 'awaiting_grading';
  verdict: Verdict | null;
  correct: boolean;
  feedbackRu: string | null;
  corrected: string | null;
  errors: ErrorView[];
  referenceAnswer: string;
  /** Deterministic Kinds only: every answer that would have been accepted. */
  acceptedAnswers: string[];
};

export type AttemptView = {
  attemptId: number;
  testId: number;
  testTitle: string;
  /** Which run at this Test it was — attempts are numbered per Student per Test. */
  attempt: number;
  submittedAt: number;
  state: AttemptState;
  passThreshold: number;
  correct: number;
  total: number;
  scorePercent: number | null;
  passed: boolean | null;
  exercises: AttemptExerciseView[];
};

/** One earlier run, as the Test screen lists them. */
export type AttemptSummary = {
  attemptId: number;
  attempt: number;
  submittedAt: number;
  state: AttemptState;
  correct: number;
  total: number;
  scorePercent: number | null;
  passed: boolean | null;
};
