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
//
// In the Practice the bar is also the way to each Exercise (issue #95). That is
// what `onSelect` turns on, and it is optional because the progress screen shows
// a bar per Lesson with nothing to open: a segment that does nothing must not be
// a button, or every Lesson on that screen grows twenty-five tab stops.

import { ru } from '../../ru.ts';
import type { ExerciseState } from '../../practice/progress.ts';
import { stateClass, stateOfExercise, stateWords } from './verdict-state.ts';

export type Segment = { position: number; state: ExerciseState };

export function ProgressBar({ segments, at, onSelect }: {
  segments: readonly Segment[];
  /** Which Exercise is open, marked as the current place in the bar. */
  at?: number;
  /** Given in the Practice, where a segment is the way to its Exercise. */
  onSelect?: (position: number) => void;
}) {
  if (segments.length === 0) return null;
  return (
    <ol className={onSelect === undefined ? 'progress' : 'progress selectable'} aria-label={ru.practice.title}>
      {segments.map((segment) => {
        const state = stateOfExercise(segment.state);
        // `current` and `not_reached` are not judgements — one is where the
        // Student is, the other is where they have not been — so neither takes a
        // state's hue. The bar keeps its own neutral treatment for both.
        const marker = state === null ? segment.state : stateClass(state);
        const words = state === null ? null : stateWords(state);
        const position = ru.practice.position(segment.position, segments.length);
        const label = words === null ? position : `${position} — ${words}`;
        const open = at === segment.position;

        return (
          <li key={segment.position} className={`segment ${marker}${open ? ' open' : ''}`}>
            {onSelect === undefined ? (
              // A segment has no text of its own to read, so the words are given
              // as its name rather than only as a tooltip — `title` alone is a
              // hover, and the third distinction has to hold for somebody who is
              // not using a mouse.
              <span aria-label={label} title={label} />
            ) : (
              <button
                type="button"
                aria-label={label}
                title={label}
                // Which Exercise is open is a fact about this bar, and the one a
                // screen reader has no other way to reach: every segment
                // otherwise reads the same whether it is being worked or not.
                aria-current={open ? 'step' : undefined}
                onClick={() => onSelect(segment.position)}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
