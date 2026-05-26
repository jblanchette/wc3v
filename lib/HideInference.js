/**
 * HideInference — heuristic Night Elf Shadowmeld detection.
 *
 * Limitations (verified against `hide-test.w3g`):
 *
 *   • W3Champions/Reforged replays drop action 0x10
 *     (UnitBuildingAbilityActionNoParams) entirely, which is where manual
 *     shadowmeld lives. So intentional manual casts cannot be detected from
 *     the action stream in these replays — only from circumstantial silence.
 *   • Pro players rarely sit units idle long enough for auto-shadowmeld to
 *     be a meaningful tell, so the heuristic produces near-zero true
 *     positives on competitive replays. Intentional scouting hides (e.g.
 *     archer left behind expansion) are the main real-world case.
 *
 * Heuristic (strict):
 *   • Unit's itemId is in SHADOWMELD_UNITS (excludes wisps, ancients, air
 *     units that lack the ability)
 *   • Path silence gap ≥ HIDE_MIN_DURATION_MS (long enough to be deliberate)
 *   • No enemy units have a path sample within HIDE_ENEMY_VIS_WU of the
 *     unit's last position during the gap
 *
 * Output per-unit: hiddenStream: [{ start, end, confidence }, ...]
 */

const HIDE_MIN_DURATION_MS = 12 * 1000;   // pros don't idle briefly — bar set high
const HIDE_ENEMY_VIS_WU = 1500;           // enemies within this distance break the hide

// NE ground units that have Shadowmeld. Source: WC3 unit data.
// Excludes: wisps (ewsp — no shadowmeld), ancients/buildings (uproot ≠ hide),
// air units (cannot shadowmeld in flight). Heroes are included individually.
const SHADOWMELD_UNITS = new Set([
  // Ground units
  'earc',  // Archer
  'esen',  // Huntress
  'ebal',  // Glaive Thrower
  'edoc',  // Druid of the Claw (caster form)
  'edot',  // Druid of the Talon (caster form)
  'edry',  // Dryad
  'emtg',  // Mountain Giant
  'esha',  // Shandris (campaign)
  // Heroes
  'Edem',  // Demon Hunter
  'Ekee',  // Keeper of the Grove
  'Emoo',  // Priestess of the Moon
  'Ewar',  // Warden
  'Earc',  // (alt hero code variant)
  'Efur',  // (alt)
]);

function canShadowmeld (unit) {
  if (!unit || !unit.itemId) return false;
  return SHADOWMELD_UNITS.has(unit.itemId);
}

class HideInference {
  constructor (playerManager) {
    this.playerManager = playerManager;
    this.stats = {
      neUnits: 0,
      windowsDetected: 0,
      totalHideTimeMs: 0
    };
  }

  run () {
    const allPlayers = Object.values(this.playerManager.players || {});

    // Build a flat array of enemy paths for cheap proximity check. "Enemy"
    // = any unit owned by another player (we don't currently know team in
    // this context, so all-other-players counts).
    const enemyPathsByUnitByOwner = [];
    for (const player of allPlayers) {
      for (const unit of (player.units || [])) {
        if (unit.path && unit.path.length) {
          enemyPathsByUnitByOwner.push({
            ownerId: player.id,
            unit,
            path: unit.path
          });
        }
      }
    }

    for (const player of allPlayers) {
      for (const unit of (player.units || [])) {
        if (!canShadowmeld(unit)) continue;
        if (unit.isBuilding) continue;
        if (unit.isIllusion) continue;
        this.stats.neUnits++;

        const windows = this._findHideWindows(unit, player.id, enemyPathsByUnitByOwner);
        if (windows.length) {
          unit.hiddenStream = windows;
          for (const w of windows) this.stats.totalHideTimeMs += (w.end - w.start);
          this.stats.windowsDetected += windows.length;
        }
      }
    }
    return this.stats;
  }

  _findHideWindows (unit, ownerId, enemyPathsByUnitByOwner) {
    const path = unit.path || [];
    if (path.length < 2) return [];
    const windows = [];

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const gap = b.gameTime - a.gameTime;
      if (gap < HIDE_MIN_DURATION_MS) continue;
      if (a.isJump || b.isJump) continue;

      // Check enemy proximity during gap. If any enemy path sample falls
      // within HIDE_ENEMY_VIS_WU of (a.x, a.y) during [a.gameTime, b.gameTime],
      // the unit was likely engaged, not hiding.
      let enemyNear = false;
      for (const e of enemyPathsByUnitByOwner) {
        if (e.ownerId === ownerId) continue;       // own units don't count
        const ep = e.path;
        for (const s of ep) {
          if (s.gameTime < a.gameTime) continue;
          if (s.gameTime > b.gameTime) break;
          const dx = s.x - a.x;
          const dy = s.y - a.y;
          if (dx * dx + dy * dy < HIDE_ENEMY_VIS_WU * HIDE_ENEMY_VIS_WU) {
            enemyNear = true;
            break;
          }
        }
        if (enemyNear) break;
      }
      if (enemyNear) continue;

      // Confidence scales with gap length: 6s → ~50, 30s+ → 90.
      const conf = Math.round(Math.min(90, 40 + Math.min(1, gap / 30000) * 50));
      windows.push({
        start: a.gameTime,
        end: b.gameTime,
        confidence: conf
      });
    }
    return windows;
  }
}

module.exports = HideInference;
