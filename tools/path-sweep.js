//
// path-sweep.js — ground-truth movement check across many replays, POOLED.
//
// Pro replays barely use pure MoveCommand (pros right-click), so per-player
// strict buckets are tiny/noisy. Instead we pool every evaluable command
// across all replays/players into one large sample and report robust stats:
//   • strict point-move (MoveCommand): convergence + positional accuracy
//   • speed (ANY converged command over a meaningful distance): a unit that
//     reaches a clicked point HAS moved there, so its net speed is a valid
//     "do units move at the right speed" sample regardless of command kind.
//
// Usage:
//   node tools/path-sweep.js                 (built-in diverse default set)
//   node tools/path-sweep.js --replays=a,b,c
//
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = {};
process.argv.slice(2).forEach(r => { const [f, ...v] = r.replace(/^--/, '').split('='); args[f] = v.join('=') || true; });

const DEFAULT = [
  'happy-vs-grubby',
  '116430527_FoCuS_Moon_TwistedMeadows11',
  '1031906232_FoCuS_Eer0_Springtime13',
  '1020568240_Soin_Life_EchoIsles22',
  '1342775468_Kaho_Happy_Hammerfall',
  '1168111252_War3Orcer0_LawLiet_ConcealedHill',
  '1174595027_Pcg123_Inspired_ShatteredExile'
];
const replays = (args.replays ? String(args.replays).split(',') : DEFAULT).map(s => s.trim()).filter(Boolean);

const SAMP = path.join(require('os').tmpdir(), `wc3v-pathsweep-${process.pid}.jsonl`);
try { fs.unlinkSync(SAMP); } catch (e) {}

for (const r of replays) {
  try { execSync(`node wc3v.js --replay=${r} --move-trace`, { stdio: 'ignore' }); }
  catch (e) { console.log(`PARSE FAIL ${r}`); continue; }
  for (const p of ['1', '2']) {
    try {
      execSync(`node tools/path-debug.js --replay=${r} --player=${p} --combat --verify --samples=${SAMP}`,
        { stdio: 'ignore' });
    } catch (e) { /* still wrote samples up to failure */ }
  }
}

const lines = fs.existsSync(SAMP) ? fs.readFileSync(SAMP, 'utf8').trim().split('\n').filter(Boolean) : [];
const S = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
try { fs.unlinkSync(SAMP); } catch (e) {}

const pctl = (a, q) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const med = a => pctl(a, .5);

// strict pure point-move: must reach target
const strict = S.filter(s => s.kind === 'move');
const strictConv = strict.length ? 100 * strict.filter(s => s.conv).length / strict.length : NaN;
const strictPos = strict.filter(s => s.conv).map(s => s.pos);

// speed: any converged command over a meaningful distance (it moved there)
const spd = S.filter(s => s.conv && s.speedEligible).map(s => s.netSpeed);
const tr = S.filter(s => s.conv && s.speedEligible).map(s => s.timeRatio);

// per-replay strict convergence (visibility)
const byRep = {};
strict.forEach(s => { (byRep[s.replay] = byRep[s.replay] || []).push(s); });

console.log('\n================ POOLED MOVEMENT GROUND-TRUTH (' + replays.length + ' replays) ================');
console.log(`\nSTRICT pure point-move (MoveCommand):`);
console.log(`  samples=${strict.length}  converged≤160u=${isNaN(strictConv) ? 'n/a' : strictConv.toFixed(1) + '%'}  ` +
  `posErr median=${Math.round(med(strictPos))}u p90=${Math.round(pctl(strictPos, .9))}u`);
console.log(`\nSPEED — any converged command, distance≥600u (did units move at movespeed?):`);
console.log(`  samples=${spd.length}`);
console.log(`  net-speed vs movespeed: median=${med(spd).toFixed(3)}  p10=${pctl(spd, .1).toFixed(3)}  p90=${pctl(spd, .9).toFixed(3)}`);
console.log(`  travel-time / straight-ideal: median=${med(tr).toFixed(3)}  p90=${pctl(tr, .9).toFixed(3)}`);

console.log(`\nper-replay strict converged:`);
Object.keys(byRep).forEach(r => {
  const a = byRep[r]; const c = 100 * a.filter(s => s.conv).length / a.length;
  console.log(`  ${r.slice(0, 44).padEnd(46)} n=${String(a.length).padStart(3)}  ${c.toFixed(0)}%`);
});

const sm = med(spd);
const ok = !isNaN(strictConv) && strictConv >= 85 && sm >= 0.93 && sm <= 1.07 && med(strictPos) <= 90;
console.log(`\nRESULT: ${ok ? 'PASS' : 'REVIEW'}  ` +
  `(want: strict conv≥85%, pooled net-speed 0.93-1.07, strict posMed≤90u)`);
process.exit(ok ? 0 : 1);
