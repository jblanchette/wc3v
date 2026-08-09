/**
 * Survey extracted WC3 missile models and report what is ACTUALLY in them.
 *
 * WHY THIS EXISTS
 * ---------------
 * The viewer draws every ranged attack as one generic streak sprite. Swapping in
 * each unit's real missile art only helps for missiles that have solid geometry.
 * A large share of WC3 missiles are ParticleEmitter2 / RibbonEmitter only — a
 * FireBallMissile is a particle system with no mesh at all — and those convert to
 * an EMPTY glTF, exactly as the water elemental and wisp did during the unit
 * batch export.
 *
 * So "will real missile art look better" is a measurable question, and this
 * answers it BEFORE anyone writes a converter. Run it once the models are
 * extracted; it prints the geometry-vs-particle split and names which units are
 * stuck on the sprite fallback either way.
 *
 * GETTING THE MODELS (a manual step — CASC needs Ladik's CascView)
 *   1. Open C:\Program Files (x86)\Warcraft III\ in CascView
 *   2. Extract the whole folder  war3.w3mod\Abilities\Weapons\
 *      → tools/map-data/abilities/weapons/
 *   3. Also the three spell missiles listed by
 *      `node tools/list-casc-extractions.js` (section 7)
 *   4. Run this.
 * Note the data files say ".mdl"; CASC stores ".mdx". Extract the .mdx.
 *
 * Usage:
 *   node tools/survey-missile-models.js
 *   node tools/survey-missile-models.js --dir=some/other/path
 *   node tools/survey-missile-models.js --referenced  (ONLY models a real unit
 *                                        actually fires — the number that matters)
 *   node tools/survey-missile-models.js --selftest   (validate against unit models)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { parseMDX } = require('war3-model');
const { stripMDXChunks } = require('./lib/mdx-skin');

const args = {};
process.argv.slice(2).forEach(r => {
  const [f, ...v] = r.replace(/^--/, '').split('=');
  args[f] = v.join('=') || true;
});

const MISSILE_DIR = args.dir
  ? path.resolve(args.dir)
  : path.join(__dirname, 'map-data', 'abilities');
const UNITS_DIR = path.join(__dirname, 'map-data', 'units');

// A geoset with only a handful of verts is a billboard quad or a glow sprite,
// not a body — treating those as "real geometry" would over-promise the payoff.
const MIN_REAL_VERTS = 24;

function analyse (file) {
  const buf = fs.readFileSync(file);
  const ab = stripMDXChunks(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), ['LITE']);
  const m = parseMDX(ab);

  const geosets = m.Geosets || [];
  let verts = 0, realGeosets = 0;
  for (const g of geosets) {
    const n = (g.Vertices ? g.Vertices.length / 3 : 0) | 0;
    verts += n;
    if (n >= MIN_REAL_VERTS) realGeosets++;
  }
  const pe = (m.ParticleEmitters2 || []).length + (m.ParticleEmitters || []).length;
  const rib = (m.RibbonEmitters || []).length;

  let verdict;
  if (realGeosets > 0) verdict = pe + rib > 0 ? 'MIXED' : 'GEOMETRY';
  else if (pe + rib > 0) verdict = 'PARTICLE-ONLY';
  else if (verts > 0) verdict = 'TINY-QUAD';
  else verdict = 'EMPTY';

  return {
    name: path.basename(file, path.extname(file)),
    geosets: geosets.length, realGeosets, verts, pe, rib,
    seqs: (m.Sequences || []).length,
    textures: (m.Textures || []).map(t => t.Image).filter(Boolean),
    verdict
  };
}

function walk (dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.mdx$/i.test(e.name)) out.push(full);
  }
  return out;
}

// --- selftest: prove the analyser against models we already have -------------
if (args.selftest) {
  const picks = ['footman', 'ghoul', 'heroarchmage'];
  console.log('Selftest — these are UNIT models, all of which must read as GEOMETRY:\n');
  let ok = 0;
  for (const p of picks) {
    const found = walk(UNITS_DIR, []).find(f =>
      path.basename(f, '.mdx').toLowerCase() === p);
    if (!found) { console.log(`  ? ${p} — not on disk`); continue; }
    const a = analyse(found);
    const pass = a.verdict === 'GEOMETRY' || a.verdict === 'MIXED';
    if (pass) ok++;
    console.log(`  ${pass ? '✓' : '✗'} ${a.name.padEnd(16)} ${a.verdict.padEnd(14)}` +
      ` geosets ${a.realGeosets}/${a.geosets}  verts ${a.verts}  pe ${a.pe}  ribbon ${a.rib}`);
  }
  console.log(`\n${ok}/${picks.length} passed`);
  process.exit(ok === picks.length ? 0 : 1);
}

/**
 * The models some real unit actually fires, keyed by lowercase basename, mapped
 * to the units that use them. The weapons folder holds plenty of campaign and
 * cut content nobody shoots, so surveying all of it overstates the work AND
 * understates the hit rate.
 */
function referencedBasenames () {
  const proj = require(path.join(__dirname, '..', 'helpers', 'unitProjectiles.json'));
  const byBase = new Map();
  const add = (art, id) => {
    if (!art) return;
    const base = path.basename(String(art).replace(/\\/g, '/')).replace(/\.mdl$/i, '').toLowerCase();
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(id);
  };
  for (const id in proj.units) {
    add(proj.units[id].art, id);
    if (proj.units[id].weapon2) add(proj.units[id].weapon2.art, id);
  }
  return byBase;
}

// --- main --------------------------------------------------------------------
let files = walk(MISSILE_DIR, []);

let refMap = null;
if (args.referenced) {
  refMap = referencedBasenames();
  const before = files.length;
  files = files.filter(f => refMap.has(path.basename(f, path.extname(f)).toLowerCase()));
  const found = new Set(files.map(f => path.basename(f, path.extname(f)).toLowerCase()));
  const missing = [...refMap.keys()].filter(b => !found.has(b));
  console.log(`Referenced by a real unit: ${refMap.size} distinct models.`);
  console.log(`  found on disk: ${files.length}   (skipped ${before - files.length} unreferenced models in the folder)`);
  if (missing.length) {
    console.log(`  NOT FOUND (${missing.length}) — likely under Abilities\\Spells\\ or not extracted:`);
    for (const m of missing) console.log('    ' + m);
  }
  console.log('');
}
if (!files.length) {
  console.log('No .mdx found under ' + MISSILE_DIR);
  console.log('');
  console.log('The missile models are not extracted yet. See the header of this file,');
  console.log('or run: node tools/list-casc-extractions.js   (section 7)');
  process.exit(1);
}

const rows = files.map(analyse).sort((a, b) =>
  a.verdict.localeCompare(b.verdict) || b.verts - a.verts);

const counts = {};
for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;

console.log(`Surveyed ${rows.length} missile models under ${path.relative(process.cwd(), MISSILE_DIR)}\n`);
console.log('  MODEL                                VERDICT        GEOSETS  VERTS   PE  RIB');
console.log('  ' + '-'.repeat(84));
for (const r of rows) {
  const users = refMap ? (refMap.get(r.name.toLowerCase()) || []) : null;
  console.log('  ' + r.name.slice(0, 34).padEnd(36) + r.verdict.padEnd(15) +
    String(r.realGeosets + '/' + r.geosets).padEnd(9) +
    String(r.verts).padEnd(8) + String(r.pe).padEnd(5) + String(r.rib).padEnd(5) +
    (users ? users.slice(0, 4).join(',') + (users.length > 4 ? ' +' + (users.length - 4) : '') : ''));
}

console.log('\n  ' + '-'.repeat(84));
console.log('  VERDICT SPLIT');
for (const k of Object.keys(counts).sort()) {
  console.log('    ' + k.padEnd(16) + counts[k] +
    '  (' + ((counts[k] / rows.length) * 100).toFixed(0) + '%)');
}

const worth = (counts.GEOMETRY || 0) + (counts.MIXED || 0);
console.log('');
console.log('  ' + worth + ' of ' + rows.length + ' models have real geometry and would render as ' +
  'a distinct missile.');
console.log('  The rest need either the generic sprite (what ships today) or a ' +
  'ParticleEmitter2 port,');
console.log('  which is its own project — see the spell/art notes in ' +
  '~/.claude/plans/we-are-going-to-snoopy-goose.md');

// Textures worth extracting alongside, for the sprite-fallback upgrade: even a
// particle-only missile has a texture, and using it beats one generic streak.
const tex = new Set();
for (const r of rows) for (const t of r.textures) tex.add(t);
if (tex.size) {
  console.log('');
  console.log('  ' + tex.size + ' distinct textures referenced (extract these from war3.w3mod\\Textures\\');
  console.log('  for the sprite fallback — a particle-only missile still has its own art):');
  for (const t of [...tex].sort()) console.log('    ' + t);
}
