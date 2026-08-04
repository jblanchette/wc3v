/**
 * Inspect raw WC3 SLK rows by unit/ability id — a read-only companion to the
 * extract-unit-*.js tools. Use it to check what the game data actually says
 * before "fixing" a derived JSON table.
 *
 * Usage:
 *   node tools/inspect-slk.js --file=units/unitweapons.slk --id=uobs,ubsp
 *   node tools/inspect-slk.js --file=units/unitdata.slk --id=uobs --cols=movetp,moveHeight
 *
 * --file is relative to tools/map-data/. --id matches the row's first key
 * column (unitID / abilID / alias). --cols filters the printed columns.
 */

const path = require('path');
const { parseSLK } = require('../helpers/slkParser');

function arg (name, fallback) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const file = arg('file');
const ids  = (arg('id') || '').split(',').map(s => s.trim()).filter(Boolean);
const cols = (arg('cols') || '').split(',').map(s => s.trim()).filter(Boolean);

if (!file || !ids.length) {
  console.log('usage: node tools/inspect-slk.js --file=units/unitweapons.slk --id=uobs[,ubsp] [--cols=a,b]');
  process.exit(1);
}

const slkPath = path.join(__dirname, 'map-data', file);
const data = parseSLK(slkPath);
const rows = data.rows || data;

// The id column varies per table (unitID, abilID, alias…). Find whichever
// column holds one of the requested ids.
const wanted = new Set(ids);
let idKey = null;
for (const row of rows) {
  for (const k of Object.keys(row)) {
    if (wanted.has(String(row[k]))) { idKey = k; break; }
  }
  if (idKey) break;
}

if (!idKey) {
  console.log(`no row matched ids [${ids.join(', ')}] in ${file}`);
  console.log('available columns:', Object.keys(rows[0] || {}).join(', '));
  process.exit(0);
}

console.log(`${file} — id column "${idKey}"\n`);

for (const id of ids) {
  const matches = rows.filter(r => String(r[idKey]) === id);
  if (!matches.length) { console.log(`${id}: NOT FOUND\n`); continue; }
  matches.forEach((row, i) => {
    console.log(`=== ${id}${matches.length > 1 ? ` [${i}]` : ''} ===`);
    const keys = cols.length ? cols : Object.keys(row);
    keys.forEach(k => {
      const v = row[k];
      if (v === undefined || v === null || v === '' || v === '-' || v === '_') return;
      console.log(`  ${k}: ${JSON.stringify(v)}`);
    });
    console.log('');
  });
}
