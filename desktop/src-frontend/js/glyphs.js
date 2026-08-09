// Glyphs: every mark in this app that is not a race and not game art.
//
// Three sets of icons existed and only one of them was reusable. Seven moment
// marks sat inline in games-view.js, the race marks had their own module, and
// every other section in the app was a word in --ink-faint uppercase and
// nothing else. So a section looked like a section only because it happened to
// be near one.
//
// Drawn for this project, same register as race-icons.js: one <svg>, one path,
// no strokes, viewBox 0 0 24 24, fill inherited from currentColor. Flat and
// hard-edged, because the app's whole depth vocabulary is a dark outline and a
// struck highlight, and a glyph with its own shading fights that.
//
// The Blizzard art split is unchanged. Unit, hero, ability, upgrade and item
// icons ARE extracted artwork and come from the CDN, because identity is
// exactly what that art is for. Everything here is chrome.
//
// Safe for innerHTML: every string in this file is our own constant. Nothing
// out of a replay ever reaches it.

(function () {
  'use strict';

  const svg = (path, extra) =>
    `<svg viewBox="0 0 24 24"${extra || ''}><path d="${path}"/></svg>`;
  const evenodd = ' fill-rule="evenodd"';

  const PATHS = {
    // ── Moments. Lifted from games-view.js unchanged, so nothing on the
    //    timeline or the feed shifts under this refactor.
    heroKill: 'M4 3l6.5 9L9 14.5 3.5 6 4 3zm16 0l-.5 3-5.5 8.5L12.5 12 20 3zM9.5 15.5l2 2-3.5 4-2.5-2.5 4-3.5zm5 0l4 3.5L16 21.5l-3.5-4 2-2z',
    fight: 'M6 2l4 6-2 2-5-6.5L6 2zm12 0l3 1.5L16 10l-2-2 4-6zM11 12l1 1 1-1 6 7-2 3-5-6-5 6-2-3 6-7z',
    expansion: 'M12 2l2.6 6.2 6.4.5-4.9 4.2 1.5 6.3L12 15.9 6.4 19.2l1.5-6.3L3 8.7l6.4-.5L12 2z',
    tier: 'M12 3l8 7h-4v11H8V10H4l8-7z',
    scout: 'M12 5C6.5 5 2.5 9.5 1 12c1.5 2.5 5.5 7 11 7s9.5-4.5 11-7c-1.5-2.5-5.5-7-11-7zm0 3.5A3.5 3.5 0 1 1 12 15.5a3.5 3.5 0 0 1 0-7z',
    merc: 'M12 2a4 4 0 0 1 4 4v2h1.5L19 21H5l1.5-13H8V6a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v2h4V6a2 2 0 0 0-2-2z',
    camp: 'M12 3l9 17H3l9-17zm0 5L7.5 18h9L12 8z',

    // ── Build-card sections. These replace a 5rem column of uppercase words.
    //    Each one has to be legible at 20px inside a 36px rail, which rules out
    //    anything with interior detail.

    // Heroes: a winged helm. The crest is the tell at small size.
    heroes: 'M12 2c-4 0-7 2.6-7 6.4V13l-3 2 3 1v3l3.5 3h7L19 19v-3l3-1-3-2V8.4C19 4.6 16 2 12 2zm-3.2 7.6h6.4l-1 2.2H9.8z',

    // Units: two crossed spears. Reads as "an army" rather than any one unit.
    units: 'M4.2 2.6 6 2l6.6 8.4-1.8 2.2zM19.8 2.6 18 2l-6.6 8.4 1.8 2.2zM12 12.6l1.9 2.4-4.6 5.8-2.6-1 5.3-7.2zm0 0 5.3 7.2-2.6 1-4.6-5.8z',

    // Upgrades: an anvil. What a smith did to what you already had.
    upgrades: 'M3 7h7.5v2c0 .6.5 1 1.1 1H21v3c0 2.2-1.6 4-3.6 4H14l1.2 3H8.8L10 17H7c-2.2 0-4-2.2-4-5zM12 4h6v3h-6z',

    // Bought: a coin purse, drawstring at the neck.
    bought: 'M9 2h6l1.4 3.2H7.6zM8.2 6.8h7.6c2.4 1.4 4.2 4.1 4.2 7.2 0 4.4-3.6 7-8 7s-8-2.6-8-7c0-3.1 1.8-5.8 4.2-7.2zM12 9.5c-1.6 0-2.8.9-2.8 2.2 0 2.5 4.4 1.5 4.4 3.3 0 .6-.7 1-1.6 1s-1.7-.4-1.7-1.1H9.2c0 1.5 1.3 2.4 2.8 2.4s2.9-.8 2.9-2.3c0-2.6-4.4-1.7-4.4-3.4 0-.6.6-1 1.5-1s1.6.4 1.6 1.1h1.1c0-1.5-1.2-2.2-2.7-2.2z',

    // Mercs: a coin. Hired rather than trained.
    mercs: 'M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19zm0 2.6a6.9 6.9 0 1 1 0 13.8 6.9 6.9 0 0 1 0-13.8zm.9 2h-1.8v1.1c-1.3.2-2.2 1-2.2 2.2 0 2.4 3.9 1.8 3.9 3.1 0 .5-.5.8-1.3.8s-1.4-.4-1.4-1H8.3c0 1.3.9 2.1 2.2 2.4v1.1h1.8v-1.1c1.4-.2 2.3-1 2.3-2.3 0-2.4-3.9-1.9-3.9-3.1 0-.5.5-.8 1.2-.8s1.3.3 1.3.9h1.8c0-1.2-.9-2-2.1-2.2z',

    // ── The three compared metrics.

    // Dominance: a scale pan tipped. It is a share of one game between two
    // players, which is a balance and nothing else.
    dominance: 'M11 2h2v2.6l7.6 2.4-.6 1.9L13 6.7V19h4.5v2h-11v-2H11V6.7L3.9 8.9l-.6-1.9L11 4.6zM6.5 10.2 9.7 17H3.3zm11 0L20.7 17h-6.4z',

    // APM: a stopwatch. Actions against the clock.
    apm: 'M9.5 1.4h5v2.2h-5zM12 4.6a8.7 8.7 0 1 0 0 17.4 8.7 8.7 0 0 0 0-17.4zm.9 2.9v5.3l3.6 2.1-.9 1.6-4.5-2.6V7.5zM18.9 4l1.6 1.6-1.8 1.8L17.1 5.8z',

    // Hero kills: a blade through a ring. What came out of the fights.
    heroKills: 'M17.4 2.2 21 3.4 14.8 12l-2.4-2.6zM8.4 12.4a5.4 5.4 0 1 0 3.5 3.4l-1.8 2a3.5 3.5 0 1 1-1.6-1.6zM13.6 13l2.4 2.6-3 4.2-2.2-2.4z',

    // ── Small chrome used by section heads elsewhere in the app.
    build: 'M4 20V9.5L12 3l8 6.5V20h-6v-5.5h-4V20zm8-14.4L6.4 10.2h11.2z',
    time: 'M12 2.5A9.5 9.5 0 1 0 12 21.5 9.5 9.5 0 0 0 12 2.5zm.9 3.9v5.3l3.9 2.3-.9 1.6-4.8-2.8V6.4z',
    map: 'M9 2.6 3 4.9v16.5l6-2.3zm2 0v16.5l6 2.3V4.9zm8 2.3v16.5l4-1.5V3.4zM3 3.4 1 4.2v14.4l2-.8z'
  };

  const cache = {};
  const markup = (name) => {
    if (cache[name] === undefined) {
      cache[name] = PATHS[name] ? svg(PATHS[name], name === 'units' ? evenodd : '') : null;
    }
    return cache[name];
  };

  // A moment type to its mark. Several types share one glyph on purpose: a
  // trade and a kill are the same kind of event seen from two seats.
  const forMoment = (type) => {
    if (type === 'heroKill' || type === 'heroTrade' || type === 'heroLostToCreeps') return 'heroKill';
    if (type === 'tier2' || type === 'tier3' || type === 'heroUlt') return 'tier';
    if (type === 'expansion') return 'expansion';
    if (type === 'scout') return 'scout';
    if (type === 'merc') return 'merc';
    if (type === 'campClear') return 'camp';
    return 'fight';
  };

  window.Glyphs = {
    // Raw markup, for the places already building an innerHTML string.
    markup,

    /**
     * A glyph as an element.
     *
     * Decorative by default: `aria-hidden`, because a mark beside a section
     * whose name is already in the accessible tree is noise to a screen reader.
     * Pass a label to make it the accessible name instead, which is what a
     * glyph REPLACING a word needs.
     */
    mark (name, opts) {
      const o = opts || {};
      const n = document.createElement('span');
      n.className = 'glyph' + (o.className ? ' ' + o.className : '');
      const html = markup(name);
      if (html) n.innerHTML = html;   // our own constant, never replay text
      if (o.label) {
        n.title = o.label;
        n.setAttribute('role', 'img');
        n.setAttribute('aria-label', o.label);
      } else {
        n.setAttribute('aria-hidden', 'true');
      }
      return n;
    },

    forMoment,
    has: (name) => !!PATHS[name]
  };
})();
