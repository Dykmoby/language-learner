'use client';

// The Exercise as the Student meets it: the prompt and the way it is answered,
// together.
//
// One component for both places a Student answers one — a Lesson's Practice and
// a Test — because an Exercise is met the same way in either, and two renderings
// of a word order would eventually disagree about what a fragment is. Every
// branch on Exercise Kind lives here and nowhere else: whatever asks the question
// receives one value per gap.
//
// The prompt and the input are one component because for a fill-gap they are one
// sentence — the gaps belong in the text, not on a line of their own underneath
// it. A prompt with three gaps is three inputs sitting where the gaps sit, filled
// left to right in the order the sentence is read; where they are is decided by
// ../../content/gaps.ts, which is the same module the validity rules count them
// with, so the number of inputs on the screen can never disagree with the number
// of accepted answer lists behind them.

import { Fragment, useState } from 'react';
import { ru } from '../../ru.ts';
import type { ExerciseKind } from '../../db/schema.ts';
import { pieces } from '../../content/gaps.ts';
import { AnsweredSentence } from './answered-sentence.tsx';

export type AskedExercise = {
  /** What makes this Exercise's radio group its own when several are on a page. */
  id: number;
  kind: ExerciseKind;
  prompt: string;
  choices: string[];
};

// Composition, translation and open writing are answered in prose; the Kinds
// judged in code are answered by choosing or arranging.
const WRITTEN_KINDS: ExerciseKind[] = ['composition', 'translation', 'open_writing'];

export function ExerciseQuestion({
  exercise, answers, onAnswer, disabled, answered, gaps = [],
}: {
  exercise: AskedExercise;
  /** One value per gap, in reading order — a list of one where there is one gap. */
  answers: string[];
  onAnswer: (values: string[]) => void;
  disabled: boolean;
  /** The answer is in and being judged or explained: show it, do not ask again. */
  answered: boolean;
  /**
   * Which gaps were accepted, once something has judged them. Empty until then,
   * and empty on everything the Grader judges.
   *
   * Three Gaps are three facts, and «неверно» without saying which of them makes
   * the next attempt a re-guess of all three.
   */
  gaps?: readonly boolean[];
}) {
  // Positions in `choices` rather than the words themselves. Two identical
  // fragments in one sentence are two fragments, and telling them apart by value
  // means guessing which of the two was taken.
  const [fragments, setFragments] = useState<number[]>([]);

  const answer = answers[0] ?? '';

  function useFragments(next: number[]) {
    setFragments(next);
    // Word order is answered as a sentence like any other: the fragments are how
    // it is built, not what is submitted.
    onAnswer([next.map((at) => exercise.choices[at] ?? '').join(' ')]);
  }

  if (exercise.kind === 'fill_gap') {
    // The prompt carries its Gaps as ___, so N Gaps split it into N + 1 pieces
    // and an input goes between each neighbouring pair.
    const parts = pieces(exercise.prompt);

    // Once judged, the inputs give way to the answers that were in them, marked
    // Gap by Gap: a partly right answer says which part it was, so the second
    // attempt is about the Gap that was wrong rather than all of them. Boxed, so
    // the sentence does not shift as the inputs it replaces disappear.
    if (answered) {
      return (
        <p className="prompt">
          <AnsweredSentence
            prompt={exercise.prompt}
            answers={answers}
            gaps={gaps}
            gapClassName="given inline"
          />
        </p>
      );
    }

    return (
      <p className="prompt">
        {parts.map((part, at) => (
          <Fragment key={at}>
            {part}
            {at === parts.length - 1 ? null : (
              <input
                type="text"
                className="gap"
                value={answers[at] ?? ''}
                disabled={disabled}
                autoComplete="off"
                // Numbered, because a screen reader announcing «Ваш ответ» three
                // times in one sentence says nothing about which Gap it is on.
                aria-label={parts.length === 2 ? ru.practice.answer : ru.practice.gapAt(at + 1)}
                onChange={(event) => {
                  // The whole list every time: a Gap nobody has typed in yet is
                  // an empty answer at that Gap rather than a missing one, and
                  // the array has to be as long as the sentence for the second
                  // Gap's value to be the second Gap's value.
                  const next = Array.from({ length: parts.length - 1 }, (_, i) => answers[i] ?? '');
                  next[at] = event.target.value;
                  onAnswer(next);
                }}
              />
            )}
          </Fragment>
        ))}
      </p>
    );
  }

  return (
    <>
      <p className="prompt">{exercise.prompt}</p>
      {answered ? <p className="given">{answer}</p> : null}

      {!answered && exercise.kind === 'multiple_choice' ? (
        <ul className="choices" aria-label={ru.practice.chooseOption}>
          {exercise.choices.map((choice) => (
            <li key={choice}>
              <label>
                <input
                  type="radio"
                  // Per Exercise: a Test puts several on one page, and a shared
                  // name would make choosing an option in one unpick another.
                  name={`choice-${exercise.id}`}
                  value={choice}
                  checked={answer === choice}
                  disabled={disabled}
                  onChange={() => onAnswer([choice])}
                />
                <span>{choice}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}

      {!answered && exercise.kind === 'word_order' ? (
        <WordOrder
          choices={exercise.choices}
          fragments={fragments}
          onFragments={useFragments}
          disabled={disabled}
        />
      ) : null}

      {!answered && WRITTEN_KINDS.includes(exercise.kind) ? (
        <label>
          <span>{ru.practice.answer}</span>
          <textarea
            rows={exercise.kind === 'open_writing' ? 6 : 3}
            value={answer}
            disabled={disabled}
            onChange={(event) => onAnswer([event.target.value])}
          />
        </label>
      ) : null}
    </>
  );
}

function WordOrder({
  choices, fragments, onFragments, disabled,
}: {
  choices: string[];
  fragments: number[];
  onFragments: (value: number[]) => void;
  disabled: boolean;
}) {
  const used = new Set(fragments);

  return (
    <div className="wordOrder">
      <p className="muted">{ru.practice.buildSentence}</p>
      <p className="built">{fragments.map((at) => choices[at] ?? '').join(' ') || ' '}</p>
      {/* Every fragment stays where it was put, and a used one goes invisible
          rather than being taken out of the row. Removing it would reflow the
          fragments after it and, once the row lost a line, everything below —
          which is the Practice moving under the Student mid-answer, on the one
          screen that has to sit still while it is being worked. */}
      <p className="fragments">
        {choices.map((fragment, index) => (
          <button
            key={`${fragment}-${index}`}
            type="button"
            className={used.has(index) ? 'secondary used' : 'secondary'}
            disabled={disabled || used.has(index)}
            onClick={() => onFragments([...fragments, index])}
          >
            {fragment}
          </button>
        ))}
      </p>
      <p>
        <button type="button" className="secondary" disabled={disabled} onClick={() => onFragments([])}>
          {ru.practice.clear}
        </button>
      </p>
    </div>
  );
}
