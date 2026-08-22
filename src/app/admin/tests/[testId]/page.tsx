// One Test, from an author's side.
//
// There is no Draft behind this screen and nothing is seeded from one: a Test is
// its rows, and what is on the form is what is written. The publish decides only
// whether a Student can open it.

import { notFound } from 'next/navigation';
import { ru } from '../../../../ru.ts';
import { requireAdmin } from '../../../../admin/guard.ts';
import { getDatabase } from '../../../../db/index.ts';
import { adminTest } from '../../../../admin/tests.ts';
import { TestEditor } from './test-editor.tsx';

export const dynamic = 'force-dynamic';

export default async function AdminTestPage({ params }: { params: Promise<{ testId: string }> }) {
  await requireAdmin();

  const testId = Number((await params).testId);
  const { db } = getDatabase();
  const open = Number.isInteger(testId) ? adminTest(db, testId) : null;
  if (!open) notFound();

  return (
    <main>
      <h1>{ru.testAdmin.title}</h1>
      <p className="muted">
        {open.course.title}
        {' · '}{ru.admin.exerciseCount(open.document.exercises.length)}
        {' · '}{open.test.publishedAt === null ? ru.testAdmin.unpublished : ru.testAdmin.published}
      </p>
      <p className="muted">{ru.testAdmin.explanation}</p>
      <p className="muted">{ru.testAdmin.gatesNothing}</p>

      <TestEditor
        testId={open.test.id}
        initial={open.document}
        published={open.test.publishedAt !== null}
        submissionCounts={open.submissionCounts}
      />

      <p><a href={`/admin/courses/${open.course.id}`}>{ru.testAdmin.backToCourse}</a></p>
    </main>
  );
}
