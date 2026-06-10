//
// SettlementClear — building-placement ground truth for gold-mine creep camps.
//
// Neutral creep-camp clears are ESTIMATED (the replay format records no creep
// deaths), so every verdict is a guess tuned against evidence. But one thing is
// not a guess: you cannot place a building amid living creeps — they aggro and
// attack it. So when a player settles a building IN or AROUND a creep camp that
// guards a gold mine (the classic expansion: a town hall dropped onto the mine),
// that building is hard proof the camp was already cleared, by that player, no
// later than the moment the building went down.
//
// This pass runs AFTER NeutralGroup.calculateClaims() (so clearedTime /
// playerCredit / playerCreditTimeline exist) and BEFORE assignCampOrder. For
// each gold-mine-guarding camp it finds the earliest settling building and, if
// one exists, treats the camp as a CONFIRMED clear by that builder's team:
//
//   • clearedTime  → clamped to an upper bound (≤ the building's placement
//                    time; tightened to the last observed engagement before it).
//   • claimState   → cleared, owned by the builder's team.
//   • playerCredit → the builder is THE clearer (credited, high confidence, not
//                    uncertain); other players' `credited` is cleared for this
//                    camp. A `settled` flag + reason explain the verdict.
//   • a `settledClear` record + `guardsGoldMine` flag are stamped for the UI.
//
// Mutates the live NeutralGroup instances in world.neutralGroups; the new fields
// are serialized by NeutralGroup.exportGroup(). Self-contained (no utils/mappings
// require) so it stays cheap in the browser parser bundle.
//

// Buildings that, by their very nature, can only stand on a CLEARED gold mine:
// town halls of every tier (built directly on the mine) plus the Undead Haunted
// Gold Mine, which is literally the mine itself once haunted. Mirrors the
// expansion building set in Player.js, keyed by itemId for O(1) lookup. These
// get the looser "near the mine" test; any other building must sit inside the
// camp footprint to count.
const EXPANSION_SETTLER_IDS = new Set([
  'htow', 'hkee', 'hcas',   // Human  Town Hall / Keep / Castle
  'ogre', 'ostr', 'ofrt',   // Orc    Great Hall / Stronghold / Fortress
  'etol', 'etoa', 'etoe',   // NE     Tree of Life / Ages / Eternity
  'unpl', 'unp1', 'unp2',   // UD     Necropolis (all tiers)
  'ugol'                    // UD     Haunted Gold Mine (the strongest signal)
]);

// NeutralGroup.ClaimStates.cleared — kept local to avoid exporting the enum.
const CLAIM_CLEARED = 2;

// Geometry thresholds (WC3 world units). A camp "guards" a mine when the mine
// sits within GUARD_RADIUS of the camp's tight footprint. An expansion building
// settles the camp when it lands within SETTLE_MINE_RADIUS of that mine; any
// building settles it when it lands within SETTLE_CAMP_PAD of the footprint.
const GUARD_RADIUS = 900;
const SETTLE_MINE_RADIUS = 768;   // ~ town-hall footprint half-extent on the mine
const SETTLE_CAMP_PAD = 320;

// A confirmed clear is near-ground-truth, but the EXACT clear time is still
// inferred (upper-bounded by the building), so we surface high — not perfect —
// confidence rather than claiming certainty we don't have.
const SETTLED_CONFIDENCE = 0.95;

// Same clearing-work estimate NeutralGroup uses, so a synthesized contribution
// reads like a real one (used only to keep contributionMs > 0 for ordering).
const PER_LEVEL_MS = 2400;
const FOUNTAIN_FACTOR = 1.75;

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// Shortest distance from a point to an axis-aligned bounding box (0 if inside).
const distPointToAabb = (px, py, b) => {
  const dx = px < b.minX ? (b.minX - px) : (px > b.maxX ? px - b.maxX : 0);
  const dy = py < b.minY ? (b.minY - py) : (py > b.maxY ? py - b.maxY : 0);
  return Math.hypot(dx, dy);
};

const requiredMsFor = (camp) =>
  PER_LEVEL_MS * (camp.totalLevel || 1) * (camp.hasFountain ? FOUNTAIN_FACTOR : 1);

const SettlementClear = class {
  constructor (world, wc3vPlayers) {
    this.world = world;
    this.players = Object.values(wc3vPlayers || {});
  }

  run () {
    const stats = { guardsGoldMine: 0, settled: 0, camps: [] };
    const world = this.world;
    if (!world || !world.neutralGroups) return stats;

    const neutral = this.players.find(p => p && p.isNeutralPlayer);
    const goldMines = (neutral ? neutral.units : [])
      .filter(u => u && u.itemId === 'ngol' && u.currentX != null && u.currentY != null);
    if (!goldMines.length) return stats;

    // every real-player building with a resolved position, earliest first so
    // the FIRST building to settle a camp is the one we attribute the clear to.
    const buildings = [];
    this.players.forEach(p => {
      if (!p || p.isNeutralPlayer) return;
      if (Number(p.id) >= 24) return;   // observer / custom slots
      (p.units || []).forEach(u => {
        if (!u || !u.isBuilding) return;
        if (u.currentX == null || u.currentY == null) return;
        if (u.currentX === 0 && u.currentY === 0) return;  // unresolved position
        buildings.push({
          x: u.currentX, y: u.currentY,
          time: u.spawnTime || 0,
          itemId: u.itemId,
          name: u.displayName || u.itemId,
          playerId: Number(p.id),
          teamId: p.teamId
        });
      });
    });
    buildings.sort((a, b) => a.time - b.time);

    Object.values(world.neutralGroups).forEach(camp => {
      const b = camp.unitBounds || camp.bounds;
      if (!b) return;

      // nearest gold mine this camp guards
      let mine = null, mineDist = Infinity;
      goldMines.forEach(gm => {
        const d = distPointToAabb(gm.currentX, gm.currentY, b);
        if (d < mineDist) { mineDist = d; mine = gm; }
      });
      if (!mine || mineDist > GUARD_RADIUS) return;

      camp.guardsGoldMine = true;
      camp.goldMinePos = { x: Math.round(mine.currentX), y: Math.round(mine.currentY) };
      stats.guardsGoldMine++;

      // earliest building that settles this camp
      const settler = buildings.find(bld => {
        const isExpansion = EXPANSION_SETTLER_IDS.has(bld.itemId);
        const nearMine = isExpansion &&
          dist(bld.x, bld.y, mine.currentX, mine.currentY) <= SETTLE_MINE_RADIUS;
        const inCamp = distPointToAabb(bld.x, bld.y, b) <= SETTLE_CAMP_PAD;
        return nearMine || inCamp;
      });
      if (!settler) return;

      this._applySettle(camp, settler, mine);
      stats.settled++;
      stats.camps.push({
        uuid: camp.uuid,
        playerId: settler.playerId,
        building: settler.itemId,
        gameTime: settler.time
      });
    });

    return stats;
  }

  _applySettle (camp, settler, mine) {
    const pid = String(settler.playerId);
    const isExpansion = EXPANSION_SETTLER_IDS.has(settler.itemId);
    const settleTime = settler.time;

    // ── clear time: a hard upper bound, tightened where we can ──────────────
    // The camp was cleared no later than the building's placement. If we saw
    // anyone actually fighting here before then, the last such moment is a
    // tighter estimate of when the creeps actually died; otherwise fall back to
    // the building time itself.
    let clearEstimate = settleTime;
    const engagedBefore = (camp.perPlayerEvents || [])
      .filter(e => e && e.zone !== 'out' && e.gameTime <= settleTime)
      .reduce((mx, e) => Math.max(mx, e.gameTime), -1);
    if (engagedBefore > 0) clearEstimate = engagedBefore;

    camp.clearedTime = (camp.clearedTime != null)
      ? Math.min(camp.clearedTime, clearEstimate)
      : clearEstimate;

    // ── claim state: confirmed clear, owned by the builder's team ───────────
    camp.claimState = CLAIM_CLEARED;
    camp.claimOwnerId = Number(settler.teamId);
    if (camp.claimTime == null) camp.claimTime = camp.clearedTime;

    // ── per-player credit: the builder is THE clearer ───────────────────────
    const reason = isExpansion
      ? `${settler.name} was built on this camp's gold mine — the creeps had to be cleared first.`
      : `A building was placed inside this camp — the creeps had to be cleared first.`;

    const pc = camp.playerCredit = camp.playerCredit || {};
    const existing = pc[pid] || null;
    const prevMeasured = (existing && existing.measured) || {};
    const requiredMs = Math.round(requiredMsFor(camp));
    const contributionMs = (prevMeasured.contributionMs > 0)
      ? prevMeasured.contributionMs : requiredMs;
    const campXpPool = camp.campXpPool || 0;

    const reasons = (existing && Array.isArray(existing.confidenceReasons))
      ? existing.confidenceReasons.slice() : [];
    const settleNote = 'a building was placed here — a confirmed clear';
    if (reasons.indexOf(settleNote) === -1) reasons.push(settleNote);

    pc[pid] = {
      playerId: Number(pid),
      teamId: Number(settler.teamId),
      credited: true,
      confidence: Math.max(SETTLED_CONFIDENCE, (existing && existing.confidence) || 0),
      uncertain: false,
      confidenceReasons: reasons,
      criteria: [
        { key: 'settled', label: 'Building placed on this camp', pass: true, measured: 1, required: 1 },
        { key: 'hero', label: 'Cleared first (creeps block building)', pass: true, measured: 1, required: 1 },
        { key: 'share', label: 'Share of the clear', pass: true, measured: 100, required: 15, unit: '%' }
      ],
      whyNot: null,
      settled: true,
      settledReason: reason,
      leashSource: existing ? existing.leashSource : (camp.leashSource || null),
      measured: Object.assign({}, prevMeasured, {
        contributionMs,
        contributionShare: 1,
        estimatedXp: Math.max(prevMeasured.estimatedXp || 0, campXpPool),
        heroPresent: true
      })
    };

    // On a settled camp the builder owns it outright — no one else gets to
    // build there. Demote any other player's `credited` so the verdict is crisp
    // (their pre-clear contribution measurements are left untouched).
    Object.keys(pc).forEach(k => {
      if (k !== pid && pc[k]) pc[k].credited = false;
    });

    // ── live timeline: ensure the ring fills for the builder's team ─────────
    // If the credit model never gave this player a share (e.g. the camp looked
    // un-cleared, or was credited to the opponent), append a single snapshot at
    // the clear so the map ring + creep-hide flip to the confirmed owner.
    const tl = camp.playerCreditTimeline = camp.playerCreditTimeline || [];
    const hasShare = tl.some(s =>
      s && s.players && s.players[pid] && s.players[pid].contributionShare > 0);
    if (!hasShare) {
      tl.push({
        gameTime: camp.clearedTime,
        players: { [pid]: { contributionMs, contributionShare: 1, credited: true } }
      });
      tl.sort((a, b) => a.gameTime - b.gameTime);
    }

    // ── UI record ───────────────────────────────────────────────────────────
    camp.settledClear = {
      playerId: Number(pid),
      teamId: Number(settler.teamId),
      buildingItemId: settler.itemId,
      buildingName: settler.name,
      isExpansion,
      gameTime: settleTime,
      goldMine: { x: Math.round(mine.currentX), y: Math.round(mine.currentY) },
      reason
    };
  }
};

module.exports = SettlementClear;
