/*
 * passes — inference orchestrator. Runs the look-behind / look-ahead /
 * cross-player / fixpoint / commit passes over each Player's ClaimRegistry
 * once the action stream has been fully consumed (post-parse, before
 * output write).
 *
 * Strategy contract (each strategy module under lib/inference/strategies/):
 *
 *   module.exports = {
 *     name:         'actionLocality',          // identifier (for evidence.source)
 *     subjects:     ['teleport'],              // claim subjects this applies to
 *     phase:        'look-ahead',              // when to run
 *     score(claim, ctx) -> Evidence[] | null   // returns new evidence to add
 *   };
 *
 * `score` returns evidence opts (objects shaped for makeEvidence). The
 * orchestrator calls registry.addEvidence for each. Strategies never
 * mutate claims or registries directly — they're pure scoring functions.
 *
 * The commit phase is special: it does mutate Player state by invoking
 * `commitTeleport(player, claim)` etc. — that's where the deferred side
 * effects (caster.teleportTo, addEvent('teleportScroll'), combat signals)
 * finally fire, but only for claims that settled at `likely`/`confirmed`.
 */

const ClaimRegistry = require('./ClaimRegistry');
const thresholdsTable = require('../../helpers/claimThresholds.json');

const PHASES = ['look-behind', 'look-ahead', 'cross-player', 'commit-prep'];
const MAX_FIXPOINT_PASSES = 8;

// Every strategy under lib/inference/strategies/, listed explicitly.
//
// This MUST stay a static list of literal requires. It used to be a
// readdirSync scan over the strategies directory with a dynamic
// `require(path.join(dir, f))`, which broke the browser parser bundle two
// ways at once, both silent:
//   1. esbuild cannot statically resolve a computed require, so not one
//      strategy file was ever included in the bundle; and
//   2. the bundle's fs stub returns existsSync() === false, so the loop
//      never ran anyway.
// The result was an inference layer that scored zero evidence for every
// claim in the browser — uploaded replays disagreed with server-parsed ones
// on teleport confirmation, item provenance and every other claim verdict.
//
// Adding a strategy? Add its require here too, or it silently won't run.
const STRATEGY_MODULES = [
  require('./strategies/actionLocality'),
  require('./strategies/crossPlayerSighting'),
  require('./strategies/eventCorrelation'),
  require('./strategies/inventoryProvenance'),
  require('./strategies/outcomeConsistency'),
  require('./strategies/pathTrajectoryConsistency'),
  require('./strategies/recentPurchaseContradiction'),
  require('./strategies/rejectedItemBackfill')
];

let _strategies = null;
function loadStrategies () {
  if (_strategies) return _strategies;
  const list = [];
  for (const mod of STRATEGY_MODULES) {
    if (!mod || !mod.name || !mod.subjects || !mod.phase || typeof mod.score !== 'function') {
      console.logger && console.logger(`passes: skipping malformed strategy ${mod && mod.name}`);
      continue;
    }
    list.push(mod);
  }
  _strategies = list;
  return list;
}

// Pick thresholds for a given claim subject. The threshold table is keyed
// by `type` (e.g. 'teleport', 'itemUse'); claim subjects are dotted paths
// where the first segment after the player prefix is the type. Falls back
// to 'default'.
//   subject='p2.teleport@132231'  → type='teleport'
//   subject='p2.itemUse@132231.s1' → type='itemUse'
function thresholdsForSubject (subject) {
  if (typeof subject !== 'string') return thresholdsTable.default;
  const parts = subject.split('.');
  // parts[0] = 'p2', parts[1] = type (e.g. 'teleport', 'itemUse').
  const type = parts[1] || 'default';
  return thresholdsTable[type] || thresholdsTable.default;
}

// Run a single phase across all relevant strategies for all claims in
// the registry. Returns number of evidence items added.
function runPhase (phase, player, ctx) {
  const strategies = loadStrategies().filter(s => s.phase === phase);
  if (!strategies.length) return 0;
  const registry = player._claimRegistry;
  if (!registry) return 0;
  let added = 0;
  for (const claim of registry.iterate()) {
    // Subject prefix match: a strategy declaring subjects:['teleport']
    // applies to any claim whose subject's type segment is 'teleport'.
    const parts = claim.subject.split('.');
    const type = parts[1];
    for (const strat of strategies) {
      if (!strat.subjects.includes(type)) continue;
      let evidence;
      try {
        evidence = strat.score(claim, ctx);
      } catch (e) {
        console.logger && console.logger(`passes: strategy ${strat.name} threw on claim ${claim.id}:`, e);
        continue;
      }
      if (!evidence) continue;
      const list = Array.isArray(evidence) ? evidence : [evidence];
      for (const e of list) {
        // Auto-stamp the strategy name as evidence.source when omitted.
        if (e.source == null) e.source = strat.name;
        registry.addEvidence(claim.id, e);
        added++;
      }
    }
  }
  return added;
}

// Run the fixpoint pass: walk dirty set, recompute confidence using the
// per-subject threshold table, cascade dependents. Repeat until stable
// or MAX_FIXPOINT_PASSES — escape hatch logged via the convergence flag.
function runFixpoint (player, ctx) {
  const registry = player._claimRegistry;
  if (!registry) return { iterations: 0, converged: true };
  let iterations = 0;
  let converged = false;
  while (iterations < MAX_FIXPOINT_PASSES) {
    const dirty = registry.takeDirty();
    if (!dirty.size) { converged = true; break; }
    iterations++;
    for (const claimId of dirty) {
      const claim = registry.getClaim(claimId);
      if (!claim) continue;
      const thresholds = thresholdsForSubject(claim.subject);
      registry.recomputeConfidence(claimId, thresholds, {
        pass: 4,
        gameTime: ctx.gameTime,
        source: 'fixpoint',
        note: `iter=${iterations}`
      });
    }
  }
  if (!converged) {
    // One last drain — even if not converged we want the final
    // confidences computed from current evidence so the commit pass
    // sees something coherent.
    const leftover = registry.takeDirty();
    for (const claimId of leftover) {
      const claim = registry.getClaim(claimId);
      if (!claim) continue;
      registry.recomputeConfidence(claimId, thresholdsForSubject(claim.subject), {
        pass: 4, gameTime: ctx.gameTime, source: 'fixpoint-cap', note: 'cap-reached'
      });
    }
  }
  return { iterations, converged };
}

// runAll(playerManager, opts?) — entry point invoked from
// PlayerManager.afterParse() (or wherever post-processing fires). Walks
// every player in turn through all five passes. Cross-player phase uses
// the shared world / other players via the context object.
function runAll (playerManager, opts) {
  opts = opts || {};
  const finalGameTime = (playerManager && playerManager.eventTimer && playerManager.eventTimer.timer)
    ? playerManager.eventTimer.timer.gameTime
    : -1;
  const players = (playerManager && playerManager.players) || [];
  const allPlayers = Array.isArray(players) ? players : Object.values(players);

  // Make sure every player has a registry (even if zero claims) so
  // downstream consumers can read consistently.
  for (const p of allPlayers) {
    if (!p._claimRegistry) p._claimRegistry = new ClaimRegistry();
  }

  // Build a per-player context once, shared across phases.
  const summary = { players: {}, convergence: {} };

  // Phase 1, 2, 3 — strategies emit evidence; fixpoint resolves rungs.
  for (const phase of ['look-behind', 'look-ahead', 'cross-player', 'commit-prep']) {
    for (const p of allPlayers) {
      const ctx = {
        player: p,
        otherPlayers: allPlayers.filter(o => o !== p),
        playerManager,
        gameTime: finalGameTime,
        phase
      };
      runPhase(phase, p, ctx);
    }
  }

  // Fixpoint per player. Independent — no inter-player claim deps yet.
  for (const p of allPlayers) {
    const ctx = { player: p, playerManager, gameTime: finalGameTime };
    const res = runFixpoint(p, ctx);
    summary.convergence[p.id] = res;
    summary.players[p.id] = {
      claims: p._claimRegistry.size(),
      converged: res.converged,
      iterations: res.iterations
    };
  }

  // Commit pass — invoke each player's claim-commit handlers. The Player
  // class registers handlers per claim subject prefix (e.g. 'teleport').
  // commitClaims is added in Player.js as part of the migration.
  for (const p of allPlayers) {
    if (typeof p.commitClaims === 'function') {
      p.commitClaims();
    }
  }

  return summary;
}

module.exports = {
  runAll,
  runPhase,
  runFixpoint,
  loadStrategies,
  thresholdsForSubject,
  MAX_FIXPOINT_PASSES,
  PHASES
};
