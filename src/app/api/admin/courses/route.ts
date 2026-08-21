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

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export async function POST(request: Request): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const language = asString(body?.language);
  const level = asString(body?.level);
  const graderModel = asString(body?.graderModel);
  const title = asString(body?.title);
  if (language === null || level === null || graderModel === null || title === null) {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  const { db } = getDatabase();
  const created = createCourse(db, { language, level, graderModel, title });
  if (!created.ok) {
    return NextResponse.json({ ok: false, faults: created.faults }, { status: 422 });
  }

  return NextResponse.json(
    { ok: true, courseId: created.course.id },
    { headers: { 'cache-control': 'no-store' } },
  );
}
