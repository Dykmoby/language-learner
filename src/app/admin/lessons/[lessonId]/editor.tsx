'use client';

// Theory, edited beside its preview.
//
// The preview renders through the same renderer the Student's Theory screen
// uses, never a second one written for the editor. Two renderers disagree
// eventually, and the one the Admin trusted would be the one the Student never
// saw. That renderer escapes its whole input before it writes a single tag, so
// what it returns is safe to insert by construction rather than by sanitising —
// which is what makes the preview possible at all.

import { useState } from 'react';
import { ru, faultMessage } from '../../../../ru.ts';
import { renderTheory } from '../../../../content/markdown.ts';
import type { DocumentFault, LessonTheory } from '../../../../content/lesson-document.ts';

type Props = {
  lessonId: number;
  initial: LessonTheory;
  draftId: number | null;
  hasUnpublishedChanges: boolean;
};

type Phase = 'editing' | 'saving' | 'publishing';

export function DraftEditor({ lessonId, initial, draftId, hasUnpublishedChanges }: Props) {
  const [theory, setTheory] = useState<LessonTheory>(initial);
  const [phase, setPhase] = useState<Phase>('editing');
  const [savedDraftId, setSavedDraftId] = useState<number | null>(draftId);
  const [ahead, setAhead] = useState(hasUnpublishedChanges);
  // Typed-but-not-saved. Without it, Publish would send the id of the last saved
  // Draft while the Admin looked at newer text, and report success — the worst
  // shape this mistake can take, because nothing looks wrong afterwards.
  const [unsaved, setUnsaved] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [faults, setFaults] = useState<DocumentFault[]>([]);

  const busy = phase !== 'editing';
  // Publishing is only ever offered for a Draft that is saved and not yet live.
  const canPublish = savedDraftId !== null && ahead && !unsaved;

  function edit(patch: Partial<LessonTheory>) {
    setTheory((current) => ({ ...current, ...patch }));
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
      const response = await fetch(`/api/admin/lessons/${lessonId}/draft`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(theory),
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { draftId: number };
      setSavedDraftId(body.draftId);
      setAhead(true);
      setUnsaved(false);
      setNotice(ru.draft.saved);
    } catch {
      setProblem(ru.draft.saveFailed);
    } finally {
      setPhase('editing');
    }
  }

  async function publish() {
    if (!canPublish) {
      setProblem(unsaved ? ru.draft.saveFirst : ru.draft.nothingToPublish);
      return;
    }
    setPhase('publishing');
    setNotice(null);
    setProblem(null);
    setFaults([]);
    try {
      const response = await fetch(`/api/admin/lessons/${lessonId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftId: savedDraftId }),
      });
      const body = (await response.json()) as
        { ok?: boolean; reason?: string; faults?: DocumentFault[] };
      if (!response.ok || body.ok !== true) {
        setFaults(body.faults ?? []);
        // Already live means this tab is a step behind, not that the work is
        // wrong — saying "исправьте и попробуйте снова" would send the Admin
        // hunting for a mistake that is not there.
        setProblem(body.reason === 'already_published' ? ru.draft.alreadyPublished : ru.draft.publishRefused);
        if (body.reason === 'already_published') setAhead(false);
        return;
      }
      setAhead(false);
      setNotice(ru.draft.publishedNow);
    } catch {
      setProblem(ru.draft.publishRefused);
    } finally {
      setPhase('editing');
    }
  }

  return (
    <>
      <p className="muted">
        {unsaved ? ru.draft.unsaved : ahead ? ru.draft.unpublishedChanges : ru.draft.upToDate}
      </p>

      <label>
        <span>{ru.draft.lessonTitle}</span>
        <input
          type="text"
          value={theory.title}
          onChange={(e) => edit({ title: e.target.value })}
          disabled={busy}
        />
      </label>

      <label>
        <span>{ru.draft.grammarFocus}</span>
        <input
          type="text"
          value={theory.grammarFocus}
          onChange={(e) => edit({ grammarFocus: e.target.value })}
          disabled={busy}
        />
      </label>
      <p className="muted">{ru.draft.grammarFocusHint}</p>

      <label>
        <span>{ru.draft.theory}</span>
        <textarea
          rows={16}
          value={theory.theoryMarkdown}
          onChange={(e) => edit({ theoryMarkdown: e.target.value })}
          disabled={busy}
        />
      </label>

      {problem === null ? null : <p className="error" role="alert">{problem}</p>}
      {faults.length === 0 ? null : (
        <ul className="cards">
          {faults.map((fault, index) => (
            <li key={`${fault.code}-${index}`} className="error">
              {fault.exercisePosition === undefined
                ? null
                : `${ru.draft.faultAt(fault.exercisePosition)} `}
              {faultMessage(fault.code)}
            </li>
          ))}
        </ul>
      )}
      {notice === null ? null : <p className="ok" role="status">{notice}</p>}

      <p className="actions">
        <button type="button" onClick={save} disabled={busy}>
          {phase === 'saving' ? ru.draft.saving : ru.draft.save}
        </button>
        <button type="button" className="secondary" onClick={publish} disabled={busy || !canPublish}>
          {phase === 'publishing' ? ru.draft.publishing : ru.draft.publish}
        </button>
      </p>

      <p className="muted">{ru.draft.exercisesNotEditable}</p>

      <h2>{ru.draft.preview}</h2>
      <div
        className="theory"
        // Safe by construction: renderTheory escapes the whole source before it
        // writes any tag, so the only angle brackets here are ones it wrote.
        dangerouslySetInnerHTML={{ __html: renderTheory(theory.theoryMarkdown) }}
      />
    </>
  );
}
