/**
 * order-trace.js — command-level telemetry for the movement simulator.
 *
 * The question this answers: "of every order the replay actually issued, which
 * ones did the parser act on, and which ones did it silently drop?"
 *
 * `moveTrace` (config.moveTrace) only records commands that REACHED
 * PlayerActions.moveSelectedUnits — by construction it cannot show you a
 * dropped order. This tool instruments one level up, at
 * PlayerManager.handleAction, so every action block is logged whether or not
 * it produced any simulation effect. Each line reports:
 *
 *   time  action-id/name  order-name  flags  target  selection  ->  EFFECT
 *
 * where EFFECT is what the parser did with it: move(N units), cancel, order
 * records, or DROPPED (no observable state change). A `DROPPED` line whose
 * order name is a real movement command is a parser bug.
 *
 * It re-parses the .w3g from replays/ — it does NOT read the exported .wc3v,
 * because dropped orders leave no trace in the export. Nothing is written.
 *
 * Usage:
 *   node tools/order-trace.js --replay=NAME --player=2
 *   node tools/order-trace.js --replay=NAME --player=2 --from=2:30 --to=4:00
 *   node tools/order-trace.js --replay=NAME --player=2 --unit="death knight"
 *   node tools/order-trace.js --replay=NAME --summary       (per-order-name tally)
 *   node tools/order-trace.js --replay=NAME --dropped       (only dropped orders)
 */

const fs = require('fs');
const path = require('path');

const args = {};
process.argv.slice(2).forEach(raw => {
  const [flag, ...rest] = raw.replace(/^--/, '').split('=');
  args[flag] = rest.join('=') || true;
});

if (!args.replay) {
  console.error('Usage: node tools/order-trace.js --replay=NAME [--player=ID] [--from=M:SS] [--to=M:SS] [--unit=TEXT] [--summary] [--dropped]');
  process.exit(1);
}

const parseAt = (v) => {
  if (v == null || v === true) return null;
  const s = String(v);
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    return (parseInt(m, 10) * 60 + parseFloat(sec)) * 1000;
  }
  return parseFloat(s) * 1000;
};

const FROM = parseAt(args.from);
const TO = parseAt(args.to);
const PID = args.player != null && args.player !== true ? String(args.player) : null;
const UNIT_MATCH = args.unit && args.unit !== true ? String(args.unit).toLowerCase() : null;
const ONLY_DROPPED = !!args.dropped;
const SUMMARY_ONLY = !!args.summary;

const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;

// ---------------------------------------------------------------------------
// Instrumentation. Everything below wraps existing methods; no parser file is
// modified, so a trace run and a normal run produce identical .wc3v output.
// ---------------------------------------------------------------------------

// The parser calls console.logger everywhere; the CLI installs it via
// logManager.setLogger()/init(). We don't want a log file, so install the same
// no-op shim client/js/parser/shims.js uses for the browser build.
if (typeof console.logger !== 'function') console.logger = () => {};

// --rule=NAME runs the parse under a candidate selection rule so the same
// --selcheck report can be produced for each and compared. See config.js.
const config = require('../config/config');
if (args.rule && args.rule !== true) config.selectionRule = String(args.rule);

const utils = require('../helpers/utils');
const mappings = require('../helpers/mappings');
const PlayerManager = require('../lib/PlayerManager');
const PlayerActions = require('../lib/PlayerActions');
const Unit = require('../lib/Unit');
const { ActionBlockNames } = require('../lib/ActionBlock');

const { abilityActions } = mappings;

// The action ids that carry a unit ORDER (as opposed to chat, selection, etc).
// These are the only ones whose itemId field is an order constant.
const ORDER_ACTION_IDS = new Set([16, 17, 18, 20]);

const trace = [];       // one entry per handled action
let current = null;     // the entry being filled while a handler runs

const orderNameOf = (action) => {
  const itemId = action.itemId;
  if (!Array.isArray(itemId)) {
    // 4-char string itemId — a build/train/research order, not a movement one.
    return typeof itemId === 'string' ? `unit:${itemId}` : null;
  }
  const known = utils.findItemIdForObject(itemId, abilityActions);
  if (known) return known;
  // Not in our table. Decode the raw 0x000Dxxxx order constant so an unmapped
  // movement order is identifiable by number instead of vanishing.
  const [b0, b1, b2, b3] = itemId.map(b => b & 0xff);
  const raw = (b3 << 24) | (b2 << 16) | (b1 << 8) | b0;
  if ((raw & 0xffff0000) === 0x000d0000) return `UNMAPPED_ORDER(0x${raw.toString(16)})`;
  return `unknown(${itemId.join(',')})`;
};

// --- effect probes ---------------------------------------------------------

const origMove = PlayerActions.moveSelectedUnits;
PlayerActions.moveSelectedUnits = function (player, targetX, targetY, opts = {}) {
  if (current) {
    const units = player.getSelectionUnits().filter(u => u && !u.isBuilding);
    current.effects.push(`move(${units.length}u kind=${opts.kind || 'smart'}` +
      `${opts.orderKind ? '/' + opts.orderKind : ''} -> ${Math.round(targetX)},${Math.round(targetY)})`);
    current.movedUnits = units.map(u => u.displayName);
  }
  return origMove.apply(this, arguments);
};

const origRecordOrder = Unit.prototype.recordOrder;
Unit.prototype.recordOrder = function (gameTime, kind, opts) {
  const before = this.orders ? this.orders.length : 0;
  const r = origRecordOrder.apply(this, arguments);
  if (current && this.orders && this.orders.length > before) {
    current.effects.push(`order(${this.displayName}:${kind})`);
  }
  return r;
};

// A form change (Call to Arms, Statue->Destroyer, burrow) is a real effect
// even though the unit neither moves nor takes an order.
const origMorphTo = Unit.prototype.morphTo;
Unit.prototype.morphTo = function (itemId) {
  const from = this.displayName;
  const r = origMorphTo.apply(this, arguments);
  if (current && r) current.effects.push(`morph(${from} -> ${this.displayName})`);
  return r;
};

const origCheckState = Unit.prototype.checkStateForMove;
Unit.prototype.checkStateForMove = function () {
  if (current && this.state !== 'idle') {
    current.effects.push(`cancelMove(${this.displayName} was ${this.state})`);
  }
  return origCheckState.apply(this, arguments);
};

// The retransmit dedup drops an action before any handler runs. That is a
// deliberate drop, not a bug, so the trace has to tell the two apart.
let dedupFlag = false;
const origDedup = PlayerManager.prototype._isDuplicateAbilityAction;
PlayerManager.prototype._isDuplicateAbilityAction = function () {
  const r = origDedup.apply(this, arguments);
  if (r) dedupFlag = true;
  return r;
};

const selNames = (player) => {
  if (!player || !player.selection) return { reg: [], raw: 0 };
  return {
    reg: player.getSelectionUnits().filter(u => u).map(u => u.displayName),
    raw: player.selection.units.length
  };
};

const origHandle = PlayerManager.prototype.handleAction;
PlayerManager.prototype.handleAction = function (actionBlock, action) {
  const actionName = ActionBlockNames[action.id];
  const gameTime = this.eventTimer.timer.gameTime;
  const player = this.players[actionBlock.playerId];

  const before = selNames(player);
  dedupFlag = false;

  const entry = {
    gameTime,
    playerId: String(actionBlock.playerId),
    actionId: action.id,
    actionName: actionName || `UNKNOWN(0x${action.id.toString(16)})`,
    orderName: ORDER_ACTION_IDS.has(action.id) ? orderNameOf(action) : null,
    abilityFlags: action.abilityFlags,
    targetX: action.targetX,
    targetY: action.targetY,
    objectId1: action.objectId1,
    objectId2: action.objectId2,
    groupNumber: action.groupNumber,
    selectMode: action.selectMode,
    // AssignGroupHotkey (0x17) is the one action that STATES the player's
    // selection: Ctrl+N assigns whatever is selected, and the replay lists
    // those units. That makes it free ground truth for selection tracking —
    // see the --selcheck report.
    actionUnits: Array.isArray(action.actions)
      ? action.actions.map(u => `${u.itemId1}/${u.itemId2}`) : null,
    // What we THOUGHT was selected, in the same id space, for the comparison.
    selectionIds: player && player.selection
      ? player.selection.units.map(u => `${u.itemId1}/${u.itemId2}`) : [],
    selection: before.reg,
    selectionRaw: before.raw,
    selectionAfter: null,
    selectionRawAfter: 0,
    deduped: false,
    effects: [],
    movedUnits: null
  };

  const prev = current;
  current = entry;
  try {
    return origHandle.apply(this, arguments);
  } finally {
    current = prev;
    const after = selNames(this.players[actionBlock.playerId]);
    entry.selectionAfter = after.reg;
    entry.selectionRawAfter = after.raw;
    entry.deduped = dedupFlag;
    dedupFlag = false;
    trace.push(entry);
  }
};

// ---------------------------------------------------------------------------

const { doParsing } = require('../wc3v.js');

const replayPath = path.join(__dirname, '..', 'replays', `${args.replay}.w3g`);
if (!fs.existsSync(replayPath)) {
  console.error(`not found: ${replayPath}`);
  process.exit(1);
}

// Silence the parser's own reporting so the trace is the only output.
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
  let rows = trace;
  if (PID) rows = rows.filter(r => r.playerId === PID);
  if (FROM != null) rows = rows.filter(r => r.gameTime >= FROM);
  if (TO != null) rows = rows.filter(r => r.gameTime <= TO);
  if (UNIT_MATCH) {
    const hit = (n) => (n || '').toLowerCase().includes(UNIT_MATCH);
    rows = rows.filter(r =>
      r.selection.some(hit) || (r.selectionAfter || []).some(hit));
  }

  // An action is DROPPED when it produced no observable simulation effect.
  // Selection/chat/hotkey actions legitimately produce none, so only ORDER
  // actions are eligible.
  rows.forEach(r => {
    r.dropped = ORDER_ACTION_IDS.has(r.actionId) && r.effects.length === 0 && !r.deduped;
  });

  // --- selection accuracy against AssignGroupHotkey ground truth -----------
  //
  // Ctrl+N assigns the CURRENT selection, and the replay spells out which units
  // that was. So at every one of these actions we get to check our tracked
  // selection against what the game says was really selected. Any mismatch
  // means orders in the window before it went to the wrong units.
  if (args.selcheck) {
    // Drop retransmitted assigns before grading. These replays re-send every
    // action ~120-250ms later; PlayerManager dedups ABILITY actions only, so a
    // Ctrl+N arrives twice. The second copy is not a second oracle sample: by
    // then an interleaved hotkey press may legitimately have changed our
    // selection, so counting it scores the parser against a selection the
    // player no longer had. Same (player, group, unit list) inside the window
    // is one press.
    const ASSIGN_RETRANSMIT_MS = 300;
    const lastAssign = new Map();
    let retransmits = 0;
    const cases = rows.filter(r => {
      if (r.actionName !== 'AssignGroupHotkeyAction' || !r.actionUnits) return false;
      const sig = `${r.playerId}|${r.groupNumber}|${r.actionUnits.slice().sort().join(',')}`;
      const prev = lastAssign.get(sig);
      lastAssign.set(sig, r.gameTime);
      if (prev != null && (r.gameTime - prev) <= ASSIGN_RETRANSMIT_MS) {
        retransmits++;
        return false;
      }
      return true;
    });
    let exact = 0, subset = 0, wrong = 0;
    const misses = [];
    cases.forEach(r => {
      const truth = new Set(r.actionUnits);
      const ours = new Set(r.selectionIds);
      const missing = [...truth].filter(x => !ours.has(x));   // we didn't have it selected
      const extra = [...ours].filter(x => !truth.has(x));     // we wrongly had it selected
      if (!missing.length && !extra.length) { exact++; return; }
      if (!extra.length) { subset++; } else { wrong++; }
      misses.push({ r, missing, extra });
    });
    const n = cases.length;
    console.log(`\n=== SELECTION ACCURACY vs AssignGroupHotkey ground truth ` +
      `(replay=${args.replay}${PID ? ` player=${PID}` : ''} rule=${config.selectionRule}) ===\n`);
    // Total actions is printed alongside so a differing `checks` count between
    // two runs is immediately attributable to a truncated parse rather than to
    // the rule under test.
    console.log(`  actions parsed       ${trace.length} (last t=${fmt(trace.length ? trace[trace.length - 1].gameTime : 0)})`);
    console.log(`  checks               ${n} (+${retransmits} retransmitted assigns ignored)`);
    if (n) {
      console.log(`  exact match          ${exact} (${(100 * exact / n).toFixed(1)}%)`);
      console.log(`  we missed units      ${subset} (${(100 * subset / n).toFixed(1)}%)  - orders under-applied`);
      console.log(`  we had wrong units   ${wrong} (${(100 * wrong / n).toFixed(1)}%)  - orders applied to units that were NOT selected`);
    }
    // Which units are wrongly held, and how often. A handful of ids dominating
    // the tally means a few units drift in and stick (a clearing bug); a long
    // flat tail means the combine rule itself is wrong.
    const stuck = {};
    misses.forEach(({ r, extra }) => extra.forEach(id => {
      if (!stuck[id]) stuck[id] = { n: 0, first: r.gameTime, last: r.gameTime, name: null };
      stuck[id].n++;
      stuck[id].last = r.gameTime;
      const idx = r.selectionIds.indexOf(id);
      if (idx >= 0 && r.selection[idx]) stuck[id].name = r.selection[idx];
    }));
    const stuckRows = Object.entries(stuck).sort((a, b) => b[1].n - a[1].n);
    if (stuckRows.length) {
      const totalExtra = stuckRows.reduce((s, [, v]) => s + v.n, 0);
      console.log(`\n  wrongly-held units: ${stuckRows.length} distinct, ${totalExtra} occurrences`);
      stuckRows.slice(0, 10).forEach(([id, v]) => {
        console.log(`    ${id.padEnd(16)} x${String(v.n).padStart(3)}  ` +
          `${fmt(v.first)}..${fmt(v.last)}  ${v.name || ''}`);
      });
    }

    if (!args.quiet) {
      console.log('');
      misses.slice(0, Number(args.limit) || 40).forEach(({ r, missing, extra }) => {
        console.log(`  [${fmt(r.gameTime)}] p${r.playerId} grp=${r.groupNumber}`);
        console.log(`      truth = [${r.actionUnits.join(' ')}]`);
        console.log(`      ours  = [${r.selectionIds.join(' ')}]  (${r.selection.join(',') || '-'})`);
        if (extra.length) console.log(`      WRONGLY SELECTED: ${extra.join(' ')}`);
        if (missing.length) console.log(`      missing:          ${missing.join(' ')}`);
      });
    }
    console.log('');
    return;
  }

  if (SUMMARY_ONLY) {
    const tally = {};
    rows.forEach(r => {
      const key = r.orderName || r.actionName;
      if (!tally[key]) tally[key] = { total: 0, dropped: 0, actionIds: new Set() };
      tally[key].total++;
      if (r.dropped) tally[key].dropped++;
      tally[key].actionIds.add(r.actionId);
    });
    console.log('\n=== ORDER SUMMARY ' +
      `(replay=${args.replay}${PID ? ` player=${PID}` : ''}) ===\n`);
    console.log('  ' + 'order/action'.padEnd(38) + 'total'.padStart(7) +
      'dropped'.padStart(9) + '   action-ids');
    Object.entries(tally)
      .sort((a, b) => b[1].total - a[1].total)
      .forEach(([name, t]) => {
        const flag = t.dropped > 0 ? '  <-- ' + Math.round(100 * t.dropped / t.total) + '% dropped' : '';
        console.log('  ' + name.padEnd(38) + String(t.total).padStart(7) +
          String(t.dropped).padStart(9) + '   ' + [...t.actionIds].join(',') + flag);
      });
    console.log('');
    return;
  }

  if (ONLY_DROPPED) rows = rows.filter(r => r.dropped);

  console.log('\n=== ORDER TRACE ' +
    `(replay=${args.replay}${PID ? ` player=${PID}` : ''}` +
    `${FROM != null ? ` from=${fmt(FROM)}` : ''}${TO != null ? ` to=${fmt(TO)}` : ''}) ===\n`);

  rows.forEach(r => {
    const tgt = Number.isFinite(r.targetX)
      ? ` @(${Math.round(r.targetX)},${Math.round(r.targetY)})` : '';
    const oid = (r.objectId1 != null && r.objectId1 !== -1)
      ? ` oid=${r.objectId1}/${r.objectId2}` : '';
    const flags = r.abilityFlags != null ? ` flags=0x${r.abilityFlags.toString(16)}` : '';
    const show = (names, raw) => names.length
      ? `[${names.slice(0, 6).join(',')}${names.length > 6 ? ',+' + (names.length - 6) : ''}]`
      : (raw ? `[${raw} unregistered]` : '[]');
    // Selection is printed as before->after so a select action's real result is
    // visible; unchanged selections print once.
    const b = show(r.selection, r.selectionRaw);
    const a = show(r.selectionAfter || [], r.selectionRawAfter);
    const sel = (a === b) ? ` sel=${b}` : ` sel=${b} -> ${a}`;
    const eff = r.effects.length
      ? r.effects.join(' ')
      : (r.deduped ? '(retransmit dedup)' : (r.dropped ? '!! DROPPED' : '-'));
    const label = r.orderName ? `${r.actionName}/${r.orderName}` : r.actionName;
    const grp = r.groupNumber != null ? ` grp=${r.groupNumber}` : '';
    const mode = r.selectMode != null
      ? ` mode=${r.selectMode === 1 ? 'SELECT' : r.selectMode === 2 ? 'DESELECT' : r.selectMode}` : '';
    const au = r.actionUnits
      ? ` units=[${r.actionUnits.slice(0, 8).join(' ')}${r.actionUnits.length > 8 ? ' +' + (r.actionUnits.length - 8) : ''}]`
      : '';

    console.log(`[${fmt(r.gameTime)}] p${r.playerId} ${label}${grp}${mode}${flags}${tgt}${oid}${au}${sel}`);
    console.log(`             => ${eff}`);
  });

  const dropped = rows.filter(r => r.dropped).length;
  console.log(`\n  ${rows.length} actions shown, ${dropped} dropped.\n`);
}
