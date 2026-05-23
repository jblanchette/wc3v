/*
 * CombatSignalTracker
 *
 * Per-Player collector of combat-intent signals captured from action handlers.
 * These signals are the input to BattleDetector (post-process). Pushing here
 * is cheap; the heavy work (proximity scan, clustering, tracker boxes) happens
 * once at end-of-parse.
 *
 * Determinism: signals are appended in the linear, monotonic action stream.
 * `finalize()` does a stable sort on a total key — same replay → same order.
 *
 * Shape of a signal (all fields optional unless marked required):
 *   {
 *     gameTime,                  // REQUIRED ms
 *     playerId,                  // REQUIRED actor player id
 *     actorTeamId,               // REQUIRED actor team id (for hostility math)
 *     actorUnitUuid,             // focus unit uuid if known
 *     actorUnitItemId,           // focus unit itemId (e.g. 'Hamg', 'hfoo')
 *     isHero, isCombatActor,     // booleans
 *     kind,                      // REQUIRED enum (see SIGNAL_KINDS)
 *     targetX, targetY,          // REQUIRED ground/target coordinates
 *     targetPlayerId,            // resolved enemy owner id (null if ground/self)
 *     targetTeamId,              // resolved enemy team id (null if ground/self)
 *     targetUnitUuid,            // resolved enemy unit uuid (null if ground)
 *     targetIsBuilding,          // bool
 *     spellAbilityId,            // for spell-* signals
 *     hostile,                   // REQUIRED bool — true iff cross-team or attack-ground
 *     selectionCount             // size of the actor's selection at command time
 *   }
 */

// Authoritative enum used by both tracker and detector. Adding/removing kinds
// is a schema change — update consumers when you do.
const SIGNAL_KINDS = Object.freeze({
  ATTACK_UNIT:              'attack-unit',
  ATTACK_GROUND:            'attack-ground',
  RIGHT_CLICK_ENEMY:        'right-click-enemy',
  RIGHT_CLICK_ENEMY_BLDG:   'right-click-enemy-building',
  SPELL_TARGET_UNIT:        'spell-target-unit',
  SPELL_TARGET_GROUND:      'spell-target-ground',
  SPELL_NO_TARGET:          'spell-no-target',
  PROXIMITY:                'proximity',          // synthesized by BattleDetector
  // Teleport — see helpers/teleportAbilities.js. Cast fires when the channel
  // begins, arrival fires when the unit actually appears at the destination
  // (cast time + channelMs). Both feed the clustering sweep.
  TELEPORT_CAST:            'teleport-cast',
  TELEPORT_ARRIVAL:         'teleport-arrival'
});

const KIND_ORDER = Object.freeze({
  'attack-unit': 0,
  'attack-ground': 1,
  'right-click-enemy': 2,
  'right-click-enemy-building': 3,
  'spell-target-unit': 4,
  'spell-target-ground': 5,
  'spell-no-target': 6,
  'teleport-cast': 7,
  'teleport-arrival': 8,
  'proximity': 9
});

const CombatSignalTracker = class {
  constructor (playerId) {
    this.playerId = playerId;
    this.signals = [];
    this._finalized = false;
  }

  record (signal) {
    // Cheap shape check — surface bugs early without exploding the parser.
    if (signal == null) return;
    if (signal.gameTime == null || signal.kind == null) {
      console.logger("combat-signal-tracker: dropping malformed signal", signal);
      return;
    }
    this.signals.push(signal);
  }

  // Stable, total-order sort. Called once at end-of-parse.
  finalize () {
    if (this._finalized) return this.signals;
    this.signals.sort(CombatSignalTracker.compareSignals);
    this._finalized = true;
    return this.signals;
  }

  static compareSignals (a, b) {
    if (a.gameTime !== b.gameTime) return a.gameTime - b.gameTime;
    const pa = a.playerId == null ? -1 : a.playerId;
    const pb = b.playerId == null ? -1 : b.playerId;
    if (pa !== pb) return pa - pb;
    const ua = a.actorUnitUuid || '';
    const ub = b.actorUnitUuid || '';
    if (ua !== ub) return ua < ub ? -1 : 1;
    const ka = KIND_ORDER[a.kind] == null ? 999 : KIND_ORDER[a.kind];
    const kb = KIND_ORDER[b.kind] == null ? 999 : KIND_ORDER[b.kind];
    return ka - kb;
  }
};

module.exports = CombatSignalTracker;
module.exports.SIGNAL_KINDS = SIGNAL_KINDS;
module.exports.KIND_ORDER = KIND_ORDER;
