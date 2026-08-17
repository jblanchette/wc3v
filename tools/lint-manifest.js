#!/usr/bin/env node
//
// lint-manifest.js — validate client/data/builds-manifest.json against the game
// tech tree and the all-skill-levels schema.
//
// Catches the data errors that quietly break the walkthrough + the build-match
// scorer: a building/unit listed in the WRONG tier of a build's tierProgression
// (e.g. the Necropolis — a T1 hall — listed as a T3 building), plus missing
// `level`, etc. Tier facts come from helpers/mappings (BUILDING_TIER_REQUIREMENTS,
// the hall tiers, and the ReplayValidator's TIER_REQUIRED_UNITS).
//
// Usage:
//   node tools/lint-manifest.js            # all builds
//   node tools/lint-manifest.js --build=ID
//
'use strict';

const fs = require('fs');
const path = require('path');
const m = require('../helpers/mappings.js');
const BuildClass = require('../client/js/BuildClass.js');

const args = {};
process.argv.slice(2).forEach(raw => { const [f, ...r] = raw.replace(/^--/, '').split('='); args[f] = r.join('=') || true; });

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json'), 'utf8'));
let builds = manifest.builds || manifest;
if (typeof args.build === 'string') builds = builds.filter(b => b.id === args.build);

// Tier of a hall, or null if not a hall. T1 hall + tierBuildings[race] = [T2,T3].
const T1_HALL = { U: 'unpl', O: 'ogre', H: 'htow', E: 'etol' };
function hallTier (race, itemId) {
  if (T1_HALL[race] === itemId) return 1;
  const tb = (m.tierBuildings[race] || []);
  if (tb[0] === itemId) return 2;
  if (tb[1] === itemId) return 3;
  return null;
}

// Required tier to BUILD this building (1 if no requirement / T1).
function buildingTier (race, itemId) {
  const h = hallTier(race, itemId);
  if (h != null) return h;
  const req = (m.BUILDING_TIER_REQUIREMENTS[race] || {})[itemId];
  return req != null ? req : 1;
}

// Required tier to TRAIN this unit — shared with the parser's validator (single
// source of truth, so this lint and the parse-time validation never disagree).
const TIER_REQUIRED_UNITS = require('../lib/ReplayValidator.js').TIER_REQUIRED_UNITS;
function unitTier (race, itemId) {
  const r = TIER_REQUIRED_UNITS[race] || {};
  if ((r[3] || []).includes(itemId)) return 3;
  if ((r[2] || []).includes(itemId)) return 2;
  return 1;  // T1 / tier-agnostic
}

function dn (itemId) {
  try { return m.getUnitInfo(itemId).displayName || itemId; } catch (e) { return itemId; }
}

// INFO = a tier-agnostic unit listed in a higher tier (usually intentional —
// "the army you have by then"); noisy, so hidden unless --verbose.
const VERBOSE = !!args.verbose;
let errors = 0, warns = 0, infos = 0;
const log = (sev, buildId, msg) => {
  if (sev === 'ERROR') errors++; else if (sev === 'WARN') warns++; else infos++;
  if (sev !== 'INFO' || VERBOSE) console.log(`  [${sev}] ${buildId}: ${msg}`);
};

for (const b of builds) {
  const race = b.race;
  // schema basics
  // `buildClass` is the authority and `level` is its projection. Both live on
  // disk so band consumers keep working, which means they can drift — and a
  // silent drift shows as a build vanishing from /learn or the wrong label on
  // its SEO page. Re-stamp with `node tools/backfill-classes.js`.
  if (!BuildClass.isValid(b.buildClass)) {
    log('ERROR', b.id, `buildClass "${b.buildClass}" — must be one of ${BuildClass.KEYS.join(' | ')}`);
  } else if (b.level !== BuildClass.bandFor(b.buildClass)) {
    log('ERROR', b.id, `level "${b.level}" disagrees with buildClass "${b.buildClass}" (expected "${BuildClass.bandFor(b.buildClass)}") — run node tools/backfill-classes.js`);
  }
  if (b.recommendedReplayId && !(b.replays || []).some(r => r.replayId === b.recommendedReplayId)) {
    log('WARN', b.id, `recommendedReplayId "${b.recommendedReplayId}" not in replays[]`);
  }
  const tp = b.tierProgression;
  if (!tp) { log('INFO', b.id, 'no tierProgression'); continue; }

  for (const tier of [2, 3]) {
    const t = tp['t' + tier];
    if (!t) continue;
    for (const id of (t.buildings || [])) {
      const actual = buildingTier(race, id);
      if (actual > tier) log('ERROR', b.id, `t${tier}.buildings has ${dn(id)} (${id}) which needs Tier ${actual} to build — impossible at T${tier}`);
      else if (actual < tier) log('WARN', b.id, `t${tier}.buildings has ${dn(id)} (${id}) which is a Tier-${actual} building (mis-tiered?)`);
    }
    for (const id of (t.units || [])) {
      const actual = unitTier(race, id);
      if (actual > tier) log('ERROR', b.id, `t${tier}.units has ${dn(id)} (${id}) which needs Tier ${actual} to train — impossible at T${tier}`);
      else if (actual < tier) log('INFO', b.id, `t${tier}.units has ${dn(id)} (${id}) — a Tier-${actual} unit (available earlier; ok if intentional)`);
    }
  }
}

// Class membership. An empty class is only a warning — the homepage chip for
// it renders and simply matches nothing, which is honest — but it usually
// means a stamping pass was skipped.
if (!args.build) {
  const byClass = {};
  for (const k of BuildClass.KEYS) byClass[k] = 0;
  for (const b of builds) byClass[BuildClass.classOf(b)]++;
  console.log('\nClass membership:');
  for (const k of BuildClass.KEYS) {
    console.log(`  ${k.padEnd(16)} ${byClass[k]}`);
    if (!byClass[k]) { warns++; console.log(`  [WARN] class "${k}" has no builds`); }
  }
}

console.log(`\nbuilds: ${builds.length}   errors: ${errors}  warnings: ${warns}  info: ${infos}`);
process.exit(errors ? 1 : 0);
