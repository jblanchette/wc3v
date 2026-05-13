// PlayerNames — single source of truth for the "official" pro name we show
// in the UI.
//
// A .w3g replay records whatever account handle the player was logged in
// with: W3Champions handles carry a battletag suffix ("KAHO#31819"), some
// pros play under alt accounts ("AuroraHappy" = Happy, "orange" = Eer0),
// and casing is inconsistent ("KAHO" vs "Kaho"). That's confusing in a
// broadcast-style UI, so every place that displays a player name routes
// the raw string through PlayerNames.canonical() first.
//
// The ONE exception is the full-detail match header (MatchHeader.js): it
// shows the official name as the heading and exposes the raw replay handle
// in a hover tooltip via PlayerNames.original().
//
// This module is standalone (no Security/Constants dependency) so it can
// load very early. Callers still HTML-escape / sanitize the result the
// same way they would any replay-derived string (see Security.js).

const PlayerNames = (() => {
  // ALIASES: lowercased, battletag-stripped handle -> official pro name.
  // Only entries where the cleaned handle differs from the official name
  // need to be listed (a tag-stripped handle that already equals the
  // official name — "FoCuS#31324" -> "FoCuS" — is handled by stripTag).
  //
  // Derived from the project's replay filename convention
  // ({id}_{slot1}_{slot2}_{map}); keep it in sync when onboarding pros
  // who play under a different handle than their broadcast name.
  const ALIASES = {
    // --- alt accounts / handles that differ from the broadcast name ---
    'aurorahappy':   'Happy',
    'happy-':        'Happy',       // older bnet/w3arena handle
    'orange':        'Eer0',
    'medusa':        'Life',
    'lianpia':       'Lyn',
    'egg':           'TH000',
    'sunlight':      'Pcg123',
    'leonxiv':       'Leon',
    'sooook':        'Sok',
    'moosangsung':   'Sok',
    'elpollitopio':  'GodFather',
    'noname':        'Fortitude',
    'qiuqiuloveu':   'EleGaNt',
    'mclarenf1gtr':  'Sini',
    'angelxuemen':   'Snowdream',
    'iamnoob':       'War3Orcer0',
    'ehmuch':        'Ugly',
    'ice':           'Iceorc',
    '전소인':         'Soin',         // korean handle
    'dise22':        'Dise',
    'iffi':          'Infi',
    'followgrubby':  'Grubby',
    'rngrubby':      'Grubby',
    'spxfoggy':      'Foggy',
    'spx一foggy':'Foggy',        // "SPX一Foggy"
    'hazy123123':    'Hazy',        // W3C account handle
    '达菲熊': '15sui',   // "达菲熊" — distinct player from Hazy (per replay filenames)
    // --- casing-only normalizations ---
    'kaho':          'Kaho',
    'leqi':          'Leqi',
    'starbuck':      'Starbuck'
  };

  // Strip a trailing "#1234" battletag (and surrounding whitespace).
  const stripTag = (name) => String(name == null ? '' : name).replace(/#\d+\s*$/, '').trim();

  // The official pro name to display. Unknown handles fall through to the
  // battletag-stripped form, so a freshly-onboarded replay still looks fine
  // before its alias is added.
  const canonical = (name) => {
    const stripped = stripTag(name);
    if (!stripped) return stripped;
    return ALIASES[stripped.toLowerCase()] || stripped;
  };

  // The raw replay handle, exactly as recorded (battletag included), just
  // trimmed. Used only for the match-header tooltip.
  const original = (name) => String(name == null ? '' : name).trim();

  // True when canonical() actually changed the displayed name — i.e. the
  // raw handle is worth surfacing in a tooltip.
  const isAliased = (name) => canonical(name) !== original(name);

  return { canonical, original, isAliased, stripTag, ALIASES };
})();

// Browser: window.PlayerNames (loaded via <script> in index.html/viewer.html).
// Node: require('../client/js/PlayerNames.js') — used by tools/add-replay.js
// and tools/normalize-manifest-names.js so onboarding writes canonical names.
if (typeof window !== 'undefined') {
  window.PlayerNames = PlayerNames;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PlayerNames;
}
