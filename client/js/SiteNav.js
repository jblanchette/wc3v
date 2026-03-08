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
    if (!isHome && document.getElementById('app')) {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('buildId')) {
        leftHtml = `<a class="site-nav-back" href="/">← Builds</a>`;
      }
    }

    // Right-side content depends on page
    let rightHtml = '';
    if (isHome) {
      rightHtml = `
        <span class="site-nav-tagline">Warcraft III Build Orders</span>
        <span class="site-nav-patch">Patch 1.36.1</span>`;
    } else if (document.getElementById('app')) {
      rightHtml = `
        <div id="mode-switcher">
          <div id="mode-default" class="mode-btn selected" onClick="wc3v.setLayoutMode('default')">Default</div>
          <div id="mode-build" class="mode-btn" onClick="wc3v.setLayoutMode('build')">Build Only</div>
          <div id="mode-replay" class="mode-btn" onClick="wc3v.setLayoutMode('replay')">Replay Only</div>
        </div>`;
    }

    nav.innerHTML = `
      <div class="site-nav-inner">
        <a class="site-nav-logo" href="${root}/">
          <img src="${root}/assets/wc3v.svg" alt="WC3V" class="site-nav-logo-img" />
        </a>
        ${leftHtml}
        <div class="site-nav-spacer"></div>
        ${rightHtml}
      </div>
    `;

    document.body.insertBefore(nav, document.body.firstChild);
  }
};
