'use client';

// The conversation over a Draft.
//
// The Admin says what should change, and the whole Lesson comes back with that
// change made. Two things make this more than a second Generate button:
//
//   **Every turn sends the document that is in the editor right now**, hand edits
//   included. So an Admin can fix a typo, ask for two more Exercises, and get
//   back a document carrying both — with no merge step anywhere (ADR 0004).
//
//   **Every turn is forked from the Draft on the screen**, not from the newest
//   one. Going back three turns in the history and carrying on is a branch rather
//   than a rewind, which is what makes an old Draft more than old text.
//
// The transcript is seeded from the server, not held only in this component: the
// rows are the thread, so a reload shows the conversation rather than an empty
// box beside a Lesson that plainly came from one.

import { useState } from 'react';
import { Button, Textarea } from '@mantine/core';
import { ru } from '../../../../ru.ts';
import type { LessonDocument } from '../../../../content/lesson-document.ts';
import type { Effort } from '../../../../claude/effort.ts';
import { useAuthoringStream } from './authoring-stream.ts';
import { FaultList } from '../../forms/faults.tsx';
import { ModelAndEffort } from './model-picker.tsx';
import { StreamedTheory } from './streamed-theory.tsx';

/** One turn as the rows remember it. */
export type Turn = { draftId: number; message: string };

type Props = {
  lessonId: number;
  /** Whatever is in the editor at this moment — this is what goes over. */
  document: LessonDocument;
  /** The Draft on the screen, whose conversation this turn forks from. */
  fromDraftId: number | null;
  initialTurns: Turn[];
  defaultModel: string;
  disabled: boolean;
  onRefined: (document: LessonDocument, draftId: number) => void;
};

export function RefinePanel({
  lessonId, document, fromDraftId, initialTurns, defaultModel, disabled, onRefined,
}: Props) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [message, setMessage] = useState('');
  const [model, setModel] = useState(defaultModel);
  const [effort, setEffort] = useState<Effort | null>(null);
  const [threadLost, setThreadLost] = useState(false);
  const stream = useAuthoringStream(ru.refinement);

  const busy = stream.running || disabled;

  async function send() {
    if (message.trim() === '') return;
    const asked = message;
    setThreadLost(false);

    await stream.start(
      `/api/admin/lessons/${lessonId}/refine`,
      { document, message: asked, fromDraftId, model, effort },
      (frame) => {
        onRefined(frame.document, frame.draftId);
        setTurns((current) => [...current, { draftId: frame.draftId, message: asked }]);
        setThreadLost(frame.threadLost);
        // Cleared only once the turn has landed. A failed turn leaves the request
        // in the box, because retyping it is the one thing an Admin should not
        // have to do to try again.
        setMessage('');
      },
    );
  }

  return (
    <section className="panel">
      <h3>{ru.refinement.title}</h3>
      <p className="muted">{ru.refinement.explanation}</p>

      {fromDraftId === null ? <p className="muted">{ru.refinement.saveFirst}</p> : null}

      {turns.length === 0 ? (
        <p className="muted">{ru.refinement.empty}</p>
      ) : (
        <ol className="cards">
          {turns.map((turn) => (
            <li key={turn.draftId}>
              <p className="muted">{ru.refinement.asked}</p>
              <p className="feedback">{turn.message}</p>
            </li>
          ))}
        </ol>
      )}

      <Textarea
        label={ru.refinement.message}
        description={ru.refinement.messageHint}
        rows={3}
        value={message}
        disabled={busy}
        onChange={(event) => setMessage(event.currentTarget.value)}
      />

      <ModelAndEffort
        model={model}
        effort={effort}
        disabled={busy}
        onModel={setModel}
        onEffort={setEffort}
      />

      {stream.problem === null ? null : <p className="error" role="alert">{stream.problem}</p>}
      <FaultList faults={stream.faults} />
      {/* Said out loud rather than hidden. An Admin whose next request assumes
          three turns of context deserves to know the thread is gone — the Lesson
          survived because the document travels with every turn, but the
          conversation did not. */}
      {threadLost ? <p className="muted" role="status">{ru.refinement.threadLost}</p> : null}

      <p className="actions">
        <Button 
          onClick={send}
          disabled={busy || fromDraftId === null || message.trim() === ''}
        >
          {stream.running ? ru.refinement.sending : ru.refinement.send}
        </Button>
        {stream.running ? (
          <Button  variant="default" onClick={stream.cancel}>
            {ru.refinement.cancel}
          </Button>
        ) : null}
      </p>

      <StreamedTheory theory={stream.theory} />
    </section>
  );
}
