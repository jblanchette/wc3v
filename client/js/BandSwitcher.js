/**
 * BandSwitcher.js — Site-wide skill-level band ('new' / 'improving' / 'pro').
 *
 * Single source of truth for the band. The same control is rendered by
 * SiteNav.js on every page (compact variant) and by index.html in the hero
 * (full variant with descriptions). Both share the `.skill-band-card[data-band]`
 * JS hook handled here.
 *
 * Storage: localStorage['wc3v.level']. URL `?level=` overrides on first read.
 * Notifies subscribers via onChange() and dispatches `window` 'wc3v:bandchange'
 * for any subsystem that didn't register through onChange (e.g. cross-module
 * code that prefers an event listener).
 */
window.BandSwitcher = (function () {
  const BANDS = {
    'new': {
      order: 0, icon: 'phea',
      seg: 'New to WC3', shortLabel: 'New player',
      desc: 'Your first builds — the few things that matter',
      h2: 'Builds for new players',
      intro: 'Your first builds — forgiving timings and the few things that actually matter.'
    },
    'improving': {
      order: 1, icon: 'tkno',
      seg: 'Ladder', shortLabel: 'Ladder',
      desc: 'Solid tournament play you can copy',
      h2: 'Ladder builds',
      intro: 'Solid, copyable builds from real tournament play — the middle rung between your first builds and the pro meta.'
    },
    'pro': {
      order: 2, icon: 'ckng',
      seg: 'Pro meta', shortLabel: 'Pro',
      desc: 'Top-level builds, tight execution',
      h2: 'Pro builds',
      intro: 'Current top-level builds from major tournaments — tight execution, the latest strategies.'
    }
  };
  const BAND_KEYS = Object.keys(BANDS).sort((a, b) => BANDS[a].order - BANDS[b].order);
  const DEFAULT_BAND = 'pro';
  const STORAGE_KEY = 'wc3v.level';
  const LEGACY_KEYS = ['wc3v.boLearnerMode', 'wc3v.levelOnboardSkipped'];

  let currentBand = DEFAULT_BAND;
  let isFirstVisitMode = false;
  let initialized = false;
  const listeners = [];

  function isValidBand(b) { return !!(b && BANDS[b]); }

  function readStored() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function writeStored(band) {
    try { localStorage.setItem(STORAGE_KEY, band); } catch (e) {}
  }

  function cleanupLegacyKeys() {
    LEGACY_KEYS.forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  }

  // Sync URL `?level=` to current band. Default band drops the param.
  function syncUrl() {
    try {
      const url = new URL(window.location.href);
      if (currentBand === DEFAULT_BAND) url.searchParams.delete('level');
      else url.searchParams.set('level', currentBand);
      history.replaceState(history.state, '', url);
    } catch (e) {}
  }

  // Walk every .skill-band-card[data-band] on the page; toggle aria-pressed
  // and .is-active. Also re-syncs `data-first-visit` on every `.skill-band`
  // root — needed because BandSwitcher auto-inits during <head> parsing
  // (before the .skill-band elements exist), so the very first
  // setFirstVisitFlag call is a no-op. SiteNav.render() calls applyUI()
  // after injecting the compact nav band, which is when first-visit state
  // actually lands on the DOM.
  function applyUI() {
    document.querySelectorAll('.skill-band-card[data-band]').forEach(card => {
      const on = card.dataset.band === currentBand;
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
      card.classList.toggle('is-active', on);
    });
    document.querySelectorAll('.skill-band').forEach(root => {
      if (isFirstVisitMode) root.setAttribute('data-first-visit', '');
      else root.removeAttribute('data-first-visit');
    });
  }

  function setFirstVisitFlag(on) {
    isFirstVisitMode = on;
    document.querySelectorAll('.skill-band').forEach(root => {
      if (on) root.setAttribute('data-first-visit', '');
      else root.removeAttribute('data-first-visit');
    });
  }

  function notify(band, opts) {
    listeners.forEach(fn => { try { fn(band, opts); } catch (e) {} });
    try {
      window.dispatchEvent(new CustomEvent('wc3v:bandchange', { detail: { band: band } }));
    } catch (e) {}
  }

  function setBand(band, opts) {
    opts = opts || {};
    if (!isValidBand(band)) band = DEFAULT_BAND;
    const changed = (band !== currentBand);
    currentBand = band;
    if (opts.updateUrl !== false) syncUrl();
    if (opts.persist !== false) writeStored(band);
    setFirstVisitFlag(false);
    applyUI();
    if (changed || opts.force) notify(band, opts);
  }

  function getBand() { return currentBand; }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  // Single delegated click handler — works for both hero and compact variants
  // and any cards added later (e.g. SiteNav re-render).
  function wireClicks() {
    document.addEventListener('click', (e) => {
      const card = e.target && e.target.closest && e.target.closest('.skill-band-card[data-band]');
      if (!card) return;
      const band = card.dataset.band;
      if (!isValidBand(band)) return;
      e.preventDefault();
      setBand(band, { persist: true });
    });
  }

  // Cross-tab sync via the storage event. Same-page subscribers get notified
  // via onChange / 'wc3v:bandchange' from setBand directly.
  function wireStorage() {
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      const next = isValidBand(e.newValue) ? e.newValue : DEFAULT_BAND;
      if (next === currentBand) return;
      currentBand = next;
      applyUI();
      notify(next, { fromStorage: true });
    });
  }

  // Resolve initial band (URL > stored > default). Sets data-first-visit if
  // there's no stored band AND no URL override — the hero hint reads this.
  // Idempotent; safe to call from every page's script. The first invocation
  // also runs the one-time cleanup of legacy keys.
  function init() {
    if (initialized) { applyUI(); return; }
    initialized = true;

    cleanupLegacyKeys();

    const stored = readStored();
    let urlBand = null;
    try {
      urlBand = (new URLSearchParams(window.location.search).get('level') || '').toLowerCase() || null;
    } catch (e) {}
    const hasUrlBand = isValidBand(urlBand);

    currentBand = hasUrlBand ? urlBand : (isValidBand(stored) ? stored : DEFAULT_BAND);

    // First visit = no stored choice AND no URL hint. Hero variant uses this
    // to show the "Pick one to start" hint.
    const isFirstVisit = !isValidBand(stored) && !hasUrlBand;
    setFirstVisitFlag(isFirstVisit);

    // Keep the URL honest. If they arrived with ?level=, persist it so a
    // shared link sticks across tabs / future visits.
    if (currentBand !== DEFAULT_BAND || urlBand) syncUrl();
    if (hasUrlBand) writeStored(currentBand);

    applyUI();
    wireClicks();
    wireStorage();
  }

  return {
    init: init,
    getBand: getBand,
    setBand: setBand,
    onChange: onChange,
    applyUI: applyUI,
    BANDS: BANDS,
    BAND_KEYS: BAND_KEYS,
    DEFAULT_BAND: DEFAULT_BAND,
    isValidBand: isValidBand
  };
})();

// Auto-init at script load so any code that runs during script loading (e.g.
// `new Wc3vViewer()` in app.js, which sits at module level) can immediately
// call BandSwitcher.getBand() and read the resolved band. The applyUI() call
// inside init() is a no-op pre-DOMContentLoaded (no .skill-band-card yet) —
// SiteNav.render() calls applyUI() again once the cards are in the DOM.
window.BandSwitcher.init();

