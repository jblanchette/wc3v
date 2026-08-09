/**
 * Extract game-authoritative MODEL SCALE into helpers/modelScale.json.
 *
 * THE FIELD TRAP (this tool exists because we read the wrong one for months):
 *
 * tools/map-data/units/unitmetadata.slk defines two different scale fields, and
 * the Reforged skin files expose both under confusingly similar names:
 *
 *   usca -> field "modelScale"  = WESTRING_UEVAL_USCA = Art - Scaling Value
 *                                 the real geometry multiplier, range 0.1-10
 *   ussc -> field "scale"       = WESTRING_UEVAL_USSC = Art - Selection Scale
 *                                 the SELECTION CIRCLE size, range 0.1-20
 *
 * `scale` is not geometry. The Castle (hcas) is `scale=6.3, modelScale=1`, and
 * its model is already 497 world units tall against a 12-cell (384wu) footprint
 * — applying 6.3 would make a town hall seventeen tiles wide. Meanwhile the
 * Tree of Life / Ages / Eternity all share one MDX with an identical scale=4.75
 * and differ ONLY in modelScale (1.0 / 1.15 / 1.3).
 *
 * MDX geometry is authored at final world size and our GLBs bake it at scale 1,
 * so the render multiplier is `modelScale` ALONE. Anything else double-counts.
 *
 * Outputs a reviewable intermediate rather than writing straight into the GLB
 * manifest, so the numbers can be diffed and argued with.
 *
 * Sources:
 *   tools/map-data/units/unitskin.txt      units + buildings (INI, not SLK)
 *   tools/map-data/doodads/doodadskins.txt doodads (defScale / fixedRot)
 *   tools/map-data/units/destructableskin.txt destructables (fixedRot; scale is
 *                                          per-instance in war3map.doo)
 *
 * Usage:
 *   node tools/extract-model-scale.js
 *   node tools/extract-model-scale.js --check    # report only, write nothing
 */
const fs = require('fs');
const path = require('path');

const UNITS_DIR = path.join(__dirname, 'map-data', 'units');
const DOODADS_DIR = path.join(__dirname, 'map-data', 'doodads');
const OUT_PATH = path.join(__dirname, '..', 'helpers', 'modelScale.json');
// Client-side companion: only the doodad/destructable types that actually differ
// from the defaults, so the viewer fetches ~1KB instead of a 568-entry table.
const CLIENT_DOODAD_PATH = path.join(__dirname, '..', 'client', 'assets', 'models', 'doodad-scales.json');

const checkOnly = process.argv.includes('--check');

// Minimal INI reader for the Reforged skin .txt files. Same shape as the parsers
// in convert-mdx-to-gltf-skinned.js / patch-model-scale.js — slkParser cannot
// read these (they are INI, despite living beside the SLKs).
function parseINI (file) {
  const sections = {};
  let current = null;
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('[') && t.endsWith(']')) {
      current = t.slice(1, -1).replace(/^﻿/, '');
      sections[current] = sections[current] || {};
    } else if (current && t.includes('=')) {
      const eq = t.indexOf('=');
      sections[current][t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
  }
  return sections;
}

function num (v, dflt) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}

// Our GLBs come from the SD models (the converter prefers `file` / `file:sd`),
// so the SD variant of a split field is the one that applies.
function sdFirst (fields, base) {
  return num(fields[base + ':sd'], num(fields[base], null));
}

function extractUnits () {
  const skin = parseINI(path.join(UNITS_DIR, 'unitskin.txt'));
  const out = {};
  let noScale = 0;
  for (const [id, f] of Object.entries(skin)) {
    if (!f.file && !f['file:sd'] && !f['file:hd']) continue;   // not a rendered thing
    const modelScale = sdFirst(f, 'modelScale');
    const selectionScale = sdFirst(f, 'scale');
    if (modelScale == null) noScale++;
    const artPath = (f.file || f['file:sd'] || '').replace(/\\/g, '/');
    out[id] = {
      // The render multiplier. Default 1 is the game's own default, not a guess.
      modelScale: modelScale == null ? 1 : +modelScale.toFixed(4),
      // Selection-circle size. Kept separate and clearly named so it can never be
      // mistaken for geometry again.
      selectionScale: selectionScale == null ? 1 : +selectionScale.toFixed(4),
      kind: /^buildings\//i.test(artPath) ? 'building' : (/^units\//i.test(artPath) ? 'unit' : 'other'),
      // Present only when the game data itself omitted the field, so consumers
      // can tell "the game says 1" from "we had nothing and used 1".
      ...(modelScale == null ? { modelScaleDefaulted: true } : {})
    };
  }
  return { entries: out, noScale };
}

function extractDoodads () {
  const file = path.join(DOODADS_DIR, 'doodadskins.txt');
  if (!fs.existsSync(file)) return { entries: {}, noScale: 0 };
  const skin = parseINI(file);
  const out = {};
  let noScale = 0;
  for (const [id, f] of Object.entries(skin)) {
    const defScale = sdFirst(f, 'defScale');
    if (defScale == null) noScale++;
    // fixedRot -1 means "free rotation"; anything else pins the doodad's yaw.
    const fixedRot = num(f.fixedRot, -1);
    out[id] = {
      defScale: defScale == null ? 1 : +defScale.toFixed(4),
      minScale: num(f.minScale, 1),
      maxScale: num(f.maxScale, 1),
      ...(fixedRot >= 0 ? { fixedRot } : {}),
      ...(defScale == null ? { defScaleDefaulted: true } : {})
    };
  }
  return { entries: out, noScale };
}

function extractDestructables () {
  const file = path.join(UNITS_DIR, 'destructableskin.txt');
  if (!fs.existsSync(file)) return { entries: {} };
  const skin = parseINI(file);
  const out = {};
  for (const [id, f] of Object.entries(skin)) {
    const fixedRot = num(f.fixedRot, -1);
    // Destructables carry NO defScale — their final scale is the per-instance
    // value in war3map.doo, which the map exporter already passes through. Only
    // the rotation pin and the authoring band are worth carrying.
    out[id] = {
      minScale: num(f.minScale, 1),
      maxScale: num(f.maxScale, 1),
      ...(fixedRot >= 0 ? { fixedRot } : {})
    };
  }
  return { entries: out };
}

const units = extractUnits();
const doodads = extractDoodads();
const destructables = extractDestructables();

const data = {
  version: 1,
  note: 'modelScale = Art Scaling Value (usca). selectionScale = Art Selection Scale (ussc) — NEVER a geometry multiplier.',
  source: {
    units: 'tools/map-data/units/unitskin.txt',
    doodads: 'tools/map-data/doodads/doodadskins.txt',
    destructables: 'tools/map-data/units/destructableskin.txt'
  },
  units: units.entries,
  doodads: doodads.entries,
  destructables: destructables.entries
};

const unitCount = Object.values(units.entries).filter(e => e.kind === 'unit').length;
const bldgCount = Object.values(units.entries).filter(e => e.kind === 'building').length;
const nonOne = Object.values(units.entries).filter(e => e.modelScale !== 1).length;
const doodadNonOne = Object.values(doodads.entries).filter(e => e.defScale !== 1).length;

console.log('units/buildings: ' + Object.keys(units.entries).length +
  ' (' + unitCount + ' unit, ' + bldgCount + ' building)');
console.log('  modelScale != 1: ' + nonOne + '   no modelScale field (defaulted to 1): ' + units.noScale);
console.log('doodads: ' + Object.keys(doodads.entries).length + '   defScale != 1: ' + doodadNonOne);
console.log('destructables: ' + Object.keys(destructables.entries).length);

// ── Client companion ────────────────────────────────────────────────────────
// The viewer needs defScale and fixedRot per doodad/destructable type. Emitting
// only the non-default entries keeps this at a couple of KB — 505 of the 568
// doodad types are defScale 1.000 with free rotation and need no entry at all.
//
// fixedRot is DEGREES in the skin files and is -1 when the type rotates freely;
// we emit radians so the renderer can use it directly, and omit it otherwise.
const DEG2RAD = Math.PI / 180;
const clientDoodads = {};
const addClient = (id, e) => {
  const out = {};
  if (e.defScale != null && e.defScale !== 1) out.s = e.defScale;
  if (e.fixedRot != null) out.r = +(e.fixedRot * DEG2RAD).toFixed(4);
  if (Object.keys(out).length) clientDoodads[id.toLowerCase()] = out;
};
for (const [id, e] of Object.entries(doodads.entries)) addClient(id, e);
// Destructables (trees, gates, walls) carry no defScale — their size is the
// per-instance value in war3map.doo, which the map export already passes through
// — but they DO pin rotation, and the viewer was ignoring that.
for (const [id, e] of Object.entries(destructables.entries)) addClient(id, e);

console.log('client doodad-scales entries: ' + Object.keys(clientDoodads).length +
  ' (of ' + (Object.keys(doodads.entries).length + Object.keys(destructables.entries).length) + ' types)');

if (checkOnly) { console.log('\n--check: nothing written'); process.exit(0); }

fs.writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));
console.log('\nWrote ' + OUT_PATH);

const clientDir = path.dirname(CLIENT_DOODAD_PATH);
if (fs.existsSync(clientDir)) {
  fs.writeFileSync(CLIENT_DOODAD_PATH, JSON.stringify(clientDoodads));
  console.log('Wrote ' + CLIENT_DOODAD_PATH);
} else {
  console.log('Skipped ' + CLIENT_DOODAD_PATH + ' (models dir absent)');
}
