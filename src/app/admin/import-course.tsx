'use client';

// Loading a Course from a file.
//
// It sits beside the New Course form because that is what it is: another way to
// bring a Course into being, and one that always creates a new one. The hint
// says so outright — an Admin who expects an import to update the Course they
// exported last week should find out here, not afterwards.

import { useRef, useState } from 'react';
import { ru } from '../../ru.ts';
import { FaultList, type ReadableFault } from './forms/faults.tsx';

type Imported = {
  courseId: number;
  title: string;
  lessons: number;
  tests: number;
  images: number;
  missingImages: number;
};

export function ImportCourseForm() {
  const [importing, setImporting] = useState(false);
  const [faults, setFaults] = useState<ReadableFault[]>([]);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<Imported | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  async function send(file: File) {
    setImporting(true);
    setFaults([]);
    setFailed(false);
    setDone(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/admin/courses/import', { method: 'POST', body });
      const parsed = (await response.json().catch(() => null)) as
        ({ ok: true } & Imported) | { ok?: false; faults?: ReadableFault[] } | null;

      if (parsed?.ok === true) {
        setDone(parsed);
        return;
      }
      // Named faults are shown as themselves; anything else — a 500, a body this
      // does not recognise — is the generic failure, because telling an Admin to
      // fix their file when the server fell over sends them after the wrong
      // problem.
      if (Array.isArray(parsed?.faults) && parsed.faults.length > 0) setFaults(parsed.faults);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setImporting(false);
      // Cleared so the same file can be chosen twice running.
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <p className="muted">{ru.transfer.importHint}</p>

      <p className="actions">
        <label htmlFor="course-file">{ru.transfer.importFile}</label>
        <input
          id="course-file"
          ref={input}
          type="file"
          accept="application/json,.json"
          disabled={importing}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void send(file);
          }}
        />
      </p>

      {importing ? <p className="muted">{ru.transfer.importing}</p> : null}
      {failed ? <p className="error">{ru.transfer.importFailed}</p> : null}
      <FaultList faults={faults} />

      {done === null ? null : (
        <div>
          <p className="ok">{ru.transfer.imported(done.title)}</p>
          <p className="muted">{ru.transfer.importedCounts(done.lessons, done.tests, done.images)}</p>
          {done.missingImages > 0
            ? <p className="muted">{ru.transfer.importedMissingImages(done.missingImages)}</p>
            : null}
          <p className="muted">{ru.transfer.importedNobodyEnrolled}</p>
          <p><a href={`/admin/courses/${done.courseId}`}>{ru.transfer.openImported}</a></p>
        </div>
      )}
    </>
  );
}
