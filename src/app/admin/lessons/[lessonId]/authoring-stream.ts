'use client';

// Reading an authoring stream, for both callers of it.
//
// Generation and Refinement differ in what they send and in what they do with a
// Lesson that comes back. They do not differ in anything below: the same wire,
// the same delta frames, the same terminal frame, and — most of all — the same
// discipline about failure.
//
//   **A failure never looks like content.** What streams in is held here and
//   handed to nobody. Only the terminal frame's document reaches the caller, and
//   only when it says `ok`. There is no path by which half a Lesson becomes a
//   Draft or reaches the editor.
//
// Writing that twice is how the two paths come to disagree about it.

import { useRef, useState } from 'react';
import type { DocumentFault } from '../../../../content/lesson-document.ts';
import { takeFrames, type AuthoringResultFrame } from '../../../../authoring/wire.ts';

type Succeeded = Extract<AuthoringResultFrame, { ok: true }>;

/**
 * What this caller calls a failure, in its own words.
 *
 * Passed in rather than read from one caller's corner of the dictionary. The two
 * callers fail identically and must report identically *in shape*, but they are
 * different acts — CONTEXT.md keeps Generation and Refinement apart as terms —
 * and telling an Admin whose доработка timed out that the генерация failed names
 * the wrong act.
 */
export type FailureWords = {
  failed: string;
  timedOut: string;
  cancelled: string;
  refusedInvalid: string;
};

export type AuthoringStream = {
  running: boolean;
  /** The Theory as it is being written. Never the editor's content. */
  theory: string;
  problem: string | null;
  faults: DocumentFault[];
  /** Runs one call. Resolves when the stream ends, whatever it ended as. */
  start: (path: string, body: unknown, onLesson: (frame: Succeeded) => void) => Promise<void>;
  /** Abandons the call in flight. Nothing has been written, so nothing is undone. */
  cancel: () => void;
  clear: () => void;
};

export function useAuthoringStream(words: FailureWords): AuthoringStream {
  const [running, setRunning] = useState(false);
  const [theory, setTheory] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [faults, setFaults] = useState<DocumentFault[]>([]);

  // Aborting the fetch is what tells the server nobody wants this Lesson any
  // more. Held in a ref rather than in state because pressing «Отменить» must not
  // wait for a render to take effect.
  const abort = useRef<AbortController | null>(null);

  function clear() {
    setTheory('');
    setProblem(null);
    setFaults([]);
  }

  function report(frame: Extract<AuthoringResultFrame, { ok: false }>) {
    setFaults(frame.faults);
    setProblem(
      frame.reason === 'invalid' ? words.refusedInvalid
        : frame.detail === 'timeout' ? words.timedOut
        : frame.detail === 'aborted' ? words.cancelled
        : words.failed,
    );
  }

  async function start(path: string, body: unknown, onLesson: (frame: Succeeded) => void): Promise<void> {
    setRunning(true);
    clear();

    const controller = new AbortController();
    abort.current = controller;

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      if (!response.ok || !response.body) {
        // A refused request comes back as faults an Admin can read; anything
        // else is a failure and must not be reported as if the form were wrong.
        const refused = await response.json().catch(() => null) as { faults?: DocumentFault[] } | null;
        setFaults(refused?.faults ?? []);
        setProblem(words.failed);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let written = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = takeFrames(buffer);
        buffer = rest;

        for (const frame of frames) {
          if (frame.t === 'delta') {
            written += frame.text;
            setTheory(written);
          } else if (frame.ok) {
            onLesson(frame);
          } else {
            report(frame);
          }
        }
      }
    } catch (error) {
      // An abort is the Admin's own doing, and saying «не удалось» about it would
      // report a failure where there was a decision.
      setProblem((error as Error)?.name === 'AbortError' ? words.cancelled : words.failed);
    } finally {
      abort.current = null;
      setRunning(false);
    }
  }

  return {
    running, theory, problem, faults, start, clear,
    cancel: () => abort.current?.abort(),
  };
}
