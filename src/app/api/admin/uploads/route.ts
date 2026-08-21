// Uploading an image for a Lesson's Theory. Admin-only, like the rest of the
// section, and refused with a 404 rather than a 403 — a Student who is not an
// Admin should not learn that an authoring surface exists at all.
//
// Everything this route trusts about the file, it works out for itself: the name
// is generated, the type is read from the bytes, and the size is checked before
// anything is written. See `content/uploads.ts` for why each of those is a
// construction rather than a check.

import { NextResponse } from 'next/server';
import { adminOrRefusal } from '../../../../admin/guard.ts';
import { config } from '../../../../config.ts';
import { sniffImageType, storeImage, type UploadRefusal } from '../../../../content/uploads.ts';

function refuse(reason: UploadRefusal, status: number): Response {
  return NextResponse.json({ ok: false, reason }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const { maxBytes, directory } = config.uploads;

  // A cheap pre-filter, not the cap. `content-length` measures the whole
  // multipart envelope — boundary lines, the part headers, the filename — so
  // comparing it against the cap directly would refuse a file that is legally
  // under it, for bytes the browser added. The allowance is what that envelope
  // costs, generously: a part header with a long filename is well under it.
  //
  // The cap itself is enforced on the bytes in hand, below, and still before
  // anything reaches disk.
  const MULTIPART_ENVELOPE_ALLOWANCE = 4096;
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes + MULTIPART_ENVELOPE_ALLOWANCE) {
    return refuse('too_large', 413);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'malformed' }, { status: 400 });
  if (file.size > maxBytes) return refuse('too_large', 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Belt and braces: `File.size` and the declared length are both reported
  // rather than measured, and this is the number of bytes actually in hand.
  if (bytes.byteLength > maxBytes) return refuse('too_large', 413);

  // The bytes, not `file.type` and not the extension: both of those are claims
  // by whoever is uploading.
  const type = sniffImageType(bytes);
  if (type === null) return refuse('wrong_type', 415);

  const stored = storeImage(directory, bytes, type);
  return NextResponse.json({ ok: true, url: stored.url }, { headers: { 'cache-control': 'no-store' } });
}
