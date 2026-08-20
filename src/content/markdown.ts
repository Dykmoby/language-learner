// Theory, rendered.
//
// A deliberately small subset of markdown rather than a library: what a Lesson's
// Theory needs is headings, lists, tables, emphasis and the occasional link, and
// every additional construct is additional surface. The whole source is escaped
// *first*, so the only angle brackets in the output are the ones this file wrote.
// Raw HTML in the markdown is therefore shown as text, by construction rather
// than by a blocklist — and step 5 will have Claude generating this markdown,
// which is a weaker guarantee of good behaviour than an Admin typing it.
//
// No imports, no I/O: a renderer with a dependency is a renderer with an attack
// surface, and that is asserted by a test.

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Relative paths, fragments, and the two schemes a Lesson could legitimately
// want. Everything else — javascript:, data:, vbscript: — is not rendered as a
// link at all, rather than rendered with a scrubbed href.
const SAFE_URL = /^(?:https?:\/\/|mailto:|\/|#)[^\s"']*$/i;

function isSafeUrl(url: string): boolean {
  return SAFE_URL.test(url.trim());
}

// Applied to text that has already been escaped, so a backtick or an asterisk
// here came from the author and never from a tag.
function renderInline(text: string): string {
  // Code spans are taken out first and put back last: the point of a code span
  // is that what is inside it is not markup.
  const parts = text.split(/`([^`]+)`/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return `<code>${part}</code>`;
      return part
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt: string, src: string) =>
          isSafeUrl(src) ? `<img src="${src.trim()}" alt="${alt}">` : whole)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) =>
          isSafeUrl(href) ? `<a href="${href.trim()}">${label}</a>` : whole)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,!?;:)])/g, '$1<em>$2</em>');
    })
    .join('');
}

function tableRow(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
}

export function renderTheory(markdown: string): string {
  // Everything downstream works on escaped text. This is the whole XSS argument.
  const lines = escapeHtml(markdown.replace(/\r\n/g, '\n')).split('\n');

  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  let table: string[][] | null = null;
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.tag}>\n${list.items.map((i) => `<li>${renderInline(i)}</li>`).join('\n')}\n</${list.tag}>`);
    list = null;
  };
  const flushTable = () => {
    if (!table) return;
    const [head, ...body] = table;
    const headHtml = head === undefined ? ''
      : `<thead><tr>${head.map((c) => `<th>${renderInline(c)}</th>`).join('')}</tr></thead>`;
    const bodyHtml = body.length === 0 ? ''
      : `<tbody>${body.map((row) => `<tr>${row.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
    out.push(`<table>${headHtml}${bodyHtml}</table>`);
    table = null;
  };
  const flushAll = () => { flushParagraph(); flushList(); flushTable(); };

  for (const line of lines) {
    if (code !== null) {
      if (/^\s*```/.test(line)) {
        out.push(`<pre><code>${code.join('\n')}</code></pre>`);
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }

    if (/^\s*```/.test(line)) { flushAll(); code = []; continue; }

    if (line.trim() === '') { flushAll(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1]!.length;
      out.push(`<h${level}>${renderInline(heading[2]!.trim())}</h${level}>`);
      continue;
    }

    if (line.trimStart().startsWith('|')) {
      flushParagraph();
      flushList();
      if (isTableSeparator(line)) continue; // structure, not content
      (table ??= []).push(tableRow(line));
      continue;
    }
    flushTable();

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (list?.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
      list.items.push(bullet[1]!);
      continue;
    }

    const numbered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (numbered) {
      flushParagraph();
      if (list?.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; }
      list.items.push(numbered[1]!);
      continue;
    }

    // A continuation line inside a list item stays with the item — the fixture
    // wraps long list items across lines.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();

    paragraph.push(line.trim());
  }

  if (code !== null) out.push(`<pre><code>${code.join('\n')}</code></pre>`);
  flushAll();

  return out.join('\n');
}
