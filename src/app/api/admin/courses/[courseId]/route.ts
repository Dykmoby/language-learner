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
import { EFFORTS, type Effort } from '../../../../../claude/effort.ts';

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The Effort a body asks for — issue #76.
 *
 * Three answers, and all three are real. An `Effort` is a choice; `null` is the
 * choice of «По умолчанию»; `undefined` is the key being absent, which the
 * authoring rules turn into `low` rather than into the default. `false` is how
 * "that is not an Effort at all" is reported, because `null` is already taken.
 */
function asEffort(value: unknown): Effort | null | undefined | false {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
    ? value as Effort
    : false;
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

  const graderEffort = asEffort(body?.graderEffort);
  if (graderEffort === false) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  // An empty string is a real edit — "this Course has nothing of its own to say"
  // — so only a non-string is malformed. Absent leaves what the Course holds.
  const graderInstruction = body?.graderInstruction === undefined
    ? undefined : asString(body.graderInstruction);
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
