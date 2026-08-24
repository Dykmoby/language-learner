'use client';

// Objecting to a Verdict, in the Student's own words.
//
// Shared by the Practice and by a Test's review for the same reason the endpoint
// behind it is one endpoint: a Test's answers are Submissions (ADR 0005), so the
// objection is the same act against the same row, and only what it unblocks
// differs. That difference is one string, passed in — a second component would
// be a second place for the four refusals to be worded differently.

import { useState } from 'react';
import { ru } from '../../ru.ts';
import { MAX_COMMENT_LENGTH } from '../../practice/disputes.ts';
import { VerdictLine } from './verdict-line.tsx';

type Props = {
  submissionId: number;
  /**
   * A Test gates nothing, so disputing one moves no score and reopens no attempt.
   * Saying otherwise afterwards would be saying something false, which is the
   * whole of why this flag exists.
   */
  inTest?: boolean;
  /** Called once the objection has landed, so the caller can move the Student on. */
  onDisputed?: () => void;
};

type Phase = 'closed' | 'writing' | 'sending' | 'sent';

export function DisputeForm({ submissionId, inTest = false, onDisputed }: Props) {
  const [phase, setPhase] = useState<Phase>('closed');
  const [comment, setComment] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  async function send() {
    if (comment.trim() === '') { setRefusal(ru.dispute.emptyComment); return; }

    setPhase('sending');
    setRefusal(null);
    try {
      const response = await fetch(`/api/submissions/${submissionId}/dispute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setRefusal(body?.error ?? ru.errors.serverError);
        setPhase('writing');
        return;
      }
      setPhase('sent');
      onDisputed?.();
    } catch {
      setRefusal(ru.errors.serverError);
      setPhase('writing');
    }
  }

  if (phase === 'sent') {
    return (
      // Neither a pass nor a fail, and drawn as neither: the objection has its
      // own hue and its own dotted rail, from the same system the Practice and
      // the progress bar read.
      <VerdictLine state="disputed" detail={inTest ? ru.dispute.sentInTest : ru.dispute.sent} />
    );
  }

  if (phase === 'closed') {
    return (
      <p className="actions">
        <span className="muted">{ru.dispute.offer}{' '}</span>
        <button type="button" className="secondary" onClick={() => setPhase('writing')}>
          {ru.dispute.open}
        </button>
      </p>
    );
  }

  return (
    <div className="disputeForm">
      <label>
        <span>{ru.dispute.commentLabel}</span>
        <textarea
          rows={3}
          // The server refuses anything longer rather than trimming it silently,
          // so this is what keeps a Student from writing past the cap and being
          // told afterwards.
          maxLength={MAX_COMMENT_LENGTH}
          value={comment}
          placeholder={ru.dispute.commentPlaceholder}
          disabled={phase === 'sending'}
          onChange={(event) => setComment(event.target.value)}
        />
      </label>

      {refusal ? <p className="error" role="alert">{refusal}</p> : null}

      <p className="actions">
        <button type="button" onClick={() => void send()} disabled={phase === 'sending'}>
          {phase === 'sending' ? ru.dispute.sending : ru.dispute.submit}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={phase === 'sending'}
          onClick={() => { setPhase('closed'); setRefusal(null); }}
        >
          {ru.dispute.cancel}
        </button>
      </p>
    </div>
  );
}
