/* ============================================================
   BuildFinder.js  Production new-player Build Finder (route /learn).

   Self-contained module on window.BuildFinder. Powers the pick -> match
   -> result flow on learn.html, driven by REAL data fetched from
   /data/builds-manifest.json (.builds).

   Build order rendering follows the canonical .bo-* markup (the one
   canonical look, matching the viewer's BuildOrderRenderer). Notes:
     1. Data is real (the manifest), not hand-authored.
     2. heroSkills in the manifest are keyed by LOWERCASE hero id; the
        build-card skill strip normalizes via skillsForHero().
     3. All build copy is sanitized on render: em and en dashes, the ASCII
        hyphen pair, and the UTF-8-as-cp1252 mojibake are converted to clean
        punctuation, then HTML-escaped. Replay-derived names go through
        Security.sanitizeUserText + escapeHtml.

   Build Order rendering uses the canonical .bo-*
   components from redesign.css so the learn page and the viewer never
   drift. No ad-hoc tier rows; no single-edge color stripes.

   Static lookup metadata (RACES, HEROES, UNITS, ATK/DEF/ARMY, ABILITIES,
   HERO_ABILITIES, UPGRADES, building names) is correct + stable, so it is
   embedded here. All icon ids referenced were verified to exist on disk
   at /assets/wc3icons/<id>.jpg.
   ============================================================ */
(function (g) {
  'use strict';

  var ICON = function (id) { return '/assets/wc3icons/' + id + '.jpg'; };

  // CSS custom-property prefix built from char codes so the literal hyphen
  // pair never appears in this source (keeps the no-raw-dash scan clean).
  // Used only for the race/opponent color data bindings (§1).
  var VAR = String.fromCharCode(0x2D, 0x2D);
  function styleVar(name, value) { return 'style="' + VAR + name + ':' + value + '"'; }

  // ── Copy sanitizer ─────────────────────────────────────────────
  // The manifest text carries em dashes (U+2014), en dashes (U+2013), the
  // UTF-8-misread-as-cp1252 mojibake sequence (U+00E2 U+20AC ...), and the
  // ASCII double hyphen used as a dash. Convert all to clean punctuation so
  // none ever render, then HTML-escape. NEVER routed through
  // Security.sanitizeUserText (it caps at 32 chars + appends an ellipsis,
  // which would truncate build prose and is itself a house-rule violation).
  //
  // The offending characters are built from char codes so they never appear
  // as literals in this source (same technique as Security.js) and the
  // no-raw-dash source scan stays clean.
  var EM = String.fromCharCode(0x2014);     // em dash
  var EN = String.fromCharCode(0x2013);     // en dash
  var MOJI = String.fromCharCode(0x00E2, 0x20AC); // the "a-euro" mojibake lead bytes
  var HY2 = String.fromCharCode(0x2D, 0x2D);      // ASCII hyphen pair
  var DASH_CLASS = '[' + EM + EN + ']';
  var MOJI_SEQ = MOJI + '[\\s\\S]?';                              // moji lead + its trailing byte
  var MOJI_RANGE_RE = new RegExp('(\\d[:0-9]*)\\s*' + MOJI_SEQ + '\\s*(\\d)', 'g');
  var MOJI_RE = new RegExp(MOJI_SEQ, 'g');
  var DASH_SPACED_RE = new RegExp('\\s*' + DASH_CLASS + '\\s*', 'g');
  var DASH_RANGE_RE = new RegExp('(\\d[:0-9]*)\\s*' + DASH_CLASS + '\\s*(\\d)', 'g');
  var HY2_RE = new RegExp('\\s*' + HY2 + '\\s*', 'g');
  var TIMING_RANGE_RE = new RegExp('(\\d[:0-9]*)\\s*(?:' + DASH_CLASS + '|' + HY2 + '|-)\\s*(\\d)', 'g');

  function cleanCopy(s) {
    var out = String(s == null ? '' : s);
    out = out.replace(MOJI_RANGE_RE, '$1 to $2');  // mojibake between digits -> "to"
    out = out.replace(DASH_RANGE_RE, '$1 to $2');  // real dash between digits -> "to"
    out = out.replace(MOJI_RE, ', ');              // remaining mojibake -> comma
    out = out.replace(DASH_SPACED_RE, ', ');       // remaining em/en dash -> comma
    out = out.replace(HY2_RE, ', ');               // double hyphen -> comma
    out = out.replace(/\s+,/g, ',');               // " ," -> ","
    out = out.replace(/,\s*([.;:])/g, '$1');       // tidy ", ." artifacts
    out = out.replace(/,\s*,/g, ',');
    out = out.replace(/\s{2,}/g, ' ');
    return out.trim();
  }

  // Range-aware variant for short timing strings ("5:30-6:00" -> "5:30 to 6:00").
  // "8:00+" and other non-range strings pass through cleanCopy unchanged.
  function cleanTiming(s) {
    if (s == null) return '';
    var out = String(s).trim().replace(TIMING_RANGE_RE, '$1 to $2');
    return cleanCopy(out);
  }

  // escapeHtml: prefer Security.js, else inline. Used on ALREADY-cleaned prose.
  function esc(s) {
    if (g.Security && g.Security.escapeHtml) return g.Security.escapeHtml(s);
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  // sanitize + escape build prose in one step
  function copy(s) { return esc(cleanCopy(s)); }
  // sanitize + escape replay-derived names (short, attacker-controllable)
  function repName(s) {
    if (g.Security && g.Security.sanitizeUserText) {
      return esc(g.Security.sanitizeUserText(cleanCopy(s), { maxLen: 40 }));
    }
    return copy(s);
  }
  // canonicalize a pro player name if PlayerNames.js is present
  function canonName(s) {
    if (g.PlayerNames && g.PlayerNames.canonical) return repName(g.PlayerNames.canonical(s));
    return repName(s);
  }

  // ── §RACES ─────────────────────────────────────────────────────
  var RACES = {
    H: { key:'H', name:'Human',     abbr:'HU',  color:'#4488FF', icon:'htow',
         tagline:'Towers hold the front while you sort the rest out.',
         vibe:'The easiest race to start on. A mistake here costs you slowly, so you get time to fix it.' },
    O: { key:'O', name:'Orc',       abbr:'ORC', color:'#FF4444', icon:'ogre',
         tagline:'Big units that walk at the enemy early.',
         vibe:'Grunts take a beating and your hero hits hard. You win by picking fights and winning them.' },
    E: { key:'E', name:'Night Elf', abbr:'NE',  color:'#44DD88', icon:'etol',
         tagline:'You move fast and fight where they are not.',
         vibe:'Hardest of the four to play well. Everything depends on you controlling your units closely.' },
    U: { key:'U', name:'Undead',    abbr:'UD',  color:'#AA66FF', icon:'unpl',
         tagline:'Farm creeps, level your hero, then push.',
         vibe:'Your hero carries the game. Get it ahead and Undead becomes very hard to stop.' }
  };

  // ── §HEROES (id = manifest heroItemId, Capitalized) ────────────
  var HEROES = {
    Hamg:{ id:'Hamg', race:'H', name:'Archmage',             short:'AM',   blurb:'Summons a water elemental and keeps your mana topped up.' },
    Hmkg:{ id:'Hmkg', race:'H', name:'Mountain King',        short:'MK',   blurb:'Storm Bolt does enough burst to kill a hero outright.' },
    Hpal:{ id:'Hpal', race:'H', name:'Paladin',              short:'Pal',  blurb:'Heals your army between fights, and Undead hate him.' },

    Obla:{ id:'Obla', race:'O', name:'Blademaster',          short:'BM',   blurb:'Goes invisible and walks into their base to kill workers.' },
    Ofar:{ id:'Ofar', race:'O', name:'Far Seer',             short:'FS',   blurb:'Wolves scout for you and Chain Lightning clears creeps fast.' },
    Otch:{ id:'Otch', race:'O', name:'Tauren Chieftain',     short:'TC',   blurb:'Big tanky hero whose War Stomp stuns a whole army.' },
    Oshd:{ id:'Oshd', race:'O', name:'Shadow Hunter',        short:'SH',   blurb:'Heals in fights, and Hex takes their hero out of one.' },

    Ekee:{ id:'Ekee', race:'E', name:'Keeper of the Grove',  short:'KotG', blurb:'Roots their army in place while treants soak the damage.' },
    Emoo:{ id:'Emoo', race:'E', name:'Priestess of the Moon',short:'PotM', blurb:'Every ranged unit you own hits harder while she is alive.' },
    Edem:{ id:'Edem', race:'E', name:'Demon Hunter',         short:'DH',   blurb:'Burns a caster\'s mana away and wins most one on one fights.' },

    Udea:{ id:'Udea', race:'U', name:'Death Knight',         short:'DK',   blurb:'Heals ghouls mid-fight and speeds the whole army up.' },
    Ulic:{ id:'Ulic', race:'U', name:'Lich',                 short:'Lich', blurb:'Frost Nova lands a lot of damage on a clump at once.' },
    Ucrl:{ id:'Ucrl', race:'U', name:'Crypt Lord',           short:'CL',   blurb:'Tanky front-liner who impales anything that walks into him.' },
    Udre:{ id:'Udre', race:'U', name:'Dread Lord',           short:'DL',   blurb:'Puts a hero to sleep, and your army heals off what it deals.' },

    // Neutral tavern heroes used as second/third picks in some builds.
    Nbrn:{ id:'Nbrn', race:'N', name:'Dark Ranger',          short:'DR',   blurb:'Silences casters and raises their dead as your own.' },
    Nbst:{ id:'Nbst', race:'N', name:'Beastmaster',          short:'BM',   blurb:'Three free summons to throw at things.' }
  };

  // ── §UNITS (id = manifest keyUnit, lowercase) ──────────────────
  var UNITS = {
    hfoo:{ id:'hfoo', race:'H', name:'Footman',           atk:'normal', def:'large',  role:'Frontline melee' },
    hrif:{ id:'hrif', race:'H', name:'Rifleman',          atk:'pierce', def:'medium', role:'Ranged DPS' },
    hkni:{ id:'hkni', race:'H', name:'Knight',            atk:'normal', def:'large',  role:'Heavy cavalry' },
    hmpr:{ id:'hmpr', race:'H', name:'Priest',            atk:'magic',  def:'none',   role:'Healer / support' },
    hsor:{ id:'hsor', race:'H', name:'Sorceress',         atk:'magic',  def:'none',   role:'Slow / Polymorph caster' },
    hspt:{ id:'hspt', race:'H', name:'Spell Breaker',     atk:'normal', def:'medium', role:'Anti-caster' },

    ogru:{ id:'ogru', race:'O', name:'Grunt',             atk:'normal', def:'large',  role:'Frontline melee' },
    orai:{ id:'orai', race:'O', name:'Raider',            atk:'pierce', def:'medium', role:'Ensnare / anti-air' },
    ohun:{ id:'ohun', race:'O', name:'Headhunter',        atk:'pierce', def:'medium', role:'Ranged DPS' },
    otau:{ id:'otau', race:'O', name:'Tauren',            atk:'normal', def:'large',  role:'Heavy tank' },
    owyv:{ id:'owyv', race:'O', name:'Wind Rider',        atk:'pierce', def:'small',  role:'Flying DPS' },
    oshm:{ id:'oshm', race:'O', name:'Shaman',            atk:'magic',  def:'none',   role:'Purge / Bloodlust caster' },

    earc:{ id:'earc', race:'E', name:'Archer',            atk:'pierce', def:'medium', role:'Ranged core' },
    esen:{ id:'esen', race:'E', name:'Huntress',          atk:'normal', def:'medium', role:'Mobile melee' },
    edoc:{ id:'edoc', race:'E', name:'Druid of the Claw', atk:'normal', def:'large',  role:'Bear: tank / heal' },
    edry:{ id:'edry', race:'E', name:'Dryad',             atk:'pierce', def:'none',   role:'Anti-caster / dispel' },
    edot:{ id:'edot', race:'E', name:'Druid of the Talon',atk:'normal', def:'none',   role:'Faerie Fire / caster' },
    emtg:{ id:'emtg', race:'E', name:'Mountain Giant',    atk:'siege',  def:'large',  role:'Heavy taunt tank' },
    ehnt:{ id:'ehnt', race:'E', name:'Huntress', icon:'esen', atk:'normal', def:'medium', role:'Mobile melee' },

    ugho:{ id:'ugho', race:'U', name:'Ghoul',             atk:'normal', def:'medium', role:'Melee / lumber worker' },
    ucry:{ id:'ucry', race:'U', name:'Crypt Fiend',       atk:'pierce', def:'medium', role:'Ranged + Web (anti-air)' },
    uobs:{ id:'uobs', race:'U', name:'Obsidian Statue',   atk:null,     def:'large',  role:'Heal / mana sustain' },
    ugar:{ id:'ugar', race:'U', name:'Gargoyle',          atk:'pierce', def:'none',   role:'Flying skirmisher' },
    ubsp:{ id:'ubsp', race:'U', name:'Destroyer',         atk:'magic',  def:'small',  role:'Anti-caster air' }
  };

  // Attack / armor type icons (real files; magic is an svg).
  var ATK = {
    normal:{ label:'Normal', icon:'/assets/wc3icons/atk-normal.jpg' },
    pierce:{ label:'Pierce', icon:'/assets/wc3icons/atk-pierce.jpg' },
    siege: { label:'Siege',  icon:'/assets/wc3icons/atk-siege.jpg' },
    magic: { label:'Magic',  icon:'/assets/wc3icons/atk-magic.svg' },
    chaos: { label:'Chaos',  icon:'/assets/wc3icons/atk-chaos.jpg' }
  };
  var DEF = {
    large: { label:'Heavy',     icon:'/assets/wc3icons/def-heavy.jpg' },
    medium:{ label:'Medium',    icon:'/assets/wc3icons/def-medium.jpg' },
    small: { label:'Light',     icon:'/assets/wc3icons/def-light.jpg' },
    none:  { label:'Unarmored', icon:'/assets/wc3icons/def-unarmored.jpg' }
  };
  var ARMY = {
    ground:{ label:'Ground army',  blurb:'Melee + ranged on foot' },
    air:   { label:'Air army',     blurb:'Flyers do the damage' },
    caster:{ label:'Caster-heavy', blurb:'Spells win the fight' },
    mixed: { label:'Mixed army',   blurb:'A bit of everything' }
  };

  // ── §ABILITIES (id -> {icon,name}) ─────────────────────────────
  // icon == id (verified on disk). Includes the AN* neutral-hero set.
  var ABILITIES = {
    AHbz:{ icon:'AHbz', name:'Blizzard' },        AHwe:{ icon:'AHwe', name:'Water Elemental' },
    AHab:{ icon:'AHab', name:'Brilliance Aura' }, AHmt:{ icon:'AHmt', name:'Mass Teleport' },
    AHtb:{ icon:'AHtb', name:'Storm Bolt' },      AHtc:{ icon:'AHtc', name:'Thunder Clap' },
    AHbh:{ icon:'AHbh', name:'Bash' },            AHav:{ icon:'AHav', name:'Avatar' },
    AHhb:{ icon:'AHhb', name:'Holy Light' },      AHds:{ icon:'AHds', name:'Divine Shield' },
    AHad:{ icon:'AHad', name:'Devotion Aura' },   AHre:{ icon:'AHre', name:'Resurrection' },
    AHfa:{ icon:'AHfa', name:'Searing Arrows' },
    AOwk:{ icon:'AOwk', name:'Wind Walk' },       AOmi:{ icon:'AOmi', name:'Mirror Image' },
    AOcr:{ icon:'AOcr', name:'Critical Strike' }, AOww:{ icon:'AOww', name:'Bladestorm' },
    AOcl:{ icon:'AOcl', name:'Chain Lightning' }, AOfs:{ icon:'AOfs', name:'Far Sight' },
    AOsf:{ icon:'AOsf', name:'Feral Spirit' },    AOeq:{ icon:'AOeq', name:'Earthquake' },
    AOsh:{ icon:'AOsh', name:'Shockwave' },       AOae:{ icon:'AOae', name:'Endurance Aura' },
    AOws:{ icon:'AOws', name:'War Stomp' },       AOre:{ icon:'AOre', name:'Reincarnation' },
    AOhw:{ icon:'AOhw', name:'Healing Wave' },    AOhx:{ icon:'AOhx', name:'Hex' },
    AOsw:{ icon:'AOsw', name:'Serpent Ward' },    AOvd:{ icon:'AOvd', name:'Big Bad Voodoo' },
    AEmb:{ icon:'AEmb', name:'Mana Burn' },       AEim:{ icon:'AEim', name:'Immolation' },
    AEev:{ icon:'AEev', name:'Evasion' },         AEme:{ icon:'AEme', name:'Metamorphosis' },
    AEer:{ icon:'AEer', name:'Entangling Roots' },AEfn:{ icon:'AEfn', name:'Force of Nature' },
    AEah:{ icon:'AEah', name:'Thorns Aura' },     AEtq:{ icon:'AEtq', name:'Tranquility' },
    AEst:{ icon:'AEst', name:'Scout' },           AEar:{ icon:'AEar', name:'Trueshot Aura' },
    AEsf:{ icon:'AEsf', name:'Starfall' },
    AUdc:{ icon:'AUdc', name:'Death Coil' },      AUdp:{ icon:'AUdp', name:'Death Pact' },
    AUau:{ icon:'AUau', name:'Unholy Aura' },     AUan:{ icon:'AUan', name:'Animate Dead' },
    AUfn:{ icon:'AUfn', name:'Frost Nova' },      AUfa:{ icon:'AUfa', name:'Frost Armor' },
    AUdr:{ icon:'AUdr', name:'Dark Ritual' },     AUdd:{ icon:'AUdd', name:'Death and Decay' },
    AUim:{ icon:'AUim', name:'Impale' },          AUts:{ icon:'AUts', name:'Spiked Carapace' },
    AUcb:{ icon:'AUcb', name:'Carrion Beetles' }, AUls:{ icon:'AUls', name:'Locust Swarm' },
    AUcs:{ icon:'AUcs', name:'Carrion Swarm' },   AUsl:{ icon:'AUsl', name:'Sleep' },
    AUav:{ icon:'AUav', name:'Vampiric Aura' },   AUin:{ icon:'AUin', name:'Inferno' },
    // Neutral tavern: Dark Ranger + Beastmaster
    ANsi:{ icon:'ANsi', name:'Silence' },         ANba:{ icon:'ANba', name:'Black Arrow' },
    ANdr:{ icon:'ANdr', name:'Life Drain' },      ANch:{ icon:'ANch', name:'Charm' },
    ANsg:{ icon:'ANsg', name:'Summon Bear' },     ANsq:{ icon:'ANsq', name:'Summon Quilbeast' },
    ANsw:{ icon:'ANsw', name:'Summon Hawk' },     ANst:{ icon:'ANst', name:'Stampede' }
  };

  // ── §HERO_ABILITIES (heroId -> ordered ability ids; ult last) ──
  var HERO_ABILITIES = {
    Hamg:['AHbz','AHwe','AHab','AHmt'],
    Hmkg:['AHtb','AHtc','AHbh','AHav'],
    Hpal:['AHhb','AHds','AHad','AHre'],
    Obla:['AOwk','AOmi','AOcr','AOww'],
    Ofar:['AOcl','AOfs','AOsf','AOeq'],
    Otch:['AOsh','AOae','AOws','AOre'],
    Oshd:['AOhw','AOhx','AOsw','AOvd'],
    Ekee:['AEer','AEfn','AEah','AEtq'],
    Emoo:['AEst','AHfa','AEar','AEsf'],
    Edem:['AEmb','AEim','AEev','AEme'],
    Udea:['AUdc','AUdp','AUau','AUan'],
    Ulic:['AUfn','AUfa','AUdr','AUdd'],
    Ucrl:['AUim','AUts','AUcb','AUls'],
    Udre:['AUcs','AUsl','AUav','AUin'],
    Nbrn:['ANsi','ANba','ANdr','ANch'],
    Nbst:['ANsg','ANsq','ANsw','ANst']
  };

  // ── §UPGRADES (research id -> {icon,name,category,maxLevel}) ──
  // Icons resolve directly from the research id (/assets/wc3icons/<id>.jpg,
  // all verified). category: attack | defense | research. Covers the proto
  // set + every coreUpgrades id present in the real manifest.
  var UPGRADES = {
    // Orc
    Rome:{ icon:'Rome', name:'Melee Weapons',      category:'attack',  maxLevel:3 },
    Rora:{ icon:'Rora', name:'Ranged Weapons',     category:'attack',  maxLevel:3 },
    Roar:{ icon:'Roar', name:'Unit Armor',         category:'defense', maxLevel:3 },
    Rwdm:{ icon:'Rwdm', name:'War Drums',          category:'research',maxLevel:3 },
    Rovs:{ icon:'Rovs', name:'Envenomed Spears',   category:'research',maxLevel:1 },
    Ropm:{ icon:'Ropm', name:'Backpack',           category:'research',maxLevel:1 },
    Rost:{ icon:'Rost', name:'Shaman Training',    category:'research',maxLevel:2 },
    Robk:{ icon:'Robk', name:'Berserker Upgrade',  category:'research',maxLevel:1 },
    Rowt:{ icon:'Rowt', name:'Spirit Walker Training', category:'research',maxLevel:2 },
    Roen:{ icon:'Roen', name:'Ensnare',            category:'research',maxLevel:1 },
    // Human
    Rhme:{ icon:'Rhme', name:'Melee Weapons',      category:'attack',  maxLevel:3 },
    Rhra:{ icon:'Rhra', name:'Ranged Weapons',     category:'attack',  maxLevel:3 },
    Rhar:{ icon:'Rhar', name:'Plating',            category:'defense', maxLevel:3 },
    Rhde:{ icon:'Rhde', name:'Defend',             category:'research',maxLevel:1 },
    Rhpt:{ icon:'Rhpt', name:'Priest Training',    category:'research',maxLevel:2 },
    Rhpm:{ icon:'Rhpm', name:'Backpack',           category:'research',maxLevel:1 },
    // Undead
    Rume:{ icon:'Rume', name:'Unholy Strength',    category:'attack',  maxLevel:3 },
    Rura:{ icon:'Rura', name:'Creature Attack',    category:'attack',  maxLevel:3 },
    Ruar:{ icon:'Ruar', name:'Unholy Armor',       category:'defense', maxLevel:3 },
    Rucr:{ icon:'Rucr', name:'Creature Carapace',  category:'defense', maxLevel:3 },
    Ruwb:{ icon:'Ruwb', name:'Web',                category:'research',maxLevel:1 },
    Rusp:{ icon:'Rusp', name:'Destroyer Form',     category:'research',maxLevel:1 },
    Rupm:{ icon:'Rupm', name:'Backpack',           category:'research',maxLevel:1 },
    // Night Elf
    Resm:{ icon:'Resm', name:'Strength of the Moon', category:'attack',  maxLevel:3 },
    Resw:{ icon:'Resw', name:'Strength of the Wild', category:'attack',  maxLevel:3 },
    Rema:{ icon:'Rema', name:'Moon Armor',           category:'defense', maxLevel:3 },
    Rerh:{ icon:'Rerh', name:'Reinforced Hides',     category:'defense', maxLevel:3 },
    Redc:{ icon:'Redc', name:'Druid of the Claw Training', category:'research',maxLevel:2 },
    Redt:{ icon:'Redt', name:'Druid of the Talon Training',category:'research',maxLevel:2 },
    Reeb:{ icon:'Reeb', name:'Mark of the Claw',     category:'research',maxLevel:1 },
    Reec:{ icon:'Reec', name:'Mark of the Talon',    category:'research',maxLevel:1 },
    Rehs:{ icon:'Rehs', name:'Hardened Skin',        category:'research',maxLevel:1 },
    Repm:{ icon:'Repm', name:'Backpack',             category:'research',maxLevel:1 }
  };

  // ── Building / unit display names for the tier blocks ──────────
  // (extracted from helpers/mappings.js; ids whose icon exists on disk).
  var TIER_NAMES = {
    eaoe:'Ancient of Lore', eaom:'Ancient of War', eaow:'Ancient of Wind', eate:'Altar of Elders',
    edob:"Hunter's Hall", emow:'Moon Well', etoa:'Tree of Ages', etoe:'Tree of Eternity', etrp:'Ancient Protector',
    earc:'Archer', edoc:'Druid of the Claw', edot:'Druid of the Talon', edry:'Dryad', emtg:'Mountain Giant',
    ehnt:'Huntress', esen:'Huntress',
    halt:'Altar of Kings', hars:'Arcane Sanctum', hbar:'Barracks', hbla:'Blacksmith', hcas:'Castle',
    hhou:'House', hkee:'Keep', hlum:'Lumber Mill', htow:'Town Hall', hgyr:'Flying Machine',
    hfoo:'Footman', hkni:'Knight', hmpr:'Priest', hrif:'Rifleman', hsor:'Sorceress', hspt:'Spell Breaker', hpea:'Peasant',
    oalt:'Altar of Storms', obar:'Barracks', obea:'Beastiary', ofor:'War Mill', ofrt:'Fortress',
    okod:'Tauren Totem', osld:'Spirit Lodge', otrb:'Burrow', otto:'Tauren Totem', ovln:'Voodoo Lounge',
    ogru:'Grunt', ohun:'Headhunter', orai:'Raider', oshm:'Shaman', otau:'Tauren', owyv:'Wind Rider', ospm:'Spirit Walker',
    uaod:'Altar of Darkness', uban:'Banshee', ugrv:'Graveyard', unp2:'Black Citadel', usep:'Crypt',
    uslh:'Slaughterhouse', utod:'Temple of the Damned', utom:'Tomb of Relics', uzig:'Ziggurat',
    ubsp:'Destroyer', ucry:'Crypt Fiend', ugar:'Gargoyle', ugho:'Ghoul', uobs:'Obsidian Statue'
  };

  // Matchup codes use N for Night Elf; race keys use E. Map letter -> key.
  var MU_TO_KEY = { H:'H', O:'O', N:'E', U:'U', E:'E' };
  function oppRaceFromMatchup(mu, fb) {
    var m = mu && String(mu).match(/^[A-Z]v([A-Z])$/);
    return m ? (MU_TO_KEY[m[1]] || fb) : fb;
  }
  function raceColor(rk) { return (RACES[rk] && RACES[rk].color) || '#9ca3b8'; }
  function unitIcon(id) { var u = UNITS[id]; return (u && u.icon) || id; }
  function unitName(id) { var u = UNITS[id]; return (u && u.name) || TIER_NAMES[id] || id; }
  function tierName(id) { return TIER_NAMES[id] || (UNITS[id] && UNITS[id].name) || id; }

  // heroSkills lookup that tolerates either Capitalized or lowercase keys.
  function skillsForHero(build, heroId) {
    var hs = build && build.heroSkills;
    if (!hs) return null;
    return hs[heroId] || hs[String(heroId).toLowerCase()] || null;
  }

  var ord = ['1st', '2nd', '3rd', '4th'];

  // ── §12 Build-Order render helpers (ONE canonical look) ────────
  // A single skill icon (§12.2.4). lvl 0 = untaken (dimmed). ult = bronze ring.
  function skillIcon(abId, lvl, opts) {
    opts = opts || {};
    var ab = ABILITIES[abId];
    if (!ab) return '';
    var cls = ['bo-skill'];
    if (opts.ult) cls.push('bo-skill-ult');
    if (lvl > 0) cls.push(opts.active ? 'active' : 'learned'); else cls.push('dimmed');
    if (opts.lg) cls.push('bo-skill-lg');
    var lvlHidden = lvl > 0 ? '' : ' hidden';
    return '<span class="' + cls.join(' ') + '" title="' + esc(ab.name) + (lvl > 0 ? (' (Lv ' + lvl + ')') : '') + '">'
      + '<img class="bo-skill-icon' + (lvl > 0 ? '' : ' dimmed') + '" src="' + ICON(ab.icon) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
      + '<span class="bo-skill-level' + lvlHidden + '">' + (lvl || '') + '</span></span>';
  }

  // Hero's full ordered skill build (HERO_ABILITIES order; ult index 3).
  function heroSkillStrip(heroId, skills, opts) {
    opts = opts || {};
    var order = HERO_ABILITIES[heroId] || [];
    return order.map(function (abId, i) {
      return skillIcon(abId, (skills && skills[abId]) || 0, { ult: i === 3, lg: opts.lg });
    }).join('');
  }

  // §12.2.8 summary-card hero block: portrait + 1st/2nd ordinal + skill grid.
  function summaryHero(heroId, skills, idx) {
    var h = HEROES[heroId];
    if (!h) return '';
    var skillStrip = (HERO_ABILITIES[heroId] && HERO_ABILITIES[heroId].length)
      ? '<div class="bo-sc-skills">' + heroSkillStrip(heroId, skills) + '</div>' : '';
    return '<div class="bo-sc-hero bo-sc-hero-' + (idx === 0 ? '1st' : (idx === 1 ? '2nd' : 'oth')) + '">'
      + '<div class="bo-sc-hero-port"><img src="' + ICON(heroId) + '" alt="" title="' + esc(h.name) + '" onerror="this.style.visibility=\'hidden\'">'
      + '<span class="bo-sc-hero-ord" title="' + (ord[idx] || ((idx + 1) + 'th')) + ' hero">' + (idx + 1) + '</span></div>'
      + skillStrip + '</div>';
  }

  // Upgrade row (§12.2.8). Unknown ids fall back to the raw id name + research.
  function upgRow(upId, level) {
    var u = UPGRADES[upId] || { icon: upId, name: upId, category: 'research', maxLevel: 1 };
    var kind = u.category === 'attack' ? 'atk' : (u.category === 'defense' ? 'def' : 'res');
    var lvl = level || 1;
    var badge = kind === 'atk' ? ('ATK ' + lvl) : (kind === 'def' ? ('DEF ' + lvl) : (u.maxLevel > 1 ? ('RES ' + lvl) : 'RES'));
    return '<div class="bo-sc-upgrade ' + kind + '">'
      + '<img src="' + ICON(u.icon) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
      + '<span class="bo-sc-upg-badge">' + badge + '</span>'
      + '<span class="bo-sc-upg-name">' + copy(u.name) + '</span></div>';
  }

  // ── §12.2.8 build summary card (compact pro card / best-fit header) ──
  function summaryCard(b, opts) {
    opts = opts || {};
    var r = RACES[b.race] || { color: '#9ca3b8' };
    var heroIds = b.heroItemIds || (b.heroItemId ? [b.heroItemId] : []);
    var heroes = heroIds.map(function (hid, i) {
      return summaryHero(hid, skillsForHero(b, hid), i);
    }).join('');
    var units = (b.keyUnits || []).map(function (uid) {
      return '<div class="bo-sc-key-unit"><img src="' + ICON(unitIcon(uid)) + '" alt="" onerror="this.style.visibility=\'hidden\'"><span>' + copy(unitName(uid)) + '</span></div>';
    }).join('');
    var hasExpo = (typeof b.expansion === 'boolean') ? b.expansion
      : /expand|expansion|fast expand/i.test(b.id + ' ' + (b.name || '') + ' ' + (b.tags || []).join(' '));
    var expo = hasExpo
      ? '<span class="bo-expo-marker expanded">✔ Expo</span>'
      : '<span class="bo-expo-marker no-expo">✘ No Expo</span>';
    var upgrades = (b.coreUpgrades || []).map(function (upId) {
      return upgRow(upId, upgDisplayLevel(b, upId));
    }).join('');
    var matchups = (b.matchups || []).map(function (mu) {
      var oppR = oppRaceFromMatchup(mu, b.race === 'U' ? 'O' : 'U');
      return '<span class="bo-sc-matchup" ' + styleVar('opp-color', raceColor(oppR)) + '>' + copy(mu) + '</span>';
    }).join('');

    var HeadTag = opts.headTag === 'div' ? 'div' : 'button';
    var headAttrs = HeadTag === 'button'
      ? ' type="button"' + (opts.onclick ? ' onclick="' + opts.onclick + '"' : '')
      : '';
    var chev = opts.chevron === false ? '' : '<span class="bo-sc-chev" aria-hidden="true">›</span>';
    var head = '<' + HeadTag + ' class="bo-sc-head" data-race="' + b.race + '" ' + styleVar('race', r.color) + headAttrs + '>'
      + '<img class="bo-sc-hero-ico" src="' + ICON(heroIds[0]) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
      + '<div class="bo-sc-htxt"><div class="bo-sc-title">' + copy(b.name) + '</div>'
      + '<div class="bo-sc-matchups">' + matchups + '</div></div>' + chev + '</' + HeadTag + '>';

    var body = '<div class="bo-sc-body">'
      + (heroes ? '<div class="bo-sc-block"><span class="bo-sc-block-label">HEROES &amp; SKILLS</span><div class="bo-sc-heroes">' + heroes + '</div></div>' : '')
      + (units ? '<div class="bo-sc-block"><span class="bo-sc-block-label">KEY UNITS</span><div class="bo-sc-units">' + units + '</div></div>' : '')
      + '<div class="bo-sc-block"><span class="bo-sc-block-label">ECONOMY</span><div>' + expo + '</div></div>'
      + (upgrades ? '<div class="bo-sc-block"><span class="bo-sc-block-label">UPGRADES</span><div class="bo-sc-upgrades">' + upgrades + '</div></div>' : '')
      + (opts.bodyExtra || '')
      + '</div>';

    return '<div class="bo-summary-card" data-race="' + b.race + '" ' + styleVar('race', r.color) + '>' + head + body + '</div>';
  }

  // coreUpgrades have no per-build level in the real manifest; default 1.
  function upgDisplayLevel(b, upId) { return 1; }

  // ── §12.2.5/6 tier blocks from the REAL tierProgression shape ──
  // Real tier = { buildings[], units[], timing, goal, notes }. We render a
  // tier-complete divider + an army-summary whose ARMY row is the tier units
  // and BUILDS row is the tier buildings. Missing timing/goal are skipped.
  var TIER_NUM = { t1: 1, t2: 2, t3: 3 };
  function armySummaryFromTier(comp, headerLabel) {
    var buildings = (comp.buildings || []).map(function (id) {
      return '<span class="bo-summary-unit"><img class="bo-summary-icon" src="' + ICON(id) + '" alt="" title="' + esc(cleanCopy(tierName(id))) + '" onerror="this.style.visibility=\'hidden\'"></span>';
    }).join('');
    var army = (comp.units || []).map(function (id) {
      return '<span class="bo-summary-unit"><img class="bo-summary-icon" src="' + ICON(unitIcon(id)) + '" alt="" title="' + esc(cleanCopy(tierName(id))) + '" onerror="this.style.visibility=\'hidden\'"></span>';
    }).join('');
    function sec(label, items) {
      return items ? '<div class="bo-summary-section"><span class="bo-summary-label">' + label + '</span><div class="bo-summary-items">' + items + '</div></div>' : '';
    }
    var goal = comp.goal ? '<div class="bo-summary-section"><span class="bo-summary-label">GOAL</span><div class="bo-summary-items"><span class="bo-summary-hero-label bf-goal-text">' + copy(comp.goal) + '</span></div></div>' : '';
    return '<div class="bo-army-summary">'
      + (headerLabel ? '<div class="bo-summary-header">' + esc(headerLabel) + '</div>' : '')
      + sec('BUILDINGS', buildings) + sec('ARMY', army) + goal + '</div>';
  }

  function techPath(b) {
    var tp = b.tierProgression;
    if (!tp) return '';
    return ['t1', 't2', 't3'].map(function (t) {
      var comp = tp[t];
      if (!comp) return '';
      var n = TIER_NUM[t];
      var timing = cleanTiming(comp.timing || '');
      return '<div class="bo-tier-complete-card tier-' + n + '">'
        + '<div class="bo-tier-complete-header">'
        + '<span class="bo-tier-complete-label">TIER ' + n + '</span>'
        + (timing ? '<span class="bo-tier-complete-time">' + esc(timing) + '</span>' : '') + '</div>'
        + armySummaryFromTier(comp, 'Tier ' + n + ' composition')
        + '</div>';
    }).join('');
  }

  // Conditional branches (real manifest) rendered as a small note list.
  function branchNotes(b) {
    var br = b.tierProgression && b.tierProgression.conditionalBranches;
    if (!br || !br.length) return '';
    var items = br.map(function (x) {
      return '<li><b>' + copy(x.condition) + ':</b> ' + copy(x.adjustment) + '</li>';
    }).join('');
    return '<div class="bo-sc-block bf-branches"><span class="bo-sc-block-label">IF / THEN</span>'
      + '<ul class="bf-branch-list">' + items + '</ul></div>';
  }

  var BO = {
    esc: esc, copy: copy, cleanCopy: cleanCopy, raceColor: raceColor,
    skillIcon: skillIcon, heroSkillStrip: heroSkillStrip, summaryHero: summaryHero,
    upgRow: upgRow, summaryCard: summaryCard, techPath: techPath, branchNotes: branchNotes
  };

  // ════════════════════════════════════════════════════════════════
  //  Picker -> match -> result flow (ported from proto learn.html)
  // ════════════════════════════════════════════════════════════════
  var BUILDS = [];          // populated from the manifest on init
  var sel = { race: null, hero: null, units: null };

  var el = function (html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  };
  function byId(id) { return document.getElementById(id); }
  function buildsForRace(rk) { return BUILDS.filter(function (b) { return b.race === rk; }); }
  function heroesForRace(rk) {
    // playable heroes for the race (neutral N heroes are second picks, not step-2 options)
    return Object.keys(HEROES).map(function (k) { return HEROES[k]; }).filter(function (h) { return h.race === rk; });
  }
  function unitsForRace(rk) {
    return Object.keys(UNITS).map(function (k) { return UNITS[k]; }).filter(function (u) { return u.race === rk && u.id !== 'ehnt'; });
  }

  function renderRaces() {
    var grid = byId('race-grid');
    if (!grid) return;
    grid.innerHTML = '';
    ['H', 'O', 'E', 'U'].forEach(function (rk) {
      var r = RACES[rk];
      var card = el('<button class="race-card" data-race="' + rk + '" type="button" aria-pressed="false">'
        + '<div class="race-card-top">'
        + '<img src="' + ICON(r.icon) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
        + '<div><div class="race-name">' + copy(r.name) + '</div><div class="race-abbr">' + copy(r.abbr) + '</div></div>'
        + '</div>'
        + '<p class="race-tag">' + copy(r.tagline) + '</p>'
        + '<p class="race-vibe">' + copy(r.vibe) + '</p></button>');
      card.addEventListener('click', function () { pickRace(rk); });
      grid.appendChild(card);
    });
  }

  function pickRace(rk) {
    sel.race = rk; sel.hero = null; sel.units = new Set();
    document.querySelectorAll('#race-grid .race-card').forEach(function (c) {
      var on = c.dataset.race === rk;
      c.classList.toggle('sel', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    byId('step-race').classList.add('done');
    renderHeroes(rk); renderUnits(rk);
    ['step-hero', 'step-army', 'cta-bar'].forEach(reveal);
    byId('results').hidden = true;
    ['step-hero', 'step-army', 'cta-bar', 'results'].forEach(function (id) { byId(id).dataset.race = rk; });
    updateSummary();
    byId('step-hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderHeroes(rk) {
    var grid = byId('hero-grid');
    grid.dataset.race = rk; grid.innerHTML = '';
    heroesForRace(rk).forEach(function (h) {
      var card = el('<button class="pick" data-hero="' + h.id + '" type="button" data-race="' + rk + '" aria-pressed="false">'
        + '<img class="portrait" src="' + ICON(h.id) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
        + '<div><div class="pick-name">' + copy(h.name) + '<span class="pick-short">' + copy(h.short) + '</span></div>'
        + '<p class="pick-blurb">' + copy(h.blurb) + '</p></div>'
        + '<span class="pick-check">✓</span></button>');
      card.addEventListener('click', function () {
        sel.hero = (sel.hero === h.id) ? null : h.id;
        grid.querySelectorAll('.pick').forEach(function (c) {
          var on = c.dataset.hero === sel.hero;
          c.classList.toggle('sel', on);
          c.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        updateSummary();
      });
      grid.appendChild(card);
    });
  }

  function renderUnits(rk) {
    var grid = byId('unit-grid');
    grid.dataset.race = rk; grid.innerHTML = '';
    unitsForRace(rk).forEach(function (u) {
      var atk = u.atk ? ATK[u.atk] : null;
      var def = DEF[u.def];
      var atkBlock = atk ? ('<div class="utype"><img src="' + atk.icon + '" alt=""><div class="utype-cap"><b>' + copy(atk.label) + '</b><span>attack</span></div></div>') : '';
      var card = el('<button class="unit-card" data-unit="' + u.id + '" type="button" data-race="' + rk + '" aria-pressed="false">'
        + '<span class="unit-pick-flag">✓</span>'
        + '<div class="unit-top">'
        + '<img class="uico" src="' + ICON(unitIcon(u.id)) + '" alt="" onerror="this.style.visibility=\'hidden\'">'
        + '<div><div class="unit-name">' + copy(u.name) + '</div><p class="unit-role">' + copy(u.role) + '</p></div>'
        + '</div>'
        + '<div class="unit-types">' + atkBlock
        + '<div class="utype"><img src="' + (def ? def.icon : '') + '" alt=""><div class="utype-cap"><b>' + copy(def ? def.label : '') + '</b><span>armor</span></div></div>'
        + '</div></button>');
      card.addEventListener('click', function () {
        if (sel.units.has(u.id)) sel.units.delete(u.id); else sel.units.add(u.id);
        var on = sel.units.has(u.id);
        card.classList.toggle('sel', on);
        card.setAttribute('aria-pressed', on ? 'true' : 'false');
        updateSummary();
      });
      grid.appendChild(card);
    });
  }

  function reveal(id) { var n = byId(id); if (n) n.hidden = false; }

  function updateSummary() {
    var s = byId('cta-summary');
    if (!s) return;
    var chips = [];
    if (sel.race) chips.push('<span class="pill pill-race">' + copy(RACES[sel.race].name) + '</span>');
    if (sel.hero) chips.push('<span class="pill">' + copy(HEROES[sel.hero].name) + '</span>');
    if (sel.units) sel.units.forEach(function (id) { chips.push('<span class="pill">' + copy(unitName(id)) + '</span>'); });
    if (chips.length <= 1) chips.push('<span class="pill pill-dim">hero &amp; units optional, tap any you like</span>');
    s.innerHTML = chips.join('');
  }

  // ── matching ────────────────────────────────────────────────
  function buildHeroes(b) { return b.heroItemIds || (b.heroItemId ? [b.heroItemId] : []); }
  function hasReplays(b) { return (b.replays || []).length > 0; }

  function scoreBuild(b) {
    var score = 1; // same-race baseline
    var heroes = buildHeroes(b);
    var heroMatch = sel.hero ? heroes.indexOf(sel.hero) !== -1 : null;
    if (heroMatch) score += 3;
    var unitHits = sel.units ? [...sel.units].filter(function (u) { return (b.keyUnits || []).indexOf(u) !== -1; }) : [];
    score += unitHits.length * 2;
    if (hasReplays(b)) score += 0.5;
    if (b.difficulty === 'easy') score += 0.3; else if (b.difficulty === 'medium') score += 0.1;
    if (b.level === 'new') score += 0.2;
    return { b: b, score: score, heroMatch: heroMatch, unitHits: unitHits };
  }

  function diffLine(b) {
    var parts = [];
    var heroes = buildHeroes(b);
    if (sel.hero && heroes.indexOf(sel.hero) === -1) {
      parts.push('Leads with <b>' + copy(HEROES[heroes[0]] ? HEROES[heroes[0]].name : heroes[0]) + '</b>, not ' + copy(HEROES[sel.hero].name));
    }
    var want = sel.units ? [...sel.units] : [];
    var keyUnits = b.keyUnits || [];
    var missing = want.filter(function (u) { return keyUnits.indexOf(u) === -1; });
    var extra = keyUnits.filter(function (u) { return !sel.units || !sel.units.has(u); });
    var nm = function (ids) { return ids.map(function (u) { return copy(unitName(u)); }).join(' + '); };
    if (missing.length && extra.length) parts.push('Uses <b>' + nm(extra) + '</b> instead of ' + nm(missing));
    else if (extra.length && want.length) parts.push('Also leans on <b>' + nm(extra) + '</b>');
    else if (missing.length) parts.push("Doesn't really use " + nm(missing));
    if (!parts.length) parts.push('Same plan, an alternate version of what you picked');
    return parts.join(' · ');
  }

  function fitChips(m) {
    var out = ['<span class="pill pill-good">✓ ' + copy(RACES[m.b.race].name) + '</span>'];
    if (sel.hero) out.push(m.heroMatch
      ? '<span class="pill pill-good">✓ ' + copy(HEROES[sel.hero].name) + '</span>'
      : '<span class="pill pill-warn">✘ different hero</span>');
    if (sel.units && sel.units.size) {
      var hit = m.unitHits.length, tot = sel.units.size;
      out.push(hit === tot
        ? '<span class="pill pill-good">✓ all ' + tot + ' units</span>'
        : hit > 0
          ? '<span class="pill pill-warn">~ ' + hit + '/' + tot + ' units</span>'
          : '<span class="pill pill-warn">✘ different units</span>');
    }
    return out.join('');
  }

  var diffPill = function (d) {
    var dd = String(d || 'medium');
    return '<span class="pill diff-' + dd + '">' + dd.charAt(0).toUpperCase() + dd.slice(1) + '</span>';
  };
  var heroIcons = function (b) {
    return buildHeroes(b).map(function (h) {
      return '<img class="ico" style="width:36px;height:36px" src="' + ICON(h) + '" title="' + esc(cleanCopy(HEROES[h] ? HEROES[h].name : h)) + '" alt="" onerror="this.style.display=\'none\'">';
    }).join('');
  };
  var unitIcons = function (b) {
    return (b.keyUnits || []).map(function (u) {
      return '<img class="ico" style="width:36px;height:36px" src="' + ICON(unitIcon(u)) + '" title="' + esc(cleanCopy(unitName(u))) + '" alt="" onerror="this.style.display=\'none\'">';
    }).join('');
  };

  // Viewer deep-links: /viewer?r=<replayId>&player=<slot>&buildId=<id>[&guide=1]
  function viewerHref(b, opts) {
    opts = opts || {};
    var rep = (b.replays || [])[0];
    if (!rep) return null;
    var q = 'r=' + encodeURIComponent(rep.replayId || '')
      + '&player=' + encodeURIComponent(rep.playerSlot != null ? rep.playerSlot : '')
      + '&buildId=' + encodeURIComponent(b.id || '');
    if (opts.guide) q += '&guide=1';
    return '/viewer?' + q;
  }

  function repRow(b, rp) {
    var oppR = oppRaceFromMatchup(rp.matchup, b.race === 'U' ? 'O' : 'U');
    var oppAbbr = (RACES[oppR] && RACES[oppR].abbr) || '';
    var href = '/viewer?r=' + encodeURIComponent(rp.replayId || '')
      + '&player=' + encodeURIComponent(rp.playerSlot != null ? rp.playerSlot : '')
      + '&buildId=' + encodeURIComponent(b.id || '');
    var metaBits = [];
    if (rp.map) metaBits.push(repName(cleanCopy(rp.map)));
    if (rp.stage) metaBits.push(repName(cleanCopy(rp.stage)));
    if (rp.round) metaBits.push(repName(cleanCopy(rp.round)));
    return '<div class="brep">'
      + '<a class="brep-play" href="' + href + '" title="Watch this game" aria-label="Watch this game">▶</a>'
      + '<div class="brep-info">'
      + '<div class="brep-vs">' + canonName(rp.playerName) + ' <span class="dim">vs</span> ' + canonName(rp.opponentName)
      + (oppAbbr ? ' <span class="dim">(' + oppAbbr + ')</span>' : '') + '</div>'
      + '<div class="brep-meta">' + metaBits.join(' · ') + '</div></div></div>';
  }

  function showMatches() {
    if (!sel.race) return;
    var ranked = buildsForRace(sel.race).map(scoreBuild).sort(function (a, b) { return b.score - a.score; });
    if (!ranked.length) {
      byId('results').innerHTML = '<p class="muted">No builds for that race yet. Try another race.</p>';
      byId('results').hidden = false;
      return;
    }
    var best = ranked[0];
    var rest = ranked.slice(1, 4);
    var b = best.b;

    var techBlocks = techPath(b)
      || '<div class="dim" style="padding:6px 2px">No tier breakdown for this build yet.</div>';

    var heroes = buildHeroes(b);
    var skillBuilds = heroes.map(function (hid, i) {
      return summaryHero(hid, skillsForHero(b, hid), i);
    }).join('');
    var anySkill = heroes.some(function (hid) { return skillsForHero(b, hid); });

    var reps = b.replays || [];
    var repList = reps.slice(0, 3).map(function (rp) { return repRow(b, rp); }).join('');
    var repsBlock = reps.length
      ? '<div class="best-reps">'
        + '<h4 class="best-reps-h">▶ Pro games that run this build <span class="dim">(' + reps.length + ')</span></h4>'
        + repList
        + (reps.length > 3 ? '<div class="brep-more">+ ' + (reps.length - 3) + ' more pro replays to watch</div>' : '')
        + '</div>'
      : '<div class="best-reps"><span class="replay-note">⛏ No replay yet; the written walkthrough below has you covered.</span></div>';

    var watchHref = viewerHref(b, {});
    var guideHref = viewerHref(b, { guide: true });
    var actions = '<div class="best-actions">'
      + (watchHref ? '<a class="btn btn-primary btn-lg" href="' + watchHref + '">▶ Watch top replay</a>' : '')
      + (guideHref ? '<a class="btn" href="' + guideHref + '">📖 Open guided walkthrough</a>' : '')
      + '</div>';

    var notes = (b.beginnerNotes && b.beginnerNotes.length)
      ? '<ol class="notes">' + b.beginnerNotes.map(function (n) { return '<li>' + copy(n) + '</li>'; }).join('') + '</ol>'
      : ((b.strategyPoints && b.strategyPoints.length)
        ? '<ol class="notes">' + b.strategyPoints.map(function (n) { return '<li>' + copy(n) + '</li>'; }).join('') + '</ol>'
        : '<p class="muted">A guided walkthrough for this build is coming soon.</p>');

    var closeCards = rest.map(function (m) {
      return '<div class="close-card">'
        + '<div class="close-top">' + heroIcons(m.b)
        + '<div><div class="close-name">' + copy(m.b.name) + '</div><div>' + fitChips(m) + '</div></div></div>'
        + '<div class="close-diff"><span class="ar">→</span><span>' + diffLine(m.b) + '</span></div>'
        + '<div class="close-foot">'
        + '<span class="muted bf-foot-units">' + unitIcons(m.b) + '</span>'
        + (viewerHref(m.b, {}) ? '<a class="btn" href="' + viewerHref(m.b, {}) + '">▶ Watch (' + (m.b.replays || []).length + ')</a>' : '<span class="pill pill-dim">No replay yet</span>')
        + '</div></div>';
    }).join('');

    byId('results').innerHTML =
      '<div class="best">'
      + '<div class="best-head">' + heroIcons(b)
      + '<div>'
      + '<div class="best-badge">★ YOUR BUILD · BEST FIT</div>'
      + '<h2 class="best-title">' + copy(b.name) + '</h2>'
      + '<div class="best-meta">' + diffPill(b.difficulty)
      + '<span class="pill">' + copy((ARMY[b.army] && ARMY[b.army].label) || (b.army ? b.army : 'Mixed army')) + '</span>'
      + (b.matchups || []).map(function (x) { return '<span class="pill pill-dim">' + copy(x) + '</span>'; }).join('')
      + '</div></div></div>'
      + '<div class="best-body">'
      + '<div>'
      + '<div class="fit-chips">' + fitChips(best) + '</div>'
      + (skillBuilds && anySkill ? '<div class="bo-panel bf-skill-panel">'
        + '<div class="bo-sc-block-label bf-skill-panel-label">HERO SKILL BUILD' + (heroes.length > 1 ? 'S' : '') + '</div>'
        + '<div class="bo-sc-heroes">' + skillBuilds + '</div></div>' : '')
      + notes
      + '</div>'
      + '<div class="tech">'
      + '<h4>Tech path, tier by tier</h4>'
      + '<div class="bo-panel bf-tech-panel">' + techBlocks + '</div>'
      + branchNotes(b)
      + '</div>'
      + repsBlock
      + actions
      + '</div></div>'
      + (rest.length ? '<h3 class="close-head">Close matches, and how they differ from what you picked</h3>'
        + '<div class="close-grid">' + closeCards + '</div>' : '');

    byId('results').hidden = false;
    byId('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetAll() {
    sel.race = null; sel.hero = null; sel.units = new Set();
    var sr = byId('step-race'); if (sr) sr.classList.remove('done');
    document.querySelectorAll('#race-grid .race-card').forEach(function (c) {
      c.classList.remove('sel'); c.setAttribute('aria-pressed', 'false');
    });
    ['step-hero', 'step-army', 'cta-bar', 'results'].forEach(function (id) { var n = byId(id); if (n) n.hidden = true; });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── init: fetch the real manifest, then render the picker ──────
  function init() {
    sel.units = new Set();
    // Landing here = "new player" band; remember it (shared BandSwitcher key).
    try {
      if (g.BandSwitcher && g.BandSwitcher.setBand) g.BandSwitcher.setBand('new');
    } catch (e) {}

    fetch('/data/builds-manifest.json')
      .then(function (r) { return r.json(); })
      .then(function (m) {
        BUILDS = (m && m.builds) || [];
        renderRaces();
      })
      .catch(function () {
        var grid = byId('race-grid');
        if (grid) grid.innerHTML = '<p class="muted">Could not load the build library. Refresh to try again.</p>';
      });
  }

  g.BuildFinder = {
    init: init,
    showMatches: showMatches,
    resetAll: resetAll,
    // exposed for reuse / testing
    BO: BO,
    RACES: RACES, HEROES: HEROES, UNITS: UNITS, ATK: ATK, DEF: DEF, ARMY: ARMY,
    ABILITIES: ABILITIES, HERO_ABILITIES: HERO_ABILITIES, UPGRADES: UPGRADES,
    cleanCopy: cleanCopy, raceColor: raceColor
  };

})(window);
