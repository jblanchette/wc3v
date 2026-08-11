/**
 * TosBanner.js — One-time, dismissible Terms acknowledgment banner.
 *
 * Inserts a slim notice after the site-hero-bar pointing at /terms.html and
 * /privacy.html. Persists dismissal in localStorage under `wc3v.tosAck`.
 *
 * Usage: include the script after SiteNav and let DOMContentLoaded fire.
 *   <script src="js/TosBanner.js"></script>
 *
 * Idempotent — safe to call render() multiple times.
 */

const TosBanner = {
  STORAGE_KEY: 'wc3v.tosAck',
  CURRENT_VERSION: '2026-05-06',

  isAcked() {
    try {
      return localStorage.getItem(this.STORAGE_KEY) === this.CURRENT_VERSION;
    } catch (_) {
      return false;
    }
  },

  ack() {
    try {
      localStorage.setItem(this.STORAGE_KEY, this.CURRENT_VERSION);
    } catch (_) { /* private mode — banner just won't persist dismiss */ }
  },

  render() {
    if (document.getElementById('tos-banner')) return;
    if (this.isAcked()) return;

    const nav = document.getElementById('site-nav');
    if (!nav || !nav.parentNode) return;

    const banner = document.createElement('div');
    banner.id = 'tos-banner';
    banner.className = 'tos-banner';
    banner.setAttribute('role', 'note');
    banner.innerHTML = `
      <div class="tos-banner-text">
        Free hobby tool, provided as-is. Replays are parsed in your browser and never uploaded. By using the site you agree to our
        <a href="/terms">Terms</a> &amp; <a href="/privacy">Privacy</a>.
      </div>
      <button type="button" class="tos-banner-dismiss" id="tos-banner-dismiss" aria-label="Dismiss notice">Dismiss</button>
    `;

    nav.parentNode.insertBefore(banner, nav.nextSibling);

    const dismissBtn = banner.querySelector('#tos-banner-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        this.ack();
        banner.hidden = true;
      });
    }
  }
};

// SiteNav inserts #site-nav inside its own DOMContentLoaded handler. Since
// TosBanner.js loads before the inline SiteNav.render() call on each page,
// our handler would otherwise fire first and find no nav to anchor to.
// Defer to the next tick so all DOMContentLoaded handlers complete first.
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => TosBanner.render(), 0);
});

if (typeof window !== 'undefined') window.TosBanner = TosBanner;
