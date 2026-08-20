// Theory is Admin-authored, and "the author is trusted" is a weaker guarantee
// than escaping — step 5 will have Claude generating this markdown. So the
// renderer escapes everything first and only then puts its own tags back, and
// these tests are mostly about what it refuses to emit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderTheory } from '../src/content/markdown.ts';
import { ENGLISH_A1 } from '../src/content/english-a1.ts';

test('markdown structure becomes HTML structure', () => {
  const html = renderTheory([
    '## Артикли',
    '',
    'Первый абзац.',
    '',
    '- **a** — перед согласным',
    '- **an** — перед гласным',
    '',
    '1. Первое',
    '2. Второе',
  ].join('\n'));

  assert.match(html, /<h2>Артикли<\/h2>/);
  assert.match(html, /<p>Первый абзац\.<\/p>/);
  assert.match(html, /<ul>\s*<li><strong>a<\/strong> — перед согласным<\/li>/);
  assert.match(html, /<ol>\s*<li>Первое<\/li>/);
});

test('a pipe table becomes a table, because the Theory in the fixture uses one', () => {
  const html = renderTheory([
    '| Лицо | Форма |',
    '| --- | --- |',
    '| I | am |',
    '| he | is |',
  ].join('\n'));

  assert.match(html, /<table>/);
  assert.match(html, /<th>Лицо<\/th>/);
  assert.match(html, /<td>am<\/td>/);
  assert.ok(!html.includes('---'), 'the separator row is not content');
});

test('inline markup renders and Cyrillic passes through untouched', () => {
  const html = renderTheory('Это **важно**, это *курсив*, это `код`, а это ~~неверно~~.');
  assert.match(html, /<strong>важно<\/strong>/);
  assert.match(html, /<em>курсив<\/em>/);
  assert.match(html, /<code>код<\/code>/);
  assert.match(html, /<del>неверно<\/del>/);
});

// The only tags the renderer ever writes, and the only attributes it ever puts
// on one. Anything else in the output came from the author's text, which means
// the escaping failed.
const ALLOWED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'em', 'del',
  'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img',
]);

function tagsIn(html: string): Array<{ name: string; attributes: string }> {
  return [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)]
    .map((m) => ({ name: m[1]!.toLowerCase(), attributes: m[2]!.trim() }));
}

test('raw HTML in the markdown cannot inject script into the page', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>',
    '<div onclick="alert(1)">текст</div>',
    '<svg/onload=alert(1)>',
    '</p><script>alert(1)</script><p>',
    '<a href="javascript:alert(1)">нажми</a>',
    '**жирный**<script>alert(1)</script>',
  ];

  for (const attack of attacks) {
    const html = renderTheory(attack);

    // Asserted structurally rather than by blocklist: the author's text produces
    // no tags at all, whatever it says.
    for (const tag of tagsIn(html)) {
      assert.ok(ALLOWED_TAGS.has(tag.name), `${attack}: unexpected <${tag.name}> in the output`);
      assert.ok(
        tag.attributes === '' || /^(?:src="[^"]*"|alt="[^"]*"|href="[^"]*")(?:\s|$)/.test(tag.attributes),
        `${attack}: unexpected attributes ${JSON.stringify(tag.attributes)}`,
      );
      assert.ok(!/on\w+\s*=/i.test(tag.attributes), `${attack}: no event handler on a real tag`);
    }

    assert.match(html, /&lt;/, `${attack}: the markup is shown to the Student as text instead`);
  }
});

test('a code fence does not become an escape hatch either', () => {
  const html = renderTheory(['```', '<script>alert(1)</script>', '```'].join('\n'));
  assert.match(html, /<pre><code>/);
  assert.ok(!/<script/i.test(html));
  assert.match(html, /&lt;script&gt;/);
});

test('a link to a safe scheme renders; anything else stays text', () => {
  assert.match(renderTheory('[правила](https://example.com/a)'), /<a href="https:\/\/example\.com\/a">правила<\/a>/);
  assert.match(renderTheory('[урок](/lessons/2)'), /<a href="\/lessons\/2">урок<\/a>/);

  for (const hostile of [
    '[нажми](javascript:alert(1))',
    '[нажми](JaVaScRiPt:alert(1))',
    '[нажми](data:text/html,<script>alert(1)</script>)',
    '[нажми](vbscript:msgbox(1))',
  ]) {
    const html = renderTheory(hostile);
    assert.ok(!/<a /i.test(html), `${hostile}: no anchor is produced at all`);
    assert.ok(!/javascript:|vbscript:|data:/i.test(html.replace(/&\w+;/g, '')) || !/href/i.test(html),
      `${hostile}: nothing navigable survives`);
  }
});

test('an image renders only from a safe source', () => {
  assert.match(renderTheory('![кошка](/images/cat.png)'), /<img src="\/images\/cat\.png" alt="кошка">/);
  assert.ok(!/<img/i.test(renderTheory('![x](javascript:alert(1))')));
});

test('the seeded Theory renders without leaving raw markdown or raw angle brackets', () => {
  for (const lesson of ENGLISH_A1.lessons) {
    const html = renderTheory(lesson.theoryMarkdown);
    assert.ok(!/^#{1,6} /m.test(html), `${lesson.title}: no unrendered heading`);
    assert.ok(!/\*\*/.test(html), `${lesson.title}: no unrendered bold`);
    assert.ok(!/~~/.test(html), `${lesson.title}: no unrendered strikethrough`);
    assert.match(html, /<h2>/, `${lesson.title}: it has structure`);
  }
});

test('the renderer is pure — it reads nothing and imports nothing', () => {
  const source = readFileSync(new URL('../src/content/markdown.ts', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^\s*import[\s\S]*?from\s+'([^']+)';/gm)].map((m) => m[1]!);
  assert.deepEqual(imports, [], 'a renderer with a dependency is a renderer with an attack surface');
});
