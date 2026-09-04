// Every Draft of a Lesson, newest first, and what each of them held.
//
// Making good on the Draft's promise: "every Generation turn and every manual
// edit produces a new one, and all of them are restorable" (design.md
// § Authoring). Saving has appended rather than overwritten since the Draft
// existed, so they were always here; this is the surface that admits it.
//
// A diff between two Drafts is deliberately out of scope. Showing what changed
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
import { Crumb } from '../../../../shared/crumb.tsx';

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
  // instruction to click. A `?draft=` naming another Lesson's Draft is ignored
  // rather than honoured: which Drafts exist elsewhere is not this page's
  // business.
  const asked = Number((await searchParams).draft);
  const selectedId = history.some((entry) => entry.id === asked) ? asked : history[0]?.id ?? null;
  const selected = selectedId === null ? null : findDraft(db, selectedId);

  return (
    <main>
      <div className="pageHead">
        <div>
          <Crumb href={`/admin/lessons/${lessonId}`}>{open.lesson.title}</Crumb>
          <h1>{ru.draft.historyTitle}</h1>
          <p className="muted">{ru.draft.historyExplanation}</p>
        </div>
      </div>

      {/* One section, one frame: the list of versions, then the version being
          read. They ran together, so the Theory of the chosen Draft looked like
          the tail of the list that chose it. */}
      <div className="sections">
      <section className="panel">
      <h2>{ru.draft.historyVersionsTitle}</h2>
      {history.length === 0 ? (
        <p className="muted">{ru.draft.historyEmpty}</p>
      ) : (
        <ul className="cards">
          {history.map((entry, index) => (
            <li key={entry.id}>
              {/* Numbered from the oldest, so a Draft's number never changes
                  when a newer one is appended — including by a restore. */}
              <strong>{ru.draft.historyEntry(history.length - index)}</strong>
              <span className="muted">
                {' — '}
                <time dateTime={entry.createdAt.toISOString()}>
                  {entry.createdAt.toISOString().replace('T', ' ').slice(0, 16)}
                </time>
                {' · '}<span className="madeBy">{ru.draftOrigins[entry.origin] ?? entry.origin}</span>
                {' · '}{entry.authorUsername === null
                  ? ru.draft.historyAuthorUnknown
                  : ru.draft.historyAuthor(entry.authorUsername)}
                {' · '}{ru.admin.exerciseCount(entry.exerciseCount)}
                {entry.publishedAt === null ? null : ` · ${ru.draft.historyPublished}`}
              </span>
              {/* What was asked for, on a Draft a Refinement produced. The
                  history is the conversation as much as it is the versions:
                  «доработка с Claude» says a turn happened, and this says which. */}
              {entry.refinementRequest === null
                ? null
                : <span className="muted">{' — '}{ru.refinement.asked} {entry.refinementRequest}</span>}
              {' '}
              {entry.id === selectedId
                ? <span className="muted">{ru.draft.historySelected}</span>
                : <a className="button secondary small" href={`/admin/lessons/${lessonId}/history?draft=${entry.id}`}>{ru.draft.historyShow}</a>}
            </li>
          ))}
        </ul>
      )}
      </section>

      {selected === null ? null : (
        <>
          <RestoreButton lessonId={lessonId} draftId={selected.id} />

          <section className="panel">
          <h2>{ru.draft.historyTheory}</h2>
          <p className="muted">{selected.document.title} · {selected.document.grammarFocus}</p>
          <div
            className="theory"
            // The same renderer the Student's Theory screen uses, which escapes
            // its whole input before it writes a tag.
            dangerouslySetInnerHTML={{ __html: renderTheory(selected.document.theoryMarkdown) }}
          />

          </section>

          <section className="panel">
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
                  {/* Everything the Exercise held, not merely its prompt. An
                      Admin deciding whether to restore a Draft has to be able
                      to see what it would bring back — and for a multiple choice
                      or a word order, the options and the accepted answers are
                      most of what it is. */}
                  {(exercise.choices ?? []).length === 0 ? null : (
                    <>
                      <br />
                      <span className="muted">
                        {exercise.kind === 'word_order' ? ru.draft.fragments : ru.draft.choices}
                        : {(exercise.choices ?? []).join(' · ')}
                      </span>
                    </>
                  )}
                  {(exercise.acceptedAnswers ?? []).flat().length === 0 ? null : (
                    <>
                      <br />
                      <span className="muted">
                        {exercise.kind === 'word_order' ? ru.draft.acceptedOrders : ru.draft.acceptedAnswers}
                        : {(exercise.acceptedAnswers ?? []).flat().join(' · ')}
                      </span>
                    </>
                  )}
                  {exercise.caseSensitive !== true ? null : (
                    <>
                      <br />
                      <span className="muted">{ru.draft.caseSensitive}</span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
          </section>
        </>
      )}
      </div>

    </main>
  );
}
