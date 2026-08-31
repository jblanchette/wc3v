/**
 * seo/html-to-md.js — convert one of this site's prose pages to Markdown.
 *
 * Why this exists rather than `npm i turndown`: the Render static build runs
 * with no `npm install`, so anything in the build path has to be Node built-ins
 * only (same constraint gen-asset-manifest.js documents). This is the price of
 * that constraint, paid once.
 *
 * It is deliberately STRICT, not tolerant. A tolerant HTML-to-Markdown pass
 * silently produces a mangled twin, and a mangled twin is worse than no twin:
 * it is the version an AI crawler reads and quotes. So the tag whitelist is
 * closed and anything outside it THROWS, which fails gen-seo, which fails the
 * deploy — and render.yaml already documents a failed deploy as the safe
 * outcome, because the previous deploy keeps serving.
 *
 * It is a character-state tokenizer, not a pile of regexes. Regex HTML parsing
 * breaks on `<a title="a > b">` and on nested same-name tags, both of which
 * occur on real pages.
 *
 * Scope: the prose pages (about, community, download, privacy, terms). It is
 * NOT for index.html or the build pages — their real content is rendered from
 * JSON at runtime, so converting their HTML would yield a tagline and a footer.
 * Those get 'generated' twins built from the source data instead.
 */

'use strict';

// Elements whose entire subtree is discarded: chrome, scripts, and interactive
// widgets that carry no prose.
const DROP_SUBTREE = new Set([
  'script', 'style', 'svg', 'nav', 'footer', 'button', 'dialog',
  'noscript', 'template', 'video', 'audio', 'canvas', 'iframe', 'form', 'select'
]);

// Elements that produce Markdown structure.
const BLOCK = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote',
  'pre', 'hr', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  // A <summary> is the question of an FAQ entry. It becomes an h3 so the twin
  // keeps the question/answer structure a collapsed <details> has visually.
  'summary'
]);

// Elements with no Markdown meaning that we simply descend through.
const TRANSPARENT = new Set([
  'main', 'article', 'section', 'div', 'span', 'header', 'figure',
  'figcaption', 'aside', 'small', 'time', 'label', 'picture', 'source',
  // Collapsed in the page, always open in the twin: a crawler should read the
  // answers whether or not a human clicked to expand them.
  'details'
]);

// Inline elements with a Markdown equivalent.
const INLINE = new Set(['a', 'strong', 'b', 'em', 'i', 'code', 'br', 'img', 'sup', 'sub', 'u']);

const VOID = new Set(['br', 'img', 'hr', 'source', 'input', 'meta', 'link']);

// The entities that actually appear on these pages, plus the ones that always
// matter. Numeric references are handled generically; named ones are an
// explicit list because guessing is how you end up with a wrong character in
// published copy. An unknown name passes through unchanged AND is reported, so
// it shows up in the gen-seo summary instead of quietly shipping as literal
// "&rarr;" in the markdown twin.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', shy: '',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
  times: '×', divide: '÷', plusmn: '±', minus: '−',
  middot: '·', bull: '•', dagger: '†', sect: '§', para: '¶',
  deg: '°', copy: '©', reg: '®', trade: '™',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  frac12: '½', frac14: '¼', frac34: '¾',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ouml: 'ö', uuml: 'ü', auml: 'ä'
};

// Collector for unknown entity names seen during one conversion. Module-scoped
// because parseOpenTag decodes attribute values and has no conversion context
// to thread through; htmlToMarkdown resets it per call.
let _unknownEntities = new Set();

function decodeEntities (s, unknown = _unknownEntities) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    const v = ENTITIES[body.toLowerCase()];
    if (v === undefined) { if (unknown) unknown.add(body); return m; }
    return v;
  });
}

/**
 * Tokenize. Returns [{type:'open'|'close'|'text'|'comment', name?, attrs?, self?, text?}].
 * Raw-text elements (script/style) have their contents consumed without any
 * tag parsing, which is what the HTML spec requires and what a regex cannot do.
 */
function tokenize (html) {
  const out = [];
  let i = 0;
  const n = html.length;

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { pushText(html.slice(i)); break; }
    if (lt > i) pushText(html.slice(i, lt));

    // Comment / doctype / CDATA
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      const stop = end === -1 ? n : end + 3;
      out.push({ type: 'comment', text: html.slice(lt + 4, end === -1 ? n : end) });
      i = stop;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? n : end + 1;
      continue;
    }

    // Closing tag
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      if (end === -1) { pushText(html.slice(lt)); break; }
      out.push({ type: 'close', name: html.slice(lt + 2, end).trim().toLowerCase() });
      i = end + 1;
      continue;
    }

    // Opening tag. Walk attributes so a quoted '>' does not end it early.
    const parsed = parseOpenTag(html, lt);
    if (!parsed) { pushText(html.slice(lt, lt + 1)); i = lt + 1; continue; }
    out.push({ type: 'open', name: parsed.name, attrs: parsed.attrs, self: parsed.self });
    i = parsed.end;

    // Raw-text elements: consume to the matching close tag verbatim.
    if (parsed.name === 'script' || parsed.name === 'style') {
      const close = html.toLowerCase().indexOf('</' + parsed.name, i);
      const stop = close === -1 ? n : close;
      out.push({ type: 'text', text: html.slice(i, stop), raw: true });
      if (close !== -1) {
        const gt = html.indexOf('>', close);
        out.push({ type: 'close', name: parsed.name });
        i = gt === -1 ? n : gt + 1;
      } else {
        i = n;
      }
    }
  }

  function pushText (t) { if (t) out.push({ type: 'text', text: t }); }
  return out;
}

function parseOpenTag (html, start) {
  const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(start));
  if (!m) return null;
  const name = m[1].toLowerCase();
  let i = start + m[0].length;
  const attrs = {};

  while (i < html.length) {
    while (i < html.length && /\s/.test(html[i])) i++;
    if (html[i] === '>') return { name, attrs, self: false, end: i + 1 };
    if (html[i] === '/' && html[i + 1] === '>') return { name, attrs, self: true, end: i + 2 };

    const an = /^[^\s=/>]+/.exec(html.slice(i));
    if (!an) { i++; continue; }
    const attrName = an[0].toLowerCase();
    i += an[0].length;

    while (i < html.length && /\s/.test(html[i])) i++;
    if (html[i] !== '=') { attrs[attrName] = ''; continue; }
    i++;
    while (i < html.length && /\s/.test(html[i])) i++;

    let value = '';
    const q = html[i];
    if (q === '"' || q === "'") {
      const end = html.indexOf(q, i + 1);
      value = html.slice(i + 1, end === -1 ? html.length : end);
      i = end === -1 ? html.length : end + 1;
    } else {
      const uv = /^[^\s>]*/.exec(html.slice(i));
      value = uv[0];
      i += uv[0].length;
    }
    attrs[attrName] = decodeEntities(value);
  }
  return { name, attrs, self: false, end: html.length };
}

/** Extract the innerHTML of the first <main>…</main>, depth-aware. */
function extractMain (html) {
  const open = /<main\b[^>]*>/i.exec(html);
  if (!open) return null;
  const start = open.index + open[0].length;
  let depth = 1;
  const re = /<\/?main\b[^>]*>/gi;
  re.lastIndex = start;
  let m;
  while ((m = re.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index);
  }
  return html.slice(start);
}

function absolutize (href, origin) {
  if (!href) return href;
  if (/^(https?:|mailto:|tel:|#|data:)/i.test(href)) return href;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return origin + href;
  return origin + '/' + href.replace(/^\.\//, '');
}

/**
 * @param {string} html   full page HTML
 * @param {object} opts   { origin, file }
 * @returns {{markdown: string, warnings: string[]}}
 */
function htmlToMarkdown (html, opts) {
  const origin = (opts && opts.origin) || 'https://wc3v.com';
  const where = (opts && opts.file) || '<html>';

  const inner = extractMain(html);
  if (inner === null) throw new Error(where + ': no <main> element to convert');

  _unknownEntities = new Set();
  const tokens = tokenize(inner);
  const warnings = [];

  // Output accumulates as blocks so blank-line handling stays in one place.
  const blocks = [];
  let buf = '';                     // current inline run
  const listStack = [];             // [{ ordered, index }]
  const hrefStack = [];             // hrefs of the currently-open <a> elements
  let dropDepth = 0;                // >0 while inside a dropped subtree
  let dropName = null;
  let inPre = false;
  const openStack = [];

  // Leading indentation is structural (nested list items) but the flush below
  // collapses and trims whitespace, which would eat it. So the marker prefix
  // is held separately and re-applied after the content is normalised.
  let linePrefix = '';

  const flush = () => {
    const t = buf.replace(/[ \t]+/g, ' ').trim();
    if (t) blocks.push(linePrefix + t);
    buf = '';
    linePrefix = '';
  };

  for (const tok of tokens) {
    if (tok.type === 'comment') continue;

    if (dropDepth > 0) {
      if (tok.type === 'open' && tok.name === dropName && !tok.self && !VOID.has(tok.name)) dropDepth++;
      else if (tok.type === 'close' && tok.name === dropName) dropDepth--;
      if (dropDepth === 0) dropName = null;
      continue;
    }

    if (tok.type === 'text') {
      if (tok.raw) continue;
      let t = decodeEntities(tok.text);
      if (!inPre) {
        if (!/\S/.test(t)) { if (buf && !/\s$/.test(buf)) buf += ' '; continue; }
        t = t.replace(/\s+/g, ' ');
      }
      buf += t;
      continue;
    }

    const name = tok.name;

    if (tok.type === 'open') {
      if (DROP_SUBTREE.has(name)) {
        if (!tok.self && !VOID.has(name)) { dropDepth = 1; dropName = name; }
        continue;
      }
      if (!BLOCK.has(name) && !TRANSPARENT.has(name) && !INLINE.has(name)) {
        throw new Error(
          where + ': unhandled tag <' + name + '>. Add it to the whitelist in ' +
          'seo/html-to-md.js, add it to DROP_SUBTREE, or hand-write the twin ' +
          'in seo/copy/ and set md: \'copy:…\' in seo/pages.js.'
        );
      }
      if (!VOID.has(name) && !tok.self) openStack.push(name);

      switch (name) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
          flush(); buf = '#'.repeat(Number(name[1])) + ' '; break;
        case 'summary': flush(); buf = '### '; break;
        case 'p': case 'blockquote': case 'dt': case 'dd':
          flush(); if (name === 'blockquote') buf = '> ';
          if (name === 'dd') buf = ': ';
          break;
        case 'ul': case 'ol':
          flush(); listStack.push({ ordered: name === 'ol', index: 0 }); break;
        case 'li': {
          flush();
          const l = listStack[listStack.length - 1] || { ordered: false, index: 0 };
          l.index++;
          linePrefix = '  '.repeat(Math.max(0, listStack.length - 1));
          buf = l.ordered ? l.index + '. ' : '- ';
          break;
        }
        case 'pre': flush(); inPre = true; blocks.push('```'); break;
        case 'hr': flush(); blocks.push('---'); break;
        case 'br': buf += '  \n'; break;
        case 'tr': flush(); buf = '| '; break;
        case 'th': case 'td': if (buf && !buf.endsWith('| ')) buf += ' | '; break;
        case 'strong': case 'b': buf += '**'; break;
        case 'em': case 'i': buf += '*'; break;
        case 'code': if (!inPre) buf += '`'; break;
        case 'a':
          buf += '[';
          hrefStack.push(absolutize(tok.attrs.href, origin));
          break;
        case 'img': {
          const alt = (tok.attrs.alt || '').trim();
          if (alt) buf += '![' + alt + '](' + absolutize(tok.attrs.src, origin) + ')';
          break;
        }
        default: break;   // transparent
      }
      continue;
    }

    // close
    if (tok.type === 'close') {
      const idx = openStack.lastIndexOf(name);
      if (idx !== -1) openStack.splice(idx, 1);
      else if (!VOID.has(name)) { warnings.push(where + ': stray </' + name + '>'); continue; }

      switch (name) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        case 'p': case 'blockquote': case 'li': case 'dt': case 'dd': case 'tr':
        case 'summary':
          flush(); break;
        case 'ul': case 'ol': listStack.pop(); flush(); break;
        case 'pre': inPre = false; flush(); blocks.push('```'); break;
        case 'strong': case 'b': buf += '**'; break;
        case 'em': case 'i': buf += '*'; break;
        case 'code': if (!inPre) buf += '`'; break;
        case 'a': {
          const href = hrefStack.pop();
          buf += '](' + (href || '') + ')';
          break;
        }
        default: break;
      }
      continue;
    }
  }
  flush();

  const md = blocks
    .join('\n\n')
    .replace(/\[\]\([^)]*\)/g, '')        // links whose text was all dropped
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();

  for (const name of _unknownEntities) {
    warnings.push(where + ': unknown entity &' + name + '; left as literal text ' +
      '(add it to ENTITIES in seo/html-to-md.js)');
  }

  return { markdown: md + '\n', warnings };
}

module.exports = { htmlToMarkdown, tokenize, extractMain, decodeEntities };
