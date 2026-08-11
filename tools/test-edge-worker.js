/**
 * test-edge-worker.js — the content-negotiation logic of workers/edge.
 *
 * The two bugs this exists to prevent are both silent:
 *   - `*​/*` (what curl and many crawlers send) being read as "markdown is
 *     acceptable", which would serve markdown to everything.
 *   - twinPath() drifting from mdUrl() in gen-seo.js, so the Worker asks the
 *     origin for files the generator never wrote.
 *
 * Usage: node tools/test-edge-worker.js
 */

const fs = require('fs');
const path = require('path');

// The Worker is an ES module and this repo is CommonJS, so load the source and
// evaluate just the pure functions. Cheaper and more honest than adding a
// bundler to test three functions.
const src = fs.readFileSync(
  path.join(__dirname, '..', 'workers', 'edge', 'src', 'index.js'), 'utf8');

const body = src
  .replace(/^export default[\s\S]*?^};$/m, '')
  .replace(/^export \{[^}]*\};$/m, '')
  .replace(/^export /gm, '');

const { qValue, prefersMarkdown, twinPath, canonicalPath } =
  new Function(body + '\n;return { qValue, prefersMarkdown, twinPath, canonicalPath };')();

let pass = 0;
const failures = [];
function check (name, actual, expected) {
  if (actual === expected) { pass++; return; }
  failures.push({ name, expected, actual });
}

// ── the */* trap and friends ────────────────────────────────────────────────
check('curl */*',            prefersMarkdown('*/*'), false);
check('empty accept',        prefersMarkdown(''), false);
check('missing accept',      prefersMarkdown(null), false);
check('chrome',              prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'), false);
check('firefox',             prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'), false);
check('json client',         prefersMarkdown('application/json'), false);

// ── genuine markdown requests ───────────────────────────────────────────────
check('bare markdown',       prefersMarkdown('text/markdown'), true);
check('markdown + wildcard', prefersMarkdown('text/markdown, */*'), true);
check('markdown first',      prefersMarkdown('text/markdown,text/html;q=0.9'), true);
check('equal q',             prefersMarkdown('text/markdown;q=0.9, text/html;q=0.9'), true);
check('markdown with space', prefersMarkdown('text/markdown ;q=1.0'), true);
check('uppercase type',      prefersMarkdown('TEXT/MARKDOWN'), true);

// ── markdown named but ranked below html ────────────────────────────────────
check('md below html',       prefersMarkdown('text/markdown;q=0.1, text/html;q=0.9'), false);
check('md q=0',              prefersMarkdown('text/markdown;q=0, text/html'), false);

// ── q parsing ───────────────────────────────────────────────────────────────
check('q absent -> 1',       qValue('text/markdown', 'text/markdown'), 1);
check('q parsed',            qValue('text/markdown;q=0.4', 'text/markdown'), 0.4);
check('type absent -> null', qValue('text/html', 'text/markdown'), null);
check('malformed q -> 1',    qValue('text/markdown;q=abc', 'text/markdown'), 1);

// ── twin paths ──────────────────────────────────────────────────────────────
check('root',            twinPath('/'), '/index.md');
check('index.html',      twinPath('/index.html'), '/index.md');
check('extensionless',   twinPath('/about'), '/about.md');
check('dot-html',        twinPath('/about.html'), '/about.md');
check('nested',          twinPath('/builds/ne-dh-fast-bear'), '/builds/ne-dh-fast-bear.md');
check('directory index', twinPath('/builds'), '/builds.md');
check('trailing slash',  twinPath('/builds/'), '/builds.md');
check('already md',      twinPath('/about.md'), null);
check('json asset',      twinPath('/data/x.json'), null);
check('css asset',       twinPath('/css/main.css'), null);

// ── twinPath must agree with gen-seo's mdUrl ────────────────────────────────
// Same inputs, same outputs, or the Worker requests files that do not exist.
const { PAGES } = require('./seo/pages');
function mdUrl (url) { return url === '/' ? '/index.md' : url + '.md'; }
for (const p of PAGES) {
  if (!p.md) continue;
  check('agrees with gen-seo for ' + p.url, twinPath(p.url), mdUrl(p.url));
}

// ── the Worker's routes must cover every page that has a twin ───────────────
const toml = fs.readFileSync(
  path.join(__dirname, '..', 'workers', 'edge', 'wrangler.toml'), 'utf8');
const patterns = [...toml.matchAll(/pattern\s*=\s*"wc3v\.com([^"]*)"/g)].map(m => m[1]);

function routed (urlPath) {
  return patterns.some(pat => {
    if (pat === urlPath) return true;
    if (!pat.includes('*')) return false;
    const re = new RegExp('^' + pat.split('*').map(s =>
      s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return re.test(urlPath);
  });
}
// Both the page AND its twin must be routed. Cloudflare rejects a wildcard
// anywhere but the start of the hostname or the end of the path, so there is no
// `*.md` pattern to lean on — each twin needs its own route.
for (const p of PAGES) {
  if (!p.md) continue;
  check('route covers ' + p.url, routed(p.url), true);
  check('route covers twin ' + mdUrl(p.url), routed(mdUrl(p.url)), true);
}
check('route covers /builds/<id>',     routed('/builds/ne-dh-fast-bear'), true);
check('route covers a build twin',     routed('/builds/ne-dh-fast-bear.md'), true);
check('route covers /builds.md',       routed('/builds.md'), true);
check('route covers .well-known',      routed('/.well-known/api-catalog'), true);
check('assets NOT routed',             routed('/assets/wc3icons/x.jpg'), false);
check('js NOT routed',                 routed('/js/app.js'), false);
check('css NOT routed',                routed('/css/main.css'), false);
check('summaries NOT routed',          routed('/data/summaries/x.json'), false);
check('openapi.json NOT routed',       routed('/api/openapi.json'), false);

// Cloudflare's own constraint, enforced here so an invalid pattern is caught
// locally instead of by a half-applied deploy (error 10022).
for (const pat of patterns) {
  const star = pat.indexOf('*');
  const valid = star === -1 || star === pat.length - 1;
  check('route pattern is legal: ' + pat, valid, true);
}

// ── the extensionless URL policy ────────────────────────────────────────────
check('about.html -> /about',      canonicalPath('/about.html'), '/about');
check('index.html -> /',           canonicalPath('/index.html'), '/');
check('builds.html -> /builds',    canonicalPath('/builds.html'), '/builds');
check('viewer.html -> /viewer',    canonicalPath('/viewer.html'), '/viewer');
check('extensionless untouched',   canonicalPath('/about'), null);
check('markdown twin untouched',   canonicalPath('/about.md'), null);
check('asset untouched',           canonicalPath('/css/main.css'), null);
check('root untouched',            canonicalPath('/'), null);
// The error document must not redirect: Render serves it in place, and a 301
// would turn every 404 into a redirect to a URL that is itself a 404.
check('404.html is NOT redirected', canonicalPath('/404.html'), null);

// A page that redirects must also be ROUTED, or the Worker never sees it.
for (const p of PAGES) {
  if (p.file === '404.html') continue;
  const htmlUrl = '/' + p.file;
  if (!htmlUrl.endsWith('.html')) continue;
  check('route covers ' + htmlUrl + ' (so it can 301)', routed(htmlUrl), true);
}

check('api/index.html -> /api',    canonicalPath('/api/index.html'), '/api');
check('builds/index.html -> /builds', canonicalPath('/builds/index.html'), '/builds');

// And the target of every redirect must itself resolve to a real page —
// including the generated ones, which are not in the hand-written PAGES list.
const { buildPages } = require('./seo/pages');
const knownUrls = new Set(
  PAGES.map(p => p.url).concat(buildPages().map(p => p.url)).concat(['/']));
for (const p of PAGES) {
  if (p.file === '404.html' || !p.file.endsWith('.html')) continue;
  const target = canonicalPath('/' + p.file);
  if (!target) continue;
  check('redirect target ' + target + ' is a real page',
    knownUrls.has(target) || target.startsWith('/builds/'), true);
}

// ── report ──────────────────────────────────────────────────────────────────
console.log('edge-worker: ' + pass + ' passed, ' + failures.length + ' failed');
for (const f of failures) {
  console.log('\n  FAIL ' + f.name);
  console.log('    expected: ' + JSON.stringify(f.expected));
  console.log('    actual:   ' + JSON.stringify(f.actual));
}
process.exit(failures.length ? 1 : 0);
