'use client';

// The Practice, authored by hand: one form per Exercise Kind, because the fields
// genuinely differ (design.md § Authoring).
//
// The distinction the forms exist to make visible is between what the Student is
// *offered* and what is *accepted*. For a multiple choice and a word order they
// are the same values seen twice, so this shows one list of options and marks
// which of them count — rather than two text boxes an author has to keep in
// agreement, which is precisely how `accepted_answer_not_a_choice` gets written.
//
// Nothing here judges. The validity rules do that, on the way into a Draft and
// again on the way into a published Lesson; this only makes the incoherent
// shapes harder to type in the first place.

import { useState } from 'react';
import { ru } from '../../../../ru.ts';
import {
  EXERCISE_KINDS, isDeterministic, offersChoices, type ExerciseKind,
} from '../../../../content/exercise-validity.ts';
import {
  blankExercise, removeChoice, renameChoice, withKind, type DocumentExercise,
} from '../../../../content/lesson-document.ts';

type Props = {
  exercises: DocumentExercise[];
  /** Submissions already made against each published Exercise, by Exercise id. */
  submissionCounts: Record<number, number>;
  disabled: boolean;
  onChange: (next: DocumentExercise[]) => void;
};

/** One answer per line, which is how a list of short strings is edited by hand. */
function linesOf(values: readonly string[] | undefined): string {
  return (values ?? []).join('\n');
}

function toLines(raw: string): string[] {
  // Split and nothing else. Trimming or dropping blanks here would fight the
  // person typing: the trailing newline they just pressed would vanish before
  // they could write the next answer, and a space between two words would be
  // eaten on the way in. Blank entries are dropped where the document is parsed
  // on the server, which is after typing has finished.
  return raw.split('\n');
}

export function ExerciseList({ exercises, submissionCounts, disabled, onChange }: Props) {
  // The Exercise whose removal has been asked for and not yet confirmed. Only
  // one at a time, because a confirmation the author has forgotten about is a
  // confirmation that confirms nothing.
  const [confirming, setConfirming] = useState<number | null>(null);

  function replace(index: number, exercise: DocumentExercise) {
    onChange(exercises.map((current, at) => (at === index ? exercise : current)));
  }

  function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= exercises.length) return;
    const next = [...exercises];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    onChange(next);
  }

  function remove(index: number) {
    setConfirming(null);
    onChange(exercises.filter((_, at) => at !== index));
  }

  function askToRemove(index: number) {
    const exercise = exercises[index];
    const made = exercise?.id === undefined ? 0 : submissionCounts[exercise.id] ?? 0;
    if (made === 0) remove(index);
    else setConfirming(index);
  }

  return (
    <>
      <h2>{ru.draft.exercisesTitle}</h2>
      {exercises.length === 0 ? <p className="muted">{ru.draft.noExercises}</p> : null}

      <ol className="exercises">
        {exercises.map((exercise, index) => {
          const made = exercise.id === undefined ? 0 : submissionCounts[exercise.id] ?? 0;
          return (
            <li key={exercise.id ?? `new-${index}`}>
              <p className="muted">
                {ru.draft.exerciseAt(index + 1)}
                {' · '}
                {isDeterministic(exercise.kind) ? ru.judgedBy.deterministic : ru.judgedBy.grader}
              </p>
              {/* Said up front rather than only at the moment of removal: an
                  Admin deciding what to change should know which Exercises
                  already carry a Student's work. */}
              {made === 0 ? null : <p className="muted">{ru.draft.hasSubmissions(made)}</p>}

              <label>
                <span>{ru.draft.exerciseKind}</span>
                <select
                  value={exercise.kind}
                  onChange={(e) => replace(index, withKind(exercise, e.target.value as ExerciseKind))}
                  disabled={disabled}
                >
                  {EXERCISE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{ru.exerciseKinds[kind] ?? kind}</option>
                  ))}
                </select>
              </label>

              <label>
                <span>{ru.draft.prompt}</span>
                <textarea
                  rows={2}
                  value={exercise.prompt}
                  onChange={(e) => replace(index, { ...exercise, prompt: e.target.value })}
                  disabled={disabled}
                />
              </label>

              {offersChoices(exercise.kind) ? (
                <ChoiceFields
                  exercise={exercise}
                  position={index}
                  disabled={disabled}
                  onChange={(next) => replace(index, next)}
                />
              ) : null}

              {exercise.kind === 'multiple_choice' ? null : (
                <label>
                  <span>{ru.draft.referenceAnswer}</span>
                  <textarea
                    rows={2}
                    value={exercise.referenceAnswer}
                    onChange={(e) => replace(index, { ...exercise, referenceAnswer: e.target.value })}
                    disabled={disabled}
                  />
                </label>
              )}
              <p className="muted">
                {isDeterministic(exercise.kind)
                  ? ru.draft.referenceAnswerRevealHint
                  : ru.draft.referenceAnswerGraderHint}
              </p>

              {isDeterministic(exercise.kind) && exercise.kind !== 'multiple_choice' ? (
                <>
                  <label>
                    <span>
                      {exercise.kind === 'word_order' ? ru.draft.acceptedOrders : ru.draft.acceptedAnswers}
                    </span>
                    <textarea
                      rows={3}
                      value={linesOf(exercise.acceptedAnswers)}
                      onChange={(e) => replace(index, { ...exercise, acceptedAnswers: toLines(e.target.value) })}
                      disabled={disabled}
                    />
                  </label>
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={exercise.caseSensitive ?? false}
                      onChange={(e) => replace(index, { ...exercise, caseSensitive: e.target.checked })}
                      disabled={disabled}
                    />
                    <span>{ru.draft.caseSensitive}</span>
                  </label>
                  <p className="muted">{ru.draft.caseSensitiveHint}</p>
                </>
              ) : null}

              {confirming === index ? (
                <>
                  <p className="error" role="alert">{ru.draft.removeWithSubmissions(made)}</p>
                  <p className="actions">
                    <button type="button" onClick={() => remove(index)} disabled={disabled}>
                      {ru.draft.confirmRemove}
                    </button>
                    <button type="button" className="secondary" onClick={() => setConfirming(null)} disabled={disabled}>
                      {ru.draft.cancelRemove}
                    </button>
                  </p>
                </>
              ) : (
                <p className="actions">
                  <button type="button" className="secondary" onClick={() => move(index, -1)} disabled={disabled || index === 0}>
                    {ru.draft.moveUp}
                  </button>
                  <button type="button" className="secondary" onClick={() => move(index, 1)} disabled={disabled || index === exercises.length - 1}>
                    {ru.draft.moveDown}
                  </button>
                  <button type="button" className="secondary" onClick={() => askToRemove(index)} disabled={disabled}>
                    {ru.draft.removeExercise}
                  </button>
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <p className="actions">
        <button
          type="button"
          className="secondary"
          onClick={() => onChange([...exercises, blankExercise('fill_gap')])}
          disabled={disabled}
        >
          {ru.draft.addExercise}
        </button>
      </p>
    </>
  );
}

type ChoiceProps = {
  exercise: DocumentExercise;
  /** Its place in the Practice, which is what makes the radio group its own. */
  position: number;
  disabled: boolean;
  onChange: (next: DocumentExercise) => void;
};

/**
 * The options a Student is shown, with the answers marked on them.
 *
 * A multiple choice has exactly one Reference Answer among its options and any
 * number of accepted ones; a word order is arranged rather than picked, so its
 * fragments carry no marks and its accepted orders are typed as whole sentences
 * beside them.
 */
function ChoiceFields({ exercise, position, disabled, onChange }: ChoiceProps) {
  const choices = exercise.choices ?? [];
  const accepted = exercise.acceptedAnswers ?? [];
  const marked = exercise.kind === 'multiple_choice';

  function toggleAccepted(value: string, on: boolean) {
    onChange({
      ...exercise,
      acceptedAnswers: on
        ? [...accepted.filter((answer) => answer !== value), value]
        : accepted.filter((answer) => answer !== value),
    });
  }

  return (
    <>
      <p className="muted">{marked ? ru.draft.choices : ru.draft.fragments}</p>
      <ul className="choiceRows">
        {choices.map((choice, index) => (
          <li key={index}>
            <input
              type="text"
              value={choice}
              onChange={(e) => onChange(renameChoice(exercise, index, e.target.value))}
              disabled={disabled}
            />
            {marked ? (
              <>
                <label className="inline">
                  <input
                    type="radio"
                    // Per Exercise, and by position rather than by id: two
                    // newly added Exercises have no id, and sharing a name
                    // would make them one radio group — picking a Reference
                    // Answer in the second would unpick the first.
                    name={`reference-${position}`}
                    checked={exercise.referenceAnswer === choice && choice !== ''}
                    onChange={() => onChange({ ...exercise, referenceAnswer: choice })}
                    disabled={disabled}
                  />
                  <span>{ru.draft.referenceChoice}</span>
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={accepted.includes(choice) && choice !== ''}
                    onChange={(e) => toggleAccepted(choice, e.target.checked)}
                    disabled={disabled}
                  />
                  <span>{ru.draft.correctChoice}</span>
                </label>
              </>
            ) : null}
            <button
              type="button"
              className="secondary"
              onClick={() => onChange(removeChoice(exercise, index))}
              disabled={disabled}
            >
              {ru.draft.removeChoice}
            </button>
          </li>
        ))}
      </ul>
      <p className="actions">
        <button
          type="button"
          className="secondary"
          onClick={() => onChange({ ...exercise, choices: [...choices, ''] })}
          disabled={disabled}
        >
          {marked ? ru.draft.addChoice : ru.draft.addFragment}
        </button>
      </p>
    </>
  );
}
