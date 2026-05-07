/**
 * refine-builds.js — One-shot accuracy pass on builds-manifest.json:
 *   1. Fix UD builds where Crypt Fiend (T2) was listed as the T1 unit
 *   2. Add T1 opener units to keyUnits across all builds (visibility on cards)
 *   3. Fix one strategyPoint sentence that called T1 "Fiend T1"
 *   4. Add a new ud-cl-standard build (Crypt Lord opener, broad matchups)
 *   5. Drop ud-cl-fiend-push from the wishlist (replaced by ud-cl-standard)
 *
 * Idempotent: changes that already match are left alone.
 *
 * Usage:
 *   node tools/refine-builds.js
 */

const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
const wishlistPath = path.join(__dirname, '..', 'client', 'data', 'replay-wishlist.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const wishlist = JSON.parse(fs.readFileSync(wishlistPath, 'utf8'));

const log = [];

// ---- 1. Tier-correctness: t1.units ----
// Crypt Fiend (`ucry`) is T2. Three UD builds had it at T1.
const t1UnitsFixes = {
  'udo-dk-fast-fiend': ['ugho'],
  'ud-dk-destroyer':   ['ugho'],
  'ud-lich-fast-tech': ['ugho'],
};
for (const [id, want] of Object.entries(t1UnitsFixes)) {
  const b = manifest.builds.find(x => x.id === id);
  if (!b) continue;
  const t1 = b.tierProgression && b.tierProgression.t1;
  if (!t1) continue;
  const before = JSON.stringify(t1.units);
  if (before !== JSON.stringify(want)) {
    t1.units = want;
    log.push(`${id}: t1.units ${before} → ${JSON.stringify(want)}`);
  }
}

// ---- 2. t1.goal text fixes ----
const t1GoalFixes = {
  'udo-dk-fast-fiend': 'DK + 4-5 Ghouls, creep to level 3',
  'ud-dk-destroyer':   'DK + 4-5 Ghouls, aggressive creep',
};
for (const [id, want] of Object.entries(t1GoalFixes)) {
  const b = manifest.builds.find(x => x.id === id);
  const t1 = b && b.tierProgression && b.tierProgression.t1;
  if (!t1) continue;
  if (t1.goal !== want) {
    log.push(`${id}: t1.goal "${t1.goal}" → "${want}"`);
    t1.goal = want;
  }
}

// ---- 3. keyUnits: add T1 opener for visibility on cards ----
// Each entry: build id → desired keyUnits ordering (T1 opener first, strategic units after).
const keyUnitFixes = {
  // UD: Ghoul opener
  'udo-dk-fast-fiend':         ['ugho','ucry'],
  'ud-dk-destroyer':           ['ugho','ucry','ubsp'],
  'ud-dk-mass-gargoyle':       ['ugho','ugar','uobs'],
  'ud-lich-fast-tech':         ['ugho','ucry','uobs'],
  // Orc: Grunt opener for BM builds (FS fast-tech leaves as-is)
  'orc-bm-wind-rider':         ['ogru','owyv'],
  // HU: Footman opener
  'hu-am-rifle':               ['hfoo','hrif','hsor'],
  'hu-mk-fast-expand':         ['hfoo','hrif'],          // reorder so opener is first
  'hu-paladin-rifle':          ['hfoo','hrif','hmpr'],
  // NE: Archer opener
  'ne-kotg-mountain-giant':    ['earc','emtg'],
  'ne-dh-fast-bear':           ['earc','edoc','edry'],
  'ne-dh-mass-talons':         ['earc','edot'],
  'ne-potm-mass-hunts':        ['earc','ehnt','edry'],
};
for (const [id, want] of Object.entries(keyUnitFixes)) {
  const b = manifest.builds.find(x => x.id === id);
  if (!b) continue;
  const before = JSON.stringify(b.keyUnits);
  const after = JSON.stringify(want);
  if (before !== after) {
    b.keyUnits = want;
    log.push(`${id}: keyUnits ${before} → ${after}`);
  }
}

// ---- 4. strategyPoint fix: ud-dk-destroyer first bullet ----
const dkDestroyer = manifest.builds.find(b => b.id === 'ud-dk-destroyer');
if (dkDestroyer && dkDestroyer.strategyPoints) {
  const bad = 'Standard DK Fiend T1 — creep efficiently, build 4-5 Fiends before teching';
  const fixed = 'Standard DK Ghoul T1 — creep efficiently, build 4-5 Ghouls before teching to Fiends at T2';
  for (let i = 0; i < dkDestroyer.strategyPoints.length; i++) {
    if (dkDestroyer.strategyPoints[i].includes('DK Fiend T1')) {
      log.push(`ud-dk-destroyer: strategyPoints[${i}] rewritten`);
      dkDestroyer.strategyPoints[i] = fixed;
    }
  }
}

// ---- 5. Add ud-cl-standard build ----
if (!manifest.builds.find(b => b.id === 'ud-cl-standard')) {
  const cl = {
    id: 'ud-cl-standard',
    name: 'Crypt Lord Standard',
    race: 'U',
    matchups: ['UvH', 'UvN', 'UvO'],
    heroOpener: 'Crypt Lord',
    heroItemId: 'ucrl',
    heroItemIds: ['ucrl', 'udea'],
    keyUnits: ['ugho', 'ucry'],
    description: 'Crypt Lord first hero for Carrion Beetles map presence and Impale stun. Ghoul opener like other UD builds, transitions to Crypt Fiends and Statues at T2. Strong vs Night Elf Bears (Impale shuts down DPS) and Human casters (CL tankiness in the front line).',
    strategyPoints: [
      'Carrion Beetles are free creeping units — produce off cooldown, let them tank camps',
      'Spiked Carapace at level 2 — CL becomes the front-line tank, takes Footman/Grunt focus fire',
      'Level 6 Impale stun is decisive on grouped enemy heroes — wait until T2 fight to commit',
      'DK second hero for Death Coil sustain on CL between fights',
      'Statues at T2 keep Beetles + Fiends sustained for repeated engagements',
      'Wins against: NE Bear timing pushes (Impale on bears), HU caster compositions',
      'Loses to: very fast Orc harass that prevents creeping CL to level 3+'
    ],
    tags: ['crypt-lord', 'fiends', 'tank'],
    playstyleTags: ['standard', 'tank'],
    opener: 'standard',
    gamePlan: 'map-control',
    army: 'ground',
    tierProgression: {
      t1: { buildings: ['usep', 'ugrv', 'uaod', 'utom'], units: ['ugho'], goal: 'CL + 3-4 Ghouls, creep aggressively with Beetles' },
      t2: { buildings: ['uslh'], units: ['ucry', 'uobs'], timing: '5:30-6:30', goal: 'DK second hero, Fiend transition, Statues for sustain' },
      t3: { buildings: ['unpl'], units: ['ubsp'], timing: '8:30-9:30', goal: 'Orb of Corruption on DK, Destroyers if facing casters' },
      conditionalBranches: [
        { condition: 'Vs NE Demon Hunter timing push', adjustment: 'Skip Orb, push out with CL+DK level 6 + Fiends before Bears' },
        { condition: 'Vs HU caster (Sorceress + Priest)', adjustment: 'Rush Destroyers to Devour Magic — Sleep on CL is otherwise lethal' }
      ]
    },
    replays: [
      {
        replayId: '2926718387_Lucifer_Leon_NorthernIsles',
        playerSlot: '1',
        playerName: 'Lucifer',
        opponentName: 'LeonXIV',
        map: 'NorthernIsles',
        outcome: '',
        notes: '',
        tournamentId: 'bcup-s22'
      }
    ]
  };
  manifest.builds.push(cl);
  log.push('added new build: ud-cl-standard (Crypt Lord, UvH/UvN/UvO, 1 replay)');
}

// ---- 6. Wishlist: drop ud-cl-fiend-push (replaced by ud-cl-standard) ----
const wishBefore = wishlist.length;
const newWishlist = wishlist.filter(w => w.buildId !== 'ud-cl-fiend-push');
if (newWishlist.length !== wishBefore) {
  log.push(`wishlist: removed ud-cl-fiend-push (${wishBefore} → ${newWishlist.length} entries)`);
}

// ---- write back ----
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
fs.writeFileSync(wishlistPath, JSON.stringify(newWishlist, null, 2) + '\n', 'utf8');

console.log(log.length ? log.map(l => '  ' + l).join('\n') : '  (no changes)');
console.log(`\n${log.length} change(s) applied.`);
