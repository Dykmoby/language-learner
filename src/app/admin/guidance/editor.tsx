'use client';

// A plain text area, not markdown: this text goes into a prompt, not onto a page.
//
// «Вернуть исходный текст» restores the constant shipped in the code rather than
// whatever was there before the last save. There is no version history — this is
// a text edited twice a year, not a Draft — so "undo my last edit" is not on
// offer and is not pretended at.

import { useState } from 'react';
import { ru, faultMessage } from '../../../ru.ts';

type Standing = {
  text: string;
  isShipped: boolean;
  editedBy: string | null;
  editedAt: string | null;
};

// An edited guidance whose author's account has since been deleted is still an
// edited guidance. Saying «поставляется с приложением» there would tell the
// Admin the Grader has text it does not have.
function provenance(standing: Standing): string {
  if (standing.isShipped || standing.editedAt === null) return ru.guidance.shipped;
  const when = new Date(standing.editedAt).toLocaleString(ru.locale);
  return standing.editedBy === null
    ? ru.guidance.editedByUnknown(when)
    : ru.guidance.editedBy(standing.editedBy, when);
}

export function GuidanceEditor({
  initial, initialShipped, initialEditedBy, initialEditedAt, maxLength,
}: {
  initial: string;
  initialShipped: boolean;
  initialEditedBy: string | null;
  initialEditedAt: string | null;
  maxLength: number;
}) {
  const [text, setText] = useState(initial);
  const [standing, setStanding] = useState<Standing>({
    text: initial, isShipped: initialShipped, editedBy: initialEditedBy, editedAt: initialEditedAt,
  });
  const [busy, setBusy] = useState<'save' | 'restore' | null>(null);
  const [faults, setFaults] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function send(method: 'PUT' | 'DELETE') {
    setBusy(method === 'PUT' ? 'save' : 'restore');
    setFaults([]);
    setProblem(null);
    setSaved(false);
    try {
      const response = await fetch('/api/admin/guidance', {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'PUT' ? JSON.stringify({ guidance: text }) : undefined,
      });
      const body = (await response.json().catch(() => null)) as
        { ok?: boolean; standing?: Standing; faults?: string[] } | null;

      if (response.ok && body?.ok === true && body.standing) {
        setStanding(body.standing);
        setText(body.standing.text);
        setSaved(true);
        return;
      }
      setFaults(body?.faults ?? []);
      if ((body?.faults ?? []).length === 0) setProblem(ru.guidance.writeFailed);
    } catch {
      setProblem(ru.guidance.writeFailed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <label>
        <span>{ru.guidance.field}</span>
        <textarea
          value={text}
          rows={12}
          maxLength={maxLength}
          onChange={(e) => { setText(e.target.value); setFaults([]); setSaved(false); }}
          disabled={busy !== null}
        />
      </label>
      <p className="muted">{ru.guidance.hint(maxLength)}</p>

      <p className="muted">{provenance(standing)}</p>

      {problem === null ? null : <p className="error" role="alert">{problem}</p>}
      {faults.length === 0 ? null : (
        <ul className="cards">
          {faults.map((code) => <li key={code} className="error">{faultMessage(code)}</li>)}
        </ul>
      )}
      {saved ? <p role="status">{ru.guidance.saved}</p> : null}

      <p className="actions">
        <button type="button" onClick={() => send('PUT')} disabled={busy !== null}>
          {busy === 'save' ? ru.guidance.saving : ru.guidance.save}
        </button>
        <button type="button" onClick={() => send('DELETE')} disabled={busy !== null}>
          {busy === 'restore' ? ru.guidance.restoring : ru.guidance.restore}
        </button>
      </p>
    </>
  );
}
