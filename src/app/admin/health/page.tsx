import { ru } from '../../../ru.ts';
import { requireAdmin } from '../../../admin/guard.ts';
import { getDatabase } from '../../../db/index.ts';
import { currentHealthStanding } from '../../../ops/health-history.ts';
import { HealthBanner } from '../health-banner.tsx';
import { HealthPanel } from './panel.tsx';

export const dynamic = 'force-dynamic';

export default async function HealthPage() {
  // For a Student who is not an Admin, this page does not exist — the same
  // refusal as every other page in the Admin section, from the same place.
  await requireAdmin();

  // The last recorded run, shown before the button is pressed — so the page
  // opens with an answer rather than asking for another paid call to have one.
  const { db } = getDatabase();

  return (
    <main>
      <h1>{ru.health.title}</h1>
      <HealthBanner standing={currentHealthStanding(db)} />
      <p className="muted">{ru.health.explanation}</p>
      <HealthPanel />
      <p><a href="/admin">{ru.admin.back}</a></p>
    </main>
  );
}
