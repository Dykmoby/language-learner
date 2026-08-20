import { notFound } from 'next/navigation';
import { ru } from '../../../ru.ts';
import { currentStudent } from '../../../auth/current-student.ts';
import { HealthPanel } from './panel.tsx';

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  const student = await currentStudent();
  // For a Student who is not an Admin, this page does not exist. Refusing with a
  // 404 rather than a "forbidden" screen says nothing about what is behind it.
  if (!student?.isAdmin) notFound();

  return (
    <main>
      <h1>{ru.health.title}</h1>
      <p className="muted">{ru.health.explanation}</p>
      <HealthPanel />
      <p><a href="/">{ru.appName}</a></p>
    </main>
  );
}
