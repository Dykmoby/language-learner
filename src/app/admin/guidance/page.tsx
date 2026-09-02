// The grading guidance, read and edited — issue #79, ADR 0006.
//
// Reached from the Admin dashboard and from nowhere else: a Student who is not
// an Admin gets the section's usual 404, which says nothing about what is behind
// it.

import { ru } from '../../../ru.ts';
import { requireAdmin } from '../../../admin/guard.ts';
import { getDatabase } from '../../../db/index.ts';
import { guidanceStanding, GUIDANCE_MAX_LENGTH } from '../../../grader/guidance.ts';
import { GuidanceEditor } from './editor.tsx';

export const dynamic = 'force-dynamic';

export default async function GuidancePage() {
  await requireAdmin();

  const standing = guidanceStanding(getDatabase().db);

  return (
    <main>
      <h1>{ru.guidance.title}</h1>
      <p className="muted">{ru.guidance.explanation}</p>
      <p className="muted">{ru.guidance.fixedExplanation}</p>
      <p className="muted">{ru.guidance.healthNote}</p>

      <GuidanceEditor
        initial={standing.text}
        initialShipped={standing.isShipped}
        initialEditedBy={standing.editedBy}
        initialEditedAt={standing.editedAt === null ? null : standing.editedAt.toISOString()}
        maxLength={GUIDANCE_MAX_LENGTH}
      />

      <p><a href="/admin">{ru.admin.back}</a></p>
    </main>
  );
}
