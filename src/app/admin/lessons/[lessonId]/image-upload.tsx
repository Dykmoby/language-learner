'use client';

// Uploading an image while writing Theory.
//
// The file goes to the application, which names it, checks what it actually is
// and stores it; what comes back is a URL, and what is inserted at the cursor is
// ordinary image markdown. That is deliberate — Theory stays markdown all the
// way down, so an image behaves like every other thing in it: it survives a
// Draft, a restore, and a publish without anything knowing it is special.

import { useRef, useState } from 'react';
import { ru } from '../../../../ru.ts';

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
  const input = useRef<HTMLInputElement | null>(null);

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
        setProblem(
          parsed?.reason === 'too_large' ? ru.draft.imageTooLarge
            : parsed?.reason === 'wrong_type' ? ru.draft.imageWrongType
              : ru.draft.imageUploadFailed,
        );
        return;
      }
      onInsert(`\n\n![${ru.draft.imageAlt}](${parsed.url})\n\n`);
    } catch {
      setProblem(ru.draft.imageUploadFailed);
    } finally {
      setUploading(false);
      // Cleared so the same file can be chosen twice running — a browser fires
      // no change event when the value is unchanged.
      if (input.current) input.current.value = '';
    }
  }

  return (
    <>
      <label>
        <span>{uploading ? ru.draft.imageUploading : ru.draft.imageUpload}</span>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          disabled={disabled || uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </label>
      <p className="muted">{ru.draft.imageUploadHint(Math.round(maxBytes / MEGABYTE))}</p>
      {problem === null ? null : <p className="error" role="alert">{problem}</p>}
    </>
  );
}
