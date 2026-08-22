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
import { ru, errorTypeLabel } from '../../../../../ru.ts';
import type { AttemptExerciseView, AttemptView } from '../../../../../tests/wire.ts';
import { isDeterministic } from '../../../../../content/exercise-validity.ts';
import { DisputeForm } from '../../../../shared/dispute-form.tsx';

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
          {/* Never a wrong answer, and it must not read like one: the answers are
              stored, and asking again costs nothing but the call. */}
          <p className="error" role="alert">{ru.test.gradingFailed}</p>
          <p className="actions">
            <button type="button" onClick={() => void regrade()} disabled={regrading}>
              {regrading ? ru.test.regrading : ru.test.regrade}
            </button>
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

      <p><a href={`/tests/${view.testId}`}>{ru.test.backToTest}</a></p>
    </section>
  );
}

function stateLabel(exercise: AttemptExerciseView): string {
  if (exercise.status === 'awaiting_grading') return ru.test.awaitingAnswer;
  if (exercise.status === 'grading_failed') return ru.test.failedAnswer;
  return exercise.correct ? ru.test.correctAnswer : ru.test.wrongAnswer;
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

  return (
    <li className={wrong ? 'wrong' : exercise.correct ? 'right' : undefined}>
      <p className="muted">
        {ru.test.position(exercise.position, total)}
        {' · '}
        <span className={wrong ? 'error' : exercise.correct ? 'ok' : 'muted'}>{stateLabel(exercise)}</span>
        {' '}
        <button type="button" className="secondary" onClick={() => setOpen(!open)}>
          {open ? ru.test.hideExercise : ru.test.showExercise}
        </button>
      </p>

      {open ? (
        <>
          <p className="prompt">{exercise.prompt}</p>

          {isDeterministic(exercise.kind) && exercise.choices.length > 0 ? (
            <ul className="choices">
              {exercise.choices.map((choice) => {
                const chosen = exercise.answer === choice;
                const accepted = exercise.acceptedAnswers.includes(choice);
                return (
                  <li
                    key={choice}
                    className={accepted ? 'right' : chosen ? 'wrong' : undefined}
                  >
                    {choice}
                  </li>
                );
              })}
            </ul>
          ) : null}

          <p className="given">
            {ru.test.yourAnswer}: {exercise.answer.trim() === ''
              ? <span className="muted">{ru.test.noAnswer}</span>
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
            <p className="disputed" role="status">{disputeLabel(exercise.dispute.ruling)}</p>
          ) : wrong ? (
            <DisputeForm submissionId={exercise.submissionId} inTest />
          ) : null}
        </>
      ) : null}
    </li>
  );
}
