// Changing a Course's settings — issue #75.
//
// PATCH rather than PUT: what arrives is the editable part of a Course, not a
// Course. The Language and the CEFR level are not in the body and are not read
// from it, so a request that carries them changes neither — "not editable" is
// enforced by there being nowhere for them to go rather than by a check that
// could be forgotten.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../admin/guard.ts';
import { updateCourse } from '../../../../../admin/authoring.ts';
import { asEffort, asOptionalString, asString } from '../body.ts';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const courseId = idFromParam((await params).courseId);
  if (courseId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const title = asString(body?.title);
  if (title === null) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  // Every field below may be left out, and leaving one out leaves the Course as
  // it is. An update names the part that is changing, so a request carrying only
  // a title must not reset the Grader model, the Effort or the instruction it
  // never mentioned.
  const graderModel = asOptionalString(body?.graderModel);
  if (graderModel === null) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const graderEffort = asEffort(body?.graderEffort);
  if (graderEffort === false) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const graderInstruction = asOptionalString(body?.graderInstruction);
  if (graderInstruction === null) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const { db } = getDatabase();
  const saved = updateCourse(db, courseId, { title, graderModel, graderEffort, graderInstruction });
  if (!saved.ok) {
    return NextResponse.json({ ok: false, faults: saved.faults }, { status: 422 });
  }

  return NextResponse.json(
    {
      ok: true,
      course: {
        title: saved.course.title,
        graderModel: saved.course.graderModel,
        graderEffort: saved.course.graderEffort,
        graderInstruction: saved.course.graderInstruction,
      },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
