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
  const verdictLabel = submission.guardedVerdict === 'correct' ? ru.practice.correct
    : submission.guardedVerdict === 'partially_correct' ? ru.practice.partiallyCorrect
    : submission.guardedVerdict === 'incorrect' ? ru.practice.incorrect
    : null;

  return (
    <main>
      <p className="muted"><a href="/admin/disputes">{ru.disputeReview.back}</a></p>
      <h1>{ru.disputeReview.title}</h1>

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

      <h2>{ru.disputeReview.exerciseTitle}</h2>
      <p className="prompt">{exercise.prompt}</p>
      <p className="corrected">
        {ru.disputeReview.referenceAnswer}: <strong>{exercise.referenceAnswer}</strong>
      </p>

      <h2>{ru.disputeReview.acceptedTitle}</h2>
      {opened.accepted.length === 0 ? (
        <p className="muted">{ru.disputeReview.acceptedNone}</p>
      ) : (
        <ul className="variants">
          {opened.accepted.map((value, index) => (
            <li key={`${index}-${value}`}>{value}</li>
          ))}
        </ul>
      )}

      <h2>{ru.disputeReview.studentAnswer}</h2>
      <p className="given"><strong>{submission.answer}</strong></p>
      {verdictLabel === null ? null : (
        <p className="muted">{ru.disputeReview.verdict}: {verdictLabel}</p>
      )}
      {submission.feedbackRu ? <p className="feedback">{submission.feedbackRu}</p> : null}

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

      <h2>{ru.disputeReview.comment}</h2>
      <VerdictLine state="disputed" words={dispute.comment} />

      <ResolveDispute
        disputeId={dispute.id}
        ruling={dispute.ruling}
        values={opened.answerValues}
      />
    </main>
  );
}
