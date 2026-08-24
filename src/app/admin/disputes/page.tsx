// The queue: every Dispute waiting on a decision, oldest first.
//
// Oldest first because a queue that surfaced the newest would leave the Student
// who has waited longest waiting longer still. Each row says which Student and
// which Course it came from, which is the whole of what is needed to decide what
// to open next — the review itself is the next screen.
//
// Resolved Disputes are listed below rather than dropped: a resolved Dispute is
// the record of a decision, not a task that evaporates when it is done.

import { ru } from '../../../ru.ts';
import { requireAdmin } from '../../../admin/guard.ts';
import { getDatabase } from '../../../db/index.ts';
import { pendingDisputes, resolvedDisputes, type QueuedDispute } from '../../../admin/disputes.ts';
import { stateClass } from '../../shared/verdict-state.ts';

export const dynamic = 'force-dynamic';

export default async function DisputesPage() {
  await requireAdmin();

  const { db } = getDatabase();
  const waiting = pendingDisputes(db);
  const decided = resolvedDisputes(db);

  return (
    <main>
      <h1>{ru.disputeReview.title}</h1>

      {waiting.length === 0 ? (
        <p className="muted">{ru.disputeReview.queueEmpty}</p>
      ) : (
        <>
          <p className="muted">{ru.disputeReview.waiting(waiting.length)}</p>
          <ul className="cards">
            {waiting.map((entry) => <QueueRow key={entry.dispute.id} entry={entry} />)}
          </ul>
        </>
      )}

      <h2>{ru.disputeReview.resolvedTitle}</h2>
      {decided.length === 0 ? (
        <p className="muted">{ru.disputeReview.resolvedEmpty}</p>
      ) : (
        <ul className="cards">
          {decided.map((entry) => <QueueRow key={entry.dispute.id} entry={entry} />)}
        </ul>
      )}

      <p><a href="/admin">{ru.admin.title}</a></p>
    </main>
  );
}

function QueueRow({ entry }: { entry: QueuedDispute }) {
  const { dispute } = entry;
  return (
    <li>
      <a href={`/admin/disputes/${dispute.id}`}>{ru.disputeReview.open}</a>
      <span className="muted">
        {' — '}{ru.disputeReview.from(entry.studentUsername, entry.courseTitle)}
        {' · '}{new Date(dispute.createdAt).toLocaleString(ru.locale)}
      </span>
      <br />
      <span className="prompt">{entry.exercisePrompt}</span>
      {dispute.ruling === null ? null : (
        <>
          <br />
          <span className={`stateName ${stateClass('disputed')}`}>
            {dispute.ruling === 'upheld' ? ru.dispute.upheld : ru.dispute.rejected}
          </span>
        </>
      )}
    </li>
  );
}
