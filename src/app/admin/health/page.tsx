import { ru } from '../../../ru.ts';
import { requireAdmin } from '../../../admin/guard.ts';
import { HealthPanel } from './panel.tsx';

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  // For a Student who is not an Admin, this page does not exist — the same
  // refusal as every other page in the Admin section, from the same place.
  await requireAdmin();

  return (
    <main>
      <h1>{ru.health.title}</h1>
      <p className="muted">{ru.health.explanation}</p>
      <HealthPanel />
      <p><a href="/admin">{ru.admin.back}</a></p>
    </main>
  );
}
