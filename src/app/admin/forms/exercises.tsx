'use client';

// Exercises, authored by hand: one form per Exercise Kind, because the fields
// genuinely differ (design.md § Authoring).
//
// It serves both places Exercises come into being — a Lesson's Practice and a
// Test — and knows about neither. It is handed a list and hands one back, which
// is what the Exercise Set makes possible: owned by exactly one of the two, so
// nothing about authoring, ordering or judging an Exercise branches on which.
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

import { ru } from '../../../ru.ts';
import {
  EXERCISE_KINDS, gapsOf, isDeterministic, offersChoices, type ExerciseKind,
} from '../../../content/exercise-validity.ts';
import {
  blankExercise, discardedByKindChange, removeChoice, renameChoice, withKind, withPrompt,
  type DocumentExercise,
} from '../../../content/lesson-document.ts';
import { movedWithin } from '../../../content/ordering.ts';
import type { Pending } from './pending.ts';

type Props = {
  exercises: DocumentExercise[];
  /** Submissions already made against each published Exercise, by Exercise id. */
  submissionCounts: Record<number, number>;
  disabled: boolean;
  /**
   * The form's one pending confirmation, held by the editor so that this list, a
   * Kind change and a Publish can never be waiting on the author at once.
   */
  pending: Pending | null;
  setPending: (pending: Pending | null) => void;
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

export function ExerciseList({
  exercises, submissionCounts, disabled, pending, setPending, onChange,
}: Props) {

  function replace(index: number, exercise: DocumentExercise) {
    onChange(exercises.map((current, at) => (at === index ? exercise : current)));
  }

  function move(index: number, by: -1 | 1) {
    onChange(movedWithin(exercises, index, by));
  }

  function remove(index: number) {
    setPending(null);
    onChange(exercises.filter((_, at) => at !== index));
  }

  function askToRemove(index: number) {
    const exercise = exercises[index];
    const made = exercise?.id === undefined ? 0 : submissionCounts[exercise.id] ?? 0;
    if (made === 0) remove(index);
    else setPending({ what: 'remove', index });
  }

  function changeKind(index: number, kind: ExerciseKind) {
    setPending(null);
    replace(index, withKind(exercises[index]!, kind));
  }

  function askToChangeKind(index: number, kind: ExerciseKind) {
    // Nothing to lose, nothing to ask: a newly added Exercise with empty fields,
    // or a change between two Kinds that use the same ones, applies at once.
    if (discardedByKindChange(exercises[index]!, kind) === 0) changeKind(index, kind);
    else setPending({ what: 'kind', index, kind });
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
                {/* A select has already changed what it displays by the time its
                    change handler runs, so the form has to decide whether it
                    snaps back while the confirmation is pending or stays on the
                    new Kind. It snaps back — `value` is the Exercise's own Kind,
                    and the Exercise does not change until the author confirms.
                    The alternative would leave a select reading «Выбор варианта»
                    above a word order's fragments: a screen that lies about what
                    it is showing. The Kind being asked for is named in the
                    confirmation instead, where it is a question rather than a
                    claim. */}
                <select
                  value={exercise.kind}
                  onChange={(e) => askToChangeKind(index, e.target.value as ExerciseKind)}
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
                  // Through `withPrompt`, because for a fill-gap the prompt is
                  // what says how many places there are to answer: adding a
                  // `___` adds a box below, and removing one takes its box away.
                  onChange={(e) => replace(index, withPrompt(exercise, e.target.value))}
                  disabled={disabled}
                />
              </label>
              {exercise.kind === 'fill_gap' ? <p className="muted">{ru.draft.gapHint}</p> : null}

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
                  <AcceptedFields
                    exercise={exercise}
                    disabled={disabled}
                    onChange={(next) => replace(index, next)}
                  />
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

              {pending?.what === 'kind' && pending.index === index ? (
                <>
                  <p className="error" role="alert">
                    {ru.draft.kindChangeDiscards(
                      discardedByKindChange(exercise, pending.kind),
                      ru.exerciseKinds[pending.kind] ?? pending.kind,
                    )}
                  </p>
                  <p className="actions">
                    <button type="button" onClick={() => changeKind(index, pending.kind)} disabled={disabled}>
                      {ru.draft.confirmKindChange}
                    </button>
                    <button type="button" className="secondary" onClick={() => setPending(null)} disabled={disabled}>
                      {ru.draft.cancelKindChange}
                    </button>
                  </p>
                </>
              ) : pending?.what === 'remove' && pending.index === index ? (
                <>
                  <p className="error" role="alert">{ru.draft.removeWithSubmissions(made)}</p>
                  <p className="actions">
                    <button type="button" onClick={() => remove(index)} disabled={disabled}>
                      {ru.draft.confirmRemove}
                    </button>
                    <button type="button" className="secondary" onClick={() => setPending(null)} disabled={disabled}>
                      {ru.draft.cancelRemove}
                    </button>
                  </p>
                </>
              ) : (
                <p className="actions">
                  <button type="button" className="secondary" onClick={() => move(index, -1)} disabled={disabled || index === 0}>
                    {ru.common.moveUp}
                  </button>
                  <button type="button" className="secondary" onClick={() => move(index, 1)} disabled={disabled || index === exercises.length - 1}>
                    {ru.common.moveDown}
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

/**
 * The values accepted at each Gap of this Exercise.
 *
 * A word order has one, and so has a fill-gap with one Gap; a fill-gap with
 * three has three, in the order the sentence is read. How many there are is
 * asked of the Kinds module rather than decided here, so what an author sees is
 * what a Student will be shown — and the write back is the whole list every
 * time, so a box nobody has typed in is an empty Gap rather than a missing one.
 */
function AcceptedFields({ exercise, disabled, onChange }: {
  exercise: DocumentExercise;
  disabled: boolean;
  onChange: (next: DocumentExercise) => void;
}) {
  const gaps = gapsOf(exercise.kind, exercise.prompt);
  const accepted = exercise.acceptedAnswers ?? [];
  const several = gaps > 1;

  function write(at: number, raw: string) {
    onChange({
      ...exercise,
      acceptedAnswers: Array.from(
        { length: gaps },
        (_, i) => (i === at ? toLines(raw) : [...(accepted[i] ?? [])]),
      ),
    });
  }

  // Nowhere to answer at all. The validity rules name it — a fill-gap whose
  // prompt has no `___` cannot be rendered — and a box here would invite an
  // answer to a question that has no place for one.
  if (gaps === 0) return <p className="muted">{ru.draft.noGaps}</p>;

  return (
    <>
      {Array.from({ length: gaps }, (_, at) => (
        <label key={at}>
          <span>
            {exercise.kind === 'word_order' ? ru.draft.acceptedOrders
              : several ? ru.draft.acceptedAnswersAtGap(at + 1)
                : ru.draft.acceptedAnswers}
          </span>
          <textarea
            rows={3}
            value={linesOf(accepted[at])}
            onChange={(e) => write(at, e.target.value)}
            disabled={disabled}
          />
        </label>
      ))}
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
  // A multiple choice and a word order each have exactly one place to answer, so
  // the options are marked against the Exercise's one position.
  const accepted = exercise.acceptedAnswers?.[0] ?? [];
  const marked = exercise.kind === 'multiple_choice';

  function toggleAccepted(value: string, on: boolean) {
    onChange({
      ...exercise,
      acceptedAnswers: [on
        ? [...accepted.filter((answer) => answer !== value), value]
        : accepted.filter((answer) => answer !== value)],
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
