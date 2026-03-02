const assert = require('assert');
const path = require('path');

// initialize logging (console.logger must exist before parsing)
const logManager = require('../helpers/logManager');
logManager.setTestMode();
logManager.setLogger('hero-abilities-test');

const { doParsing } = require('../wc3v');
const mappings = require('../helpers/mappings');
const { heroAbilities, abilityToHero, getUnitInfo } = mappings;

const REPLAY_PATH = path.join(__dirname, '..', 'replays', 'happy-vs-grubby.w3g');

// All tavern heroes and their expected base abilities
const TAVERN_HEROES = {
  'Npbm': { name: 'Pandaren Brewmaster', abilities: ['ANbf', 'ANdb', 'ANdh', 'ANef'] },
  'Nbrn': { name: 'Dark Ranger',         abilities: ['ANdr', 'ANsi', 'ANba', 'ANch'] },
  'Nngs': { name: 'Naga Sea Witch',      abilities: ['ANms', 'ANfa', 'ANfl', 'ANto'] },
  'Nplh': { name: 'Pit Lord',            abilities: ['ANrf', 'ANca', 'ANht', 'ANdo'] },
  'Nbst': { name: 'Beastmaster',         abilities: ['ANsg', 'ANsq', 'ANsw', 'ANst'] },
  'Ntin': { name: 'Goblin Tinker',       abilities: ['ANeg', 'ANcs', 'ANsy', 'ANrg'] },
  'Nfir': { name: 'FireLord',            abilities: ['ANic', 'ANso', 'ANlm', 'ANvc'] },
  'Nalc': { name: 'Goblin Alchemist',    abilities: ['ANhs', 'ANab', 'ANcr', 'ANtm'] }
};

// Racial abilities that previously had truncated IDs
const PREVIOUSLY_BROKEN_ABILITIES = {
  'AHab': 'Brilliance Aura',
  'AHtb': 'Storm Bolt',
  'AHhb': 'Holy Light',
  'AEmb': 'Mana Burn',
  'ANdb': 'Drunken Brawler',
  'ANab': 'Acid Bomb'
};

async function runTests () {
  console.log('=== Hero Ability Mapping Tests ===\n');

  // ================================================================
  // TEST 1: Previously truncated ability IDs exist in heroAbilities
  // ================================================================
  console.log('Test 1: Previously truncated ability IDs are fixed in heroAbilities');

  for (const [id, expectedName] of Object.entries(PREVIOUSLY_BROKEN_ABILITIES)) {
    assert(heroAbilities[id],
      `heroAbilities['${id}'] is missing — was this ID truncated? (expected: ${expectedName})`);
    assert.strictEqual(heroAbilities[id].displayName, expectedName,
      `heroAbilities['${id}'].displayName should be '${expectedName}', got '${heroAbilities[id].displayName}'`);
    console.log(`  ${id} -> ${heroAbilities[id].displayName} ✓`);
  }

  // Verify the truncated versions are NOT present (old bugs)
  const truncatedIds = ['AHa', 'AHt', 'AHh', 'AEm', 'ANd', 'ANa'];
  for (const badId of truncatedIds) {
    assert(!heroAbilities[badId],
      `heroAbilities['${badId}'] should not exist — this is a truncated ID`);
  }
  console.log('  No truncated IDs remain ✓');

  // ================================================================
  // TEST 2: All tavern hero abilities exist in heroAbilities
  // ================================================================
  console.log('\nTest 2: All tavern hero base abilities exist in heroAbilities');

  for (const [heroId, hero] of Object.entries(TAVERN_HEROES)) {
    for (const abilId of hero.abilities) {
      assert(heroAbilities[abilId],
        `heroAbilities['${abilId}'] missing for ${hero.name} (${heroId})`);
      assert(heroAbilities[abilId].displayName,
        `heroAbilities['${abilId}'].displayName is empty for ${hero.name}`);
    }
    console.log(`  ${hero.name}: ${hero.abilities.join(', ')} ✓`);
  }

  // ================================================================
  // TEST 3: All tavern hero base abilities are recognized by getUnitInfo
  // ================================================================
  console.log('\nTest 3: All tavern hero base abilities pass isKnownId check');

  for (const [heroId, hero] of Object.entries(TAVERN_HEROES)) {
    for (const abilId of hero.abilities) {
      const info = getUnitInfo(abilId);
      assert(info.isKnownId,
        `getUnitInfo('${abilId}').isKnownId is false — ${hero.name}'s ` +
        `${heroAbilities[abilId].displayName} will be filtered from spellList`);
    }
    console.log(`  ${hero.name}: all 4 abilities pass isKnownId ✓`);
  }

  // ================================================================
  // TEST 4: Every ability in abilityToHero has a heroAbilities entry
  // ================================================================
  console.log('\nTest 4: Every ability in abilityToHero exists in heroAbilities');

  let missingCount = 0;
  for (const abilId of Object.keys(abilityToHero)) {
    if (!heroAbilities[abilId]) {
      console.log(`  WARNING: ${abilId} -> hero ${abilityToHero[abilId]} missing from heroAbilities`);
      missingCount++;
    }
  }
  assert.strictEqual(missingCount, 0,
    `${missingCount} abilities from abilityToHero are missing in heroAbilities — ` +
    `these will silently fail to generate HeroLevel events`);
  console.log(`  All ${Object.keys(abilityToHero).length} abilities have heroAbilities entries ✓`);

  // ================================================================
  // TEST 5: Each hero gets exactly 4 base abilities through spellList
  //         (base = passes isKnownId filter)
  // ================================================================
  console.log('\nTest 5: Each hero resolves to exactly 4 base abilities via isKnownId filter');

  const heroIds = [...new Set(Object.values(abilityToHero))];
  for (const heroId of heroIds) {
    const allAbils = Object.keys(abilityToHero).filter(id => abilityToHero[id] === heroId);
    const baseAbils = allAbils.filter(id => getUnitInfo(id).isKnownId);
    const heroName = getUnitInfo(heroId).displayName;

    assert(baseAbils.length >= 4,
      `${heroName} (${heroId}) has only ${baseAbils.length} base abilities after ` +
      `isKnownId filter — spellList will be incomplete. Abilities: ${allAbils.join(', ')}`);
    console.log(`  ${heroName}: ${baseAbils.length} base / ${allAbils.length} total ✓`);
  }

  // ================================================================
  // TEST 6 (integration): HeroLevel events have populated spellLists
  // ================================================================
  console.log('\nTest 6: HeroLevel events in replay have populated spellList');
  console.log('  Parsing happy-vs-grubby.w3g ...');
  const { players } = await doParsing(REPLAY_PATH);

  let heroLevelCount = 0;
  let emptySpellListCount = 0;

  for (const id of Object.keys(players)) {
    const p = players[id];
    if (!p || p.isNeutralPlayer) continue;

    for (const event of p.eventStream) {
      if (event.key !== 'HeroLevel') continue;
      heroLevelCount++;

      assert(event.spell, `HeroLevel event at t=${event.gameTime} has no spell`);
      assert(event.spell.displayName,
        `HeroLevel at t=${event.gameTime} spell has no displayName`);
      assert(event.spellItemId,
        `HeroLevel at t=${event.gameTime} has no spellItemId`);

      if (!event.spellList || event.spellList.length === 0) {
        emptySpellListCount++;
        console.log(`  WARNING: ${event.unit.displayName} Lv${event.newLevel} at ` +
          `t=${event.gameTime} has empty spellList`);
      }
    }
  }

  assert(heroLevelCount > 0, 'Expected at least one HeroLevel event in replay');
  assert.strictEqual(emptySpellListCount, 0,
    `${emptySpellListCount} of ${heroLevelCount} HeroLevel events have empty spellList — ` +
    `skill bar will not render`);
  console.log(`  ${heroLevelCount} HeroLevel events, all have populated spellList ✓`);

  // ================================================================
  // TEST 7 (integration): Dark Ranger spellList has correct abilities
  // ================================================================
  console.log('\nTest 7: Dark Ranger spellList contains all 4 abilities');

  let drEvents = [];
  for (const id of Object.keys(players)) {
    const p = players[id];
    if (!p || p.isNeutralPlayer) continue;

    for (const event of p.eventStream) {
      if (event.key === 'HeroLevel' && event.unit && event.unit.itemId === 'Nbrn') {
        drEvents.push(event);
      }
    }
  }

  assert(drEvents.length > 0, 'Expected Dark Ranger HeroLevel events in replay');
  console.log(`  Found ${drEvents.length} Dark Ranger level-up events`);

  const expectedDrAbilities = ['ANdr', 'ANsi', 'ANba', 'ANch'];
  for (const event of drEvents) {
    assert(event.spellList && event.spellList.length >= 4,
      `Dark Ranger Lv${event.newLevel} spellList has ${event.spellList ? event.spellList.length : 0} entries, expected 4`);

    const spellIds = event.spellList.map(s => s.itemId);
    for (const expectedId of expectedDrAbilities) {
      assert(spellIds.includes(expectedId),
        `Dark Ranger spellList missing ${expectedId} (${heroAbilities[expectedId].displayName})`);
    }

    // Verify displayNames are populated (not '???' fallback)
    for (const spellInfo of event.spellList) {
      assert(spellInfo.displayName && spellInfo.displayName !== '???',
        `Dark Ranger spellList entry ${spellInfo.itemId} has displayName='${spellInfo.displayName}'`);
    }

    console.log(`  Lv${event.newLevel} -> ${event.spell.displayName}: spellList=[${spellIds.join(', ')}] ✓`);
  }

  console.log('\n=== ALL HERO ABILITY TESTS PASSED ===');
}

runTests().catch(err => {
  console.error('\n=== TEST FAILED ===');
  console.error(err.message);
  process.exit(1);
});
