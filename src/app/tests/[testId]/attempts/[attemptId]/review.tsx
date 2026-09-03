'use client';

// The review: the score, and every Exercise with the correct ones collapsed.
//
// Collapsing the correct ones is not decoration. A review that makes a Student
// scroll past nine right answers to reach the one they got wrong is a review
// nobody reads, so what is open by default is exactly what went wrong.
//
// Wrong has two shapes here, because the two judgement classes fail differently:
// a Grader-judged Exercise has no single wrong token to point at, so the whole
// answer is marked and the explanation carries the detail; a Deterministic one is
// exactly a token, so the chosen option is marked wrong and the right one is
// shown beside it.
//
// A third shape is neither: an answer whose grading failed. It is not red, it is
// not collapsed, and it must never read as a wrong answer.

import { useEffect, useState } from 'react';
import { Button } from '@mantine/core';
import { ru, errorTypeLabel } from '../../../../../ru.ts';
import type { AttemptExerciseView, AttemptView } from '../../../../../tests/wire.ts';
import { isDeterministic } from '../../../../../content/exercise-validity.ts';
import { AnsweredSentence } from '../../../../shared/answered-sentence.tsx';
import { DisputeForm } from '../../../../shared/dispute-form.tsx';
import { stateClass, stateOfVerdict, stateWords, type VerdictState } from '../../../../shared/verdict-state.ts';
import { VerdictLine } from '../../../../shared/verdict-line.tsx';

/** How often the page asks whether the batch has landed. */
const POLL_MS = 4000;

export function AttemptReview({ initial }: { initial: AttemptView }) {
  const [view, setView] = useState(initial);
  const [regrading, setRegrading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const waiting = view.state === 'grading';

  // While a batch is out there is nothing to do but wait for it, so the page
  // waits instead of asking the Student to reload. It stops the moment the
  // attempt settles — polling a finished attempt is asking a question that has
  // already been answered.
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;

    const timer = setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(`/api/tests/${view.testId}/attempts/${view.attemptId}`, {
            headers: { 'cache-control': 'no-cache' },
          });
          const body = (await response.json().catch(() => null)) as { ok?: boolean; view?: AttemptView } | null;
          if (!cancelled && body?.ok === true && body.view !== undefined) setView(body.view);
        } catch {
          // The batch is running server-side whether or not this page can reach
          // it. A failed poll is not a failed grading, and saying so would be
          // saying something false.
        }
      })();
    }, POLL_MS);

    return () => { cancelled = true; clearInterval(timer); };
  }, [waiting, view.testId, view.attemptId]);

  async function regrade() {
    setRegrading(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/tests/${view.testId}/attempts/${view.attemptId}/grade`, {
        method: 'POST',
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; view?: AttemptView } | null;
      if (!response.ok || body?.ok !== true || body.view === undefined) {
        setProblem(ru.test.regradeFailed);
        return;
      }
      setView(body.view);
    } catch {
      setProblem(ru.test.regradeFailed);
    } finally {
      setRegrading(false);
    }
  }

  return (
    <section className="review">
      <p className="muted">
        {new Date(view.submittedAt).toLocaleString(ru.locale)}
        {' · '}{ru.test.threshold(view.passThreshold)}
      </p>

      {view.state === 'scored' ? (
        <>
          <p className="score">{ru.test.score(view.correct, view.total, view.scorePercent ?? 0)}</p>
          {/* Whether the Test was passed is a fact about the attempt rather than
              a Verdict on an answer, so it borrows the two hues without the
              rail — a score is not one of the six states. */}
          <p className={view.passed ? 'ok' : 'error'} role="status">
            {view.passed ? ru.test.passed : ru.test.failed}
          </p>
        </>
      ) : null}

      {view.state === 'grading' ? (
        <>
          <p className="muted" role="status">{ru.test.grading}</p>
          <p className="muted">{ru.test.gradingExplanation}</p>
        </>
      ) : null}

      {view.state === 'grading_failed' ? (
        <>
          {/* Never a wrong answer, and now not drawn as one either: its own hue,
              its own rail, its own words. The answers are stored, and asking
              again costs nothing but the call. */}
          <VerdictLine state="failed" role="alert" detail={ru.test.gradingFailed} />
          <p className="actions">
            <Button onClick={() => void regrade()} disabled={regrading}>
              {regrading ? ru.test.regrading : ru.test.regrade}
            </Button>
          </p>
        </>
      ) : null}

      {problem === null ? null : <p className="error" role="alert">{problem}</p>}

      <p className="muted">{ru.test.reviewHint}</p>
      <ol className="exercises">
        {view.exercises.map((exercise) => (
          <ReviewedExercise key={exercise.exerciseId} exercise={exercise} total={view.total} />
        ))}
      </ol>

    </section>
  );
}

/**
 * Which of the six states this Exercise is in.
 *
 * `awaiting_grading` is none of them and returns null: a batch that has not
 * landed yet is not a judgement, and dressing it as one would be claiming
 * something nobody has decided. A failed grading *is* one of them, and it is the
 * reason this function exists — before the state system it fell through to the
 * same red as a wrong answer with only its Russian to tell the two apart.
 */
function stateOf(exercise: AttemptExerciseView): VerdictState | null {
  if (exercise.status === 'grading_failed') return 'failed';
  if (exercise.status === 'awaiting_grading') return null;
  return exercise.verdict === null
    ? (exercise.correct ? 'correct' : 'incorrect')
    : stateOfVerdict(exercise.verdict);
}

function stateLabel(exercise: AttemptExerciseView): string {
  const state = stateOf(exercise);
  // Null is the batch not having landed, which is the one thing here that is not
  // one of the six states and so has no canonical wording of its own.
  return state === null ? ru.test.awaitingAnswer : stateWords(state);
}

/** What became of an objection, once one has been made against this judgement. */
function disputeLabel(ruling: 'upheld' | 'rejected' | null): string {
  return ruling === 'upheld' ? ru.dispute.upheld
    : ruling === 'rejected' ? ru.dispute.rejected
    : ru.dispute.pending;
}

function ReviewedExercise({ exercise, total }: { exercise: AttemptExerciseView; total: number }) {
  // Open by default unless it was right: what a Student came to read is what
  // went wrong, and everything else is one click away.
  const [open, setOpen] = useState(!exercise.correct);
  const wrong = exercise.status === 'graded' && !exercise.correct;
  const state = stateOf(exercise);

  return (
    // The state carries the hue and the rail; the review adds only what is about
    // the review — a correct Exercise is collapsed, so its box is quieter.
    <li className={state === null ? undefined : stateClass(state)}>
      <p className="reviewHead">
        <span className="muted">{ru.test.position(exercise.position, total)}</span>
        <span className={state === null ? 'muted' : 'stateName'}>{stateLabel(exercise)}</span>
        <span className="spacer" />
        <Button variant="default" size="compact-sm" onClick={() => setOpen(!open)}>
          {open ? ru.test.hideExercise : ru.test.showExercise}
        </Button>
      </p>

      {open ? (
        <>
          <p className="prompt">{exercise.prompt}</p>

          {isDeterministic(exercise.kind) && exercise.choices.length > 0 ? (
            <ul className="choices">
              {exercise.choices.map((choice) => {
                const chosen = exercise.answer === choice;
                // A multiple choice and a word order each have one place to
                // answer, so the marked options are the one position's.
                const accepted = (exercise.acceptedAnswers[0] ?? []).includes(choice);
                return (
                  // A Deterministic Kind fails at exactly one token, so the
                  // option carries the state rather than the whole Exercise —
                  // the same two states, from the same system.
                  <li
                    key={choice}
                    className={accepted ? stateClass('correct') : chosen ? stateClass('incorrect') : undefined}
                  >
                    {choice}
                  </li>
                );
              })}
            </ul>
          ) : null}

          <p className="given">
            {ru.test.yourAnswer}: {exercise.answerGaps.every((value) => value.trim() === '')
              && exercise.answer.trim() === ''
              ? <span className="muted">{ru.test.noAnswer}</span>
              : exercise.kind === 'fill_gap'
                ? (
                  // A fill-gap has no options to mark, so the review marks the
                  // words themselves, sitting in the sentence they were written
                  // into. Rebuilt rather than printed from `answer`, because a
                  // review has to say *which* Gap was wrong: three Gaps are three
                  // facts, and a sentence marked as a whole leaves a Student
                  // comparing it to the Reference Answer word by word.
                  <AnsweredSentence
                    prompt={exercise.prompt}
                    answers={exercise.answerGaps}
                    gaps={exercise.gaps}
                    mark="strong"
                  />
                )
                : <strong>{exercise.answer}</strong>}
          </p>

          {exercise.feedbackRu ? <p className="feedback">{exercise.feedbackRu}</p> : null}

          {exercise.errors.length > 0 ? (
            <div className="errors">
              <ul>
                {exercise.errors.map((error, index) => (
                  <li key={index}>
                    <span className="errorType">{errorTypeLabel(error.type)}</span>
                    {error.span ? <> <span className="span">{error.span}</span></> : null}
                    <div>{error.explanationRu}</div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* The attempt is closed, so the answer is no longer worth withholding —
              it is the thing the review is for. */}
          <p className="corrected">
            {ru.test.referenceAnswer}: <strong>{exercise.referenceAnswer}</strong>
          </p>

          {/* A Test is where a Student writes at greatest length with no
              Progressive Hint to lean on, which is where a wrong Verdict is most
              worth overturning. Only a judgement can be objected to, so an
              unjudged or failed answer offers nothing here. */}
          {exercise.dispute !== null ? (
            <VerdictLine state="disputed" words={disputeLabel(exercise.dispute.ruling)} />
          ) : wrong ? (
            <DisputeForm submissionId={exercise.submissionId} inTest />
          ) : null}
        </>
      ) : null}
    </li>
  );
}
