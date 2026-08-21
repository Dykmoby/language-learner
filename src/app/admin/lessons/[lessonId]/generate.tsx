'use client';

// The Generation form, and the Theory arriving while it is written.
//
// design.md § Grading's finding, carried over with more force: the measured
// 4-7s was for a Verdict, and a whole Lesson with ten Exercises at high Effort is
// a different order of wait entirely. A screen showing nothing is a dead app, so
// the Theory is rendered as it arrives — on the wire the Practice already uses,
// not a second protocol.
//
// **The inputs are the expensive part.** A refusal leaves every field exactly as
// it was, so generating again costs a click rather than retyping. That is why
// nothing here is cleared on failure and why the panel does not close itself.

import { useState } from 'react';
import { ru } from '../../../../ru.ts';
import { EXERCISE_KINDS, type ExerciseKind } from '../../../../content/exercise-validity.ts';
import type { LessonDocument } from '../../../../content/lesson-document.ts';
import { MAX_EXERCISES, MIN_EXERCISES, type KindMix } from '../../../../authoring/contract.ts';
import type { Effort } from '../../../../claude/effort.ts';
import { useAuthoringStream } from './authoring-stream.ts';
import { FaultList } from './faults.tsx';
import { ModelAndEffort } from './model-picker.tsx';
import { StreamedTheory } from './streamed-theory.tsx';

/** A published Lesson this one may continue from. */
export type EarlierLessonChoice = { id: number; title: string };

type Props = {
  lessonId: number;
  earlier: EarlierLessonChoice[];
  defaultModel: string;
  disabled: boolean;
  /** A Draft that came back whole and passed every rule. Nothing else reaches it. */
  onGenerated: (document: LessonDocument, draftId: number) => void;
};

export function GeneratePanel({ lessonId, earlier, defaultModel, disabled, onGenerated }: Props) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [vocabulary, setVocabulary] = useState('');
  const [exerciseCount, setExerciseCount] = useState(6);
  const [kindMix, setKindMix] = useState<KindMix>({});
  const [continueFrom, setContinueFrom] = useState<number | null>(null);
  const [wishes, setWishes] = useState('');
  const [model, setModel] = useState(defaultModel);
  const [effort, setEffort] = useState<Effort | null>(null);

  const [notice, setNotice] = useState<string | null>(null);
  const [differences, setDifferences] = useState<string[]>([]);
  const stream = useAuthoringStream();

  const busy = stream.running || disabled;

  async function generate() {
    setNotice(null);
    setDifferences([]);

    await stream.start(
      `/api/admin/lessons/${lessonId}/generate`,
      {
        topic,
        vocabulary: vocabulary.split('\n'),
        exerciseCount,
        kindMix,
        wishes,
        continueFromLessonId: continueFrom,
        model,
        effort,
      },
      (frame) => {
        onGenerated(frame.document, frame.draftId);
        setNotice(ru.generation.done);
        // Facts about what came back, not faults: the Draft is stored either way.
        setDifferences(frame.mismatches.map((mismatch) => (
          mismatch.code === 'exercise_count_mismatch'
            ? ru.generation.countMismatch(mismatch.asked, mismatch.produced)
            : ru.generation.kindMismatch(
              ru.exerciseKinds[mismatch.kind] ?? mismatch.kind, mismatch.asked, mismatch.produced,
            )
        )));
      },
    );
  }

  if (!open) {
    return (
      <p className="actions">
        <button type="button" className="secondary" onClick={() => setOpen(true)} disabled={disabled}>
          {ru.generation.title}
        </button>
      </p>
    );
  }

  return (
    <section>
      <h2>{ru.generation.title}</h2>
      <p className="muted">{ru.generation.explanation}</p>

      <label>
        <span>{ru.generation.topic}</span>
        <textarea rows={2} value={topic} onChange={(e) => setTopic(e.target.value)} disabled={busy} />
      </label>
      <p className="muted">{ru.generation.topicHint}</p>

      <label>
        <span>{ru.generation.vocabulary}</span>
        <textarea rows={4} value={vocabulary} onChange={(e) => setVocabulary(e.target.value)} disabled={busy} />
      </label>
      <p className="muted">{ru.generation.vocabularyHint}</p>

      <label>
        <span>{ru.generation.exerciseCount}</span>
        <input
          type="number"
          min={MIN_EXERCISES}
          max={MAX_EXERCISES}
          value={exerciseCount}
          onChange={(e) => setExerciseCount(Number(e.target.value))}
          disabled={busy}
        />
      </label>
      <p className="muted">{ru.generation.exerciseCountHint(MIN_EXERCISES, MAX_EXERCISES)}</p>

      <p className="muted">{ru.generation.kindMix}</p>
      <ul className="choiceRows">
        {EXERCISE_KINDS.map((kind) => (
          <li key={kind}>
            <label className="inline">
              <span>{ru.exerciseKinds[kind] ?? kind}</span>
              <input
                type="number"
                min={0}
                max={MAX_EXERCISES}
                value={kindMix[kind] ?? 0}
                onChange={(e) => setKindMix(withCount(kindMix, kind, Number(e.target.value)))}
                disabled={busy}
              />
            </label>
          </li>
        ))}
      </ul>
      <p className="muted">{ru.generation.kindMixHint}</p>

      <label>
        <span>{ru.generation.continueFrom}</span>
        <select
          value={continueFrom ?? ''}
          onChange={(e) => setContinueFrom(e.target.value === '' ? null : Number(e.target.value))}
          disabled={busy}
        >
          <option value="">{ru.generation.continueFromNone}</option>
          {earlier.map((lesson) => (
            <option key={lesson.id} value={lesson.id}>{lesson.title}</option>
          ))}
        </select>
      </label>
      <p className="muted">{ru.generation.continueFromHint}</p>

      <label>
        <span>{ru.generation.wishes}</span>
        <textarea rows={3} value={wishes} onChange={(e) => setWishes(e.target.value)} disabled={busy} />
      </label>
      <p className="muted">{ru.generation.wishesHint}</p>

      <ModelAndEffort
        model={model}
        effort={effort}
        disabled={busy}
        onModel={setModel}
        onEffort={setEffort}
      />

      {stream.problem === null ? null : <p className="error" role="alert">{stream.problem}</p>}
      <FaultList faults={stream.faults} />
      {notice === null ? null : <p className="ok" role="status">{notice}</p>}
      {differences.length === 0 ? null : (
        <>
          <p className="muted">{ru.generation.mismatchTitle}</p>
          <ul className="cards">
            {differences.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="muted">{ru.generation.mismatchHint}</p>
        </>
      )}

      <p className="actions">
        <button type="button" onClick={generate} disabled={busy}>
          {stream.running ? ru.generation.generating : ru.generation.generate}
        </button>
        {stream.running ? (
          <button type="button" className="secondary" onClick={stream.cancel}>
            {ru.generation.cancel}
          </button>
        ) : (
          <button type="button" className="secondary" onClick={() => setOpen(false)} disabled={disabled}>
            {ru.draft.backToDraft}
          </button>
        )}
      </p>

      <StreamedTheory theory={stream.theory} />
    </section>
  );
}

/** Nought is no preference, which is the same as saying nothing about that Kind. */
function withCount(mix: KindMix, kind: ExerciseKind, count: number): KindMix {
  const next = { ...mix };
  if (Number.isInteger(count) && count > 0) next[kind] = count;
  else delete next[kind];
  return next;
}
