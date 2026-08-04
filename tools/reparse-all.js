/**
 * reparse-all.js — re-run the parser over every replay that still has its
 * source .w3g, in parallel, with a resumable report.
 *
 * Needed whenever a parser change alters exported data (new field, corrected
 * metadata) — the committed .wc3v.gz files are snapshots and do not update
 * themselves. Each replay runs in its OWN process: lib/ carries module-level
 * state across parses in-process, and a child per replay keeps runs isolated
 * and independently deterministic.
 *
 * Usage:
 *   node tools/reparse-all.js                    all replays with a source
 *   node tools/reparse-all.js --jobs=6           parallelism (default: cores/2, max 8)
 *   node tools/reparse-all.js --limit=10         first N only (smoke test)
 *   node tools/reparse-all.js --only=NAME        a single replay
 *   node tools/reparse-all.js --dry-run          list what would run
 *   node tools/reparse-all.js --resume           skip replays already done in the last report
 *
 * Writes tools/.reparse-report.json: per-replay status, duration, and the
 * statue/destroyer counts, so morph coverage is spot-checkable afterwards.
 *
 * NOTE: replays whose .w3g is missing cannot be reparsed — they are listed as
 * `orphans` in the report and keep whatever data they were last parsed with.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'replays');
const OUT_DIR = path.join(ROOT, 'client', 'replays');
const REPORT = path.join(__dirname, '.reparse-report.json');

const args = {};
process.argv.slice(2).forEach(r => {
  const [f, ...v] = r.replace(/^--/, '').split('=');
  args[f] = v.join('=') || true;
});

const dryRun = !!args['dry-run'];
const jobs = Math.max(1, Math.min(8, +(args.jobs || Math.floor(os.cpus().length / 2))));

function sources () {
  if (!fs.existsSync(SRC_DIR)) return [];
  return fs.readdirSync(SRC_DIR)
    .filter(f => f.endsWith('.w3g'))
    .map(f => f.replace(/\.w3g$/, ''))
    .sort();
}

function parsedOutputs () {
  if (!fs.existsSync(OUT_DIR)) return new Set();
  return new Set(fs.readdirSync(OUT_DIR)
    .filter(f => f.endsWith('.wc3v.gz'))
    .map(f => f.replace(/\.wc3v\.gz$/, '')));
}

// Post-parse spot-check data: how many statues vs destroyers the replay ended
// with, and whether a morph timeline was recorded. Cheap enough to read here
// rather than making the user run inspect-replay 200 times.
function morphStats (name) {
  const gz = path.join(OUT_DIR, name + '.wc3v.gz');
  if (!fs.existsSync(gz)) return null;
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
    const data = JSON.parse(raw);
    let statues = 0, destroyers = 0, morphs = 0, statueMorphs = 0;
    for (const pid in (data.players || {})) {
      for (const u of (data.players[pid].units || [])) {
        if (u.itemId === 'uobs') statues++;
        else if (u.itemId === 'ubsp') destroyers++;
        for (const m of (u.morphHistory || [])) {
          morphs++;
          // Building upgrades (unp1→unp2 etc.) also record a morph now, so
          // count the statue ⇄ destroyer ones separately — that's the number
          // that says whether Destroyer Form detection is actually working.
          if (m.itemId === 'ubsp' || m.itemId === 'uobs') statueMorphs++;
        }
      }
    }
    return { statues, destroyers, morphs, statueMorphs };
  } catch (e) {
    return null;
  }
}

function runOne (name) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(process.execPath, ['wc3v.js', '--replay=' + name], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('close', code => {
      resolve({
        name,
        ok: code === 0,
        code,
        ms: Date.now() - started,
        error: code === 0 ? null : stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 300)
      });
    });
    child.on('error', e => {
      resolve({ name, ok: false, code: -1, ms: Date.now() - started, error: e.message });
    });
  });
}

// Walk the already-parsed outputs and report morph coverage without reparsing
// anything. Use after a batch to sanity-check what the parser actually recorded.
function statsOnly () {
  const names = [...parsedOutputs()].sort();
  const rows = [];
  for (const n of names) {
    const m = morphStats(n);
    if (m && (m.statues || m.destroyers || m.statueMorphs)) rows.push({ name: n, ...m });
  }
  rows.sort((a, b) => b.statueMorphs - a.statueMorphs || b.destroyers - a.destroyers);

  console.log(`\n=== MORPH COVERAGE (${names.length} parsed replays) ===\n`);
  console.log(`  replays with statues .............. ${rows.filter(r => r.statues).length}`);
  console.log(`  replays with destroyers ........... ${rows.filter(r => r.destroyers).length}`);
  console.log(`  replays with a statue⇄destroyer morph  ${rows.filter(r => r.statueMorphs).length}`);
  console.log(`  total statue morphs recorded ...... ${rows.reduce((a, r) => a + r.statueMorphs, 0)}`);
  console.log(`\n  top replays by statue morphs:`);
  rows.filter(r => r.statueMorphs).slice(0, 12).forEach(r =>
    console.log(`    ${r.name}  statues=${r.statues} destroyers=${r.destroyers} morphs=${r.statueMorphs}`));
  const never = rows.filter(r => r.statues && !r.destroyers && !r.statueMorphs)
    .sort((a, b) => b.statues - a.statues);
  console.log(`\n  statue-only, never morphed (${never.length}):`);
  never.slice(0, 6).forEach(r => console.log(`    ${r.name}  statues=${r.statues}`));
}

async function main () {
  if (args['stats-only']) return statsOnly();

  const all = sources();
  const outputs = parsedOutputs();
  const orphans = [...outputs].filter(n => !all.includes(n)).sort();

  let todo = all;
  if (args.only) todo = todo.filter(n => n === String(args.only));
  if (args.resume && fs.existsSync(REPORT)) {
    try {
      const prev = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
      const done = new Set((prev.results || []).filter(r => r.ok).map(r => r.name));
      const before = todo.length;
      todo = todo.filter(n => !done.has(n));
      console.log(`resume: skipping ${before - todo.length} already-successful replays`);
    } catch (e) { /* ignore a corrupt report and reparse everything */ }
  }
  if (args.limit) todo = todo.slice(0, +args.limit);

  console.log(`\n=== REPARSE${dryRun ? ' (DRY RUN)' : ''} ===`);
  console.log(`sources: ${all.length}   parsed outputs: ${outputs.size}   to reparse: ${todo.length}   jobs: ${jobs}`);
  if (orphans.length) {
    console.log(`\n${orphans.length} parsed replays have NO source .w3g and cannot be reparsed.`);
    console.log(`They keep their existing data. First few: ${orphans.slice(0, 5).join(', ')}`);
  }
  if (!todo.length) { console.log('\nnothing to do'); return; }

  if (dryRun) {
    todo.forEach(n => console.log('  [DRY] ' + n));
    return;
  }

  const results = [];
  const started = Date.now();
  let idx = 0, done = 0;

  // Fixed-size worker pool: each slot pulls the next name until the list is
  // exhausted. Keeps `jobs` parses in flight without spawning 200 processes.
  async function worker () {
    for (;;) {
      const i = idx++;
      if (i >= todo.length) return;
      const r = await runOne(todo[i]);
      results.push(r);
      done++;
      const elapsed = Date.now() - started;
      const eta = done ? Math.round((elapsed / done) * (todo.length - done) / 1000) : 0;
      const tag = r.ok ? 'ok  ' : 'FAIL';
      console.log(`  ${tag} [${String(done).padStart(3)}/${todo.length}] ${r.name}` +
        `  ${(r.ms / 1000).toFixed(1)}s   eta ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, '0')}s` +
        (r.ok ? '' : `\n       ${r.error}`));
    }
  }

  await Promise.all(Array.from({ length: jobs }, worker));

  results.sort((a, b) => a.name.localeCompare(b.name));
  const failed = results.filter(r => !r.ok);

  // Attach morph stats for the replays that succeeded.
  let withStatues = 0, withDestroyers = 0, withMorphs = 0;
  for (const r of results) {
    if (!r.ok) continue;
    r.morph = morphStats(r.name);
    if (!r.morph) continue;
    if (r.morph.statues) withStatues++;
    if (r.morph.destroyers) withDestroyers++;
    if (r.morph.morphs) withMorphs++;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    jobs,
    totalSources: all.length,
    reparsed: results.length,
    failed: failed.length,
    orphans,
    results
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

  const totalMin = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\n=== DONE in ${totalMin}m ===`);
  console.log(`  ok ${results.length - failed.length}   failed ${failed.length}   orphans (no source) ${orphans.length}`);
  console.log(`  replays with statues: ${withStatues}   with destroyers: ${withDestroyers}   with a recorded morph: ${withMorphs}`);
  if (failed.length) {
    console.log(`\nFAILED (${failed.length}):`);
    failed.forEach(f => console.log(`  ${f.name}: ${f.error}`));
  }
  console.log(`\nreport: ${REPORT}`);
  console.log(`next:   node tools/import-replays.js --regen-summaries`);
}

main();
