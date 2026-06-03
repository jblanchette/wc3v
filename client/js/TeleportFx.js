/*
 * TeleportFx — cinematic teleport renderer.
 *
 * Reads each player's `teleportEvents[]` (populated by the parser's
 * Player._applyTeleport) and draws a multi-layer visual against the current
 * gameTime:
 *
 *   1. GRAB RADIUS — faint dashed circle at the actual game-unit grab radius
 *      around the caster. Shows what's eligible to be pulled. (Skipped for
 *      grabRadius === 0 abilities like Blink and Staff.)
 *
 *   2. HERO RING — bright primary ring at the caster's origin (NOT
 *      path-interpolated; during the channel the parser's path may show false
 *      walking samples — the cast origin is the truthful anchor).
 *      Surrounded by a radial glow gradient. A channel-progress arc fills
 *      clockwise outside the main ring as the 3s channel completes.
 *
 *   3. UNIT RINGS — smaller secondary rings on each grabbed unit's origin.
 *      Looked up by uuid via ClientUnit.getInterpolatedPosition(castTime).
 *      Synced pulse with the hero ring so the user sees the WHOLE squad is
 *      being teleported, not just the hero.
 *
 *   4. BANNER — "⚡ SCROLL OF TOWN PORTAL  +N units" centered above the ring.
 *      Red and "✕ CANCELLED" when cancellable cast was interrupted.
 *      Single-unit teleport items (stel / spre / ssan) use a CYAN accent so
 *      users instantly read them as "hero-only", and the sub-line shows
 *      "single-unit teleport" instead of the +N units count.
 *
 *   5. ARRIVAL FLASH — at apply: a bright expanding shockwave ring at the
 *      destination + a brief inner solid flash. Bigger than v1.
 *
 *   6. TRAIL — faint dashed origin → destination line, fading over 3s post.
 *
 * Drawn on #utility-canvas (same layer as BattleRenderer + camp rings).
 */
const TeleportFx = class {
  constructor () {
    // Preload the WC3 ability/item icons used by the cinematic banner so they
    // render the first time a teleport fires (without this the banner shows
    // a missing-image gap for the first ~50ms). Mirrors MapRenderer's pattern.
    this._icons = {};
    this._iconsReady = false;
    const types = ['stwp', 'stel', 'spre', 'ssan', 'AHmt', 'AEbl'];
    let loaded = 0;
    types.forEach(type => {
      const img = new Image();
      img.onload = () => {
        this._icons[type] = img;
        if (++loaded === types.length) this._iconsReady = true;
      };
      img.onerror = () => {
        if (++loaded === types.length) this._iconsReady = true;
      };
      img.src = `/assets/wc3icons/${type}.jpg`;
    });
  }

  render (utilityCtx, transform, gameTime, viewOptions, gameScaler, players) {
    if (!viewOptions || viewOptions.displayTeleports === false) return;
    if (!players || !players.length) return;

    const POSTROLL_MS = 3000;

    utilityCtx.save();
    const restore = {
      alpha: utilityCtx.globalAlpha,
      stroke: utilityCtx.strokeStyle,
      fill: utilityCtx.fillStyle,
      font: utilityCtx.font,
      lw: utilityCtx.lineWidth,
      dash: utilityCtx.getLineDash()
    };

    // Collect every active TP first, then group ones sharing a destination so
    // their mirror indicators merge. Caster-side overlays (ring/banner/trail)
    // remain per-TP — each hero channels independently. Only the destination
    // indicator counts up.
    const active = [];
    for (const player of players) {
      const tps = player.teleportEvents || [];
      if (!tps.length) continue;
      for (const tp of tps) {
        // Inference gate: phantom teleports (inferenceConfidence ∈
        // {unlikely, rejected}) skip all FX rendering. The hero pip path
        // may still show a spurious jump in v1 (Phase B fixes path
        // data); FX suppression at least keeps banners + rings + trails
        // off so the user doesn't see a fake TP visual.
        if (tp.inferenceConfidence === 'rejected' ||
            tp.inferenceConfidence === 'unlikely') continue;
        const cast = tp.gameTime;
        const apply = tp.appliedAt != null ? tp.appliedAt : (tp.gameTime + tp.channelMs);
        const fadeEnd = (tp.cancelled ? (cast + tp.channelMs) : apply) + POSTROLL_MS;
        if (gameTime < cast - 200) continue;
        if (gameTime > fadeEnd) continue;
        active.push(tp);
      }
    }
    if (!active.length) {
      // restore + return
      utilityCtx.setLineDash(restore.dash);
      utilityCtx.globalAlpha = restore.alpha;
      utilityCtx.strokeStyle = restore.stroke;
      utilityCtx.fillStyle = restore.fill;
      utilityCtx.font = restore.font;
      utilityCtx.lineWidth = restore.lw;
      utilityCtx.restore();
      return;
    }

    // Build destination groups (by destBuildingUuid OR proximity within 200u).
    // Each group → one merged destination indicator.
    const destGroups = this._groupByDestination(active);
    // Mark which TPs share a group so per-TP destination indicators can skip.
    const tpToGroup = new Map();
    for (const g of destGroups) for (const tp of g.tps) tpToGroup.set(tp, g);

    for (const tp of active) {
      const group = tpToGroup.get(tp);
      this._drawTeleport(utilityCtx, gameScaler, gameTime, tp, players, group);
    }

    utilityCtx.setLineDash(restore.dash);
    utilityCtx.globalAlpha = restore.alpha;
    utilityCtx.strokeStyle = restore.stroke;
    utilityCtx.fillStyle = restore.fill;
    utilityCtx.font = restore.font;
    utilityCtx.lineWidth = restore.lw;
    utilityCtx.restore();
  }

  // Per-category accent palette. Single-unit teleports get a cyan look so a
  // glance is enough to tell "hero/staff jump" apart from a Town Portal mass
  // recall. Cancelled casts always switch to red regardless of category.
  // `abilityCategory` is set by the parser from helpers/teleportAbilities;
  // older replays without it fall back to inferring from abilityCode.
  _palette (tp, cancelled) {
    if (cancelled) return { core: '#FF6B6B', bright: '#FF8E8E', glowRGB: '255, 107, 107' };
    const cat = tp.abilityCategory || this._inferCategory(tp.abilityCode);
    if (cat === 'single-unit') {
      return { core: '#4FD2FF', bright: '#A8EAFF', glowRGB: '79, 210, 255' };
    }
    // town-portal, mass, blink, unknown → original gold palette
    return { core: '#FFD24A', bright: '#FFE072', glowRGB: '255, 210, 74' };
  }

  _inferCategory (abilityCode) {
    if (abilityCode === 'stel' || abilityCode === 'spre' || abilityCode === 'ssan') return 'single-unit';
    if (abilityCode === 'AHmt') return 'mass';
    if (abilityCode === 'AEbl') return 'blink';
    return 'town-portal';
  }

  // Project a game-space point to canvas pixels — same recipe MapRenderer +
  // BattleRenderer use (projectXY samples 3D terrain height, then add middleX/Y).
  _proj (gameScaler, x, y) {
    const p = gameScaler.projectXY(x, y);
    if (!p) return null;  // outside the camera frustum
    return { x: p.x + gameScaler.middleX, y: p.y + gameScaler.middleY };
  }

  // Convert a game-unit radius into screen pixels at the caster's location.
  // Uses two projected points to capture per-perspective distortion correctly.
  _radiusPx (gameScaler, originX, originY, gameRadius) {
    if (!gameRadius || gameRadius <= 0) return 0;
    const a = gameScaler.projectXY(originX, originY);
    const b = gameScaler.projectXY(originX + gameRadius, originY);
    if (!a || !b) return 0;
    return Math.max(8, Math.abs(b.x - a.x));
  }

  // Look up a grabbed unit's position at castTime via ClientUnit's path.
  // Returns null if the unit isn't found (cross-player ID collision shouldn't
  // happen but we guard).
  _grabbedUnitPos (players, uuid, castTime) {
    for (const player of players) {
      if (!player.units) continue;
      for (const u of player.units) {
        if (u.uuid !== uuid) continue;
        if (typeof u.getInterpolatedPosition === 'function') {
          return u.getInterpolatedPosition(castTime);
        }
        // Fallback: nearest path sample by gameTime.
        const path = u.path || [];
        if (!path.length) return null;
        let best = path[0];
        let bestD = Math.abs(path[0].gameTime - castTime);
        for (const s of path) {
          const d = Math.abs(s.gameTime - castTime);
          if (d < bestD) { best = s; bestD = d; }
        }
        return { x: best.x, y: best.y };
      }
    }
    return null;
  }

  // Cluster active TPs by destination. Two TPs share a group if either:
  //   (a) they share a non-null destBuildingUuid, OR
  //   (b) their destination points are within 200 game units of each other.
  // Output: array of { tps:[], leaderTp, totalIncomingUnits, destX, destY }.
  // `leaderTp` is the earliest-cast TP in the group — that one owns the
  // destination indicator (others skip drawing it to avoid stacking).
  _groupByDestination (tps) {
    const groups = [];
    const PROX_SQ = 200 * 200;
    for (const tp of tps) {
      if (!tp.destination) continue;
      let placed = false;
      for (const g of groups) {
        const same =
          (tp.destBuildingUuid && g.destBuildingUuid && tp.destBuildingUuid === g.destBuildingUuid) ||
          (g.destX != null && g.destY != null && tp.destination &&
            ((tp.destination.x - g.destX) ** 2 + (tp.destination.y - g.destY) ** 2 <= PROX_SQ));
        if (same) {
          g.tps.push(tp);
          g.totalIncomingUnits += (tp.grabbedCount || 0) + 1;
          if (tp.gameTime < g.leaderTp.gameTime) g.leaderTp = tp;
          placed = true;
          break;
        }
      }
      if (!placed) {
        groups.push({
          tps: [tp],
          leaderTp: tp,
          destBuildingUuid: tp.destBuildingUuid || null,
          destX: tp.destination.x,
          destY: tp.destination.y,
          totalIncomingUnits: (tp.grabbedCount || 0) + 1
        });
      }
    }
    return groups;
  }

  _drawTeleport (ctx, gameScaler, gameTime, tp, players, group) {
    const cast = tp.gameTime;
    const apply = tp.appliedAt != null ? tp.appliedAt : (tp.gameTime + tp.channelMs);
    const channelMs = Math.max(1, apply - cast);
    const inChannel = gameTime >= cast && gameTime < apply;
    const postApply = gameTime >= apply;
    const cancelled = !!tp.cancelled;

    const oPx = this._proj(gameScaler, tp.origin.x, tp.origin.y);
    const dPx = this._proj(gameScaler, tp.destination.x, tp.destination.y);
    // FX has nothing to draw if both endpoints are outside the camera frustum;
    // in that case we'd dereference null below. If one endpoint is visible and
    // the other isn't, the unguarded reference would still crash, so bail too —
    // the user can't see the cinematic anyway.
    if (!oPx || !dPx) return;

    // Grab radius from the registry (defaults below cover Scroll/MT/Blink).
    const grabRadius = tp.abilityCode === 'stwp' ? 900
                     : tp.abilityCode === 'AHmt' ? 800
                     : 0;
    const grabPx = this._radiusPx(gameScaler, tp.origin.x, tp.origin.y, grabRadius);

    const palette = this._palette(tp, cancelled);

    // ────────────────────────────────────────────────────────────────────
    // CHANNEL phase
    // ────────────────────────────────────────────────────────────────────
    if (inChannel || (cancelled && gameTime < cast + tp.channelMs)) {
      const tProg = Math.min(1, (gameTime - cast) / channelMs);
      const color = palette.core;
      const colorBright = palette.bright;

      // 1) GRAB RADIUS — faint dashed circle showing eligibility footprint.
      if (grabPx > 30 && !cancelled) {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color;
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.arc(oPx.x, oPx.y, grabPx, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 2) RADIAL GLOW around the caster — soft halo that grows over the channel.
      const mainR = 60;
      const glowR = mainR * (1.6 + 0.2 * tProg);
      const glow = ctx.createRadialGradient(
        oPx.x, oPx.y, mainR * 0.4,
        oPx.x, oPx.y, glowR
      );
      glow.addColorStop(0,   `rgba(${palette.glowRGB}, 0.55)`);
      glow.addColorStop(0.6, `rgba(${palette.glowRGB}, 0.18)`);
      glow.addColorStop(1,   `rgba(${palette.glowRGB}, 0)`);
      ctx.globalAlpha = 1;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(oPx.x, oPx.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      // 3) PRIMARY RING — bold, bright.
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 4;
      ctx.strokeStyle = colorBright;
      ctx.beginPath();
      ctx.arc(oPx.x, oPx.y, mainR, 0, Math.PI * 2);
      ctx.stroke();

      // 4) CHANNEL PROGRESS ARC — fills clockwise from 12 o'clock around the
      //    primary ring as the 3-second channel completes.
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 7;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(oPx.x, oPx.y, mainR + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * tProg);
      ctx.stroke();

      // 5) PER-UNIT RINGS — small synced ring on each grabbed unit.
      const pulse = 0.7 + 0.3 * Math.sin((gameTime - cast) / 90);
      ctx.globalAlpha = 0.9 * pulse;
      ctx.lineWidth = 3;
      ctx.strokeStyle = colorBright;
      ctx.setLineDash([]);
      for (const uuid of (tp.grabbedUnitUuids || [])) {
        const pos = this._grabbedUnitPos(players, uuid, cast);
        if (!pos) continue;
        const gp = this._proj(gameScaler, pos.x, pos.y);
        if (!gp) continue;  // grabbed unit is off-screen
        // Skip if the unit ring would overlap the caster ring (visual clutter).
        const dx = gp.x - oPx.x;
        const dy = gp.y - oPx.y;
        if ((dx * dx + dy * dy) < (mainR * mainR * 0.5)) continue;
        ctx.beginPath();
        ctx.arc(gp.x, gp.y, 24, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 6) ANIMATED DASHED TRAIL — origin → destination during the channel.
      //    Dashes scroll toward the destination as channel progresses (visually
      //    "the units are flowing through"). Becomes more solid near apply.
      if (!cancelled) {
        const dashOffset = -((gameTime - cast) / 12) % 14;
        ctx.globalAlpha = 0.45 + 0.35 * tProg;
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.setLineDash([6, 8]);
        ctx.lineDashOffset = dashOffset;
        ctx.beginPath();
        ctx.moveTo(oPx.x, oPx.y);
        ctx.lineTo(dPx.x, dPx.y);
        ctx.stroke();
        ctx.lineDashOffset = 0;
        ctx.setLineDash([]);
      }

      // 7) DESTINATION MIRROR INDICATOR — only drawn ONCE per group (by the
      //    earliest-cast TP). Subsequent TPs sharing the same destination
      //    skip this so we don't stack indicators on top of each other.
      const isGroupLeader = !group || group.leaderTp === tp;
      if (!cancelled && isGroupLeader) {
        const totalIncoming = group ? group.totalIncomingUnits : ((tp.grabbedCount || 0) + 1);
        this._drawDestinationIndicator(ctx, dPx.x, dPx.y, tp, gameTime, cast, channelMs, totalIncoming, group && group.tps.length > 1 ? group.tps.length : 0, palette);
      }

      // 8) BANNER above the caster ring.
      this._drawBanner(ctx, oPx.x, oPx.y - mainR - 14, tp, cancelled, palette);
    }

    // ────────────────────────────────────────────────────────────────────
    // ARRIVAL phase
    // ────────────────────────────────────────────────────────────────────
    if (postApply && !cancelled) {
      const since = gameTime - apply;

      // FLASH — bright expanding shockwave at destination. Multi-ring so it
      // reads as an impact, not just a single circle.
      const FLASH_MS = 1000;
      if (since <= FLASH_MS) {
        const tf = since / FLASH_MS;

        // Outer shockwave
        const ringR = 30 + 90 * tf;
        ctx.globalAlpha = 0.85 * (1 - tf);
        ctx.lineWidth = 5 * (1 - tf * 0.7);
        ctx.strokeStyle = palette.bright;
        ctx.beginPath();
        ctx.arc(dPx.x, dPx.y, ringR, 0, Math.PI * 2);
        ctx.stroke();

        // Inner solid burst
        const innerR = 18 + 30 * tf;
        ctx.globalAlpha = 0.6 * (1 - tf);
        ctx.fillStyle = palette.bright;
        ctx.beginPath();
        ctx.arc(dPx.x, dPx.y, innerR, 0, Math.PI * 2);
        ctx.fill();

        // Bright pinprick at center for first 250ms
        if (since < 250) {
          const tfp = since / 250;
          ctx.globalAlpha = 1 - tfp;
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(dPx.x, dPx.y, 12 * (1 - tfp * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // TRAIL — dashed origin→destination, fading over 3s.
      const POST_TAIL_MS = 3000;
      if (since <= POST_TAIL_MS) {
        const tt = since / POST_TAIL_MS;
        ctx.globalAlpha = 0.5 * (1 - tt);
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = palette.core;
        ctx.setLineDash([5, 7]);
        ctx.beginPath();
        ctx.moveTo(oPx.x, oPx.y);
        ctx.lineTo(dPx.x, dPx.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // Destination-mirror indicator drawn at the TP target during the channel.
  // Shows users WHERE the squad is going before they actually arrive.
  // Composition:
  //   - A mirror pulsing ring (smaller than the origin ring; ~36px)
  //   - The ability's WC3 icon (32px) centered inside the ring
  //   - "INCOMING ⚡N" mini-label below the ring (count = grabbed + 1 hero)
  //   - Urgency bump in the last 600ms of channel
  _drawDestinationIndicator (ctx, dx, dy, tp, gameTime, cast, channelMs, totalIncoming, groupSize, palette) {
    if (!palette) palette = this._palette(tp, false);
    const elapsed = gameTime - cast;
    const tProg = Math.min(1, elapsed / channelMs);
    const remainingMs = channelMs - elapsed;
    const isUrgent = remainingMs <= 600;
    const pulse = 0.78 + 0.22 * Math.sin(elapsed / (isUrgent ? 55 : 110));
    if (totalIncoming == null) totalIncoming = (tp.grabbedCount || 0) + 1;

    // Single-unit teleports never "grab" anyone — counting "+1 hero" is
    // accurate but the cinematic ⚡N count implies a squad. Hide the count
    // for single-unit casts so the destination tag just says HERO TP.
    const isSingleUnit = (tp.abilityCategory || this._inferCategory(tp.abilityCode)) === 'single-unit';

    const ringR = isUrgent ? 42 : 36;
    const iconSize = 32;

    // Soft glow behind the ring so the icon reads against varied terrain.
    const glow = ctx.createRadialGradient(dx, dy, 6, dx, dy, ringR * 1.9);
    glow.addColorStop(0,   `rgba(${palette.glowRGB}, 0.55)`);
    glow.addColorStop(0.6, `rgba(${palette.glowRGB}, 0.18)`);
    glow.addColorStop(1,   `rgba(${palette.glowRGB}, 0)`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(dx, dy, ringR * 1.9, 0, Math.PI * 2);
    ctx.fill();

    // Ring proper.
    ctx.globalAlpha = 0.95 * pulse;
    ctx.lineWidth = isUrgent ? 3.5 : 2.5;
    ctx.strokeStyle = palette.bright;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(dx, dy, ringR, 0, Math.PI * 2);
    ctx.stroke();

    // A subtler outer rotating ring for "incoming" feel.
    const rotR = ringR + 9;
    ctx.globalAlpha = 0.7 * pulse;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = palette.core;
    ctx.setLineDash([3, 5]);
    ctx.lineDashOffset = -((gameTime - cast) / 10) % 8;
    ctx.beginPath();
    ctx.arc(dx, dy, rotR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineDashOffset = 0;
    ctx.setLineDash([]);

    // Ability icon centered in the ring.
    const icon = this._icons[tp.abilityCode];
    if (icon) {
      ctx.globalAlpha = 1;
      ctx.drawImage(icon, dx - iconSize / 2, dy - iconSize / 2, iconSize, iconSize);
      // 1px border in category color so the icon reads on busy terrain.
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = palette.core;
      ctx.strokeRect(dx - iconSize / 2 - 0.5, dy - iconSize / 2 - 0.5, iconSize + 1, iconSize + 1);
    } else {
      // Fallback: bold "⚡" glyph if the icon hasn't loaded.
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = palette.bright;
      ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText('⚡', dx, dy);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }

    // Destination label below the ring. Group TPs (stwp / Mass Teleport)
    // show "INCOMING ⚡N" with the squad size; single-unit teleports
    // (stel / spre / ssan) show "HERO TP" — clearer about what's arriving.
    const label = isSingleUnit
      ? 'HERO TP'
      : (groupSize && groupSize > 1)
        ? `INCOMING ⚡${totalIncoming} (×${groupSize} TPs)`
        : `INCOMING ⚡${totalIncoming}`;
    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const labelW = ctx.measureText(label).width;
    const padX = 6, padY = 3;
    const lW = labelW + padX * 2;
    const lH = 14 + padY * 2;
    const lX = dx - lW / 2;
    const lY = dy + ringR + 6;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(8, 12, 18, 0.96)';
    ctx.fillRect(lX, lY, lW, lH);
    ctx.lineWidth = 1;
    ctx.strokeStyle = isUrgent ? palette.bright : palette.core;
    ctx.strokeRect(lX + 0.5, lY + 0.5, lW - 1, lH - 1);
    ctx.fillStyle = isUrgent ? '#FFFFFF' : palette.bright;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lX + padX, lY + lH / 2);
    ctx.textBaseline = 'alphabetic';
  }

  // Larger label with a 48px WC3 icon left of the text. Two-line layout:
  //   [icon]  HEADING (cancellable status + ability name)
  //           subline (grabbed count, channel/instant)
  _drawBanner (ctx, ax, ay, tp, cancelled, palette) {
    if (!palette) palette = this._palette(tp, cancelled);
    const iconKey = tp.abilityCode || null;
    const icon = (iconKey && this._icons[iconKey]) || null;
    const isSingleUnit = (tp.abilityCategory || this._inferCategory(tp.abilityCode)) === 'single-unit';

    const headingPrefix = cancelled ? '✕' : '⚡';
    // abilityDisplayName is parser-derived and may be absent on older replays;
    // an unguarded .toUpperCase() would throw EVERY frame the TP is active
    // (~6s), killing the action-overlay render loop. Fall back to the code.
    const headingName = tp.abilityDisplayName || tp.abilityCode || 'Teleport';
    const headingMain = String(headingName).toUpperCase() + (cancelled ? ' — CANCELLED' : '');
    const subLine = (() => {
      const parts = [];
      // Single-unit teleports never bring company — show the qualifier
      // explicitly so the reader doesn't expect a missing "+N units".
      // Group teleports (stwp / AHmt) that happened to land with grabbedCount=0
      // get a "hero only" tag so the reader doesn't have to count the rings.
      if (isSingleUnit) {
        parts.push('single-unit teleport');
      } else if (tp.grabbedCount > 0) {
        parts.push(`+${tp.grabbedCount} unit${tp.grabbedCount === 1 ? '' : 's'}`);
      } else {
        parts.push('hero only');
      }
      if (tp.channelMs > 0) parts.push(`${(tp.channelMs / 1000).toFixed(1)}s channel`);
      else                  parts.push('instant');
      if (tp.invulnerable && !cancelled) parts.push('invulnerable');
      return parts.join(' · ');
    })();

    const iconSize = 48;
    const headFont = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    const subFont  = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

    ctx.font = headFont;
    const headPrefixW = ctx.measureText(headingPrefix + ' ').width;
    const headMainW   = ctx.measureText(headingMain).width;
    const headW = headPrefixW + headMainW;
    ctx.font = subFont;
    const subW = ctx.measureText(subLine).width;
    const textW = Math.max(headW, subW);

    const padX = 12, padY = 8, iconGap = 10;
    const innerH = iconSize;
    const w = padX * 2 + (icon ? iconSize + iconGap : 0) + textW;
    const h = innerH + padY * 2;
    const x = ax - w / 2;
    const y = ay - h;

    // Background block.
    ctx.globalAlpha = 0.97;
    ctx.fillStyle = 'rgba(8, 12, 18, 0.97)';
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = palette.core;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Icon — large, with a soft border so it pops on any background.
    const textX = x + padX + (icon ? iconSize + iconGap : 0);
    if (icon) {
      const ix = x + padX;
      const iy = y + padY;
      ctx.globalAlpha = cancelled ? 0.55 : 1;
      ctx.drawImage(icon, ix, iy, iconSize, iconSize);
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette.core;
      ctx.strokeRect(ix - 1, iy - 1, iconSize + 2, iconSize + 2);
    }

    // Heading line — palette-tinted prefix glyph then white-ish heading.
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'middle';
    ctx.font = headFont;
    const headY = y + padY + iconSize / 2 - 8;
    ctx.fillStyle = palette.bright;
    ctx.fillText(headingPrefix + ' ', textX, headY);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(headingMain, textX + headPrefixW, headY);

    // Sub line — muted detail.
    ctx.font = subFont;
    ctx.fillStyle = '#9aa6b0';
    ctx.fillText(subLine, textX, y + padY + iconSize / 2 + 12);

    ctx.textBaseline = 'alphabetic';
  }
};

window.TeleportFx = TeleportFx;
