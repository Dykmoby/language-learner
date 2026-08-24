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
import { takeFrames, type ResultFrame, type RevealResult } from '../../../../practice/wire.ts';
import { ExerciseQuestion } from '../../../shared/exercise-question.tsx';
import { DisputeForm } from '../../../shared/dispute-form.tsx';
import { ProgressBar, type Segment } from '../../../shared/progress-bar.tsx';
import { stateClass, stateOfVerdict, stateWords } from '../../../shared/verdict-state.ts';

export type CurrentExercise = {
  id: number;
  position: number;
  kind: ExerciseKind;
  prompt: string;
  choices: string[];
  revealOffered: boolean;
};

export type { Segment };

type Props = {
  /** Null when every Exercise in the Practice is complete. */
  current: CurrentExercise | null;
  segments: Segment[];
  counts: { completed: number; completedWithHelp: number; disputed: number; total: number };
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
  // Set the moment an objection lands. Progression has already unblocked on the
  // server by then — this is only what the screen offers next.
  const [disputed, setDisputed] = useState(false);

  if (segments.length === 0) return <p className="muted">{ru.practice.empty}</p>;

  function retry() {
    setStreamed('');
    setResult(null);
    setRevealed(null);
    setRefusal(null);
    setDisputed(false);
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
        {counts.disputed > 0 ? <>{' · '}{ru.practice.disputedCount(counts.disputed)}</> : null}
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

  // The Practice says more than the state's name — "Верно!" congratulates a step
  // where the label merely records one — so the wording here is the Practice's
  // own. The hue and the rail come from the state system, so those cannot drift
  // from what the Test review and the progress bar mean by the same fact.
  const verdictLabel = result?.verdict === 'correct' ? ru.practice.correct
    : result?.verdict === 'partially_correct' ? ru.practice.partiallyCorrect
    : result?.verdict === 'incorrect' ? ru.practice.incorrect
    : null;

  const verdictState = result?.verdict == null ? null : stateOfVerdict(result.verdict);
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
            // Never a wrong answer, and — until now — one sentence of Russian
            // away from looking exactly like one. It has its own hue, its own
            // rail and its own words: the attempt is not counted, the Exercise
            // stays open, and nothing about the Student's answer was judged.
            <p className={`verdict ${stateClass('failed')}`} role="alert">
              {stateWords('failed')}
              <span className="detail">{ru.practice.gradingFailed}</span>
            </p>
          ) : (
            <>
              <p className={`verdict ${stateClass(verdictState ?? 'incorrect')}`} role="status">
                {verdictLabel}
              </p>
              {result.feedbackRu ? <p className="feedback">{result.feedbackRu}</p> : null}
              {result.corrected ? (
                <p className="corrected">{ru.practice.corrected}: <strong>{result.corrected}</strong></p>
              ) : null}
              {result.errors.length > 0 ? (
                <div className={`errors ${stateClass('incorrect')}`}>
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

          {/* An objection is only offered against a judgement that went against
              the Student: a failed grading was never judged, and a correct
              Verdict is not something anybody objects to. */}
          {!advancing && result.status === 'graded' && result.submissionId !== null ? (
            <DisputeForm submissionId={result.submissionId} onDisputed={() => setDisputed(true)} />
          ) : null}

          <p className="actions">
            {advancing || disputed
              ? <button type="button" onClick={advance}>{ru.practice.next}</button>
              : <button type="button" onClick={retry}>{ru.practice.submit}</button>}
            {!advancing && !disputed && result.progression.revealOffered ? (
              <button type="button" className="secondary" onClick={reveal}>{ru.practice.reveal}</button>
            ) : null}
          </p>
          {!advancing && !disputed && !result.progression.revealOffered && result.status === 'graded' ? (
            <p className="muted">{ru.practice.revealHint}</p>
          ) : null}
        </div>
      ) : null}

      {phase === 'revealed' && revealed ? (
        <div className="result">
          {/* Completed With Help: complete, and neither passed nor failed. It
              borrows the hue of neither. */}
          <p className={`verdict ${stateClass('help')}`} role="status">{ru.practice.revealed}</p>
          <p className="corrected">{ru.practice.corrected}: <strong>{revealed.referenceAnswer}</strong></p>
          <p className="actions">
            <button type="button" onClick={advance}>{ru.practice.next}</button>
          </p>
        </div>
      ) : null}
    </section>
  );
}
