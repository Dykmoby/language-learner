'use client';

// The Tests of a Course, beside its Lessons and deliberately not among them.
//
// A Lesson's place in the list is what unlocks the next one; a Test unlocks
// nothing and is gated by nothing, so putting one in that list would suggest an
// order that does not exist.

import { ru } from '../../../ru.ts';
import type { AttemptSummary } from '../../../tests/wire.ts';
import { attemptScoreLine } from '../../tests/[testId]/attempts.tsx';

export type CourseTest = {
  id: number;
  title: string;
  exerciseCount: number;
  attempts: AttemptSummary[];
};

export function CourseTests({ tests }: { tests: CourseTest[] }) {
  if (tests.length === 0) return <p className="muted">{ru.test.none}</p>;

  return (
    <ul className="cards">
      {tests.map((test) => {
        const latest = test.attempts.at(-1) ?? null;
        return (
          <li key={test.id}>
            <a href={`/tests/${test.id}`}>{test.title}</a>
            <span className="muted">
              {' — '}{ru.test.exerciseCount(test.exerciseCount)}
              {latest === null ? null : <>{' · '}{ru.test.attemptNumber(latest.attempt)}: {attemptScoreLine(latest)}</>}
            </span>
            {latest === null || latest.passed === null ? null : (
              <span className={latest.passed ? 'ok' : 'error'}>
                {' '}{latest.passed ? ru.test.passed : ru.test.failed}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
