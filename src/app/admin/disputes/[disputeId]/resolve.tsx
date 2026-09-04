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
import { VerdictLine } from '../../../shared/verdict-line.tsx';
import { Button } from '@mantine/core';
import { ru } from '../../../../ru.ts';
import type { Variant } from '../../../../content/accepted.ts';
import type { DisputeRuling } from '../../../../db/schema.ts';

type Props = {
  disputeId: number;
  ruling: DisputeRuling | null;
  /**
   * What upholding could confirm — the Student's own words, each with the Gap it
   * was written at.
   *
   * What a fill-gap promotes is the words, not the sentence they were written
   * into: a confirmation naming the sentence would name something no Exercise
   * accepts. More than one of them is the case this screen has to ask about —
   * #85 — because an objection is about one word and the other two are the ones
   * the Student got wrong.
   */
  candidates: Variant[];
};

type Outcome = {
  ruling: DisputeRuling;
  variantAdded: boolean;
  /** Exactly what was sent, so the confirmation names what was added. */
  confirmed: Variant | null;
};

export function ResolveDispute({ disputeId, ruling, candidates }: Props) {
  const [decided, setDecided] = useState<Outcome | null>(
    ruling === null ? null : { ruling, variantAdded: false, confirmed: null },
  );
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Which of the Student's words is being confirmed. Nothing to choose between
  // needs no choice; where there is one, it is made deliberately rather than
  // defaulted to the first — the position is the decision.
  const [chosenAt, setChosenAt] = useState<number | null>(candidates.length === 1 ? 0 : null);

  const confirming = chosenAt === null ? null : candidates[chosenAt] ?? null;

  async function decide(chosen: DisputeRuling) {
    if (chosen === 'upheld' && candidates.length > 0 && confirming === null) {
      setProblem(ru.disputeReview.gapUnspecified);
      return;
    }
    setSending(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/admin/disputes/${disputeId}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ruling: chosen, gap: confirming?.gap ?? null }),
      });
      const body = await response.json().catch(() => null) as
        { ok?: boolean; variantAdded?: boolean; error?: string } | null;

      if (!response.ok || body?.ok !== true) {
        setProblem(body?.error ?? ru.errors.serverError);
        return;
      }
      setDecided({ ruling: chosen, variantAdded: body.variantAdded === true, confirmed: confirming });
    } catch {
      setProblem(ru.errors.serverError);
    } finally {
      setSending(false);
    }
  }

  if (decided) {
    return (
      <div className="result">
        {/* A ruling is what became of an objection, not a Verdict on an answer,
            so it takes the Disputed hue rather than the correct one — the queue
            screen has always drawn it that way, and an upheld objection painted
            green was the two screens disagreeing about the same fact. */}
        <VerdictLine
          state="disputed"
          words={decided.ruling === 'upheld' ? ru.dispute.upheld : ru.dispute.rejected}
        />
        {decided.ruling === 'upheld' && ruling === null ? (
          <p className="muted">
            {decided.variantAdded ? ru.disputeReview.variantAdded : ru.disputeReview.variantAlready}
            {/* What was added, and — where there was a position to choose — where.
                Read off what was sent rather than off the form, so the sentence
                stays true to the decision it is reporting. */}
            {decided.variantAdded && decided.confirmed !== null ? (
              <> <strong>{decided.confirmed.value}</strong></>
            ) : null}
            {decided.variantAdded && decided.confirmed?.gap != null ? (
              <> ({ru.disputeReview.acceptedAtGap(decided.confirmed.gap + 1)})</>
            ) : null}
          </p>
        ) : null}
        <p className="actions"><a className="button secondary" href="/admin/disputes">{ru.disputeReview.back}</a></p>
      </div>
    );
  }

  return (
    <div className="decision">
      {problem === null ? null : <p className="error" role="alert">{problem}</p>}

      {/* The position is part of the decision, so it is made on this screen
          rather than inferred from the answer — #85. One word written, or a Kind
          with one place to answer, has nothing to ask about. */}
      {candidates.length > 1 ? (
        <fieldset className="gapChoice">
          <legend>{ru.disputeReview.chooseGap}</legend>
          {candidates.map((candidate, at) => (
            <label key={at}>
              <input
                type="radio"
                name="gap"
                checked={chosenAt === at}
                onChange={() => setChosenAt(at)}
              />
              {candidate.gap === null
                ? candidate.value
                : `${ru.disputeReview.acceptedAtGap(candidate.gap + 1)}: ${candidate.value}`}
            </label>
          ))}
          <p className="muted">{ru.disputeReview.chooseGapHint}</p>
        </fieldset>
      ) : null}

      <Button fullWidth disabled={sending} onClick={() => void decide('upheld')}>
        {ru.disputeReview.uphold}
      </Button>
      <p className="muted">{ru.disputeReview.upholdHint}</p>
      <Button
        fullWidth variant="default" disabled={sending}
        onClick={() => void decide('rejected')}
      >
        {ru.disputeReview.reject}
      </Button>
      <p className="muted">{ru.disputeReview.rejectHint}</p>
    </div>
  );
}
