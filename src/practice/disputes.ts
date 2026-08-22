// A Student's objection to a Verdict — CONTEXT.md § Dispute, design.md
// § Progression.
//
// The Student's half of the only closed feedback loop in the system. The Admin's
// half, where an upheld objection becomes an Accepted Variant, lives in
// ../admin/disputes.ts; what the two share is this table and nothing else.
//
// Nothing here writes to a Submission. Both Verdicts and every Error stay exactly
// as the Grader left them — ADR 0003 keeps both so the Grader's run-to-run
// instability stays measurable, and a Dispute is a fact *about* a judgement
// rather than an edit to it. The disputed state reaches the progress derivation
// as a second input, which is why `practiceProgress` takes these rows.

import { eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../db/schema.ts';
import { disputes, submissions, type DisputeRow } from '../db/schema.ts';

type Db = BetterSQLite3Database<typeof schema>;

/**
 * The objections standing against a set of Submissions.
 *
 * Every caller that derives progress needs these, and every one of them already
 * has the Submissions in hand — so the lookup is by Submission id rather than by
 * Student, and one Student's objections can never be mixed into another's rows.
 */
export function disputesOn(db: Db, submissionIds: readonly number[]): DisputeRow[] {
  if (submissionIds.length === 0) return [];
  return db.select().from(disputes)
    .where(inArray(disputes.submissionId, [...submissionIds])).all();
}

// --- Making one --------------------------------------------------------------

export type DisputeRefusal = {
  ok: false;
  reason: 'not_found' | 'not_judged' | 'already_disputed' | 'empty_comment' | 'comment_too_long';
};

/** The longest objection worth storing. Past this it is an essay, not a comment. */
export const MAX_COMMENT_LENGTH = 2000;

/**
 * Objects to the Verdict on one Submission.
 *
 * Refused for four reasons, and each one keeps a Dispute meaning one thing:
 *
 * - Someone else's answer is not theirs to object to, and is missing rather than
 *   forbidden — the same answer the rest of the application gives.
 * - Only a judgement can be objected to. An answer whose grading failed was never
 *   judged, one still awaiting a batch is not judged yet, and a Reveal was never
 *   a judgement at all.
 * - One objection per Submission: saying it twice is not saying it louder. The
 *   unique constraint says so too, and this is the message rather than the rule.
 * - An objection with no reason is not reviewable, so it is not an objection.
 * - One past the length cap is refused rather than trimmed. A Dispute is a
 *   Student's words, and silently keeping the first two thousand of them and
 *   throwing the rest away is the one thing this must never do.
 */
export function disputeVerdict(
  db: Db,
  studentId: number,
  submissionId: number,
  comment: string,
): { ok: true; dispute: DisputeRow } | DisputeRefusal {
  const submission = db.select().from(submissions)
    .where(eq(submissions.id, submissionId)).get();

  if (!submission || submission.studentId !== studentId) return { ok: false, reason: 'not_found' };
  if (submission.status !== 'graded') return { ok: false, reason: 'not_judged' };

  const trimmed = comment.trim();
  if (trimmed === '') return { ok: false, reason: 'empty_comment' };
  if (trimmed.length > MAX_COMMENT_LENGTH) return { ok: false, reason: 'comment_too_long' };

  const existing = db.select({ id: disputes.id }).from(disputes)
    .where(eq(disputes.submissionId, submissionId)).get();
  if (existing) return { ok: false, reason: 'already_disputed' };

  const dispute = db.insert(disputes).values({
    submissionId,
    studentId,
    comment: trimmed,
    ruling: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date(),
  }).returning().get();

  return { ok: true, dispute };
}
