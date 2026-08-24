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
import { ru } from '../../../../ru.ts';
import { renderTheory } from '../../../../content/markdown.ts';
import type { DocumentFault, LessonDocument } from '../../../../content/lesson-document.ts';
import type { DraftOrigin } from '../../../../db/schema.ts';
import { ExerciseList } from '../../forms/exercises.tsx';
import { FaultList } from '../../forms/faults.tsx';
import { GeneratePanel, type EarlierLessonChoice } from './generate.tsx';
import { RefinePanel, type Turn } from './refine.tsx';
import type { Pending } from '../../forms/pending.ts';
import { ImageUpload } from './image-upload.tsx';

type Props = {
  lessonId: number;
  initial: LessonDocument;
  draftId: number | null;
  hasUnpublishedChanges: boolean;
  neverPublished: boolean;
  submissionCounts: Record<number, number>;
  maxUploadBytes: number;
  /** Published Lessons of this Course a Generation may be told to continue from. */
  earlierLessons: EarlierLessonChoice[];
  /** The Course's own Grader model, offered first because it is the one this Course trusts. */
  defaultAuthorModel: string;
  /** The conversation so far, read back out of the Drafts it produced. */
  refinementTurns: Turn[];
  /** What made the Draft that is open, or null on a Lesson never saved. */
  origin: DraftOrigin | null;
};

type Phase = 'editing' | 'saving' | 'publishing';

export function DraftEditor({
  lessonId, initial, draftId, hasUnpublishedChanges, neverPublished, submissionCounts, maxUploadBytes,
  earlierLessons, defaultAuthorModel, refinementTurns, origin,
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
  // The form's one pending confirmation. Held here rather than inside the control
  // that raises it, so a Kind change, an Exercise removal and a Publish can never
  // be waiting on the author at the same time.
  const [pending, setPending] = useState<Pending | null>(null);
  // What made the Draft on the screen. It changes under the Admin as they save,
  // generate or refine, so it is state rather than the prop it started as.
  const [draftOrigin, setDraftOrigin] = useState<DraftOrigin | null>(origin);
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
    // A publish confirmation is a question about a particular Draft — "eight
    // Reference Answers nobody has read" — and the moment the document changes
    // it is a question about something that no longer exists. Withdrawn rather
    // than left standing, which would also strand the author: the confirmation
    // replaces the Save button, and confirming an unsaved Draft is refused.
    if (pending?.what === 'publish') setPending(null);
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

  /**
   * A Lesson that came back from Claude, whole and past every rule.
   *
   * It lands exactly as a save does, because it *is* a save: the Draft was
   * appended server-side before this ran, so the editor is catching up with a row
   * rather than holding unsaved work. That is why `unsaved` goes false and
   * Publish becomes available — and the deliberate second act is still the only
   * thing that reaches a Student.
   */
  function acceptAuthored(
    document: LessonDocument,
    authoredDraftId: number,
    authoredOrigin: DraftOrigin,
  ) {
    setDraft(document);
    setSavedDraftId(authoredDraftId);
    setDraftOrigin(authoredOrigin);
    setAhead(true);
    setUnsaved(false);
    setNotice(null);
    setProblem(null);
    setFaults([]);
    setPending(null);
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
      // A save is a manual edit whatever the Draft it started from was, and the
      // badge has to say so: an Admin who has been through every Exercise by hand
      // is no longer looking at what Claude wrote.
      setDraftOrigin('manual');
      setAhead(true);
      setUnsaved(false);
      setNotice(ru.draft.saved);
    } catch {
      setProblem(ru.draft.saveFailed);
    } finally {
      setPhase('editing');
    }
  }

  /**
   * Publishing, and the one question it may ask first.
   *
   * The question comes from the server rather than from a check here: it is the
   * last point before a Student reads the Lesson, and a tab open since before a
   * Refinement landed would otherwise be answering about a Draft that no longer
   * exists. `confirmed` is the answer travelling back on the same request.
   */
  async function publish(confirmed = false) {
    if (!canPublish) {
      setPending(null);
      setProblem(unsaved ? ru.draft.saveFirst : ru.draft.nothingToPublish);
      return;
    }
    setPhase('publishing');
    setNotice(null);
    setProblem(null);
    setFaults([]);
    setPending(null);
    try {
      const response = await fetch(`/api/admin/lessons/${lessonId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ draftId: savedDraftId, confirmed }),
      });
      const body = (await response.json()) as
        { ok?: boolean; reason?: string; faults?: DocumentFault[]; unreviewed?: number };
      if (!response.ok || body.ok !== true) {
        // Not a refusal: a question. Nothing is wrong with the Draft, and saying
        // «исправьте и попробуйте снова» about it would be false.
        if (body.reason === 'unreviewed') {
          setPending({ what: 'publish', unreviewed: body.unreviewed ?? 0 });
          return;
        }
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
      {/* What made this Draft, said wherever a Draft is shown. Until now a Draft
          an Admin wrote every word of and one Claude produced thirty seconds ago
          were indistinguishable here. */}
      {draftOrigin === null ? null : (
        <p><span className="madeBy">{ru.draft.madeBy(ru.draftOrigins[draftOrigin] ?? draftOrigin)}</span></p>
      )}

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

      {/* A generated Lesson lands here exactly as a save does: the Draft is
          already appended server-side, so the editor is catching up with a row
          rather than holding unsaved work. That is why `unsaved` goes false and
          Publish becomes available — the deliberate second act is still the only
          thing that reaches a Student. */}
      <GeneratePanel
        lessonId={lessonId}
        earlier={earlierLessons}
        defaultModel={defaultAuthorModel}
        disabled={busy}
        onGenerated={(document, id) => acceptAuthored(document, id, 'generation')}
      />

      {/* The document it is handed is `draft` — whatever is in the editor at this
          moment, hand edits included — and the Draft it forks from is the one on
          the screen. Both are what make editing and conversing interleave. */}
      <RefinePanel
        lessonId={lessonId}
        document={draft}
        fromDraftId={savedDraftId}
        initialTurns={refinementTurns}
        defaultModel={defaultAuthorModel}
        disabled={busy}
        onRefined={(document, id) => acceptAuthored(document, id, 'refinement')}
      />

      <ExerciseList
        exercises={draft.exercises}
        submissionCounts={submissionCounts}
        disabled={busy}
        pending={pending}
        setPending={setPending}
        onChange={(exercises) => edit({ exercises })}
      />

      {problem === null ? null : <p className="error" role="alert">{problem}</p>}
      <FaultList faults={faults} />
      {notice === null ? null : <p className="ok" role="status">{notice}</p>}

      {pending?.what === 'publish' ? (
        <>
          {/* A count, and the specific thing it points at. "Вы уверены?" is a
              click tax; naming how many Reference Answers nobody has read is
              information — and a Reference Answer is what the Grader receives as
              the model answer on every Submission made against that Exercise, so
              a wrong one poisons grading silently and for good. */}
          <p className="error" role="alert">{ru.draft.publishUnreviewed(pending.unreviewed)}</p>
          <p className="actions">
            <button type="button" onClick={() => publish(true)} disabled={busy}>
              {ru.draft.confirmPublish}
            </button>
            <button type="button" className="secondary" onClick={() => setPending(null)} disabled={busy}>
              {ru.draft.cancelPublish}
            </button>
          </p>
        </>
      ) : (
        <p className="actions">
          <button type="button" onClick={save} disabled={busy}>
            {phase === 'saving' ? ru.draft.saving : ru.draft.save}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => publish()}
            disabled={busy || !canPublish}
          >
            {phase === 'publishing' ? ru.draft.publishing : ru.draft.publish}
          </button>
        </p>
      )}

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
