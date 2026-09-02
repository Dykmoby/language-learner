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

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

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

  // Optional: left out, the Course keeps its Language's model per ADR 0002.
  const graderModel = body?.graderModel === undefined ? undefined : asString(body.graderModel);
  if (graderModel === null) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const { db } = getDatabase();
  const saved = updateCourse(db, courseId, { title, graderModel });
  if (!saved.ok) {
    return NextResponse.json({ ok: false, faults: saved.faults }, { status: 422 });
  }

  return NextResponse.json(
    { ok: true, course: { title: saved.course.title, graderModel: saved.course.graderModel } },
    { headers: { 'cache-control': 'no-store' } },
  );
}
