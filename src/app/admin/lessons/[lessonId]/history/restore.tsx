'use client';

// Restoring a Draft.
//
// It appends rather than truncates, and it does not publish — both of which the
// button says out loud afterwards, because "restored" on its own would let an
// Admin believe a Student's Lesson had just changed.

import { useState } from 'react';
import { Button } from '@mantine/core';
import { ru } from '../../../../../ru.ts';

export function RestoreButton({ lessonId, draftId }: { lessonId: number; draftId: number }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function restore() {
    setBusy(true);
    setNotice(null);
    setProblem(null);
    try {
      const response = await fetch(`/api/admin/lessons/${lessonId}/drafts/${draftId}/restore`, {
        method: 'POST',
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean } | null;
      if (!response.ok || body?.ok !== true) {
        setProblem(ru.draft.restoreFailed);
        return;
      }
      setNotice(ru.draft.restored);
    } catch {
      setProblem(ru.draft.restoreFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="actions">
        <Button onClick={restore} disabled={busy}>
          {busy ? ru.draft.restoring : ru.draft.restore}
        </Button>
      </p>
      {problem === null ? null : <p className="error" role="alert">{problem}</p>}
      {notice === null ? null : <p className="ok" role="status">{notice}</p>}
    </>
  );
}
