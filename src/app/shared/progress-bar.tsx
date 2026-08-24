// The progress bar, drawn from the states the derivation reported.
//
// Shared by the Practice, which shows the Lesson being worked, and by the
// progress screen, which shows every Lesson at once. One component, and now one
// state system underneath it: a segment asks `verdict-state` what class carries
// its state and gets the same hue and the same rail the Practice and the Test
// review are using for the same fact.
//
// A segment is eight pixels tall, which is exactly why the rails are patterns
// rather than plain fills — at this size a solid green bar and a solid teal one
// are the same bar. It is also why each one carries its words as an accessible
// name: the wording is the third distinction, and on a bar it was the one that
// was missing entirely.

import { ru } from '../../ru.ts';
import type { ExerciseState } from '../../practice/progress.ts';
import { stateClass, stateOfExercise, stateWords } from './verdict-state.ts';

export type Segment = { position: number; state: ExerciseState };

export function ProgressBar({ segments }: { segments: readonly Segment[] }) {
  if (segments.length === 0) return null;
  return (
    <ol className="progress" aria-label={ru.practice.title}>
      {segments.map((segment) => {
        const state = stateOfExercise(segment.state);
        // `current` and `not_reached` are not judgements — one is where the
        // Student is, the other is where they have not been — so neither takes a
        // state's hue. The bar keeps its own neutral treatment for both.
        const marker = state === null ? segment.state : stateClass(state);
        const words = state === null ? null : stateWords(state);
        return (
          <li
            key={segment.position}
            className={`segment ${marker}`}
            title={words === null
              ? ru.practice.position(segment.position, segments.length)
              : `${ru.practice.position(segment.position, segments.length)} — ${words}`}
          />
        );
      })}
    </ol>
  );
}
