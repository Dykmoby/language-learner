// What the browser and the route agree on for a Submission.
//
// The framing itself — newline-delimited JSON, a delta frame per revealed piece,
// exactly one terminal frame — lives in ../wire/ndjson.ts and is shared with the
// editor's Generation stream. What is here is this stream's cargo: Errors never
// stream, because a half-arrived error list is not information.
//
// Shared by both sides so the browser cannot drift from what the route sends.

import type { ExerciseKind } from '../db/schema.ts';
import type { Verdict } from '../grader/contract.ts';
import type { ExerciseState } from './progress.ts';
import { takeFrames as takeAnyFrames, type DeltaFrame } from '../wire/ndjson.ts';

export { encodeFrame } from '../wire/ndjson.ts';
export type { DeltaFrame } from '../wire/ndjson.ts';

export type ErrorView = {
  /** The stable enum string. The Russian label is resolved at display time. */
  type: string;
  span: string;
  explanationRu: string;
};

/** Progression, recomputed from Submissions after this one landed. */
export type ProgressionView = {
  advanced: boolean;
  nextExerciseId: number | null;
  lessonComplete: boolean;
  /** Attempts that count against the Student — a failed grading is not one. */
  failedAttempts: number;
  revealOffered: boolean;
};

/**
 * Which of the two things a failed grading is, in the only terms a Student can
 * act on: the Проверяющий is busy and will answer shortly, or something is
 * wrong and retrying now is as likely to fail again.
 *
 * Deliberately not the Grader's failure kind. 'timeout' and 'contract' and 'sdk'
 * are facts about this application, and none of them changes what the Student
 * should do next — which is the only question the screen is answering.
 */
export type FailureShape = 'busy' | 'broken';

export type ResultFrame = {
  t: 'result';
  status: 'graded' | 'grading_failed';
  /**
   * The row this judgement was written to, so the Student can object to it — a
   * Dispute is against a Verdict on a Submission, and nothing else on this frame
   * identifies which one.
   *
   * Null on a failure that could not be persisted at all. A failed grading was
   * never judged and is not disputable either way, so nothing is lost by it.
   */
  submissionId: number | null;
  /** Null on a failed grading: there was no judgement, and none may be implied. */
  verdict: Verdict | null;
  /** Why nothing was judged. Null on a graded frame, where nothing failed. */
  failure: FailureShape | null;
  feedbackRu: string | null;
  corrected: string | null;
  /**
   * Which gaps were accepted, in reading order — a Deterministic Check Kind only,
   * and empty on everything the Grader judges.
   *
   * A partly right answer has to say *which* part, or the next attempt is a
   * re-guess of all of them. The Verdict alone cannot: `partially_correct` says
   * that some gap held without saying which.
   */
  gaps: boolean[];
  errors: ErrorView[];
  progression: ProgressionView;
};

/**
 * Reveal answers in one piece, so it is a plain JSON body rather than a frame —
 * it never travels on the stream and is deliberately not part of `Frame`.
 */
export type RevealResult = {
  referenceAnswer: string;
  progression: ProgressionView;
};

/**
 * One Exercise as the Practice shows it — issue #95.
 *
 * The Practice used to hand the browser the current Exercise and nothing else,
 * because the current Exercise was the only one a Student could be on. Now that
 * any of them can be opened, the browser asks for one at a time by position and
 * is handed this: the Exercise, where the Student stands on it, and whatever
 * they last did with it.
 *
 * Still one Exercise on the wire. What is *not* here is the point: no Reference
 * Answer on an Exercise that has not been finished, and nothing at all about the
 * Exercises either side of it.
 */
export type ExerciseView = {
  id: number;
  position: number;
  kind: ExerciseKind;
  prompt: string;
  choices: string[];
  state: ExerciseState;
  revealOffered: boolean;
  /**
   * The last judged answer, in the shape the screen already draws a judgement
   * in. Null where this Exercise has never been answered.
   *
   * The same frame the submit stream ends with, deliberately: a Verdict read
   * back an hour later has to look like the one that arrived live, and two
   * shapes for it is how the two come to disagree. It is withheld the same way
   * too — the correction until the third failed attempt, the Errors until the
   * second.
   */
  past: ResultFrame | null;
  /**
   * What the Student wrote at each gap last time, in reading order — a list of
   * one on every Kind with a single place to answer, and empty where this
   * Exercise has never been answered.
   *
   * Beside the frame rather than inside it because a Verdict is about an answer
   * without carrying one: the live stream never needed this, since the browser
   * still had what it had just sent.
   */
  pastAnswers: string[];
  /** What Reveal showed, where the Student asked for it. */
  revealed: RevealResult | null;
  /** An objection stands against this Exercise, ruled on or not. */
  disputed: boolean;
};

/** Where the Student stands in the whole Practice, and the Exercise they are on. */
export type PracticeView = {
  /** Every Exercise's state, in order — the progress bar and the way to each. */
  segments: { position: number; state: ExerciseState }[];
  counts: { completed: number; completedWithHelp: number; disputed: number; total: number };
  /** Null only where the Practice has no Exercises at all. */
  exercise: ExerciseView | null;
  /** Nothing is left to work on. Not the same as "every answer was right". */
  complete: boolean;
};

export type Frame = DeltaFrame | ResultFrame;

/** The shared splitter, bound to this stream's frames so the browser gets types. */
export function takeFrames(buffer: string): { frames: Frame[]; rest: string } {
  return takeAnyFrames<Frame>(buffer);
}
