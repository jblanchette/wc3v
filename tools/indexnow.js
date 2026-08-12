/**
 * indexnow.js — tell the IndexNow search engines that pages changed.
 *
 * IndexNow is a push protocol: instead of waiting to be crawled, you POST the
 * URLs that changed. Submitting to one participating engine fans out to all of
 * them. Consumed by Bing, Yandex, Naver, Seznam and Yep. NOT by Google, which
 * said in 2021 it would evaluate IndexNow and has never shipped it — so this is
 * additive to Search Console, never a replacement.
 *
 * Cloudflare can do this automatically via Crawler Hints, but that setting is
 * not available on this zone (checked 2026-08-12: not in the zone settings
 * list), so we submit directly. No Bing Webmaster Tools account is required —
 * ownership is proven purely by hosting the key file.
 *
 * The key file at client/<key>.txt must stay published. Its DIRECTORY scopes
 * what may be submitted: a key at the root authorises the whole site, which is
 * why it lives there rather than somewhere tidier.
 *
 * Usage:
 *   node tools/indexnow.js --all          submit every URL in sitemap.xml
 *   node tools/indexnow.js <url> [...]    submit specific URLs
 *   node tools/indexnow.js --all --dry-run
 *
 * Do not run this on every deploy. Submit when content actually changed;
 * spamming the endpoint with unchanged URLs is what gets a host ignored.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');
const HOST = 'wc3v.com';
const ORIGIN = 'https://' + HOST;
const ENDPOINT = 'https://api.indexnow.org/indexnow';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const all = argv.includes('--all');
const explicit = argv.filter(a => a.startsWith('http'));

/** The key is whichever <32-hex>.txt sits at the client root. One source of truth. */
function findKey () {
  const hits = fs.readdirSync(CLIENT)
    .filter(f => /^[a-f0-9]{8,128}\.txt$/i.test(f));
  if (!hits.length) return null;
  if (hits.length > 1) {
    console.error('indexnow: more than one key file at the client root: ' + hits.join(', '));
    process.exit(1);
  }
  const key = path.basename(hits[0], '.txt');
  const body = fs.readFileSync(path.join(CLIENT, hits[0]), 'utf8').trim();
  if (body !== key) {
    console.error('indexnow: ' + hits[0] + ' must contain exactly its own key. ' +
      'Found ' + JSON.stringify(body.slice(0, 40)));
    process.exit(1);
  }
  return key;
}

function sitemapUrls () {
  const p = path.join(CLIENT, 'sitemap.xml');
  if (!fs.existsSync(p)) {
    console.error('indexnow: no sitemap.xml — run `npm run gen-seo` first');
    process.exit(1);
  }
  return [...fs.readFileSync(p, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
}

async function main () {
  const key = findKey();
  if (!key) {
    console.error('indexnow: no key file found at client/<key>.txt');
    process.exit(1);
  }

  const urls = all ? sitemapUrls() : explicit;
  if (!urls.length) {
    console.error('indexnow: nothing to submit. Pass --all or one or more URLs.');
    process.exit(1);
  }

  const foreign = urls.filter(u => !u.startsWith(ORIGIN));
  if (foreign.length) {
    console.error('indexnow: refusing to submit URLs off ' + HOST + ': ' + foreign.join(', '));
    process.exit(1);
  }
  if (urls.length > 10000) {
    console.error('indexnow: ' + urls.length + ' URLs exceeds the 10,000 per-batch limit');
    process.exit(1);
  }

  const payload = {
    host: HOST,
    key,
    keyLocation: ORIGIN + '/' + key + '.txt',
    urlList: urls
  };

  console.log('indexnow: ' + urls.length + ' URL(s), key ' + key.slice(0, 8) + '…');
  console.log('  keyLocation: ' + payload.keyLocation);
  for (const u of urls.slice(0, 5)) console.log('    ' + u);
  if (urls.length > 5) console.log('    … and ' + (urls.length - 5) + ' more');

  if (dryRun) { console.log('  (dry run — nothing submitted)'); return; }

  // The key file has to be reachable before submitting, or the endpoint 403s
  // and the host can be penalised for repeated bad submissions.
  const probe = await fetch(payload.keyLocation);
  if (!probe.ok) {
    console.error('  key file is not reachable (' + probe.status + '). ' +
      'Deploy it before submitting.');
    process.exit(1);
  }
  const probeBody = (await probe.text()).trim();
  if (probeBody !== key) {
    console.error('  key file served the wrong contents: ' + JSON.stringify(probeBody.slice(0, 40)));
    process.exit(1);
  }
  console.log('  key file verified live');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });

  const meaning = {
    200: 'accepted',
    202: 'accepted, key validation pending',
    400: 'bad request format',
    403: 'key not valid or not reachable',
    422: 'a URL does not match the host, or the key does not match',
    429: 'rate limited — too many submissions'
  }[res.status] || 'unexpected';

  console.log('  HTTP ' + res.status + ' — ' + meaning);
  if (res.status !== 200 && res.status !== 202) {
    console.error('  body: ' + (await res.text()).slice(0, 300));
    process.exit(1);
  }
}

main().catch(e => { console.error('indexnow: ' + e.message); process.exit(1); });
