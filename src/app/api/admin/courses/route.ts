// Creating a Course.
//
// The first write in the system that brings content into being rather than
// improving content a seed script created. Everything it refuses is refused by
// the authoring module, which reports every reason at once — an Admin fixes a
// form, not one field per attempt.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../db/index.ts';
import { adminOrRefusal } from '../../../../admin/guard.ts';
import { createCourse } from '../../../../admin/authoring.ts';
import { EFFORTS, type Effort } from '../../../../claude/effort.ts';

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

export async function POST(request: Request): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const language = asString(body?.language);
  const level = asString(body?.level);
  const title = asString(body?.title);
  if (language === null || level === null || title === null) {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }
  // Optional: left out, the Course takes its Language's model per ADR 0002.
  const graderModel = body?.graderModel === undefined ? undefined : asString(body.graderModel);
  if (graderModel === null) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const graderEffort = asEffort(body?.graderEffort);
  if (graderEffort === false) return NextResponse.json({ error: 'malformed' }, { status: 400 });

  const { db } = getDatabase();
  const created = createCourse(db, { language, level, graderModel, graderEffort, title });
  if (!created.ok) {
    return NextResponse.json({ ok: false, faults: created.faults }, { status: 422 });
  }

  return NextResponse.json(
    { ok: true, courseId: created.course.id },
    { headers: { 'cache-control': 'no-store' } },
  );
}
