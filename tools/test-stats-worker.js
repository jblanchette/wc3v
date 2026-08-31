/**
 * test-stats-worker.js — the payload validation of workers/stats.
 *
 * The beacon's whole privacy posture rests on sanitize(): whatever a page,
 * an extension, or a stray crawler POSTs, only allowlisted events and
 * pattern-checked fields may reach the dataset. The bugs this exists to
 * prevent are silent ones: a query string or replay id leaking through the
 * path field, a full referrer URL being stored instead of a hostname, or an
 * unknown event minting unbounded dataset cardinality.
 *
 * Usage: node tools/test-stats-worker.js
 */

const fs = require('fs');
const path = require('path');

// Same trick as test-edge-worker.js: the Worker is an ES module and this repo
// is CommonJS, so evaluate just the pure function.
const src = fs.readFileSync(
  path.join(__dirname, '..', 'workers', 'stats', 'src', 'index.js'), 'utf8');

const body = src
  .replace(/^export default[\s\S]*?^};$/m, '')
  .replace(/^export \{[^}]*\};$/m, '')
  .replace(/^export /gm, '');

const { sanitize, EVENTS } =
  new Function(body + '\n;return { sanitize, EVENTS };')();

let pass = 0;
const failures = [];
function check (name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; return; }
  failures.push({ name, expected: e, actual: a });
}

// ── garbage in, null out ────────────────────────────────────────────────────
check('null payload', sanitize(null), null);
check('non-object', sanitize('pageview'), null);
check('no src', sanitize({ e: 'pageview' }), null);
check('bad src', sanitize({ src: 'edge', e: 'install_fetch' }), null);   // edge is Worker-internal only
check('unknown event', sanitize({ src: 'site', e: 'made_up' }), null);
check('app event from site', sanitize({ src: 'site', e: 'app_launch' }), null);
check('site event from app', sanitize({ src: 'app', e: 'pageview' }), null);

// ── the path field cannot leak a query, fragment, or replay id ──────────────
check('plain pageview',
  sanitize({ src: 'site', e: 'pageview', p: '/builds' }),
  { src: 'site', event: 'pageview', path: '/builds', referrer: '', version: '', os: '' });
check('query stripped',
  sanitize({ src: 'site', e: 'pageview', p: '/viewer.html?r=some-replay-id' }).path,
  '/viewer.html');
check('fragment stripped',
  sanitize({ src: 'site', e: 'pageview', p: '/learn#section' }).path,
  '/learn');
check('relative path refused',
  sanitize({ src: 'site', e: 'pageview', p: 'builds' }).path, '');
check('weird chars refused',
  sanitize({ src: 'site', e: 'pageview', p: '/a b<c>' }).path, '');
check('overlong path refused',
  sanitize({ src: 'site', e: 'pageview', p: '/' + 'x'.repeat(200) }).path, '');

// ── referrer becomes a hostname or nothing ──────────────────────────────────
check('referrer reduced to host',
  sanitize({ src: 'site', e: 'pageview', p: '/', r: 'https://www.google.com/search?q=wc3v' }).referrer,
  'www.google.com');
check('own site dropped',
  sanitize({ src: 'site', e: 'pageview', p: '/', r: 'https://wc3v.com/builds' }).referrer, '');
check('own subdomain dropped',
  sanitize({ src: 'site', e: 'pageview', p: '/', r: 'https://cdn.wc3v.com/x' }).referrer, '');
check('non-URL referrer dropped',
  sanitize({ src: 'site', e: 'pageview', p: '/', r: 'not a url' }).referrer, '');

// ── app fields are pattern-checked ──────────────────────────────────────────
check('app launch',
  sanitize({ src: 'app', e: 'app_launch', v: '0.10.0', os: 'win' }),
  { src: 'app', event: 'app_launch', path: '', referrer: '', version: '0.10.0', os: 'win' });
check('junk version dropped',
  sanitize({ src: 'app', e: 'app_launch', v: '0.10.0-beta; DROP TABLE', os: 'win' }).version, '');
check('junk os dropped',
  sanitize({ src: 'app', e: 'app_launch', v: '1.0.0', os: 'amiga' }).os, '');
check('site fields ignored on app events',
  sanitize({ src: 'app', e: 'app_launch', p: '/secret', r: 'https://x.example' }).path, '');

// ── allowlists stay in step with the callers ────────────────────────────────
check('site allowlist', EVENTS.site, ['pageview', 'replay_parsed', 'download_copy']);
check('app allowlist', EVENTS.app, ['app_launch', 'app_game_parsed']);

if (failures.length) {
  console.error(`stats-worker: ${failures.length} FAILED, ${pass} passed`);
  for (const f of failures) {
    console.error(`  ${f.name}\n    expected ${f.expected}\n    actual   ${f.actual}`);
  }
  process.exit(1);
}
console.log(`stats-worker: ${pass} checks passed`);
