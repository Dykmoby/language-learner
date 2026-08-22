// The progress bar, drawn from the states the derivation reported.
//
// Shared by the Practice, which shows the Lesson being worked, and by the
// progress screen, which shows every Lesson at once. One component because the
// segment classes *are* the state names — so a state added to the derivation and
// not to the stylesheet renders as the neutral default on both screens rather
// than as the right colour on one and a wrong colour on the other.
//
// Completed With Help is its own segment, not folded in with unaided completions
// and not left out; a disputed one is neither a pass nor a fail. The segments
// differ in pattern as well as in colour, so both distinctions survive either
// theme.

import { ru } from '../../ru.ts';
import type { ExerciseState } from '../../practice/progress.ts';

export type Segment = { position: number; state: ExerciseState };

export function ProgressBar({ segments }: { segments: readonly Segment[] }) {
  if (segments.length === 0) return null;
  return (
    <ol className="progress" aria-label={ru.practice.title}>
      {segments.map((segment) => (
        <li key={segment.position} className={`segment ${segment.state}`} title={String(segment.position)} />
      ))}
    </ol>
  );
}
