// What the browser and the route agree on.
//
// Newline-delimited JSON, not SSE. The objection to SSE is issue #18's, not
// design.md's: an event protocol, reconnection semantics and a text framing for
// one one-shot stream is machinery for nothing. A frame per line is the smallest
// thing that lets the explanation arrive progressively and the Verdict arrive
// whole. Errors never stream — a half-arrived error list is not information.
//
// Shared by both sides so the browser cannot drift from what the route sends.

import type { Verdict } from '../grader/contract.ts';

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

export type DeltaFrame = { t: 'delta'; text: string };

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

export function encodeFrame(frame: Frame): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Splits a growing buffer into whole frames, returning the remainder. A frame
 * that has not finished arriving is not a frame yet.
 */
export function takeFrames(buffer: string): { frames: Frame[]; rest: string } {
  const parts = buffer.split('\n');
  const rest = parts.pop() ?? '';
  const frames: Frame[] = [];
  for (const part of parts) {
    if (part.trim() === '') continue;
    frames.push(JSON.parse(part) as Frame);
  }
  return { frames, rest };
}
