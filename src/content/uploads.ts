// Images in Theory: what may be stored, what it is called, and where it lives.
//
// The rendering side needs nothing — the Theory renderer already renders image
// markdown and already refuses any URL scheme that is not a relative path or
// plain http/https. This is the storage and the serving.
//
// Three rules carry the security of this feature, and each is a construction
// rather than a check that could be forgotten:
//
//   1. **The application names the file.** Nothing an author supplies ever
//      becomes part of a path, so traversal is impossible rather than sanitised
//      away. There is no `..` to strip because there is no supplied name at all.
//   2. **The type comes from the bytes.** A declared content type and a file
//      extension are both claims by whoever is uploading; the magic number is
//      the file. The extension this module writes is derived from the sniff, so
//      the serving route can set the stored type from the name it generated
//      without ever echoing a client's.
//   3. **The size is capped before the write.** A request over the cap is
//      refused rather than truncated, and refused before anything reaches disk.
//
// Pure apart from the two functions that plainly touch the filesystem, so the
// sniffing and the naming are table-tested with no directory involved.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Why an upload was refused. A stable code with a Russian message resolved at
// display time, like every other fault family in this codebase — the alternative
// is an inline cascade of string comparisons in a component, which is where a
// new reason gets added and silently rendered as nothing.
export const UPLOAD_REFUSALS = ['too_large', 'wrong_type'] as const;
export type UploadRefusal = (typeof UPLOAD_REFUSALS)[number];

export type ImageType = {
  /** The stored content type, set explicitly by the serving route. */
  mime: string;
  /** The extension this module writes, derived from the sniff and never from the upload. */
  extension: string;
};

// A deliberately short allowlist. SVG is absent and stays absent: an SVG is a
// document that can carry script, and serving one from the application's own
// origin would undo the escaping the Theory renderer does.
const IMAGE_TYPES: Array<ImageType & { matches: (bytes: Uint8Array) => boolean }> = [
  {
    mime: 'image/png',
    extension: 'png',
    matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    mime: 'image/jpeg',
    extension: 'jpg',
    matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  },
  {
    mime: 'image/gif',
    extension: 'gif',
    // GIF87a and GIF89a. Both are `GIF8` followed by a digit and `a`.
    matches: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]) && b[5] === 0x61,
  },
  {
    mime: 'image/webp',
    extension: 'webp',
    // RIFF....WEBP — the four length bytes in between are not part of the check.
    matches: (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46])
      && startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
];

export const ALLOWED_IMAGE_TYPES = IMAGE_TYPES.map(({ mime, extension }) => ({ mime, extension }));

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

/** What these bytes actually are, or null if they are not an allowed image. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const found = IMAGE_TYPES.find((type) => type.matches(bytes));
  return found === undefined ? null : { mime: found.mime, extension: found.extension };
}

// 32 hex characters and one of the allowed extensions, and nothing else — no
// separators, no dots beyond the one, nothing that could climb out of a
// directory. The serving route matches a requested name against this before it
// looks at the filesystem, so a name this module did not generate is answered as
// missing rather than resolved.
const STORED_NAME = new RegExp(`^[0-9a-f]{32}\\.(${IMAGE_TYPES.map((t) => t.extension).join('|')})$`);

export function isStoredImageName(name: string): boolean {
  return STORED_NAME.test(name);
}

/** The content type a stored name is served with — derived from the name we wrote. */
export function storedImageType(name: string): string | null {
  if (!isStoredImageName(name)) return null;
  const extension = name.slice(name.lastIndexOf('.') + 1);
  return IMAGE_TYPES.find((type) => type.extension === extension)?.mime ?? null;
}

/** A name for a stored image. Random, and never derived from anything supplied. */
export function newImageName(type: ImageType): string {
  return `${randomBytes(16).toString('hex')}.${type.extension}`;
}

/** The address the Theory markdown points at — an application route, not a static asset. */
export function imageUrl(name: string): string {
  return `/api/uploads/${name}`;
}

export type StoredImage = { name: string; url: string; mime: string };

/**
 * Writes an image to the upload folder and returns what to point at it with.
 *
 * The folder sits outside the build output, which is what makes an uploaded
 * image survive a rebuild and a redeploy; serving it back through a route rather
 * than as a static asset is the other half of that.
 */
export function storeImage(directory: string, bytes: Uint8Array, type: ImageType): StoredImage {
  mkdirSync(directory, { recursive: true });
  const name = newImageName(type);
  writeFileSync(join(directory, name), bytes);
  return { name, url: imageUrl(name), mime: type.mime };
}

/** One stored image's bytes, or null where the name is not one this module wrote. */
export function readImage(directory: string, name: string): { bytes: Buffer; mime: string } | null {
  const mime = storedImageType(name);
  if (mime === null) return null;
  try {
    return { bytes: readFileSync(join(directory, name)), mime };
  } catch {
    return null;
  }
}
