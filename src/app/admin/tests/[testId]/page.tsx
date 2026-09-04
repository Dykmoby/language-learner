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
import { Crumb } from '../../../shared/crumb.tsx';

export const dynamic = 'force-dynamic';

export default async function AdminTestPage({ params }: { params: Promise<{ testId: string }> }) {
  await requireAdmin();

  const testId = Number((await params).testId);
  const { db } = getDatabase();
  const open = Number.isInteger(testId) ? adminTest(db, testId) : null;
  if (!open) notFound();

  return (
    <main>
      <div className="pageHead">
        <div>
          <Crumb href={`/admin/courses/${open.course.id}`}>{open.course.title}</Crumb>
          <h1>{open.document.title}</h1>
          <p className="facts">
            <span>{ru.testAdmin.title}</span>
            <span>{ru.admin.exerciseCount(open.document.exercises.length)}</span>
            <span>{open.test.publishedAt === null ? ru.testAdmin.unpublished : ru.testAdmin.published}</span>
          </p>
        </div>
      </div>

      <div className="notice">
        <p>{ru.testAdmin.explanation}</p>
        <p className="muted">{ru.testAdmin.gatesNothing}</p>
      </div>

      <TestEditor
        testId={open.test.id}
        initial={open.document}
        published={open.test.publishedAt !== null}
        submissionCounts={open.submissionCounts}
      />

    </main>
  );
}
