/*
 * BattleRenderer — canvas overlay for detected battles.
 *
 * Mirrors MapRenderer's stateless render pattern. The instance keeps a small
 * icon cache (built once at construction) — same approach MapRenderer uses
 * for neutral building icons.
 *
 * Draws on `#utility-canvas` (same layer as creep camp rings) AFTER neutrals
 * so the dashed bbox + banner sit on top of camps it overlaps with.
 * Time-varying tracker boxes are interpolated by BattleData.trackerBoxAt; we
 * then project the corners through gameScaler.projectXY (which queries the
 * 3D scene's current camera, so the box stays glued to the action under
 * pan/zoom).
 */

// Icon filenames in /assets/wc3icons/. Kept module-private so the iteration
// order is deterministic and the constructor loads exactly these.
const BATTLE_ICONS = [
  'nfoh',  // Fountain of Health
  'nmoo',  // Fountain of Mana
  'ntav',  // Tavern (generic shop icon)
  'nmer',  // Mercenary Camp
  'ngme',  // Goblin Merchant
  'emow',  // Moon Well
  'htow',  // Human Town Hall
  'ogre',  // Orc Great Hall
  'etol',  // NE Tree of Life
  'unpl'   // Undead Necropolis
];

// Trip destinationKind → icon key. Base/expansion are race-dependent and
// resolved at render time via the destination owner's race.
const TRIP_KIND_ICON = {
  'fountain-heal': 'nfoh',
  'fountain-mana': 'nmoo',
  'shop':          'ntav',
  'moonwell':      'emow'
};

// Race → town hall itemId for trip-base-return / trip-expansion banners.
const RACE_TH_ICON = {
  'H': 'htow',
  'O': 'ogre',
  'E': 'etol',
  'U': 'unpl'
};

const BattleRenderer = class {
  constructor () {
    this._icons = {};
    this._iconsLoaded = false;
    let loaded = 0;
    BATTLE_ICONS.forEach(type => {
      const img = new Image();
      img.onload = () => {
        this._icons[type] = img;
        loaded++;
        if (loaded === BATTLE_ICONS.length) this._iconsLoaded = true;
      };
      img.onerror = () => {
        // Missing icon is non-fatal — we fall back to a text glyph.
        loaded++;
        if (loaded === BATTLE_ICONS.length) this._iconsLoaded = true;
      };
      img.src = `/assets/wc3icons/${type}.jpg`;
    });
  }

  render (utilityCtx, transform, gameTime, viewOptions, gameScaler, processedBattles, teamColorMap) {
    if (!viewOptions || !viewOptions.displayBattles) return;
    if (!processedBattles || !processedBattles.activeAt) return;

    const active = processedBattles.activeAt(gameTime);
    if (!active.length) return;

    utilityCtx.save();
    const oldDash = utilityCtx.getLineDash();
    const oldAlpha = utilityCtx.globalAlpha;
    const oldStroke = utilityCtx.strokeStyle;
    const oldFill = utilityCtx.fillStyle;
    const oldFont = utilityCtx.font;
    const oldLineWidth = utilityCtx.lineWidth;

    for (const battle of active) {
      const box = processedBattles.trackerBoxAt(battle, gameTime);
      if (!box) continue;
      this._drawTrackerBox(utilityCtx, gameScaler, processedBattles, battle, box, gameTime);
    }

    utilityCtx.setLineDash(oldDash);
    utilityCtx.globalAlpha = oldAlpha;
    utilityCtx.strokeStyle = oldStroke;
    utilityCtx.fillStyle = oldFill;
    utilityCtx.font = oldFont;
    utilityCtx.lineWidth = oldLineWidth;
    utilityCtx.restore();
  }

  // Time envelope: fade in pre-start, full alpha during battle, linear fade
  // out post-roll. Keeps the overlay from snapping in/out.
  _envelope (battle, gameTime, processed) {
    const PRE = processed.PREROLL_MS;
    const POST = processed.POSTROLL_MS;
    if (gameTime < battle.startTime) {
      return Math.max(0, Math.min(1, 1 - (battle.startTime - gameTime) / PRE));
    }
    if (gameTime > battle.endTime) {
      return Math.max(0, Math.min(1, 1 - (gameTime - battle.endTime) / POST));
    }
    return 1;
  }

  _drawTrackerBox (ctx, gameScaler, processed, battle, box, gameTime) {
    const middleX = gameScaler.middleX;
    const middleY = gameScaler.middleY;

    const a = gameScaler.projectXY(box.minX, box.minY);
    const c = gameScaler.projectXY(box.maxX, box.maxY);
    const sx = a.x + middleX, sy = a.y + middleY;
    const ex = c.x + middleX, ey = c.y + middleY;
    const x = Math.min(sx, ex);
    const y = Math.min(sy, ey);
    const w = Math.abs(ex - sx);
    const h = Math.abs(ey - sy);
    if (w < 8 || h < 8) return;

    const alpha = this._envelope(battle, gameTime, processed);
    if (alpha <= 0.01) return;

    const color = (window.BattleCategoryColor && window.BattleCategoryColor[battle.category])
      || '#FFD166';
    const isPitched = (battle.category === 'pitched-battle');

    // Interior tint first so it sits under the border.
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.10 * alpha;
    ctx.fillStyle = color;
    this._tracePath(ctx, x, y, w, h, 8);
    ctx.fill();

    // Faint full perimeter — defines the edge without dominating. Dashed,
    // low alpha. Middle of long sides becomes a soft hint rather than a
    // hard claim that those units are exactly where the box ends.
    ctx.setLineDash([6, 6]);
    ctx.globalAlpha = 0.30 * alpha;
    ctx.lineWidth = isPitched ? 1.5 : 1.2;
    ctx.strokeStyle = color;
    this._tracePath(ctx, x, y, w, h, 8);
    ctx.stroke();

    // Strong corner brackets — broadcast / scope-reticle treatment. Each
    // corner gets a short L-shape that follows the rounded path; the corners
    // do the visual work of defining the box, the dashed perimeter just
    // connects them.
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.95 * alpha;
    ctx.lineWidth = isPitched ? 3.2 : 2.4;
    ctx.lineCap = 'round';
    this._drawCornerBrackets(ctx, x, y, w, h, 8);
    ctx.lineCap = 'butt';

    this._drawBanner(ctx, battle, x, y, w, color, alpha, gameTime);
  }

  // Trace a rounded rectangle path. Caller fills or strokes.
  _tracePath (ctx, x, y, w, h, r) {
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

  // Four L-shaped corner brackets. Length scales with the box up to a cap so
  // tiny battles don't get cartoonish brackets and huge battles still feel
  // contained. ctx state (strokeStyle, lineWidth, alpha) must be set by caller.
  _drawCornerBrackets (ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    const armLen = Math.min(22, Math.max(12, Math.min(w, h) * 0.18));

    // Top-left
    ctx.beginPath();
    ctx.moveTo(x, y + rr + armLen);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.lineTo(x + rr + armLen, y);
    ctx.stroke();

    // Top-right
    ctx.beginPath();
    ctx.moveTo(x + w - rr - armLen, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + rr + armLen);
    ctx.stroke();

    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(x + w, y + h - rr - armLen);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + w - rr - armLen, y + h);
    ctx.stroke();

    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(x + rr + armLen, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + h - rr - armLen);
    ctx.stroke();
  }

  // Banner layout (left → right):
  //   ⚔ CATEGORY  duration  ● ●  · [icon×N] [icon×N]  ✕N
  //
  //   - head text (bold, category color)
  //   - duration (muted)
  //   - team-color dots (one per distinct teamId in participants)
  //   - separator dot
  //   - trip chip group: one chip per destinationKind, with count
  //   - possibly-dead chip: monochrome ✕N
  //
  // Anchored to the top edge of the tracker box. If the banner doesn't fit
  // above the box (box flush with top of canvas), the renderer pins it to
  // y=0 — never clipped.
  _drawBanner (ctx, battle, x, y, boxW, color, alpha, gameTime) {
    const dur = ((Math.min(battle.endTime, gameTime) - battle.startTime) / 1000).toFixed(1);
    const cj = battle.creepJack ? ' ★' : '';
    const category = battle.category.toUpperCase().replace(/-/g, ' ');
    const headLabel = `⚔ ${category}${cj}`;
    const timeLabel = `${dur}s`;

    // --- measure ---
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const headW = ctx.measureText(headLabel).width;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const timeW = ctx.measureText(timeLabel).width;

    const teamColors = this._participantTeamColors(battle);
    const dotR = 4, dotSpacing = 4;
    const dotsW = teamColors.length > 0
      ? teamColors.length * (dotR * 2) + (teamColors.length - 1) * dotSpacing
      : 0;

    const tripChips = this._summarizeTrips(battle);   // [{ iconKey, count, fallbackGlyph }]
    const pdCount = this._possiblyDeadCount(battle);
    // Battle-vs-teleport linkage chips (BattleData pre-computed these).
    //   ⚡→N TP arrivals INTO this battle (reinforcements)
    //   ⚡←N TP departures FROM this battle (escapes)
    // Hidden when zero.
    const tpInCount  = battle._tpInUnits  || 0;
    const tpOutCount = battle._tpOutUnits || 0;
    // Engaged-buildings chip — towers / town halls / production buildings
    // that took fire during this battle. "🏰 Watch Tower" if there's a
    // single building, "🏰 ×N" when several were under attack.
    const engagedBuildings = battle.engagedBuildings || [];
    const ebCount = engagedBuildings.length;
    const ebLabel = ebCount === 1
      ? `🏰 ${engagedBuildings[0].displayName}`
      : ebCount > 1
        ? `🏰 ×${ebCount}`
        : null;

    // Trip chip metrics
    const iconSize = 16;
    const chipGap = 5;
    const chipCountPad = 2;
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    let tripChipsW = 0;
    for (const c2 of tripChips) {
      const countText = `×${c2.count}`;
      const ctw = ctx.measureText(countText).width;
      c2._textWidth = ctw;
      tripChipsW += iconSize + chipCountPad + ctw + chipGap;
    }
    if (tripChips.length) tripChipsW -= chipGap;   // last chip no trailing gap

    // TP chip metrics
    let tpInChipW = 0, tpOutChipW = 0;
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    if (tpInCount > 0)  tpInChipW  = ctx.measureText(`⚡→${tpInCount}`).width + 8;
    if (tpOutCount > 0) tpOutChipW = ctx.measureText(`⚡←${tpOutCount}`).width + 8;
    const gapTpIn  = tpInCount  > 0 ? 10 : 0;
    const gapTpOut = tpOutCount > 0 ? 10 : 0;

    // Engaged-buildings chip metrics
    let ebChipW = 0;
    if (ebLabel) {
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
      ebChipW = ctx.measureText(ebLabel).width + 8;
    }
    const gapEb = ebLabel ? 10 : 0;

    // Possibly-dead chip
    let pdChipW = 0;
    if (pdCount > 0) {
      const txt = `✕${pdCount}`;
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
      pdChipW = ctx.measureText(txt).width + 8;
    }

    // --- layout ---
    const padX = 8, padY = 5;
    const gapMid = 10;
    const gapDots = teamColors.length ? 10 : 0;
    const gapTrips = tripChips.length ? 12 : 0;
    const gapPd = pdCount > 0 ? 12 : 0;
    const bannerW = padX * 2 + headW + gapMid + timeW + gapDots + dotsW + gapTrips + tripChipsW +
                    gapTpIn + tpInChipW + gapTpOut + tpOutChipW + gapEb + ebChipW + gapPd + pdChipW;
    const bannerH = Math.max(iconSize, 14) + padY * 2;
    const bannerX = x;
    const bannerY = Math.max(0, y - bannerH - 3);

    // --- background ---
    ctx.globalAlpha = 0.92 * alpha;
    ctx.fillStyle = 'rgba(8, 12, 18, 0.96)';
    ctx.fillRect(bannerX, bannerY, bannerW, bannerH);
    ctx.globalAlpha = 0.9 * alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(bannerX + 0.5, bannerY + 0.5, bannerW - 1, bannerH - 1);

    // --- head text ---
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    let cx = bannerX + padX;
    const midY = bannerY + bannerH / 2;
    ctx.fillText(headLabel, cx, midY);
    cx += headW + gapMid;

    // --- duration ---
    ctx.fillStyle = '#cbd1d8';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    ctx.fillText(timeLabel, cx, midY);
    cx += timeW + gapDots;

    // --- team dots ---
    if (teamColors.length) {
      let dx = cx + dotR;
      for (const tc of teamColors) {
        ctx.fillStyle = tc;
        ctx.beginPath();
        ctx.arc(dx, midY, dotR, 0, Math.PI * 2);
        ctx.fill();
        dx += dotR * 2 + dotSpacing;
      }
      cx += dotsW + gapTrips;
    } else if (tripChips.length || pdCount > 0) {
      cx += gapTrips;
    }

    // --- trip chips ---
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    for (const chip of tripChips) {
      const icon = this._icons[chip.iconKey];
      if (icon) {
        ctx.drawImage(icon, cx, midY - iconSize / 2, iconSize, iconSize);
      } else {
        // Fallback to a unicode glyph when icon hasn't loaded yet (or doesn't
        // exist for this kind — e.g. trip-reengage is text-only).
        ctx.fillStyle = '#cbd1d8';
        ctx.fillText(chip.fallbackGlyph || '?', cx, midY);
      }
      cx += iconSize + chipCountPad;
      ctx.fillStyle = '#e8eaed';
      ctx.fillText(`×${chip.count}`, cx, midY);
      cx += chip._textWidth + chipGap;
    }
    if (tripChips.length) cx -= chipGap;

    // --- TP-in / TP-out chips ---
    // ⚡→N is a "reinforcement landed" chip — units arrived via teleport during
    // this battle. ⚡←N is "someone escaped" — units left via teleport.
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    if (tpInCount > 0) {
      cx += gapTpIn;
      ctx.fillStyle = '#FFE072';   // gold — same family as the TP cinematic
      ctx.fillText(`⚡→${tpInCount}`, cx, midY);
      cx += tpInChipW - 8;          // subtract the +8 padding from measure
    }
    if (tpOutCount > 0) {
      cx += gapTpOut;
      ctx.fillStyle = '#9aa6b0';   // muted — escape is less urgent than arrival
      ctx.fillText(`⚡←${tpOutCount}`, cx, midY);
      cx += tpOutChipW - 8;
    }

    // --- engaged-buildings chip ---
    // Towers / production / town halls that took fire during the fight.
    if (ebLabel) {
      cx += gapEb;
      ctx.fillStyle = '#FFA66E';   // soft amber — siege-on-buildings flavor
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
      ctx.fillText(ebLabel, cx, midY);
      cx += ebChipW - 8;
    }

    // --- possibly-dead chip ---
    if (pdCount > 0) {
      cx += gapPd / 2;
      ctx.fillStyle = '#ff8c42';   // warm orange for "casualty"
      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
      ctx.fillText(`✕${pdCount}`, cx, midY);
    }

    ctx.textBaseline = 'alphabetic';   // restore default
  }

  // Distinct participant team colors, ordered by teamId for determinism.
  _participantTeamColors (battle) {
    if (!battle.participants || !battle.participants.length) return [];
    const seen = new Set();
    const teamIds = [];
    for (const p of battle.participants) {
      if (p.teamId == null) continue;
      if (seen.has(p.teamId)) continue;
      seen.add(p.teamId);
      teamIds.push(p.teamId);
    }
    teamIds.sort((a, b) => a - b);
    const map = (window.wc3v && window.wc3v.teamColorMap) || {};
    return teamIds.map(tid => map[tid] || '#888');
  }

  // Group trips by destinationKind, drop low-signal kinds (disengage).
  // Resolves base/expansion to the owner's race for the right TH icon.
  _summarizeTrips (battle) {
    const trips = battle.unitTrips || [];
    if (!trips.length) return [];

    const counts = new Map();   // key → { iconKey, count, fallbackGlyph }
    for (const t of trips) {
      if (t.tag === 'trip-disengage') continue;   // too noisy for a banner

      let iconKey = null;
      let fallback = '?';
      let key = t.destinationKind;

      if (t.tag === 'trip-reengage') {
        // No icon — reengage is implicit (banner of the next battle says it).
        // Skip to keep the banner short.
        continue;
      } else if (TRIP_KIND_ICON[t.destinationKind]) {
        iconKey = TRIP_KIND_ICON[t.destinationKind];
        fallback = t.destinationKind === 'fountain-heal' ? '♥'
                 : t.destinationKind === 'fountain-mana' ? '♦'
                 : t.destinationKind === 'shop' ? '$'
                 : t.destinationKind === 'moonwell' ? '✨' : '?';
      } else if (t.destinationKind === 'base' || t.destinationKind === 'expansion') {
        // Resolve race via destination owner.
        const race = this._raceForPlayerId(t.destinationOwnerId);
        iconKey = RACE_TH_ICON[race] || 'htow';
        fallback = t.destinationKind === 'base' ? '⌂' : '⌂⌂';
        // Distinguish base vs expansion in the key so they get separate chips.
        key = t.destinationKind === 'base' ? `base-${race || 'X'}` : `exp-${race || 'X'}`;
      } else {
        continue;
      }

      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, { iconKey, count: 1, fallbackGlyph: fallback });
      }
    }

    // Stable order: by key ascending (deterministic chip order on banner).
    return [...counts.entries()]
      .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
      .map(([, v]) => v);
  }

  _raceForPlayerId (pid) {
    if (pid == null) return null;
    const viewer = window.wc3v;
    if (!viewer || !viewer.players) return null;
    const player = viewer.players.find(p => String(p.playerId) === String(pid));
    return player && player.race;
  }

  _possiblyDeadCount (battle) {
    return (battle.unitOutcomes || []).filter(o => o.status === 'possiblyDead').length;
  }
};

window.BattleRenderer = BattleRenderer;
