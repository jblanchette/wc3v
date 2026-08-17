/**
 * MCP tools over the wc3v replay corpus.
 *
 * Transport-agnostic on purpose: each tool is a plain descriptor with a `run`
 * that takes (args, ctx) and returns a value. index.js is a thin JSON-RPC
 * adapter over these. That keeps them unit-testable in plain Node with no
 * Workers runtime, and means swapping the transport later is a small change.
 *
 * DATA COMES FROM RUNTIME FETCH against wc3v.com, edge-cached — not bundled.
 * Bundling the 2.7 MB corpus would fit inside the Worker size limit but would
 * create a second deployment coupling: every data change would need both a
 * Render deploy and a wrangler deploy, and between them the two would disagree
 * about what the corpus contains. One source of truth is worth the cache miss.
 */

const ORIGIN = 'https://wc3v.com';

const RACE_NAME = { H: 'Human', O: 'Orc', E: 'Night Elf', U: 'Undead' };
const RACES = ['H', 'O', 'E', 'U'];

/** The six build classifications, and the band each projects onto.
 *
 *  DUPLICATED ON PURPOSE. client/js/BuildClass.js is the source of truth, but
 *  this worker fetches the manifest over HTTP and has no filesystem access to
 *  the repo, so it cannot require it. tools/test-mcp-server.js asserts the two
 *  lists still agree — if you add a class there, that test is what fails here.
 */
const BUILD_CLASSES = ['pro-meta', 'pro-off-meta', 'ladder', 'ladder-off-meta', 'new-player', 'unsorted'];
const CLASS_LABEL = {
  'pro-meta': 'Pro meta', 'pro-off-meta': 'Pro off-meta',
  'ladder': 'Ladder', 'ladder-off-meta': 'Ladder off-meta',
  'new-player': 'New player', 'unsorted': 'Unsorted'
};
const CLASS_BAND = {
  'pro-meta': 'pro', 'pro-off-meta': 'pro',
  'ladder': 'improving', 'ladder-off-meta': 'improving',
  'new-player': 'new', 'unsorted': 'improving'
};
const LEGACY_LEVEL = { pro: 'pro-meta', improving: 'ladder', new: 'new-player' };
const classOf = (b) => (b && BUILD_CLASSES.includes(b.buildClass))
  ? b.buildClass
  : (LEGACY_LEVEL[b && b.level] || 'unsorted');

/** Per-isolate memo on top of the edge cache. Cheap, and bounded by the number
 *  of distinct documents (a handful, plus one per replay actually asked for). */
const memo = new Map();

async function getJson (pathname) {
  if (memo.has(pathname)) return memo.get(pathname);
  const res = await fetch(ORIGIN + pathname, {
    headers: { accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  if (!res.ok) throw new Error('upstream ' + res.status + ' for ' + pathname);
  const json = await res.json();
  memo.set(pathname, json);
  return json;
}

const load = {
  builds: () => getJson('/data/builds-manifest.json').then(j => j.builds || []),
  index: () => getJson('/data/summaries-index.json'),
  summary: (id) => getJson('/data/summaries/' + encodeURIComponent(id) + '.json'),
  glossary: () => getJson('/data/glossary.json').then(j => j.terms || []),
  tournaments: () => getJson('/data/tournaments.json').then(j => j.tournaments || [])
};

// ── formatting helpers ──────────────────────────────────────────────────────

function mmss (sec) {
  if (sec == null) return null;
  return Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0');
}

function buildLine (b) {
  return '- **' + b.name + '** (`' + b.id + '`) — ' + (RACE_NAME[b.race] || b.race) +
    ', ' + (b.matchups || []).join('/') + ', ' + (CLASS_LABEL[classOf(b)] || '?') +
    ', ' + (b.replays || []).length + ' replay' + ((b.replays || []).length === 1 ? '' : 's') +
    '\n  ' + (b.description || '').trim() +
    '\n  ' + ORIGIN + '/builds/' + b.id;
}

function haystack (b) {
  return [b.name, b.id, b.description, b.heroOpener, (b.tags || []).join(' '),
    (b.playstyleTags || []).join(' '), (b.matchups || []).join(' ')]
    .filter(Boolean).join(' ').toLowerCase();
}

// ── tools ───────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_builds',
    title: 'Search the curated build library',
    description:
      'Find Warcraft III build orders by race, matchup, classification or free ' +
      'text. Returns a summary of each match; use get_build for the full detail.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text over name, description, hero and tags.' },
        race: { type: 'string', enum: RACES, description: 'H Human, O Orc, E Night Elf, U Undead.' },
        matchup: { type: 'string', description: 'Your race then theirs, e.g. "EvU".' },
        buildClass: { type: 'string', enum: BUILD_CLASSES, description: 'How the build is classified. "pro-meta" is what top players run now; "pro-off-meta" is pro but not current.' },
        level: { type: 'string', enum: ['new', 'improving', 'pro'], description: 'Coarser skill band. Kept for older callers; buildClass is finer.' },
        hero: { type: 'string', description: 'Opening hero, e.g. "Demon Hunter".' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async run (a) {
      const all = await load.builds();
      const q = (a.query || '').toLowerCase().trim();
      const out = all.filter(b => {
        if (a.race && b.race !== a.race) return false;
        if (a.matchup && !(b.matchups || []).includes(a.matchup)) return false;
        if (a.buildClass && classOf(b) !== a.buildClass) return false;
        // A band filter matches every class that projects onto it.
        if (a.level && CLASS_BAND[classOf(b)] !== a.level) return false;
        if (a.hero && !(b.heroOpener || '').toLowerCase().includes(a.hero.toLowerCase())) return false;
        if (q && !haystack(b).includes(q)) return false;
        return true;
      }).slice(0, a.limit || 20);

      const text = out.length
        ? out.length + ' build' + (out.length === 1 ? '' : 's') + ':\n\n' + out.map(buildLine).join('\n\n')
        : 'No builds match. The library is small and curated (' + all.length +
          ' builds); try dropping the matchup or level filter.';
      return {
        text,
        structured: {
          count: out.length,
          builds: out.map(b => ({
            id: b.id, name: b.name, race: b.race, matchups: b.matchups,
            buildClass: classOf(b), level: b.level, difficulty: b.difficulty, heroOpener: b.heroOpener,
            description: b.description, replayCount: (b.replays || []).length,
            url: ORIGIN + '/builds/' + b.id
          }))
        }
      };
    }
  },

  {
    name: 'get_build',
    title: 'Get one build in full',
    description:
      'Everything about one build: strategy, tier progression, hero skills, core ' +
      'upgrades, beginner notes, common mistakes and every pro replay running it.',
    inputSchema: {
      type: 'object',
      properties: { buildId: { type: 'string' } },
      required: ['buildId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async run (a) {
      const all = await load.builds();
      const b = all.find(x => x.id === a.buildId);
      if (!b) {
        return {
          text: 'No build with id "' + a.buildId + '".\n\nValid ids:\n' +
            all.map(x => '- ' + x.id).join('\n'),
          structured: { found: false, validIds: all.map(x => x.id) }
        };
      }
      let s = '# ' + b.name + '\n\n' + (b.description || '') + '\n\n';
      s += '- Race: ' + (RACE_NAME[b.race] || b.race) + '\n';
      s += '- Matchups: ' + (b.matchups || []).join(', ') + '\n';
      if (b.level) s += '- Level: ' + b.level + '\n';
      if (b.difficulty) s += '- Difficulty: ' + b.difficulty + '\n';
      if (b.heroOpener) s += '- Hero opener: ' + b.heroOpener + '\n';
      if ((b.strategyPoints || []).length) s += '\n## How it plays\n\n' + b.strategyPoints.map(p => '- ' + p).join('\n') + '\n';
      if ((b.beginnerNotes || []).length) s += '\n## If you are new to it\n\n' + b.beginnerNotes.map(p => '- ' + p).join('\n') + '\n';
      if ((b.commonMistakes || []).length) {
        s += '\n## Common mistakes\n\n' + b.commonMistakes.map(m =>
          typeof m === 'string' ? '- ' + m : '- **' + m.mistake + '**' + (m.fix ? '\n  Fix: ' + m.fix : '')
        ).join('\n') + '\n';
      }
      if ((b.replays || []).length) {
        s += '\n## Pro replays (' + b.replays.length + ')\n\n' + b.replays.slice(0, 20).map(r =>
          '- ' + (r.playerName || '?') + ' vs ' + (r.opponentName || '?') +
          ' on ' + (r.map || '?') + ' — `' + r.replayId + '` (slot ' + r.playerSlot + ')'
        ).join('\n') + '\n';
      }
      s += '\nPage: ' + ORIGIN + '/builds/' + b.id +
           '\nMarkdown: ' + ORIGIN + '/builds/' + b.id + '.md\n';
      return { text: s, structured: Object.assign({ found: true, url: ORIGIN + '/builds/' + b.id }, b) };
    }
  },

  {
    name: 'search_replays',
    title: 'Search the parsed pro replay corpus',
    description:
      'Search parsed Warcraft III tournament games by player, map, race, matchup, ' +
      'build or duration. This corpus exists nowhere else.',
    inputSchema: {
      type: 'object',
      properties: {
        player: { type: 'string', description: 'Substring of a player handle.' },
        map: { type: 'string' },
        race: { type: 'string', enum: RACES, description: 'Any player in the game had this race.' },
        matchup: { type: 'string', description: 'Two race letters joined by v, alphabetical, e.g. "EvU".' },
        buildId: { type: 'string', description: 'Only replays attached to this curated build.' },
        tournamentId: { type: 'string' },
        minDurationSec: { type: 'integer' },
        maxDurationSec: { type: 'integer' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async run (a) {
      const idx = await load.index();
      const p = (a.player || '').toLowerCase();
      const m = (a.map || '').toLowerCase();
      const out = (idx.replays || []).filter(r => {
        if (m && !String(r.map || '').toLowerCase().includes(m)) return false;
        if (a.matchup && r.matchup !== a.matchup) return false;
        if (a.buildId && !(r.builds || []).includes(a.buildId)) return false;
        if (a.tournamentId && r.tournamentId !== a.tournamentId) return false;
        if (a.minDurationSec != null && (r.durationSec || 0) < a.minDurationSec) return false;
        if (a.maxDurationSec != null && (r.durationSec || 0) > a.maxDurationSec) return false;
        if (a.race && !(r.players || []).some(x => x.race === a.race)) return false;
        if (p && !(r.players || []).some(x => String(x.name || '').toLowerCase().includes(p))) return false;
        return true;
      }).slice(0, a.limit || 20);

      const line = r => '- `' + r.replayId + '` — ' + (r.map || '?') +
        ', ' + (mmss(r.durationSec) || '?') + (r.matchup ? ', ' + r.matchup : '') + '\n  ' +
        (r.players || []).map(x => (x.name || '?') + ' (' + (x.race || '?') +
          (x.hero ? ', ' + x.hero : '') + ')').join(' vs ');

      return {
        text: out.length
          ? out.length + ' of ' + idx.count + ' replays:\n\n' + out.map(line).join('\n') +
            '\n\nUse get_replay_summary or get_build_order_timeline for detail.'
          : 'No replays match. The corpus has ' + idx.count + ' games.',
        structured: { count: out.length, corpusSize: idx.count, replays: out }
      };
    }
  },

  {
    name: 'get_replay_summary',
    title: 'Get one parsed replay',
    description: 'The full parsed summary of one game: both players, heroes, timings and research.',
    inputSchema: {
      type: 'object',
      properties: { replayId: { type: 'string' } },
      required: ['replayId'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async run (a) {
      let j;
      try { j = await load.summary(a.replayId); } catch (e) {
        return { text: 'No replay "' + a.replayId + '". Use search_replays to find valid ids.', structured: { found: false } };
      }
      let s = '# ' + (j.map || 'Unknown map') + ' — ' + (j.durationFormatted || '?') + '\n\n';
      s += '`' + j.replayId + '`\n\n';
      for (const [slot, p] of Object.entries(j.players || {})) {
        s += '## Slot ' + slot + ': ' + (p.name || '?') + ' (' + (RACE_NAME[p.race] || p.race) + ')\n\n';
        if (p.heroOpener) s += '- First hero: ' + p.heroOpener.name + ' at ' + (p.heroOpener.gameTimeFormatted || '?') + '\n';
        if (p.expansionTimeFormatted) s += '- Expansion: ' + p.expansionTimeFormatted + '\n';
        if ((p.researched || []).length) s += '- Researched: ' + p.researched.map(r => r.name).join(', ') + '\n';
        s += '\n';
      }
      s += '> Tier timings (tier2Time/tier3Time) are inferred from selection data and can ' +
           'precede the actual upgrade. Do not quote them as tech benchmarks. See ' + ORIGIN + '/api\n';
      return { text: s, structured: j };
    }
  },

  {
    name: 'get_build_order_timeline',
    title: 'Get one player\'s opening as a flat timeline',
    description:
      'The opening build order for one player in one game, as an ordered ' +
      'mm:ss list. Easier to reason over than the nested summary.',
    inputSchema: {
      type: 'object',
      properties: {
        replayId: { type: 'string' },
        playerSlot: { type: 'string', description: 'Slot key from the summary, e.g. "1".' }
      },
      required: ['replayId', 'playerSlot'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async run (a) {
      let j;
      try { j = await load.summary(a.replayId); } catch (e) {
        return { text: 'No replay "' + a.replayId + '".', structured: { found: false } };
      }
      const p = (j.players || {})[a.playerSlot];
      if (!p) {
        return {
          text: 'No slot "' + a.playerSlot + '" in that replay. Slots: ' + Object.keys(j.players || {}).join(', '),
          structured: { found: false, slots: Object.keys(j.players || {}) }
        };
      }
      const steps = (p.buildPreview || []).map(e => ({
        time: e.gameTimeFormatted || null, type: e.type || null, name: e.name || e.itemId
      }));
      const s = '# ' + (p.name || '?') + ' (' + (RACE_NAME[p.race] || p.race) + ') — ' +
        (j.map || '?') + '\n\n' +
        (steps.length
          ? steps.map(e => (e.time || '?:??').padStart(5) + '  ' + e.name).join('\n')
          : 'No build preview recorded for this player.') +
        '\n\n> The ORDER is reliable. Treat the timings as approximate.\n';
      return { text: s, structured: { replayId: j.replayId, slot: a.playerSlot, player: p.name, race: p.race, steps } };
    }
  },

  {
    name: 'lookup_term',
    title: 'Explain Warcraft III jargon',
    description: 'Plain-language definition of a Warcraft III term (T2, creeping, expo, teching).',
    inputSchema: {
      type: 'object',
      properties: { term: { type: 'string' } },
      required: ['term'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async run (a) {
      const terms = await load.glossary();
      const q = String(a.term || '').toLowerCase().trim();
      // Match the alias array, not just the canonical name: players write "t2"
      // far more often than "Tier 2".
      const hit = terms.find(t =>
        String(t.term || '').toLowerCase() === q ||
        (t.match || []).some(m => String(m).toLowerCase() === q)) ||
        terms.find(t =>
          String(t.term || '').toLowerCase().includes(q) ||
          (t.match || []).some(m => String(m).toLowerCase().includes(q)));
      if (!hit) {
        return {
          text: 'No glossary entry for "' + a.term + '". Known terms: ' +
            terms.map(t => t.term).join(', '),
          structured: { found: false, known: terms.map(t => t.term) }
        };
      }
      return {
        text: '**' + hit.term + '** — ' + hit.def,
        structured: { found: true, term: hit.term, definition: hit.def, aliases: hit.match || [] }
      };
    }
  },

  {
    name: 'list_tournaments',
    title: 'List the tournaments in the corpus',
    description: 'The events the parsed replays come from.',
    inputSchema: {
      type: 'object',
      properties: {
        region: { type: 'string' },
        tier: { type: 'string' },
        year: { type: 'integer' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async run (a) {
      const all = await load.tournaments();
      const out = all.filter(t => {
        if (a.region && t.region !== a.region) return false;
        if (a.tier && t.tier !== a.tier) return false;
        if (a.year && !String(t.date || '').startsWith(String(a.year))) return false;
        return true;
      });
      return {
        text: out.length
          ? out.map(t => '- **' + t.name + '** (`' + t.id + '`)' +
              (t.date ? ' — ' + t.date : '') + (t.organizer ? ', ' + t.organizer : '') +
              (t.region ? ', ' + t.region : '')).join('\n')
          : 'No tournaments match.',
        structured: { count: out.length, tournaments: out }
      };
    }
  }
];

const SERVER_CARD = {
  $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
  name: 'com.wc3v/wc3v',
  title: 'WC3V',
  version: '1.0.0',
  description: 'Warcraft III pro build orders and parsed tournament replay data from wc3v.com.',
  websiteUrl: 'https://wc3v.com',
  repository: { url: 'https://github.com/jblanchette/wc3v', source: 'github' },
  icons: [{ src: 'https://wc3v.com/android-chrome-512x512.png', sizes: ['512x512'], mimeType: 'image/png' }],
  remotes: [{
    type: 'streamable-http',
    url: 'https://mcp.wc3v.com/mcp',
    supportedProtocolVersions: ['2025-06-18']
  }]
};

export { TOOLS, SERVER_CARD, ORIGIN, load, memo };
