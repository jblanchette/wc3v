/**
 * SiteNav.js — Shared navigation header for all site pages.
 *
 * Usage: call SiteNav.render(activeSection) after DOM ready.
 * activeSection: 'home' | 'about' | 'community' | null
 */

const SiteNav = {
  _activeSection: null,

  rootPath() {
    return '';
  },

  // Insert a "Skip to content" link as the very first focusable element on
  // the page, targeting the main content region. Off-screen until focused
  // (see .skip-link in main.css). Idempotent.
  _insertSkipLink() {
    if (document.getElementById('skip-to-content')) return;
    let main = document.querySelector('main, [role="main"], #content');
    if (!main) return;
    if (!main.id) main.id = 'main-content';
    // So the target receives focus when the skip link is followed.
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    const a = document.createElement('a');
    a.id = 'skip-to-content';
    a.className = 'skip-link';
    a.href = '#' + main.id;
    a.textContent = 'Skip to content';
    document.body.insertBefore(a, document.body.firstChild);
  },

  render(activeSection) {
    this._activeSection = activeSection;
    // Idempotent: drop any prior nav so a second render() (e.g. SPA-style
    // re-render) reuses the slot instead of stacking duplicate #site-nav /
    // #skill-band-nav ids. SiteNav binds no listeners of its own (BandSwitcher
    // uses one delegated document handler), so a replaced nav leaks nothing.
    const existingNav = document.getElementById('site-nav');
    if (existingNav) existingNav.remove();
    this._insertSkipLink();
    const root = this.rootPath();
    const nav = document.createElement('nav');
    nav.id = 'site-nav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'Main navigation');

    const isHome = activeSection === 'home';

    // Same compact skill-band on every page — driven by BandSwitcher.js (which
    // owns state, persistence, URL sync, and click delegation). The hero
    // variant on the homepage is rendered in index.html; the nav variant
    // below is what users see everywhere else. Icon ids (phea/tkno/ckng) come
    // from the BANDS const in BandSwitcher.js.
    const bandIco = (id) => `<img class="skill-band-ico" src="${root}/assets/wc3icons/${id}.jpg" alt="" aria-hidden="true" loading="lazy" onerror="this.style.display='none'" />`;
    const skillBandHtml = `
      <div class="skill-band skill-band--compact" id="skill-band-nav" role="group" aria-label="Skill level">
        <button type="button" class="skill-band-card" data-band="new" aria-pressed="false" title="New to WC3: your first builds, the few that matter">${bandIco('phea')}<span class="skill-band-label">New to WC3</span></button>
        <button type="button" class="skill-band-card" data-band="improving" aria-pressed="false" title="Ladder: solid tournament play you can copy">${bandIco('tkno')}<span class="skill-band-label">Ladder</span></button>
        <button type="button" class="skill-band-card" data-band="pro" aria-pressed="false" title="Pro meta: top-level builds, tight execution">${bandIco('ckng')}<span class="skill-band-label">Pro meta</span></button>
      </div>`;

    let leftHtml = '';
    if (isHome) {
      leftHtml = `
        <div class="site-nav-search-wrap">
          <input type="text" id="build-search" class="site-nav-search"
                 placeholder="Search builds" autocomplete="off" spellcheck="false" />
        </div>
        ${skillBandHtml}`;
    } else if (document.getElementById('app')) {
      // Viewer page: optional "← Builds" back link (when opened from a build
      // card) plus the same compact band.
      const urlParams = new URLSearchParams(window.location.search);
      const backLink = urlParams.get('buildId') ? `<a class="site-nav-back" href="/">← Builds</a>` : '';
      leftHtml = `${backLink}${skillBandHtml}`;
    } else {
      // About / Community / Replays / etc. — band only.
      leftHtml = skillBandHtml;
    }

    const navLinks = `
      <div class="site-nav-spacer"></div>
      <div class="site-nav-links">
        <a class="site-nav-link" href="${root}/">Home</a>
        <a class="site-nav-link" href="${root}/about.html">About</a>
        <a class="site-nav-link" href="${root}/community.html">Community</a>
      </div>`;

    // On the homepage the WC3V logo is rendered prominently in the hero
    // bar, so the small nav-logo is suppressed to avoid duplication.
    const logoHtml = isHome ? '' : `
      <a class="site-nav-logo" href="${root}/">
        <img src="${root}/assets/wc3v.svg" alt="WC3V" class="site-nav-logo-img" />
      </a>`;

    nav.innerHTML = `
      <div class="site-nav-inner">
        ${logoHtml}
        ${leftHtml}
        ${navLinks}
      </div>
    `;

    // Place the nav right after the skip link (if present) so the skip link
    // stays the first focusable element; otherwise at the top of <body>.
    const skip = document.getElementById('skip-to-content');
    if (skip && skip.parentNode === document.body) {
      document.body.insertBefore(nav, skip.nextSibling);
    } else {
      document.body.insertBefore(nav, document.body.firstChild);
    }

    // Sync the just-rendered band cards' aria-pressed / .is-active state to
    // the current band. BandSwitcher.init() must have run by now; if a page
    // loads SiteNav before BandSwitcher (it shouldn't), this is a no-op and
    // BandSwitcher's own applyUI() will catch it on init.
    if (window.BandSwitcher && typeof window.BandSwitcher.applyUI === 'function') {
      window.BandSwitcher.applyUI();
    }
  }
};
