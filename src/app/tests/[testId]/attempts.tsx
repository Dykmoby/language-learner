'use client';

// Every attempt at a Test, oldest first.
//
// A retake appears beside the earlier ones rather than replacing them, and this
// is where that becomes worth something: the point of taking a Test twice is the
// difference between the two.

import { ru } from '../../../ru.ts';
import type { AttemptSummary } from '../../../tests/wire.ts';

export function attemptScoreLine(attempt: AttemptSummary): string {
  if (attempt.state === 'grading') return ru.test.grading;
  // An unfinished judgement is not a zero, and a failed one is not a failure on
  // the merits: neither is shown as a score.
  if (attempt.state === 'grading_failed') return ru.test.notScored;
  return ru.test.score(attempt.correct, attempt.total, attempt.scorePercent ?? 0);
}

export function AttemptList({ testId, attempts }: { testId: number; attempts: AttemptSummary[] }) {
  if (attempts.length === 0) return <p className="muted">{ru.test.noAttempts}</p>;

  return (
    <ul className="cards">
      {attempts.map((attempt) => (
        <li key={attempt.attemptId}>
          <a href={`/tests/${testId}/attempts/${attempt.attemptId}`}>
            {ru.test.attemptNumber(attempt.attempt)}
          </a>
          <span className="muted">
            {' — '}{new Date(attempt.submittedAt).toLocaleString(ru.locale)}
            {' · '}{attemptScoreLine(attempt)}
          </span>
          {attempt.passed === null ? null : (
            <span className={attempt.passed ? 'ok' : 'error'}>
              {' '}{attempt.passed ? ru.test.passed : ru.test.failed}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
