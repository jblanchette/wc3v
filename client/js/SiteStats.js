/**
 * SiteStats.js — anonymous usage beacon for wc3v.com.
 *
 * Sends one pageview per page load, plus a few named events, to /api/event
 * (workers/stats). What leaves the browser is the event name, the page path
 * with query and fragment stripped, and the referrer's hostname. Nothing
 * else. No cookie, no localStorage, no generated ID; the Worker stores no IP
 * and no user agent. Two visits by the same person are indistinguishable,
 * which is why no consent prompt is needed for this.
 *
 * Sends nothing when:
 *   - running on a dev host (WC3V_CONFIG.isDev), a non-wc3v.com host, or
 *     under an automation driver (navigator.webdriver — page-audit,
 *     perf-bench and friends);
 *   - the visitor sends Do Not Track or Global Privacy Control. Anonymous
 *     counts don't legally require honoring those, but the privacy page says
 *     we do, so we do.
 *
 * Usage: loaded after clientConfig.js on every page; fires its own pageview.
 *   SiteStats.event('replay_parsed')   // named events, allowlisted worker-side
 */

const SiteStats = {
  ENDPOINT: '/api/event',
  _sentPageview: false,

  enabled () {
    try {
      if (window.WC3V_CONFIG && window.WC3V_CONFIG.isDev) return false;
      if (window.location.protocol !== 'https:') return false;
      var host = window.location.hostname;
      if (host !== 'wc3v.com' && host !== 'www.wc3v.com') return false;
      if (navigator.webdriver) return false;
      if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return false;
      if (navigator.globalPrivacyControl) return false;
      return true;
    } catch (_) {
      return false;
    }
  },

  event (name) {
    if (!this.enabled()) return;
    var payload = { src: 'site', e: name, p: window.location.pathname };
    if (name === 'pageview' && document.referrer) payload.r = document.referrer;
    try {
      var body = JSON.stringify(payload);
      // sendBeacon survives page unload and never blocks paint. Same-origin,
      // so the JSON content type causes no preflight.
      var ok = navigator.sendBeacon &&
        navigator.sendBeacon(this.ENDPOINT, new Blob([body], { type: 'application/json' }));
      if (!ok) {
        fetch(this.ENDPOINT, {
          method: 'POST', body: body, keepalive: true,
          headers: { 'content-type': 'application/json' }
        }).catch(function () {});
      }
    } catch (_) { /* stats must never break a page */ }
  },

  pageview () {
    if (this._sentPageview) return;
    this._sentPageview = true;
    this.event('pageview');
  }
};

document.addEventListener('DOMContentLoaded', function () { SiteStats.pageview(); });

if (typeof window !== 'undefined') window.SiteStats = SiteStats;
