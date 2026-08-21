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
import { sniffImageType, storeImage } from '../../../../content/uploads.ts';

export async function POST(request: Request): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const { maxBytes, directory } = config.uploads;

  // The declared length first, so an oversized upload is turned away before its
  // body is read into memory at all. It is a claim rather than a fact, which is
  // why the real length is checked again below — but a claim that already
  // exceeds the cap needs no further reading.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return NextResponse.json({ ok: false, reason: 'too_large' }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'malformed' }, { status: 400 });
  if (file.size > maxBytes) {
    return NextResponse.json({ ok: false, reason: 'too_large' }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Belt and braces: `File.size` and the declared length are both reported
  // rather than measured, and this is the number of bytes actually in hand.
  if (bytes.byteLength > maxBytes) {
    return NextResponse.json({ ok: false, reason: 'too_large' }, { status: 413 });
  }

  // The bytes, not `file.type` and not the extension: both of those are claims
  // by whoever is uploading.
  const type = sniffImageType(bytes);
  if (type === null) return NextResponse.json({ ok: false, reason: 'wrong_type' }, { status: 415 });

  const stored = storeImage(directory, bytes, type);
  return NextResponse.json({ ok: true, url: stored.url }, { headers: { 'cache-control': 'no-store' } });
}
