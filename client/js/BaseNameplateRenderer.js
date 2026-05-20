/**
 * BaseNameplateRenderer
 *
 * Draws one styled "bordered plate" per real player anchored near that player's
 * original town hall + gold mine, so viewers can tell which base is whose.
 *
 * Placement is fully DETERMINISTIC: it is computed once from STATIC inputs only
 * (player starting positions, gold mine positions, map extent). No Math.random,
 * no Date, fixed iteration order — the same replay produces the same anchors on
 * every watch.
 *
 * Known limitation (by design): only static features are avoided. Buildings
 * constructed later and moving units cannot be avoided because their positions
 * are unknown at compute time, so the label deliberately sits in the open near
 * the base and accepts that units may transiently pass under it. This is
 * acceptable because the plate fades to a faint persistent alpha after 10s of
 * game time.
 */
class BaseNameplateRenderer {
  constructor () {
    this._computed = false;

    // anchor: offset this far (world units) from the town hall along the
    // "open ground" direction (away from mine, toward player's own corner)
    this.BASE_RADIUS = 280;

    // candidate search grid around the anchor (fixed -> deterministic).
    // Wide range so the label can always escape a large finished base.
    this.CAND_RADII  = [240, 380, 520, 680, 860];
    this.CAND_ANGLES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

    // cost weights (tuning, not correctness)
    this.W_MINE     = 4000;   // stay clear of own gold mine icon
    this.W_SELF     = 1500;   // stay near (but not on) own town hall
    this.W_OTHERS   = 2500;   // don't crowd enemy/ally starts
    this.W_MINES    = 1500;   // don't crowd any gold mine
    this.W_ANCHORS  = 3000;   // repel from already-placed labels
    this.W_BUILDING = 1e7;    // near-hard: never sit on a final-base building
    this.W_BOUNDS   = 1e6;    // hard penalty for leaving the map
    this.SELF_MIN   = 180;    // closer than this to the hall -> penalised
    this.SELF_MAX   = 900;    // farther than this from the hall -> penalised
    this.EPS        = 1;

    // world-unit clearance required between the label and any building edge
    this.BUILD_CLEARANCE = 150;
    this.GRID_CELL = 32;      // world units per WPM footprint cell

    // fade curve (game-time seconds) — only a gentle dip after the intro
    this.FADE_START = 10.0;
    this.FADE_DUR   = 1.5;
    this.FULL_ALPHA = 0.95;
    this.FLOOR_ALPHA = 0.72;

    // plate style
    this.FONT_PX  = Math.max(12.8, 13);  // CLAUDE.md desktop-min readable size
    this.PAD_X    = 8;
    this.PAD_Y    = 5;
    this.GAP      = 8;
    this.CHIP_PAD_X = 7;
    this.RADIUS   = 5;
    this.FALLBACK_ACCENT = '#8B949E';
  }

  /**
   * Compute and cache one world-space anchor per real player. Idempotent.
   */
  computeAnchors (players, neutralBuildings, gameScaler, mapData) {
    if (this._computed) return;
    if (!players || !gameScaler || !gameScaler.mapExtent) return;

    const mines = (neutralBuildings || []).filter(nb => nb && nb.type === 'ngol');

    const ex = gameScaler.mapExtent;
    const center = {
      x: (ex.x[0] + ex.x[1]) / 2,
      y: (ex.y[0] + ex.y[1]) / 2
    };

    const realPlayers = players.filter(
      p => p && !p.isNeutralPlayer && p.startingPosition
    );

    const placedAnchors = [];

    realPlayers.forEach(player => {
      const th = player.startingPosition;

      // Final-state base footprint (world-space rects) from the parsed
      // baseSnapshots — the same data the placement viewer uses, so we are
      // 100% sure the label never lands on a building this player built.
      const buildingRects = this._finalBuildingRects(mapData, player);

      // nearest gold mine; tiebreak = lowest array index (stable, file order)
      let mine = null;
      let bestMineD2 = Infinity;
      for (let i = 0; i < mines.length; i++) {
        const m = mines[i];
        const d2 = this._dist2(th, m);
        if (d2 < bestMineD2) {
          bestMineD2 = d2;
          mine = m;
        }
      }
      player._baseLabelMine = mine;

      // direction = blend(mine->th 0.6, center->th 0.4), pushing the label to
      // the side of the hall away from the mine and toward the open corner
      let dx = 0;
      let dy = 0;
      if (mine) {
        const v = this._unit(mine, th);
        dx += v.x * 0.6;
        dy += v.y * 0.6;
      }
      {
        const v = this._unit(center, th);
        dx += v.x * 0.4;
        dy += v.y * 0.4;
      }
      const dlen = Math.hypot(dx, dy) || 1;
      dx /= dlen;
      dy /= dlen;

      const anchor = {
        x: th.x + dx * this.BASE_RADIUS,
        y: th.y + dy * this.BASE_RADIUS
      };

      const otherStarts = realPlayers
        .filter(p => p !== player)
        .map(p => p.startingPosition);

      // fixed iteration order: radii outer, angles inner -> first-found wins ties
      let best = null;
      let bestCost = Infinity;
      for (let ri = 0; ri < this.CAND_RADII.length; ri++) {
        const r = this.CAND_RADII[ri];
        for (let ai = 0; ai < this.CAND_ANGLES.length; ai++) {
          const rad = (this.CAND_ANGLES[ai] * Math.PI) / 180;
          const c = {
            x: anchor.x + Math.cos(rad) * r,
            y: anchor.y + Math.sin(rad) * r
          };
          const cost = this._cost(
            c, th, mine, otherStarts, mines, placedAnchors, ex, buildingRects
          );
          if (cost < bestCost) {
            bestCost = cost;
            best = c;
          }
        }
      }

      const chosen = best || anchor;
      player._baseLabelAnchor = chosen;
      placedAnchors.push(chosen);
    });

    this._computed = true;
  }

  _cost (c, th, mine, otherStarts, mines, placedAnchors, ex, buildingRects) {
    let cost = 0;

    // never sit on (or hugging) a final-base building — near-hard constraint
    if (buildingRects && buildingRects.length) {
      let minClear = Infinity;
      for (let i = 0; i < buildingRects.length; i++) {
        const d = this._pointRectDist(c, buildingRects[i]);
        if (d < minClear) minClear = d;
      }
      if (minClear < this.BUILD_CLEARANCE) {
        // deeper into a building -> exponentially worse, so a clear
        // candidate (minClear >= clearance, no penalty) always wins.
        cost += this.W_BUILDING * (this.BUILD_CLEARANCE - minClear + 1);
      }
    }

    if (mine) {
      cost += this.W_MINE / (this._dist(c, mine) + this.EPS);
    }

    const dSelf = this._dist(c, th);
    cost += this.W_SELF / (dSelf + this.EPS);
    if (dSelf < this.SELF_MIN) {
      cost += this.W_SELF * (this.SELF_MIN - dSelf);
    }
    if (dSelf > this.SELF_MAX) {
      cost += this.W_SELF * (dSelf - this.SELF_MAX);
    }

    for (let i = 0; i < otherStarts.length; i++) {
      cost += this.W_OTHERS / (this._dist(c, otherStarts[i]) + this.EPS);
    }
    for (let i = 0; i < mines.length; i++) {
      cost += this.W_MINES / (this._dist(c, mines[i]) + this.EPS);
    }
    for (let i = 0; i < placedAnchors.length; i++) {
      cost += this.W_ANCHORS / (this._dist(c, placedAnchors[i]) + this.EPS);
    }

    // hard penalty outside the map, soft ramp as it nears the edge
    if (c.x < ex.x[0] || c.x > ex.x[1] || c.y < ex.y[0] || c.y > ex.y[1]) {
      cost += this.W_BOUNDS;
    } else {
      const edge = Math.min(
        c.x - ex.x[0], ex.x[1] - c.x,
        c.y - ex.y[0], ex.y[1] - c.y
      );
      cost += this.W_BOUNDS / (edge + this.EPS) * 0.001;
    }

    return cost;
  }

  /** Pure fade curve, smoothstep from FULL_ALPHA to FLOOR_ALPHA. */
  fadeAlpha (gameTime) {
    const t = gameTime;
    if (t <= this.FADE_START) return this.FULL_ALPHA;
    if (t >= this.FADE_START + this.FADE_DUR) return this.FLOOR_ALPHA;
    const u = (t - this.FADE_START) / this.FADE_DUR;
    const e = u * u * (3 - 2 * u);
    return this.FULL_ALPHA + (this.FLOOR_ALPHA - this.FULL_ALPHA) * e;
  }

  render (ctx, players, gameScaler, gameTime, viewOptions) {
    if (!viewOptions || !viewOptions.displayBaseLabels) return;
    if (!this._computed || !ctx || !gameScaler) return;

    const alpha = this.fadeAlpha(gameTime);
    if (alpha <= 0) return;

    const oldFill   = ctx.fillStyle;
    const oldStroke = ctx.strokeStyle;
    const oldAlpha  = ctx.globalAlpha;
    const oldLineW  = ctx.lineWidth;
    const oldFont   = ctx.font;
    const oldAlign  = ctx.textAlign;
    const oldBase   = ctx.textBaseline;

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      if (!player || player.isNeutralPlayer) continue;
      const a = player._baseLabelAnchor;
      if (!a) continue;

      const proj = gameScaler.projectXY(a.x, a.y);
      if (!proj) continue;
      const px = proj.x + gameScaler.middleX;
      const py = proj.y + gameScaler.middleY;
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue;

      this._drawPlate(ctx, player, px, py, alpha);
    }

    ctx.fillStyle = oldFill;
    ctx.strokeStyle = oldStroke;
    ctx.globalAlpha = oldAlpha;
    ctx.lineWidth = oldLineW;
    ctx.font = oldFont;
    ctx.textAlign = oldAlign;
    ctx.textBaseline = oldBase;
  }

  _drawPlate (ctx, player, px, py, alpha) {
    const race = (typeof RaceLabels !== 'undefined')
      ? RaceLabels[player.race]
      : null;
    const raceTxt = race ? race.label : (player.race || '?');
    const accent = race ? race.accent : this.FALLBACK_ACCENT;

    const name = (typeof PlayerNames !== 'undefined')
      ? PlayerNames.canonical(player.displayName)
      : player.displayName;

    const F = this.FONT_PX;
    ctx.font = `bold ${Math.ceil(F)}px Arial`;

    const raceW = ctx.measureText(raceTxt).width;
    const chipW = raceW + this.CHIP_PAD_X * 2;
    const nameW = ctx.measureText(name).width;

    const plateH = F + this.PAD_Y * 2;
    const plateW = this.PAD_X + chipW + this.GAP + nameW + this.PAD_X;

    const bgX = px - plateW / 2;
    const bgY = py - plateH / 2;

    ctx.globalAlpha = alpha;

    // (1) dark fill
    ctx.fillStyle = 'rgba(17, 17, 17, 0.92)';
    this._roundRectPath(ctx, bgX, bgY, plateW, plateH, this.RADIUS);
    ctx.fill();

    // (2) FULL player-color border (no single-edge stripe)
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = player.playerColor || '#FFFFFF';
    this._roundRectPath(ctx, bgX, bgY, plateW, plateH, this.RADIUS);
    ctx.stroke();

    // (3) race chip
    const chipX = bgX + this.PAD_X;
    const chipY = bgY + this.PAD_Y;
    const chipH = F;
    ctx.fillStyle = accent;
    this._roundRectPath(ctx, chipX, chipY, chipW, chipH, 3);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(raceTxt, chipX + chipW / 2, chipY + chipH / 2 + 0.5);

    // (4) player name
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, chipX + chipW + this.GAP, py + 0.5);
  }

  _roundRectPath (ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /**
   * World-space footprint rects for every building in the player's FINAL
   * base snapshot. Uses the parsed baseSnapshots (same source as the
   * placement viewer); footprint size from the shared BUILDING_FOOTPRINT
   * table (getFootprintCells), cell size 32 world units.
   */
  _finalBuildingRects (mapData, player) {
    const rects = [];
    if (!mapData || !mapData.players) return rects;

    const pd = mapData.players[player.playerId];
    const snaps = pd && pd.baseSnapshots;
    if (!snaps || !snaps.length) return rects;

    // last snapshot is the post-parse 'Final' end-state
    const finalSnap = snaps[snaps.length - 1];
    const buildings = finalSnap && finalSnap.buildings;
    if (!buildings) return rects;

    const cells = (typeof getFootprintCells === 'function')
      ? getFootprintCells
      : (() => 4);

    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
      const half = (cells(b.itemId) / 2) * this.GRID_CELL;
      rects.push({
        minX: b.x - half,
        maxX: b.x + half,
        minY: b.y - half,
        maxY: b.y + half
      });
    }
    return rects;
  }

  /** Shortest distance from a point to an axis-aligned rect (0 if inside). */
  _pointRectDist (p, r) {
    const dx = Math.max(r.minX - p.x, 0, p.x - r.maxX);
    const dy = Math.max(r.minY - p.y, 0, p.y - r.maxY);
    return Math.hypot(dx, dy);
  }

  _dist2 (a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  _dist (a, b) {
    return Math.sqrt(this._dist2(a, b));
  }

  _unit (from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }
}

window.BaseNameplateRenderer = BaseNameplateRenderer;
