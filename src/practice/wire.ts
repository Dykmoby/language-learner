// What the browser and the route agree on for a Submission.
//
// The framing itself — newline-delimited JSON, a delta frame per revealed piece,
// exactly one terminal frame — lives in ../wire/ndjson.ts and is shared with the
// editor's Generation stream. What is here is this stream's cargo: Errors never
// stream, because a half-arrived error list is not information.
//
// Shared by both sides so the browser cannot drift from what the route sends.

import type { Verdict } from '../grader/contract.ts';
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

export type Frame = DeltaFrame | ResultFrame;

/** The shared splitter, bound to this stream's frames so the browser gets types. */
export function takeFrames(buffer: string): { frames: Frame[]; rest: string } {
  return takeAnyFrames<Frame>(buffer);
}
