/**
 * bench-replay-scan.js — Measure where replay-scan time actually goes.
 *
 * The desktop app's first scan took 53s on a 4,875-file corpus and froze the
 * window. Before optimising, establish which part is expensive: walking the
 * tree, stat-ing each file, or hashing contents — and whether the work is
 * I/O-bound or CPU-bound.
 *
 * Usage:
 *   node tools/bench-replay-scan.js
 *   node tools/bench-replay-scan.js --root="C:/path/to/Replays"
 *
 * Reports timings for each candidate strategy so the trade-off between
 * "exact" and "fast" dedupe is a measured decision rather than a guess.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

const defaultRoots = () => {
  const docs = path.join(os.homedir(), 'Documents', 'Warcraft III', 'BattleNet');
  if (!fs.existsSync(docs)) return [];
  return fs.readdirSync(docs)
    .map(d => path.join(docs, d, 'Replays'))
    .filter(p => fs.existsSync(p));
};

const roots = args.root ? [args.root] : defaultRoots();
if (!roots.length) {
  console.error('No replay folders found. Pass --root=PATH');
  process.exit(1);
}

const walk = (dir, out = []) => {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.w3g')) out.push(p);
  }
  return out;
};

const time = (label, fn) => {
  const t0 = process.hrtime.bigint();
  const result = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { label, ms, result };
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const main = () => {
  console.log(`roots: ${roots.length}\n`);

  const w = time('walk (readdir only)', () => roots.flatMap(r => walk(r)));
  const files = w.result;
  console.log(`${w.label.padEnd(34)} ${w.ms.toFixed(0).padStart(7)} ms   ${files.length} files`);

  const s = time('stat all (size + mtime)', () =>
    files.map(f => { try { return fs.statSync(f); } catch { return null; } }).filter(Boolean));
  const stats = s.result;
  const totalBytes = stats.reduce((a, b) => a + b.size, 0);
  console.log(`${s.label.padEnd(34)} ${s.ms.toFixed(0).padStart(7)} ms`);
  console.log(`${''.padEnd(34)} ${''.padStart(7)}      ${(totalBytes / 1048576).toFixed(0)} MB total\n`);

  // Strategy A — what the app does now: read + hash every byte.
  const a = time('A: full read + sha256 (current)', () => {
    let n = 0;
    for (const f of files) {
      try { sha256(fs.readFileSync(f)); n++; } catch {}
    }
    return n;
  });
  console.log(`${a.label.padEnd(34)} ${a.ms.toFixed(0).padStart(7)} ms   ` +
              `${(totalBytes / 1048576 / (a.ms / 1000)).toFixed(0)} MB/s`);

  // Strategy B — hash only the first 64 KB. Replays diverge almost immediately
  // (header carries map, players, and a random seed), so this separates
  // distinct games; size is folded in to make a collision even less likely.
  const b = time('B: size + first 64KB sha256', () => {
    const buf = Buffer.allocUnsafe(65536);
    let n = 0;
    for (const f of files) {
      let fd;
      try {
        fd = fs.openSync(f, 'r');
        const read = fs.readSync(fd, buf, 0, 65536, 0);
        sha256(buf.subarray(0, read));
        n++;
      } catch {} finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
    }
    return n;
  });
  console.log(`${b.label.padEnd(34)} ${b.ms.toFixed(0).padStart(7)} ms`);

  // Strategy C — no reads at all: identity is (size, mtime).
  const c = time('C: size + mtime only (no read)', () => {
    const seen = new Set();
    for (const st of stats) seen.add(`${st.size}:${st.mtimeMs}`);
    return seen.size;
  });
  console.log(`${c.label.padEnd(34)} ${c.ms.toFixed(0).padStart(7)} ms\n`);

  // How much would each strategy actually collapse? This is the correctness
  // question: a cheap key that over-merges would silently hide real games.
  const bySize = new Map();
  stats.forEach((st, i) => {
    const k = st.size;
    if (!bySize.has(k)) bySize.set(k, []);
    bySize.get(k).push(i);
  });
  const sizeCollisionGroups = [...bySize.values()].filter(v => v.length > 1);
  const filesInCollision = sizeCollisionGroups.reduce((a, v) => a + v.length, 0);

  console.log('dedupe key analysis');
  console.log(`  distinct sizes                 ${bySize.size}`);
  console.log(`  size-collision groups          ${sizeCollisionGroups.length}`);
  console.log(`  files needing a real hash      ${filesInCollision}  ` +
              `(${(100 * filesInCollision / files.length).toFixed(1)}% of corpus)`);
  const collisionBytes = sizeCollisionGroups
    .flat().reduce((a, i) => a + stats[i].size, 0);
  console.log(`  bytes to hash if size-gated    ${(collisionBytes / 1048576).toFixed(0)} MB ` +
              `(vs ${(totalBytes / 1048576).toFixed(0)} MB)`);
  console.log(`  distinct (size,mtime) pairs    ${c.result}`);
};

main();
