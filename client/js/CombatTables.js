/**
 * CombatTables.js — attack types, armor types and the WC3 TFT damage matrix.
 *
 * Split out of Constants.js (Aug 2026) because the DESKTOP APP draws the Match
 * Summary's Unit Roster and Damage Matchup from these tables, and Constants.js
 * is the viewer's enum file: LayoutMode, ScrubStates, TeamColorList, RaceTheme,
 * the scrubber states. Shipping all of that to get four lookup tables would put
 * the viewer's layout vocabulary inside an app that has no canvas.
 *
 * Same reasoning that split dominance.css out of main.css. Loaded by
 * client/viewer.html BEFORE Constants.js, and copied into the desktop's
 * js/vendor by tools/build-desktop-client.js.
 *
 * ── Two icon fields, on purpose ─────────────────────────────────────────────
 *
 * `icon` is an absolute site path and is what BuildOrderRenderer, MatchHeader
 * and UnitsProductionPanel already read. It stays exactly as it was.
 *
 * `iconFile` is the bare file name, for consumers that do not serve their art
 * from this origin. The desktop fetches icons from the CDN, so it resolves the
 * name against its own base. Note the extensions differ (`atk-magic` is an SVG),
 * which is why this is the file name and not a bare id.
 *
 * NOTE: client/index.html carries its own inline copy of ATTACK_TYPES and
 * ARMOR_TYPES, because it does not load Constants.js at all. That copy is
 * marked as a mirror at the point of declaration and is not touched here.
 */

(function () {
  'use strict';

  const ARMOR_TYPES = {
    large:  { label: 'Heavy',     iconFile: 'def-heavy.jpg',     icon: '/assets/wc3icons/def-heavy.jpg' },
    medium: { label: 'Medium',    iconFile: 'def-medium.jpg',    icon: '/assets/wc3icons/def-medium.jpg' },
    small:  { label: 'Light',     iconFile: 'def-light.jpg',     icon: '/assets/wc3icons/def-light.jpg' },
    none:   { label: 'Unarmored', iconFile: 'def-unarmored.jpg', icon: '/assets/wc3icons/def-unarmored.jpg' }
  };

  const ATTACK_TYPES = {
    normal: { label: 'Normal', iconFile: 'atk-normal.jpg', icon: '/assets/wc3icons/atk-normal.jpg' },
    pierce: { label: 'Pierce', iconFile: 'atk-pierce.jpg', icon: '/assets/wc3icons/atk-pierce.jpg' },
    siege:  { label: 'Siege',  iconFile: 'atk-siege.jpg',  icon: '/assets/wc3icons/atk-siege.jpg' },
    magic:  { label: 'Magic',  iconFile: 'atk-magic.svg',  icon: '/assets/wc3icons/atk-magic.svg' },
    chaos:  { label: 'Chaos',  iconFile: 'atk-chaos.jpg',  icon: '/assets/wc3icons/atk-chaos.jpg' }
  };

  // WC3 TFT damage multiplier matrix: DAMAGE_MATRIX[attackType][armorType].
  // Source: Warcraft III game data (w3a combat tables).
  const DAMAGE_MATRIX = {
    normal: { light: 1.0,  medium: 1.5,  heavy: 1.0,  fortified: 0.7,  hero: 1.0,  unarmored: 1.0  },
    pierce: { light: 2.0,  medium: 0.75, heavy: 1.0,  fortified: 0.35, hero: 0.5,  unarmored: 1.5  },
    siege:  { light: 1.0,  medium: 0.5,  heavy: 1.0,  fortified: 1.5,  hero: 0.5,  unarmored: 1.5  },
    magic:  { light: 1.25, medium: 0.75, heavy: 2.0,  fortified: 0.35, hero: 0.5,  unarmored: 1.5  },
    chaos:  { light: 1.0,  medium: 1.0,  heavy: 1.0,  fortified: 1.0,  hero: 1.0,  unarmored: 1.0  },
    hero:   { light: 1.0,  medium: 1.0,  heavy: 1.0,  fortified: 0.5,  hero: 1.0,  unarmored: 1.0  }
  };

  // Internal armor keys to DAMAGE_MATRIX keys.
  const ARMOR_MATRIX_KEY = {
    small: 'light', medium: 'medium', large: 'heavy',
    none: 'unarmored', hero: 'hero', fort: 'fortified', divine: 'hero'
  };

  // The viewer reads these as bare globals (BuildOrderRenderer, MatchHeader,
  // UnitsProductionPanel, MatchSummary), which is what they were as top-level
  // `const`s in Constants.js. Assigning to window keeps that working from
  // inside this IIFE.
  if (typeof window !== 'undefined') {
    window.ARMOR_TYPES = ARMOR_TYPES;
    window.ATTACK_TYPES = ATTACK_TYPES;
    window.DAMAGE_MATRIX = DAMAGE_MATRIX;
    window.ARMOR_MATRIX_KEY = ARMOR_MATRIX_KEY;
    window.CombatTables = { ARMOR_TYPES, ATTACK_TYPES, DAMAGE_MATRIX, ARMOR_MATRIX_KEY };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ARMOR_TYPES, ATTACK_TYPES, DAMAGE_MATRIX, ARMOR_MATRIX_KEY };
  }
})();
