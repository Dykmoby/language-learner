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
import type { DocumentFault } from '../../../../content/lesson-document.ts';

type Theory = { title: string; grammarFocus: string; theoryMarkdown: string };

type Props = {
  lessonId: number;
  initial: Theory;
  draftId: number | null;
  hasUnpublishedChanges: boolean;
};

type Phase = 'editing' | 'saving' | 'publishing';

export function DraftEditor({ lessonId, initial, draftId, hasUnpublishedChanges }: Props) {
  const [theory, setTheory] = useState<Theory>(initial);
  const [phase, setPhase] = useState<Phase>('editing');
  const [savedDraftId, setSavedDraftId] = useState<number | null>(draftId);
  const [ahead, setAhead] = useState(hasUnpublishedChanges);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [faults, setFaults] = useState<DocumentFault[]>([]);

  const busy = phase !== 'editing';

  function edit(patch: Partial<Theory>) {
    setTheory((current) => ({ ...current, ...patch }));
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
      setNotice(ru.draft.saved);
    } catch {
      setProblem(ru.draft.saveFailed);
    } finally {
      setPhase('editing');
    }
  }

  async function publish() {
    if (savedDraftId === null) {
      setProblem(ru.draft.nothingToPublish);
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
      const body = (await response.json()) as { ok?: boolean; faults?: DocumentFault[] };
      if (!response.ok || body.ok !== true) {
        setFaults(body.faults ?? []);
        setProblem(ru.draft.publishRefused);
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
      <p className="muted">{ahead ? ru.draft.unpublishedChanges : ru.draft.upToDate}</p>

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
        <button type="button" className="secondary" onClick={publish} disabled={busy || savedDraftId === null}>
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
