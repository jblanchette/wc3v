/**
 * SiteNav.js — Shared navigation header for all site pages.
 *
 * Usage: call SiteNav.render(activeSection) after DOM ready.
 * activeSection: 'home' | null
 */

const SiteNav = {
  _activeSection: null,

  rootPath() {
    return '';
  },

  render(activeSection) {
    this._activeSection = activeSection;
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

    document.body.insertBefore(nav, document.body.firstChild);
  }
};
