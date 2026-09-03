'use client';

// Every attempt at a Test, oldest first.
//
// A retake appears beside the earlier ones rather than replacing them, and this
// is where that becomes worth something: the point of taking a Test twice is the
// difference between the two.

import { ru } from '../../../ru.ts';
import type { AttemptSummary } from '../../../tests/wire.ts';
import { stateClass } from '../../shared/verdict-state.ts';

export function attemptScoreLine(attempt: AttemptSummary): string {
  if (attempt.state === 'grading') return ru.test.grading;
  // An unfinished judgement is not a zero, and a failed one is not a failure on
  // the merits: neither is shown as a score.
  if (attempt.state === 'grading_failed') return ru.test.notScored;
  return ru.test.score(attempt.correct, attempt.total, attempt.scorePercent ?? 0);
}

/**
 * The same line, marked where the reason there is no score is that the grading
 * failed. In a list of attempts that is easy to skim past as one more grey
 * clause, and a failed grading is the one thing on this screen the Student can
 * do something about.
 */
export function AttemptScore({ attempt }: { attempt: AttemptSummary }) {
  const text = attemptScoreLine(attempt);
  return attempt.state === 'grading_failed'
    ? <span className={`stateName ${stateClass('failed')}`}>{text}</span>
    : <>{text}</>;
}

export function AttemptList({ testId, attempts }: { testId: number; attempts: AttemptSummary[] }) {
  if (attempts.length === 0) return <p className="muted">{ru.test.noAttempts}</p>;

  return (
    <ul className="attempts">
      {attempts.map((attempt) => (
        <li key={attempt.attemptId}>
          <span className="body">
            <a href={`/tests/${testId}/attempts/${attempt.attemptId}`}>
              {ru.test.attemptNumber(attempt.attempt)}
            </a>
            <span className="muted">
              {new Date(attempt.submittedAt).toLocaleString(ru.locale)}
              {' · '}<AttemptScore attempt={attempt} />
            </span>
          </span>
          {attempt.passed === null ? null : (
            <span className={`tag ${attempt.passed ? 'state-correct' : 'state-incorrect'}`}>
              {attempt.passed ? ru.test.passed : ru.test.failed}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
