/**
 * test-html-to-md.js — fixtures for seo/html-to-md.js.
 *
 * The converter is strict on purpose (an unknown tag throws and fails the
 * deploy), so these tests cover both directions: that real page structures
 * convert correctly, and that the traps a regex-based converter falls into are
 * actually handled.
 *
 * Usage: node tools/test-html-to-md.js
 */

const { htmlToMarkdown, tokenize, decodeEntities } = require('./seo/html-to-md');

let pass = 0;
const failures = [];

function check (name, actual, expected) {
  const a = String(actual).trim();
  const e = String(expected).trim();
  if (a === e) { pass++; return; }
  failures.push({ name, expected: e, actual: a });
}

function md (inner, opts) {
  return htmlToMarkdown('<main>' + inner + '</main>', Object.assign({ file: 'test' }, opts)).markdown;
}

function throws (name, inner, matcher) {
  try {
    md(inner);
    failures.push({ name, expected: 'throw matching ' + matcher, actual: 'did not throw' });
  } catch (e) {
    if (matcher.test(e.message)) pass++;
    else failures.push({ name, expected: 'throw matching ' + matcher, actual: e.message });
  }
}

// ── headings, paragraphs, inline ─────────────────────────────────────────────
check('h1', md('<h1>Title</h1>'), '# Title');
check('h2 + p', md('<h2>Sub</h2><p>Body text.</p>'), '## Sub\n\nBody text.');
check('strong', md('<p>a <strong>b</strong> c</p>'), 'a **b** c');
check('em', md('<p>a <em>b</em> c</p>'), 'a *b* c');
check('code', md('<p>use <code>npm</code> here</p>'), 'use `npm` here');
check('nested inline', md('<p><strong>a <em>b</em></strong></p>'), '**a *b***');

// ── whitespace collapsing ────────────────────────────────────────────────────
check('collapse whitespace', md('<p>a\n   b\t\tc</p>'), 'a b c');
check('inline spacing across tags', md('<p>one <strong>two</strong> three</p>'), 'one **two** three');

// ── lists ────────────────────────────────────────────────────────────────────
check('ul', md('<ul><li>one</li><li>two</li></ul>'), '- one\n\n- two');
check('ol', md('<ol><li>one</li><li>two</li></ol>'), '1. one\n\n2. two');
check('nested ul indents', md('<ul><li>a<ul><li>b</li></ul></li></ul>'), '- a\n\n  - b');

// ── links ────────────────────────────────────────────────────────────────────
check('absolute link kept', md('<p><a href="https://x.test/y">t</a></p>'), '[t](https://x.test/y)');
check('root-relative absolutized', md('<p><a href="/about">t</a></p>'), '[t](https://wc3v.com/about)');
check('relative absolutized', md('<p><a href="about.html">t</a></p>'), '[t](https://wc3v.com/about.html)');
check('mailto untouched', md('<p><a href="mailto:a@b.test">m</a></p>'), '[m](mailto:a@b.test)');
check('protocol-relative', md('<p><a href="//x.test/y">t</a></p>'), '[t](https://x.test/y)');

// The trap that breaks regex converters: a quoted '>' inside an attribute.
check('gt inside attribute',
  md('<p><a href="/a" title="a > b">t</a> after</p>'),
  '[t](https://wc3v.com/a) after');

// ── dropped subtrees ─────────────────────────────────────────────────────────
check('script dropped', md('<p>a</p><script>var x = "<p>no</p>";</script><p>b</p>'), 'a\n\nb');
check('style dropped', md('<p>a</p><style>p { color: red }</style><p>b</p>'), 'a\n\nb');
check('svg subtree dropped', md('<p>a<svg><path d="M0 0"/></svg>b</p>'), 'ab');
check('nav dropped', md('<nav><a href="/">Home</a></nav><p>body</p>'), 'body');
check('footer dropped', md('<p>body</p><footer><a href="/">x</a></footer>'), 'body');
check('button dropped', md('<p>a</p><button>Click</button>'), 'a');
check('nested same-name drop',
  md('<p>a</p><nav><nav><a href="/">x</a></nav></nav><p>b</p>'), 'a\n\nb');

// ── images ───────────────────────────────────────────────────────────────────
check('img with alt', md('<p><img src="/a.png" alt="Alt text"></p>'), '![Alt text](https://wc3v.com/a.png)');
check('img without alt dropped', md('<p>x<img src="/a.png" alt="">y</p>'), 'xy');

// ── entities ─────────────────────────────────────────────────────────────────
check('named entities', md('<p>a &amp; b &mdash; c</p>'), 'a & b — c');
check('numeric entity', md('<p>&#8212;</p>'), '—');
check('hex entity', md('<p>&#x2014;</p>'), '—');
check('unknown entity left alone', md('<p>&zzz;</p>'), '&zzz;');
check('entity in attribute', md('<p><a href="/a?x=1&amp;y=2">t</a></p>'), '[t](https://wc3v.com/a?x=1&y=2)');

// ── structure ────────────────────────────────────────────────────────────────
check('transparent wrappers', md('<div><section><p>deep</p></section></div>'), 'deep');
check('hr', md('<p>a</p><hr><p>b</p>'), 'a\n\n---\n\nb');
check('comments ignored', md('<!-- note --><p>a</p>'), 'a');

// ── the strictness contract ──────────────────────────────────────────────────
throws('unknown tag throws', '<p>a</p><marquee>x</marquee>', /unhandled tag <marquee>/);

// The "no main" case needs the raw entry point: the md() helper wraps its
// input in <main>, so it could never exercise the missing-root path.
(function () {
  try {
    htmlToMarkdown('<body><p>x</p></body>', { file: 'test' });
    failures.push({ name: 'no main throws', expected: 'throw', actual: 'did not throw' });
  } catch (e) {
    if (/no <main>/.test(e.message)) pass++;
    else failures.push({ name: 'no main throws', expected: '/no <main>/', actual: e.message });
  }
})();

// ── details / summary ────────────────────────────────────────────────
// A collapsed FAQ is invisible in the page and must NOT be invisible in the
// twin: a crawler should read the answers whether or not a human expanded
// them. <summary> becomes an h3 so the question/answer structure survives.
check('details unwraps, summary becomes h3',
  md('<details><summary>Why?</summary><p>Because.</p></details>'),
  '### Why?\n\nBecause.');
check('several details in a row',
  md('<details><summary>One</summary><p>A.</p></details><details><summary>Two</summary><p>B.</p></details>'),
  '### One\n\nA.\n\n### Two\n\nB.');
check('summary keeps its inline markup',
  md('<details><summary>Read <code>install.ps1</code></summary><p>Yes.</p></details>'),
  '### Read `install.ps1`\n\nYes.');

// ── tokenizer units ──────────────────────────────────────────────────────────
check('tokenizer attr with gt',
  JSON.stringify(tokenize('<a title="x > y" href="/z">t</a>')[0].attrs),
  JSON.stringify({ title: 'x > y', href: '/z' }));
check('decodeEntities standalone', decodeEntities('a &lt;b&gt; &nbsp;c'), 'a <b>  c');

// ── report ───────────────────────────────────────────────────────────────────
console.log('html-to-md: ' + pass + ' passed, ' + failures.length + ' failed');
for (const f of failures) {
  console.log('\n  FAIL ' + f.name);
  console.log('    expected: ' + JSON.stringify(f.expected));
  console.log('    actual:   ' + JSON.stringify(f.actual));
}
process.exit(failures.length ? 1 : 0);
