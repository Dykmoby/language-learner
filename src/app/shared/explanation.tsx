'use client';

// «Получить объяснение» — the button, and what arrives when it is pressed.
//
// Offered only where a wrong answer would otherwise be a dead end: the Kinds
// judged by a Deterministic Check come back with «Неверно» and nothing else, so
// a Student who does not see their mistake has nothing to do but guess again.
// Whatever the Grader judges already answers with an explanation of its own, and
// a second one from the same model would be the same paragraph twice.
//
// One press per wrong answer. The button is gone once it has been used, which is
// the whole of that rule — there is nothing stored to enforce it against, and
// there does not need to be: a Student who reloads the page to ask twice has
// worked harder for it than the answer is worth.
//
// It never says which answer is right. That is a promise made in the prompt
// rather than kept by this component (../../explain/contract.ts), for the reason
// written there: a filter that could enforce it would have to hold the whole
// paragraph back to check it, and holding it back is exactly what the streaming
// is here to avoid.

import { useState } from 'react';
import { Button } from '@mantine/core';
import { ru } from '../../ru.ts';
import { takeFrames } from '../../explain/wire.ts';
import type { FailureShape } from '../../practice/wire.ts';

type Phase = 'offered' | 'writing' | 'done';

export function Explanation({ submissionId }: { submissionId: number }) {
  const [phase, setPhase] = useState<Phase>('offered');
  const [text, setText] = useState('');
  const [failure, setFailure] = useState<FailureShape | null>(null);

  async function ask() {
    setPhase('writing');
    setText('');
    setFailure(null);

    try {
      const response = await fetch(`/api/submissions/${submissionId}/explain`, { method: 'POST' });

      if (!response.ok || !response.body) {
        setFailure('broken');
        setPhase('done');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = takeFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          if (frame.t === 'delta') setText((sentence) => sentence + frame.text);
          else {
            if (!frame.ok) setFailure(frame.failure ?? 'broken');
            setPhase('done');
          }
        }
      }
    } catch {
      setFailure('broken');
      setPhase('done');
    }
  }

  if (phase === 'offered') {
    return (
      <p className="actions">
        <Button variant="default" onClick={() => void ask()}>{ru.explain.ask}</Button>
      </p>
    );
  }

  return (
    <div className="explanation">
      <h3>{ru.explain.title}</h3>
      {/* The wait before the first token is the Grader's wait, because it is the
          same model on the same lane. This says what is happening in it rather
          than spinning at the Student. */}
      {text === '' && phase === 'writing' ? <p className="muted" role="status">{ru.explain.writing}</p> : null}
      {text === '' ? null : <p className="feedback">{text}</p>}
      {/* A failure after some text has arrived is a paragraph that stopped
          mid-sentence, which the Student cannot otherwise tell from one that
          simply ended. Either way it says nothing about their answer. */}
      {failure === null ? null : (
        <p className="error" role="alert">
          {failure === 'busy' ? ru.explain.busy : ru.explain.failed}
        </p>
      )}
    </div>
  );
}
