// Editing the one block of the Grader's system prompt that is not in code —
// issue #79, ADR 0006.
//
// Two verbs, because «Вернуть исходный текст» is not a save of the shipped text.
// It deletes the row, so the default keeps exactly one home and an Admin who
// restores cannot end up on a stale copy of it.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../db/index.ts';
import { adminOrRefusal } from '../../../../admin/guard.ts';
import { restoreShippedGuidance, saveGuidance } from '../../../../grader/guidance.ts';

export async function PUT(request: Request): Promise<Response> {
  const { student, refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const text = body?.guidance;
  // An empty string is a real edit meaning "nothing beyond the skeleton", so
  // only a non-string is malformed.
  if (typeof text !== 'string') {
    return NextResponse.json({ error: 'malformed' }, { status: 400 });
  }

  const { db } = getDatabase();
  const saved = saveGuidance(db, text, student.id);
  if (!saved.ok) {
    return NextResponse.json({ ok: false, faults: saved.faults }, { status: 422 });
  }

  return NextResponse.json(
    { ok: true, standing: saved.standing },
    { headers: { 'cache-control': 'no-store' } },
  );
}

export async function DELETE(): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const standing = restoreShippedGuidance(getDatabase().db);
  return NextResponse.json(
    { ok: true, standing },
    { headers: { 'cache-control': 'no-store' } },
  );
}
