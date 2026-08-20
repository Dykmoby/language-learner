import { redirect } from 'next/navigation';
import { ru } from '../ru.ts';
import { currentStudent } from '../auth/current-student.ts';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const student = await currentStudent();
  // The middleware has already turned away anyone without a session; this is the
  // narrowing, not a second gate.
  if (!student) redirect('/login');

  return (
    <main>
      <h1>{ru.appName}</h1>
      <p>
        {ru.home.signedInAs(student.username)}
        {student.isAdmin ? <> <strong>{ru.home.adminBadge}</strong></> : null}
      </p>
      <p className="muted">{ru.home.noCourses}</p>
      {student.isAdmin ? <p><a href="/admin/health">{ru.home.healthLink}</a></p> : null}
      <form method="post" action="/api/logout">
        <button type="submit">{ru.common.signOut}</button>
      </form>
    </main>
  );
}
