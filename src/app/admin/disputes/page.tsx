// The queue: every Dispute waiting on a decision, oldest first.
//
// Oldest first because a queue that surfaced the newest would leave the Student
// who has waited longest waiting longer still. Each row says which Student and
// which Course it came from, which is the whole of what is needed to decide what
// to open next — the review itself is the next screen.
//
// Resolved Disputes are listed below rather than dropped: a resolved Dispute is
// the record of a decision, not a task that evaporates when it is done.
//
// And below both lists, how often the Coherence Guard fired. It is here rather
// than on a screen of its own because a guard firing and an upheld objection are
// the two ways this system records that the Grader was wrong — one caught by a
// rule, one caught by a person — and an Admin asking whether grading is any good
// wants them in one place.

import { ru } from '../../../ru.ts';
import { requireAdmin } from '../../../admin/guard.ts';
import { getDatabase } from '../../../db/index.ts';
import { pendingDisputes, resolvedDisputes, type QueuedDispute } from '../../../admin/disputes.ts';
import { guardFirings } from '../../../admin/guard-firings.ts';
import { stateClass } from '../../shared/verdict-state.ts';

export const dynamic = 'force-dynamic';

export default async function DisputesPage() {
  await requireAdmin();

  const { db } = getDatabase();
  const waiting = pendingDisputes(db);
  const decided = resolvedDisputes(db);
  // Read off the two Verdict columns ADR 0003 already requires: no new table, no
  // migration, and nothing written twice.
  const firings = guardFirings(db);

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

      <h2>{ru.coherenceGuard.title}</h2>
      <p className="muted">{ru.coherenceGuard.explanation}</p>
      {firings.judged === 0 ? (
        // Zero out of nothing is not evidence about the rule, so it does not
        // claim to be: an application where nobody has answered anything yet
        // says so instead of reporting a rate over no answers.
        <p className="muted">{ru.coherenceGuard.nothingJudged}</p>
      ) : (
        <>
          <p>{ru.coherenceGuard.fired(firings.fired, firings.judged)}</p>
          {/* Both directions, always — including the zeros. A guard that has
              never fired is a fact worth reading, and hiding the line that says
              so would leave the panel looking empty rather than answered. */}
          <p className="muted">{ru.coherenceGuard.forcedCorrect(firings.forcedCorrect)}</p>
          <p className="muted">{ru.coherenceGuard.forbadeCorrect(firings.forbadeCorrect)}</p>
        </>
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
