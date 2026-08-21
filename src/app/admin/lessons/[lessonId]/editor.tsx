'use client';

// The Draft editor: a whole Lesson — Theory beside its preview, and the Practice
// beneath it.
//
// The preview renders through the same renderer the Student's Theory screen
// uses, never a second one written for the editor. Two renderers disagree
// eventually, and the one the Admin trusted would be the one the Student never
// saw. That renderer escapes its whole input before it writes a single tag, so
// what it returns is safe to insert by construction rather than by sanitising —
// which is what makes the preview possible at all.
//
// What is saved is the whole document, Exercises included: ADR 0004 settles that
// shape, and Refinement will exchange exactly this each turn.

import { useRef, useState } from 'react';
import { ru, faultMessage } from '../../../../ru.ts';
import { renderTheory } from '../../../../content/markdown.ts';
import type { DocumentFault, LessonDocument } from '../../../../content/lesson-document.ts';
import { ExerciseList } from './exercises.tsx';
import { ImageUpload } from './image-upload.tsx';

type Props = {
  lessonId: number;
  initial: LessonDocument;
  draftId: number | null;
  hasUnpublishedChanges: boolean;
  neverPublished: boolean;
  submissionCounts: Record<number, number>;
  maxUploadBytes: number;
};

type Phase = 'editing' | 'saving' | 'publishing';

export function DraftEditor({
  lessonId, initial, draftId, hasUnpublishedChanges, neverPublished, submissionCounts, maxUploadBytes,
}: Props) {
  const [draft, setDraft] = useState<LessonDocument>(initial);
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
  const theoryRef = useRef<HTMLTextAreaElement | null>(null);

  const busy = phase !== 'editing';
  // Publishing is only ever offered for a Draft that is saved and not yet live.
  const canPublish = savedDraftId !== null && ahead && !unsaved;

  function edit(patch: Partial<LessonDocument>) {
    setDraft((current) => ({ ...current, ...patch }));
    setUnsaved(true);
    setNotice(null);
    setProblem(null);
    setFaults([]);
  }

  /**
   * Puts an uploaded image's markdown where the cursor is, rather than at the
   * end: an Admin uploads a picture at the point in the Theory it belongs to.
   */
  function insertAtCursor(markdown: string) {
    const field = theoryRef.current;
    const source = draft.theoryMarkdown;
    const at = field?.selectionStart ?? source.length;
    const to = field?.selectionEnd ?? at;
    edit({ theoryMarkdown: `${source.slice(0, at)}${markdown}${source.slice(to)}` });
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
        body: JSON.stringify(draft),
      });
      const body = (await response.json().catch(() => null)) as
        { ok?: boolean; draftId?: number; faults?: DocumentFault[] } | null;

      if (!response.ok || body?.ok !== true || typeof body.draftId !== 'number') {
        // An incoherent Exercise is refused before it reaches the Draft, and the
        // Admin is told which one and why. Everything else — a 404, a 500, a
        // body that is not what this expects — is a failure rather than a
        // refusal, and must not be reported as «исправьте упражнения ниже»:
        // that sends an Admin hunting through Exercises that are all fine.
        const refused = body?.faults ?? [];
        setFaults(refused);
        setProblem(refused.length > 0 ? ru.draft.saveRefused : ru.draft.saveFailed);
        return;
      }
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
      // A Lesson published for the first time has just become visible to every
      // enrolled Student, so the banner saying it is not must go — and only the
      // server knows that, since it rendered the banner. Every other publish
      // leaves the page correct, and reloading it would throw away the notice
      // that says what just happened.
      if (neverPublished) window.location.reload();
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
      {neverPublished ? <p className="muted">{ru.draft.neverPublished}</p> : null}

      <label>
        <span>{ru.draft.lessonTitle}</span>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => edit({ title: e.target.value })}
          disabled={busy}
        />
      </label>

      <label>
        <span>{ru.draft.grammarFocus}</span>
        <input
          type="text"
          value={draft.grammarFocus}
          onChange={(e) => edit({ grammarFocus: e.target.value })}
          disabled={busy}
        />
      </label>
      <p className="muted">{ru.draft.grammarFocusHint}</p>

      <label>
        <span>{ru.draft.theory}</span>
        <textarea
          ref={theoryRef}
          rows={16}
          value={draft.theoryMarkdown}
          onChange={(e) => edit({ theoryMarkdown: e.target.value })}
          disabled={busy}
        />
      </label>

      <ImageUpload maxBytes={maxUploadBytes} disabled={busy} onInsert={insertAtCursor} />

      <ExerciseList
        exercises={draft.exercises}
        submissionCounts={submissionCounts}
        disabled={busy}
        onChange={(exercises) => edit({ exercises })}
      />

      {problem === null ? null : <p className="error" role="alert">{problem}</p>}
      {faults.length === 0 ? null : (
        <ul className="cards">
          {faults.map((fault, index) => (
            <li key={`${fault.code}-${index}`} className="error">
              {fault.exercisePosition === undefined
                ? null
                : `${ru.draft.faultAt(fault.exercisePosition)} `}
              {faultMessage(fault.code)}
              {fault.offending === undefined ? null : ` — ${fault.offending}`}
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

      <h2>{ru.draft.preview}</h2>
      <div
        className="theory"
        // Safe by construction: renderTheory escapes the whole source before it
        // writes any tag, so the only angle brackets here are ones it wrote.
        dangerouslySetInnerHTML={{ __html: renderTheory(draft.theoryMarkdown) }}
      />
    </>
  );
}
