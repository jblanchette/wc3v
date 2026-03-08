/*
  Parses UpgradeData.slk and {race}UpgradeFunc.txt files
  to generate helpers/researchMeta.json

  Usage: node tools/parse-upgrade-data.js
*/

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'upgrade-data');
const OUTPUT = path.join(__dirname, '..', 'helpers', 'researchMeta.json');

// Display name overrides (SLK comments are terse internal names)
const DISPLAY_NAMES = {
  // Human - attack/defense
  'Rhme': 'Melee Weapons',
  'Rhra': 'Ranged Weapons',
  'Rhar': 'Plating',
  'Rhla': 'Leather Armor',
  'Rhac': 'Masonry',
  // Human - abilities
  'Rhlh': 'Lumber Harvesting',
  'Rhde': 'Defend',
  'Rhpt': 'Priest Training',
  'Rhst': 'Sorceress Training',
  'Rhss': 'Control Magic',
  'Rhfc': 'Flak Cannons',
  'Rhfs': 'Fragmentation Shards',
  'Rhse': 'Magic Sentry',
  'Rhan': 'Animal War Training',
  'Rhri': 'Long Rifles',
  'Rhcd': 'Cloud',
  'Rhrt': 'Barrage',
  'Rhfl': 'Flare',
  'Rhhb': 'Storm Hammers',
  'Rhgb': 'Flying Machine Bombs',
  'Rhsb': 'Sundering Blades',

  // Orc - attack/defense
  'Rome': 'Melee Weapons',
  'Rora': 'Ranged Weapons',
  'Roar': 'Unit Armor',
  // Orc - abilities
  'Ropg': 'Pillage',
  'Roen': 'Ensnare',
  'Robk': 'Berserker Upgrade',
  'Robs': 'Berserker Strength',
  'Rotr': 'Troll Regeneration',
  'Rost': 'Shaman Training',
  'Rowd': 'Witch Doctor Training',
  'Rowt': 'Spirit Walker Training',
  'Rosp': 'Spiked Barricades',
  'Rorb': 'Reinforced Defenses',
  'Robf': 'Burning Oil',
  'Rolf': 'Liquid Fire',
  'Rows': 'Pulverize',
  'Rovs': 'Envenomed Spears',
  'Rwdm': 'War Drums',
  'Roch': 'Chaos',

  // Night Elf - attack/defense
  'Resm': 'Strength of the Moon',
  'Resw': 'Strength of the Wild',
  'Rema': 'Moon Armor',
  'Rerh': 'Reinforced Hides',
  // Night Elf - abilities
  'Reib': 'Improved Bows',
  'Remk': 'Marksmanship',
  'Remg': 'Moon Glaive',
  'Repb': 'Vorpal Blades',
  'Redc': 'Druid of the Claw Training',
  'Redt': 'Druid of the Talon Training',
  'Resi': 'Abolish Magic',
  'Reht': 'Hippogryph Taming',
  'Renb': "Nature's Blessing",
  'Reuv': 'Ultravision',
  'Rews': 'Well Spring',
  'Recb': 'Corrosive Breath',
  'Rehs': 'Hardened Skin',
  'Rers': 'Resistant Skin',
  'Reeb': 'Mark of the Claw',
  'Reec': 'Mark of the Talon',
  'Resc': 'Sentinel',
  'Rei':  'Improved Bows',

  // Undead - attack/defense
  'Rume': 'Unholy Strength',
  'Rura': 'Creature Attack',
  'Ruar': 'Unholy Armor',
  'Rucr': 'Creature Carapace',
  // Undead - abilities
  'Ruac': 'Cannibalize',
  'Rugf': 'Ghoul Frenzy',
  'Rune': 'Necromancer Training',
  'Ruba': 'Banshee Training',
  'Rubu': 'Burrow',
  'Ruex': 'Exhume Corpses',
  'Rusf': 'Stone Form',
  'Rusp': 'Destroyer Form',
  'Rusl': 'Skeletal Longevity',
  'Rufb': 'Freezing Breath',
  'Ruwb': 'Web',
  'Rupc': 'Plague Cloud',
  'Rusm': 'Skeletal Mastery',
};

// ---- SLK Parser ----

function parseSLK (text) {
  const rows = {};
  let curRow = 1;
  let curCol = 1;

  const lines = text.split(/\r?\n/);
  // Row 1 = headers
  const headers = {};

  for (const line of lines) {
    if (!line.startsWith('C;')) continue;

    const parts = line.split(';').slice(1);
    let x = curCol, y = curRow, value = null;

    for (const p of parts) {
      if (p.startsWith('X')) x = parseInt(p.slice(1));
      if (p.startsWith('Y')) y = parseInt(p.slice(1));
      if (p.startsWith('K')) {
        value = p.slice(1);
        // strip quotes
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else {
          const num = Number(value);
          if (!isNaN(num)) value = num;
        }
      }
    }

    curCol = x;
    curRow = y;

    if (y === 1) {
      headers[x] = value;
    } else {
      if (!rows[y]) rows[y] = {};
      rows[y][headers[x]] = value;
    }
  }

  return Object.values(rows);
}

// ---- UpgradeFunc INI parser ----

function parseUpgradeFunc (text) {
  const result = {};
  let currentId = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    const idMatch = trimmed.match(/^\[(\w+)\]$/);
    if (idMatch) {
      currentId = idMatch[1];
      result[currentId] = {};
      continue;
    }

    if (currentId) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        result[currentId][key] = val;
      }
    }
  }

  return result;
}

// ---- Category classification ----

function classifyCategory (slkClass, itemId) {
  if (slkClass === 'melee' || slkClass === 'ranged') return 'attack';
  if (slkClass === 'armor') return 'defense';
  return 'ability';
}

// ---- Extract icon filenames from Art path ----

function extractIcons (artString) {
  if (!artString) return [];
  return artString.split(',').map(p => {
    // Get just the filename without extension, lowercased
    const filename = p.trim().split('\\').pop().replace(/\.blp$/i, '').toLowerCase();
    return filename;
  });
}

// ---- Compute per-level costs from base + mod ----

function computeLevelCosts (base, mod, maxLevel) {
  const costs = [];
  for (let i = 0; i < maxLevel; i++) {
    costs.push(base + (mod * i));
  }
  return costs;
}

// ---- Main ----

function main () {
  // Parse SLK
  const slkText = fs.readFileSync(path.join(DATA_DIR, 'upgradedata.slk'), 'utf8');
  const slkRows = parseSLK(slkText);

  // Parse UpgradeFunc files
  const funcFiles = ['humanupgradefunc.txt', 'orcupgradefunc.txt', 'nightelfupgradefunc.txt', 'undeadupgradefunc.txt'];
  const allFuncs = {};
  for (const f of funcFiles) {
    const fpath = path.join(DATA_DIR, f);
    if (fs.existsSync(fpath)) {
      Object.assign(allFuncs, parseUpgradeFunc(fs.readFileSync(fpath, 'utf8')));
    }
  }

  // Build output
  const output = {};

  for (const row of slkRows) {
    const id = row.upgradeid;
    if (!id || id === '_') continue;
    if (row.used === 0) continue; // unused upgrades

    const race = row.race || 'other';
    const slkClass = row.class || '_';
    const maxLevel = row.maxlevel || 1;
    const category = classifyCategory(slkClass, id);

    const goldBase = row.goldbase || 0;
    const goldMod = row.goldmod || 0;
    const lumberBase = row.lumberbase || 0;
    const lumberMod = row.lumbermod || 0;
    const timeBase = row.timebase || 0;
    const timeMod = row.timemod || 0;

    const funcData = allFuncs[id] || {};
    const icons = extractIcons(funcData.Art);

    const name = DISPLAY_NAMES[id] || row.comments || id;

    output[id] = {
      name,
      race,
      category,
      maxLevel,
      icons,
      gold: computeLevelCosts(goldBase, goldMod, maxLevel),
      lumber: computeLevelCosts(lumberBase, lumberMod, maxLevel),
      time: computeLevelCosts(timeBase, timeMod, maxLevel)
    };
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
  console.log(`Written ${Object.keys(output).length} upgrades to ${OUTPUT}`);

  // Print summary
  const categories = { attack: 0, defense: 0, ability: 0 };
  for (const entry of Object.values(output)) {
    categories[entry.category]++;
  }
  console.log(`Categories: attack=${categories.attack}, defense=${categories.defense}, ability=${categories.ability}`);
}

main();
