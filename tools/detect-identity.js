/**
 * detect-identity.js — who does this replay folder belong to?
 *
 * Reads only replay HEADERS (no game parse, ~50 ms each) and counts how often
 * each player name appears. The account owner is in every game they played;
 * opponents appear once or twice. Across a sample the owner is unmistakable.
 *
 * This is the same algorithm the desktop app uses for identity detection, run
 * standalone so it can be checked against a real folder — getting it wrong
 * means every Victory is reported as a Defeat.
 *
 * Usage:
 *   node tools/detect-identity.js --dir="C:\path\to\Replays"
 *   node tools/detect-identity.js --dir=... --sample=40 [--all]
 *
 * Options:
 *   --sample=N  How many replays to read (default 40).
 *   --all       Include non-autosaved replays. Off by default: the Replays
 *               root also holds downloaded games the user was never in, which
 *               skew the count.
 *
 * Prints names and counts only — never a filesystem path.
 */

const fs = require('fs');
const path = require('path');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

if (!args.dir) {
  console.error('Usage: node tools/detect-identity.js --dir="<Replays folder>" [--sample=40] [--all]');
  process.exit(1);
}

const SAMPLE = parseInt(args.sample, 10) || 40;
const MIN_SHARE = 0.6;

// Reforged autosave naming: Replay_2026_07_18_1527.w3g
const isAutosaveName = (name) => /^Replay_\d{4}_\d{2}_\d{2}_\d{4}\.w3g$/i.test(name);

const walk = (dir, out) => {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.w3g')) out.push({ path: p, name: e.name });
  }
  return out;
};

const loadBundle = () => {
  const bundlePath = path.resolve(__dirname, '..', 'client', 'js', 'vendor', 'wc3v-parser.bundle.js');
  if (!fs.existsSync(bundlePath)) {
    console.error('Parser bundle not built. Run: npm run build:parser');
    process.exit(1);
  }
  const code = fs.readFileSync(bundlePath, 'utf8');
  return new Function(`${code}\n;return Wc3vParser;`)();
};

const main = async () => {
  const parser = loadBundle();
  if (typeof parser.peekPlayers !== 'function') {
    console.error('Bundle has no peekPlayers — run: npm run build:parser');
    process.exit(1);
  }

  let all = walk(args.dir, []);
  // Sub-20KB files are aborted lobbies with no real game in them.
  all = all.filter(f => { try { return fs.statSync(f.path).size >= 20 * 1024; } catch (e) { return false; } });
  const pool = args.all ? all : all.filter(f => isAutosaveName(f.name));

  console.log(`${all.length} replays found, ${pool.length} usable` +
    (args.all ? '' : ' (autosaved only)'));
  if (!pool.length) {
    console.log('nothing to sample — try --all');
    return;
  }

  // Spread across the whole history, not just the newest N.
  const step = Math.max(1, Math.floor(pool.length / SAMPLE));
  const sample = [];
  for (let i = 0; i < pool.length && sample.length < SAMPLE; i += step) sample.push(pool[i]);

  const counts = new Map();
  let read = 0, failed = 0;
  for (const f of sample) {
    try {
      const { players } = await parser.peekPlayers(fs.readFileSync(f.path));
      for (const p of players) {
        const key = p.name.toLowerCase().trim();
        if (!key) continue;
        const cur = counts.get(key) || { name: p.name, n: 0 };
        cur.n++;
        counts.set(key, cur);
      }
      read++;
    } catch (e) { failed++; }
  }

  console.log(`read ${read} headers${failed ? `, ${failed} unreadable` : ''}\n`);

  const ranked = [...counts.values()].sort((a, b) => b.n - a.n);
  console.log('name                          games   share');
  for (const r of ranked.slice(0, 12)) {
    console.log(`  ${r.name.padEnd(28)} ${String(r.n).padStart(4)}  ${String(Math.round((r.n / read) * 100)).padStart(4)}%`);
  }

  const top = ranked[0];
  if (!top) { console.log('\nno names found'); return; }
  const share = top.n / read;
  const clear = !ranked[1] || top.n > ranked[1].n;
  console.log('');
  if (share >= MIN_SHARE && clear) {
    console.log(`VERDICT: this folder belongs to "${top.name}" (${Math.round(share * 100)}% of sampled games)`);
  } else {
    console.log(`VERDICT: inconclusive — top name "${top.name}" is only in ` +
      `${Math.round(share * 100)}% of games. The app will ask instead of guessing.`);
  }
};

main().catch(e => { console.error(e); process.exit(1); });
