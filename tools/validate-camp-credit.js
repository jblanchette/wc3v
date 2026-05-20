//
// validate-camp-credit.js — evidence-based tuning harness for the per-player
// creep-camp credit determination (Project C).
//
// Read-only. Compares the parser-exported `world.neutralGroups[*].playerCredit`
// against user-supplied expected outcomes so the CAMP_CREDIT_MODELS /
// IN_CAMP_PADDING / leash constants in lib/NeutralGroup.js can be tuned until
// the deltas shrink.
//
// Usage:
//   node tools/validate-camp-credit.js --fixtures=client/data/camp-fixtures.json
//   node tools/validate-camp-credit.js --fixtures=... --replay=happy-vs-grubby
//   node tools/validate-camp-credit.js --fixtures=... --threshold=0.8
//   node tools/validate-camp-credit.js --fixtures=... --verbose
//
// Fixture format (client/data/camp-fixtures.json):
// {
//   "replays": [
//     { "id": "happy-vs-grubby",
//       "camps": [
//         { "match": { "totalLevel": 8,
//                      "units": ["Murloc Tide Runner","Murloc Huntsman"] },
//           "expect": {
//             "players": {
//               "1": { "credited": true,  "interactionCount": ">=2",
//                      "effectiveMs": ">=12000", "share": "0.40..0.70" },
//               "2": { "credited": false }
//             } } } ] } ]
// }
//
// Comparator tokens for expected values:
//   true / false                 boolean exact
//   123                          numeric exact
//   ">=N" "<=N" ">N" "<N" "==N"  numeric comparison
//   "A..B"                       inclusive numeric range
//

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

if (!args.fixtures) {
  console.error('Usage: node tools/validate-camp-credit.js --fixtures=client/data/camp-fixtures.json [--replay=NAME] [--threshold=0.8] [--verbose]');
  process.exit(2);
}

const threshold = args.threshold ? parseFloat(args.threshold) : 0.0;
const verbose = !!args.verbose;

const loadReplay = (id) => {
  const base = path.join(__dirname, '..', 'client', 'replays', id);
  if (fs.existsSync(`${base}.wc3v`)) {
    return JSON.parse(fs.readFileSync(`${base}.wc3v`, 'utf8'));
  }
  if (fs.existsSync(`${base}.wc3v.gz`)) {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(`${base}.wc3v.gz`)).toString());
  }
  return null;
};

// match a fixture camp to a parsed neutralGroup by level + unit-name multiset
const findCamp = (groups, match) => {
  const want = (match.units || []).slice().sort();
  return Object.values(groups).find(g => {
    if (match.totalLevel != null && g.totalLevel !== match.totalLevel) return false;
    if (!want.length) return true;
    const have = (g.units || []).map(u => u.displayName).sort();
    // every wanted name appears in the camp (subset match — robust to dupes)
    return want.every(w => have.includes(w));
  });
};

// evaluate one expected token against an actual value -> { pass, why }
const check = (actual, expected) => {
  if (typeof expected === 'boolean') {
    return { pass: !!actual === expected, why: `${actual} (want ${expected})` };
  }
  if (typeof expected === 'number') {
    return { pass: actual === expected, why: `${actual} (want ==${expected})` };
  }
  const s = String(expected).trim();
  const num = Number(actual);
  let m;
  if ((m = s.match(/^(>=|<=|==|>|<)\s*(-?\d+(?:\.\d+)?)$/))) {
    const t = parseFloat(m[2]);
    const ops = { '>=': num >= t, '<=': num <= t, '==': num === t, '>': num > t, '<': num < t };
    return { pass: ops[m[1]], why: `${actual} (want ${s})` };
  }
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)$/))) {
    const lo = parseFloat(m[1]), hi = parseFloat(m[2]);
    return { pass: num >= lo && num <= hi, why: `${actual} (want ${lo}..${hi})` };
  }
  return { pass: String(actual) === s, why: `${actual} (want ${s})` };
};

const fixtures = JSON.parse(fs.readFileSync(path.resolve(args.fixtures), 'utf8'));
let replays = fixtures.replays || [];
if (args.replay) replays = replays.filter(r => r.id === args.replay);

let totalChecks = 0, passChecks = 0;
let credTP = 0, credFP = 0, credFN = 0, credTN = 0; // credited confusion matrix

replays.forEach(rf => {
  const data = loadReplay(rf.id);
  if (!data) {
    console.log(`\n[SKIP] ${rf.id}: .wc3v(.gz) not found`);
    return;
  }
  const groups = (data.world && data.world.neutralGroups) || {};
  console.log(`\n=== ${rf.id} ===`);

  (rf.camps || []).forEach((cf, ci) => {
    const g = findCamp(groups, cf.match || {});
    if (!g) {
      console.log(`  Camp #${ci + 1} (${JSON.stringify(cf.match)}): NO MATCH in parsed data`);
      return;
    }
    const label = `Camp #${ci + 1} Lv${g.totalLevel} [${(g.units || []).map(u => u.displayName).join(', ')}]`;
    console.log(`  ${label}`);

    const pc = g.playerCredit || {};
    Object.entries(cf.expect.players || {}).forEach(([pid, exp]) => {
      const got = pc[pid];
      if (!got) {
        console.log(`    p${pid}: NO per-player credit in parsed data (want ${JSON.stringify(exp)})`);
        totalChecks += Object.keys(exp).length;
        return;
      }
      const flat = Object.assign({ credited: got.credited, confidence: got.confidence,
        uncertain: got.uncertain }, got.measured || {});

      Object.entries(exp).forEach(([key, want]) => {
        totalChecks++;
        const res = check(flat[key], want);
        if (res.pass) passChecks++;
        if (key === 'credited') {
          const a = !!flat.credited, e = want === true;
          if (a && e) credTP++; else if (a && !e) credFP++;
          else if (!a && e) credFN++; else credTN++;
        }
        if (!res.pass || verbose) {
          console.log(`    p${pid}.${key}: ${res.pass ? 'PASS' : 'FAIL'} — ${res.why}`);
        }
      });
      if (verbose && got.whyNot) console.log(`      whyNot: ${got.whyNot}`);
    });
  });
});

const acc = totalChecks ? (passChecks / totalChecks) : 1;
const prec = (credTP + credFP) ? credTP / (credTP + credFP) : 1;
const rec = (credTP + credFN) ? credTP / (credTP + credFN) : 1;

console.log(`\n──────── SUMMARY ────────`);
console.log(`checks: ${passChecks}/${totalChecks} passed (${(acc * 100).toFixed(1)}%)`);
console.log(`credited: TP=${credTP} FP=${credFP} FN=${credFN} TN=${credTN} ` +
  `precision=${(prec * 100).toFixed(1)}% recall=${(rec * 100).toFixed(1)}%`);

if (acc < threshold) {
  console.log(`FAIL: accuracy ${(acc * 100).toFixed(1)}% < threshold ${(threshold * 100).toFixed(1)}%`);
  process.exit(1);
}
process.exit(0);
