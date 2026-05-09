(function () {
// BugReport — auto-injects "Report a bug" entry points (footer link, hero bar
// pill, viewer floating button) on every page that loads this script. Each
// entry is a plain <a target="_blank"> whose href is rebuilt at click-time
// against a Tally form (or a GitHub Issues fallback if Tally isn't wired up
// yet) carrying page URL, browser, viewport, current replay, and source
// debug context as URL params. No modal, no fetch, no spam-handling.

const TALLY_FORM_ID = 'VLvz5N';
const TALLY_BASE = 'https://tally.so/r/';
const GH_FALLBACK = 'https://github.com/jblanchette/wc3v/issues/new';

const isConfigured = () => TALLY_FORM_ID && TALLY_FORM_ID !== 'REPLACE_ME';

function readReplayContext () {
  const p = new URLSearchParams(window.location.search);
  return p.get('buildId') || p.get('local') || p.get('replay') || '';
}

function gatherContext (source) {
  return {
    page:      location.pathname + location.search,
    userAgent: navigator.userAgent,
    viewport:  window.innerWidth + 'x' + window.innerHeight,
    replay:    readReplayContext(),
    source:    source || '',
    time:      new Date().toISOString(),
    referrer:  document.referrer || ''
  };
}

function tallyUrl (ctx) {
  const qs = Object.entries(ctx)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
  return TALLY_BASE + TALLY_FORM_ID + (qs ? '?' + qs : '');
}

function githubUrl (ctx) {
  // Pre-fills a new GitHub issue with the same debug context so the user just
  // types a description. Used as a graceful fallback before the Tally form is
  // wired up — keeps the buttons useful from day one.
  const title = '[Bug] ';
  const body =
    '## What happened?\n\n_Describe the issue here._\n\n' +
    '## Debug context\n\n' +
    Object.entries(ctx)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => '- **' + k + '**: `' + v + '`')
      .join('\n');
  return GH_FALLBACK +
    '?title=' + encodeURIComponent(title) +
    '&body=' + encodeURIComponent(body);
}

function makeUrl (opts) {
  const ctx = gatherContext((opts || {}).source);
  return isConfigured() ? tallyUrl(ctx) : githubUrl(ctx);
}

// Bug-icon SVG — matches the stroke style of the existing hero-bar-help icon.
function bugIcon (size) {
  const s = size || 14;
  return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" ' +
    'fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M8 4l1.5 2"/>' +
      '<path d="M16 4l-1.5 2"/>' +
      '<rect x="7" y="6" width="10" height="13" rx="5"/>' +
      '<path d="M3 10h4"/>' +
      '<path d="M17 10h4"/>' +
      '<path d="M3 16h4"/>' +
      '<path d="M17 16h4"/>' +
      '<path d="M12 8v11"/>' +
    '</svg>';
}

function attachClickRebuild (el, source) {
  // Hover/keyboard users see a real href; the rebuild on mousedown/focus
  // refreshes it so dynamic state (current buildId, scrubber-driven URL)
  // is captured at click time.
  const refresh = () => { el.href = makeUrl({ source: source }); };
  refresh();
  el.addEventListener('mousedown', refresh);
  el.addEventListener('focus', refresh);
  el.addEventListener('touchstart', refresh, { passive: true });
}

function injectFooterLinks () {
  document.querySelectorAll('.site-footer-links').forEach((container) => {
    if (container.querySelector('.site-footer-bug')) return;
    const a = document.createElement('a');
    a.className = 'site-footer-bug';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Report a bug';
    attachClickRebuild(a, 'footer');
    container.appendChild(a);
  });
}

function injectHeroBarPills () {
  document.querySelectorAll('.hero-bar-inner').forEach((bar) => {
    if (bar.querySelector('.hero-bar-bug')) return;
    const a = document.createElement('a');
    a.className = 'hero-bar-help hero-bar-bug';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Report a bug';
    a.innerHTML = bugIcon(14) + '<span>Report a bug</span>';
    attachClickRebuild(a, 'hero');
    // Sit directly after the existing "Where are my replays?" pill so the
    // two help-pills cluster together. .hero-bar-bug overrides the
    // margin-left:auto so the bug pill doesn't get pushed right.
    const existingHelp = bar.querySelector('.hero-bar-help:not(.hero-bar-bug)');
    if (existingHelp) {
      existingHelp.insertAdjacentElement('afterend', a);
    } else {
      bar.appendChild(a);
    }
  });
}

function mountInNav () {
  // Used by pages without a footer or hero bar (i.e. viewer.html). The
  // SiteNav is rendered first; we tack a "Report a bug" entry onto its
  // links list so it sits alongside Home/About/Community instead of
  // floating over the canvas. Idempotent.
  const links = document.querySelector('.site-nav-links');
  if (!links || links.querySelector('.site-nav-bug')) return;
  const a = document.createElement('a');
  a.className = 'site-nav-link site-nav-bug';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = 'Report a bug';
  a.innerHTML = bugIcon(13) + '<span>Report a bug</span>';
  attachClickRebuild(a, 'viewer');
  links.appendChild(a);
}

function install () {
  injectFooterLinks();
  injectHeroBarPills();
}

if (typeof window !== 'undefined') {
  window.BugReport = { makeUrl, install, mountInNav };
}
})();
