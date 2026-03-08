/**
 * Adds attackType field to UnitBalance.json for all units.
 * Attack types: normal, pierce, siege, magic, chaos, hero
 * Source: WC3 1.36 game data
 */
const fs = require('fs');
const path = require('path');

const balancePath = path.join(__dirname, '..', 'helpers', 'UnitBalance.json');
const data = JSON.parse(fs.readFileSync(balancePath, 'utf8'));

// Attack type mapping for all playable race units
// Key = itemId, Value = attackType
const attackTypes = {
  // === HUMAN ===
  hfoo: 'normal',     // Footman
  hrif: 'pierce',     // Rifleman
  hkni: 'normal',     // Knight
  hmpr: 'magic',      // Priest
  hsor: 'magic',      // Sorceress
  hmtm: 'siege',      // Mortar Team
  hgyr: 'pierce',     // Flying Machine
  hgry: 'magic',      // Gryphon Rider
  hspt: 'normal',     // Spell Breaker
  hdhw: 'pierce',     // Dragonhawk Rider
  hmil: 'normal',     // Militia
  hpea: 'normal',     // Peasant
  hphx: 'magic',      // Phoenix
  hpxe: null,         // Phoenix Egg (no attack)
  hwat: 'normal',     // Water Elemental
  hwt2: 'normal',     // Water Elemental 2
  hwt3: 'normal',     // Water Elemental 3

  // === ORC ===
  ogru: 'normal',     // Grunt
  ohun: 'pierce',     // Headhunter
  otbk: 'pierce',     // Berserker
  orai: 'normal',     // Raider
  okod: null,         // Kodo Beast (devour, no normal attack type - technically none)
  otau: 'normal',     // Tauren
  oshm: 'magic',      // Shaman
  odoc: 'magic',      // Witch Doctor
  ospw: 'magic',      // Spirit Walker
  ospm: 'magic',      // Spirit Walker (morph)
  otbr: 'pierce',     // Troll Batrider
  owyv: 'pierce',     // Wind Rider
  ocat: 'siege',      // Demolisher
  opeo: 'normal',     // Peon
  osw1: 'normal',     // Spirit Wolf 1
  osw2: 'normal',     // Spirit Wolf 2
  osw3: 'normal',     // Spirit Wolf 3

  // === NIGHT ELF ===
  earc: 'pierce',     // Archer
  ehun: 'normal',     // Huntress (not in balance? check esen)
  esen: 'normal',     // Huntress
  edoc: 'normal',     // Druid of the Claw
  edcm: 'normal',     // Druid of the Claw (bear)
  edot: 'magic',      // Druid of the Talon
  edtm: 'normal',     // Druid of the Talon (storm crow)
  edry: 'pierce',     // Dryad
  emtg: 'normal',     // Mountain Giant
  ehip: null,         // Hippogryph (no attack unmounted)
  ehpr: 'pierce',     // Hippogryph Rider
  echm: 'magic',      // Chimaera
  efdr: 'pierce',     // Faerie Dragon
  ebal: 'siege',      // Glaive Thrower
  ewsp: null,         // Wisp (no attack)
  efon: 'normal',     // Treant
  espv: 'normal',     // Spirit of Vengeance
  even: 'normal',     // Vengeance

  // === UNDEAD ===
  ugho: 'normal',     // Ghoul
  ucry: 'pierce',     // Crypt Fiend
  ucrm: 'pierce',     // Crypt Fiend (burrowed morph)
  uabo: 'normal',     // Abomination
  ugar: 'pierce',     // Gargoyle (air form)
  ugrm: 'normal',     // Gargoyle (ground/stone form)
  unec: 'magic',      // Necromancer
  uban: 'magic',      // Banshee
  umtw: 'siege',      // Meat Wagon
  uobs: null,         // Obsidian Statue (no attack, heals)
  ubsp: 'magic',      // Destroyer (spirit form)
  ufro: 'magic',      // Frost Wyrm
  uaco: 'normal',     // Acolyte
  uske: 'normal',     // Skeleton Warrior
  uskm: 'pierce',     // Skeletal Mage
  ucs1: 'normal',     // Carrion Scarab 1
  ucs2: 'normal',     // Carrion Scarab 2
  ucs3: 'normal',     // Carrion Scarab 3
  ushd: null,         // Shade (no attack)
  uplg: 'pierce',     // Plague Ward

  // === NEUTRAL HEROES SUMMONS ===
  nlv1: 'normal',     // Lava Spawn 1
  nlv2: 'normal',     // Lava Spawn 2
  nlv3: 'normal',     // Lava Spawn 3
  ndr1: 'normal',     // Dark Minion 1
  ndr2: 'normal',     // Dark Minion 2
  ndr3: 'normal',     // Dark Minion 3
  nsw1: 'normal',     // Spirit Beast 1
  nsw2: 'normal',     // Spirit Beast 2
  nsw3: 'normal',     // Spirit Beast 3
  ncgb: 'normal',     // Clockwerk Goblin 1
  ncg1: 'normal',     // Clockwerk Goblin 2
  ncg2: 'normal',     // Clockwerk Goblin 3
  ncg3: 'normal',     // Clockwerk Goblin 4
  nqb1: 'pierce',     // Quillbeast 1
  nqb2: 'pierce',     // Quillbeast 2
  nqb3: 'pierce',     // Quillbeast 3
  nqb4: 'pierce',     // Quillbeast 4
  nwe1: 'normal',     // War Eagle 1
  nwe2: 'normal',     // War Eagle 2
  nwe3: 'normal',     // War Eagle 3
  npn1: 'normal',     // Pandaren split fire
  npn2: 'normal',     // Pandaren split wind
  npn3: 'normal',     // Pandaren split earth
  npn4: 'normal',     // Pandaren split fire 2
  npn5: 'normal',     // Pandaren split wind 2
  npn6: 'normal',     // Pandaren split earth 2
  ngzc: 'normal',     // Misha 1
  ngzd: 'normal',     // Misha 2
  ngza: 'normal',     // Misha 3
  ngz4: 'normal',     // Misha 4
  ngz1: 'normal',     // Grizzly Bear 1
  ngz2: 'normal',     // Grizzly Bear 2
  ngz3: 'normal',     // Grizzly Bear 3

  // === TOWERS (that attack) ===
  hatw: 'magic',      // Arcane Tower
  hgtw: 'pierce',     // Guard Tower
  owtw: 'pierce',     // Watch Tower
};

let added = 0;
let skipped = 0;

Object.entries(data.output).forEach(([itemId, unit]) => {
  if (attackTypes[itemId] !== undefined) {
    unit.attackType = attackTypes[itemId];
    added++;
  }
});

fs.writeFileSync(balancePath, JSON.stringify(data, null, 2));
console.log(`Added attackType to ${added} units in UnitBalance.json`);
