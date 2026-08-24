// Which characters a font file actually contains.
//
// The typeface ships subset, which is the only reason it is small enough to
// preload — and subsetting is exactly the operation that can silently drop a
// script. Tajik is written in Cyrillic with six letters that live outside the
// basic Cyrillic block (ғ ӣ қ ӯ ҳ ҷ), so a build that kept `cyrillic` and
// dropped `cyrillic-ext` would render Russian perfectly and turn every Tajik
// Course title into a row of boxes. Asserting the file name is there proves
// nothing about that. Reading the cmap does.
//
// So this opens the woff2, walks its table directory, decompresses the Brotli
// stream and parses the character-to-glyph map out of it. No dependency: woff2
// is a table directory in front of a Brotli stream, and Node has Brotli.

import { readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';

/** The 63 table tags woff2 refers to by index rather than by name. */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post',
  'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea',
  'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop',
  'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

/** woff2's variable-length integer: seven bits a byte, high bit continues. */
function readBase128(buffer: Buffer, offset: number): { value: number; next: number } {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = buffer.readUInt8(offset + i);
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, next: offset + i + 1 };
  }
  throw new Error('malformed UIntBase128');
}

/** The tables of a woff2, decompressed and sliced back apart. */
function readTables(file: Buffer): Map<string, Buffer> {
  if (file.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a woff2 file');

  const numTables = file.readUInt16BE(12);
  let offset = 48;

  const directory: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = file.readUInt8(offset);
    offset += 1;

    const index = flags & 0x3f;
    let tag: string;
    if (index === 0x3f) {
      tag = file.toString('latin1', offset, offset + 4);
      offset += 4;
    } else {
      tag = KNOWN_TAGS[index] ?? `#${index}`;
    }

    const origin = readBase128(file, offset);
    offset = origin.next;

    // `glyf` and `loca` are transformed unless the version says otherwise;
    // every other table is the other way round. Only a transformed table
    // carries a second length, and only its transformed length is in the stream.
    const version = (flags >> 6) & 0x03;
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;

    let length = origin.value;
    if (transformed) {
      const transform = readBase128(file, offset);
      offset = transform.next;
      length = transform.value;
    }

    directory.push({ tag, length });
  }

  const stream = brotliDecompressSync(file.subarray(offset));

  const tables = new Map<string, Buffer>();
  let cursor = 0;
  for (const { tag, length } of directory) {
    tables.set(tag, stream.subarray(cursor, cursor + length));
    // Contiguous, with no padding: the four-byte alignment woff2 talks about
    // belongs to the sfnt this would be reconstructed into, not to the stream.
    cursor += length;
  }
  return tables;
}

function parseFormat4(cmap: Buffer, start: number, into: Set<number>): void {
  const segCountX2 = cmap.readUInt16BE(start + 6);
  const segCount = segCountX2 / 2;
  const endsAt = start + 14;
  const startsAt = endsAt + segCountX2 + 2;
  const deltasAt = startsAt + segCountX2;
  const rangesAt = deltasAt + segCountX2;

  for (let segment = 0; segment < segCount; segment += 1) {
    const end = cmap.readUInt16BE(endsAt + segment * 2);
    const begin = cmap.readUInt16BE(startsAt + segment * 2);
    if (begin === 0xffff) continue;
    const delta = cmap.readInt16BE(deltasAt + segment * 2);
    const rangeOffset = cmap.readUInt16BE(rangesAt + segment * 2);

    for (let code = begin; code <= end && code !== 0x10000; code += 1) {
      let glyph: number;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const at = rangesAt + segment * 2 + rangeOffset + (code - begin) * 2;
        if (at + 1 >= cmap.length) continue;
        const raw = cmap.readUInt16BE(at);
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
      }
      if (glyph !== 0) into.add(code);
    }
  }
}

function parseFormat12(cmap: Buffer, start: number, into: Set<number>): void {
  const groups = cmap.readUInt32BE(start + 12);
  for (let group = 0; group < groups; group += 1) {
    const at = start + 16 + group * 12;
    const begin = cmap.readUInt32BE(at);
    const end = cmap.readUInt32BE(at + 4);
    const firstGlyph = cmap.readUInt32BE(at + 8);
    if (firstGlyph === 0) continue;
    for (let code = begin; code <= end; code += 1) into.add(code);
  }
}

/** Every Unicode code point the font file has a glyph for. */
export function codepointsIn(path: string): Set<number> {
  const cmap = readTables(readFileSync(path)).get('cmap');
  if (cmap === undefined) throw new Error('the font has no cmap table');

  const codepoints = new Set<number>();
  const subtables = cmap.readUInt16BE(2);
  for (let i = 0; i < subtables; i += 1) {
    const record = 4 + i * 8;
    const platform = cmap.readUInt16BE(record);
    const encoding = cmap.readUInt16BE(record + 2);
    // Unicode only: platform 0, or the Windows Unicode encodings.
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;

    const start = cmap.readUInt32BE(record + 4);
    const format = cmap.readUInt16BE(start);
    if (format === 4) parseFormat4(cmap, start, codepoints);
    else if (format === 12) parseFormat12(cmap, start, codepoints);
  }
  return codepoints;
}
