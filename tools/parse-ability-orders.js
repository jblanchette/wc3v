/*
  Parses orders.c (from github.com/WarRaft/Order) and maps
  WC3 order IDs to hero ability FourCC codes.

  Outputs helpers/spellOrderIds.json — used by Player.js to identify
  which spell a hero cast from the replay's orderId bytes.

  Usage: node tools/parse-ability-orders.js
*/

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'ability-data');
const OUTPUT = path.join(__dirname, '..', 'helpers', 'spellOrderIds.json');

// Map order string → ability FourCC code
// Built from cross-referencing orders.c with heroAbilities in mappings.js
const ORDER_TO_ABILITY = {
  // Human - Archmage
  'blizzard':         'AHbz',
  'waterelemental':   'AHwe',
  // brilliance aura is passive, no cast order
  'massteleport':     'AHmt',

  // Human - Mountain King
  'thunderbolt':      'AHtb',   // "Storm Bolt" in game
  'thunderclap':      'AHtc',
  // bash is passive
  'avatar':           'AHav',

  // Human - Paladin
  'holybolt':         'AHhb',   // "Holy Light" in game
  'divineshield':     'AHds',
  // devotion aura is passive
  'resurrection':     'AHre',

  // Human - Blood Mage
  'drain':            'AHdr',   // "Siphon Mana" in game
  'flamestrike':      'AHfs',
  'banish':           'AHbn',
  'summonphoenix':    'AHpx',

  // NE - Demon Hunter
  'manaburn':         'AEmb',
  'immolation':       'AEim',
  // evasion is passive
  'metamorphosis':    'AEme',

  // NE - Keeper of the Grove
  'entanglingroots':  'AEer',
  'forceofnature':    'AEfn',
  // thorns aura is passive
  'tranquility':      'AEtq',

  // NE - Priestess of the Moon
  'scout':            'AEst',
  'flamingarrowstarg':'AHfa',   // "Searing Arrows" in game (targeted toggle)
  // trueshot aura is passive
  'starfall':         'AEsf',

  // NE - Warden
  'blink':            'AEbl',
  'fanofknives':      'AEfk',
  'shadowstrike':     'AEsh',
  'spiritofvengeance':'AEsv',

  // Orc - Blademaster
  'windwalk':         'AOwk',
  'mirrorimage':      'AOmi',
  // critical strike is passive
  'whirlwind':        'AOww',   // "Bladestorm" in game

  // Orc - Far Seer
  'chainlightning':   'AOcl',
  'farsight':         'AOfs',
  'spiritwolf':       'AOsf',   // "Feral Spirit" in game
  'earthquake':       'AOeq',

  // Orc - Tauren Chieftain
  'shockwave':        'AOsh',
  // endurance aura is passive
  'stomp':            'AOws',   // "War Stomp" in game
  // reincarnation is passive

  // Orc - Shadow Hunter
  'healingwave':      'AOhw',
  'hex':              'AOhx',
  'ward':             'AOsw',   // "Serpent Ward" in game
  'voodoo':           'AOvd',   // "Big Bad Voodoo" in game

  // Undead - Death Knight
  'deathcoil':        'AUdc',
  'deathpact':        'AUdp',
  // unholy aura is passive
  'animatedead':      'AUan',

  // Undead - Dreadlord
  'carrionswarm':     'AUcs',
  'sleep':            'AUsl',
  // vampiric aura is passive
  'dreadlordinferno': 'AUin',

  // Undead - Lich
  'frostnova':        'AUfn',
  'frostarmor':       'AUfa',
  'darkritual':       'AUdr',
  'deathanddecay':    'AUdd',

  // Undead - Crypt Lord
  'impale':           'AUim',
  // spiked carapace is passive
  'carrionscarabs':   'AUcb',   // "Carrion Beetles" in game
  'locustswarm':      'AUls',

  // Neutral - Pandaren Brewmaster
  'breathoffire':     'ANbf',
  // drunken brawler is passive
  'drunkenhaze':      'ANdh',
  'elementalfury':    'ANef',   // "Storm Earth and Fire" in game

  // Neutral - Dark Ranger
  'silence':          'ANsi',
  'blackarrow':       'ANba',
  'charm':            'ANch',

  // Neutral - Naga Sea Witch
  'manashieldon':     'ANms',   // "Mana Shield" toggle on
  'coldarrowstarg':   'ANfa',   // "Frost Arrows" targeted
  'forkedlightning':  'ANfl',
  'tornado':          'ANto',

  // Neutral - Pit Lord
  'rainoffire':       'ANrf',
  // cleaving attack is passive
  'howlofterror':     'ANht',
  'doom':             'ANdo',

  // Neutral - Beastmaster
  'summongrizzly':    'ANsg',   // "Summon Bear"
  'summonquillbeast': 'ANsq',
  'summonwareagle':   'ANsw',   // "Summon Hawk"
  'stampede':         'ANst',

  // Neutral - Goblin Tinker
  'clusterrockets':   'ANcs',
  'summonfactory':    'ANsy',   // "Pocket Factory"
  'robogoblin':       'ANrg',

  // Neutral - Firelord
  'soulburn':         'ANso',
  'lavamonster':      'ANlm',   // "Summon Lava Spawn"
  'volcano':          'ANvc',
  'incineratearrow':  'ANic',   // "Incinerate" (targeted variant)

  // Neutral - Goblin Alchemist
  'acidbomb':         'ANab',
  'healingspray':     'ANhs',
  'chemicalrage':     'ANcr',
  'transmute':        'ANtm',

  // Neutral - Dark Ranger (Life Drain uses "drain" order but that's Blood Mage's Siphon Mana)
  // ANdr (Life Drain) shares order string "drain" with AHdr — the hero identity disambiguates

  // ── Autocast toggles ──
  // These use ":on"/":off" suffix to distinguish from regular casts.
  // Lich - Frost Armor
  'frostarmoron':       'AUfa:on',
  'frostarmoroff':      'AUfa:off',
  // Crypt Lord - Carrion Beetles
  'carrionscarabson':   'AUcb:on',
  'carrionscarabsoff':  'AUcb:off',
  // Dark Ranger - Black Arrow
  'blackarrowon':       'ANba:on',
  'blackarrowoff':      'ANba:off',
  // Firelord - Incinerate
  'incineratearrowon':  'ANic:on',
  'incineratearrowoff': 'ANic:off',

  // ── Toggle-off variants ──
  // The "ON" order is the regular cast already mapped above.
  // Demon Hunter - Immolation OFF
  'unimmolation':       'AEim:off',
  // Naga Sea Witch - Mana Shield OFF
  'manashieldoff':      'ANms:off',

  // ═══════════════════════════════════════════════
  // Non-hero unit abilities
  // Keys use U-prefix FourCC to avoid hero collisions
  // ═══════════════════════════════════════════════

  // ── Human - Priest ──
  'heal':               'Uhea',
  'healon':             'Uhea:on',
  'healoff':            'Uhea:off',
  'innerfire':          'Uifr',
  'innerfireon':        'Uifr:on',
  'innerfireoff':       'Uifr:off',
  'dispel':             'Udis',

  // ── Human - Sorceress ──
  'slow':               'Uslo',
  'slowon':             'Uslo:on',
  'slowoff':            'Uslo:off',
  'polymorph':          'Upol',
  'invisibility':       'Uinv',

  // ── Human - Spell Breaker ──
  'spellsteal':         'Usps',
  'spellstealon':       'Usps:on',
  'spellstealoff':      'Usps:off',
  'controlmagic':       'Ucmg',

  // ── Human - Mortar Team ──
  'flare':              'Ufla',

  // ── Human - Footman ──
  'defend':             'Udef',
  'undefend':           'Udef:off',

  // ── Orc - Shaman ──
  'bloodlust':          'Ublu',
  'bloodluston':        'Ublu:on',
  'bloodlustoff':       'Ublu:off',
  'purge':              'Upur',
  'lightningshield':    'Ulsh',

  // ── Orc - Witch Doctor ──
  'healingward':        'Uhww',
  'stasistrap':         'Ustt',
  'evileye':            'Usey',    // Sentry Ward

  // ── Orc - Spirit Walker ──
  'spiritlink':         'Uspl',
  'disenchant':         'Udec',
  'ancestralspirit':    'Uasp',
  'etherealform':       'Ueth',
  'unetherealform':     'Ueth:off',
  'corporealform':      'Ucor',
  'uncorporealform':    'Ucor:off',

  // ── Orc - Raider ──
  'ensnare':            'Uens',
  'ensnareon':          'Uens:on',
  'ensnareoff':         'Uens:off',

  // ── Orc - Kodo Beast ──
  'devour':             'Udev',

  // ── Orc - Berserker ──
  'berserk':            'Uber',

  // ── Night Elf - Druid of the Claw ──
  'roar':               'Uroa',
  'rejuvination':       'Urej',    // orders.c spells it "rejuvination"
  'bearform':           'Ubrf',
  'unbearform':         'Ubrf:off',

  // ── Night Elf - Druid of the Talon ──
  'faeriefire':         'Uffi',
  'faeriefireon':       'Uffi:on',
  'faeriefireoff':      'Uffi:off',
  'cyclone':            'Ucyc',
  'ravenform':          'Urvf',
  'unravenform':        'Urvf:off',

  // ── Night Elf - Dryad ──
  'autodispel':         'Uadp',
  'autodispelon':       'Uadp:on',
  'autodispeloff':      'Uadp:off',

  // ── Night Elf - Mountain Giant ──
  'taunt':              'Utau',

  // ── Night Elf - Huntress ──
  'sentinel':           'Usen',

  // ── Night Elf - Wisp ──
  'detonate':           'Udet',

  // ── Undead - Necromancer ──
  'raisedead':          'Ursd',
  'raisedeadon':        'Ursd:on',
  'raisedeadoff':       'Ursd:off',
  'unholyfrenzy':       'Uufr',
  'cripple':            'Ucrp',

  // ── Undead - Banshee ──
  'curse':              'Ucrs',
  'curseon':            'Ucrs:on',
  'curseoff':           'Ucrs:off',
  'antimagicshell':     'Uams',
  'possession':         'Upos',

  // ── Undead - Crypt Fiend ──
  'web':                'Uweb',
  'webon':              'Uweb:on',
  'weboff':             'Uweb:off',

  // ── Undead - Gargoyle ──
  'stoneform':          'Ustn',
  'unstoneform':        'Ustn:off',

  // ── Undead - Destroyer ──
  'devourmagic':        'Udvm',
  'absorb':             'Uabs',

  // ── Undead - Obsidian Statue ──
  // 'replenish' is the COMBINED button (toggles life+mana together); the game
  // also emits the two separate orders below depending on which the player hit.
  'replenish':          'Urep',
  'replenishon':        'Urep:on',
  'replenishoff':       'Urep:off',
  'replenishlife':      'Urlf',
  'replenishlifeon':    'Urlf:on',
  'replenishlifeoff':   'Urlf:off',
  'replenishmana':      'Urlm',
  'replenishmanaon':    'Urlm:on',
  'replenishmanaoff':   'Urlm:off',
  // Destroyer Form. The statue's internal name is "Obsidian Avenger" (see the
  // obsidianavenger*.wav assets), hence the order string. This is the ONLY
  // reliable signal that a statue morphed — the selection path catches it only
  // when the player happens to re-select the unit afterwards.
  'avengerform':        'Uavf',
  'unavengerform':      'Uavf:off',
};

function parseOrdersFile () {
  const raw = fs.readFileSync(path.join(DATA_DIR, 'orders.c'), 'utf8');
  const orders = {};

  for (const line of raw.split('\n')) {
    const match = line.match(/^(0x[0-9A-Fa-f]+),\s*"([^"]+)"/);
    if (!match) continue;

    const hex = parseInt(match[1], 16);
    const name = match[2];
    orders[name] = hex;
  }

  return orders;
}

function buildMapping () {
  const orders = parseOrdersFile();
  const result = {};
  let mapped = 0;
  let missing = 0;

  for (const [orderString, abilityId] of Object.entries(ORDER_TO_ABILITY)) {
    const orderId = orders[orderString];
    if (orderId === undefined) {
      console.warn(`WARNING: order string "${orderString}" not found in orders.c`);
      missing++;
      continue;
    }

    // Convert orderId to the 4-byte array format used by w3gjs
    // e.g., 0xD00FE → [254, 0, 13, 0]
    const byte0 = orderId & 0xFF;
    const byte1 = (orderId >> 8) & 0xFF;
    const byte2 = (orderId >> 16) & 0xFF;
    const byte3 = (orderId >> 24) & 0xFF;

    const key = `${byte0},${byte1},${byte2},${byte3}`;

    result[key] = abilityId;
    mapped++;
  }

  return { result, mapped, missing };
}

// Run
const { result, mapped, missing } = buildMapping();

fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));

console.log(`Generated ${OUTPUT}`);
console.log(`  ${mapped} spell order IDs mapped`);
if (missing > 0) {
  console.log(`  ${missing} order strings not found in orders.c`);
}

// Verify our test data
const deathCoilKey = '254,0,13,0';
const deathPactKey = '255,0,13,0';
console.log(`\nVerification:`);
console.log(`  Death Coil [254,0,13,0] → ${result[deathCoilKey] || 'NOT FOUND'}`);
console.log(`  Death Pact [255,0,13,0] → ${result[deathPactKey] || 'NOT FOUND'}`);
