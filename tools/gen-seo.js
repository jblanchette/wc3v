/**
 * gen-seo.js — emit everything a search engine or an agent reads.
 *
 * Runs as part of the Render build (see render.yaml buildCommand), between
 * gen-builds-cards.js (whose output it reads) and gen-asset-manifest.js (which
 * rewrites cache busters in the HTML this emits).
 *
 * Emits:
 *   client/builds/<id>.html         one real page per curated build  (+ .md)
 *   client/builds/index.html        the build index                  (+ .md)
 *   client/index.md, learn.md       twins generated from source data
 *   client/<page>.md                twins converted from the page HTML
 *   client/data/summaries-index.json  the index 334 replay summaries never had
 *   client/sitemap.xml              real lastmod, no changefreq, no priority
 *   client/robots.txt               AI crawler stanzas + Content-Signal
 *   client/llms.txt, llms-full.txt
 *   client/.well-known/security.txt
 *   client/.well-known/agent-skills/index.json   with verified sha256 digests
 *
 * DESIGN CONSTRAINT: this script never mutates an existing hand-written HTML
 * file. gen-asset-manifest.js already owns HTML mutation, and two mutators
 * racing over the same files is how you get an unreproducible build. The only
 * HTML gen-seo writes is under client/builds/, which it owns entirely.
 *
 * Node built-ins only — no `npm install` on Render.
 *
 * Usage:
 *   node tools/gen-seo.js
 *   node tools/gen-seo.js --check     verify committed output is current; exit 1 if not
 *   node tools/gen-seo.js --dry-run   same as --check but never exits non-zero
 *   node tools/gen-seo.js --stamp     rewrite the lastmod ledger from git history
 *
 * Run --stamp AFTER committing a content change, not before: it reads
 * `git log -1` for each page, so an uncommitted edit still reports the previous
 * commit's date. Skipping it is harmless — a page whose hash no longer matches
 * the ledger is stamped with today's date, which is when the change ships.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { PAGES, allPages, ROOT, CLIENT } = require('./seo/pages');
const { htmlToMarkdown } = require('./seo/html-to-md');
const BP = require('./seo/build-page');

const ORIGIN = 'https://wc3v.com';
const SEO_DIR = path.join(__dirname, 'seo');
const COPY_DIR = path.join(SEO_DIR, 'copy');
const LEDGER = path.join(SEO_DIR, 'lastmod.json');

const argv = process.argv.slice(2);
const check = argv.includes('--check');
const dryRun = argv.includes('--dry-run') || check;
const stamp = argv.includes('--stamp');

// Render sets IS_PULL_REQUEST=true on preview deploys. Those publish to a
// *.onrender.com hostname that is not behind our zone, so without this every
// PR preview is a fully indexable duplicate of the whole site.
const isPreview = String(process.env.IS_PULL_REQUEST || '').toLowerCase() === 'true';

const writes = [];        // [{ rel, content }]
const problems = [];
const notes = [];

function emit (rel, content) {
  writes.push({ rel, content });
}

function readClient (rel) {
  return fs.readFileSync(path.join(CLIENT, rel), 'utf8');
}

function sha256 (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** URL of a page's markdown twin. The root is the special case: "/" + ".md"
 *  would be "/.md", which is a dotfile, not the homepage twin. */
function mdUrl (url) {
  return url === '/' ? '/index.md' : url + '.md';
}

// ── page metadata, read from the pages themselves ───────────────────────────

// `indexable` gates the checks: a noindex utility page (handoff, compare, the
// builds stub) has no reason to carry a meta description, and demanding one
// would train people to add junk to silence the build.
function metaOf (html, file, indexable) {
  const title = (/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1];
  const desc = (/<meta\s+name="description"\s+content="([^"]*)"/i.exec(html) || [])[1];
  if (!title) problems.push(file + ': no <title>');
  if (indexable && !desc) problems.push(file + ': no meta description');
  if (indexable) {
    if (!/rel="canonical"/.test(html)) problems.push(file + ': no rel=canonical');
    if (/<meta\s+name="robots"[^>]*content="[^"]*noindex/i.test(html)) {
      problems.push(file + ': marked noindex but sitemap:true in the registry');
    }
  }
  return {
    title: decodeBasic(title || ''),
    description: decodeBasic(desc || '')
  };
}

function decodeBasic (s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

// ── lastmod ledger ──────────────────────────────────────────────────────────
//
// Render does a shallow clone, so `git log` may return nothing there and every
// file mtime is checkout time — which would claim every page changed on every
// deploy, i.e. worse than omitting lastmod entirely. So dates live in a
// committed ledger keyed by a content hash, and the build only needs to compare
// hashes. `--stamp` refreshes the ledger locally, where git history exists.

/** Hash a page's meaningful content: cache busters and generated marker blocks
 *  are stripped so running gen-asset-manifest locally does not perturb it. */
function contentHash (html) {
  const normalized = html
    .replace(/\?v=[\w.]+/g, '')
    .replace(/\/\* @asset-version-begin \*\/[\s\S]*?\/\* @asset-version-end \*\//g, '')
    .replace(/\/\* @asset-hashes-begin \*\/[\s\S]*?\/\* @asset-hashes-end \*\//g, '')
    .replace(/\/\* @wc3v-asset-version-begin \*\/[\s\S]*?\/\* @wc3v-asset-version-end \*\//g, '')
    .replace(/\r\n/g, '\n');
  return sha256(normalized).slice(0, 16);
}

function loadLedger () {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')); } catch (e) { return {}; }
}

function today () {
  return new Date().toISOString().slice(0, 10);
}

function gitDate (rel) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', 'client/' + rel],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out ? out.slice(0, 10) : null;
  } catch (e) { return null; }
}

// ── summaries index ─────────────────────────────────────────────────────────

// client/data/summaries/ is not a clean corpus: alongside the tournament games
// it holds ~142 dev fixtures (test-*, goblab-reveal, landmine-deploy, …) left
// there by the parser test suite. They are useful locally and useless publicly,
// and publishing them as "the pro replay corpus" would be a false claim — plus
// they wreck any statistic computed over the set (they dragged the p25 game
// length down to 73 seconds).
//
// Two independent signals, ORed so neither has to be perfect:
//   - the tournament replayId shape, <digits>_<player>_<player>_<map>
//   - a substantive game: two or more raced players and at least five minutes
// The OR keeps three real pro games saved under dev names (gso,
// happy-vs-grubby, test-4v4) and two genuine tournament games that ended fast.
const TOURNAMENT_ID = /^\d{6,}_/;

function isPublicReplay (r) {
  if (TOURNAMENT_ID.test(r.replayId)) return true;
  return r.players.filter(p => p.race).length >= 2 && (r.durationSec || 0) >= 300;
}

function buildSummariesIndex (manifest) {
  const dir = path.join(CLIENT, 'data', 'summaries');
  if (!fs.existsSync(dir)) return null;

  // buildId lookup: replayId -> [buildId]
  const byReplay = new Map();
  for (const b of manifest.builds) {
    for (const r of b.replays || []) {
      if (!byReplay.has(r.replayId)) byReplay.set(r.replayId, []);
      if (!byReplay.get(r.replayId).includes(b.id)) byReplay.get(r.replayId).push(b.id);
    }
  }
  const tournamentByReplay = new Map();
  for (const b of manifest.builds) {
    for (const r of b.replays || []) {
      if (r.tournamentId) tournamentByReplay.set(r.replayId, r.tournamentId);
    }
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const replays = [];
  let skipped = 0;

  for (const f of files) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { skipped++; continue; }
    if (!j || !j.replayId || !j.players) { skipped++; continue; }

    const players = Object.entries(j.players).map(([slot, p]) => ({
      slot,
      name: p.name || null,
      race: p.race || null,
      hero: (p.heroOpener && p.heroOpener.name) || null,
      heroTimeSec: msToSec(p.heroOpener && p.heroOpener.gameTimeMs),
      tier2Sec: msToSec(p.tier2Time),
      tier3Sec: msToSec(p.tier3Time),
      expansionSec: msToSec(p.expansionTime)
    })).sort((a, b) => String(a.slot).localeCompare(String(b.slot)));

    const races = players.map(p => p.race).filter(Boolean).sort();
    replays.push({
      replayId: j.replayId,
      map: j.map || j.mapRaw || null,
      durationSec: msToSec(j.durationMs),
      matchup: races.length === 2 ? races[0] + 'v' + races[1] : null,
      players,
      builds: byReplay.get(j.replayId) || [],
      tournamentId: tournamentByReplay.get(j.replayId) || null
    });
  }

  if (skipped) notes.push(skipped + ' summary file(s) unreadable or malformed, omitted from the index');

  const publicReplays = replays.filter(isPublicReplay);
  const dropped = replays.length - publicReplays.length;
  if (dropped) notes.push(dropped + ' dev fixture(s) excluded from the public replay index');

  // Newest first, by the leading timestamp in the tournament id where present.
  publicReplays.sort((a, b) => a.replayId < b.replayId ? 1 : a.replayId > b.replayId ? -1 : 0);

  return {
    generatedAt: new Date().toISOString(),
    count: publicReplays.length,
    note: 'Index of the parsed pro replay corpus. Player names are the ' +
          'tournament handles already present in the public per-replay ' +
          'summaries; no visitor data appears here. Parser test fixtures are ' +
          'excluded.',
    // Stated here because this index is a documented API and a consumer will
    // otherwise read tier2Sec as "when tier 2 finished". It is not that.
    fieldNotes: {
      tier2Sec: 'When the parser first observed the player at tier 2, from ' +
        'selection-subgroup data. This can PRECEDE the actual tier upgrade — ' +
        'across this corpus the associated building lists contain tier-1 ' +
        'buildings, and medians run 2-3 minutes for Orc, Night Elf and Undead ' +
        'against roughly 5 minutes for Human. Treat it as a loose ordering ' +
        'signal, not a verified tech timing. Not validated against ground truth.',
      tier3Sec: 'Same caveat as tier2Sec.',
      expansionSec: 'Time of the first expansion town hall. Present for ' +
        'roughly half the corpus; absent means no expansion was detected.',
      heroTimeSec: 'First hero appearance. Consistent across races (median ' +
        'about 1:07) and the most trustworthy timing in this index.',
      durationSec: 'Replay length, not necessarily game length.'
    },
    replays: publicReplays
  };
}

function msToSec (ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return null;
  return Math.round(Number(ms) / 1000);
}

// ── robots.txt ──────────────────────────────────────────────────────────────

// Every one of these is allowed. This site is free and open source with nothing
// to sell, and its only growth channel is discovery — blocking the crawlers
// while shipping an MCP server and agent skills would be incoherent. They are
// named explicitly anyway: it records the decision, and it makes selective
// blocking later a one-line edit rather than research.
const AI_CRAWLERS = [
  ['GPTBot', 'OpenAI, model training'],
  ['OAI-SearchBot', 'OpenAI, the ChatGPT search index — blocking this one removes you from ChatGPT answers'],
  ['ChatGPT-User', 'OpenAI, answer-time fetch when a user asks'],
  ['ClaudeBot', 'Anthropic, model training'],
  ['Claude-SearchBot', 'Anthropic, search indexing'],
  ['Claude-User', 'Anthropic, answer-time fetch'],
  ['PerplexityBot', 'Perplexity, search index only, explicitly not training'],
  ['Perplexity-User', 'Perplexity, answer-time fetch'],
  ['Google-Extended', 'Gemini / Vertex grounding. Does not affect Google Search ranking either way'],
  ['Applebot-Extended', 'Apple Intelligence training. Does not crawl; governs use of what Applebot already has'],
  ['meta-externalagent', 'Meta, AI training and indexing'],
  ['Meta-WebIndexer', 'Meta AI search'],
  ['CCBot', 'Common Crawl, the open archive most training sets draw from'],
  ['Amazonbot', 'Amazon, Alexa and shopping surfaces']
];

function robotsTxt () {
  if (isPreview) {
    return '# Render PR preview (IS_PULL_REQUEST=true). Previews publish to a\n' +
      '# *.onrender.com hostname, so without this every open PR is a fully\n' +
      '# indexable duplicate of the production site.\n' +
      'User-agent: *\nDisallow: /\n';
  }

  let s = '';
  s += '# wc3v.com — free, open-source Warcraft III replay analysis.\n';
  s += '# Generated by tools/gen-seo.js. Edit that, not this file.\n';
  s += '#\n';
  s += '# Content signals (contentsignals.org, IETF aipref). Values are yes/no;\n';
  s += '# omitting a signal means neither granting nor restricting it.\n';
  s += '#   search    building a search index and returning links and excerpts.\n';
  s += '#             Does NOT cover AI-generated summaries.\n';
  s += '#   ai-input  feeding content to a model at answer time (RAG, grounding,\n';
  s += '#             generative search answers).\n';
  s += '#   ai-train  training or fine-tuning a model.\n';
  s += '#\n';
  s += '# All three are yes. Keep Cloudflare AI Crawl Control matching this —\n';
  s += '# declaring one thing here and enforcing the opposite at the edge is the\n';
  s += '# failure mode worth avoiding.\n';
  s += '\n';
  s += 'User-agent: *\n';
  s += 'Content-Signal: search=yes, ai-train=yes, ai-input=yes\n';
  s += 'Allow: /\n';
  s += 'Disallow: /dev/\n';
  s += '\n';
  for (const [ua, why] of AI_CRAWLERS) {
    s += '# ' + why + '\n';
    s += 'User-agent: ' + ua + '\n';
    s += 'Content-Signal: search=yes, ai-train=yes, ai-input=yes\n';
    s += 'Allow: /\n';
    s += 'Disallow: /dev/\n\n';
  }
  s += '# Markdown twin of every page, plus the index an agent should start from.\n';
  s += 'Sitemap: ' + ORIGIN + '/sitemap.xml\n';
  return s;
}

// ── llms.txt ────────────────────────────────────────────────────────────────

function llmsTxt (entries, buildCount, replayCount) {
  let s = '# WC3V\n\n';
  s += '> Free, open-source Warcraft III replay analysis and a curated library of\n';
  s += '> ' + buildCount + ' pro build orders backed by ' + replayCount + ' parsed tournament games.\n';
  s += '> Replay files are parsed entirely in the visitor\'s browser and never uploaded.\n\n';
  s += 'Every page below also exists as Markdown at the same URL with a .md suffix,\n';
  s += 'and is served as text/markdown to requests that ask for it via Accept.\n\n';

  const bySection = new Map();
  for (const e of entries) {
    if (!e.section) continue;
    if (!bySection.has(e.section)) bySection.set(e.section, []);
    bySection.get(e.section).push(e);
  }

  const order = ['Pages', 'Build orders', 'Data & APIs', 'Policies'];
  for (const sec of order) {
    const list = bySection.get(sec);
    if (!list || !list.length) continue;
    s += '## ' + sec + '\n\n';
    for (const e of list) {
      s += '- [' + e.title + '](' + ORIGIN + (e.md ? mdUrl(e.url) : e.url) + ')';
      if (e.description) s += ': ' + e.description;
      s += '\n';
    }
    s += '\n';
  }

  s += '## Optional\n\n';
  s += '- [Full text of every page](' + ORIGIN + '/llms-full.txt): all of the above concatenated\n';
  s += '- [Agent skills index](' + ORIGIN + '/.well-known/agent-skills/index.json): skills this site publishes\n';
  s += '- [Source](https://github.com/jblanchette/wc3v): GPLv3\n';
  return s;
}

// ── sitemap ─────────────────────────────────────────────────────────────────

function sitemapXml (entries) {
  let s = '<?xml version="1.0" encoding="UTF-8"?>\n';
  s += '<!-- Generated by tools/gen-seo.js. No <changefreq> and no <priority>:\n';
  s += '     Google ignores both. <lastmod> is real, tracked in tools/seo/lastmod.json. -->\n';
  s += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const e of entries) {
    s += '  <url>\n';
    s += '    <loc>' + ORIGIN + e.url + '</loc>\n';
    if (e.lastmod) s += '    <lastmod>' + e.lastmod + '</lastmod>\n';
    s += '  </url>\n';
  }
  s += '</urlset>\n';
  return s;
}

// ── security.txt ────────────────────────────────────────────────────────────

function securityTxt () {
  const exp = new Date(Date.now() + 364 * 864e5).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return '# RFC 9116. Regenerated on every deploy, so Expires only goes stale\n' +
    '# if the site stops being deployed for a year.\n' +
    'Contact: https://github.com/jblanchette/wc3v/security/advisories/new\n' +
    'Expires: ' + exp + '\n' +
    'Preferred-Languages: en\n' +
    'Canonical: ' + ORIGIN + '/.well-known/security.txt\n';
}

// ── agent skills ────────────────────────────────────────────────────────────

function agentSkillsIndex () {
  const dir = path.join(CLIENT, 'skills');
  const skills = [];
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name, 'SKILL.md');
      if (!fs.existsSync(p)) continue;
      const bytes = fs.readFileSync(p);
      const fm = /^---\n([\s\S]*?)\n---/.exec(bytes.toString('utf8'));
      let description = '';
      if (fm) {
        const d = /^description:\s*(.+)$/m.exec(fm[1]);
        if (d) description = d[1].trim().replace(/^["']|["']$/g, '');
      }
      if (!description) problems.push('skills/' + name + '/SKILL.md: no description in front matter');
      skills.push({
        name,
        type: 'skill-md',
        description,
        // The digest MUST match the bytes actually served. Clients are required
        // to reject a mismatch, so a stale digest is worse than no index at all
        // — which is exactly why this is generated and never hand-written.
        url: ORIGIN + '/skills/' + name + '/SKILL.md',
        digest: 'sha256:' + sha256(bytes)
      });
    }
  }
  return {
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills
  };
}

// ── api-catalog (RFC 9727) ──────────────────────────────────────────────────

// RFC 9727 §4.1: "The API catalog MUST include hyperlinks to API endpoints."
// There is no valid empty catalog, which is why this only ships now that
// /api and /api/openapi.json actually exist. A catalog pointing at a 404 is
// the failure mode the RFC's security section is about.
//
// Served with Content-Type: application/linkset+json — the file has no
// extension, and Render defaults those to binary/octet-stream, so render.yaml
// carries an explicit header rule for this exact path.
function apiCatalog () {
  const paths = ['api/index.html', 'api/openapi.json'];
  for (const p of paths) {
    if (!fs.existsSync(path.join(CLIENT, p))) {
      problems.push('api-catalog references client/' + p + ' but it does not exist');
    }
  }

  // Every documented path must resolve to a real file. This is what stops the
  // contract rotting: publishing an api-catalog turns these into promises, and
  // a promise that 404s is worse than never having advertised it.
  const specPath = path.join(CLIENT, 'api', 'openapi.json');
  if (fs.existsSync(specPath)) {
    let spec;
    try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); } catch (e) {
      problems.push('api/openapi.json: invalid JSON — ' + e.message);
    }
    if (spec && spec.paths) {
      // A templated path is checked against a real id drawn from the index we
      // just generated, so the check exercises an actual document.
      const sample = (writes.find(w => w.rel === 'data/summaries-index.json') || {}).content;
      let sampleId = null;
      try { sampleId = JSON.parse(sample).replays[0].replayId; } catch (e) { /* index may be absent */ }

      for (const p of Object.keys(spec.paths)) {
        const concrete = p.replace('{replayId}', sampleId || '');
        if (concrete.includes('{')) continue;          // untestable template
        if (!fs.existsSync(path.join(CLIENT, concrete))) {
          problems.push('openapi.json documents ' + p + ' but client' + concrete + ' does not exist');
        }
      }
    }
  }
  const doc = {
    linkset: [
      {
        anchor: ORIGIN + '/api',
        'service-desc': [
          { href: ORIGIN + '/api/openapi.json', type: 'application/openapi+json' }
        ],
        'service-doc': [
          { href: ORIGIN + '/api', type: 'text/html' },
          { href: ORIGIN + '/api.md', type: 'text/markdown' }
        ],
        'service-meta': [
          { href: ORIGIN + '/terms', type: 'text/html' }
        ],
        item: [
          { href: ORIGIN + '/data/summaries-index.json', type: 'application/json' },
          { href: ORIGIN + '/data/summaries/{replayId}.json', type: 'application/json' }
        ],
        license: [
          { href: 'https://github.com/jblanchette/wc3v/blob/master/LICENSE.md' }
        ]
      }
    ]
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

// ── main ────────────────────────────────────────────────────────────────────

function main () {
  const manifestPath = path.join(CLIENT, 'data', 'builds-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('gen-seo: missing ' + path.relative(ROOT, manifestPath));
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const builds = manifest.builds;

  // Guard the data this whole phase renders from. The manifest carried 57
  // double-encoded characters until Aug 2026; they would now be baked into 16
  // indexable pages, the markdown twins and llms.txt.
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const moji = (raw.match(/â€./g) || []).length;
  if (moji) problems.push('builds-manifest.json: ' + moji + ' double-encoded character sequence(s) (mojibake)');

  const ledger = loadLedger();
  const nextLedger = {};

  // 1. Build pages ──────────────────────────────────────────────────────────
  for (const b of builds) {
    emit('builds/' + b.id + '.html', BP.buildHtml(b));
  }
  emit('builds/index.html', BP.indexHtml(builds));

  // A raw four-letter itemId rendered into a published page is a visible data
  // bug, so treat it as one. This catches both a manifest typo and a gap in
  // mappings.js, which is the source of truth for these names.
  const unresolved = BP.unresolvedIds();
  if (unresolved.length) {
    problems.push('unresolved itemId(s) rendered as raw ids: ' + unresolved.join(', ') +
      ' — fix the manifest, or add them to allItemIds in helpers/mappings.js');
  }

  // 2. Summaries index ──────────────────────────────────────────────────────
  const sIndex = buildSummariesIndex(manifest);
  if (sIndex) emit('data/summaries-index.json', JSON.stringify(sIndex, null, 2) + '\n');
  const replayCount = sIndex ? sIndex.count : 0;

  // 3. Page metadata + lastmod, for the sitemap, llms.txt and the twins ─────
  const entries = [];
  for (const p of PAGES) {
    const abs = path.join(CLIENT, p.file);
    if (!fs.existsSync(abs)) {
      if (p.file !== 'api.html') problems.push(p.file + ': listed in the registry but not on disk');
      continue;
    }
    const html = readClient(p.file);
    const meta = metaOf(html, p.file, p.sitemap);
    const hash = contentHash(html);

    let date;
    if (stamp) {
      date = gitDate(p.file) || today();
    } else if (ledger[p.file] && ledger[p.file].hash === hash) {
      date = ledger[p.file].date;
    } else {
      date = today();
      if (ledger[p.file]) notes.push(p.file + ': content changed, lastmod stamped ' + date);
    }
    nextLedger[p.file] = { hash, date };

    entries.push(Object.assign({}, p, { title: meta.title, description: meta.description, lastmod: date, html }));
  }

  // Generated build pages join the sitemap and llms.txt with the manifest's date.
  const buildsDate = stamp
    ? (gitDate('data/builds-manifest.json') || today())
    : (ledger['data/builds-manifest.json'] &&
       ledger['data/builds-manifest.json'].hash === contentHash(raw)
        ? ledger['data/builds-manifest.json'].date
        : today());
  nextLedger['data/builds-manifest.json'] = { hash: contentHash(raw), date: buildsDate };

  entries.push({
    file: 'builds/index.html', url: '/builds', section: 'Build orders', sitemap: true, md: 'generated',
    title: 'Warcraft III build orders', lastmod: buildsDate,
    description: builds.length + ' curated builds by race and matchup, each backed by a tournament replay'
  });
  for (const b of builds) {
    entries.push({
      file: 'builds/' + b.id + '.html', url: '/builds/' + b.id, section: 'Build orders',
      sitemap: true, md: 'generated',
      title: b.name, lastmod: buildsDate,
      description: BP.raceOf(b) + ', ' + BP.matchupText(b) + '. ' + BP.buildDescription(b)
    });
  }

  // 4. Markdown twins ───────────────────────────────────────────────────────
  let converted = 0, generated = 0, copied = 0;
  for (const e of entries) {
    if (!e.md) continue;
    // Derive the twin's path from the page's URL, not its filename. Those
    // differ for directory-index pages: builds/index.html serves at /builds,
    // so its twin belongs at /builds.md. Deriving from the filename put it at
    // /builds/index.md while llms.txt advertised /builds.md, which 404'd.
    const mdRel = mdUrl(e.url).slice(1);

    if (e.md === 'generated') {
      if (e.file === 'builds/index.html') {
        emit(mdRel, BP.indexMarkdown(builds, e.lastmod));
      } else if (e.file.startsWith('builds/')) {
        const b = builds.find(x => 'builds/' + x.id + '.html' === e.file);
        if (b) emit(mdRel, BP.buildMarkdown(b, e.lastmod));
      } else {
        emit(mdRel, generatedTwin(e, builds, replayCount));
      }
      generated++;
      continue;
    }

    if (String(e.md).startsWith('copy:')) {
      const src = path.join(COPY_DIR, String(e.md).slice(5));
      if (!fs.existsSync(src)) { problems.push(e.file + ': md copy source missing (' + src + ')'); continue; }
      emit(mdRel, BP.frontMatter(e) + fs.readFileSync(src, 'utf8'));
      copied++;
      continue;
    }

    // convert
    try {
      const r = htmlToMarkdown(e.html, { origin: ORIGIN, file: e.file });
      for (const w of r.warnings) notes.push(w);
      emit(mdRel, BP.frontMatter({
        title: e.title, url: ORIGIN + e.url, description: e.description, updated: e.lastmod
      }) + r.markdown);
      converted++;
    } catch (err) {
      problems.push(err.message);
    }
  }

  // 5. sitemap / robots / llms ──────────────────────────────────────────────
  const sitemapEntries = entries.filter(e => e.sitemap);
  emit('sitemap.xml', isPreview ? '' : sitemapXml(sitemapEntries));
  emit('robots.txt', robotsTxt());

  const llmsEntries = entries.filter(e => e.section);
  emit('llms.txt', llmsTxt(llmsEntries, builds.length, replayCount));

  const fullParts = [];
  for (const e of entries) {
    if (!e.md) continue;
    const w = writes.find(x => x.rel === e.file.replace(/\.html$/, '.md'));
    if (w) fullParts.push(w.content.trim());
  }
  emit('llms-full.txt',
    '# WC3V — full text\n\n> Every page of wc3v.com concatenated. ' +
    'Generated by tools/gen-seo.js.\n\n' + fullParts.join('\n\n---\n\n') + '\n');

  // 6. Publish the replay-format docs the agent skill points at ────────────
  // They live in docs/ at the repo root, which Render does not serve. Copying
  // rather than moving keeps the repo-root location working for contributors.
  for (const f of ['REPLAY_FORMAT_RFC.md', 'wc3v-schema.json', 'wc3v-example.md']) {
    const src = path.join(ROOT, 'docs', f);
    if (!fs.existsSync(src)) { problems.push('docs/' + f + ': referenced by a skill but missing'); continue; }
    emit('docs/' + f, fs.readFileSync(src, 'utf8'));
  }

  // 7. well-known ───────────────────────────────────────────────────────────
  emit('.well-known/security.txt', securityTxt());
  emit('.well-known/agent-skills/index.json', JSON.stringify(agentSkillsIndex(), null, 2) + '\n');
  emit('.well-known/api-catalog', apiCatalog());

  // Every same-origin URL we advertise must resolve to a file we are about to
  // write or that already exists. This is not paranoia: deriving twin paths
  // from filenames instead of URLs silently published a /builds.md link in
  // llms.txt pointing at a file that lived at /builds/index.md, and nothing
  // caught it until a live 404.
  checkAdvertisedLinks();

  // ── write / check ────────────────────────────────────────────────────────
  let changed = 0;
  for (const w of writes) {
    const abs = path.join(CLIENT, w.rel);
    let prev = null;
    try { prev = fs.readFileSync(abs, 'utf8'); } catch (e) { /* new file */ }
    // security.txt has a rolling Expires and llms/summaries carry generatedAt,
    // so they always differ. Compare with those normalised out.
    if (prev !== null && normalizeVolatile(prev) === normalizeVolatile(w.content)) continue;
    changed++;
    if (!dryRun) {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, w.content);
    }
  }

  if (!dryRun) fs.writeFileSync(LEDGER, JSON.stringify(sortKeys(nextLedger), null, 2) + '\n');

  // ── report ───────────────────────────────────────────────────────────────
  const llmsFull = writes.find(w => w.rel === 'llms-full.txt');
  console.log('gen-seo: ' + writes.length + ' file(s), ' + changed + ' changed' +
    (dryRun ? ' (dry run — nothing written)' : '') + (isPreview ? ' [PR PREVIEW: noindex]' : ''));
  console.log('  ' + builds.length + ' build pages + index, ' + replayCount + ' replays indexed');
  console.log('  markdown twins: ' + generated + ' generated, ' + converted + ' converted, ' + copied + ' copied');
  console.log('  sitemap: ' + sitemapEntries.length + ' URLs, all with lastmod');
  if (llmsFull) console.log('  llms-full.txt: ' + (Buffer.byteLength(llmsFull.content) / 1024).toFixed(1) + ' KB');

  for (const n of notes) console.log('  note: ' + n);
  for (const p of problems) console.log('  PROBLEM: ' + p);

  if (problems.length) {
    console.error('\ngen-seo: ' + problems.length + ' problem(s) — see above.');
    process.exit(1);
  }
  if (check && changed) {
    console.error('\ngen-seo --check: ' + changed + ' file(s) are out of date. Run `node tools/gen-seo.js`.');
    process.exit(1);
  }
}

// Only genuinely unstable fields are masked when deciding whether a file needs
// rewriting. Dates are NOT masked: the ledger already pins lastmod to a content
// hash, so a date only moves when the page actually changed, and masking it
// would mean --stamp updated the ledger while leaving the sitemap stale.
//   ?v=<hash>     added later by gen-asset-manifest, which runs after this
//   generatedAt   a wall-clock timestamp
//   Expires       security.txt's rolling one-year expiry (and it is gitignored)
/**
 * Resolve every wc3v.com URL mentioned in the files we are emitting against
 * what will actually be on disk. Templated paths ({replayId}) are skipped, as
 * are directory URLs that Render serves from an index file.
 */
function checkAdvertisedLinks () {
  const willExist = new Set(writes.map(w => '/' + w.rel));
  const seen = new Set();

  const resolves = (urlPath) => {
    const clean = urlPath.replace(/[#?].*$/, '');
    if (clean.includes('{')) return true;                     // template
    if (willExist.has(clean)) return true;
    if (fs.existsSync(path.join(CLIENT, clean.slice(1)))) return true;
    // A URL with no extension may be served from <path>.html or <path>/index.html.
    if (!/\.[a-z0-9]+$/i.test(clean)) {
      if (willExist.has(clean + '.html')) return true;
      if (fs.existsSync(path.join(CLIENT, clean.slice(1) + '.html'))) return true;
      if (willExist.has(clean + '/index.html')) return true;
      if (fs.existsSync(path.join(CLIENT, clean.slice(1), 'index.html'))) return true;
    }
    return false;
  };

  for (const w of writes) {
    if (!/\.(txt|xml|json|md)$/.test(w.rel) && w.rel !== '.well-known/api-catalog') continue;
    for (const m of String(w.content).matchAll(/https:\/\/wc3v\.com(\/[^\s"'()<>,\]]*)/g)) {
      // These URLs appear in prose as well as in link syntax, so a trailing
      // sentence-ending character is part of the sentence, not the path.
      const urlPath = m[1].replace(/[.;:!?]+$/, '');
      if (!urlPath || urlPath === '/') continue;
      const key = w.rel + ' ' + urlPath;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!resolves(urlPath)) problems.push(w.rel + ': advertises ' + urlPath + ' which does not resolve');
    }
  }
}

function normalizeVolatile (s) {
  return s
    .replace(/\?v=[\w.]+/g, '')
    .replace(/"generatedAt":\s*"[^"]*"/g, '"generatedAt":""')
    .replace(/^Expires:.*$/m, 'Expires:')
    .replace(/\r\n/g, '\n');
}

function sortKeys (o) {
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

/** Twins for pages whose real content is rendered from JSON at runtime. */
function generatedTwin (e, builds, replayCount) {
  const introFile = path.join(COPY_DIR, path.basename(e.file, '.html') + '.intro.md');
  const intro = fs.existsSync(introFile) ? fs.readFileSync(introFile, 'utf8').trim() : '';
  if (!intro) problems.push(e.file + ': generated twin needs seo/copy/' + path.basename(e.file, '.html') + '.intro.md');

  let s = BP.frontMatter({
    title: e.title, url: ORIGIN + e.url, description: e.description, updated: e.lastmod
  });
  s += intro + '\n\n';

  if (e.file === 'index.html') {
    s += '## The build library\n\n';
    s += builds.length + ' curated builds, every one taken from a tournament game you can watch.\n';
    s += 'Full detail for each is at the linked page.\n\n';
    for (const b of builds) {
      s += '### ' + b.name + '\n\n';
      s += BP.raceOf(b) + ' · ' + BP.matchupText(b) + ' · ' +
        (BP.LEVEL_LABEL[b.level] || b.level) + ' · ' + b.replays.length +
        ' pro replay' + (b.replays.length === 1 ? '' : 's') + '\n\n';
      s += b.description + '\n\n';
      if (b.strategyPoints && b.strategyPoints.length) {
        for (const p of b.strategyPoints.slice(0, 4)) s += '- ' + p + '\n';
        s += '\n';
      }
      s += 'Full build: ' + ORIGIN + '/builds/' + b.id + '\n\n';
    }
    s += '## The replay corpus\n\n';
    s += replayCount + ' parsed pro games are indexed at ' + ORIGIN + '/data/summaries-index.json.\n';
  }

  return s;
}

main();
