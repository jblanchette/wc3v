/**
 * Glossary.js — plain-language WC3 jargon tooltips.
 *
 * Loads /data/glossary.json once; then `Glossary.linkifyText(plainText)` returns
 * an HTML string: the text HTML-escaped, with the FIRST occurrence of each known
 * term wrapped in <abbr class="gloss" tabindex="0" title="Term: definition">…</abbr>
 * (native hover tooltip; tabindex makes it keyboard-focusable). Safe to call
 * before load() resolves — it just returns escaped text with nothing wrapped.
 *
 * Used by the homepage learner cards (index.html buildCard). Style: abbr.gloss
 * in main.css. No DOM deps; hangs off window. (Native title tooltips don't show
 * on touch devices — a tap-to-show popover is a possible follow-up.)
 */
(function () {
  'use strict';

  let _regex = null;       // /\b(...)\b/gi over all match strings, longest first
  let _lookup = null;      // lowercased match string -> { term, def }
  let _loading = null;     // in-flight load() promise (cached)

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function build(terms) {
    _lookup = Object.create(null);
    const all = [];
    for (const t of terms) {
      if (!t || !t.term || !Array.isArray(t.match)) continue;
      for (const m of t.match) {
        if (typeof m !== 'string' || !m.trim()) continue;
        const key = m.toLowerCase();
        if (!(key in _lookup)) { _lookup[key] = { term: t.term, def: t.def || '' }; all.push(m); }
      }
    }
    // Longest first so multi-word phrases ("tier 2") win over their sub-words ("tier").
    all.sort((a, b) => b.length - a.length);
    _regex = all.length ? new RegExp('\\b(' + all.map(escapeRegex).join('|') + ')\\b', 'gi') : null;
  }

  const Glossary = {
    // Fetch the glossary once. Resolves whether or not it succeeded — on
    // failure, linkifyText() just degrades to plain escaped text.
    load() {
      if (_regex !== null || _lookup !== null) return Promise.resolve();
      if (_loading) return _loading;
      _loading = fetch('/data/glossary.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) { build((data && Array.isArray(data.terms)) ? data.terms : []); })
        .catch(function () { build([]); });
      return _loading;
    },

    isReady: function () { return !!_regex; },

    // Escape `plainText` and wrap the first occurrence of each known term in an
    // <abbr> tooltip. Returns an HTML string. Each term is wrapped at most once
    // per call so the text doesn't fill up with tooltips.
    linkifyText: function (plainText) {
      const text = String(plainText == null ? '' : plainText);
      if (!_regex) return escapeHtml(text);
      const used = Object.create(null);
      let out = '';
      let last = 0;
      let m;
      _regex.lastIndex = 0;
      while ((m = _regex.exec(text)) !== null) {
        const matched = m[0];
        const entry = _lookup[matched.toLowerCase()];
        out += escapeHtml(text.slice(last, m.index));
        if (entry && !used[entry.term]) {
          used[entry.term] = true;
          const tip = entry.def ? (entry.term + ': ' + entry.def) : entry.term;
          out += '<abbr class="gloss" tabindex="0" title="' + escapeHtml(tip) + '">' + escapeHtml(matched) + '</abbr>';
        } else {
          out += escapeHtml(matched);
        }
        last = m.index + matched.length;
      }
      out += escapeHtml(text.slice(last));
      return out;
    }
  };

  window.Glossary = Glossary;

  // ── Tap / click / keyboard popover ────────────────────────────────────
  // Native <abbr title> tooltips don't show on touch devices, so a tap (or
  // click, or Enter/Space on a focused term) pops a small styled card with the
  // definition near the term. The <abbr> keeps its title for screen readers.
  // One shared popover element, lazily created; delegated listeners on document.
  let _pop = null;

  function ensurePopover() {
    if (_pop) return _pop;
    _pop = document.createElement('div');
    _pop.id = 'gloss-popover';
    _pop.setAttribute('role', 'tooltip');
    _pop.hidden = true;
    _pop.style.left = '-9999px';
    _pop.style.top = '-9999px';
    (document.body || document.documentElement).appendChild(_pop);
    return _pop;
  }

  function hidePopover() {
    if (_pop && !_pop.hidden) { _pop.hidden = true; _pop._anchor = null; }
  }

  function showPopoverFor(abbr) {
    const entry = _lookup && _lookup[(abbr.textContent || '').trim().toLowerCase()];
    if (!entry) return;
    const pop = ensurePopover();
    pop.textContent = '';
    const t = document.createElement('strong'); t.className = 'gloss-pop-term'; t.textContent = entry.term;
    const d = document.createElement('span'); d.className = 'gloss-pop-def'; d.textContent = entry.def || '';
    pop.appendChild(t); pop.appendChild(d);
    pop._anchor = abbr;
    // Reveal off-screen, measure, then place — all synchronous, so no flash.
    pop.hidden = false;
    const r = abbr.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const m = 8;
    let left = Math.min(Math.max(m, r.left), Math.max(m, window.innerWidth - pr.width - m));
    let top = r.bottom + 6;
    if (top + pr.height > window.innerHeight - m) {
      const above = r.top - pr.height - 6;
      top = above >= m ? above : Math.max(m, window.innerHeight - pr.height - m);
    }
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
  }

  document.addEventListener('click', function (e) {
    const abbr = (e.target && e.target.closest) ? e.target.closest('abbr.gloss') : null;
    if (abbr) { e.preventDefault(); showPopoverFor(abbr); return; }
    hidePopover(); // any click elsewhere (incl. on the popover) dismisses it
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { hidePopover(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('abbr.gloss')) {
      e.preventDefault();
      showPopoverFor(e.target);
    }
  });
  // The anchor moves with scroll/resize — simplest correct thing is to dismiss.
  window.addEventListener('scroll', hidePopover, true);
  window.addEventListener('resize', hidePopover);
})();
