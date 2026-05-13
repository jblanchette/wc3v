#!/usr/bin/env node
//
// backfill-levels.js — one-shot: stamp every build in builds-manifest.json with
// a `level` band (new | improving | pro), a `difficulty` (easy | medium | hard),
// and an optional `alsoShownIn` array (extra bands the build also appears in —
// e.g. an `improving` build that's beginner-friendly enough to also show in `new`).
//
// Part of the "all skill levels" feature (see ~/.claude/plans/all-skill-levels-experience.md):
// `level` is the primary band the homepage band-switch filters on; `difficulty`
// drives the per-card difficulty pill; `alsoShownIn` widens a build's reach.
// Idempotent — re-running just re-asserts the table below (and removes any
// `alsoShownIn` not listed here), so it's safe to tweak and re-run.
//
// Usage:
//   node tools/backfill-levels.js            # apply
//   node tools/backfill-levels.js --dry-run  # show what would change, write nothing
//
'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
const DRY = process.argv.includes('--dry-run');

// id → { level, difficulty, alsoShownIn? }. The intent: one clean "first build"
// per race in `new`, fundamentals in `improving`, execution/meta-heavy builds in
// `pro`; a few accessible `improving` builds also surface in `new` via
// `alsoShownIn` so beginners get more options (and ones that have replays).
// Adjust freely and re-run; pair with `node tools/seed-starter-content.js` for
// the beginner teaching copy on anything that appears in the `new` band.
const TABLE = {
  // Undead
  'udo-dk-fast-fiend':       { level: 'new',       difficulty: 'medium' }, // THE standard UD build
  'ud-dk-destroyer':         { level: 'pro',       difficulty: 'hard'   }, // destroyer micro
  'ud-dk-mass-gargoyle':     { level: 'pro',       difficulty: 'hard'   }, // garg micro
  'ud-lich-fast-tech':       { level: 'pro',       difficulty: 'hard'   }, // greedy, punishable
  'ud-cl-standard':          { level: 'improving', difficulty: 'medium', alsoShownIn: ['new'] }, // natural 2nd UD build
  // Orc
  'orc-bm-grunt-push':       { level: 'new',       difficulty: 'easy'   }, // straightforward ground army
  'orc-fs-headhunter-shaman':{ level: 'improving', difficulty: 'medium', alsoShownIn: ['new'] }, // accessible ranged Orc
  'orc-bm-wind-rider':       { level: 'pro',       difficulty: 'hard'   }, // BM wyvern micro + map control
  // Human
  'hu-am-rifle':             { level: 'new',       difficulty: 'easy'   }, // the classic first Human build
  'hu-am-caster':            { level: 'improving', difficulty: 'medium', alsoShownIn: ['new'] }, // the "next" Human build
  'hu-mk-fast-expand':       { level: 'improving', difficulty: 'medium' },
  'hu-paladin-rifle':        { level: 'pro',       difficulty: 'medium' }, // newer build
  // Night Elf
  'ne-potm-mass-hunts':      { level: 'new',       difficulty: 'easy'   }, // classic beginner NE build
  'ne-kotg-mountain-giant':  { level: 'improving', difficulty: 'medium', alsoShownIn: ['new'] }, // tanky, forgiving NE
  'ne-dh-fast-bear':         { level: 'improving', difficulty: 'medium' },
  'ne-dh-mass-talons':       { level: 'pro',       difficulty: 'hard'   }, // talon micro
};

const VALID_LEVELS = new Set(['new', 'improving', 'pro']);
const VALID_DIFFS  = new Set(['easy', 'medium', 'hard']);
const MANAGED_KEYS  = ['level', 'difficulty', 'alsoShownIn'];

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function reorder(build, entry) {
  // Rebuild the object so `level` / `difficulty` (/ `alsoShownIn`) sit right
  // after `matchups` (or after `race` if there's no `matchups`), keeping the
  // file readable. Drops any old positions of the managed keys.
  const out = {};
  let inserted = false;
  const placeManaged = () => {
    out.level = entry.level;
    out.difficulty = entry.difficulty;
    if (entry.alsoShownIn) out.alsoShownIn = entry.alsoShownIn;
  };
  for (const [k, v] of Object.entries(build)) {
    if (MANAGED_KEYS.includes(k)) continue;
    out[k] = v;
    if (!inserted && (k === 'matchups' || (k === 'race' && !('matchups' in build)))) {
      placeManaged();
      inserted = true;
    }
  }
  if (!inserted) placeManaged();
  return out;
}

function inBand(build, band) {
  if (build.level === band) return true;
  return Array.isArray(build.alsoShownIn) && build.alsoShownIn.includes(band);
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const builds = manifest.builds || [];
  let changed = 0;
  const missing = [];

  manifest.builds = builds.map(b => {
    const entry = TABLE[b.id];
    if (!entry) { missing.push(b.id); return b; }
    if (!VALID_LEVELS.has(entry.level)) throw new Error(`bad level for ${b.id}: ${entry.level}`);
    if (!VALID_DIFFS.has(entry.difficulty)) throw new Error(`bad difficulty for ${b.id}: ${entry.difficulty}`);
    if (entry.alsoShownIn) {
      if (!Array.isArray(entry.alsoShownIn)) throw new Error(`alsoShownIn must be an array for ${b.id}`);
      for (const x of entry.alsoShownIn) {
        if (!VALID_LEVELS.has(x)) throw new Error(`bad alsoShownIn band for ${b.id}: ${x}`);
        if (x === entry.level) throw new Error(`${b.id}: alsoShownIn lists its own level "${x}"`);
      }
    }
    const same = b.level === entry.level && b.difficulty === entry.difficulty
      && eq(b.alsoShownIn, entry.alsoShownIn || undefined);
    if (same) return b;
    changed++;
    const fmt = (x) => x ? `${x.level}/${x.difficulty}${x.alsoShownIn ? '/+' + x.alsoShownIn.join(',') : ''}` : '(unset)';
    console.log(`  ${b.id}: ${b.level ? fmt({ level: b.level, difficulty: b.difficulty, alsoShownIn: b.alsoShownIn }) : '(unset)'} → ${fmt(entry)}`);
    return reorder(b, entry);
  });

  if (missing.length) {
    console.warn(`\n⚠  ${missing.length} build(s) not in the table (left untouched): ${missing.join(', ')}`);
  }

  // Sanity: every band has at least one build (counting alsoShownIn).
  const byBand = { new: 0, improving: 0, pro: 0 };
  for (const b of manifest.builds) {
    for (const band of ['new', 'improving', 'pro']) if (inBand(b, band)) byBand[band]++;
  }
  console.log(`\nBand membership (incl. alsoShownIn): new=${byBand.new}  improving=${byBand.improving}  pro=${byBand.pro}`);
  for (const band of ['new', 'improving', 'pro']) {
    if (!byBand[band]) console.warn(`⚠  band "${band}" has no builds`);
  }

  if (DRY) { console.log(`\n(dry run — ${changed} build(s) would change, nothing written)`); return; }
  if (changed === 0 && !missing.length) { console.log('\nNothing to do — manifest already up to date.'); return; }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n✔  Wrote ${MANIFEST} (${changed} build(s) updated).`);
}

main();
