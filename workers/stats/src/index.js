/**
 * wc3v stats Worker — the anonymous usage beacon.
 *
 * POST /api/event takes a tiny JSON body from the site or the desktop app and
 * writes one data point to Workers Analytics Engine. GET /install.ps1 counts
 * the fetch and passes the script through from origin byte-for-byte.
 *
 * THE PRIVACY CONTRACT (mirrored in client/privacy.html — change both or
 * neither):
 *
 *   - Nothing that identifies a person or a device is stored. No IP address,
 *     no user agent, no cookie, no generated ID of any kind. There is no way
 *     to tell two visits by the same person apart, which is the point: the
 *     data is anonymous aggregate, so no consent banner is owed under GDPR or
 *     the ePrivacy rules anywhere.
 *   - Country comes from Cloudflare's own edge geolocation (request.cf), a
 *     two-letter code derived in memory. The IP it was derived from is not
 *     written anywhere by this Worker.
 *   - The user agent is READ once, to drop crawlers and headless test
 *     browsers, and never stored.
 *   - Every stored field is validated against an allowlist or a tight
 *     pattern below. A payload that does not fit is dropped, not truncated
 *     into the dataset.
 *
 * Failure posture: this Worker must never break the site. Every branch that
 * can throw falls back to a plain 204 (the beacon) or a plain origin fetch
 * (install.ps1).
 *
 * Deploy: npm run worker:stats (wrangler, run by a human, never by Render).
 * Read the data back: node tools/stats-report.js
 */

// What each source is allowed to say. Unknown events are dropped so a typo'd
// caller cannot invent unbounded dataset cardinality.
const EVENTS = {
  site: ['pageview', 'replay_parsed', 'download_copy'],
  app: ['app_launch', 'app_game_parsed'],
  edge: ['install_fetch']
};

const MAX_BODY_BYTES = 1024;

// Crawlers that execute JS (Googlebot) and this repo's own headless test
// harnesses (page-audit, perf-bench) would otherwise count as visitors.
const BOT_UA = /bot|crawler|spider|headless|preview|lighthouse|python-requests|curl\//i;

/**
 * Validate a raw beacon payload into the exact shape that gets stored, or
 * null. Pure on purpose — tools/test-stats-worker.js runs it in plain Node.
 */
function sanitize (raw) {
  if (!raw || typeof raw !== 'object') return null;

  const src = raw.src;
  if (src !== 'site' && src !== 'app') return null;

  const event = typeof raw.e === 'string' ? raw.e : '';
  if (!EVENTS[src].includes(event)) return null;

  // Page path: site only. Query string and fragment never arrive (the client
  // strips them, and anything past ? or # is cut again here) so a replay id
  // or search term cannot leak in through the path field.
  let path = '';
  if (src === 'site' && typeof raw.p === 'string') {
    path = raw.p.split(/[?#]/)[0];
    if (!/^\/[A-Za-z0-9/._-]{0,95}$/.test(path)) path = '';
  }

  // Referrer: the hostname only, never a full URL, and never our own.
  let referrer = '';
  if (src === 'site' && typeof raw.r === 'string' && raw.r) {
    try {
      const host = new URL(raw.r).hostname.toLowerCase();
      if (host && host.length <= 64 &&
          host !== 'wc3v.com' && !host.endsWith('.wc3v.com') &&
          host !== 'localhost' && host !== '127.0.0.1') {
        referrer = host;
      }
    } catch (_) { /* not a URL — drop it */ }
  }

  // App build info: version must look like a release, OS is an enum.
  let version = '';
  let os = '';
  if (src === 'app') {
    if (typeof raw.v === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(raw.v)) version = raw.v;
    if (raw.os === 'win' || raw.os === 'mac' || raw.os === 'linux') os = raw.os;
  }

  return { src, event, path, referrer, version, os };
}

/**
 * Column layout for the dataset (fixed — stats-report.js reads by position):
 *   blob1 src, blob2 event, blob3 path, blob4 referrer, blob5 country,
 *   blob6 version, blob7 os · double1 count · index1 event
 */
function writePoint (env, point, country) {
  if (!env.STATS) return;   // dev without the binding — beacon still answers 204
  env.STATS.writeDataPoint({
    blobs: [point.src, point.event, point.path, point.referrer,
            country || '', point.version, point.os],
    doubles: [1],
    indexes: [point.event]
  });
}

function corsHeaders () {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}

async function handleBeacon (request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: corsHeaders() });
  }

  try {
    const ua = request.headers.get('user-agent') || '';
    if (!BOT_UA.test(ua)) {
      const text = await request.text();
      if (text.length <= MAX_BODY_BYTES) {
        const point = sanitize(JSON.parse(text));
        if (point) writePoint(env, point, request.cf && request.cf.country);
      }
    }
  } catch (_) { /* malformed body — the beacon still answers */ }

  return new Response(null, { status: 204, headers: corsHeaders() });
}

export default {
  async fetch (request, env, ctx) {
    let url;
    try {
      url = new URL(request.url);

      if (url.pathname === '/api/event') {
        return await handleBeacon(request, env);
      }

      // /install.ps1 — count, then serve from origin untouched. The origin's
      // headers (text/plain; charset, per render.yaml) matter for `irm | iex`,
      // so nothing about the response is modified here.
      if (url.pathname === '/install.ps1' && request.method === 'GET') {
        const ua = request.headers.get('user-agent') || '';
        // PowerShell's irm sends a WindowsPowerShell/Mozilla UA, not a bot
        // one; the filter only drops obvious crawlers indexing the file.
        if (!BOT_UA.test(ua)) {
          ctx.waitUntil(Promise.resolve().then(() => writePoint(env, {
            src: 'edge', event: 'install_fetch', path: '/install.ps1',
            referrer: '', version: '', os: ''
          }, request.cf && request.cf.country)));
        }
      }
    } catch (_) { /* fall through to origin no matter what */ }

    return fetch(request);
  }
};

// Exported for tools/test-stats-worker.js, which runs them in plain Node.
export { sanitize, EVENTS };
