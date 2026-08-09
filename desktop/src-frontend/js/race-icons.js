// Race marks, drawn for this project.
//
// The site's wc3icons set is extracted Blizzard artwork. It stays where
// identity depends on it: unit, ability and item icons. Chrome marks are a
// different job, and these are flat single paths that tint with currentColor
// and hold up at 16px.
//
// Same register as the moment ICONS in games-view.js. One <svg> string, one
// path, no strokes, viewBox 0 0 24 24, fill inherited. Safe for innerHTML
// because every string here is our own constant.
//
// Colour comes from whatever hosts the glyph (--race-warm-* in css/tokens-desktop.css).

(function () {
  'use strict';

  const svg = (path, extra) =>
    `<svg viewBox="0 0 24 24"${extra || ''}><path d="${path}"/></svg>`;
  const evenodd = ' fill-rule="evenodd"';

  window.RaceIcons = {
    // Human: a crenellated keep with a gate. Castle-generic rather than any
    // particular town hall.
    H: svg(
      'M4 22 V9 H2 V3 h5 v3 h3 V3 h4 v3 h3 V3 h5 v6 h-2 v13 h-6 v-4 ' +
      'a2 2 0 0 0 -4 0 v4 z'
    ),

    // Orc: a single-bladed war axe. Straight haft, crescent blade.
    O: svg(
      'M13 22 h-3 V10 C6.5 10 4.5 12 3.5 15 C2 8.5 6 3.5 11.5 2.5 L13 4 z ' +
      'M10 4.6 C7.9 5.5 6.3 7.2 5.6 9.2 C7 8.2 8.5 7.8 10 7.8 z',
      evenodd
    ),

    // Night Elf: a waning crescent.
    E: svg(
      'M15.5 2.5 A10 10 0 1 0 15.5 21.5 A8.2 8.2 0 0 1 15.5 2.5 z'
    ),

    // Undead: a skull. Eyes and nose punched out, jaw squared.
    U: svg(
      'M12 2 a8.2 8.2 0 0 0 -8.2 8.2 c0 2.7 1.3 4.7 3 5.9 V20 h2.6 v2 h5.2 ' +
      'v-2 H17.2 v-3.9 c1.7 -1.2 3 -3.2 3 -5.9 A8.2 8.2 0 0 0 12 2 z ' +
      'M8.9 9.4 a1.9 1.9 0 1 1 -0.01 0 z M15.1 9.4 a1.9 1.9 0 1 1 -0.01 0 z ' +
      'M12 13.2 l1.5 2.6 h-3 z',
      evenodd
    ),

    // Random: a d6 showing five pips.
    R: svg(
      'M6.5 3 h11 A3.5 3.5 0 0 1 21 6.5 v11 A3.5 3.5 0 0 1 17.5 21 h-11 ' +
      'A3.5 3.5 0 0 1 3 17.5 v-11 A3.5 3.5 0 0 1 6.5 3 z ' +
      'M7.8 6.4 a1.5 1.5 0 1 1 -0.01 0 z M16.2 6.4 a1.5 1.5 0 1 1 -0.01 0 z ' +
      'M12 10.5 a1.5 1.5 0 1 1 -0.01 0 z ' +
      'M7.8 14.6 a1.5 1.5 0 1 1 -0.01 0 z M16.2 14.6 a1.5 1.5 0 1 1 -0.01 0 z',
      evenodd
    ),

    // Neutral or unknown: a plain ring.
    N: svg(
      'M12 2.8 a9.2 9.2 0 1 0 0 18.4 a9.2 9.2 0 0 0 0 -18.4 z ' +
      'M12 6.6 a5.4 5.4 0 1 1 0 10.8 a5.4 5.4 0 0 1 0 -10.8 z',
      evenodd
    )
  };

  const NAME = { O: 'Orc', H: 'Human', U: 'Undead', E: 'Night Elf', R: 'Random', N: 'Neutral' };
  const SHORT = { O: 'OC', H: 'HU', U: 'UD', E: 'NE', R: 'RD', N: 'NT' };

  // A race as a chip, used by the feed, the report and the scout card. An id
  // with no glyph here falls back to two letters, so a race this file has not
  // heard of still renders as data.
  window.RaceIcons.mark = (race, tile) => {
    const n = document.createElement('span');
    n.className = tile ? 'race-mark race-tile' : 'race-mark';
    const glyph = window.RaceIcons[race];
    if (glyph) n.innerHTML = glyph;   // our own constant, never replay text
    else n.textContent = SHORT[race] || '??';
    if (race) n.dataset.race = race;
    n.title = NAME[race] || 'Unknown race';
    n.setAttribute('aria-label', NAME[race] || 'Unknown race');
    return n;
  };
})();
