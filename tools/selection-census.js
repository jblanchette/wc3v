/**
 * selection-census.js — how big selections actually get on the wire.
 *
 * Patch 3.0 (build 7000) raised the selection and control-group cap from 12 to
 * 24. The count field was always u16, so nothing in the FORMAT changed; what
 * might have changed is how a 13-24 unit selection is emitted, and the
 * selection rule in Player.changeSelection was tuned on games that never
 * exceeded 12. This answers the format question before anyone touches the
 * rule.
 *
 * No simulation. Header + action stream through w3gjs only, so it runs in well
 * under a second per replay and a pre-3.0 batch is a free control group.
 *
 * What it counts, per replay and split by build (< 7000 vs >= 7000):
 *   - 0x17 AssignGroupHotkey sizes. Ctrl+N lists the player's whole selection,
 *     so this is ground truth for how large selections get.
 *   - 0x16 ChangeSelection sizes, by mode (1 = select/add, 2 = deselect).
 *   - BURSTS: two or more mode-1 0x16 from one player in one timeslot. If the
 *     game split a big selection across actions, it shows up here.
 *   - the selection-action shape right before every Ctrl+N over 12
 *     (--examples=N prints them).
 *
 * Usage:
 *   node tools/selection-census.js --dir=crawl/download
 *   node tools/selection-census.js --dir=replays --examples=5
 *   node tools/selection-census.js replays/a.w3g replays/b.w3g
 *   node tools/selection-census.js --dir=crawl/download --min-build=7000
 */

const fs = require('fs');
const path = require('path');

const { ReplayParser } = require('w3gjs');
const { isW3gLike } = require('./lib/replay-peek');

const args = {};
const files = [];
process.argv.slice(2).forEach((raw) => {
  if (!raw.startsWith('--')) { files.push(raw); return; }
  const [f, ...v] = raw.replace(/^--/, '').split('=');
  args[f] = v.length ? v.join('=') : true;
});

const PATCH_BUILD = 7000;
const OLD_CAP = 12;
const EXAMPLES = args.examples ? parseInt(args.examples, 10) : 0;
const MIN_BUILD = args['min-build'] ? parseInt(args['min-build'], 10) : 0;
// Selection actions kept per player, for printing the lead-up to a big Ctrl+N.
const HISTORY = 6;
// Ctrl+N is retransmitted ~120-250ms later with the same units; count it once.
const RETRANSMIT_MS = 300;

if (args.dir && args.dir !== true) {
  const dir = path.resolve(String(args.dir));
  for (const f of fs.readdirSync(dir)) {
    if (/\.(w3g|nwg)$/i.test(f)) files.push(path.join(dir, f));
  }
}
if (!files.length) {
  console.error('usage: node tools/selection-census.js --dir=DIR | FILE... [--examples=N] [--min-build=N]');
  process.exit(1);
}

const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;

const bucketOf = (n) => (n <= OLD_CAP ? '1-12' : n <= 24 ? '13-24' : '25+');
const BUCKETS = ['1-12', '13-24', '25+'];

const blankTally = () => ({
  replays: 0,
  assign: { '1-12': 0, '13-24': 0, '25+': 0 },
  select: { '1-12': 0, '13-24': 0, '25+': 0 },
  deselect: { '1-12': 0, '13-24': 0, '25+': 0 },
  maxAssign: 0,
  maxSelect: 0,
  bursts: 0,
  burstsOver12: 0,
  countMismatch: 0,
  replaysWithBig: 0
});

const unitKey = (u) => (Array.isArray(u) ? u.join(':') : String(u));

const describe = (a) => {
  if (a.id === 0x16) return `0x16 mode=${a.selectMode} n=${a.numberUnits}`;
  if (a.id === 0x17) return `0x17 grp=${a.groupNumber} n=${a.numberUnits}`;
  if (a.id === 0x18) return `0x18 grp=${a.groupNumber}`;
  if (a.id === 0x19) return `0x19 subgroup ${a.itemId}`;
  if (a.id === 0x1a) return '0x1a presubselect';
  return `0x${a.id.toString(16)}`;
};

const censusOne = async (file) => {
  const buf = fs.readFileSync(file);
  if (!isW3gLike(buf)) return { file, error: 'not a replay' };

  const r = {
    file, build: null, version: null, tally: blankTally(), examples: []
  };
  const t = r.tally;
  const history = new Map();     // playerId -> [{at, text}]
  const lastAssign = new Map();  // playerId -> {at, key}
  let globalTime = 0;
  let big = false;

  const parser = new ReplayParser();
  parser.on('basic_replay_information', (info) => {
    r.build = info.subheader ? info.subheader.buildNo : null;
    r.version = info.subheader ? info.subheader.version : null;
  });

  parser.on('gamedatablock', (block) => {
    if (block.timeIncrement) globalTime += block.timeIncrement;
    for (const cb of block.commandBlocks || []) {
      const pid = cb.playerId;
      let addsThisSlot = 0;
      let addUnitsThisSlot = 0;
      for (const a of cb.actions || []) {
        if (a.id < 0x16 || a.id > 0x1a) continue;

        if (a.id === 0x16 || a.id === 0x17) {
          const n = a.numberUnits;
          if (!Array.isArray(a.units) || a.units.length !== n) t.countMismatch += 1;
          if (a.id === 0x16) {
            const side = a.selectMode === 2 ? t.deselect : t.select;
            side[bucketOf(n)] += 1;
            if (a.selectMode !== 2) {
              t.maxSelect = Math.max(t.maxSelect, n);
              addsThisSlot += 1;
              addUnitsThisSlot += n;
            }
          } else {
            const key = (a.units || []).map(unitKey).sort().join(',');
            const prev = lastAssign.get(pid);
            const retransmit = prev && prev.key === key && globalTime - prev.at <= RETRANSMIT_MS;
            lastAssign.set(pid, { at: globalTime, key });
            if (!retransmit) {
              t.assign[bucketOf(n)] += 1;
              t.maxAssign = Math.max(t.maxAssign, n);
              if (n > OLD_CAP) {
                big = true;
                if (r.examples.length < EXAMPLES) {
                  r.examples.push({
                    at: globalTime,
                    pid,
                    n,
                    lead: (history.get(pid) || []).slice()
                  });
                }
              }
            }
          }
        }

        const h = history.get(pid) || [];
        h.push({ at: globalTime, text: describe(a) });
        if (h.length > HISTORY) h.shift();
        history.set(pid, h);
      }
      if (addsThisSlot >= 2) {
        t.bursts += 1;
        if (addUnitsThisSlot > OLD_CAP) t.burstsOver12 += 1;
      }
    }
  });

  try {
    await parser.parse(buf);
  } catch (err) {
    // Whatever was read before a w3gjs throw still counts; say so.
    r.error = 'parse stopped: ' + (err && err.message ? err.message : String(err));
  }
  t.replays = 1;
  t.replaysWithBig = big ? 1 : 0;
  return r;
};

const addInto = (acc, t) => {
  acc.replays += t.replays;
  acc.replaysWithBig += t.replaysWithBig;
  for (const k of ['assign', 'select', 'deselect']) {
    for (const b of BUCKETS) acc[k][b] += t[k][b];
  }
  acc.maxAssign = Math.max(acc.maxAssign, t.maxAssign);
  acc.maxSelect = Math.max(acc.maxSelect, t.maxSelect);
  acc.bursts += t.bursts;
  acc.burstsOver12 += t.burstsOver12;
  acc.countMismatch += t.countMismatch;
};

const row = (label, h) => `${label.padEnd(10)}` + BUCKETS.map((b) => String(h[b]).padStart(8)).join('');

const printTally = (title, t) => {
  console.log(`\n${title}  (${t.replays} replays, ${t.replaysWithBig} with a Ctrl+N over ${OLD_CAP})`);
  if (!t.replays) return;
  console.log(`${''.padEnd(10)}` + BUCKETS.map((b) => b.padStart(8)).join(''));
  console.log(row('Ctrl+N', t.assign));
  console.log(row('select', t.select));
  console.log(row('deselect', t.deselect));
  console.log(`max Ctrl+N ${t.maxAssign}   max single select ${t.maxSelect}`);
  console.log(`multi-select timeslots ${t.bursts}   of which > ${OLD_CAP} units total ${t.burstsOver12}`);
  if (t.countMismatch) console.log(`!! ${t.countMismatch} actions whose unit list length != numberUnits`);
};

(async () => {
  const pre = blankTally();
  const post = blankTally();
  const failed = [];

  for (const f of files) {
    const r = await censusOne(f);
    if (r.error && !r.tally) { failed.push(`${path.basename(f)}: ${r.error}`); continue; }
    if (r.build != null && r.build < MIN_BUILD) continue;

    const t = r.tally;
    const isPost = r.build != null && r.build >= PATCH_BUILD;
    addInto(isPost ? post : pre, t);

    console.log(
      `${path.basename(f).slice(0, 60).padEnd(60)} build ${String(r.build).padStart(5)}  ` +
      `Ctrl+N max ${String(t.maxAssign).padStart(2)} (${t.assign['13-24']} over 12)  ` +
      `select max ${String(t.maxSelect).padStart(2)}  bursts ${t.bursts}/${t.burstsOver12}` +
      (r.error ? `  [${r.error}]` : '')
    );
    for (const ex of r.examples) {
      console.log(`    ${fmt(ex.at)} p${ex.pid} Ctrl+N n=${ex.n}, preceded by:`);
      for (const l of ex.lead) console.log(`      ${fmt(l.at)}  ${l.text}`);
    }
  }

  printTally(`build < ${PATCH_BUILD}`, pre);
  printTally(`build >= ${PATCH_BUILD}`, post);
  if (failed.length) {
    console.log(`\n${failed.length} unreadable:`);
    failed.forEach((l) => console.log('  ' + l));
  }
})();
