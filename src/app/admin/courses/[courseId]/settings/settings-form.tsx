'use client';

// The editable half of a Course, and the half that only reports.
//
// The Language and the level are rendered as text rather than as disabled
// controls: a greyed-out `<select>` reads as "not right now", and these two are
// never editable at all. Saying so in a sentence is the honest version.
//
// Refusals arrive as stable codes and are shown all at once, which is the New
// Course form's idiom — an Admin fixes a form rather than one field per attempt.

import { useState } from 'react';
import { ru, faultMessage } from '../../../../../ru.ts';
import { COURSE_INSTRUCTION_MAX_LENGTH, GRADER_MODELS } from '../../../../../content/course-options.ts';
import type { Effort } from '../../../../../claude/effort.ts';
import { GraderEffortPicker } from '../../../grader-effort-picker.tsx';

type Props = {
  courseId: number;
  initialTitle: string;
  initialGraderModel: string;
  /** `null` is «По умолчанию» — the parameter is not sent to the model at all. */
  initialGraderEffort: Effort | null;
  /** This Course's own instruction for the Grader. Empty where it has none. */
  initialGraderInstruction: string;
  /** Already in Russian, and already not editable. */
  language: string;
  level: string;
};

export function CourseSettingsForm({
  courseId, initialTitle, initialGraderModel, initialGraderEffort, initialGraderInstruction,
  language, level,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [graderModel, setGraderModel] = useState(initialGraderModel);
  const [graderEffort, setGraderEffort] = useState<Effort | null>(initialGraderEffort);
  const [graderInstruction, setGraderInstruction] = useState(initialGraderInstruction);
  const [busy, setBusy] = useState(false);
  const [faults, setFaults] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setFaults([]);
      setProblem(null);
      setSaved(false);
    };
  }

  async function save() {
    setBusy(true);
    setFaults([]);
    setProblem(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/admin/courses/${courseId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, graderModel, graderEffort, graderInstruction }),
      });
      const body = (await response.json().catch(() => null)) as
        { ok?: boolean; faults?: string[] } | null;

      if (response.ok && body?.ok === true) {
        setSaved(true);
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
          onChange={(e) => edited(setTitle)(e.target.value)}
          disabled={busy}
        />
      </label>

      <p>{ru.admin.languageFixed(language)}</p>
      <p>{ru.admin.levelFixed(level)}</p>
      <p className="muted">{ru.admin.fixedFactsHint}</p>

      <label>
        <span>{ru.admin.graderModelField}</span>
        <select
          value={graderModel}
          onChange={(e) => edited(setGraderModel)(e.target.value)}
          disabled={busy}
        >
          {/* Haiku is absent by construction, per ADR 0002 — it cannot be
              offered because it is not on this list, and the write refuses it by
              name because a list is not a rule. */}
          {GRADER_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
      </label>
      <p className="muted">{ru.admin.graderModelChangeHint}</p>

      <GraderEffortPicker
        effort={graderEffort}
        disabled={busy}
        onEffort={(next) => edited(setGraderEffort)(next)}
      />

      {/* Issue #80 — plain text, not markdown: this goes into a prompt, not onto
          a page. There is no «Вернуть исходный текст» beside it, and nothing is
          hidden by its absence: what a Course ships with is the empty string, so
          emptying the field *is* restoring the default, and a button that typed
          nothing into an already-empty field would only suggest there was some
          remembered text behind it. */}
      <h2>{ru.admin.graderInstructionTitle}</h2>
      <p className="muted">{ru.admin.graderInstructionExplanation}</p>
      <p className="muted">{ru.admin.graderInstructionPrecedence}</p>
      <label>
        <span>{ru.admin.graderInstructionField}</span>
        <textarea
          value={graderInstruction}
          rows={10}
          maxLength={COURSE_INSTRUCTION_MAX_LENGTH}
          onChange={(e) => edited(setGraderInstruction)(e.target.value)}
          disabled={busy}
        />
      </label>
      <p className="muted">{ru.admin.graderInstructionHint(COURSE_INSTRUCTION_MAX_LENGTH)}</p>

      {problem === null ? null : <p className="error" role="alert">{problem}</p>}
      {faults.length === 0 ? null : (
        <ul className="cards">
          {faults.map((code) => <li key={code} className="error">{faultMessage(code)}</li>)}
        </ul>
      )}
      {saved ? <p className="ok" role="status">{ru.admin.settingsSaved}</p> : null}

      <p className="actions">
        <button type="button" onClick={save} disabled={busy}>
          {busy ? ru.admin.savingSettings : ru.admin.saveSettings}
        </button>
      </p>
    </>
  );
}
