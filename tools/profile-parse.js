/**
 * profile-parse.js — CPU-profile a replay parse and report the hot functions.
 *
 * Parse cost scales superlinearly with replay size (2.4x the bytes cost 4.2x
 * the time), which points at an algorithmic hotspot rather than inherent work.
 * This finds it.
 *
 * Runs the parse under V8's sampling profiler in a child process, then
 * aggregates the resulting .cpuprofile by SELF time (time actually executing
 * in that function, excluding callees) — that is what identifies a hotspot.
 * Total time is reported too, so a cheap function called from a hot loop is
 * distinguishable from a genuinely expensive one.
 *
 * Usage:
 *   node tools/profile-parse.js --replay=NAME
 *   node tools/profile-parse.js --replay=NAME --top=40
 *   node tools/profile-parse.js --replay=NAME --mode=bundle
 *
 * Options:
 *   --replay=NAME   Replay basename in replays/
 *   --top=N         Rows to print (default 25)
 *   --mode=node|bundle   Which parse path to profile (default node)
 *   --keep          Keep the raw .cpuprofile for loading into DevTools
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORKER = path.join(__dirname, 'verify-bundle-parity.js');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

if (!args.replay) {
  console.log('Usage: node tools/profile-parse.js --replay=NAME [--top=N] [--mode=node|bundle]');
  process.exit(1);
}

const TOP = parseInt(args.top, 10) || 25;
const MODE = args.mode === 'bundle' ? 'bundle' : 'node';

const main = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc3v-prof-'));
  const out = path.join(dir, 'out.json');

  console.log(`profiling ${MODE} parse of ${args.replay}…`);
  const t0 = Date.now();
  execFileSync(
    process.execPath,
    [
      '--cpu-prof',
      `--cpu-prof-dir=${dir}`,
      WORKER,
      `--replay=${args.replay}`,
      `--_worker=${MODE}`,
      `--_out=${out}`
    ],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 1 << 28 }
  );
  const wall = Date.now() - t0;

  const profFile = fs.readdirSync(dir).find(f => f.endsWith('.cpuprofile'));
  if (!profFile) {
    console.error('no .cpuprofile produced');
    process.exit(1);
  }
  const prof = JSON.parse(fs.readFileSync(path.join(dir, profFile), 'utf8'));

  // A .cpuprofile is a node tree plus a flat sample/timeDelta stream. Self
  // time per node is the sum of the deltas attributed to it.
  const byId = new Map();
  for (const n of prof.nodes) byId.set(n.id, n);

  const selfUs = new Map();
  for (let i = 0; i < prof.samples.length; i++) {
    const id = prof.samples[i];
    const dt = prof.timeDeltas[i] || 0;
    selfUs.set(id, (selfUs.get(id) || 0) + dt);
  }

  // Roll node-level self time up to a function key, since one function can
  // appear as many nodes (different call paths).
  const keyOf = (n) => {
    const cf = n.callFrame;
    const file = (cf.url || '')
      .replace(/^file:\/\/\//, '')
      .replace(/\\/g, '/')
      .replace(ROOT.replace(/\\/g, '/') + '/', '');
    const name = cf.functionName || '(anonymous)';
    return file ? `${name}  ${file}:${cf.lineNumber + 1}` : name;
  };

  const fnSelf = new Map();
  for (const [id, us] of selfUs) {
    const n = byId.get(id);
    if (!n) continue;
    const k = keyOf(n);
    fnSelf.set(k, (fnSelf.get(k) || 0) + us);
  }

  const totalUs = [...selfUs.values()].reduce((a, b) => a + b, 0);
  const rows = [...fnSelf.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`\nwall ${(wall / 1000).toFixed(1)}s · sampled ${(totalUs / 1e6).toFixed(1)}s\n`);
  console.log('  self%     self(s)  function');
  console.log('  ------  ---------  ' + '-'.repeat(60));
  for (const [k, us] of rows.slice(0, TOP)) {
    const pct = (100 * us / totalUs).toFixed(1);
    if (parseFloat(pct) < 0.3) break;
    console.log(`  ${pct.padStart(5)}%  ${(us / 1e6).toFixed(2).padStart(8)}s  ${k}`);
  }

  if (args.keep) {
    const dest = path.join(ROOT, `parse-${args.replay}.cpuprofile`);
    fs.copyFileSync(path.join(dir, profFile), dest);
    console.log(`\nraw profile: ${path.relative(ROOT, dest)} (load in Chrome DevTools → Performance)`);
  } else {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

main();
