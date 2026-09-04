'use client';

// The Test shell: every Exercise at once, and one button that ends it.
//
// It judges nothing and says nothing about any answer, which is the whole design
// of a Test rather than a simplification of the Practice's shell. The answers are
// held here until they are sent, so changing one before submitting costs nothing
// and reaches nobody.
//
// The one thing it does ask is whether an unanswered Exercise was meant to stay
// unanswered. A blank answer is judged like any other — incorrect — and a Student
// who scrolled past one deserves to be told before that becomes true.

import { useState } from 'react';
import { Button } from '@mantine/core';
import { ru } from '../../../ru.ts';
import { ExerciseQuestion } from '../../shared/exercise-question.tsx';
import type { AttemptSummary, TestExerciseView } from '../../../tests/wire.ts';
import { AttemptList } from './attempts.tsx';

type Props = {
  testId: number;
  exercises: TestExerciseView[];
  attempts: AttemptSummary[];
  courseId: number;
};

type Phase = 'answering' | 'confirming' | 'submitting';

export function TestShell({ testId, exercises, attempts, courseId }: Props) {
  // One list per Exercise, holding one value per gap in reading order. The Test
  // keeps them until they are sent, so changing one before submitting costs
  // nothing and reaches nobody.
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [phase, setPhase] = useState<Phase>('answering');
  const [problem, setProblem] = useState<string | null>(null);

  if (exercises.length === 0) {
    return (
      <section>
        <p className="muted">{ru.test.empty}</p>
      </section>
    );
  }

  // Nothing written at any of its gaps. Asked of the values rather than of the
  // sentence they build, which still reads as the prompt.
  const unanswered = exercises.filter((exercise) =>
    (answers[exercise.exerciseId] ?? []).every((value) => value.trim() === ''));

  async function send() {
    setPhase('submitting');
    setProblem(null);
    try {
      const response = await fetch(`/api/tests/${testId}/attempts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: exercises.map((exercise) => ({
            exerciseId: exercise.exerciseId,
            answers: answers[exercise.exerciseId] ?? [],
          })),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        { ok?: boolean; attemptId?: number; error?: string } | null;

      if (!response.ok || body?.ok !== true || typeof body.attemptId !== 'number') {
        setProblem(body?.error ?? ru.test.submitFailed);
        setPhase('answering');
        return;
      }

      // Everything the Test withheld is on the review, so that is where
      // submitting goes — not back to a screen that now has nothing to say.
      window.location.href = `/tests/${testId}/attempts/${body.attemptId}`;
    } catch {
      setProblem(ru.test.submitFailed);
      setPhase('answering');
    }
  }

  function submit() {
    if (unanswered.length > 0) {
      setPhase('confirming');
      return;
    }
    void send();
  }

  const busy = phase === 'submitting';

  return (
    <div className="sections">
      {/* Two sections: the sheet being answered, and what earlier attempts
          scored. The attempts list used to sit directly under the submit
          button, so a past score read as part of the answer in progress. */}
      <section>
      <ol className="exercises">
        {exercises.map((exercise) => (
          <li key={exercise.exerciseId} className="askCard">
            <div className="askBody">
            <p className="askKind">{ru.test.position(exercise.position, exercises.length)}</p>
            <ExerciseQuestion
              exercise={{
                id: exercise.exerciseId,
                kind: exercise.kind,
                prompt: exercise.prompt,
                choices: exercise.choices,
              }}
              answers={answers[exercise.exerciseId] ?? []}
              onAnswer={(values) => {
                setAnswers((current) => ({ ...current, [exercise.exerciseId]: values }));
                // A confirmation about unanswered Exercises is a question about
                // the attempt as it was a moment ago; answering one withdraws it.
                if (phase === 'confirming') setPhase('answering');
                setProblem(null);
              }}
              disabled={busy}
              answered={false}
            />
            </div>
          </li>
        ))}
      </ol>

      {problem === null ? null : <p className="error" role="alert">{problem}</p>}

      {phase === 'confirming' ? (
        <>
          <p className="error" role="alert">{ru.test.unanswered(unanswered.length)}</p>
          <p className="actions">
            <Button onClick={() => void send()}>{ru.test.submitAnyway}</Button>
            <Button variant="default" onClick={() => setPhase('answering')}>
              {ru.test.keepAnswering}
            </Button>
          </p>
        </>
      ) : (
        <p className="actions">
          <Button onClick={submit} disabled={busy}>
            {busy ? ru.test.submitting : ru.test.submit}
          </Button>
        </p>
      )}

      </section>

      <section className="panel">
      <h2>{ru.test.attemptsTitle}</h2>
      <AttemptList testId={testId} attempts={attempts} />
      </section>
    </div>
  );
}
