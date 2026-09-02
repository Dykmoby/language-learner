'use client';

// A fill-gap answer as the sentence it is, with each Gap marked by how it was
// judged.
//
// Two screens show one: the Practice, in place of the inputs the moment a
// Verdict is in, and a Test's review beside «Ваш ответ». They differ only in
// their chrome — the Practice boxes each answer so the sentence does not shift
// when the inputs it replaces disappear — so the walk and the mark live here and
// the caller supplies the class its own screen wants. Written twice, the two
// would drift: the first pair already disagreed about what an unanswered Gap
// looks like.
//
// An unanswered Gap keeps its `___`, exactly as `fillGaps` writes it into the
// stored sentence. A sentence closed over one would read as an answer somebody
// gave.

import { Fragment } from 'react';
import { GAP, pieces } from '../../content/gaps.ts';
import { stateClass } from './verdict-state.ts';

export function AnsweredSentence({
  prompt, answers, gaps = [], gapClassName = '', mark: Mark = 'span',
}: {
  prompt: string;
  /** What was written at each Gap, in reading order. */
  answers: readonly string[];
  /**
   * Which of those Gaps were accepted. Empty where nothing has judged them yet,
   * which is how an answer shows before a Verdict arrives.
   */
  gaps?: readonly boolean[];
  /** The chrome the calling screen wants around each answered Gap. */
  gapClassName?: string;
  /** The element each answer sits in — `strong` where the sentence is prose. */
  mark?: 'span' | 'strong';
}) {
  const parts = pieces(prompt);

  return (
    <>
      {parts.map((part, at) => (
        <Fragment key={at}>
          {part}
          {at === parts.length - 1 ? null : (
            // A Deterministic Kind fails at exactly one token, so each Gap
            // carries its own state rather than the sentence carrying one.
            <Mark
              className={[gapClassName, gaps[at] === undefined ? '' : stateClass(gaps[at] ? 'correct' : 'incorrect')]
                .filter((name) => name !== '').join(' ') || undefined}
            >
              {answers[at]?.trim() || GAP}
            </Mark>
          )}
        </Fragment>
      ))}
    </>
  );
}
