/**
 * CollisionWorld — owns runtime collision state for the parser.
 *
 *   • Static obstacles:    delegates to PathFinder's grid (terrain WPM +
 *                          doodads + stamped buildings). When a building is
 *                          built/destroyed we update the grid cell-by-cell
 *                          using the per-building pathing.tga bitmap from
 *                          helpers/buildingPathing.json (or a rectangle
 *                          fallback for buildings without a bitmap).
 *   • Dynamic units:       rbush index keyed by uuid; updated on add/move/
 *                          remove. Used by isFree() / nearestFreeSpot() to
 *                          snap recorded positions out of other units.
 *
 * Unit.recordPosition() consults this object to ensure no two units share
 * the same coordinate. WC3 replays only record the player's CLICKED
 * destination, not the engine's collision-resolved position — so without
 * this layer recorded paths happily stack units on the same spot.
 *
 * Snap-to-free is the only enforcement here: we are NOT a tick-by-tick
 * crowd simulator. If a unit's intended position is occupied, we move it
 * to the nearest free spot within ~2x its collision radius and flag the
 * position record with `wasSnapped: true`.
 */

const rbush = require('rbush');

// Air units (movetp = "fly" | "hover" | "float" in UnitData.slk).
// These don't collide with ground units, so we skip adding them to the
// dynamic rbush entirely. List generated from tools/map-data/units/unitdata.slk
// — refresh by running:
//   node -e "const {parseSLK}=require('./helpers/slkParser'); \
//            const d=parseSLK('tools/map-data/units/unitdata.slk'); \
//            console.log(d.rows.filter(r=>['fly','hover','float'].includes(r.movetp)) \
//                              .map(r=>r.unitID).join(' '));"
const AIR_UNIT_IDS = new Set([
  // Air units & transports
  'hbot','hbsh','hdes','hdhw','hgry','hgyr','hphx','hsor','hshy',
  'obot','odes','otbr','owyv','oshy',
  'ebsh','echm','edes','edtm','efdr','ehip','ehpr','ewsp','eshy',
  'Ulic','uban','ubsp','ufro','ugar','uloc','uplg','ushd','uubs',
  'nwe1','nwe2','nwe3','nadk','nadr','nadw','nbdk','nbdr','nbot','nbwm','nbzd','nbzk','nbzw',
  'ndrv','ngdk','ngh1','ngh2','ngrd','ngrw','nhar','nhrh','nhrq','nhrr','nhrw',
  'nlrv','nndk','nndr','nnht','nrdk','nrdr','nrvd','nrvf','nrvi','nrvl','nrvs',
  'nrwm','nsrv','ntrv','nvde','nvdg','nvdl','nvdw','nwgs','nws1','nzep',
  'nalb','now2','now3','nowl','npnw','nshf','nshw','nsno','nvul','nshp',
  'etrs','nmdm','nser','nthr','ojgn','oswy','ownr','uarb','ubdd','ubdr','ubot','udes','uswb','zjug'
]);

// Per-cell pathing bit unpack — matches the layout written by
// tools/parse-building-pathing.js (row-major top-down, one bit per cell).
function unpackBitmap (b64, widthCells, heightCells) {
  if (!b64) return null;
  const buf = Buffer.from(b64, 'base64');
  const total = widthCells * heightCells;
  const out = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    out[i] = (buf[i >> 3] >> (i & 7)) & 1;
  }
  return out;
}

class CollisionWorld {
  constructor () {
    this.pathFinder = null;
    this.pathingManifest = {};   // itemId → pathing entry
    this._unpacked = {};         // itemId → Uint8Array (lazy)
    this.dynamicTree = new rbush();
    this.unitEntries = new Map(); // uuid → { minX, maxX, minY, maxY, unit, radius }
    this.snapStats = { calls: 0, snapped: 0, missed: 0, blockedByStatic: 0 };
  }

  attachPathFinder (pathFinder) {
    this.pathFinder = pathFinder;
  }

  loadManifest (manifest) {
    this.pathingManifest = (manifest && manifest.buildings) || {};
  }

  // ------------------------------------------------------------------
  // Buildings (static)
  // ------------------------------------------------------------------

  // Returns the manifest entry for an itemId, or null. Caller falls back to
  // PathFinder's rectangle-stamp on null (preserves legacy behaviour for
  // buildings without a pathTex column or with missing TGAs).
  getPathingEntry (itemId) {
    return this.pathingManifest[itemId] || null;
  }

  _unpackWalk (entry) {
    if (!entry) return null;
    const key = entry.sourceTex || JSON.stringify([entry.widthCells, entry.heightCells]);
    if (this._unpacked[key]) return this._unpacked[key];
    const bits = unpackBitmap(entry.blockedWalk, entry.widthCells, entry.heightCells);
    this._unpacked[key] = bits;
    return bits;
  }

  // Stamp a building's footprint onto the static pathing grid. Requires a
  // manifest entry — there is no fallback. If you hit this assertion, run
  // tools/parse-building-pathing.js (and extract the missing PathTextures
  // TGA from CASC if needed).
  stampBuilding (worldX, worldY, itemId) {
    if (!this.pathFinder) return;
    const entry = this.getPathingEntry(itemId);
    if (!entry) {
      throw new Error('CollisionWorld: no pathing manifest entry for itemId="' + itemId +
                      '". Re-run tools/parse-building-pathing.js.');
    }
    const bits = this._unpackWalk(entry);
    this.pathFinder.stampBitmap(worldX, worldY, bits, entry.widthCells, entry.heightCells, true);
    return entry;
  }

  unstampBuilding (worldX, worldY, itemId) {
    if (!this.pathFinder) return;
    const entry = this.getPathingEntry(itemId);
    if (!entry) {
      throw new Error('CollisionWorld: no pathing manifest entry for itemId="' + itemId + '"');
    }
    const bits = this._unpackWalk(entry);
    this.pathFinder.stampBitmap(worldX, worldY, bits, entry.widthCells, entry.heightCells, false);
  }

  // ------------------------------------------------------------------
  // Dynamic units
  // ------------------------------------------------------------------

  _radiusFor (unit) {
    return (unit.balanceInfo && unit.balanceInfo.collisionSize) || 0;
  }

  addUnit (unit) {
    if (!unit || unit._collisionEntry) return;
    // Buildings register via stampBuilding, not the dynamic tree.
    if (unit.isBuilding) return;
    // Air units don't collide with ground units (or each other meaningfully).
    if (AIR_UNIT_IDS.has(unit.itemId)) return;
    // Loaded transport passengers are inside the transport, not in the world.
    if (unit.loadedInto) return;
    const r = this._radiusFor(unit);
    if (r <= 0) return;
    const x = unit.currentX || 0;
    const y = unit.currentY || 0;
    const entry = {
      minX: x - r, maxX: x + r,
      minY: y - r, maxY: y + r,
      unit, radius: r
    };
    this.dynamicTree.insert(entry);
    this.unitEntries.set(unit.uuid, entry);
    unit._collisionEntry = entry;
  }

  removeUnit (unit) {
    if (!unit || !unit._collisionEntry) return;
    this.dynamicTree.remove(unit._collisionEntry);
    this.unitEntries.delete(unit.uuid);
    unit._collisionEntry = null;
  }

  moveUnit (unit, newX, newY) {
    if (!unit) return;
    const entry = unit._collisionEntry;
    if (!entry) return;
    this.dynamicTree.remove(entry);
    entry.minX = newX - entry.radius;
    entry.maxX = newX + entry.radius;
    entry.minY = newY - entry.radius;
    entry.maxY = newY + entry.radius;
    this.dynamicTree.insert(entry);
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  isStaticBlocked (worldX, worldY) {
    if (!this.pathFinder) return false;
    return this.pathFinder.isWorldBlocked(worldX, worldY);
  }

  // Returns false (= occupied) if any dynamic unit or static cell within the
  // unit's collision disc is blocked. ignoreUnit excludes the caller itself.
  isFree (worldX, worldY, radius, ignoreUnit = null) {
    if (this.isStaticBlocked(worldX, worldY)) return false;

    // Always sample the disc edge — the centre being on an open cell
    // doesn't mean the disc clears walls. Small-radius units (workers,
    // footmen at r=16) previously skipped this check, which let them snap
    // to "free" positions where their disc still overlapped a building's
    // pathing cells, causing client renderer flicker.
    const samples = 8;
    for (let i = 0; i < samples; i++) {
      const a = (Math.PI * 2 * i) / samples;
      const tx = worldX + Math.cos(a) * radius;
      const ty = worldY + Math.sin(a) * radius;
      if (this.isStaticBlocked(tx, ty)) return false;
    }

    const hits = this.dynamicTree.search({
      minX: worldX - radius, maxX: worldX + radius,
      minY: worldY - radius, maxY: worldY + radius
    });
    for (const h of hits) {
      if (ignoreUnit && h.unit === ignoreUnit) continue;
      const dx = worldX - h.unit.currentX;
      const dy = worldY - h.unit.currentY;
      const minDist = radius + h.radius;
      if (dx * dx + dy * dy < minDist * minDist) return false;
    }
    return true;
  }

  // Spiral search for nearest unblocked spot. Unbounded by default — we
  // always return a spot (the parser must never record an overlapping
  // position). Hard cap exists only as a sanity stop for runaway maps.
  nearestFreeSpot (worldX, worldY, radius, ignoreUnit = null, maxRadius = null) {
    const max = maxRadius != null ? maxRadius : 4096;  // ~32 tiles — should never hit
    if (this.isFree(worldX, worldY, radius, ignoreUnit)) {
      return { x: worldX, y: worldY };
    }
    const step = 16;  // half a pathing cell — fine enough to find tight gaps
    for (let r = step; r <= max; r += step) {
      const samples = Math.max(8, Math.ceil((Math.PI * 2 * r) / step));
      for (let i = 0; i < samples; i++) {
        const a = (Math.PI * 2 * i) / samples;
        const tx = worldX + Math.cos(a) * r;
        const ty = worldY + Math.sin(a) * r;
        if (this.isFree(tx, ty, radius, ignoreUnit)) {
          return { x: tx, y: ty };
        }
      }
    }
    return null;
  }

  // Called by Unit.recordPosition. Returns { x, y, snapped: bool }.
  resolvePosition (unit, x, y) {
    this.snapStats.calls++;
    const r = this._radiusFor(unit);
    if (r <= 0) return { x, y, snapped: false };

    if (this.isFree(x, y, r, unit)) {
      return { x, y, snapped: false };
    }

    // Unbounded — always find a spot. The "missed" bucket below is reserved
    // for the impossible case of the entire map being blocked (sanity check).
    const spot = this.nearestFreeSpot(x, y, r, unit);
    if (spot) {
      this.snapStats.snapped++;
      return { x: spot.x, y: spot.y, snapped: true };
    }
    this.snapStats.missed++;
    return { x, y, snapped: false };
  }

  logStats () {
    const s = this.snapStats;
    if (!s.calls) return;
    console.log('----------------------------------');
    console.log('COLLISION STATS');
    console.log('----------------------------------');
    console.log('resolvePosition calls: ' + s.calls);
    console.log('snapped:               ' + s.snapped +
                ' (' + ((s.snapped / s.calls) * 100).toFixed(1) + '%)');
    console.log('missed (no free spot): ' + s.missed);
    console.log('dynamic units indexed: ' + this.unitEntries.size);
  }
}

module.exports = CollisionWorld;
module.exports.unpackBitmap = unpackBitmap;
module.exports.AIR_UNIT_IDS = AIR_UNIT_IDS;
