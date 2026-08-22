'use client';

// The Practice shell: the progress bar, the Exercise being asked, its input, and
// whatever came back.
//
// It holds no progression logic. The server decides which Exercise is current by
// deriving it from Submissions, and "Дальше" simply asks the server again —
// which is why there is exactly one Exercise on the wire at a time and no second
// copy of the rules living in the browser.
//
// Every branch on Exercise Kind lives in ExerciseQuestion, which a Test asks with
// too: the shell asks a question and receives a string. In particular nothing
// here knows whether an Exercise is judged in code or by the Grader — both answer
// on the same wire in the same shape, and finding out would only let the two
// paths drift apart.

import { useState } from 'react';
import { ru, errorTypeLabel } from '../../../../ru.ts';
import type { ExerciseKind } from '../../../../db/schema.ts';
import type { ExerciseState } from '../../../../practice/progress.ts';
import { takeFrames, type ResultFrame, type RevealResult } from '../../../../practice/wire.ts';
import { ExerciseQuestion } from '../../../shared/exercise-question.tsx';

export type CurrentExercise = {
  id: number;
  position: number;
  kind: ExerciseKind;
  prompt: string;
  choices: string[];
  revealOffered: boolean;
};

export type Segment = { position: number; state: ExerciseState };

type Props = {
  /** Null when every Exercise in the Practice is complete. */
  current: CurrentExercise | null;
  segments: Segment[];
  counts: { completed: number; completedWithHelp: number; total: number };
  nextLessonId: number | null;
  courseId: number;
};

type Phase = 'answering' | 'checking' | 'result' | 'revealed';

export function PracticeShell({ current, segments, counts, nextLessonId, courseId }: Props) {
  const [phase, setPhase] = useState<Phase>('answering');
  const [answer, setAnswer] = useState('');
  const [streamed, setStreamed] = useState('');
  const [result, setResult] = useState<ResultFrame | null>(null);
  const [revealed, setRevealed] = useState<RevealResult | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [revealOffered, setRevealOffered] = useState(current?.revealOffered ?? false);

  if (segments.length === 0) return <p className="muted">{ru.practice.empty}</p>;

  function retry() {
    setStreamed('');
    setResult(null);
    setRevealed(null);
    setRefusal(null);
    setPhase('answering');
  }

  // The next Exercise comes from the server, not from a list the browser was
  // handed up front: the Practice is one Exercise at a time on the wire too.
  function advance() {
    window.location.reload();
  }

  async function submit() {
    if (!current) return;
    if (answer.trim() === '') { setRefusal(ru.practice.emptyAnswer); return; }

    setPhase('checking');
    setStreamed('');
    setResult(null);
    setRefusal(null);

    try {
      const response = await fetch(`/api/exercises/${current.id}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answer }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setRefusal(body?.error ?? ru.errors.serverError);
        setPhase('answering');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = takeFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          // The explanation arrives as it is written; the Verdict and the Errors
          // arrive whole, at the end.
          if (frame.t === 'delta') setStreamed((text) => text + frame.text);
          else {
            setResult(frame);
            setRevealOffered(frame.progression.revealOffered);
            setPhase('result');
          }
        }
      }
    } catch {
      setRefusal(ru.errors.serverError);
      setPhase('answering');
    }
  }

  async function reveal() {
    if (!current) return;
    const response = await fetch(`/api/exercises/${current.id}/reveal`, { method: 'POST' });
    const body = await response.json().catch(() => null) as (RevealResult & { error?: string }) | null;
    if (!response.ok || !body) {
      setRefusal(body?.error ?? ru.errors.serverError);
      return;
    }
    setRevealed(body);
    setPhase('revealed');
  }

  const progress = (
    <>
      <ProgressBar segments={segments} />
      <p className="muted">
        {current ? <>{ru.practice.position(current.position, counts.total)}{' · '}</> : null}
        {ru.practice.doneCount(counts.completed)}
        {counts.completedWithHelp > 0 ? <>{' · '}{ru.practice.withHelpCount(counts.completedWithHelp)}</> : null}
      </p>
    </>
  );

  if (!current) {
    return (
      <section>
        {progress}
        <p className="ok" role="status">{ru.practice.lessonComplete}</p>
        {nextLessonId === null ? (
          <p className="muted">{ru.practice.courseComplete}</p>
        ) : (
          <>
            <p className="muted">{ru.practice.nextLessonUnlocked}</p>
            <p className="actions">
              <a className="button" href={`/lessons/${nextLessonId}`}>{ru.practice.nextLesson}</a>
            </p>
          </>
        )}
        <p><a href={`/courses/${courseId}`}>{ru.lesson.backToCourse}</a></p>
      </section>
    );
  }

  const verdictLabel = result?.verdict === 'correct' ? ru.practice.correct
    : result?.verdict === 'partially_correct' ? ru.practice.partiallyCorrect
    : result?.verdict === 'incorrect' ? ru.practice.incorrect
    : null;

  const advancing = result?.status === 'graded' && result.verdict === 'correct';

  return (
    <section>
      {progress}
      <ExerciseQuestion
        exercise={current}
        answer={answer}
        onAnswer={setAnswer}
        disabled={phase === 'checking'}
        answered={phase === 'result' || phase === 'revealed'}
      />

      {refusal ? <p className="error" role="alert">{refusal}</p> : null}

      {phase === 'answering' ? (
        <p className="actions">
          <button type="button" onClick={submit}>{ru.practice.submit}</button>
          {revealOffered ? (
            <button type="button" className="secondary" onClick={reveal}>{ru.practice.reveal}</button>
          ) : null}
        </p>
      ) : null}

      {phase === 'checking' ? (
        <div>
          {/* Roughly three seconds pass before the first token arrives. This says
              what is happening rather than spinning at the Student. */}
          <p className="muted" role="status">{ru.practice.checking}</p>
          {streamed ? <p className="feedback">{streamed}</p> : null}
        </div>
      ) : null}

      {phase === 'result' && result ? (
        <div className="result">
          {result.status === 'grading_failed' ? (
            // Never a wrong answer, and it must not read like one: the attempt is
            // not counted and the Exercise stays open.
            <p className="error" role="alert">{ru.practice.gradingFailed}</p>
          ) : (
            <>
              <p className={result.verdict === 'correct' ? 'ok' : 'error'} role="status">{verdictLabel}</p>
              {result.feedbackRu ? <p className="feedback">{result.feedbackRu}</p> : null}
              {result.corrected ? (
                <p className="corrected">{ru.practice.corrected}: <strong>{result.corrected}</strong></p>
              ) : null}
              {result.errors.length > 0 ? (
                <div className="errors">
                  <h2>{ru.practice.errorsTitle}</h2>
                  <ul>
                    {result.errors.map((error, index) => (
                      <li key={index}>
                        <span className="errorType">{errorTypeLabel(error.type)}</span>
                        {error.span ? <> <span className="span">{error.span}</span></> : null}
                        <div>{error.explanationRu}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}

          <p className="actions">
            {advancing
              ? <button type="button" onClick={advance}>{ru.practice.next}</button>
              : <button type="button" onClick={retry}>{ru.practice.submit}</button>}
            {!advancing && result.progression.revealOffered ? (
              <button type="button" className="secondary" onClick={reveal}>{ru.practice.reveal}</button>
            ) : null}
          </p>
          {!advancing && !result.progression.revealOffered && result.status === 'graded' ? (
            <p className="muted">{ru.practice.revealHint}</p>
          ) : null}
        </div>
      ) : null}

      {phase === 'revealed' && revealed ? (
        <div className="result">
          <p className="withHelp" role="status">{ru.practice.revealed}</p>
          <p className="corrected">{ru.practice.corrected}: <strong>{revealed.referenceAnswer}</strong></p>
          <p className="actions">
            <button type="button" onClick={advance}>{ru.practice.next}</button>
          </p>
        </div>
      ) : null}
    </section>
  );
}

// Completed With Help is its own segment — not folded in with unaided
// completions and not left out. A Student who revealed half the Lesson should be
// able to see that they did, and the segments differ in pattern as well as in
// colour so the distinction survives both themes.
function ProgressBar({ segments }: { segments: Segment[] }) {
  return (
    <ol className="progress" aria-label={ru.practice.title}>
      {segments.map((segment) => (
        <li key={segment.position} className={`segment ${segment.state}`} title={String(segment.position)} />
      ))}
    </ol>
  );
}
