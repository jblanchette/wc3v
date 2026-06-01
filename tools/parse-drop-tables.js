/**
 * parse-drop-tables.js — extract item drop pools from CASC itemdata.slk.
 *
 * WC3 random-item drops use virtual ID codes of the form Y{class}I{level}:
 *   Yi = Any (union of Permanent + Charged + PowerUp)
 *   Yj = Permanent class
 *   Yk = Charged class
 *   Yo = PowerUp class
 * Followed by `I{level}` where level ∈ 0..8 (item level, not creep level).
 *
 * Example: `YiI2` = random level-2 item of any class
 *          `YjI5` = random level-5 permanent item
 *
 * The game resolves these at runtime by filtering itemdata.slk where:
 *   - pickRandom === 1
 *   - class matches the requested class (or any pickRandom item for Yi)
 *   - Level matches
 *
 * This tool pre-computes those pools so the parser can surface the actual
 * candidate items (e.g. "Pendant of Mana, Periapt of Vitality, Ring of
 * Protection +1, Mantle of Intelligence +3, Slippers of Agility +3") for
 * a `YjI1` drop, instead of just saying "Random Lv1 Permanent".
 *
 * Output: helpers/dropTables.json. Re-run whenever WC3 patches add items.
 *
 * Inputs (extract via Ladik's CASC Viewer from war3.w3mod\Units\):
 *   - itemdata.slk
 *
 * Usage: node tools/parse-drop-tables.js
 */

const fs = require('fs');
const path = require('path');
const { parseSLK } = require('../helpers/slkParser');

const SOURCE_SLK = process.argv[2] ||
  'C:/Users/Jeff/Documents/casc/war3.w3mod/units/itemdata.slk';
const OUTPUT_JSON = path.join(__dirname, '..', 'helpers', 'dropTables.json');

const CLASS_LETTER = { Permanent: 'j', Charged: 'k', PowerUp: 'o' };
const ANY_CLASSES = new Set(['Permanent', 'Charged', 'PowerUp']);

function main () {
  if (!fs.existsSync(SOURCE_SLK)) {
    console.error('Cannot find itemdata.slk at:', SOURCE_SLK);
    process.exit(1);
  }

  const slk = parseSLK(SOURCE_SLK);
  console.log(`Loaded ${slk.rows.length} item rows from ${SOURCE_SLK}`);

  // Build per-item record with the fields we care about.
  // `comment` is WC3's editor-side friendly name (e.g. "Warsong Battle
  // Drums (Kodo)"); `scriptname` is a code-like form (e.g.
  // "WarsongBattleDrums2"). Both are kept for downstream consumers; the
  // mappings layer prefers `displayName` (comment) when picking what to
  // show to users.
  const items = {};
  for (const r of slk.rows) {
    if (!r.itemID) continue;
    items[r.itemID] = {
      itemId: r.itemID,
      displayName: r.comment || r.scriptname || r.itemID,
      scriptName: r.scriptname || r.itemID,
      class: r.class || null,
      level: typeof r.Level === 'number' ? r.Level : null,
      pickRandom: r.pickRandom === 1,
      goldCost: r.goldcost || 0,
      uses: typeof r.uses === 'number' ? r.uses : null
    };
  }

  // Build random-pool tables: { "YjI2": [itemId, ...], ... }
  const pools = {};
  const eligible = Object.values(items).filter(it => it.pickRandom);
  console.log(`${eligible.length} items have pickRandom=1`);

  // Per-class-letter, per-level
  for (const it of eligible) {
    if (!it.class || it.level == null) continue;
    const classLetter = CLASS_LETTER[it.class];
    if (classLetter) {
      const key = `Y${classLetter}I${it.level}`;
      if (!pools[key]) pools[key] = [];
      pools[key].push(it.itemId);
    }
    // Any-class pool (Yi) — union of Permanent + Charged + PowerUp
    if (ANY_CLASSES.has(it.class)) {
      const anyKey = `YiI${it.level}`;
      if (!pools[anyKey]) pools[anyKey] = [];
      pools[anyKey].push(it.itemId);
    }
  }

  // Sort each pool by itemId for deterministic output
  for (const k of Object.keys(pools)) pools[k].sort();

  const output = {
    _generated: new Date().toISOString(),
    _source: path.basename(SOURCE_SLK),
    items,
    pools
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2));
  console.log(`Wrote ${Object.keys(items).length} items and ${Object.keys(pools).length} pools to ${OUTPUT_JSON}`);

  // Print a few sample pools for sanity
  console.log('\nSample pools:');
  ['YiI1', 'YjI2', 'YkI3', 'YoI1', 'YiI5', 'YjI5'].forEach(k => {
    const pool = pools[k];
    if (!pool) return;
    console.log(`  ${k} (${pool.length} items): ${pool.slice(0, 5).join(', ')}${pool.length > 5 ? ', ...' : ''}`);
  });
}

main();
