// Security — single source of truth for handling replay-derived strings
// before they reach the DOM.
//
// A .w3g replay carries attacker-controllable strings (player names, hero
// proper names, map names, etc.). Three things have to happen before any
// such string is rendered:
//
//   1. HTML-escape so it can't break out of an element / attribute.
//   2. Strip control characters and bidi/zero-width unicode tricks
//      that let an attacker masquerade as legitimate UI.
//   3. Length-cap so a 200-character "WC3V SECURITY: visit attacker.com"
//      banner can't squeeze into a player-name slot.
//
// Caller responsibilities:
//   - Use textContent when possible (no escape needed, but sanitize for
//     control chars / length first).
//   - Use Security.escapeHtml(Security.sanitizeUserText(s)) inside an
//     `${...}` interpolation that flows into innerHTML.
//   - Use Security.escapeAttr(Security.sanitizeUserText(s)) for title /
//     alt / style attribute interpolations.

const Security = (() => {
  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const escapeAttr = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Built via new RegExp from string so the source is readable. Regex
  // literals containing C0 ranges render as invisible bytes in editors.
  //
  // STRICT: all C0 controls + DEL. Single-line UI fields shouldn't have
  // any of these — including \t, \n, \r — they only make text harder
  // to reason about and easier to disguise.
  const CONTROL_CHARS_STRICT = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');
  // KEEP_LF: same set but allows \n (for fields that explicitly want it).
  const CONTROL_CHARS_KEEP_LF = new RegExp('[\\u0000-\\u0009\\u000B-\\u001F\\u007F]', 'g');
  // Bidi overrides + zero-width + BOM. The unicode primitives used to
  // disguise text — RTLO flips display order, zero-width joiners hide
  // content from human readers.
  //   U+200B-U+200F  zero-width space, ZWNJ, ZWJ, LRM, RLM
  //   U+202A-U+202E  LRE, RLE, PDF, LRO, RLO
  //   U+2066-U+2069  LRI, RLI, FSI, PDI
  //   U+FEFF         byte-order mark (zero-width no-break space)
  const BIDI_AND_ZERO_WIDTH = new RegExp(
    '[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]', 'g'
  );

  const sanitizeUserText = (s, opts) => {
    const o = opts || {};
    const maxLen = typeof o.maxLen === 'number' ? o.maxLen : 32;
    const allowNewlines = !!o.allowNewlines;

    let out = String(s == null ? '' : s);
    out = out.replace(allowNewlines ? CONTROL_CHARS_KEEP_LF : CONTROL_CHARS_STRICT, '');
    out = out.replace(BIDI_AND_ZERO_WIDTH, '');

    if (out.length > maxLen) {
      out = out.slice(0, maxLen - 1) + '…';
    }
    return out;
  };

  return { escapeHtml, escapeAttr, sanitizeUserText };
})();

if (typeof window !== 'undefined') {
  window.Security = Security;
}
