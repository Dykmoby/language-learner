'use client';

// The Practice shell: the progress bar, the Exercise being asked, its input, and
// whatever came back.
//
// It holds no progression logic. The server decides what state every Exercise is
// in by deriving it from Submissions, and every move — a segment, an arrow,
// «Дальше» — is a question put back to it. That is why there is exactly one
// Exercise on the wire at a time and no second copy of the rules living in the
// browser, and it is why «Дальше» asks for `current` rather than working out
// which Exercise that is: where the Student stands is derived, and a browser that
// derived it too would be a second answer waiting to disagree.
//
// What the browser does keep is what has been typed and not sent. Moving away
// from a half-written answer and coming back to find it gone would make the
// navigation this screen just gained a thing to be careful around; the drafts
// live for as long as the page does, and nothing about them reaches the server.
//
// Every branch on Exercise Kind lives in ExerciseQuestion, which a Test asks with
// too: the shell asks a question and receives one value per gap, without knowing
// how many gaps that Exercise turned out to have. In particular nothing
// here knows whether an Exercise is judged in code or by the Grader — both answer
// on the same wire in the same shape, and finding out would only let the two
// paths drift apart.
//
// The Verdict is drawn inside the card the answer is in rather than as a
// paragraph below it: a judgement is about the sentence above it, and a block
// that starts below a card reads as being about the screen.

import { useEffect, useState } from 'react';
import { Button } from '@mantine/core';
import { ru, errorTypeLabel } from '../../../../ru.ts';
import { isDeterministic } from '../../../../content/exercise-validity.ts';
import { isBehind } from '../../../../practice/progress.ts';
import {
  takeFrames, type ExerciseView, type PracticeView, type ResultFrame, type RevealResult,
} from '../../../../practice/wire.ts';
import { ExerciseQuestion } from '../../../shared/exercise-question.tsx';
import { Explanation } from '../../../shared/explanation.tsx';
import { DisputeForm } from '../../../shared/dispute-form.tsx';
import { ProgressBar } from '../../../shared/progress-bar.tsx';
import { stateClass, stateOfVerdict, type JudgementState } from '../../../shared/verdict-state.ts';
import { VerdictLine } from '../../../shared/verdict-line.tsx';

type Props = {
  lessonId: number;
  /** The Exercise the Practice opens on, and the standing of the whole Set. */
  initial: PracticeView;
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

/**
 * Which phase an Exercise opens in, decided by what the Student already did to
 * it rather than by how they arrived. Opening Exercise 3 an hour later shows
 * exactly what it showed when its Verdict came in.
 */
function phaseOf(exercise: ExerciseView | null): Phase {
  if (exercise === null) return 'answering';
  if (exercise.revealed !== null) return 'revealed';
  return exercise.past === null ? 'answering' : 'result';
}

export function PracticeShell({ lessonId, initial, nextLessonId, courseId }: Props) {
  const [view, setView] = useState<PracticeView>(initial);
  const [phase, setPhase] = useState<Phase>(() => phaseOf(initial.exercise));
  // One value per gap, in reading order. A list rather than a string even where
  // there is one gap: the shell asks a question and is handed back what was
  // written, and how many places that is is the Exercise's business.
  const [answers, setAnswers] = useState<string[]>(initial.exercise?.pastAnswers ?? []);
  // What was typed and not sent, per Exercise, for as long as this page lives.
  const [drafts, setDrafts] = useState<Record<number, string[]>>({});
  const [streamed, setStreamed] = useState('');
  // Issue #76 — a Course whose Grader runs at a high Effort is checked in
  // minutes, and the Student chose none of that. After about a minute the wait
  // says so, rather than showing the same sentence it showed at three seconds.
  const [checkingLong, setCheckingLong] = useState(false);
  const [result, setResult] = useState<ResultFrame | null>(initial.exercise?.past ?? null);
  const [revealed, setRevealed] = useState<RevealResult | null>(initial.exercise?.revealed ?? null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [revealOffered, setRevealOffered] = useState(initial.exercise?.revealOffered ?? false);
  // Set the moment an objection lands. Progression has already unblocked on the
  // server by then — this is only what the screen offers next.
  const [disputed, setDisputed] = useState(initial.exercise?.disputed ?? false);
  const [moving, setMoving] = useState(false);

  const current = view.exercise;
  const total = view.counts.total;
  const at = current?.position ?? 0;
  // An Exercise that is behind the Student is read rather than worked: there is
  // nothing here that will accept another answer to it, and the server would
  // refuse one anyway.
  const settled = current !== null && isBehind(current.state);

  function retry() {
    setStreamed('');
    setResult(null);
    setRevealed(null);
    setRefusal(null);
    setDisputed(false);
    setPhase('answering');
  }

  /** Everything that is about the Exercise on screen, replaced at once. */
  function adopt(next: PracticeView) {
    setView(next);
    const opened = next.exercise;
    setResult(opened?.past ?? null);
    setRevealed(opened?.revealed ?? null);
    setRevealOffered(opened?.revealOffered ?? false);
    setDisputed(opened?.disputed ?? false);
    setStreamed('');
    setRefusal(null);
    setCheckingLong(false);
    setPhase(phaseOf(opened));
    // A draft wins over what was last sent: it is the more recent of the two,
    // and it is the thing the Student was in the middle of.
    setAnswers(opened === null ? [] : drafts[opened.id] ?? opened.pastAnswers);
  }

  /**
   * Opens an Exercise — one by its place in the Set, or `current`, which is the
   * server's answer to "where am I up to".
   */
  async function open(target: number | 'current') {
    if (moving) return;
    setMoving(true);
    // Stashed before the fetch, so an Exercise left mid-sentence is still
    // mid-sentence when the Student comes back to it.
    if (current !== null) setDrafts((held) => ({ ...held, [current.id]: answers }));

    try {
      const response = await fetch(`/api/lessons/${lessonId}/practice/${target}`, {
        headers: { 'cache-control': 'no-cache' },
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; view?: PracticeView } | null;
      if (!response.ok || body?.ok !== true || body.view === undefined) {
        setRefusal(ru.errors.serverError);
        return;
      }
      adopt(body.view);
    } catch {
      setRefusal(ru.errors.serverError);
    } finally {
      setMoving(false);
    }
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
            // The bar is drawn from states the server derived, so an answer that
            // moved one is a reason to ask again rather than to guess. Only when
            // it moved: a wrong answer changes nothing about where anything
            // stands, and re-reading the Practice to be told that would be a
            // request per failed attempt.
            if (frame.verdict === 'correct') void restate(current.position);
          }
        }
      }
    } catch {
      setRefusal(ru.errors.serverError);
      setPhase('answering');
    }
  }

  /**
   * The bar and the counts, re-read after something moved — without touching the
   * Exercise on screen, which is showing a Verdict the Student is still reading.
   */
  async function restate(position: number) {
    try {
      const response = await fetch(`/api/lessons/${lessonId}/practice/${position}`, {
        headers: { 'cache-control': 'no-cache' },
      });
      const body = await response.json().catch(() => null) as { ok?: boolean; view?: PracticeView } | null;
      if (body?.ok !== true || body.view === undefined) return;
      const fresh = body.view;
      setView((held) => ({ ...fresh, exercise: held.exercise }));
    } catch {
      // The bar is a picture of what the server already knows. It catches up on
      // the next move, and nothing here depends on it being right this second.
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
    void restate(current.position);
  }

  if (view.segments.length === 0) return <p className="muted">{ru.practice.empty}</p>;

  const progress = (
    <>
      {/* The bar is the way to every Exercise as well as the picture of them —
          issue #95. A Student who wants to look back at Exercise 3 aims at the
          third mark, which is where they were already looking. */}
      <ProgressBar segments={view.segments} at={at} onSelect={(position) => void open(position)} />
      <p className="practiceNav">
        <Button
          variant="default"
          size="compact-sm"
          disabled={moving || at <= 1}
          aria-label={ru.practice.previousExercise}
          onClick={() => void open(at - 1)}
        >
          ←
        </Button>
        <span className="muted">
          {current ? <>{ru.practice.position(at, total)}{' · '}</> : null}
          {ru.practice.doneCount(view.counts.completed)}
          {view.counts.completedWithHelp > 0 ? <>{' · '}{ru.practice.withHelpCount(view.counts.completedWithHelp)}</> : null}
          {view.counts.disputed > 0 ? <>{' · '}{ru.practice.disputedCount(view.counts.disputed)}</> : null}
        </span>
        <Button
          variant="default"
          size="compact-sm"
          disabled={moving || at >= total}
          aria-label={ru.practice.nextExercise}
          onClick={() => void open(at + 1)}
        >
          →
        </Button>
      </p>
    </>
  );

  // Said above the Exercise rather than instead of it: a finished Practice is
  // still a Practice to re-read, which is the whole of what issue #95 changed
  // about this screen.
  const finished = view.complete ? (
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
  ) : null;

  if (!current) {
    return <section>{progress}{finished}</section>;
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
      {finished}

      <div className="askCard">
        <div className="askBody">
          <ExerciseQuestion
            exercise={current}
            answers={answers}
            onAnswer={setAnswers}
            disabled={phase === 'checking' || moving}
            answered={phase === 'result' || phase === 'revealed'}
            // Which gaps held, once a Verdict is in. Empty while answering and on
            // everything the Grader judges, where an Error is where the detail is.
            gaps={phase === 'result' ? result?.gaps ?? [] : []}
          />

          {refusal ? <p className="error" role="alert">{refusal}</p> : null}

          {phase === 'answering' ? (
            <p className="actions">
              <Button onClick={submit} disabled={moving}>{ru.practice.submit}</Button>
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
            {!advancing && result.status === 'graded'
              && result.submissionId !== null && isDeterministic(current.kind) ? (
                <Explanation key={result.submissionId} submissionId={result.submissionId} />
              ) : null}

            {/* An objection is only offered against a judgement that went against
                the Student: a failed grading was never judged, and a correct
                Verdict is not something anybody objects to. Nor is one that has
                already been objected to, which is what a settled Exercise showing
                its old Verdict would otherwise offer a second time. */}
            {!advancing && !disputed && !settled
              && result.status === 'graded' && result.submissionId !== null ? (
                <DisputeForm submissionId={result.submissionId} onDisputed={() => {
                  setDisputed(true);
                  void restate(current.position);
                }} />
              ) : null}

            <p className="actions">
              {advancing || disputed || settled
                // «Дальше» means "back to where I am up to", which is a place
                // that stops existing once the Practice is finished — the panel
                // above carries the way onward from there, and a button that
                // silently returned to Exercise 1 would not.
                ? (view.complete ? null : (
                  <Button onClick={() => void open('current')} disabled={moving}>{ru.practice.next}</Button>
                ))
                : (
                  // Issue #96 — this button checks nothing. It clears a Verdict
                  // that has already been given and hands the Exercise back, and
                  // «Проверить» described the step after the one it performs. A
                  // failed grading keeps «Проверить»: nothing was judged there,
                  // so there is nothing to answer again — the same answer is
                  // going back to the same check.
                  <Button onClick={retry} disabled={moving}>
                    {result.status === 'graded' ? ru.practice.retry : ru.practice.submit}
                  </Button>
                )}
              {!advancing && !disputed && !settled && result.progression.revealOffered ? (
                <Button variant="default" onClick={reveal}>{ru.practice.reveal}</Button>
              ) : null}
            </p>
            {!advancing && !disputed && !settled
              && !result.progression.revealOffered && result.status === 'graded' ? (
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
            {view.complete ? null : (
              <p className="actions">
                <Button onClick={() => void open('current')} disabled={moving}>{ru.practice.next}</Button>
              </p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
