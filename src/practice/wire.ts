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

export type ResultFrame = {
  t: 'result';
  status: 'graded' | 'grading_failed';
  /** Null on a failed grading: there was no judgement, and none may be implied. */
  verdict: Verdict | null;
  feedbackRu: string | null;
  corrected: string | null;
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
