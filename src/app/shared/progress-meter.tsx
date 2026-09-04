// A Lesson's standing as one bar rather than as one mark per Exercise.
//
// The segmented bar beside it (`progress-bar.tsx`) draws an Exercise at a time,
// which is the right picture in the Practice — the Student is *at* one of those
// segments, and which one is the whole question. In a Course listing it is the
// wrong picture twice over: nobody is asking about Exercise 14 of a Lesson they
// have not opened, and at the width a list row can spare, twenty-five segments
// are twenty-five one-pixel lines. The picture collapsed into a texture.
//
// So the same three facts are drawn as proportions of one track: how much was
// finished unaided, how much with help, how much is under objection. Solid
// fills — the rails are patterns because a segment is too small to hold a wash,
// and a proportion is not too small to hold anything. There is no `current` and
// no `not_reached` here on purpose: this bar says how much, and the bar that
// says where is the one in the Practice.
//
// The wording is carried as the bar's accessible name, which is the third of the
// three distinctions the state system insists on, and the one a bar of any kind
// is otherwise missing.

import { ru } from '../../ru.ts';
import { stateClass, type VerdictState } from './verdict-state.ts';

export type Standing = {
  completed: number;
  completedWithHelp: number;
  disputed: number;
  total: number;
};

/**
 * The three filled parts, in the order they are laid down.
 *
 * Unaided completions first, deliberately: a Student reads a bar from its left
 * edge, and the first thing it should say is how much of this they did
 * themselves. Then the help, then the unsettled — which puts them in descending
 * order of "this is behind you", so the bar degrades left to right.
 */
const PARTS: Array<{ state: VerdictState; of: (standing: Standing) => number }> = [
  { state: 'correct', of: (s) => s.completed },
  { state: 'help', of: (s) => s.completedWithHelp },
  { state: 'disputed', of: (s) => s.disputed },
];

export function ProgressMeter({ standing }: { standing: Standing }) {
  // A Practice with no Exercises has no standing to draw. Nothing rather than an
  // empty track: a track drawn at 0% says the Student has done none of the work,
  // and there is none to do.
  if (standing.total === 0) return null;

  const label = [
    ru.progress.breakdown(standing.completed, standing.completedWithHelp, standing.total),
    standing.disputed > 0 ? ru.practice.disputedCount(standing.disputed) : null,
  ].filter((part) => part !== null).join(' · ');

  return (
    <span className="meter" role="img" aria-label={label} title={label}>
      {PARTS.map(({ state, of }) => {
        const count = of(standing);
        if (count === 0) return null;
        return (
          <span
            key={state}
            className={`fill ${stateClass(state)}`}
            style={{ width: `${(count / standing.total) * 100}%` }}
          />
        );
      })}
    </span>
  );
}
