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
import { Button, NativeSelect, NumberInput, Stack, Textarea } from '@mantine/core';
import { ru } from '../../../../ru.ts';
import { EXERCISE_KINDS, type ExerciseKind } from '../../../../content/exercise-validity.ts';
import type { LessonDocument } from '../../../../content/lesson-document.ts';
import { MAX_EXERCISES, MIN_EXERCISES, type KindMix } from '../../../../authoring/contract.ts';
import type { Effort } from '../../../../claude/effort.ts';
import { useAuthoringStream } from './authoring-stream.ts';
import { FaultList } from '../../forms/faults.tsx';
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
  const stream = useAuthoringStream(ru.generation);

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
      <div className="panel">
        <h3>{ru.generation.title}</h3>
        <p className="muted">{ru.generation.explanation}</p>
        <Button fullWidth variant="default" onClick={() => setOpen(true)} disabled={disabled}>
          {ru.generation.title}
        </Button>
      </div>
    );
  }

  return (
    <section className="panel">
      <h3>{ru.generation.title}</h3>
      <p className="muted">{ru.generation.explanation}</p>

      <Stack gap="sm">
        <Textarea
          label={ru.generation.topic}
          description={ru.generation.topicHint}
          rows={2}
          value={topic}
          disabled={busy}
          onChange={(event) => setTopic(event.currentTarget.value)}
        />

        <Textarea
          label={ru.generation.vocabulary}
          description={ru.generation.vocabularyHint}
          rows={4}
          value={vocabulary}
          disabled={busy}
          onChange={(event) => setVocabulary(event.currentTarget.value)}
        />

        <NumberInput
          label={ru.generation.exerciseCount}
          description={ru.generation.exerciseCountHint(MIN_EXERCISES, MAX_EXERCISES)}
          min={MIN_EXERCISES}
          max={MAX_EXERCISES}
          value={exerciseCount}
          disabled={busy}
          onChange={(value) => setExerciseCount(Number(value))}
        />

        {/* An explicit control because otherwise generation over-produces
            multiple choice — the cheapest Kind to write and the least useful to
            learn from. */}
        <div>
          <p className="muted">{ru.generation.kindMix}</p>
          <ul className="choiceRows">
            {EXERCISE_KINDS.map((kind) => (
              <li key={kind}>
                <NumberInput
                  label={ru.exerciseKinds[kind] ?? kind}
                  min={0}
                  max={MAX_EXERCISES}
                  value={kindMix[kind] ?? 0}
                  disabled={busy}
                  onChange={(value) => setKindMix(withCount(kindMix, kind, Number(value)))}
                />
              </li>
            ))}
          </ul>
          <p className="muted">{ru.generation.kindMixHint}</p>
        </div>

        <NativeSelect
          label={ru.generation.continueFrom}
          description={ru.generation.continueFromHint}
          value={continueFrom === null ? '' : String(continueFrom)}
          disabled={busy}
          onChange={(event) => {
            const chosen = event.currentTarget.value;
            setContinueFrom(chosen === '' ? null : Number(chosen));
          }}
          data={[
            { value: '', label: ru.generation.continueFromNone },
            ...earlier.map((lesson) => ({ value: String(lesson.id), label: lesson.title })),
          ]}
        />

        <Textarea
          label={ru.generation.wishes}
          description={ru.generation.wishesHint}
          rows={3}
          value={wishes}
          disabled={busy}
          onChange={(event) => setWishes(event.currentTarget.value)}
        />
      </Stack>

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
        <Button onClick={generate} disabled={busy}>
          {stream.running ? ru.generation.generating : ru.generation.generate}
        </Button>
        {stream.running ? (
          <Button variant="default" onClick={stream.cancel}>
            {ru.generation.cancel}
          </Button>
        ) : (
          <Button variant="default" onClick={() => setOpen(false)} disabled={disabled}>
            {ru.draft.backToDraft}
          </Button>
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
