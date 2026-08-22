'use client';

// The two decisions, and what each of them says it will do before it is pressed.
//
// They are not mirror images. Upholding promotes the Student's answer to an
// Accepted Variant, which is irreversible from this screen and changes how every
// later Grader call judges this Exercise — so it says so. Rejecting records that
// the Verdict stood and takes nothing away from the Student, so it says that.
//
// A Dispute that has already been decided shows the decision instead of the
// buttons: a resolved Dispute stays readable, and re-deciding it is not something
// a queue should offer by accident.

import { useState } from 'react';
import { ru } from '../../../../ru.ts';
import type { DisputeRuling } from '../../../../db/schema.ts';

type Props = {
  disputeId: number;
  ruling: DisputeRuling | null;
  /** Shown on the confirmation, because it is what became an Accepted Variant. */
  answer: string;
};

type Outcome = { ruling: DisputeRuling; variantAdded: boolean };

export function ResolveDispute({ disputeId, ruling, answer }: Props) {
  const [decided, setDecided] = useState<Outcome | null>(
    ruling === null ? null : { ruling, variantAdded: false },
  );
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function decide(chosen: DisputeRuling) {
    setSending(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/admin/disputes/${disputeId}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ruling: chosen }),
      });
      const body = await response.json().catch(() => null) as
        { ok?: boolean; variantAdded?: boolean; error?: string } | null;

      if (!response.ok || body?.ok !== true) {
        setProblem(body?.error ?? ru.errors.serverError);
        return;
      }
      setDecided({ ruling: chosen, variantAdded: body.variantAdded === true });
    } catch {
      setProblem(ru.errors.serverError);
    } finally {
      setSending(false);
    }
  }

  if (decided) {
    return (
      <div className="result">
        <p className={decided.ruling === 'upheld' ? 'ok' : 'muted'} role="status">
          {decided.ruling === 'upheld' ? ru.dispute.upheld : ru.dispute.rejected}
        </p>
        {decided.ruling === 'upheld' && ruling === null ? (
          <p className="muted">
            {decided.variantAdded ? ru.disputeReview.variantAdded : ru.disputeReview.variantAlready}
            {decided.variantAdded ? <> <strong>{answer}</strong></> : null}
          </p>
        ) : null}
        <p><a href="/admin/disputes">{ru.disputeReview.back}</a></p>
      </div>
    );
  }

  return (
    <div className="decision">
      {problem === null ? null : <p className="error" role="alert">{problem}</p>}

      <p className="actions">
        <button type="button" disabled={sending} onClick={() => void decide('upheld')}>
          {ru.disputeReview.uphold}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={sending}
          onClick={() => void decide('rejected')}
        >
          {ru.disputeReview.reject}
        </button>
      </p>
      <p className="muted">{ru.disputeReview.upholdHint}</p>
      <p className="muted">{ru.disputeReview.rejectHint}</p>
    </div>
  );
}
