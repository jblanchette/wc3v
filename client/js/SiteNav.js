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

    nav.innerHTML = `
      <div class="site-nav-inner">
        <a class="site-nav-logo" href="${root}/">
          <img src="${root}/assets/wc3v.svg" alt="WC3V" class="site-nav-logo-img" />
        </a>
        <div class="site-nav-spacer"></div>
        <span class="site-nav-tagline">Warcraft III Build Orders</span>
        <span class="site-nav-patch">Patch 1.36.1</span>
      </div>
    `;

    document.body.insertBefore(nav, document.body.firstChild);
  }
};
