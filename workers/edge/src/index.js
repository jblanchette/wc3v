/**
 * wc3v edge Worker — content negotiation and the machine-readable surfaces.
 *
 * The site is a Render static host behind Cloudflare. Two things a static host
 * cannot do are done here instead:
 *
 *   1. `Accept: text/markdown` negotiation. Every page has a .md twin emitted
 *      by tools/gen-seo.js; this serves it to agents that ask, while browsers
 *      keep getting HTML from the same URL.
 *   2. Correct media types, CORS, ETag and HEAD behaviour on /.well-known/*,
 *      which RFC 9727 in particular is fussy about.
 *
 * What is deliberately NOT here: the site-level `Link` header. It is a constant
 * string on every page, so it lives in render.yaml where it costs nothing and
 * survives a Worker outage. Only the per-page `rel="alternate"` link, which
 * varies by URL, is added below.
 *
 * ROUTES ARE ENUMERATED, NOT WILDCARD. See wrangler.toml. A Worker route runs
 * on every matching request — Cloudflare's cache does not short-circuit it — so
 * `wc3v.com/*` would bill an invocation for every /assets/* request even though
 * those 301 to R2 from the origin. The free tier is 100k requests/day and HTML
 * pageviews are nowhere near it; asset requests would be.
 *
 * Deploy: npm run worker:edge (wrangler, run by a human, never by Render).
 */

const MD_TYPE = 'text/markdown; charset=utf-8';

// Paths under /.well-known that need a media type Render cannot infer, because
// the file has no extension. Render defaults those to binary/octet-stream.
const WELL_KNOWN_TYPES = {
  '/.well-known/api-catalog':
    'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
  '/.well-known/security.txt': 'text/plain; charset=utf-8',
  '/.well-known/agent-skills/index.json': 'application/json; charset=utf-8',
  '/.well-known/mcp/server-card.json': 'application/mcp-server-card+json',
  '/.well-known/ai-catalog.json': 'application/ai-catalog+json'
};

/**
 * The q-value for one media type in an Accept header, or null if absent.
 * Absent is NOT the same as q=0: `*​/*` must not be read as "markdown is fine".
 */
function qValue (accept, type) {
  for (const part of accept.split(',')) {
    const bits = part.trim().split(';');
    if (bits[0].trim().toLowerCase() !== type) continue;
    const q = bits.slice(1).map(s => s.trim()).find(s => s.startsWith('q='));
    if (!q) return 1;
    const n = parseFloat(q.slice(2));
    return Number.isFinite(n) ? n : 1;
  }
  return null;
}

/**
 * Only true when the client NAMED text/markdown and did not rank it below HTML.
 * Every browser sends text/html plus a wildcard; curl sends `*​/*`. Both land on
 * false, which is the whole point.
 */
function prefersMarkdown (accept) {
  if (!accept) return false;
  const md = qValue(accept, 'text/markdown');
  if (md === null || md === 0) return false;
  const html = qValue(accept, 'text/html');
  return html === null ? true : md >= html;
}

/**
 * The twin path for a page URL. Mirrors mdUrl() in tools/gen-seo.js — the two
 * must agree or the Worker asks for files the generator never wrote.
 * Returns null for anything that is not a page.
 */
function twinPath (pathname) {
  if (pathname === '/' || pathname === '/index.html') return '/index.md';
  if (pathname.endsWith('.html')) return pathname.slice(0, -5) + '.md';
  if (/\.[a-z0-9]+$/i.test(pathname)) return null;   // already has an extension
  return pathname.replace(/\/+$/, '') + '.md';
}

/**
 * The extensionless URL policy, enforced here rather than at the origin or in a
 * Redirect Rule.
 *
 * Not at the origin: Render resolves a static file BEFORE it consults its
 * `routes:`, including its own clean-URL fallback, so a /about.html -> /about
 * redirect there is silently a no-op while about.html exists on disk (measured
 * 2026-08-11). Not a Cloudflare Redirect Rule: that needs a token permission
 * this project does not have, and putting it here keeps one place responsible
 * for what a URL means.
 *
 * /404.html is excluded because it is the error document, not a page — Render
 * serves it in place, and redirecting it would turn every 404 into a redirect
 * to a URL that is itself a 404.
 */
const NO_REDIRECT = new Set(['/404.html']);

function canonicalPath (pathname) {
  if (!pathname.endsWith('.html') || NO_REDIRECT.has(pathname)) return null;
  const stripped = pathname.slice(0, -5);
  // A directory index maps to the directory, not to a literal ".../index".
  // /index.html -> / and /api/index.html -> /api. The api docs page really does
  // live at client/api/index.html, because client/api.html and the client/api/
  // directory would both claim /api and Render resolves the directory first.
  if (stripped === '/index') return '/';
  if (stripped.endsWith('/index')) return stripped.slice(0, -'/index'.length);
  return stripped;
}

function withCors (headers) {
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  headers.set('access-control-expose-headers', 'ETag, Content-Type, Link');
  return headers;
}

async function handleWellKnown (request, url) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withCors(new Headers()) });
  }

  const res = await fetch(request);
  const headers = withCors(new Headers(res.headers));

  const type = WELL_KNOWN_TYPES[url.pathname];
  if (type && res.ok) headers.set('content-type', type);

  // RFC 9727 §2: the catalog must answer HEAD with a Link header carrying the
  // relation. render.yaml sets this too; setting it here as well means it holds
  // even if the origin rule is ever dropped.
  if (url.pathname === '/.well-known/api-catalog') {
    headers.set('link', '<' + url.origin + '/.well-known/api-catalog>; rel="api-catalog"');
  }

  return new Response(request.method === 'HEAD' ? null : res.body, {
    status: res.status,
    statusText: res.statusText,
    headers
  });
}

export default {
  async fetch (request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/.well-known/')) {
      return handleWellKnown(request, url);
    }

    // One canonical URL per page. Every page previously answered on both
    // /about and /about.html with identical bytes, and the canonical tags
    // disagreed about which one won.
    const canonical = canonicalPath(url.pathname);
    if (canonical) {
      const to = new URL(url);
      to.pathname = canonical;
      return Response.redirect(to.toString(), 301);   // query string preserved
    }

    const twin = prefersMarkdown(request.headers.get('accept') || '') && twinPath(url.pathname);

    if (twin) {
      // Fetch the twin by its OWN url. This is what keeps the edge cache honest
      // on the free plan, which does not vary on Accept: two different bodies
      // never share one cache key, because /about and /about.md are different
      // keys. Vary: Accept below is for browsers and intermediaries.
      const twinUrl = new URL(url);
      twinUrl.pathname = twin;
      twinUrl.search = '';

      const res = await fetch(twinUrl.toString(), {
        headers: { accept: 'text/plain, */*' },
        cf: { cacheTtl: 300, cacheEverything: true }
      });

      // Fall through to HTML on ANY miss. The Worker deploys via wrangler and
      // the site deploys via git, so they are never atomic: right after a page
      // is added, the twin may not exist yet. Proxying that 404 would turn a
      // working HTML page into a broken markdown one.
      if (res.ok) {
        const headers = new Headers(res.headers);
        headers.set('content-type', MD_TYPE);
        headers.set('content-location', twin);
        headers.set('vary', 'Accept');
        headers.set('cache-control', 'public, max-age=0, must-revalidate');
        headers.set('access-control-allow-origin', '*');
        return new Response(request.method === 'HEAD' ? null : res.body, {
          status: 200,
          headers
        });
      }
    }

    const res = await fetch(request);
    const headers = new Headers(res.headers);
    headers.append('vary', 'Accept');

    // Per-page pointer at the twin. The site-level rels are in render.yaml.
    const alt = twinPath(url.pathname);
    if (alt && (res.headers.get('content-type') || '').includes('text/html')) {
      headers.append('link', '<' + url.origin + alt + '>; rel="alternate"; type="text/markdown"');
    }

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers
    });
  }
};

// Exported for tools/test-edge-worker.js, which runs them in plain Node.
export { qValue, prefersMarkdown, twinPath };
