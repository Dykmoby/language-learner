'use client';

// Uploading an image while writing Theory.
//
// The file goes to the application, which names it, checks what it actually is
// and stores it; what comes back is a URL, and what is inserted at the cursor is
// ordinary image markdown. That is deliberate — Theory stays markdown all the
// way down, so an image behaves like every other thing in it: it survives a
// Draft, a restore, and a publish without anything knowing it is special.

import { useRef, useState } from 'react';
import { Button, FileButton } from '@mantine/core';
import { ru, faultMessage } from '../../../../ru.ts';

type Props = {
  /** The cap the endpoint enforces, so the hint states the real number. */
  maxBytes: number;
  disabled: boolean;
  onInsert: (markdown: string) => void;
};

const MEGABYTE = 1024 * 1024;

export function ImageUpload({ maxBytes, disabled, onInsert }: Props) {
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Cleared after every attempt so the same file can be chosen twice running.
  const reset = useRef<() => void>(null);

  async function upload(file: File) {
    setUploading(true);
    setProblem(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/admin/uploads', { method: 'POST', body });
      const parsed = (await response.json().catch(() => null)) as
        { ok?: boolean; url?: string; reason?: string } | null;

      if (!response.ok || parsed?.ok !== true || typeof parsed.url !== 'string') {
        // A named refusal is resolved through the dictionary; anything else —
        // a 404, a 500, a body that is not what this expects — is the generic
        // failure, and saying "уменьшите файл" for one of those would send the
        // Admin after a problem that is not theirs.
        setProblem(parsed?.reason === undefined
          ? ru.draft.imageUploadFailed
          : faultMessage(parsed.reason));
        return;
      }
      onInsert(`\n\n![${ru.draft.imageAlt}](${parsed.url})\n\n`);
    } catch {
      setProblem(ru.draft.imageUploadFailed);
    } finally {
      setUploading(false);
      // Cleared so the same file can be chosen twice running — a browser fires
      // no change event when the value is unchanged.
      reset.current?.();
    }
  }

  return (
    <>
      <p className="actions">
        <FileButton
          resetRef={reset}
          accept="image/png,image/jpeg,image/gif,image/webp"
          onChange={(file) => { if (file) void upload(file); }}
        >
          {(props) => (
            <Button {...props} variant="default" disabled={disabled || uploading}>
              {uploading ? ru.draft.imageUploading : ru.draft.imageUpload}
            </Button>
          )}
        </FileButton>
        <span className="muted">{ru.draft.imageUploadHint(Math.round(maxBytes / MEGABYTE))}</span>
      </p>
      {problem === null ? null : <p className="error" role="alert">{problem}</p>}
    </>
  );
}
