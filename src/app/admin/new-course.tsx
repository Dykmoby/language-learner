'use client';

// Creating a Course: Language, CEFR level, title, and the model that will grade
// every free-form answer in it.
//
// The Grader model follows the Language until an Admin says otherwise, which is
// ADR 0002 expressed as a default rather than as a rule nobody can override. The
// list it is chosen from holds two models and never Haiku — the ADR's finding is
// that a grader teaching false morphology with confidence is worse than no
// grader, so the option is absent rather than discouraged.

import { useState } from 'react';
import { Button, Group, NativeSelect, Stack, TextInput } from '@mantine/core';
import { ru, faultMessage } from '../../ru.ts';
import { CEFR_LEVELS, GRADER_MODELS, DEFAULT_GRADER_MODEL } from '../../content/course-options.ts';
import { LANGUAGES, type Language } from '../../grader/contract.ts';
import type { Effort } from '../../claude/effort.ts';
import { EffortSelect } from './effort-select.tsx';

export function NewCourseForm() {
  const [language, setLanguage] = useState<Language>('en');
  const [level, setLevel] = useState<string>(CEFR_LEVELS[0]);
  const [title, setTitle] = useState('');
  const [graderModel, setGraderModel] = useState<string>(DEFAULT_GRADER_MODEL.en);
  // `low` rather than «По умолчанию», and deliberately: it is what every Course
  // in the system grades at, so a new Course starts out judged like its
  // neighbours instead of at whatever the model happens to choose.
  const [graderEffort, setGraderEffort] = useState<Effort | null>('low');
  // Once an Admin has chosen a model, changing the Language must not quietly
  // take that choice back.
  const [modelChosen, setModelChosen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [faults, setFaults] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  function chooseLanguage(next: Language) {
    setLanguage(next);
    if (!modelChosen) setGraderModel(DEFAULT_GRADER_MODEL[next]);
    setFaults([]);
    setProblem(null);
  }

  async function create() {
    setBusy(true);
    setFaults([]);
    setProblem(null);
    try {
      const response = await fetch('/api/admin/courses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ language, level, graderModel, graderEffort, title }),
      });
      const body = (await response.json().catch(() => null)) as
        { ok?: boolean; courseId?: number; faults?: string[] } | null;

      if (response.ok && body?.ok === true && typeof body.courseId === 'number') {
        // Straight into the Course that was just created: the next thing an
        // Admin does is add a Lesson to it.
        window.location.href = `/admin/courses/${body.courseId}`;
        return;
      }
      setFaults(body?.faults ?? []);
      if ((body?.faults ?? []).length === 0) setProblem(ru.admin.writeFailed);
    } catch {
      setProblem(ru.admin.writeFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack gap="sm">
        <TextInput
          label={ru.admin.courseTitleField}
          value={title}
          disabled={busy}
          onChange={(event) => { setTitle(event.currentTarget.value); setFaults([]); }}
        />

        <Group grow align="flex-start">
          <NativeSelect
            label={ru.admin.languageField}
            value={language}
            disabled={busy}
            onChange={(event) => chooseLanguage(event.currentTarget.value as Language)}
            data={LANGUAGES.map((code) => ({ value: code, label: ru.languages[code] ?? code }))}
          />
          <NativeSelect
            label={ru.admin.levelField}
            description={ru.admin.levelHint}
            value={level}
            disabled={busy}
            onChange={(event) => setLevel(event.currentTarget.value)}
            data={CEFR_LEVELS.map((one) => ({ value: one, label: one }))}
          />
        </Group>

        <NativeSelect
          label={ru.admin.graderModelField}
          description={ru.admin.graderModelHint}
          value={graderModel}
          disabled={busy}
          onChange={(event) => { setGraderModel(event.currentTarget.value); setModelChosen(true); }}
          data={GRADER_MODELS.map((model) => ({ value: model, label: model }))}
        />

      {/* The cost is a wait, and the person who waits is not the person
          choosing — so the hint names it. The Practice screen tells the Student
          the other half. */}
        <EffortSelect
          label={ru.admin.graderEffortField}
          hint={ru.admin.graderEffortHint}
          effort={graderEffort}
          disabled={busy}
          onEffort={setGraderEffort}
        />
      </Stack>

      {problem === null ? null : <p className="error" role="alert">{problem}</p>}
      {faults.length === 0 ? null : (
        <ul className="cards">
          {faults.map((code) => <li key={code} className="error">{faultMessage(code)}</li>)}
        </ul>
      )}

      <p className="actions">
        <Button onClick={create} disabled={busy}>
          {busy ? ru.admin.creatingCourse : ru.admin.createCourse}
        </Button>
      </p>
    </>
  );
}
