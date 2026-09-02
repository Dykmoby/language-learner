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
import { ru, faultMessage } from '../../ru.ts';
import { CEFR_LEVELS, GRADER_MODELS, DEFAULT_GRADER_MODEL } from '../../content/course-options.ts';
import { LANGUAGES, type Language } from '../../grader/contract.ts';
import type { Effort } from '../../claude/effort.ts';
import { GraderEffortPicker } from './grader-effort-picker.tsx';

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
      <label>
        <span>{ru.admin.courseTitleField}</span>
        <input
          type="text"
          value={title}
          onChange={(e) => { setTitle(e.target.value); setFaults([]); }}
          disabled={busy}
        />
      </label>

      <label>
        <span>{ru.admin.languageField}</span>
        <select value={language} onChange={(e) => chooseLanguage(e.target.value as Language)} disabled={busy}>
          {LANGUAGES.map((code) => (
            <option key={code} value={code}>{ru.languages[code] ?? code}</option>
          ))}
        </select>
      </label>

      <label>
        <span>{ru.admin.levelField}</span>
        <select value={level} onChange={(e) => setLevel(e.target.value)} disabled={busy}>
          {CEFR_LEVELS.map((one) => <option key={one} value={one}>{one}</option>)}
        </select>
      </label>
      <p className="muted">{ru.admin.levelHint}</p>

      <label>
        <span>{ru.admin.graderModelField}</span>
        <select
          value={graderModel}
          onChange={(e) => { setGraderModel(e.target.value); setModelChosen(true); }}
          disabled={busy}
        >
          {GRADER_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
      </label>
      <p className="muted">{ru.admin.graderModelHint}</p>

      <GraderEffortPicker effort={graderEffort} disabled={busy} onEffort={setGraderEffort} />

      {problem === null ? null : <p className="error" role="alert">{problem}</p>}
      {faults.length === 0 ? null : (
        <ul className="cards">
          {faults.map((code) => <li key={code} className="error">{faultMessage(code)}</li>)}
        </ul>
      )}

      <p className="actions">
        <button type="button" onClick={create} disabled={busy}>
          {busy ? ru.admin.creatingCourse : ru.admin.createCourse}
        </button>
      </p>
    </>
  );
}
