// Deciding one Dispute.
//
// Admin only, and refused with a 404 rather than a "forbidden" — the rule the
// whole Admin section keeps: a 404 says nothing about what is behind it, and a
// Student who is not an Admin should not learn that a review queue exists at all.

import { NextResponse } from 'next/server';
import { ru } from '../../../../../../ru.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../admin/guard.ts';
import { getDatabase } from '../../../../../../db/index.ts';
import { resolveDispute } from '../../../../../../admin/disputes.ts';
import { DISPUTE_RULINGS, type DisputeRuling } from '../../../../../../db/schema.ts';

function rulingFrom(raw: unknown): DisputeRuling | null {
  return typeof raw === 'string' && (DISPUTE_RULINGS as readonly string[]).includes(raw)
    ? raw as DisputeRuling
    : null;
}

/**
 * Which Gap the confirmed answer is for — #85, and absent on every Kind with one
 * place to answer.
 *
 * `undefined` is the failure, because `null` is a real answer: "this Exercise has
 * no position to name". A body carrying something that is neither is refused
 * rather than read as an absent Gap, the way an unrecognised ruling is.
 */
function gapFrom(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null) return null;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ disputeId: string }> },
): Promise<Response> {
  const { student, refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const disputeId = idFromParam((await params).disputeId);
  if (disputeId === null) return NextResponse.json({ error: ru.errors.notFound }, { status: 404 });

  const body = await request.json().catch(() => null) as { ruling?: unknown; gap?: unknown } | null;
  // Anything that is not one of the two rulings is refused rather than defaulted:
  // guessing which decision an Admin meant is the one thing this must never do.
  const ruling = rulingFrom(body?.ruling);
  if (ruling === null) return NextResponse.json({ error: ru.errors.badRequest }, { status: 400 });

  const gap = gapFrom(body?.gap);
  if (gap === undefined) return NextResponse.json({ error: ru.errors.badRequest }, { status: 400 });

  const outcome = resolveDispute(getDatabase().db, student.id, disputeId, ruling, gap);
  if (!outcome.ok) {
    // Which Gap a teacher confirmed is never inferred — an unnamed one on an
    // answer with several words, or a named one the Student wrote nothing at, is
    // sent back to the screen to be answered rather than guessed at here.
    if (outcome.reason === 'gap_unspecified') {
      return NextResponse.json({ error: ru.disputeReview.gapUnspecified }, { status: 400 });
    }
    if (outcome.reason === 'gap_not_answered') {
      return NextResponse.json({ error: ru.disputeReview.gapNotAnswered }, { status: 400 });
    }
    return outcome.reason === 'not_found'
      ? NextResponse.json({ error: ru.errors.notFound }, { status: 404 })
      : NextResponse.json({ error: ru.disputeReview.alreadyResolved }, { status: 409 });
  }

  return NextResponse.json({ ok: true, ruling: outcome.ruling, variantAdded: outcome.variantAdded });
}
