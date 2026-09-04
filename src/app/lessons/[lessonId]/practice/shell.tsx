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
// too: the shell asks a question and receives one value per gap, without knowing
// how many gaps that Exercise turned out to have. In particular nothing
// here knows whether an Exercise is judged in code or by the Grader — both answer
// on the same wire in the same shape, and finding out would only let the two
// paths drift apart.
//
// The Verdict is drawn inside the card the answer is in rather than as a
// paragraph below it. That is the redesign's one substantive change here: a
// judgement is about the sentence above it, and a block that starts below a card
// reads as being about the screen.

import { useEffect, useState } from 'react';
import { Button } from '@mantine/core';
import { ru, errorTypeLabel } from '../../../../ru.ts';
import type { ExerciseKind } from '../../../../db/schema.ts';
import { isDeterministic } from '../../../../content/exercise-validity.ts';
import { takeFrames, type ResultFrame, type RevealResult } from '../../../../practice/wire.ts';
import { ExerciseQuestion } from '../../../shared/exercise-question.tsx';
import { Explanation } from '../../../shared/explanation.tsx';
import { DisputeForm } from '../../../shared/dispute-form.tsx';
import { ProgressBar, type Segment } from '../../../shared/progress-bar.tsx';
import { stateClass, stateOfVerdict, type JudgementState } from '../../../shared/verdict-state.ts';
import { VerdictLine } from '../../../shared/verdict-line.tsx';

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

/**
 * What the Practice calls each Verdict, which is not quite what the label calls
 * it: this is the middle of a Lesson rather than a report on one, so "Верно!"
 * congratulates where `ru.states.correct` records.
 */
const PRACTICE_WORDS: Record<JudgementState, string> = {
  correct: ru.practice.correct,
  partial: ru.practice.partiallyCorrect,
  incorrect: ru.practice.incorrect,
};

export function PracticeShell({ current, segments, counts, nextLessonId, courseId }: Props) {
  const [phase, setPhase] = useState<Phase>('answering');
  // One value per gap, in reading order. A list rather than a string even where
  // there is one gap: the shell asks a question and is handed back what was
  // written, and how many places that is is the Exercise's business.
  const [answers, setAnswers] = useState<string[]>([]);
  const [streamed, setStreamed] = useState('');
  // Issue #76 — a Course whose Grader runs at a high Effort is checked in
  // minutes, and the Student chose none of that. After about a minute the wait
  // says so, rather than showing the same sentence it showed at three seconds.
  const [checkingLong, setCheckingLong] = useState(false);
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
    // Nothing written at any gap is not answering. Asked of the values rather
    // than of the sentence they build, which still reads as the prompt.
    if (answers.every((value) => value.trim() === '')) {
      setRefusal(ru.practice.emptyAnswer);
      return;
    }

    setPhase('checking');
    setCheckingLong(false);
    setStreamed('');
    setResult(null);
    setRefusal(null);

    try {
      const response = await fetch(`/api/exercises/${current.id}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ answers }),
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

  // A minute, not a spinner threshold: the measured Verdict is 4-7 seconds, so
  // anything still running at sixty is either a Course set high or something
  // wrong — and the Student can act on neither, which is exactly why they are
  // told it is the first.
  useEffect(() => {
    if (phase !== 'checking') return;
    const timer = setTimeout(() => setCheckingLong(true), 60_000);
    return () => clearTimeout(timer);
  }, [phase]);

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
        <div className="askCard">
          <div className="askBody">
            <p className="ok" role="status">{ru.practice.lessonComplete}</p>
            {nextLessonId === null ? (
              <p className="muted">{ru.practice.courseComplete}</p>
            ) : (
              <>
                <p className="muted">{ru.practice.nextLessonAhead}</p>
                <p className="actions">
                  <a className="button" href={`/lessons/${nextLessonId}`}>{ru.practice.nextLesson}</a>
                </p>
              </>
            )}
            <p className="actions"><a className="button secondary" href={`/courses/${courseId}`}>{ru.lesson.backToCourse}</a></p>
          </div>
        </div>
      </section>
    );
  }

  const verdictState = result?.verdict == null ? null : stateOfVerdict(result.verdict);
  const advancing = result?.status === 'graded' && result.verdict === 'correct';
  // Which state the judgement block is tinted with. A failed grading is one of
  // the six and is not a Verdict, so it is decided before the Verdict is read.
  const blockState = result === null
    ? null
    : result.status === 'grading_failed' ? 'failed' : verdictState ?? 'incorrect';

  return (
    <section>
      {progress}

      <div className="askCard">
        <div className="askBody">
          <ExerciseQuestion
            exercise={current}
            answers={answers}
            onAnswer={setAnswers}
            disabled={phase === 'checking'}
            answered={phase === 'result' || phase === 'revealed'}
            // Which gaps held, once a Verdict is in. Empty while answering and on
            // everything the Grader judges, where an Error is where the detail is.
            gaps={phase === 'result' ? result?.gaps ?? [] : []}
          />

          {refusal ? <p className="error" role="alert">{refusal}</p> : null}

          {phase === 'answering' ? (
            <p className="actions">
              <Button onClick={submit}>{ru.practice.submit}</Button>
              {revealOffered ? (
                <Button variant="default" onClick={reveal}>{ru.practice.reveal}</Button>
              ) : null}
            </p>
          ) : null}

          {phase === 'checking' ? (
            <div>
              {/* Roughly three seconds pass before the first token arrives. This says
                  what is happening rather than spinning at the Student — and it sits
                  in the row the buttons were in, at the height the buttons were, so
                  submitting does not move the answer the Student is still reading. */}
              <p className="actions" role="status">
                <span className="muted">
                  {checkingLong ? ru.practice.stillChecking : ru.practice.checking}
                </span>
              </p>
              {streamed ? <p className="feedback">{streamed}</p> : null}
            </div>
          ) : null}
        </div>

        {phase === 'result' && result && blockState ? (
          <div className={`result ${stateClass(blockState)}`}>
            {result.status === 'grading_failed' ? (
              // Never a wrong answer, and — until now — one sentence of Russian
              // away from looking exactly like one. It has its own hue, its own
              // rail and its own words: the attempt is not counted, the Exercise
              // stays open, and nothing about the Student's answer was judged.
              //
              // Two sentences behind the one state, because a busy API and a
              // broken one ask for opposite things from the Student: one is worth
              // waiting out, and the other is not going to change in ten seconds.
              <VerdictLine
                state="failed"
                role="alert"
                detail={result.failure === 'busy' ? ru.practice.gradingBusy : ru.practice.gradingFailed}
              />
            ) : (
              <>
                {/* The Practice congratulates a step where the canonical label
                    merely records one, so the wording is its own. The hue and the
                    rail are not, which is what stops them drifting from what the
                    Test review and the progress bar mean by the same fact. */}
                <VerdictLine
                  state={verdictState ?? 'incorrect'}
                  words={PRACTICE_WORDS[verdictState ?? 'incorrect']}
                />
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

            {/* Issue #94 — a wrong multiple choice, fill-gap or word order comes
                back with one word, because nothing judged it but a comparison.
                This is the offer to be told what is wrong with the answer that
                was given, and it never says which answer was right: the Student
                works that out, which is the exercise.

                Not offered on what the Grader judges — «Почти верно» arrived
                with the Grader's own explanation under it. */}
            {!advancing && !disputed && result.status === 'graded'
              && result.submissionId !== null && isDeterministic(current.kind) ? (
                <Explanation submissionId={result.submissionId} />
              ) : null}

            {/* An objection is only offered against a judgement that went against
                the Student: a failed grading was never judged, and a correct
                Verdict is not something anybody objects to. */}
            {!advancing && result.status === 'graded' && result.submissionId !== null ? (
              <DisputeForm submissionId={result.submissionId} onDisputed={() => setDisputed(true)} />
            ) : null}

            <p className="actions">
              {advancing || disputed
                ? <Button onClick={advance}>{ru.practice.next}</Button>
                : (
                  // Issue #96 — this button checks nothing. It clears a Verdict
                  // that has already been given and hands the Exercise back, and
                  // «Проверить» described the step after the one it performs. A
                  // failed grading keeps «Проверить»: nothing was judged there,
                  // so there is nothing to answer again — the same answer is
                  // going back to the same check.
                  <Button onClick={retry}>
                    {result.status === 'graded' ? ru.practice.retry : ru.practice.submit}
                  </Button>
                )}
              {!advancing && !disputed && result.progression.revealOffered ? (
                <Button variant="default" onClick={reveal}>{ru.practice.reveal}</Button>
              ) : null}
            </p>
            {!advancing && !disputed && !result.progression.revealOffered && result.status === 'graded' ? (
              <p className="muted">{ru.practice.revealHint}</p>
            ) : null}
          </div>
        ) : null}

        {phase === 'revealed' && revealed ? (
          <div className={`result ${stateClass('help')}`}>
            {/* Completed With Help: complete, and neither passed nor failed. It
                borrows the hue of neither. */}
            <VerdictLine state="help" words={ru.practice.revealed} />
            <p className="corrected">{ru.practice.corrected}: <strong>{revealed.referenceAnswer}</strong></p>
            <p className="actions">
              <Button onClick={advance}>{ru.practice.next}</Button>
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
