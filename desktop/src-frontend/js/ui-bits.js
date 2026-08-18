// The small pieces every screen builds out of.
//
// These were private to games-view.js, which was fine while the game report was
// the only thing that drew a player name or a unit icon. The Library draws both,
// and a second copy of the CDN base and its id whitelist is a security control
// that can drift.
//
// Nothing here holds state or touches a view.

(function () {
  'use strict';

  const RACE = { O: 'Orc', H: 'Human', U: 'Undead', E: 'Night Elf', R: 'Random', N: 'Neutral' };
  const RACE_SHORT = { O: 'OC', H: 'HU', U: 'UD', E: 'NE', R: 'RD', N: 'NT' };

  // Every string that reaches these can come from a replay a stranger made.
  // Build DOM with textContent; the only innerHTML in this app is its own SVG
  // constants, in glyphs.js and race-icons.js.
  const node = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  };

  const fmtDur = (ms) => {
    const total = Math.round((ms || 0) / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  const fmtMs = (ms) => {
    if (ms === null || ms === undefined) return null;
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  // Raw map names are ladder filenames like
  // "12_w3c_251104_0950_TurtleRock_v2.0.w3x", long enough to wrap a feed row
  // onto three lines. SummaryExtract owns the display form.
  const mapName = (summary) =>
    window.SummaryExtract.cleanMapName(summary.mapRaw || summary.map) || 'Unknown map';

  // The site's own unit and building icons, so a build order reads the same in
  // both products. They come from the CDN rather than the installer, because the
  // full set is 7.5 MB of jpgs that LZMA cannot compress, and shipping a subset
  // means guessing which ids a stranger's replay will contain.
  //
  // The id is whitelisted the same way client/js/BuildOrderRenderer.js does it.
  // It came out of a replay a stranger made and it is going into a URL. Anything
  // else renders as no icon. ONE copy of this, on purpose.
  const ICON_BASE = 'https://cdn.wc3v.com/assets/wc3icons/';
  // Map art, from the same CDN and under the same CSP allowance. The installer
  // stages only the three .gz files a PARSE needs; map.jpg is display art and is
  // pulled on demand, exactly like the unit portraits above.
  const MAP_BASE = 'https://cdn.wc3v.com/maps/';
  const SAFE_ICON_ID = /^[A-Za-z0-9_-]+$/;

  const buildIcon = (itemId) => {
    const id = String(itemId || '');
    if (!SAFE_ICON_ID.test(id)) return node('span', 'build-icon is-blank');
    const img = document.createElement('img');
    img.className = 'build-icon';
    img.loading = 'lazy';
    img.alt = '';
    img.src = ICON_BASE + id + '.jpg';
    // Offline, or an id the site has no art for. An empty box in the row is
    // better than a broken-image glyph.
    img.addEventListener('error', () => { img.classList.add('is-blank'); img.removeAttribute('src'); });
    return img;
  };

  // A race as a mark. race-icons.js owns the glyph and the fallback so the feed,
  // the report, the Library and the scout card all draw the same chip. The
  // two-letter version here covers the icon module failing to load, because data
  // must never vanish with a script.
  const raceMark = (race, tile) => {
    if (window.RaceIcons) return window.RaceIcons.mark(race, tile);
    const n = node('span', tile ? 'race-mark race-tile' : 'race-mark');
    n.textContent = RACE_SHORT[race] || '??';
    if (race) n.dataset.race = race;
    n.title = RACE[race] || 'Unknown race';
    n.setAttribute('aria-label', RACE[race] || 'Unknown race');
    return n;
  };

  // The matchup as two marks. `OvH` is jargon and `Orc vs Human` is half a line.
  const matchupMarks = (a, b) => {
    const mu = node('span', 'matchup');
    if (a) mu.appendChild(raceMark(a));
    if (a && b) mu.appendChild(node('i', null, 'v'));
    if (b) mu.appendChild(raceMark(b));
    return mu;
  };

  // A player name that opens their book. Record, habits and head-to-head all
  // live one click away, which is why the Coach view accepts a name.
  const nameLink = (name, onOpen) => {
    if (!name || !onOpen) return node('b', null, name || '');
    const b = node('button', 'name-link', name);
    b.type = 'button';
    b.title = `Open ${name} in Coach`;
    b.addEventListener('click', (e) => { e.stopPropagation(); onOpen(name); });
    return b;
  };

  // A player heading. `isYou` is a claim about the reader and is only ever true
  // where the app knows the seat is theirs, so the Library never prints it.
  const playerTitle = (p, opts) => {
    const o = opts || {};
    const title = node('h3', 'player-title');
    if (p.race) title.dataset.race = p.race;
    title.appendChild(raceMark(p.race));
    title.appendChild(nameLink(p.name, o.onOpenProfile));
    if (o.isYou) title.appendChild(node('span', 'you-tag', 'you'));
    return title;
  };

  // A section heading with its mark. The app's headings were the word alone in
  // --ink-faint uppercase, which is why nothing on the screen read as a section
  // until you were already reading it.
  const sectionHead = (glyph, text) => {
    const h = node('h3', 'dt-h');
    if (window.Glyphs) h.appendChild(window.Glyphs.mark(glyph));
    h.appendChild(node('span', null, text));
    return h;
  };

  window.UIBits = {
    RACE,
    RACE_SHORT,
    node,
    fmtDur,
    fmtMs,
    mapName,
    buildIcon,
    // The CDN root, for the few assets that are named files rather than item
    // ids: the attack/armor marks on the Match Summary carry mixed extensions
    // (atk-magic is an SVG), so buildIcon's id + '.jpg' cannot reach them.
    ICON_BASE,
    MAP_BASE,
    raceMark,
    matchupMarks,
    nameLink,
    playerTitle,
    sectionHead
  };
})();
