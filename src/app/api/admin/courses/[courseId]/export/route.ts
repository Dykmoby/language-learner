// Downloading a Course as one file.
//
// Admin-only at the endpoint, not merely behind the middleware: the middleware
// turns away anyone without a session, and this is the narrowing on top of it.
// A Course export is every Reference Answer in the Course in one place, which is
// the answer key — it is not something a Student may fetch by guessing a URL.

import { NextResponse } from 'next/server';
import { getDatabase } from '../../../../../../db/index.ts';
import { config } from '../../../../../../config.ts';
import { adminOrRefusal, idFromParam } from '../../../../../../admin/guard.ts';
import { assembleCourseExport } from '../../../../../../admin/course-export.ts';

// RFC 5987's ext-value allows a narrower set than `encodeURIComponent` leaves
// alone: a title holding an apostrophe or a bracket would otherwise go into the
// header raw, in the one field whose delimiter is an apostrophe.
function rfc5987(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()*!]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
): Promise<Response> {
  const { refusal } = await adminOrRefusal();
  if (refusal) return refusal;

  const courseId = idFromParam((await params).courseId);
  if (courseId === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const file = assembleCourseExport(getDatabase().db, courseId, config.uploads.directory);
  if (file === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Indented. The format is the human-readable one, and a person opening it in a
  // text editor is the case it exists for; the size cost is base64 images, which
  // indentation does not touch.
  return new NextResponse(JSON.stringify(file, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Two filenames on purpose: a plain ASCII one every client understands,
      // and the Course's real Russian title for those that read RFC 5987. A
      // title can hold anything at all, so nothing from it reaches the plain
      // name.
      'content-disposition': `attachment; filename="course-${courseId}.json"; `
        + `filename*=UTF-8''${rfc5987(`${file.course.title}.json`)}`,
      'cache-control': 'no-store',
    },
  });
}
