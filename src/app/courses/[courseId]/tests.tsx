'use client';

// The Tests of a Course, beside its Lessons and deliberately not among them.
//
// A Test is owned by the Course rather than by any Lesson, and a Student
// looking for one does not look in a list of Lessons. It has its own frame, and
// since issue #99 its own toggle: whether the finished Lessons are worth hiding
// and whether the sat Tests are is not one question, and one switch answering
// both would clear a list the Student was reading.

import { Switch } from '@mantine/core';
import { ru } from '../../../ru.ts';
import type { AttemptSummary } from '../../../tests/wire.ts';
import { useRememberedFlag } from '../../shared/remembered-flag.ts';
import { AttemptScore } from '../../tests/[testId]/attempts.tsx';

export type CourseTest = {
  id: number;
  title: string;
  exerciseCount: number;
  attempts: AttemptSummary[];
};

export function CourseTests({ tests }: { tests: CourseTest[] }) {
  const [hideFinished, setHideFinished] = useRememberedFlag('course.hideFinishedTests');
  // Sat at all, whatever it scored. A Test gates nothing and can be retaken
  // without limit, so «done with it» is the Student's own judgement rather than
  // a threshold — and a work they mean to retake is one they leave showing.
  const shown = hideFinished ? tests.filter((test) => test.attempts.length === 0) : tests;

  return (
    <>
      <div className="panelHead">
        <h2 id="tests">{ru.test.sectionTitle}</h2>
        <Switch
          size="sm"
          checked={hideFinished}
          onChange={(event) => setHideFinished(event.currentTarget.checked)}
          label={ru.test.hideFinished}
        />
      </div>

      {shown.length === 0 ? (
        <p className="muted">{tests.length === 0 ? ru.test.none : ru.test.allFinishedHidden}</p>
      ) : (
        <ul className="cards">
          {shown.map((test) => {
            const latest = test.attempts.at(-1) ?? null;
            return (
              <li key={test.id}>
                <span className="body">
                  <a href={`/tests/${test.id}`}>{test.title}</a>
                  <span className="muted">
                    {ru.test.exerciseCount(test.exerciseCount)}
                    {latest === null ? null : <>{' · '}{ru.test.attemptNumber(latest.attempt)}: <AttemptScore attempt={latest} /></>}
                  </span>
                </span>
                {latest === null || latest.passed === null ? null : (
                  <span className={`tag ${latest.passed ? 'state-correct' : 'state-incorrect'}`}>
                    {latest.passed ? ru.test.passed : ru.test.failed}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
