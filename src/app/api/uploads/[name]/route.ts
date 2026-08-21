// Serving a Theory image.
//
// **The read access rule, decided and stated here:** any signed-in Student may
// read an uploaded image. Uploading stays Admin-only, but a Theory image is part
// of a Lesson a Student is meant to read, so the serving route is necessarily
// broader than the upload route. It is not public: the middleware turns away
// anyone without a session before this runs, which is the whole of the rule —
// images are as reachable as the Lessons that embed them, and no more.
//
// Narrowing it further to "Students enrolled in the Course this image appears
// in" was considered and rejected: an image has no Course. It is referenced by
// markdown, possibly by several Drafts of several Lessons, and reconstructing an
// owner from that would be a guess enforced as a rule.

import { NextResponse } from 'next/server';
import { config } from '../../../../config.ts';
import { readImage } from '../../../../content/uploads.ts';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  // A name this application did not generate is answered as missing rather than
  // resolved against the filesystem — the check is a whitelist of the shape
  // `storeImage` writes, so there is no path to traverse.
  const found = readImage(config.uploads.directory, (await params).name);
  if (found === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return new NextResponse(new Uint8Array(found.bytes), {
    headers: {
      // The stored type, from the name this application generated. A
      // client-supplied content type is never echoed back.
      'content-type': found.mime,
      // Named by content, so the bytes behind a name never change. Private
      // because the response is only served to a signed-in Student.
      'cache-control': 'private, max-age=31536000, immutable',
      'content-disposition': 'inline',
      // The bytes were sniffed on the way in, but a browser that decides to
      // sniff again should not be able to talk itself into something else.
      'x-content-type-options': 'nosniff',
    },
  });
}
