'use client';

// The Exercise as the Student meets it: the prompt and the way it is answered,
// together.
//
// One component for both places a Student answers one — a Lesson's Practice and
// a Test — because an Exercise is met the same way in either, and two renderings
// of a word order would eventually disagree about what a fragment is. Every
// branch on Exercise Kind lives here and nowhere else: whatever asks the question
// receives a string.
//
// The prompt and the input are one component because for a fill-gap they are one
// sentence — the gap belongs in the text, not on a line of its own underneath it.

import { useState } from 'react';
import { ru } from '../../ru.ts';
import type { ExerciseKind } from '../../db/schema.ts';

export type AskedExercise = {
  /** What makes this Exercise's radio group its own when several are on a page. */
  id: number;
  kind: ExerciseKind;
  prompt: string;
  choices: string[];
};

/** Where a fill-gap Exercise wants its input. */
const GAP = '___';

// Composition, translation and open writing are answered in prose; the Kinds
// judged in code are answered by choosing or arranging.
const WRITTEN_KINDS: ExerciseKind[] = ['composition', 'translation', 'open_writing'];

export function ExerciseQuestion({
  exercise, answer, onAnswer, disabled, answered,
}: {
  exercise: AskedExercise;
  answer: string;
  onAnswer: (value: string) => void;
  disabled: boolean;
  /** The answer is in and being judged or explained: show it, do not ask again. */
  answered: boolean;
}) {
  // Positions in `choices` rather than the words themselves. Two identical
  // fragments in one sentence are two fragments, and telling them apart by value
  // means guessing which of the two was taken.
  const [fragments, setFragments] = useState<number[]>([]);

  function useFragments(next: number[]) {
    setFragments(next);
    // Word order is answered as a sentence like any other: the fragments are how
    // it is built, not what is submitted.
    onAnswer(next.map((at) => exercise.choices[at] ?? '').join(' '));
  }

  if (exercise.kind === 'fill_gap') {
    // The prompt carries the gap as ___, so the input goes where the gap is.
    const [before, ...rest] = exercise.prompt.split(GAP);
    const after = rest.join(GAP);
    const field = answered
      ? <span className="given inline">{answer}</span>
      : (
        <input
          type="text"
          className="gap"
          value={answer}
          disabled={disabled}
          autoComplete="off"
          aria-label={ru.practice.answer}
          onChange={(event) => onAnswer(event.target.value)}
        />
      );

    return rest.length === 0
      ? (
        <>
          <p className="prompt">{exercise.prompt}</p>
          {field}
        </>
      )
      : <p className="prompt">{before}{field}{after}</p>;
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
                  onChange={() => onAnswer(choice)}
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
            onChange={(event) => onAnswer(event.target.value)}
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
