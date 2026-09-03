'use client';

// The Test editor: a title, a pass threshold, and the Exercises — through the
// same forms a Lesson's Practice uses.
//
// Simpler than the Draft editor by exactly one thing: there is no Draft. Saving
// writes the Test, so «сохранено» here means what a Student would meet if the
// Test is published, rather than "a new version exists that nobody sees". The
// one rule that follows is that publishing is refused while there are unsaved
// edits — publishing writes a flag, and the flag would make live whatever was
// last saved rather than what is on the screen.

import { useState } from 'react';
import { Button, NumberInput, Stack, TextInput } from '@mantine/core';
import { ru } from '../../../../ru.ts';
import type { TestDocument, TestFault } from '../../../../content/test-document.ts';
import { ExerciseList } from '../../forms/exercises.tsx';
import { FaultList } from '../../forms/faults.tsx';
import type { PendingExerciseEdit } from '../../forms/pending.ts';

type Props = {
  testId: number;
  initial: TestDocument;
  published: boolean;
  submissionCounts: Record<number, number>;
};

type Phase = 'editing' | 'saving' | 'publishing';

export function TestEditor({ testId, initial, published, submissionCounts }: Props) {
  const [document, setDocument] = useState<TestDocument>(initial);
  const [phase, setPhase] = useState<Phase>('editing');
  const [live, setLive] = useState(published);
  // Typed-but-not-saved. Publishing sends no document, so without this an Admin
  // could press Publish over edits that were never written and be told it worked.
  const [unsaved, setUnsaved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [faults, setFaults] = useState<TestFault[]>([]);
  const [pending, setPending] = useState<PendingExerciseEdit | null>(null);

  const busy = phase !== 'editing';

  function edit(patch: Partial<TestDocument>) {
    setDocument((current) => ({ ...current, ...patch }));
    setUnsaved(true);
    setNotice(null);
    setProblem(null);
    setFaults([]);
  }

  async function save() {
    setPhase('saving');
    setNotice(null);
    setProblem(null);
    setFaults([]);
    try {
      const response = await fetch(`/api/admin/tests/${testId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(document),
      });
      const body = (await response.json().catch(() => null)) as
        { ok?: boolean; document?: TestDocument; faults?: TestFault[] } | null;

      if (!response.ok || body?.ok !== true || body.document === undefined) {
        // An incoherent Exercise is refused and named; anything else is a
        // failure rather than a refusal, and must not send an Admin hunting
        // through Exercises that are all fine.
        const refused = body?.faults ?? [];
        setFaults(refused);
        setProblem(refused.length > 0 ? ru.testAdmin.saveRefused : ru.testAdmin.saveFailed);
        return;
      }

      // Carrying the ids the rows actually have: a newly added Exercise has none
      // until it is written, and saving again without them would delete and
      // re-insert it, taking every answer given to it along with it.
      setDocument(body.document);
      setUnsaved(false);
      setNotice(ru.testAdmin.saved);
    } catch {
      setProblem(ru.testAdmin.saveFailed);
    } finally {
      setPhase('editing');
    }
  }

  async function publish() {
    setPhase('publishing');
    setNotice(null);
    setProblem(null);
    setFaults([]);
    try {
      const response = await fetch(`/api/admin/tests/${testId}/publish`, { method: 'POST' });
      const body = (await response.json().catch(() => null)) as
        { ok?: boolean; reason?: string; faults?: TestFault[] } | null;

      if (!response.ok || body?.ok !== true) {
        if (body?.reason === 'already_published') {
          setLive(true);
          setProblem(ru.testAdmin.alreadyPublished);
          return;
        }
        setFaults(body?.faults ?? []);
        setProblem(ru.testAdmin.publishRefused);
        return;
      }

      setLive(true);
      setNotice(ru.testAdmin.publishedNow);
    } catch {
      setProblem(ru.testAdmin.publishRefused);
    } finally {
      setPhase('editing');
    }
  }

  return (
    <section>
      <div className="panel">
        <Stack gap="sm">
          <TextInput
            label={ru.testAdmin.titleField}
            value={document.title}
            disabled={busy}
            onChange={(event) => edit({ title: event.currentTarget.value })}
          />

          <NumberInput
            label={ru.testAdmin.passThreshold}
            description={ru.testAdmin.passThresholdHint}
            min={1}
            max={100}
            value={document.passThreshold}
            disabled={busy}
            // An empty field is a number nobody has finished typing, not a zero.
            // It is carried as NaN and refused by the rules if it is still that at
            // the moment of saving.
            onChange={(value) => edit({ passThreshold: value === '' ? Number.NaN : Number(value) })}
          />
        </Stack>
      </div>

      <ExerciseList
        exercises={document.exercises}
        submissionCounts={submissionCounts}
        disabled={busy}
        pending={pending}
        setPending={(next) => setPending(next === null || next.what === 'publish' ? null : next)}
        onChange={(exercises) => edit({ exercises })}
      />

      <p className="actions">
        <Button onClick={save} disabled={busy}>
          {phase === 'saving' ? ru.testAdmin.saving : ru.testAdmin.save}
        </Button>
        {live ? null : (
          <Button variant="default" onClick={publish} disabled={busy || unsaved}>
            {phase === 'publishing' ? ru.testAdmin.publishing : ru.testAdmin.publish}
          </Button>
        )}
      </p>
      {!live && unsaved ? <p className="muted">{ru.testAdmin.publishAfterSave}</p> : null}

      {problem === null ? null : <p className="error" role="alert">{problem}</p>}
      <FaultList faults={faults} />
      {notice === null ? null : <p className="ok" role="status">{notice}</p>}
    </section>
  );
}
