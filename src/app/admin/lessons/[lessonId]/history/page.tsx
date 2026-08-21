// Every Draft of a Lesson, newest first, and what each of them held.
//
// Making good on the Draft's promise: "every Generation turn and every manual
// edit produces a new one, and all of them are restorable" (design.md
// § Authoring). Saving has appended rather than overwritten since the Draft
// existed, so the versions were always here; this is the surface that admits it.
//
// A diff between versions is deliberately out of scope. Showing what changed
// between two whole-document Drafts is its own piece of work with its own design
// questions, and the history is useful without it.

import { notFound } from 'next/navigation';
import { ru } from '../../../../../ru.ts';
import { requireAdmin } from '../../../../../admin/guard.ts';
import { getDatabase } from '../../../../../db/index.ts';
import { draftHistory, findDraft, openDraft } from '../../../../../admin/drafts.ts';
import { renderTheory } from '../../../../../content/markdown.ts';
import { isDeterministic } from '../../../../../content/exercise-validity.ts';
import { RestoreButton } from './restore.tsx';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ lessonId: string }>;
  searchParams: Promise<{ draft?: string }>;
};

export default async function DraftHistoryPage({ params, searchParams }: Props) {
  await requireAdmin();

  const lessonId = Number((await params).lessonId);
  const { db } = getDatabase();
  const open = Number.isInteger(lessonId) ? openDraft(db, lessonId) : null;
  if (!open) notFound();

  const history = draftHistory(db, lessonId);
  // Newest by default, so opening the history shows something rather than an
  // instruction to click. A `?draft=` naming another Lesson's version is ignored
  // rather than honoured: which Drafts exist elsewhere is not this page's
  // business.
  const asked = Number((await searchParams).draft);
  const selectedId = history.some((entry) => entry.id === asked) ? asked : history[0]?.id ?? null;
  const selected = selectedId === null ? null : findDraft(db, selectedId);

  return (
    <main>
      <h1>{ru.draft.historyTitle}</h1>
      <p className="muted">{open.course.title} · {open.lesson.title}</p>
      <p className="muted">{ru.draft.historyExplanation}</p>

      {history.length === 0 ? (
        <p className="muted">{ru.draft.historyEmpty}</p>
      ) : (
        <ul className="cards">
          {history.map((entry, index) => (
            <li key={entry.id}>
              {/* Numbered from the oldest, so a version's number never changes
                  when a newer one is appended — including by a restore. */}
              <strong>{ru.draft.historyEntry(history.length - index)}</strong>
              <span className="muted">
                {' — '}
                <time dateTime={entry.createdAt.toISOString()}>
                  {entry.createdAt.toISOString().replace('T', ' ').slice(0, 16)}
                </time>
                {' · '}{ru.draftOrigins[entry.origin] ?? entry.origin}
                {' · '}{entry.authorUsername === null
                  ? ru.draft.historyAuthorUnknown
                  : ru.draft.historyAuthor(entry.authorUsername)}
                {' · '}{ru.admin.exerciseCount(entry.exerciseCount)}
                {entry.publishedAt === null ? null : ` · ${ru.draft.historyPublished}`}
              </span>
              {' '}
              {entry.id === selectedId
                ? <span className="muted">{ru.draft.historySelected}</span>
                : <a href={`/admin/lessons/${lessonId}/history?draft=${entry.id}`}>{ru.draft.historyShow}</a>}
            </li>
          ))}
        </ul>
      )}

      {selected === null ? null : (
        <>
          <RestoreButton lessonId={lessonId} draftId={selected.id} />

          <h2>{ru.draft.historyTheory}</h2>
          <p className="muted">{selected.document.title} · {selected.document.grammarFocus}</p>
          <div
            className="theory"
            // The same renderer the Student's Theory screen uses, which escapes
            // its whole input before it writes a tag.
            dangerouslySetInnerHTML={{ __html: renderTheory(selected.document.theoryMarkdown) }}
          />

          <h2>{ru.draft.historyExercises}</h2>
          {selected.document.exercises.length === 0 ? (
            <p className="muted">{ru.draft.historyNoExercises}</p>
          ) : (
            <ol className="lessons">
              {selected.document.exercises.map((exercise, index) => (
                <li key={exercise.id ?? `at-${index}`}>
                  <span className="muted">
                    {ru.exerciseKinds[exercise.kind] ?? exercise.kind}
                    {' · '}
                    {isDeterministic(exercise.kind) ? ru.judgedBy.deterministic : ru.judgedBy.grader}
                  </span>
                  <br />
                  {exercise.prompt}
                  <br />
                  <span className="muted">{ru.draft.referenceAnswer}: {exercise.referenceAnswer}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      <p><a href={`/admin/lessons/${lessonId}`}>{ru.draft.backToDraft}</a></p>
    </main>
  );
}
