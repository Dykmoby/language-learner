// One Dispute, with everything a judgement has to be reviewed against.
//
// All of it on one screen and all of it at once — the Exercise, its Reference
// Answer, the Accepted Variants it already carries, the Student's answer, the
// Errors the Grader reported and the Student's comment. A decision made from any
// one of those alone is not a review, which is why none of them is a click away.

import { notFound } from 'next/navigation';
import { VerdictLine } from '../../../shared/verdict-line.tsx';
import { ru, errorTypeLabel } from '../../../../ru.ts';
import { requireAdmin, idFromParam } from '../../../../admin/guard.ts';
import { getDatabase } from '../../../../db/index.ts';
import { openDispute } from '../../../../admin/disputes.ts';
import { ResolveDispute } from './resolve.tsx';

export const dynamic = 'force-dynamic';

export default async function DisputePage(
  { params }: { params: Promise<{ disputeId: string }> },
) {
  await requireAdmin();

  const disputeId = idFromParam((await params).disputeId);
  if (disputeId === null) notFound();

  const opened = openDispute(getDatabase().db, disputeId);
  if (!opened) notFound();

  const { dispute, exercise, submission } = opened;
  // Read once: the screen asks whether anything is accepted at all, and then how
  // to lay it out — two questions about one list.
  const acceptedValues = opened.accepted.flat();
  const verdictLabel = submission.guardedVerdict === 'correct' ? ru.practice.correct
    : submission.guardedVerdict === 'partially_correct' ? ru.practice.partiallyCorrect
    : submission.guardedVerdict === 'incorrect' ? ru.practice.incorrect
    : null;

  return (
    <main>
      <div className="pageHead">
        <div>
          <p className="actions"><a className="button secondary" href="/admin/disputes">{ru.disputeReview.back}</a></p>
          <h1>{ru.disputeReview.title}</h1>
        </div>
      </div>

      <div className="sideBySide">
      {/* Five sections, five frames. This screen is a case file — the Exercise,
          what is already accepted, what the Student wrote, what the Grader
          found, and the objection itself — and a ruling taken from one of them
          alone is not a review. Framed, each is plainly its own piece of
          evidence rather than one more paragraph in a column. */}
      <div className="main sections">
      <p className="muted">
        {ru.disputeReview.from(opened.studentUsername, opened.course.title)}
        {opened.origin === null ? null : (
          <>
            {' · '}
            {opened.origin.kind === 'lesson'
              ? ru.disputeReview.inLesson(opened.origin.title)
              : ru.disputeReview.inTest(opened.origin.title)}
          </>
        )}
        {' · '}{ru.disputeReview.submittedAt}: {new Date(dispute.createdAt).toLocaleString(ru.locale)}
      </p>

      <section className="panel">
      <h2>{ru.disputeReview.exerciseTitle}</h2>
      <p className="prompt">{exercise.prompt}</p>
      <p className="corrected">
        {ru.disputeReview.referenceAnswer}: <strong>{exercise.referenceAnswer}</strong>
      </p>

      </section>

      <section className="panel">
      <h2>{ru.disputeReview.acceptedTitle}</h2>
      {/* Gap by Gap where there is more than one — #85. «a, an, I» in one list
          is a list an Admin cannot act on, because which Gap takes which is the
          whole question the decision below asks. */}
      {acceptedValues.length === 0 ? (
        <p className="muted">{ru.disputeReview.acceptedNone}</p>
      ) : opened.accepted.length <= 1 ? (
        <ul className="variants">
          {acceptedValues.map((value, index) => (
            <li key={`${index}-${value}`}>{value}</li>
          ))}
        </ul>
      ) : (
        <ul className="variants">
          {opened.accepted.map((values, gap) => (
            <li key={gap}>
              <span className="muted">{ru.disputeReview.acceptedAtGap(gap + 1)}: </span>
              {values.length === 0 ? ru.disputeReview.acceptedNoneAtGap : values.join(', ')}
            </li>
          ))}
        </ul>
      )}

      </section>

      <section className="panel">
      <h2>{ru.disputeReview.studentAnswer}</h2>
      <p className="given"><strong>{submission.answer}</strong></p>
      {verdictLabel === null ? null : (
        <p className="muted">{ru.disputeReview.verdict}: {verdictLabel}</p>
      )}
      {submission.feedbackRu ? <p className="feedback">{submission.feedbackRu}</p> : null}
      {/* Issue #81 — withheld from the Student until their third failed attempt,
          and never from this screen. Reviewing an objection means reading what
          the Grader thought the answer should have been. */}
      {submission.corrected ? (
        <p className="corrected">
          {ru.disputeReview.graderCorrected}: <strong>{submission.corrected}</strong>
        </p>
      ) : null}

      </section>

      <section className="panel">
      <h2>{ru.disputeReview.graderErrors}</h2>
      {opened.errors.length === 0 ? (
        <p className="muted">{ru.disputeReview.graderNoErrors}</p>
      ) : (
        <div className="errors">
          <ul>
            {opened.errors.map((error, index) => (
              <li key={index}>
                <span className="errorType">{errorTypeLabel(error.type)}</span>
                {error.span ? <> <span className="span">{error.span}</span></> : null}
                <div>{error.explanationRu}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      </section>

      <section className="panel">
      <h2>{ru.disputeReview.comment}</h2>
      <VerdictLine state="disputed" words={dispute.comment} />
      </section>
      </div>

      {/* The decision sits beside the material rather than under it. All of it
          has to be readable while the ruling is made — a decision taken from any
          one part of it alone is not a review. */}
      <div className="side">
        <ResolveDispute
          disputeId={dispute.id}
          ruling={dispute.ruling}
          candidates={opened.candidates}
        />
      </div>
      </div>
    </main>
  );
}
