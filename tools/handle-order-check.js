/**
 * handle-order-check.js — does a selection handle's second word rise with the
 * order units were created in?
 *
 * Selection actions name units by a handle pair (itemId1, itemId2). The parser
 * only learns which unit a handle belongs to from per-unit hints (a subgroup
 * focus, a lone unknown of the right type), and a 24-unit box-select gives
 * almost none: at 13-24 units, as few as a third of selected handles reach a
 * unit, while the player has enough unbound units of their own to cover them
 * (order-trace --selcheck, "handles bound"). If itemId2 is a creation counter,
 * unbound handles can be matched to unbound units by order instead of guessed.
 *
 * This grades that against the units the parser DID bind: for each player,
 * rank correlation between itemId2 and spawnTime, and how often a later-made
 * unit carries a smaller itemId2 (an inversion), overall and per unit type.
 *
 * --grade checks the bindings themselves. A SELECT naming exactly one handle,
 * followed in the same tick by a SelectSubgroup, states that handle's true
 * unit type. At each such moment, compare it with the type of the unit the
 * parser has bound to that handle, split by which binder made the binding.
 * --handle-order turns on Player.bindHandlesByCreationOrder for the run.
 *
 * Usage:
 *   node tools/handle-order-check.js --replay=NAME [--detail]
 *   node tools/handle-order-check.js --replay=NAME --grade [--handle-order]
 */

const fs = require('fs');
const path = require('path');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

if (!args.replay) {
  console.error('Usage: node tools/handle-order-check.js --replay=NAME [--detail]');
  process.exit(1);
}

if (typeof console.logger !== 'function') console.logger = () => {};

const config = require('../config/config');
if (args['handle-order']) config.handleOrderBinding = true;

const utils = require('../helpers/utils');
const PlayerManager = require('../lib/PlayerManager');
const { doParsing } = require('../wc3v.js');

// --grade samples: (player, handle) -> true type, graded against our binding.
const grade = {
  order: { n: 0, right: 0, wrong: [] },
  other: { n: 0, right: 0, wrong: [] },
  unbound: 0
};
const lastSingle = {};   // playerId -> { gameTime, handle } of a 1-unit SELECT

const typeMatches = (unit, type) =>
  unit.itemId === type || (unit.morphHistory || []).some(m => m.itemId === type) ||
  unit._formBaseItemId === type;

let manager = null;
const origHandle = PlayerManager.prototype.handleAction;
PlayerManager.prototype.handleAction = function (actionBlock, action) {
  manager = this;
  if (args.grade) {
    const pid = actionBlock.playerId;
    const player = this.players[pid];
    const gameTime = this.eventTimer.timer.gameTime;
    if (action.id === 0x16 && action.selectMode !== 2) {
      const units = action.actions || [];
      lastSingle[pid] = units.length === 1
        ? { gameTime, handle: units[0] } : null;
    } else if (action.id === 0x19 && player && lastSingle[pid] && lastSingle[pid].gameTime === gameTime) {
      const { handle } = lastSingle[pid];
      lastSingle[pid] = null;
      const type = utils.fixItemId(action.itemId);
      const unit = player.findUnit(handle.itemId1, handle.itemId2);
      if (!unit) {
        grade.unbound++;
      } else {
        const g = unit.boundByCreationOrder ? grade.order : grade.other;
        g.n++;
        if (typeMatches(unit, type)) g.right++;
        else g.wrong.push({ gameTime, pid, had: unit.itemId, truth: type });
      }
    }
  }
  return origHandle.apply(this, arguments);
};

const replayPath = path.join(__dirname, '..', 'replays', `${args.replay}.w3g`);
if (!fs.existsSync(replayPath)) {
  console.error(`not found: ${replayPath}`);
  process.exit(1);
}

// Spearman rank correlation, average ranks for ties.
const ranks = (xs) => {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
};
const spearman = (a, b) => {
  if (a.length < 3) return null;
  const ra = ranks(a), rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
};

// Share of pairs made at different times whose itemId2 order disagrees.
const inversions = (rows) => {
  let pairs = 0, bad = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[i].t === rows[j].t) continue;
      pairs++;
      const early = rows[i].t < rows[j].t ? rows[i] : rows[j];
      const late = early === rows[i] ? rows[j] : rows[i];
      if (late.h < early.h) bad++;
    }
  }
  return { pairs, bad };
};

const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

const realLog = console.log;
console.log = () => {};
doParsing(replayPath, {}).then(() => {
  console.log = realLog;
  report();
}).catch(err => {
  console.log = realLog;
  console.error(err);
  process.exit(1);
});

function report () {
  if (!manager) { console.log('no actions handled'); return; }
  if (args.grade) {
    console.log(`\n=== BINDING GRADE (replay=${args.replay}${args['handle-order'] ? ' handle-order' : ''}) ===`);
    console.log('  sample = a 1-unit SELECT + same-tick SelectSubgroup naming its type');
    [['creation-order binder', grade.order], ['all other binders', grade.other]].forEach(([label, g]) => {
      console.log(`  ${label.padEnd(22)} n=${String(g.n).padStart(5)}  right ${g.n ? (100 * g.right / g.n).toFixed(1) : '-'}%`);
    });
    console.log(`  handle unbound at the sample     ${grade.unbound}`);
    if (args.detail) {
      grade.order.wrong.slice(0, 15).forEach(w =>
        console.log(`    ${fmt(w.gameTime)} p${w.pid} bound to ${w.had}, truth ${w.truth}`));
    }
    console.log('');
    return;
  }
  console.log(`\n=== HANDLE ORDER vs CREATION ORDER (replay=${args.replay}) ===`);

  Object.values(manager.players).forEach(player => {
    if (!player || !player.units) return;
    const rows = player.units
      .filter(u => u.itemId1 !== null && u.itemId2 !== null && !u.isSpawnedAtStart && !u.isIllusion)
      .map(u => ({ h: Number(u.itemId2), slot: Number(u.itemId1), t: u.spawnTime, type: u.itemId, name: u.displayName, building: !!u.isBuilding }))
      .filter(r => Number.isFinite(r.h) && Number.isFinite(r.t))
      .sort((a, b) => a.t - b.t);
    if (rows.length < 3) return;

    const rho = spearman(rows.map(r => r.h), rows.map(r => r.t));
    const inv = inversions(rows);
    console.log(`\n  player ${player.id}  bound non-start units ${rows.length}  ` +
      `spearman ${rho == null ? '-' : rho.toFixed(3)}  inversions ${inv.bad}/${inv.pairs} ` +
      `(${inv.pairs ? (100 * inv.bad / inv.pairs).toFixed(1) : '-'}%)`);

    const nonBld = rows.filter(r => !r.building);
    const invU = inversions(nonBld);
    console.log(`    units only        ${nonBld.length}  inversions ${invU.bad}/${invU.pairs} ` +
      `(${invU.pairs ? (100 * invU.bad / invU.pairs).toFixed(1) : '-'}%)`);

    const byType = {};
    nonBld.forEach(r => { (byType[r.type] = byType[r.type] || []).push(r); });
    Object.entries(byType)
      .filter(([, list]) => list.length >= 3)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8)
      .forEach(([type, list]) => {
        const i = inversions(list);
        console.log(`    ${type} ${list[0].name.padEnd(18)} n=${String(list.length).padStart(3)}  ` +
          `inversions ${i.bad}/${i.pairs}`);
      });

    if (args.detail) {
      rows.forEach(r => console.log(`      ${fmt(r.t)}  ${String(r.slot).padStart(6)}/${String(r.h).padEnd(8)} ${r.type} ${r.name}`));
    }
  });
  console.log('');
}
