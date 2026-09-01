// Removing an account, and everything that was that account's.
//
// DELETE with the Student in the path rather than in a body: what is being
// removed is named by the address, so a request that arrives without its body —
// or with somebody else's — cannot delete the wrong person.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../db/index.ts';
import { adminOrRefusal, idFromParam } from '../../../../../admin/guard.ts';
import { deleteStudent } from '../../../../../auth/accounts.ts';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ studentId: string }> },
): Promise<Response> {
  const { student: admin, refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const studentId = idFromParam((await params).studentId);
  if (studentId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // The acting Admin is passed in rather than looked up inside: "you cannot
  // delete yourself" is a rule about the act, and the module that performs it
  // deliberately never asks who is calling.
  const result = deleteStudent(getDatabase().db, { studentId, actingStudentId: admin.id });
  if (!result.ok) {
    if (result.faults.includes('account_not_found')) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: false, faults: result.faults }, { status: 422 });
  }

  return NextResponse.json(
    { ok: true, username: result.username },
    { headers: { 'cache-control': 'no-store' } },
  );
}
