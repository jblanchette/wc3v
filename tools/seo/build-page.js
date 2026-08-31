/**
 * seo/build-page.js — render each curated build as a real HTML document, and
 * as the Markdown twin of that document.
 *
 * Why: builds-manifest.json holds 16 builds with descriptions, strategy points,
 * beginner notes, common mistakes, tier progressions and 121 linked pro
 * replays, and until now none of it existed in any HTML. index.html fetches the
 * manifest and renders the grid client-side, so a crawler that does not run JS
 * saw a hero, three pillars and a footer. Most AI crawlers do not run JS.
 *
 * HTML and Markdown come from the same functions here, so the two can never
 * describe a build differently.
 *
 * Node built-ins only. Nothing here hardcodes a unit or upgrade name.
 *
 * Names come from seo/item-names.json, NOT from helpers/mappings.js directly.
 * mappings.js is still the source of truth (per CLAUDE.md) — tools/gen-item-names.js
 * reads it on a dev machine and freezes the result. It cannot be required here:
 * mappings.js line 2 requires ./UnitBalance.json, which is gitignored SLK data,
 * so on Render's clean clone the require throws MODULE_NOT_FOUND and the entire
 * build fails. It did exactly that on 2026-08-11.
 */

'use strict';

const ITEM_NAMES = require('./item-names.json').names;
// Standalone by rule (see the header note above) — BuildClass.js requires
// nothing, which is what makes it safe to pull in here.
const BuildClass = require('../../client/js/BuildClass.js');

const ORIGIN = 'https://wc3v.com';

const RACE_NAME = { H: 'Human', O: 'Orc', E: 'Night Elf', U: 'Undead' };
const RACE_VAR = { H: '--race-H', O: '--race-O', E: '--race-E', U: '--race-U' };
// The page's "Level" row names the build's CLASS, not its band — a pro build
// off the current meta should say so rather than reading as current.
const levelLabel = (b) => BuildClass.labelOf(b);

// ── small helpers ───────────────────────────────────────────────────────────

function esc (s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// itemIds that could not be resolved to a name during this run. gen-seo turns
// a non-empty set into a build failure, so a raw four-letter id can never reach
// a published page. (It nearly did: mappings.js had 'edo' and 'otr' where the
// real ids are 'edob' and 'otrb', and the manifest had 'ehnt' for the Huntress
// where the real id is 'esen'.)
const unresolved = new Set();

/**
 * itemId -> human name, from the frozen lookup. The case-insensitive retry is
 * kept because hero ids are capitalised in mappings ('Udea') and lowercased in
 * the manifest's heroSkills keys ('udea'), and the lookup is keyed by whichever
 * form the manifest used.
 */
function nameOf (itemId) {
  if (!itemId) return '';
  if (ITEM_NAMES[itemId]) return ITEM_NAMES[itemId];

  const cased = itemId[0].toUpperCase() + itemId.slice(1).toLowerCase();
  if (ITEM_NAMES[cased]) return ITEM_NAMES[cased];
  const lower = itemId.toLowerCase();
  if (ITEM_NAMES[lower]) return ITEM_NAMES[lower];

  unresolved.add(itemId);
  return itemId;
}

function unresolvedIds () { return [...unresolved]; }

function nameList (ids) {
  return (ids || []).map(nameOf).filter(Boolean);
}

/** "UvO, UvH" -> a readable matchup phrase. */
function matchupText (b) {
  return (b.matchups || []).join(', ');
}

function raceOf (b) { return RACE_NAME[b.race] || b.race; }

function buildTitle (b) {
  return b.name + ' — ' + raceOf(b) + ' build order (' + matchupText(b) + ')';
}

function buildDescription (b) {
  const d = String(b.description || '').trim();
  // Meta descriptions get truncated around 160 chars; cut on a word boundary
  // rather than mid-word, and only if we actually need to.
  if (d.length <= 158) return d;
  return d.slice(0, 155).replace(/\s+\S*$/, '') + '…';
}

// ── HTML ────────────────────────────────────────────────────────────────────

function sectionList (heading, items) {
  if (!items || !items.length) return '';
  return '\n      <section class="bp-section">\n' +
    '        <h2>' + esc(heading) + '</h2>\n' +
    '        <ul>\n' +
    items.map(t => '          <li>' + esc(t) + '</li>').join('\n') +
    '\n        </ul>\n      </section>\n';
}

function tiersHtml (b) {
  const tp = b.tierProgression;
  if (!tp) return '';
  const cards = ['t1', 't2', 't3'].filter(k => tp[k]).map(k => {
    const t = tp[k];
    const rows = [];
    const buildings = nameList(t.buildings);
    const units = nameList(t.units);
    if (buildings.length) rows.push(['Buildings', buildings.join(', ')]);
    if (units.length) rows.push(['Units', units.join(', ')]);
    if (t.goal) rows.push(['Goal', t.goal]);
    if (t.notes) rows.push(['Notes', t.notes]);
    return '          <div class="bp-tier" data-tier="' + k + '">\n' +
      '            <p class="bp-tier-name">Tier ' + k.slice(1) + '</p>\n' +
      '            <dl>\n' +
      rows.map(([dt, dd]) =>
        '              <dt>' + esc(dt) + '</dt>\n' +
        '              <dd>' + esc(dd) + '</dd>').join('\n') +
      '\n            </dl>\n          </div>';
  });
  if (!cards.length) return '';
  return '\n      <section class="bp-section">\n' +
    '        <h2>Tier progression</h2>\n' +
    '        <div class="bp-tiers">\n' + cards.join('\n') + '\n        </div>\n' +
    '      </section>\n';
}

function heroSkillsHtml (b) {
  const hs = b.heroSkills;
  if (!hs || !Object.keys(hs).length) return '';
  const blocks = Object.entries(hs).map(([heroId, skills]) => {
    const entries = Object.entries(skills)
      .filter(([, lvl]) => lvl > 0)
      .sort((a, b2) => b2[1] - a[1]);
    if (!entries.length) return '';
    return '        <h3>' + esc(nameOf(heroId)) + '</h3>\n' +
      '        <ul>\n' +
      entries.map(([id, lvl]) =>
        '          <li>' + esc(nameOf(id)) + ' — level ' + lvl + '</li>').join('\n') +
      '\n        </ul>';
  }).filter(Boolean);
  if (!blocks.length) return '';
  return '\n      <section class="bp-section">\n' +
    '        <h2>Hero skill order</h2>\n' + blocks.join('\n') + '\n      </section>\n';
}

function mistakesHtml (b) {
  const m = b.commonMistakes;
  if (!m || !m.length) return '';
  return '\n      <section class="bp-section">\n' +
    '        <h2>Common mistakes</h2>\n' +
    '        <dl class="bp-mistakes">\n' +
    m.map(x => {
      const mistake = typeof x === 'string' ? x : x.mistake;
      const fix = typeof x === 'string' ? '' : x.fix;
      return '          <dt>' + esc(mistake) + '</dt>\n' +
        (fix ? '          <dd>' + esc(fix) + '</dd>' : '');
    }).join('\n') +
    '\n        </dl>\n      </section>\n';
}

function replaysHtml (b) {
  const r = b.replays || [];
  if (!r.length) return '';
  const rows = r.map(x => {
    const href = '/viewer?r=' + encodeURIComponent(x.replayId) +
      '&player=' + encodeURIComponent(x.playerSlot) +
      '&buildId=' + encodeURIComponent(b.id);
    const stage = [x.stage, x.round].filter(Boolean).join(' ');
    return '            <tr>\n' +
      '              <td><a href="' + esc(href) + '">' + esc(x.playerName || 'Unknown') + '</a></td>\n' +
      '              <td>' + esc(x.opponentName || '') + '</td>\n' +
      '              <td>' + esc(x.map || '') + '</td>\n' +
      '              <td>' + esc(stage) + '</td>\n' +
      '            </tr>';
  });
  return '\n      <section class="bp-section">\n' +
    '        <h2>Pro replays running this build</h2>\n' +
    '        <p>' + r.length + ' tournament ' + (r.length === 1 ? 'game' : 'games') +
    '. Each opens in the 3D simulator on this player\'s side.</p>\n' +
    '        <div class="bp-replays-wrap">\n' +
    '          <table class="bp-replays">\n' +
    '            <thead><tr><th>Player</th><th>Opponent</th><th>Map</th><th>Stage</th></tr></thead>\n' +
    '            <tbody>\n' + rows.join('\n') + '\n            </tbody>\n' +
    '          </table>\n        </div>\n      </section>\n';
}

function jsonLd (b) {
  const node = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': ORIGIN + '/builds/' + b.id + '#article',
        headline: buildTitle(b),
        url: ORIGIN + '/builds/' + b.id,
        description: buildDescription(b),
        articleSection: raceOf(b) + ' build orders',
        about: { '@id': ORIGIN + '/#webapp' },
        isPartOf: { '@id': ORIGIN + '/#website' },
        publisher: { '@id': ORIGIN + '/#org' },
        inLanguage: 'en-US',
        keywords: ['Warcraft III', raceOf(b), b.name]
          .concat(b.matchups || []).concat(b.tags || []).join(', ')
      },
      {
        '@type': 'BreadcrumbList',
        '@id': ORIGIN + '/builds/' + b.id + '#breadcrumb',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' },
          { '@type': 'ListItem', position: 2, name: 'Build orders', item: ORIGIN + '/builds' },
          { '@type': 'ListItem', position: 3, name: b.name }
        ]
      }
    ]
  };
  return JSON.stringify(node, null, 2);
}

const NAV = `  <nav id="site-nav" role="navigation" aria-label="Main navigation">
    <div class="site-nav-inner">
      <a class="site-nav-logo" href="/" aria-label="WC3V home">
        <span class="site-wordmark" aria-hidden="true">WC<span>3</span>V</span>
      </a>
      <div class="site-nav-spacer"></div>
      <div class="site-nav-links">
        <a class="site-nav-link" href="/">Home</a>
        <a class="site-nav-link" href="/about">About</a>
        <a class="site-nav-link" href="/community">Community</a>
        <a class="site-nav-link" href="/download">Download</a>
      </div>
    </div>
  </nav>`;

const FOOTER = `  <footer class="site-footer">
    <div class="site-footer-inner">
      <div class="site-footer-about">
        <div class="site-footer-brand">WC3V</div>
        <p>Free, open-source replay analysis for Warcraft III.</p>
      </div>
      <div class="site-footer-links">
        <a href="/about">About</a>
        <a href="/download">Download</a>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="https://github.com/jblanchette/wc3v">GitHub</a>
        <a href="https://github.com/jblanchette/wc3v/blob/master/LICENSE.md">GPLv3 License</a>
      </div>
    </div>
    <div class="site-footer-legal">
      Warcraft III and all related assets are trademarks of Blizzard Entertainment, Inc. This is a fan-made, non-commercial tool not affiliated with or endorsed by Blizzard.
    </div>
  </footer>`;

function shell (opts) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- GENERATED by tools/seo/build-page.js from client/data/builds-manifest.json.
       Do not hand-edit: the next deploy overwrites it. Change the manifest. -->

  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}">

  <link rel="canonical" href="${opts.url}">
  <meta name="robots" content="index, follow">

  <meta property="og:type" content="article">
  <meta property="og:site_name" content="WC3V">
  <meta property="og:title" content="${esc(opts.ogTitle || opts.title)}">
  <meta property="og:description" content="${esc(opts.description)}">
  <meta property="og:url" content="${opts.url}">
  <meta property="og:image" content="${ORIGIN}/assets/og-preview.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="The WC3V build library, showing pro Warcraft III build orders by race and matchup.">
  <meta property="og:locale" content="en_US">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(opts.ogTitle || opts.title)}">
  <meta name="twitter:description" content="${esc(opts.description)}">
  <meta name="twitter:image" content="${ORIGIN}/assets/og-preview.png">

  <link rel="alternate" type="text/markdown" href="${opts.url}.md">

  <script type="application/ld+json">
${opts.jsonLd}
  </script>

  <link rel="preconnect" href="https://cdn.wc3v.com" crossorigin>
  <link rel="stylesheet" href="/css/tokens.css">
  <link rel="stylesheet" href="/css/main.css">
  <link rel="stylesheet" href="/css/builds.css">
  <style>body { margin: 0; }</style>
</head>
<body class="site-page"${opts.bodyAttr || ''}>
${NAV}

  <script src="/js/clientConfig.js"></script>
  <script src="/js/BandSwitcher.js"></script>
  <script src="/js/SiteNav.js"></script>
  <script src="/js/SiteStats.js"></script>
  <script>document.addEventListener('DOMContentLoaded', () => { SiteNav.render(null); });</script>

  <main class="site-content">
    <article class="bp-page">
${opts.body}
    </article>
  </main>

${FOOTER}
</body>
</html>
`;
}

/** Full HTML document for one build. */
function buildHtml (b) {
  const url = ORIGIN + '/builds/' + b.id;
  const raceVar = RACE_VAR[b.race];
  const facts = [
    ['Race', raceOf(b), true],
    ['Matchups', matchupText(b), false],
    ['Level', levelLabel(b), false],
    ['Difficulty', b.difficulty || '', false],
    ['Hero opener', b.heroOpener || '', false]
  ].filter(([, v]) => v);

  const body =
`      <p class="bp-crumbs">
        <a href="/">Home</a><span>/</span><a href="/builds">Build orders</a><span>/</span>${esc(b.name)}
      </p>

      <h1 class="bp-title">${esc(b.name)}</h1>
      <p class="bp-lede">${esc(b.description || '')}</p>

      <ul class="bp-facts">
${facts.map(([k, v, isRace]) =>
    '        <li class="bp-fact' + (isRace ? ' bp-fact--race' : '') + '"><b>' +
    esc(k) + '</b>' + esc(v) + '</li>').join('\n')}
      </ul>
${sectionList('How it plays', b.strategyPoints)}${tiersHtml(b)}${heroSkillsHtml(b)}${
  b.coreUpgrades && b.coreUpgrades.length
    ? sectionList('Core upgrades', nameList(b.coreUpgrades))
    : ''}${sectionList('If you are new to this build', b.beginnerNotes)}${mistakesHtml(b)}${
  sectionList('Before you try it', b.prerequisites)}${replaysHtml(b)}
      <div class="bp-cta">
        <p>Drop your own replay to see where yours came apart against this build.</p>
        <a href="/">Open the analyzer</a>
      </div>`;

  return shell({
    title: buildTitle(b) + ' | WC3V',
    ogTitle: buildTitle(b),
    description: buildDescription(b),
    url,
    jsonLd: jsonLd(b),
    bodyAttr: raceVar ? ` style="--bp-race: var(${raceVar}); --bp-race-edge: var(${raceVar})"` : '',
    body
  });
}

/** The /builds index, grouped by race. */
function indexHtml (builds) {
  const order = ['H', 'O', 'E', 'U'];
  const groups = order
    .map(r => [r, builds.filter(b => b.race === r)])
    .filter(([, list]) => list.length);

  const body =
`      <p class="bp-crumbs">
        <a href="/">Home</a><span>/</span>Build orders
      </p>

      <h1 class="bp-title">Warcraft III build orders</h1>
      <p class="bp-lede">${builds.length} curated builds, every one taken from a tournament game you can watch. Pick a race.</p>

${groups.map(([r, list]) =>
`      <section class="bp-race-group">
        <h2 class="bp-race-heading">${esc(RACE_NAME[r])}</h2>
        <div class="bp-grid">
${list.map(b =>
`          <a class="bp-card" href="/builds/${esc(b.id)}">
            <p class="bp-card-name">${esc(b.name)}</p>
            <p class="bp-card-meta">${esc(matchupText(b))} &middot; ${esc(levelLabel(b))} &middot; ${b.replays.length} replay${b.replays.length === 1 ? '' : 's'}</p>
            <p class="bp-card-desc">${esc(buildDescription(b))}</p>
          </a>`).join('\n')}
        </div>
      </section>`).join('\n\n')}

      <div class="bp-cta">
        <p>Drop a .w3g replay and it is parsed in your browser, never uploaded.</p>
        <a href="/">Open the analyzer</a>
      </div>`;

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': ORIGIN + '/builds#page',
        url: ORIGIN + '/builds',
        name: 'Warcraft III build orders',
        description: builds.length + ' curated Warcraft III build orders by race and matchup, each backed by pro tournament replays.',
        isPartOf: { '@id': ORIGIN + '/#website' },
        publisher: { '@id': ORIGIN + '/#org' },
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: builds.length,
          itemListElement: builds.map((b, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: b.name,
            url: ORIGIN + '/builds/' + b.id
          }))
        }
      },
      {
        '@type': 'BreadcrumbList',
        '@id': ORIGIN + '/builds#breadcrumb',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' },
          { '@type': 'ListItem', position: 2, name: 'Build orders' }
        ]
      }
    ]
  };

  return shell({
    title: 'Warcraft III Build Orders by Race and Matchup | WC3V',
    ogTitle: 'Warcraft III build orders, backed by pro replays',
    description: builds.length + ' curated Warcraft III build orders by race and matchup, each backed by a tournament replay you can watch.',
    url: ORIGIN + '/builds',
    jsonLd: JSON.stringify(ld, null, 2),
    body
  });
}

// ── Markdown ────────────────────────────────────────────────────────────────

function frontMatter (o) {
  return '---\ntitle: ' + JSON.stringify(o.title) +
    '\nurl: ' + o.url +
    '\ndescription: ' + JSON.stringify(o.description) +
    (o.updated ? '\nupdated: ' + o.updated : '') +
    '\n---\n\n';
}

function mdList (heading, items) {
  if (!items || !items.length) return '';
  return '## ' + heading + '\n\n' + items.map(t => '- ' + t).join('\n') + '\n\n';
}

/** Markdown twin of one build page. Same source data as buildHtml. */
function buildMarkdown (b, updated) {
  const url = ORIGIN + '/builds/' + b.id;
  let s = frontMatter({
    title: buildTitle(b), url, description: buildDescription(b), updated
  });

  s += '# ' + b.name + '\n\n';
  s += b.description + '\n\n';
  s += '- **Race:** ' + raceOf(b) + '\n';
  s += '- **Matchups:** ' + matchupText(b) + '\n';
  if (b.level) s += '- **Level:** ' + levelLabel(b) + '\n';
  if (b.difficulty) s += '- **Difficulty:** ' + b.difficulty + '\n';
  if (b.heroOpener) s += '- **Hero opener:** ' + b.heroOpener + '\n';
  s += '\n';

  s += mdList('How it plays', b.strategyPoints);

  const tp = b.tierProgression;
  if (tp) {
    const parts = ['t1', 't2', 't3'].filter(k => tp[k]).map(k => {
      const t = tp[k];
      const bits = [];
      const buildings = nameList(t.buildings);
      const units = nameList(t.units);
      if (buildings.length) bits.push('  - Buildings: ' + buildings.join(', '));
      if (units.length) bits.push('  - Units: ' + units.join(', '));
      if (t.goal) bits.push('  - Goal: ' + t.goal);
      if (t.notes) bits.push('  - Notes: ' + t.notes);
      return '- **Tier ' + k.slice(1) + '**\n' + bits.join('\n');
    });
    if (parts.length) s += '## Tier progression\n\n' + parts.join('\n') + '\n\n';
  }

  const hs = b.heroSkills;
  if (hs && Object.keys(hs).length) {
    const blocks = Object.entries(hs).map(([heroId, skills]) => {
      const entries = Object.entries(skills).filter(([, l]) => l > 0).sort((a, c) => c[1] - a[1]);
      if (!entries.length) return '';
      return '- **' + nameOf(heroId) + '**: ' +
        entries.map(([id, l]) => nameOf(id) + ' ' + l).join(', ');
    }).filter(Boolean);
    if (blocks.length) s += '## Hero skill order\n\n' + blocks.join('\n') + '\n\n';
  }

  if (b.coreUpgrades && b.coreUpgrades.length) {
    s += mdList('Core upgrades', nameList(b.coreUpgrades));
  }
  s += mdList('If you are new to this build', b.beginnerNotes);

  if (b.commonMistakes && b.commonMistakes.length) {
    s += '## Common mistakes\n\n' + b.commonMistakes.map(x => {
      const mistake = typeof x === 'string' ? x : x.mistake;
      const fix = typeof x === 'string' ? '' : x.fix;
      return '- **' + mistake + '**' + (fix ? '\n  - Fix: ' + fix : '');
    }).join('\n') + '\n\n';
  }

  s += mdList('Before you try it', b.prerequisites);

  if (b.replays && b.replays.length) {
    s += '## Pro replays running this build\n\n';
    s += '| Player | Opponent | Map | Stage | Watch |\n|---|---|---|---|---|\n';
    for (const x of b.replays) {
      const href = ORIGIN + '/viewer?r=' + encodeURIComponent(x.replayId) +
        '&player=' + encodeURIComponent(x.playerSlot) + '&buildId=' + encodeURIComponent(b.id);
      s += '| ' + (x.playerName || 'Unknown') + ' | ' + (x.opponentName || '') + ' | ' +
        (x.map || '') + ' | ' + [x.stage, x.round].filter(Boolean).join(' ') +
        ' | [open](' + href + ') |\n';
    }
    s += '\n';
  }

  return s;
}

/** Markdown twin of the /builds index. */
function indexMarkdown (builds, updated) {
  let s = frontMatter({
    title: 'Warcraft III build orders',
    url: ORIGIN + '/builds',
    description: builds.length + ' curated Warcraft III build orders by race and matchup, each backed by a tournament replay.',
    updated
  });
  s += '# Warcraft III build orders\n\n';
  s += builds.length + ' curated builds, every one taken from a tournament game you can watch.\n\n';
  for (const r of ['H', 'O', 'E', 'U']) {
    const list = builds.filter(b => b.race === r);
    if (!list.length) continue;
    s += '## ' + RACE_NAME[r] + '\n\n';
    for (const b of list) {
      s += '- [' + b.name + '](' + ORIGIN + '/builds/' + b.id + '): ' +
        matchupText(b) + ', ' + levelLabel(b) + ', ' +
        b.replays.length + ' replay' + (b.replays.length === 1 ? '' : 's') + '. ' +
        b.description + '\n';
    }
    s += '\n';
  }
  return s;
}

module.exports = {
  buildHtml, indexHtml, buildMarkdown, indexMarkdown,
  buildTitle, buildDescription, nameOf, nameList, matchupText, raceOf,
  unresolvedIds,
  RACE_NAME, BuildClass, levelLabel, frontMatter, esc, ORIGIN
};
