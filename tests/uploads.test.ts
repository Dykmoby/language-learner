// Seam 2 — what may be stored as a Theory image, and what it is called.
//
// The three rules this feature's security rests on are all decidable without a
// filesystem, so they are decided here: the type comes from the bytes, the name
// is generated, and a name the application did not generate resolves to nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ALLOWED_IMAGE_TYPES, UPLOAD_REFUSALS, isStoredImageName, newImageName, readImage,
  sniffImageType, storeImage, storedImageType, imageUrl,
} from '../src/content/uploads.ts';
import { ru } from '../src/ru.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const GIF = Buffer.from([...Buffer.from('GIF89a', 'latin1'), 1, 0, 1, 0]);
const WEBP = Buffer.from([...Buffer.from('RIFF', 'latin1'), 0x1a, 0, 0, 0, ...Buffer.from('WEBP', 'latin1')]);

test('the type is read from the bytes, never from a name or a declaration', () => {
  const rows: Array<{ what: string; bytes: Buffer; mime: string | null }> = [
    { what: 'PNG', bytes: PNG, mime: 'image/png' },
    { what: 'JPEG', bytes: JPEG, mime: 'image/jpeg' },
    { what: 'GIF89a', bytes: GIF, mime: 'image/gif' },
    { what: 'GIF87a', bytes: Buffer.from([...Buffer.from('GIF87a', 'latin1'), 1, 0]), mime: 'image/gif' },
    { what: 'WebP', bytes: WEBP, mime: 'image/webp' },

    // An SVG is a document that can carry script, and serving one from the
    // application's own origin would undo the Theory renderer's escaping. It is
    // absent from the allowlist deliberately, not by oversight.
    { what: 'an SVG', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), mime: null },
    { what: 'an HTML page named .png', bytes: Buffer.from('<!doctype html><script>alert(1)</script>'), mime: null },
    { what: 'a PDF', bytes: Buffer.from('%PDF-1.7\n'), mime: null },
    { what: 'nothing at all', bytes: Buffer.alloc(0), mime: null },
    { what: 'a truncated PNG signature', bytes: Buffer.from([0x89, 0x50, 0x4e]), mime: null },
    // RIFF is also WAV and AVI: the second four bytes are what make it an image.
    { what: 'a RIFF that is not WebP', bytes: Buffer.from([...Buffer.from('RIFF', 'latin1'), 0, 0, 0, 0, ...Buffer.from('WAVE', 'latin1')]), mime: null },
  ];

  for (const { what, bytes, mime } of rows) {
    assert.equal(sniffImageType(bytes)?.mime ?? null, mime, what);
  }
});

test('a stored name is generated, and holds nothing that could be a path', () => {
  const names = Array.from({ length: 50 }, () => newImageName({ mime: 'image/png', extension: 'png' }));

  for (const name of names) {
    assert.match(name, /^[0-9a-f]{32}\.png$/, 'random hex and the extension we chose');
    assert.equal(isStoredImageName(name), true);
  }
  assert.equal(new Set(names).size, names.length, 'and no two collide');
});

test('a name the application did not generate resolves to nothing', () => {
  // There is nothing to sanitise because there is nothing supplied: the name is
  // matched against the shape this module writes, and anything else is missing.
  const rows = [
    '../../etc/passwd',
    '../data/language-learner.db',
    'a'.repeat(32) + '.png/../../secret',
    'not-hex-at-all.png',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png.exe',
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.png',
    '',
  ];
  for (const name of rows) {
    assert.equal(isStoredImageName(name), false, name);
    assert.equal(storedImageType(name), null, name);
  }
});

test('the served content type comes from the name the application wrote', () => {
  for (const type of ALLOWED_IMAGE_TYPES) {
    const name = newImageName(type);
    assert.equal(storedImageType(name), type.mime, type.extension);
  }
});

test('an image is written to the folder and read back with its stored type', () => {
  const directory = mkdtempSync(join(tmpdir(), 'language-learner-uploads-'));
  try {
    const type = sniffImageType(PNG)!;
    const stored = storeImage(directory, PNG, type);

    assert.equal(stored.mime, 'image/png');
    assert.equal(stored.url, imageUrl(stored.name));
    assert.match(stored.url, /^\/api\/uploads\/[0-9a-f]{32}\.png$/, 'an application route, not a static asset');

    const read = readImage(directory, stored.name)!;
    assert.deepEqual(new Uint8Array(read.bytes), new Uint8Array(PNG));
    assert.equal(read.mime, 'image/png');

    // A file that is on disk under a name this module would never write is not
    // served, whatever it holds.
    writeFileSync(join(directory, 'secrets.png'), PNG);
    assert.equal(readImage(directory, 'secrets.png'), null);
    assert.equal(readImage(directory, newImageName(type)), null, 'and one that is not there is not either');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('every upload refusal has a Russian message, and the dictionary invents none', () => {
  // The same split every other fault family makes: the code is what the endpoint
  // reports and what a test can assert, the sentence is only what is read. A
  // refusal added without a message reaches an Admin as `too_large`.
  assert.deepEqual(
    Object.keys(ru.uploadRefusals).sort(),
    [...UPLOAD_REFUSALS].sort(),
  );
});
