#!/usr/bin/env node
/**
 * map-resolve-check.js — audit raw replay map name → map library resolution.
 *
 * Map resolution is silent when it goes wrong. A replay on "(2)EchoIsles_S2_v2.2"
 * that resolves to plain "EchoIsles" still parses, still renders, still produces
 * a summary — with the wrong terrain, the wrong creep camps and starting
 * positions 1536 units off. Nothing throws. This tool is how that class of bug
 * becomes visible.
 *
 * Modes:
 *
 *   --self          Every map in the library must resolve to itself. Feeds each
 *                   config key back through the resolver and reports any that
 *                   land somewhere else. This is the regression gate — run it
 *                   after touching helpers/mapResolver.js or adding a map.
 *
 *   --map=NAME      Resolve one raw map name and show the answer.
 *
 *   --replay=NAME   Resolve the map named by a parsed replay in client/replays.
 *
 *   --corpus        Resolve every distinct map name found across the summaries
 *                   in client/data/summaries, listing what each lands on.
 *
 *   --replays       Peek every .w3g in replays/ and report which ones resolve
 *                   differently than the legacy algorithm did. Those are the
 *                   replays whose committed .wc3v was built against the wrong
 *                   map and needs re-parsing. Header-only, ~50ms each.
 *
 *   --compare       Run --self and --corpus through BOTH the legacy first-match
 *                   algorithm and the current resolver, and report only where
 *                   they disagree. This is the blast radius of a resolver
 *                   change: every line is a replay whose parse output moves.
 *
 * Default with no mode is --self.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const { mapDataByFile } = require(path.join(ROOT, 'helpers', 'mappings.js'));
const resolver = require(path.join(ROOT, 'helpers', 'mapResolver.js'));

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
};

// ── The algorithm as it stood before helpers/mapResolver.js ──────────────────
// Kept verbatim so --compare measures a real difference rather than a
// paraphrase. Scans config keys in declaration order and returns the first
// map name that appears anywhere in the replay's filename.
const legacyResolveKey = (rawMapName) => {
  if (!rawMapName) return null;
  let mapName = path.basename(String(rawMapName).split('\\').join('/')).toLowerCase();
  mapName = mapName.trim().replace(/ /g, '');

  const w3cPrefixMatch = mapName.match(/^\d+_w3c_\d+_\d+_(.+)$/);
  const stripped = w3cPrefixMatch ? w3cPrefixMatch[1] : mapName;

  if (mapDataByFile[mapName]) return mapName;

  return Object.keys(mapDataByFile).find(key => {
    const searchName = String(mapDataByFile[key].name || '').toLowerCase();
    if (!searchName) return false;
    if (mapName.indexOf(searchName) !== -1) return true;
    if (stripped !== mapName && stripped.indexOf(searchName) !== -1) return true;
    const baseSearch = searchName.replace(/[_-]v[\d._-]+$/, '');
    const baseMap = stripped.replace('.w3x', '').replace(/[_-]v[\d._-]+$/, '');
    return baseSearch.length > 3 && baseMap === baseSearch;
  }) || null;
};

const nameOf = (key) => (key && mapDataByFile[key] ? mapDataByFile[key].name : null);

// ── Corpus map names ────────────────────────────────────────────────────────

const readJson = (file) => {
  try {
    const raw = file.endsWith('.gz')
      ? zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')
      : fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (e) { return null; }
};

// Raw map names as they appear in shipped summaries. mapRaw is the untouched
// header string; map is the already-basenamed form older summaries carry.
const corpusMapNames = () => {
  const dir = path.join(ROOT, 'client', 'data', 'summaries');
  const seen = new Map(); // rawName → sample source file
  if (!fs.existsSync(dir)) return seen;
  for (const file of fs.readdirSync(dir)) {
    if (!/\.json(\.gz)?$/.test(file)) continue;
    const data = readJson(path.join(dir, file));
    if (!data) continue;
    const raw = data.mapRaw || data.map || (data.replay && data.replay.mapName);
    if (raw && !seen.has(raw)) seen.set(raw, file);
  }
  return seen;
};

// ── Modes ───────────────────────────────────────────────────────────────────

// Every library map, fed back through the resolver under the filename a real
// replay would carry. A map that cannot find itself can never be found.
const selfTest = (compare) => {
  const rows = [];
  for (const key of Object.keys(mapDataByFile)) {
    const asReplayName = String(key).split(/[\\/]/).pop();
    const got = resolver.resolveMapKey(asReplayName, mapDataByFile);
    const legacy = compare ? legacyResolveKey(asReplayName) : undefined;
    rows.push({ key, asReplayName, got, legacy, ok: got === key });
  }

  const broken = rows.filter(r => !r.ok);
  console.log(`\n── self-resolution: ${rows.length - broken.length}/${rows.length} maps resolve to themselves`);
  for (const r of broken) {
    console.log(`  MISRESOLVED  ${r.asReplayName}`);
    console.log(`               want ${nameOf(r.key)}  got ${nameOf(r.got) || '(none)'}`);
  }

  if (compare) {
    const legacyBroken = rows.filter(r => r.legacy !== r.key);
    console.log(`\n── legacy algorithm: ${rows.length - legacyBroken.length}/${rows.length} resolve to themselves`);
    for (const r of legacyBroken) {
      const fixed = r.ok ? 'FIXED  ' : 'still  ';
      console.log(`  ${fixed}${r.asReplayName}`);
      console.log(`         want ${nameOf(r.key)}  legacy ${nameOf(r.legacy) || '(none)'}  now ${nameOf(r.got) || '(none)'}`);
    }
  }
  return broken.length;
};

const corpusTest = (compare) => {
  const names = corpusMapNames();
  if (!names.size) {
    console.log('\n── corpus: no summaries found in client/data/summaries');
    return 0;
  }
  let unresolved = 0, changed = 0;
  const lines = [];
  for (const [raw, source] of names) {
    const got = resolver.resolveMapKey(raw, mapDataByFile);
    const legacy = legacyResolveKey(raw);
    if (!got) unresolved++;
    if (compare && got !== legacy) {
      changed++;
      lines.push(`  CHANGED  ${raw}   (${source})`);
      lines.push(`           was ${nameOf(legacy) || '(none)'}  now ${nameOf(got) || '(none)'}`);
    } else if (!compare) {
      lines.push(`  ${(nameOf(got) || '(UNRESOLVED)').padEnd(28)} ← ${raw}`);
    }
  }
  console.log(`\n── corpus: ${names.size} distinct map names, ${unresolved} unresolved` +
              (compare ? `, ${changed} changed by the new resolver` : ''));
  lines.forEach(l => console.log(l));
  return unresolved;
};

const one = (raw) => {
  const key = resolver.resolveMapKey(raw, mapDataByFile);
  const legacy = legacyResolveKey(raw);
  console.log(`\n  raw:        ${raw}`);
  console.log(`  candidates: ${resolver.candidatesFor(raw).join('  |  ')}`);
  console.log(`  resolved:   ${nameOf(key) || '(UNRESOLVED)'}   [key ${key || '-'}]`);
  console.log(`  legacy:     ${nameOf(legacy) || '(UNRESOLVED)'}   [key ${legacy || '-'}]`);
  if (key !== legacy) console.log(`  → resolution CHANGED by helpers/mapResolver.js`);
  const entry = key ? mapDataByFile[key] : null;
  if (entry) {
    console.log(`  bounds:     ${JSON.stringify(entry.bounds)}`);
    console.log(`  gridSize:   ${JSON.stringify(entry.gridSize)}`);
  }
  return key ? 0 : 1;
};

const fromReplay = (name) => {
  const file = [
    path.join(ROOT, 'client', 'replays', `${name}.wc3v.gz`),
    path.join(ROOT, 'client', 'replays', `${name}.wc3v`),
    path.join(ROOT, 'client', 'replays', name)
  ].find(f => fs.existsSync(f));
  if (!file) {
    console.error(`no parsed replay found for "${name}" in client/replays`);
    return 1;
  }
  const data = readJson(file);
  // A parsed .wc3v carries the untouched header under replay.metadata.map;
  // stored summaries carry it flattened as mapRaw.
  const meta = (data && data.metadata) || (data && data.replay && data.replay.metadata) || null;
  const raw = (meta && meta.map && (meta.map.mapNameOriginal || meta.map.mapName)) ||
              (data && (data.mapRaw || data.map)) || null;
  if (!raw) {
    console.error(`replay "${name}" carries no map name`);
    return 1;
  }
  return one(raw);
};

// Header-only read of a .w3g. Aborting from the metadata handler skips the
// gamedata parse entirely, which is what makes scanning the whole folder cheap.
const peekMapName = async (file) => {
  const ReplayParser = require(path.join(ROOT, 'node_modules', 'w3gjs', 'dist', 'lib', 'parsers', 'ReplayParser')).default;
  const DONE = Symbol('done');
  const peeker = new ReplayParser();
  let info = null;
  peeker.on('basic_replay_information', (i) => { info = i; throw DONE; });
  try { await peeker.parse(fs.readFileSync(file)); } catch (e) { if (e !== DONE) return null; }
  const map = info && info.metadata && info.metadata.map;
  if (!map || !map.mapName) return null;
  return { raw: map.mapName, sha1: map.mapChecksumSha1 || null };
};

// The parser falls back to a checksum table for replays that name their map by
// MD5 (NetEase / Reforged clients). Mirrored here so those do not get reported
// as unresolved when the real parse handles them fine. Absent on a clean
// checkout, same as in PlayerManager.
let mapAliases = {};
try {
  mapAliases = require(path.join(ROOT, 'helpers', 'mapAliases.json')).aliases || {};
} catch (e) { /* no alias table — checksum recovery unavailable, as in the parser */ }

const aliasKeyFor = (sha1) => {
  const k = sha1 ? mapAliases[String(sha1).toLowerCase()] : null;
  return k && mapDataByFile[k] ? k : null;
};

// Which committed parses were built against the wrong map. A replay only
// appears here if the two algorithms disagree, which means its stored .wc3v
// carries another map's terrain, camps and start positions.
const replaysTest = async () => {
  const dir = path.join(ROOT, 'replays');
  if (!fs.existsSync(dir)) {
    console.log('\n── replays: no replays/ folder');
    return 0;
  }
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.w3g'));
  const changed = [];
  const unresolved = [];
  let failed = 0, byChecksum = 0;

  for (const f of files) {
    const peek = await peekMapName(path.join(dir, f));
    if (!peek) { failed++; continue; }
    const { raw, sha1 } = peek;
    let got = resolver.resolveMapKey(raw, mapDataByFile);
    let legacy = legacyResolveKey(raw);
    if (!got) {
      const alias = aliasKeyFor(sha1);
      if (alias) { byChecksum++; got = alias; if (!legacy) legacy = alias; }
    }
    if (!got) unresolved.push({ f, raw });
    else if (got !== legacy) changed.push({ f, raw, legacy, got });
  }

  console.log(`\n── replays: ${files.length} scanned, ${changed.length} resolve to a DIFFERENT map now` +
              `, ${byChecksum} recovered by checksum, ${unresolved.length} unresolved, ${failed} unreadable`);

  const byMap = new Map();
  for (const c of changed) {
    const k = `${nameOf(c.legacy) || '(none)'} → ${nameOf(c.got)}`;
    byMap.set(k, (byMap.get(k) || 0).valueOf() + 1);
  }
  if (byMap.size) {
    console.log('\n  needs re-parse, grouped by correction:');
    [...byMap.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([k, n]) => console.log(`    ${String(n).padStart(4)}  ${k}`));
  }
  if (unresolved.length) {
    console.log('\n  not in the map library at all:');
    const seen = new Set();
    unresolved.forEach(u => { if (!seen.has(u.raw)) { seen.add(u.raw); console.log(`    ${u.raw}`); } });
  }
  if (changed.length) {
    console.log('\n  affected replay files:');
    changed.forEach(c => console.log(`    ${c.f}`));
  }
  return changed.length;
};

// ── Main ────────────────────────────────────────────────────────────────────

const main = async () => {
  const compare = !!flag('compare');
  const mapArg = flag('map');
  const replayArg = flag('replay');
  const wantReplays = !!flag('replays');
  const wantCorpus = !!flag('corpus') || compare;
  const wantSelf = !!flag('self') || compare ||
    (!mapArg && !replayArg && !wantReplays && !flag('corpus'));

  let bad = 0;
  if (mapArg && mapArg !== true) bad += one(mapArg);
  if (replayArg && replayArg !== true) bad += fromReplay(replayArg);
  if (wantSelf) bad += selfTest(compare);
  if (wantCorpus) corpusTest(compare);
  if (wantReplays) await replaysTest();
  console.log('');
  process.exit(bad ? 1 : 0);
};

main().catch(e => { console.error(e.message); process.exit(1); });
