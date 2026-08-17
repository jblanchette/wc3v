#!/usr/bin/env node
//
// backfill-classes.js — stamp every build in builds-manifest.json with its
// `buildClass` (the six-class taxonomy in client/js/BuildClass.js), a derived
// `level` band, a `difficulty`, and an optional `alsoShownIn` array.
//
// `buildClass` is the authority; `level` is written as a projection of it
// (BuildClass.bandFor) so every existing band consumer keeps working untouched
// — BandSwitcher, the /learn two-way door, the ?level= URL param, the SEO
// build pages, the MCP tool. tools/lint-manifest.js errors if the two drift.
//
// The pro-meta / pro-off-meta split is an EDITORIAL call, not a measurement:
// nothing in the replay data says where "meta" ends. Run
// `node tools/build-meta-evidence.js --table` to regenerate the table below
// with frequency + recency evidence attached, then read it, edit it, paste it.
//
// Idempotent — re-running re-asserts the table (and removes any `alsoShownIn`
// not listed here), so it's safe to tweak and re-run.
//
// Usage:
//   node tools/backfill-classes.js            # apply
//   node tools/backfill-classes.js --dry-run  # show what would change, write nothing
//
'use strict';

const fs = require('fs');
const path = require('path');
const BuildClass = require('../client/js/BuildClass.js');

const MANIFEST = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
const DRY = process.argv.includes('--dry-run');

// id → { buildClass, difficulty, alsoShownIn? }.
//
// Seeded by renaming the old `level` bands one-for-one — pro → pro-meta,
// improving → ladder, new → new-player. That is deliberately a RENAME and not
// a reclassification: no build is called off-meta until the evidence tool has
// something to say about it. `alsoShownIn` stays hand-authored; it encodes
// "this ladder build is beginner-friendly enough to also show new players",
// which has no equivalent in the class enum.
const TABLE = {
  // Undead
  'udo-dk-fast-fiend':       { buildClass: 'new-player', difficulty: 'medium' }, // THE standard UD build
  'ud-dk-destroyer':         { buildClass: 'pro-meta',   difficulty: 'hard'   }, // destroyer micro
  'ud-dk-mass-gargoyle':     { buildClass: 'pro-meta',   difficulty: 'hard'   }, // garg micro
  'ud-lich-fast-tech':       { buildClass: 'pro-meta',   difficulty: 'hard'   }, // greedy, punishable
  'ud-cl-standard':          { buildClass: 'ladder',     difficulty: 'medium', alsoShownIn: ['new'] }, // natural 2nd UD build
  // Orc
  'orc-bm-grunt-push':       { buildClass: 'new-player', difficulty: 'easy'   }, // straightforward ground army
  'orc-fs-headhunter-shaman':{ buildClass: 'ladder',     difficulty: 'medium', alsoShownIn: ['new'] }, // accessible ranged Orc
  'orc-bm-wind-rider':       { buildClass: 'pro-meta',   difficulty: 'hard'   }, // BM wyvern micro + map control
  // Human
  'hu-am-rifle':             { buildClass: 'new-player', difficulty: 'easy'   }, // the classic first Human build
  'hu-am-caster':            { buildClass: 'ladder',     difficulty: 'medium', alsoShownIn: ['new'] }, // the "next" Human build
  'hu-mk-fast-expand':       { buildClass: 'ladder',     difficulty: 'medium' },
  'hu-paladin-rifle':        { buildClass: 'pro-meta',   difficulty: 'medium' }, // newer build
  // Night Elf
  'ne-potm-mass-hunts':      { buildClass: 'new-player', difficulty: 'easy'   }, // classic beginner NE build
  'ne-kotg-mountain-giant':  { buildClass: 'ladder',     difficulty: 'medium', alsoShownIn: ['new'] }, // tanky, forgiving NE
  'ne-dh-fast-bear':         { buildClass: 'ladder',     difficulty: 'medium' },
  'ne-dh-mass-talons':       { buildClass: 'pro-meta',   difficulty: 'hard'   }, // talon micro
};

const VALID_BANDS = new Set(['new', 'improving', 'pro']);
const VALID_DIFFS = new Set(['easy', 'medium', 'hard']);
// `level` is managed too — it is derived from buildClass, never hand-edited.
const MANAGED_KEYS = ['buildClass', 'level', 'difficulty', 'alsoShownIn'];

function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function reorder(build, entry) {
  // Rebuild the object so the managed keys sit right after `matchups` (or
  // after `race` if there's no `matchups`), keeping the file readable. Drops
  // any old positions of the managed keys. `buildClass` leads because it is
  // the authority; `level` follows as its projection.
  const out = {};
  let inserted = false;
  const placeManaged = () => {
    out.buildClass = entry.buildClass;
    out.level = BuildClass.bandFor(entry.buildClass);
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

function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const builds = manifest.builds || [];
  let changed = 0;
  const missing = [];

  manifest.builds = builds.map(b => {
    const entry = TABLE[b.id];
    if (!entry) { missing.push(b.id); return b; }
    if (!BuildClass.isValid(entry.buildClass)) {
      throw new Error(`bad buildClass for ${b.id}: ${entry.buildClass} (valid: ${BuildClass.KEYS.join(', ')})`);
    }
    if (!VALID_DIFFS.has(entry.difficulty)) throw new Error(`bad difficulty for ${b.id}: ${entry.difficulty}`);
    const band = BuildClass.bandFor(entry.buildClass);
    if (entry.alsoShownIn) {
      if (!Array.isArray(entry.alsoShownIn)) throw new Error(`alsoShownIn must be an array for ${b.id}`);
      for (const x of entry.alsoShownIn) {
        if (!VALID_BANDS.has(x)) throw new Error(`bad alsoShownIn band for ${b.id}: ${x}`);
        if (x === band) throw new Error(`${b.id}: alsoShownIn lists its own band "${x}"`);
      }
    }
    const same = b.buildClass === entry.buildClass
      && b.level === band
      && b.difficulty === entry.difficulty
      && eq(b.alsoShownIn, entry.alsoShownIn || undefined);
    if (same) return b;
    changed++;
    const fmt = (cls, diff, also) =>
      `${cls}/${diff}${also ? '/+' + also.join(',') : ''}`;
    const before = b.buildClass || b.level
      ? fmt(b.buildClass || `(level:${b.level})`, b.difficulty, b.alsoShownIn)
      : '(unset)';
    console.log(`  ${b.id}: ${before} → ${fmt(entry.buildClass, entry.difficulty, entry.alsoShownIn)}`);
    return reorder(b, entry);
  });

  if (missing.length) {
    console.warn(`\n⚠  ${missing.length} build(s) not in the table (left untouched): ${missing.join(', ')}`);
  }

  // Membership, both ways. The class counts are what the homepage filter
  // chips show; the band counts are what /learn and the SEO pages still use.
  const byClass = {};
  for (const k of BuildClass.KEYS) byClass[k] = 0;
  const byBand = { new: 0, improving: 0, pro: 0 };
  for (const b of manifest.builds) {
    byClass[BuildClass.classOf(b)]++;
    for (const band of ['new', 'improving', 'pro']) {
      if (BuildClass.bandFor(b) === band || (b.alsoShownIn || []).includes(band)) byBand[band]++;
    }
  }
  console.log('\nClass membership:');
  for (const k of BuildClass.KEYS) console.log(`  ${k.padEnd(16)} ${byClass[k]}`);
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
