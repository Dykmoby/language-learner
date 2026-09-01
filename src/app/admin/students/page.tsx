// Who has an account here.
//
// A screen of its own rather than a section of the Admin dashboard, beside the
// Disputes queue and the health check: it is about people rather than about
// content, and the dashboard is the spine that authoring hangs off.

import { ru } from '../../../ru.ts';
import { requireAdmin } from '../../../admin/guard.ts';
import { getDatabase } from '../../../db/index.ts';
import { everyStudent } from '../../../admin/catalogue.ts';
import { StudentsAdmin } from './students-admin.tsx';

export const dynamic = 'force-dynamic';

export default async function AdminStudentsPage() {
  const admin = await requireAdmin();

  const { db } = getDatabase();

  return (
    <main>
      <h1>{ru.admin.accountsTitle}</h1>

      <StudentsAdmin
        actingStudentId={admin.id}
        initialAccounts={everyStudent(db).map(({ student, enrollmentCount }) => ({
          id: student.id,
          username: student.username,
          isAdmin: student.isAdmin,
          passwordIsTemporary: student.passwordIsTemporary,
          enrollmentCount,
          // Formatted here rather than in the browser: a client component that
          // formatted a date itself would render one string on the server and
          // another in the browser, and React calls that a hydration error.
          createdAt: new Date(student.createdAt).toLocaleString(ru.locale),
        }))}
      />

      <p><a href="/admin">{ru.admin.back}</a></p>
    </main>
  );
}
