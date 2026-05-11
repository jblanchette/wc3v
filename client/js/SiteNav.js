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
    this._insertSkipLink();
    const root = this.rootPath();
    const nav = document.createElement('nav');
    nav.id = 'site-nav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'Main navigation');

    const isHome = activeSection === 'home';

    // Back-to-builds link for viewer pages with buildId
    let leftHtml = '';
    if (isHome) {
      leftHtml = `
        <div class="site-nav-search-wrap">
          <input type="text" id="build-search" class="site-nav-search"
                 placeholder="Search builds" autocomplete="off" spellcheck="false" />
        </div>`;
    } else if (document.getElementById('app')) {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('buildId')) {
        leftHtml = `<a class="site-nav-back" href="/">← Builds</a>`;
      }
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
  }
};
