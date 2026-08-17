/**
 * BuildClass.js — the six build classifications, and the single source of
 * truth for what each one means.
 *
 * A build's `buildClass` is the AUTHORITY. Its `level` band is a projection of
 * it (bandFor), written to disk by tools/backfill-classes.js so every existing
 * band consumer keeps working untouched: BandSwitcher, the /learn two-way
 * door, the `?level=` URL param, the SEO build pages, the MCP tool.
 *
 * Why one flat enum rather than two orthogonal fields (source tier + meta
 * status): the filter UI is six toggles, "off-meta" is undefined for a new
 * player build, and the grid sort needs one total order. Orthogonality is not
 * lost — it lives on the table as derived booleans (isPro, isOffMeta, band).
 *
 * STANDALONE BY RULE — this file must never `require` anything. tools/seo/
 * build-page.js requires it during Render's buildCommand, which runs on a
 * clean clone; a transitive require of anything gitignored fails the whole
 * deploy. tools/test-build-deps.js is the gate.
 */
const BuildClass = (() => {
  const CLASSES = {
    'pro-meta': {
      key: 'pro-meta', order: 0,
      label: 'Pro meta', short: 'Pro meta',
      band: 'pro', isPro: true, isOffMeta: false,
      cardClass: 'is-pro is-pro-meta', tag: 'PRO BUILD',
      desc: 'What top players are running right now'
    },
    'pro-off-meta': {
      key: 'pro-off-meta', order: 1,
      label: 'Pro off-meta', short: 'Off-meta',
      band: 'pro', isPro: true, isOffMeta: true,
      cardClass: 'is-pro is-pro-off-meta', tag: 'PRO BUILD',
      desc: 'Pro builds outside the current meta'
    },
    'ladder': {
      key: 'ladder', order: 2,
      label: 'Ladder', short: 'Ladder',
      band: 'improving', isPro: false, isOffMeta: false,
      cardClass: '', tag: null,
      desc: 'Standard builds you can copy on ladder'
    },
    'ladder-off-meta': {
      key: 'ladder-off-meta', order: 3,
      label: 'Ladder off-meta', short: 'Ladder off-meta',
      band: 'improving', isPro: false, isOffMeta: true,
      cardClass: '', tag: null,
      desc: 'Ladder builds off the beaten path'
    },
    'new-player': {
      key: 'new-player', order: 4,
      label: 'New player', short: 'New player',
      band: 'new', isPro: false, isOffMeta: false,
      cardClass: '', tag: null,
      desc: 'Builds that forgive a slow start'
    },
    'unsorted': {
      key: 'unsorted', order: 5,
      label: 'Unsorted', short: 'Unsorted',
      band: 'improving', isPro: false, isOffMeta: false,
      cardClass: '', tag: null,
      desc: 'Not yet reviewed'
    }
  };

  const KEYS = Object.keys(CLASSES).sort((a, b) => CLASSES[a].order - CLASSES[b].order);
  const DEFAULT_CLASS = 'unsorted';

  // The homepage opens with every class visible and pro sorted to the top —
  // the elite frame is what makes pro read as primary, not hiding the rest.
  // ONE line to flip if the site should ever open on pro-only instead.
  const DEFAULT_SELECTION = KEYS.slice();

  // Back-compat for anything still carrying only a legacy `level`: a
  // user-uploaded build, an unmigrated manifest, a stale cached JSON.
  const LEGACY_LEVEL = { 'pro': 'pro-meta', 'improving': 'ladder', 'new': 'new-player' };

  const isValid = (k) => !!(k && Object.prototype.hasOwnProperty.call(CLASSES, k));
  const get = (k) => CLASSES[k] || CLASSES[DEFAULT_CLASS];

  function classOf (build) {
    if (!build) return DEFAULT_CLASS;
    if (isValid(build.buildClass)) return build.buildClass;
    return LEGACY_LEVEL[build.level] || DEFAULT_CLASS;
  }

  // Every accessor takes either a class key or a whole build object.
  const pick = (x) => get(typeof x === 'string' ? x : classOf(x));

  const bandFor   = (x) => pick(x).band;
  const isPro     = (x) => pick(x).isPro;
  const isOffMeta = (x) => pick(x).isOffMeta;
  const labelOf   = (x) => pick(x).label;
  const shortOf   = (x) => pick(x).short;
  const descOf    = (x) => pick(x).desc;
  const cardClass = (x) => pick(x).cardClass;
  const tagOf     = (x) => pick(x).tag;
  const sortRank  = (x) => pick(x).order;

  // Pro first, then ladder, then new, then unsorted. Ties fall back to `_ord`,
  // the build's index in the manifest, which is the editor's chosen order —
  // so the sort is stable without depending on Array#sort being stable across
  // engines.
  const compare = (a, b) =>
    (sortRank(a) - sortRank(b)) || (((a && a._ord) || 0) - ((b && b._ord) || 0));

  // ── Corpus-side provenance ────────────────────────────────────────────────
  // Where a replay came from, decided from crawl-journal metadata alone: a
  // tournament id and how many seats matched warcraft3.info's pro roster. No
  // parse required, which is what makes it usable over the whole corpus (only
  // ~4% of it is parsed).
  //
  // This lives here, in a tracked file, so the gitignored corpus tools and the
  // shipped site can never disagree about what "pro" means.
  function provenanceOf (o) {
    const pros = (o && o.proSeats) || 0;
    const inTournament = !!(o && o.hasTournament);
    if (inTournament && pros >= 1) return 'pro-tournament';
    if (pros >= 2) return 'pro-ladder';
    if (pros >= 1) return 'ladder';
    return 'unknown';
  }
  const isProProvenance = (p) => p === 'pro-tournament' || p === 'pro-ladder';

  return {
    CLASSES, KEYS, DEFAULT_CLASS, DEFAULT_SELECTION,
    isValid, get, classOf,
    bandFor, isPro, isOffMeta, labelOf, shortOf, descOf, cardClass, tagOf,
    sortRank, compare,
    provenanceOf, isProProvenance
  };
})();

if (typeof window !== 'undefined') window.BuildClass = BuildClass;
if (typeof module !== 'undefined' && module.exports) module.exports = BuildClass;
