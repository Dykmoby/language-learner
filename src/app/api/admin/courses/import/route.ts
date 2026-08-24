// Reading a Course back in from a file.
//
// Admin-only at the endpoint rather than only behind the middleware, for the
// same reason the export is: this one writes. Everything it trusts about the
// file, `admin/course-import.ts` works out for itself — nothing here inspects
// the content, and nothing from the upload names anything.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../db/index.ts';
import { config } from '../../../../../config.ts';
import { adminOrRefusal } from '../../../../../admin/guard.ts';
import { importCourse } from '../../../../../admin/course-import.ts';

export async function POST(request: Request): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const maxBytes = config.courseImport.maxBytes;
  const tooLarge = () =>
    NextResponse.json({ ok: false, faults: [{ code: 'file_too_large' }] }, { status: 413 });

  // A cheap pre-filter on the multipart envelope, not the cap — the same
  // reasoning as the image upload, with the same generous allowance for what the
  // browser adds around the file itself.
  const MULTIPART_ENVELOPE_ALLOWANCE = 4096;
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes + MULTIPART_ENVELOPE_ALLOWANCE) return tooLarge();

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'malformed' }, { status: 400 });
  if (file.size > maxBytes) return tooLarge();

  const text = await file.text();
  // Belt and braces, as the image upload does it: `content-length` and
  // `File.size` are both reported rather than measured, and this is the number
  // of bytes actually in hand.
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return tooLarge();

  const result = importCourse(
    getDatabase().db,
    { uploadDir: config.uploads.directory, maxImageBytes: config.uploads.maxBytes },
    text,
  );

  if (!result.ok) {
    // 422: the request is well-formed and the file is not something that can
    // become a Course. Every fault carries a stable code the screen resolves
    // through the same dictionary the authoring forms use.
    return NextResponse.json({ ok: false, faults: result.faults }, { status: 422 });
  }

  return NextResponse.json({
    ok: true,
    courseId: result.course.id,
    title: result.course.title,
    lessons: result.lessons,
    tests: result.tests,
    images: result.images,
    missingImages: result.missingImages,
  }, { headers: { 'cache-control': 'no-store' } });
}
