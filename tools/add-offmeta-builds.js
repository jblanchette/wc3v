#!/usr/bin/env node
//
// add-offmeta-builds.js — one-shot: add the first two `pro-off-meta` builds.
//
// Both were found by tools/build-meta-evidence.js --gaps, which reports hero
// openers no manifest build covers. Warden and Dark Ranger were the two largest
// holes in the library and neither had ANY build behind it.
//
// The mechanical fields (keyUnits, tier buildings, timing windows, heroSkills,
// coreUpgrades, replays) come from tools/scaffold-build.js over the parsed pro
// corpus. Two things were corrected by hand afterwards, because the scaffolder
// is honest about not knowing them:
//   - Dryads were bucketed to T3 (they appeared late in the games that teched
//     that far). They are a Tier-2 unit; lint-manifest.js would flag it.
//   - The tier-upgrade buildings etoa / etoe are not "built" in the parse the
//     way a barracks is, so the scaffolder never sees them. The house
//     convention lists them (see ne-dh-fast-bear).
//   - coreUpgrades was trimmed from everything-researched down to the ones the
//     build actually turns on.
//
// Both land as `pro-off-meta`: real pro play, not the current standard. Warden
// has tournament footage behind it (Jens x2, Life vs Sok, Kaho vs TH000); Dark
// Ranger is nine pro-ladder games from five players, which is exactly what
// off-meta looks like — a handful of specialists running something unusual.
//
// Idempotent: re-running replaces the two entries rather than duplicating them.
//
// Usage:
//   node tools/add-offmeta-builds.js [--dry-run]
//
'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
const DRY = process.argv.includes('--dry-run');

const BUILDS = [
  {
    id: 'ne-warden-expand',
    name: 'Warden Fast Expand',
    race: 'E',
    matchups: ['EvH', 'EvU'],
    buildClass: 'pro-off-meta',
    level: 'pro',
    difficulty: 'hard',
    heroOpener: 'Warden',
    heroItemId: 'Ewar',
    heroItemIds: ['Ewar', 'Npbm'],
    keyUnits: ['earc', 'edry'],
    description:
      'Warden first — she is the cheapest hero Night Elf can field, so the gold saved goes ' +
      'straight into an early expansion. Across the pro games behind this build she is out at ' +
      '1:07 every time, Tier 2 lands around 3:03-3:42, and five of six games take a second ' +
      'base at 5:03-6:13. Fan of Knives and Blink are both maxed: Fan clears creep camps and ' +
      'punishes clumped armies, Blink gets her out of the trouble a squishy hero finds. The ' +
      'army is Archers into Dryads, so Abolish Magic answers casters while the expansion pays off.',
    strategyPoints: [
      'Warden at 1:07 — she costs less than any other Night Elf hero, and the saved gold is what funds the early expansion',
      'Tier 2 at 3:03-3:42, then Ancient of Lore for Dryads',
      'Expand at 5:03-6:13 — five of the six pro games behind this build took a second base in that window',
      'Max Fan of Knives and Blink. Fan is your creep clear and your answer to a clumped army; Blink is how a 500-HP hero survives being focused',
      'Dryads with Abolish Magic are the reason this holds up against Human casters and Undead Destroyers',
      'The risk is the hero: Warden dies fast if she is caught out of position, and the expansion is undefended while you are creeping'
    ],
    tags: ['warden', 'expansion', 'archers', 'dryads'],
    playstyleTags: ['macro-expand', 'ranged'],
    opener: 'expand',
    gamePlan: 'economic',
    army: 'ranged',
    tierProgression: {
      t1: {
        // Hunter's Hall and Ancient of Wonders are both Tier-1 buildings; the
        // scaffolder bucketed them by when they FIRST appeared, which was after
        // the Tree of Ages in these games. lint-manifest.js flags that.
        buildings: ['eate', 'eaom', 'emow', 'eden', 'edob'],
        units: ['earc'],
        goal: 'Warden out at 1:07, Archers behind her, creep with Fan of Knives'
      },
      t2: {
        buildings: ['etoa', 'eaoe'],
        units: ['edry'],
        timing: '3:03-3:42',
        goal: 'Tree of Ages then Ancient of Lore for Dryads; expansion goes down at 5:03-6:13'
      },
      t3: {
        buildings: ['etoe'],
        units: [],
        timing: '6:34-8:40',
        goal: 'Only the games that were already ahead reached Tier 3 — this build wins or loses on the expansion',
        notes: 'Two of six games got here. Treat T3 as a reward for a safe expansion, not a plan'
      },
      conditionalBranches: [
        {
          condition: 'Opponent pressures the expansion before it pays off',
          adjustment: 'Skip the second base, keep Warden home and add Moon Wells behind the Archers'
        },
        {
          condition: 'Facing heavy casters (HU Priest/Sorceress, UD Destroyer)',
          adjustment: 'More Dryads — Abolish Magic is the whole answer, and it is already researched'
        }
      ]
    },
    heroSkills: {
      ewar: { AEfk: 3, AEbl: 3, AEsv: 1, AEsh: 1 }
    },
    coreUpgrades: ['Resm', 'Rerh', 'Resi'],
    replays: [
      { replayId: '1220213506_Sheik_Jens_Northern-Isles-13', playerSlot: '3', playerName: 'Jens', opponentName: 'Sheik', map: 'Northern Isles 1.3', outcome: '', notes: '', tournamentId: 'welcome-to-jens-jungle', provenance: 'pro-tournament' },
      { replayId: '1786380038_Life_Sok_Tidehunters-12', playerSlot: '1', playerName: 'Life', opponentName: 'Sok', map: 'Tidehunters 1.2', outcome: '', notes: '', tournamentId: 'showmatch-life-vs-sok-10th-aug-2026', provenance: 'pro-tournament' },
      { replayId: '1906283315_Chaemiko_Jens_Northern-Isles-13', playerSlot: '3', playerName: 'Jens', opponentName: 'Chaemiko', map: 'Northern Isles 1.3', outcome: '', notes: '', tournamentId: 'welcome-to-jens-jungle', provenance: 'pro-tournament' },
      { replayId: '65056574_TH000_Kaho_NorthernIsles', playerSlot: '2', playerName: 'Kaho', opponentName: 'TH000', map: '4_w3c_251104_0950_NorthernIsles.w3x', outcome: '', notes: '', tournamentId: '', provenance: 'pro-tournament' },
      { replayId: '1024196334_Evanescence_Trof_Twisted-Meadows-11', playerSlot: '1', playerName: 'Evanescence', opponentName: 'Trof', map: 'Twisted Meadows 1.1', outcome: '', notes: '', tournamentId: '', provenance: 'pro-ladder' },
      { replayId: '2616750095_Evanescence_Kas_Northern-Isles-13', playerSlot: '1', playerName: 'Evanescence', opponentName: 'Kas', map: 'Northern Isles 1.3', outcome: '', notes: '', tournamentId: '', provenance: 'pro-ladder' }
    ]
  },

  {
    id: 'ne-dr-tavern-hunts',
    name: 'Dark Ranger Huntress',
    race: 'E',
    matchups: ['EvH', 'EvO', 'EvU', 'EvE'],
    buildClass: 'pro-off-meta',
    level: 'pro',
    difficulty: 'hard',
    heroOpener: 'Dark Ranger',
    heroItemId: 'Nbrn',
    heroItemIds: ['Nbrn', 'Nplh'],
    keyUnits: ['earc', 'esen'],
    description:
      'Skip the Altar and hire a Dark Ranger from the Tavern instead. Every game behind this ' +
      'build does it at the same moment — 2:15 to 2:19, without exception — which is what ' +
      'separates it from a desperation pick. Black Arrow turns every creep and every kill into ' +
      'a free skeleton, so the hero creeps faster than the gold she cost. Archers and Huntresses ' +
      'carry the fight while six of nine games expand between 3:19 and 4:54. Five players ran ' +
      'these nine games, which is the honest shape of an off-meta build: a small group who have ' +
      'the timing memorised.',
    strategyPoints: [
      'Tavern Dark Ranger at 2:15 — the timing is identical across all nine pro games, this is a rehearsed opening and not an improvisation',
      'Black Arrow first: every creep you kill leaves a skeleton, so the hero snowballs camps without needing your army',
      'Archers into Huntresses, with Moon Glaive and Improved Bows as the upgrades that matter',
      'Six of nine games expand at 3:19-4:54, behind the map presence the free skeletons buy you',
      'Second hero is whatever the Tavern offers — Pit Lord, Naga Sea Witch and Blademaster all appear in these games',
      'The cost is real: no Altar means no hero revive early, and a dead Dark Ranger is gone until you build one'
    ],
    tags: ['dark-ranger', 'tavern', 'huntress', 'archers'],
    playstyleTags: ['map-control', 'ranged'],
    opener: 'expand',
    gamePlan: 'map-control',
    army: 'ranged',
    tierProgression: {
      t1: {
        buildings: ['eaom', 'eate', 'edob', 'emow', 'eden'],
        units: ['earc', 'esen'],
        goal: 'Tavern Dark Ranger at 2:15, Archers behind her, Black Arrow every camp'
      },
      t2: {
        buildings: ['etoa', 'eaoe'],
        units: ['esen'],
        timing: '2:55-4:58',
        goal: 'Moon Glaive for the Huntresses, expansion at 3:19-4:54, second Tavern hero when gold allows'
      },
      t3: {
        buildings: ['etoe'],
        units: [],
        timing: '7:01-12:57',
        goal: 'Rarely reached and very spread out — these games are decided long before Tier 3',
        notes: 'The 7:01-12:57 spread is the tell: nobody is teching on a plan, they get there if the game runs long'
      },
      conditionalBranches: [
        {
          condition: 'Dark Ranger dies early',
          adjustment: 'You have no Altar. Build one and play a normal Archer game — do not try to re-buy the tempo'
        },
        {
          condition: 'Facing Undead',
          adjustment: 'Black Arrow skeletons are worth less into a race that raises its own; lean on the Huntress count instead'
        }
      ]
    },
    heroSkills: {
      nbrn: { ANba: 3, ANsi: 1, ANdr: 1, ANch: 0 }
    },
    coreUpgrades: ['Resm', 'Reib', 'Remg'],
    replays: [
      { replayId: '2528549581_Sonik_Deathnote_Northern-Isles-13', playerSlot: '1', playerName: 'Sonik', opponentName: 'Deathnote', map: 'Northern Isles 1.3', outcome: '', notes: '', tournamentId: '', provenance: 'pro-ladder' },
      { replayId: '3133992358_Tekko_LiiLD.C_Springtime-14', playerSlot: '2', playerName: 'LiiLD.C', opponentName: 'Tekko', map: 'Springtime 1.4', outcome: '', notes: '', tournamentId: '', provenance: 'pro-ladder' },
      { replayId: '2634928242_MrLogical_Sonik_Twisted-Meadows-11', playerSlot: '2', playerName: 'Sonik', opponentName: 'MrLogical', map: 'Twisted Meadows 1.1', outcome: '', notes: '', tournamentId: '', provenance: 'pro-ladder' },
      { replayId: '193163855_SoYma_PhoeNix_Springtime-14', playerSlot: '2', playerName: 'PhoeNix', opponentName: 'SoYma', map: 'Springtime 1.4', outcome: '', notes: '', tournamentId: '', provenance: 'pro-ladder' },
      { replayId: '2536006299_Starbuck_LiiLD.C_Turtle-Rock-20', playerSlot: '2', playerName: 'LiiLD.C', opponentName: 'Starbuck', map: 'Turtle Rock 2.0', outcome: '', notes: '', tournamentId: '', provenance: 'pro-ladder' },
      { replayId: '1340933251_Fhra_Starshaped_Springtime-14', playerSlot: '2', playerName: 'Starshaped', opponentName: 'Fhra', map: 'Springtime 1.4', outcome: '', notes: '', tournamentId: '', provenance: 'pro-ladder' },
      { replayId: '3887060540_Sonik_Edo_Hammerfall', playerSlot: '1', playerName: 'Sonik', opponentName: 'Edo', map: 'Hammerfall', outcome: '', notes: '', tournamentId: '', provenance: 'pro-ladder' },
      { replayId: '1044730018_LiiLD.C_Cloud-American-player-_Springtime-14', playerSlot: '1', playerName: 'LiiLD.C', opponentName: 'Cloud (American player)', map: 'Springtime 1.4', outcome: '', notes: '', tournamentId: '', provenance: 'pro-ladder' },
      { replayId: '514201718_SoYma_Bazukafit_Scrimmage', playerSlot: '2', playerName: 'Bazukafit', opponentName: 'SoYma', map: 'Scrimmage', outcome: '', notes: '', tournamentId: '', provenance: 'pro-ladder' }
    ]
  }
];

function main () {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const builds = manifest.builds || [];
  let added = 0, replaced = 0;

  for (const nb of BUILDS) {
    const i = builds.findIndex((b) => b.id === nb.id);
    if (i === -1) { builds.push(nb); added += 1; console.log(`  + ${nb.id}  ${nb.name}`); }
    else { builds[i] = nb; replaced += 1; console.log(`  ~ ${nb.id}  ${nb.name} (replaced)`); }
  }

  manifest.builds = builds;
  console.log(`\n${added} added, ${replaced} replaced, ${builds.length} builds total`);

  const missing = [];
  for (const nb of BUILDS) {
    for (const r of nb.replays) {
      const p = path.join(__dirname, '..', 'client', 'replays', r.replayId + '.wc3v.gz');
      if (!fs.existsSync(p)) missing.push(r.replayId);
    }
  }
  if (missing.length) {
    console.warn(`\n⚠  ${missing.length} replay(s) not parsed on disk — the card will 404 on Watch:`);
    missing.forEach((m) => console.warn(`     ${m}`));
  }

  if (DRY) { console.log('\n(dry run — nothing written)'); return; }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n✔  Wrote ${MANIFEST}`);
  console.log('Next: add both ids to the TABLE in tools/backfill-classes.js, then:');
  console.log('  node tools/lint-manifest.js && npm run build:site');
}

main();
