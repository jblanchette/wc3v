/**
 * bootstrap-bcup-s22.js — One-shot helper for the B Cup S22 onboarding round:
 *   1. Adds 3 new build entries for openers we don't yet cover (Lich, PotM, Paladin)
 *   2. Expands ne-kotg-mountain-giant matchups so KotG games beyond EvH match
 *
 * Idempotent: skips builds that already exist; skips matchups already present.
 *
 * Usage:
 *   node tools/bootstrap-bcup-s22.js
 */

const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const NEW_BUILDS = [
  {
    id: 'ud-lich-fast-tech',
    name: 'Lich Fast Tech',
    race: 'U',
    matchups: ['UvH', 'UvU', 'UvO'],
    heroOpener: 'Lich',
    heroItemId: 'ulic',
    heroItemIds: ['ulic', 'udea'],
    keyUnits: ['ucry', 'uobs'],
    description: 'Lich first hero for early Frost Armor tankiness and Frost Nova burst. Slightly defensive opener that creeps with Ghouls and rushes T2 Crypt Fiends. DK as second hero anchors the army at level 6 with Death Coil sustain.',
    strategyPoints: [
      'Lich opener trades creep speed for early magic damage and Frost Armor on Ghouls — survives harassment better than DK first',
      'Frost Nova on tightly packed melee armies is a swing in midgame fights',
      'Skip aggressive level 6 timing — wait until DK is also at 6 to commit',
      'Statues at T2 sustain Lich mana for repeated Frost Nova casts',
      'Good vs HU Archmage Caster: Frost Armor blunts Sorceress Slow + Rifle damage',
      'Wins against: HU caster-heavy openers, slow tech UD mirrors',
      'Loses to: very fast Orc / NE timing pushes that punish slower tech'
    ],
    tags: ['tech', 'lich', 'fiends'],
    playstyleTags: ['tech', 'defensive'],
    opener: 'tech',
    gamePlan: 'tech-up',
    army: 'ground',
    tierProgression: {
      t1: { buildings: ['usep', 'ugrv', 'uaod', 'utom'], units: ['ucry'], goal: 'Lich + 4 Ghouls, creep efficiently with Frost Armor' },
      t2: { buildings: ['uslh'], units: ['ucry', 'uobs'], timing: '5:30-6:30', goal: 'DK second hero, Statues for sustain, transition into Fiends' },
      t3: { buildings: ['unpl'], units: ['ubsp'], timing: '9:00-10:00', goal: 'Orb of Corruption on DK, Destroyers if facing casters' }
    },
    replays: []
  },
  {
    id: 'ne-potm-mass-hunts',
    name: 'PotM Mass Huntress',
    race: 'E',
    matchups: ['EvH', 'EvE', 'EvO'],
    heroOpener: 'Priestess of the Moon',
    heroItemId: 'emoo',
    heroItemIds: ['emoo', 'edem', 'ekee'],
    keyUnits: ['ehnt', 'edry'],
    description: 'PotM first hero for Trueshot Aura damage boost and Searing Arrows hero harass. Mass Huntresses provide ranged DPS and Sentinel scout vision. Strong open-map control build.',
    strategyPoints: [
      'PotM Searing Arrows is a powerful early hero-harass tool — trade hits at any creep camp',
      'Trueshot Aura at level 3 buffs all ranged units permanently — Huntresses scale incredibly with it',
      'Sentinel Owl gives free vision at any tree line — abuse for scouting and creep timing',
      'Build Hunter\'s Hall after first Ancient of War — Moon Glaive upgrade is critical',
      'DH or KotG second hero — DH for harass continuation, KotG for Force of Nature wave',
      'Wins against: Human caster builds (range dominance), NE mirror with DH harass',
      'Loses to: AoE-heavy compositions (Mortar Teams, Destroyers, Frost Nova spam)'
    ],
    tags: ['huntress', 'potm', 'ranged'],
    playstyleTags: ['standard', 'map-control'],
    opener: 'standard',
    gamePlan: 'map-control',
    army: 'ranged',
    tierProgression: {
      t1: { buildings: ['etrp', 'eaoe', 'eaow', 'edob'], units: ['ehnt'], goal: 'PotM + 4-5 Huntresses, control creep camps with Owl scout' },
      t2: { buildings: ['etoa'], units: ['ehnt', 'edry'], timing: '5:00-5:30', goal: 'Hunter\'s Hall + Moon Glaive, second hero (DH or KotG), add Dryads' },
      t3: { buildings: ['etoe'], units: ['edot'], timing: '8:30-9:30', goal: 'Mountain Giants or Druids of the Talon as situation dictates' }
    },
    replays: []
  },
  {
    id: 'hu-paladin-rifle',
    name: 'Paladin Rifle',
    race: 'H',
    matchups: ['HvO', 'HvN', 'HvU'],
    heroOpener: 'Paladin',
    heroItemId: 'hpal',
    heroItemIds: ['hpal', 'hamg', 'hmkg'],
    keyUnits: ['hrif', 'hmpr'],
    description: 'Paladin first hero for Holy Light sustain on early Footmen. Tower up at base, mass Riflemen with Priest support. Defensive opener that scales into a powerful T2 ranged army.',
    strategyPoints: [
      'Holy Light keeps Footmen alive through early creeping and harass — pivotal at low levels',
      'Tower one or two Guard Towers at home before second peasant batch — discourages early aggression',
      'Riflemen production starts around 4:30 — keep all Barracks busy',
      'Priests with Inner Fire double-buff Riflemen damage; Heal sustains the front',
      'Archmage second hero for Brilliance Aura mana sustain on Priests',
      'Wins against: Orc Grunt builds (Holy Light + Towers), NE Bear timing pushes',
      'Loses to: aggressive caster magic (Frost Nova, Faerie Dragon mana burn)'
    ],
    tags: ['paladin', 'rifles', 'defensive'],
    playstyleTags: ['standard', 'defensive'],
    opener: 'defensive',
    gamePlan: 'turtle',
    army: 'ranged',
    tierProgression: {
      t1: { buildings: ['hbar', 'halt', 'hbla', 'hlum'], units: ['hfoo', 'hpea'], goal: 'Paladin + 3-4 Footmen, creep with Holy Light heals, tower at home' },
      t2: { buildings: ['hkee'], units: ['hrif', 'hmpr'], timing: '5:00-5:30', goal: 'Riflemen + Priest production, second hero (Archmage)' },
      t3: { buildings: ['hcas'], units: ['hgyr'], timing: '9:00-10:00', goal: 'Spell Breakers or Gryphons depending on opponent composition' }
    },
    replays: []
  }
];

let added = 0;
let skipped = 0;
const existingIds = new Set(manifest.builds.map(b => b.id));
for (const nb of NEW_BUILDS) {
  if (existingIds.has(nb.id)) {
    console.log(`skip: ${nb.id} already exists`);
    skipped++;
    continue;
  }
  manifest.builds.push(nb);
  console.log(`added: ${nb.id}`);
  added++;
}

// Expand ne-kotg-mountain-giant matchups
const kotgBuild = manifest.builds.find(b => b.id === 'ne-kotg-mountain-giant');
if (kotgBuild) {
  const want = ['EvH', 'EvO', 'EvU', 'EvE'];
  const before = kotgBuild.matchups.slice();
  for (const m of want) {
    if (!kotgBuild.matchups.includes(m)) kotgBuild.matchups.push(m);
  }
  if (kotgBuild.matchups.length !== before.length) {
    console.log(`expanded ne-kotg-mountain-giant matchups: [${before.join(',')}] → [${kotgBuild.matchups.join(',')}]`);
  } else {
    console.log(`ne-kotg-mountain-giant matchups already complete`);
  }
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log(`\nDone. ${added} new builds added, ${skipped} skipped.`);
