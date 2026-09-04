// The Draft editor for one Lesson.
//
// Seeded from the newest Draft, or from the published content where the Lesson
// has never been edited. Opening this page writes nothing: a Draft comes into
// existence when the Admin saves, not because they looked at a Lesson.

import { notFound } from 'next/navigation';
import { ru } from '../../../../ru.ts';
import { requireAdmin } from '../../../../admin/guard.ts';
import { getDatabase } from '../../../../db/index.ts';
import { openDraft, publishedLessonsUpTo, refinementThread } from '../../../../admin/drafts.ts';
import { config } from '../../../../config.ts';
import { Crumb } from '../../../shared/crumb.tsx';
import { DraftEditor } from './editor.tsx';

export const dynamic = 'force-dynamic';

export default async function DraftPage({ params }: { params: Promise<{ lessonId: string }> }) {
  await requireAdmin();

  const lessonId = Number((await params).lessonId);
  const { db } = getDatabase();
  const open = Number.isInteger(lessonId) ? openDraft(db, lessonId) : null;
  if (!open) notFound();

  // Every published Lesson at or before this one, so "continue from Lesson N"
  // offers only Lessons a Student has actually been able to read. This Lesson is
  // included where it is itself published: rewriting a live Lesson to continue
  // from itself is a real thing an Admin does.
  const earlier = publishedLessonsUpTo(db, lessonId)
    .map((lesson) => ({ id: lesson.id, title: lesson.title }));

  return (
    <main>
      <div className="pageHead">
        <div>
          <Crumb href={`/admin/courses/${open.course.id}`}>{open.course.title}</Crumb>
          <h1>{open.lesson.title}</h1>
          <p className="facts">
            <span>{ru.draft.title}</span>
            <span>{ru.draft.exerciseCount(open.document.exercises.length)}</span>
          </p>
        </div>
        <p className="actions">
          <a className="button secondary" href={`/admin/lessons/${lessonId}/history`}>{ru.draft.historyTitle}</a>
        </p>
      </div>

      <DraftEditor
        lessonId={lessonId}
        initial={open.document}
        draftId={open.draftId}
        hasUnpublishedChanges={open.hasUnpublishedChanges}
        neverPublished={open.neverPublished}
        submissionCounts={open.submissionCounts}
        maxUploadBytes={config.uploads.maxBytes}
        earlierLessons={earlier}
        defaultAuthorModel={open.course.graderModel}
        origin={open.origin}
        refinementTurns={refinementThread(db, lessonId)
          .map((turn) => ({ draftId: turn.draftId, message: turn.message }))}
      />


    </main>
  );
}
