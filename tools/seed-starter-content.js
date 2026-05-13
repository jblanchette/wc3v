#!/usr/bin/env node
//
// seed-starter-content.js — one-shot: give every `new`-band build the beginner
// teaching fields the learner card layout renders:
//   beginnerNotes  : string[]                  "get this right first" guidance
//   commonMistakes : { mistake, fix }[]         what beginners get wrong + the fix
//   prerequisites  : string[]                   "be comfortable doing X" before this build
//
// Part of the "all skill levels" feature (Phase 2). Idempotent — re-running just
// re-asserts the TABLE below, so it's safe to edit the copy here and run it again.
// The copy is a DRAFT — review the WC3 specifics before treating it as gospel.
//
// Usage:
//   node tools/seed-starter-content.js            # apply
//   node tools/seed-starter-content.js --dry-run  # show what would change, write nothing
//
'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
const DRY = process.argv.includes('--dry-run');

// id → { beginnerNotes, commonMistakes, prerequisites }
const TABLE = {
  // ── Undead — DK Fiend Standard ──────────────────────────────────────────
  'udo-dk-fast-fiend': {
    beginnerNotes: [
      "Send your acolyte to summon all four T1 buildings, then send it straight back to gold. Undead acolytes summon and leave -- don't leave them standing at the site.",
      "Make Ghouls non-stop until you have ~5, then right-click 3-4 of them onto a tree. Ghouls are your lumber workers AND your early army -- pull them off lumber to creep or fight.",
      "Creep with the Death Knight toward level 3 as fast as is safe. Death Coil heals undead units and the DK -- top off whoever's lowest mid-creep; you should rarely lose a Ghoul.",
      "Don't worry about Statues, Destroyers, or T3 yet. Get to T2, build a Crypt, and start making Crypt Fiends. Everything past that is a bonus."
    ],
    commonMistakes: [
      { mistake: "Floating gold and lumber because you forgot to make Ghouls or click the T2 upgrade.", fix: "Keep Ghouls queued; the moment you have 5 Ghouls and the gold for T2, upgrade. Idle resources lose games." },
      { mistake: "Leaving the acolyte at the building site after it summons.", fix: "Undead buildings finish on their own -- the acolyte is free the instant the summon starts. Right-click it back onto gold." },
      { mistake: "Losing Ghouls while creeping because you didn't use Death Coil.", fix: "A dead Ghoul is also a dead lumber worker. Death Coil the lowest unit during the creep fight." },
      { mistake: "Teching straight to fancy units and getting no Crypt Fiends out.", fix: "Crypt Fiends + Statues is the standard army. Get that working first; only rush Destroyers if they go heavy on casters." }
    ],
    prerequisites: [
      "Comfortable hotkeying your hero and using Death Coil mid-fight.",
      "Know how to put a worker on lumber (right-click a tree) and pull it back off."
    ]
  },

  // ── Orc — BM Grunt Standard ─────────────────────────────────────────────
  'orc-bm-grunt-push': {
    beginnerNotes: [
      "Burrows are your food AND your defense -- you don't build Farms. When you're attacked, garrison 1-2 peons inside a Burrow; they shoot out of it.",
      "Make Grunts non-stop. They're cheap, tanky, and trade well in melee -- you don't need anything fancy at T1.",
      "Wind Walk the Blademaster into the enemy base for a worker kill or two while your Grunts creep. If you can't get in safely, just creep with the BM instead -- a level-3 BM is the goal either way.",
      "Don't rush T3 or Taurens. Get a Shadow Hunter as your second hero (Healing Wave keeps Grunts alive) and push at ~50-60 food. Most games end there."
    ],
    commonMistakes: [
      { mistake: "Building a Great Hall but not enough Burrows, then hitting the food cap and stalling production.", fix: "Build Burrows ahead of need. If you're not making units because you're food-blocked, you've already lost tempo." },
      { mistake: "Throwing the Blademaster into the enemy base and feeding him.", fix: "Wind Walk in, grab 1-2 worker kills, Wind Walk out. If their hero or army is home, don't commit -- a dead BM is a lost game." },
      { mistake: "A-moving Grunts into towers or Ancient Protectors.", fix: "If the front is fortified, don't force it. Take your expansion and out-produce them instead." },
      { mistake: "Forgetting attack/defense upgrades at the War Mill.", fix: "Melee Weapons / Unit Armor level 1 are cheap and huge for a Grunt line. Start them as soon as you can afford it." }
    ],
    prerequisites: [
      "Comfortable using Wind Walk to harass and to disengage.",
      "Know that Orc Burrows hold workers for defense and provide food (no Farms)."
    ]
  },

  // ── Human — AM Rifle ────────────────────────────────────────────────────
  'hu-am-rifle': {
    beginnerNotes: [
      "Peasants build on-site. Pull a peasant (or 2-3) off mining onto a building to finish it faster -- especially the Town Hall when rushing T2 -- then send them back to the mine.",
      "Summon Water Elementals with the Archmage at every fight and every creep camp. They're free, expendable units -- re-summon when they expire.",
      "Riflemen out-range everything on the ground at T1. Stand still, let them shoot, pull back wounded ones. Footmen tank; Rifles shoot -- don't a-move Rifles into melee.",
      "Get a Blacksmith early for attack/defense upgrades, and Priests (Inner Fire + Heal) once you're at T2. Don't worry about Knights or T3 for a long time -- Rifle + Priest wins most games on its own."
    ],
    commonMistakes: [
      { mistake: "Letting the Archmage's mana sit unused.", fix: "Brilliance Aura refills it constantly. Summon a Water Elemental, then Blizzard their army or workers -- unspent mana is damage you didn't do." },
      { mistake: "Riflemen melting in melee because you a-moved.", fix: "Position them, shoot from max range, and micro the front-line ones backward. Let your Footmen and Water Elementals soak the hits." },
      { mistake: "Getting all-in'd early with no Militia call.", fix: "Call to Arms turns your peasants into Militia for 45 seconds. Use it to survive an early rush, then send them back to mining." },
      { mistake: "Skipping Blacksmith upgrades.", fix: "+1 attack on a Rifle line is enormous. Get Iron Forged Swords / Iron Plating level 1 going as soon as the Blacksmith is up." }
    ],
    prerequisites: [
      "Comfortable summoning and re-summoning Water Elementals during fights.",
      "Know how to Call to Arms (Militia) to defend an early push and how to send peasants back to work."
    ]
  },

  // ── Night Elf — PotM Mass Huntress ──────────────────────────────────────
  'ne-potm-mass-hunts': {
    beginnerNotes: [
      "A wisp is consumed when it builds a regular building, but it's destroyed forever -- along with the food it would have made -- when it builds an Ancient. Don't over-build Ancients: usually one Ancient of War, a Hunter's Hall, and Moon Wells for food.",
      "Use Searing Arrows on the Priestess to harass at creep camps and poke their hero -- it's free extra damage. Sentinel (Owl) gives a free permanent scout in any treeline; plant them constantly.",
      "Make Huntresses non-stop from the Ancient of War, and build the Hunter's Hall early -- the Moon Glaive upgrade (Huntress attacks bounce to a second target) is the whole point of the build.",
      "Don't rush Bears, Mountain Giants, or T3. Huntress + Dryad under Trueshot Aura is a complete army. Get a second hero (Demon Hunter to keep harassing, or Keeper for the Force of Nature wave) and fight on the open map."
    ],
    commonMistakes: [
      { mistake: "Building too many Ancients and bleeding wisps and food.", fix: "Each Ancient eats a wisp permanently. Plan the build -- wisps are workers; don't waste them on Ancients you don't need." },
      { mistake: "Skipping or delaying Moon Glaive.", fix: "It nearly doubles a Huntress line's damage. Build the Hunter's Hall right after your first Ancient of War and start the upgrade -- this is the build's power spike." },
      { mistake: "Not using the Owl scout.", fix: "Sentinel is free, permanent vision in any treeline. Plant owls toward the enemy and at contested camps -- you should always know where their army is." },
      { mistake: "Fighting AoE armies (Mortars, Destroyers, Frost Nova) in a clump.", fix: "Huntresses melt to area damage. Spread out, mix in Dryads (Abolish Magic), and don't a-move into the splash." }
    ],
    prerequisites: [
      "Comfortable harassing with Searing Arrows and planting Owl scouts.",
      "Understand that wisps are consumed (regular building) or destroyed (Ancient) when they build -- so every building costs you a worker."
    ]
  },

  // ── Orc — Far Seer Headhunter (also shown in the New band) ──────────────
  'orc-fs-headhunter-shaman': {
    beginnerNotes: [
      "Far Seer opens -- Chain Lightning bounces between enemies (great vs clumped units and casters), and Far Sight reveals a chunk of the map for free scouting. Creep with him toward level 3.",
      "Make Headhunters non-stop from the Barracks. They're ranged, so position them, let them shoot, and pull wounded ones back -- don't a-move them into melee.",
      "Get the Berserker upgrade at the War Mill (Headhunter -> Berserker: more HP and damage), and start Melee/Ranged Weapons + Unit Armor level 1 early -- cheap and huge for the whole army.",
      "Shaman at T2 cast Bloodlust on your Headhunters (big attack-speed boost). Don't worry about Wind Riders, Taurens, or T3 yet -- Headhunter + Shaman with Bloodlust is a complete army."
    ],
    commonMistakes: [
      { mistake: "A-moving Headhunters into the enemy melee line.", fix: "They're fragile ranged units. Stand them at max range, attack, and micro the front ones backward -- let your hero and any Grunts soak the hits." },
      { mistake: "Forgetting the Berserker upgrade and attack/defense at the War Mill.", fix: "Berserker and Weapons/Armor level 1 are cheap and transformative. Queue them as soon as you can afford them." },
      { mistake: "Not casting Bloodlust in fights.", fix: "Bloodlusted Headhunters attack ~40% faster. Cast it on your damage dealers at the start of every engagement -- unspent Shaman mana is damage you didn't do." },
      { mistake: "Throwing the Far Seer in alone or wasting Chain Lightning.", fix: "Chain Lightning wants a clump (multiple enemy units close together) -- fire it then, not at a lone unit. Keep the FS behind the army; a dead hero is a lost game." }
    ],
    prerequisites: [
      "Comfortable positioning ranged units and pulling wounded ones back from the front.",
      "Know how to cast Chain Lightning into a clump and Bloodlust on your own damage dealers."
    ]
  },

  // ── Human — Archmage Caster (also shown in the New band) ────────────────
  'hu-am-caster': {
    beginnerNotes: [
      "A step up from the AM Rifle build -- same Archmage opener and Footman front line, but instead of Riflemen you tech into casters. Get comfortable with AM Rifle first if casters feel like a lot.",
      "Sorceress cast Slow on enemy melee and heroes (they attack and move much slower) -- it's the build's main micro tool. Priest cast Inner Fire on your Footmen (more armor + damage) and Heal to top units up between fights.",
      "Footmen tank at the front; casters and the Archmage stay behind. Summon a Water Elemental every fight and Blizzard clumped enemies or workers -- Brilliance Aura keeps the AM's mana topped up.",
      "Spell Breakers at T2 are huge vs summon- and caster-heavy enemies -- Control Magic steals summons (Treants, Skeletons, Water Elementals) and Spell Immunity makes them ignore Frost Nova, Bloodlust, Slow, etc."
    ],
    commonMistakes: [
      { mistake: "Casters dying because they're at the front.", fix: "Casters are made of paper. Footmen and the Water Elemental form the wall; Priests, Sorceresses, and the AM stand behind it. Pull a caster back the moment it's targeted." },
      { mistake: "Not casting Slow / Inner Fire / Heal in fights.", fix: "These spells are the whole point of the build. Slow the enemy's biggest threat, Inner Fire your Footmen, Heal the low ones -- idle caster mana wins nothing." },
      { mistake: "Skipping the Blacksmith upgrades.", fix: "Iron Forged Swords / Iron Plating level 1 on a Footman line is enormous, and Inner Fire stacks on top. Get them going as soon as the Blacksmith is up." },
      { mistake: "Forgetting Call to Arms when rushed early.", fix: "Militia (Call to Arms) turns your peasants into temporary fighters for 45 seconds -- use it to survive an early all-in, then send them back to mining." }
    ],
    prerequisites: [
      "Comfortable with the AM Rifle build first -- same opener, this one just adds caster micro.",
      "Know how to cast Slow, Inner Fire, and Heal mid-fight, and how to keep fragile casters behind your front line."
    ]
  },

  // ── Night Elf — Keeper of the Grove + Mountain Giants (also in New) ─────
  'ne-kotg-mountain-giant': {
    beginnerNotes: [
      "Keeper of the Grove opens -- Force of Nature spawns a wave of Treants (extra bodies for fights and creeping), Entangling Roots locks a target down. Creep with the KotG; Treant waves help you take camps fast.",
      "Mountain Giants are your tanks -- Hardened Skin shrugs off small hits, and Taunt forces enemies to attack the Giant. Put them at the front, Taunt the enemy army, and let everything else (Dryads, hero, Treants) shoot from behind.",
      "Build the Hunter's Hall and get the upgrades for your support -- Dryads with Abolish Magic dispel buffs and summons (and they're immune to magic). Don't rush a 3rd or 4th hero or exotic units; Giant + Dryad + Treants is a forgiving army.",
      "Wisps are consumed (regular building) or destroyed forever (Ancient) when they build -- plan your buildings so you're not bleeding workers. Mostly you want Moon Wells for food, an Ancient of War, an Ancient of Lore, and the Hunter's Hall."
    ],
    commonMistakes: [
      { mistake: "Not using Taunt on the Mountain Giant.", fix: "Taunt is the Giant's job -- pop it at the start of a fight so the enemy attacks the (very tanky) Giant instead of your Dryads and hero. A Giant that never Taunts is just a slow expensive unit." },
      { mistake: "Over-building Ancients and running out of wisps/food.", fix: "Every Ancient permanently eats a wisp. Decide your build up front -- wisps are workers; don't waste them on Ancients you don't need." },
      { mistake: "Letting Dryads or the Keeper get caught at the front.", fix: "Giants tank; everything else stands behind them. If a Dryad or your hero is taking focus, pull it back -- Treant waves are expendable, your hero isn't." },
      { mistake: "Skipping Abolish Magic and the Hunter's Hall upgrades.", fix: "Abolish Magic (Dryad dispel) is huge vs buff- and summon-heavy enemies, and the attack/armor upgrades scale your whole army. Don't neglect them." }
    ],
    prerequisites: [
      "Comfortable using Taunt on your Mountain Giant and Force of Nature / Entangling Roots on the Keeper.",
      "Understand that wisps are consumed or destroyed when they build (every building costs a worker)."
    ]
  },

  // ── Undead — Crypt Lord standard (also shown in the New band) ───────────
  'ud-cl-standard': {
    beginnerNotes: [
      "A natural 'second build' once you're comfortable with DK Fiend -- same Crypt-Fiend army, but a Crypt Lord hero instead of the Death Knight. Spiked Carapace gives the CL extra armor and reflects melee damage; Carrion Beetles spawn little minions from corpses.",
      "Same Undead worker rules: acolytes summon a building then leave (send them back to gold immediately), and Ghouls double as your lumber workers and early army -- pull them off lumber to creep or fight.",
      "Make Crypt Fiends non-stop from the Crypt at T2, and add Obsidian Statues for sustain (they heal units and restore caster mana -- and later turn into Destroyers vs casters). Research Web -- the Fiend's net pulls flying units down so your ground army can kill them.",
      "Use Impale in fights -- it's an AoE line that knocks enemies up and damages them (great vs clumped melee). Don't worry about Frost Wyrms or other T3 toys yet; Fiend + Statue with a Crypt Lord is a complete army."
    ],
    commonMistakes: [
      { mistake: "Leaving the acolyte standing at the building site after it summons.", fix: "Undead buildings finish on their own -- the acolyte is free the instant the summon starts. Right-click it back onto gold." },
      { mistake: "Floating gold/lumber instead of making Fiends or upgrading to T2.", fix: "Keep units queued; the moment you have the gold for T2, click it -- then Crypt Fiends non-stop. Idle resources lose games." },
      { mistake: "Not researching Web, and letting enemy air units fly over your Fiends.", fix: "Web pulls fliers to the ground where your Crypt Fiends shred them. Research it at the Crypt -- it's cheap and it's the Fiend's whole answer to air." },
      { mistake: "Wasting Impale on a single unit.", fix: "Impale is an AoE line -- fire it when several enemies are lined up or clumped, not at one straggler. Keep the Crypt Lord near the front so Spiked Carapace's damage return is actually doing something." }
    ],
    prerequisites: [
      "Comfortable with the DK Fiend build first -- this swaps the hero, the rest is the same.",
      "Know the Undead worker rhythm (acolyte summon-and-leave; Ghouls as lumber + army) and how to cast Impale into a clump."
    ]
  }
};

const PLACE_AFTER = 'strategyPoints'; // insert the new fields right after this key

function reorder(build, fields) {
  const NEW_KEYS = Object.keys(fields);
  const out = {};
  let inserted = false;
  for (const [k, v] of Object.entries(build)) {
    if (NEW_KEYS.includes(k)) continue; // drop old positions of the fields we manage
    out[k] = v;
    if (!inserted && k === PLACE_AFTER) {
      for (const nk of NEW_KEYS) out[nk] = fields[nk];
      inserted = true;
    }
  }
  if (!inserted) { for (const nk of NEW_KEYS) out[nk] = fields[nk]; }
  return out;
}

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
// A build appears in the New band if its level is `new` OR `alsoShownIn` lists it.
function inNewBand(b) { return b.level === 'new' || (Array.isArray(b.alsoShownIn) && b.alsoShownIn.includes('new')); }

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const builds = manifest.builds || [];
  let changed = 0;
  const missing = [];
  const notNew = [];

  manifest.builds = builds.map(b => {
    const fields = TABLE[b.id];
    if (!fields) return b;
    if (!inNewBand(b)) notNew.push(b.id);
    const already = ['beginnerNotes', 'commonMistakes', 'prerequisites'].every(k => eq(b[k], fields[k]));
    if (already) return b;
    changed++;
    console.log(`  ${b.id}: seeded ${Object.keys(fields).join(', ')}`);
    return reorder(b, fields);
  });

  for (const id of Object.keys(TABLE)) {
    if (!builds.some(b => b.id === id)) missing.push(id);
  }
  if (missing.length) console.warn(`\n⚠  not found in manifest: ${missing.join(', ')}`);
  if (notNew.length) console.warn(`\n⚠  seeded a build that isn't in the New band (level!=new and no alsoShownIn:["new"]): ${notNew.join(', ')} (intended?)`);

  // Coverage report: anything that appears in the New band but lacks the
  // teaching copy will render a bare learner card.
  const bare = manifest.builds.filter(b => inNewBand(b) && !(Array.isArray(b.beginnerNotes) && b.beginnerNotes.length));
  if (bare.length) console.warn(`\n⚠  New-band builds without beginnerNotes: ${bare.map(b => b.id).join(', ')}`);
  console.log(`\nNew-band builds with teaching content: ${manifest.builds.filter(b => inNewBand(b) && Array.isArray(b.beginnerNotes) && b.beginnerNotes.length).length} of ${manifest.builds.filter(inNewBand).length}`);

  if (DRY) { console.log(`\n(dry run — ${changed} build(s) would change, nothing written)`); return; }
  if (changed === 0 && !missing.length) { console.log('\nNothing to do — manifest already up to date.'); return; }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n✔  Wrote ${MANIFEST} (${changed} build(s) updated).`);
}

main();
