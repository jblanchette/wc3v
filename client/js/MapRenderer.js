// Four projection scratches for the camp-bbox corner projection below — that
// runs 4 projections per neutral camp per frame (and a big map has ~20 camps),
// each of which used to allocate two throwaway objects. The four corners are
// live simultaneously, so they need four distinct scratches.
const _cornerScratch = [
  { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }
];

// seeded pseudo-random for deterministic per-tree variation
function tileHash (a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) & 0xFF) / 255.0;
}

function hexToRgb (hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

const MapRenderer = class {
  constructor () {
    this._neutralIcons = {};
    this._neutralIconsLoaded = false;

    const iconTypes = ['ngol', 'nfoh', 'nmoo', 'nmer', 'ntav', 'ngme', 'ngad', 'nmrk'];
    let loaded = 0;

    iconTypes.forEach(type => {
      const img = new Image();
      img.onload = () => {
        this._neutralIcons[type] = img;
        loaded++;
        if (loaded === iconTypes.length) {
          this._neutralIconsLoaded = true;
        }
      };
      img.onerror = () => {
        loaded++;
        if (loaded === iconTypes.length) {
          this._neutralIconsLoaded = true;
        }
      };
      img.src = `/assets/wc3icons/${type}.jpg`;
    });
  }

  renderMapBackground (ctx, transform, viewOptions, gameScaler, mapImage, gridMapImage) {
    const {
      cropOffset,
      sceneWidth,
      sceneHeight
    } = gameScaler;

    const bgImage = viewOptions.displayMapGrid ?
      gridMapImage : mapImage;

    // canvas context already has translate + scale applied
    // draw at (0,0) in canvas-space; context transform handles zoom/pan
    ctx.drawImage(
      bgImage,
      cropOffset.x,        // sourceX: where camera starts in full map image
      cropOffset.y,        // sourceY
      sceneWidth,          // sourceWidth: camera area size
      sceneHeight,         // sourceHeight
      0,                   // destX: canvas-space origin
      0,                   // destY
      sceneWidth,          // destWidth
      sceneHeight          // destHeight
    );
  }

  renderMapTrees (ctx, transform, viewOptions, doodadData, gameScaler, mapInfo) {
    const {
      middleX,
      middleY,
      xScale,
      yScale
    } = gameScaler;

    if (!viewOptions.displayTreeGrid) {
      return;
    }

    const oldFillStyle = ctx.fillStyle;
    const oldAlpha = ctx.globalAlpha;

    const treeRgb = hexToRgb((mapInfo && mapInfo.treeColor) || '#064006');

    doodadData.forEach((tree) => {
      const { position, scale } = tree;
      const tx = Math.round(parseFloat(position.x));
      const ty = Math.round(parseFloat(position.y));

      // per-tree seeded variation
      const h1 = tileHash(tx, ty);
      const h2 = tileHash(ty, tx);

      // brightness: +/-15%
      const bright = 1 + (h1 * 0.3 - 0.15);
      const cr = Math.max(0, Math.min(255, Math.round(treeRgb[0] * bright)));
      const cg = Math.max(0, Math.min(255, Math.round(treeRgb[1] * bright)));
      const cb = Math.max(0, Math.min(255, Math.round(treeRgb[2] * bright)));
      ctx.fillStyle = 'rgb(' + cr + ',' + cg + ',' + cb + ')';

      // opacity: 0.7 to 0.9
      ctx.globalAlpha = 0.7 + h2 * 0.2;

      // size: +/-20%
      const sizeVar = 1 + (h2 * 0.4 - 0.2);
      const scaledSize = 8 * scale[0] * sizeVar;

      // position jitter
      const jitterX = (h1 * 6 - 3);
      const jitterY = (h2 * 6 - 3);

      const drawX = xScale(position.x) + middleX + jitterX;
      const drawY = yScale(position.y) + middleY + jitterY;

      ctx.beginPath();
      ctx.arc(drawX, drawY, scaledSize, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = oldFillStyle;
    ctx.globalAlpha = oldAlpha;
  }

  // binary search: find the latest snapshot where gameTime <= target
  _findProgress (timeline, gameTime) {
    if (!timeline || !timeline.length) return null;
    if (gameTime < timeline[0].gameTime) return null;
    if (gameTime >= timeline[timeline.length - 1].gameTime) return timeline[timeline.length - 1];

    let lo = 0, hi = timeline.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (timeline[mid].gameTime <= gameTime) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return timeline[lo];
  }

  // Per-team progress at a point in time, derived from the per-player credit
  // model: each contributing player's share is summed onto their team. This is
  // the single source the camp ring renders from, so the map and the Camp Info
  // credit panel can never visibly disagree. Returns null when untouched.
  _teamProgressAt (neutralGroup, gameTime) {
    const snap = this._findProgress(neutralGroup.playerCreditTimeline, gameTime);
    if (!snap || !snap.players) return null;
    const pc = neutralGroup.playerCredit || {};
    const teams = {};
    Object.keys(snap.players).forEach(pid => {
      const sp = snap.players[pid];
      if (!sp || !(sp.contributionShare > 0)) return;
      const teamId = pc[pid] ? pc[pid].teamId : null;
      if (teamId == null) return;
      teams[teamId] = (teams[teamId] || 0) + sp.contributionShare;
    });
    return Object.keys(teams).length ? teams : null;
  }

  // Clear-order per team across every camp, ranked by the credit model's
  // clearedTime. A camp counts for a team only once it is cleared and that
  // team did contributing work in it — matching the credit panel exactly.
  // Returns { [campUuid]: { [teamId]: orderNumber } }.
  _computeCampOrders (groups, nonOneVsOne) {
    const orders = {};
    if (nonOneVsOne) return orders;

    const byTeam = {};
    groups.forEach(g => {
      if (g.clearedTime == null) return;
      const pc = g.playerCredit || {};
      const teamsHere = {};
      Object.keys(pc).forEach(pid => {
        const c = pc[pid];
        const m = c && c.measured;
        if (c && m && m.contributionMs > 0 && c.teamId != null) {
          teamsHere[c.teamId] = true;
        }
      });
      Object.keys(teamsHere).forEach(tid => {
        (byTeam[tid] = byTeam[tid] || []).push({ uuid: g.uuid, clearedTime: g.clearedTime });
      });
    });

    Object.keys(byTeam).forEach(tid => {
      byTeam[tid].sort((a, b) => a.clearedTime - b.clearedTime);
      byTeam[tid].forEach((entry, idx) => {
        (orders[entry.uuid] = orders[entry.uuid] || {})[tid] = idx + 1;
      });
    });
    return orders;
  }

  // Note: this method mutates neutralGroup.isHidden and unit.isNeutralGroupHidden
  // on the data objects passed via mapData and players (by-reference side effects).
  renderNeutralGroups (ctx, gameTime, transform, mapData, viewOptions, gameScaler, players, teamColorMap, hoveredCampUuid) {
    const { world } = mapData;

    const {
      middleX,
      middleY,
      xScale,
      yScale
    } = gameScaler;

    ctx.save();

    const neutralPlayer = players.find(player => {
      return player.playerId === "1042";
    });

    if (!neutralPlayer) {
      ctx.restore();
      return;
    }

    const PI2 = Math.PI * 2;
    const START_ANGLE = -Math.PI / 2; // 12 o'clock
    const RING_PAD = 4;

    // Creep camp team attribution (colored fills, split wedges, clear-order
    // badges, route lines) is 1v1-only — it aggregates into red/blue teams and
    // mis-credits in team/FFA games. Render plain neutral rings instead.
    const nonOneVsOne = !!(window.wc3v && typeof window.wc3v.isNonOneVsOne === 'function'
      && window.wc3v.isNonOneVsOne());

    // Cached across frames: the group list and the clear orders are pure
    // functions of post-parse data (clearedTime / playerCredit never change
    // during playback), but both were rebuilt+re-sorted every single frame.
    // Keyed on the world object so a replay reload naturally invalidates.
    if (this._campCacheWorld !== world || this._campCacheNon1v1 !== nonOneVsOne) {
      this._campCacheWorld = world;
      this._campCacheNon1v1 = nonOneVsOne;
      this._campGroups = Object.values(world.neutralGroups);
      this._campOrders = this._computeCampOrders(this._campGroups, nonOneVsOne);
    }
    const groups = this._campGroups;
    const campOrders = this._campOrders;
    const claimPaths = {};

    groups.forEach((neutralGroup) => {
      const { uuid, clearedTime } = neutralGroup;

      // use tight unitBounds for rendering (falls back to padded bounds)
      const b = neutralGroup.unitBounds || neutralGroup.bounds;

      // Project the 4 bbox corners through the 3D camera and take the screen-
      // space AABB so camp rings land on the correct terrain surface.
      const _gs = window.wc3v && window.wc3v.gameScaler;
      const _c1 = _gs.projectXYInto(b.minX, b.minY, _cornerScratch[0]);
      const _c2 = _gs.projectXYInto(b.maxX, b.minY, _cornerScratch[1]);
      const _c3 = _gs.projectXYInto(b.minX, b.maxY, _cornerScratch[2]);
      const _c4 = _gs.projectXYInto(b.maxX, b.maxY, _cornerScratch[3]);
      // Any corner outside the frustum means the screen AABB would be wrong;
      // drop the camp entirely (CampPanel will hide its icon for the same
      // reason via its own projectToCssPixels check).
      if (!_c1 || !_c2 || !_c3 || !_c4) return;
      const _minPX = Math.min(_c1.x, _c2.x, _c3.x, _c4.x);
      const _maxPX = Math.max(_c1.x, _c2.x, _c3.x, _c4.x);
      const _minPY = Math.min(_c1.y, _c2.y, _c3.y, _c4.y);
      const _maxPY = Math.max(_c1.y, _c2.y, _c3.y, _c4.y);
      const rectWidth = _maxPX - _minPX;
      const rectHeight = _maxPY - _minPY;
      const drawX = _minPX + middleX;
      const drawY = _minPY + middleY;

      // ring geometry
      const centerX = drawX + rectWidth / 2;
      const centerY = drawY + rectHeight / 2;
      const radius = Math.max(rectWidth, rectHeight) / 2 + RING_PAD;

      // per-team progress from the per-player credit timeline; `isCleared`
      // keys off the credit model's clearedTime so the map agrees with the
      // credit panel rather than the legacy team-claim estimate.
      const currentTeams = this._teamProgressAt(neutralGroup, gameTime);
      const hasCampProgress = !!currentTeams;
      const isCleared = (clearedTime != null) && (gameTime >= clearedTime);

      // hide neutral units once any team has interacted with the camp
      if (hasCampProgress) {
        if (!neutralGroup.isHidden) {
          neutralGroup.isHidden = true;
          neutralPlayer.units.forEach(unit => {
            if (unit.neutralGroupId === uuid) {
              unit.isNeutralGroupHidden = true;
            }
          });
        }
      } else if (neutralGroup.isHidden) {
        neutralGroup.isHidden = false;
        neutralPlayer.units.forEach(unit => {
          if (unit.neutralGroupId === uuid) {
            unit.isNeutralGroupHidden = false;
          }
        });
      }

      // collect route paths — one node per team that cleared this camp,
      // placed in clear order (clearedTime)
      if (isCleared && currentTeams && !nonOneVsOne) {
        Object.entries(currentTeams).forEach(([teamId, progress]) => {
          if (progress <= 0.005) return;
          if (!claimPaths[teamId]) {
            claimPaths[teamId] = [];
          }
          claimPaths[teamId].push({ clearedTime, drawX, drawY, rectWidth, rectHeight });
        });
      }

      // During the guide creep tour, suppress every per-camp ground ring (track
      // ring + team progress arc + order badges) — the gold focus halo marks the
      // active camp. Bookkeeping + claimPaths above already ran; the route LINES
      // after this loop still draw (gated separately by displayCreepRoute).
      if (viewOptions && viewOptions.suppressCreepRings) return;

      const isHovered = (uuid === hoveredCampUuid);

      // ---- camp marker: segmented progress ring (Project C5) -------------
      // A faint full-circle track sits on every camp. A bright team-coloured
      // arc fills it clockwise from 12 o'clock as the camp is cleared, split
      // into one segment per team sized by that team's share of the clearing
      // work. A complete ring + a small centre dot (winner's colour) = cleared;
      // a dashed arc = a low-confidence verdict. A manual override (set in the
      // Camp panel) wins over the engine. Non-1v1 keeps a plain track ring.

      // 1) track ring — a dark casing under a faint light line, drawn on
      // every camp so the ring reads on light (snow) and dark terrain alike
      const trackW = isHovered ? 3 : 2.5;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, PI2);
      ctx.strokeStyle = '#0a0d13';
      ctx.globalAlpha = isHovered ? 0.7 : 0.5;
      ctx.lineWidth = trackW + 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, PI2);
      ctx.strokeStyle = '#FFF';
      ctx.globalAlpha = isHovered ? 0.7 : 0.42;
      ctx.lineWidth = trackW;
      ctx.stroke();

      if (currentTeams && !nonOneVsOne) {
        const pcredit = neutralGroup.playerCredit || {};

        // resolve the ring's team breakdown + state, applying any override
        let ringTeams = Object.entries(currentTeams).filter(([, v]) => v > 0.004);
        let ringUncertain = Object.keys(pcredit)
          .some(pid => pcredit[pid] && pcredit[pid].uncertain);
        let ringNeutral = false;     // grey ring — override said 'no credit'
        let suppressDot = false;

        const ov = neutralGroup._creditOverride;
        if (ov && ov.creditedPlayerId != null) {
          ringUncertain = false;     // a human has resolved this camp
          if (ov.creditedPlayerId === 'none') {
            ringNeutral = true; suppressDot = true;
          } else if (ov.creditedPlayerId === 'unclear') {
            ringUncertain = true; suppressDot = true;
          } else if (pcredit[ov.creditedPlayerId] &&
                     pcredit[ov.creditedPlayerId].teamId != null) {
            // collapse the ring onto the single overridden team
            const ovTeam = String(pcredit[ov.creditedPlayerId].teamId);
            const tot = ringTeams.reduce((s, t) => s + t[1], 0);
            ringTeams = [[ovTeam, tot]];
          }
        }

        // biggest contributor first — stable segment order + dot colour
        ringTeams.sort((a, b) => b[1] - a[1]);
        const total = ringTeams.reduce((s, t) => s + t[1], 0);
        const dotTeamId = (!suppressDot && ringTeams.length) ? ringTeams[0][0] : null;

        if (total > 0) {
          // a cleared camp is a whole circle (segments scaled to fill 360°);
          // an in-progress camp sweeps only `total` of the way round.
          const arcScale = isCleared ? (PI2 / total) : PI2;
          const halfGap = ringTeams.length > 1 ? 0.07 : 0;
          const arcW = isHovered ? 6 : 4.5;

          ctx.lineCap = 'butt';
          if (ringUncertain) ctx.setLineDash([7, 5]);

          // each segment is stroked twice — a wide dark casing, then the team
          // colour on top — so the ring keeps a contrasting border on both
          // edges and stays legible over any terrain colour.
          let angle = START_ANGLE;
          ringTeams.forEach(([teamId, share]) => {
            const seg = share * arcScale;
            const a0 = angle + halfGap;
            const a1 = angle + seg - halfGap;
            if (a1 - a0 > 0.03) {
              ctx.beginPath();
              ctx.arc(centerX, centerY, radius, a0, a1);
              ctx.strokeStyle = '#0a0d13';
              ctx.globalAlpha = isHovered ? 0.95 : 0.85;
              ctx.lineWidth = arcW + 3;
              ctx.stroke();

              ctx.beginPath();
              ctx.arc(centerX, centerY, radius, a0, a1);
              ctx.strokeStyle = ringNeutral ? '#aab4c2' : (teamColorMap[teamId] || '#FFF');
              ctx.globalAlpha = isHovered ? 1 : 0.96;
              ctx.lineWidth = arcW;
              ctx.stroke();
            }
            angle += seg;
          });
          ctx.setLineDash([]);

          // cleared — a small centre dot in the winning team's colour,
          // dark-ringed so it shows on any background
          if (isCleared && dotTeamId != null) {
            const dotR = Math.max(3.5, radius * 0.18);
            ctx.beginPath();
            ctx.arc(centerX, centerY, dotR, 0, PI2);
            ctx.fillStyle = teamColorMap[dotTeamId] || '#FFF';
            ctx.globalAlpha = 1;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#0a0d13';
            ctx.globalAlpha = 0.85;
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }

      // camp order badges — clear order per team, shown once the camp is
      // cleared (ranked by clearedTime, matches the credit panel)
      const orderMap = campOrders[uuid];
      if (isCleared && orderMap && !nonOneVsOne) {
        const teamIds = Object.keys(orderMap);
        teamIds.forEach((tid, idx) => {
          const teamOrder = orderMap[tid];
          if (!teamOrder) return;

          // position badges around the circle edge, spaced apart for multi-team
          const baseAngle = Math.PI / 4;
          const angleOffset = teamIds.length > 1 ? (idx - 0.5) * 0.6 : 0;
          const badgeAngle = baseAngle + angleOffset;
          const badgeX = centerX + Math.cos(badgeAngle) * (radius + 12);
          const badgeY = centerY + Math.sin(badgeAngle) * (radius + 12);
          const badgeColor = teamColorMap[tid] || '#FFF';
          Drawing.drawCampOrderBadge(ctx, `${teamOrder}`, badgeX, badgeY, badgeColor, teamIds.length > 1 ? 0.8 : 1);
        });
      }

      // (credit verdict — credited team(s) + low-confidence + manual override
      // — is rendered into the progress ring itself above; no separate badges)
    });

    // creep route lines
    if (!viewOptions.displayCreepRoute) {
      ctx.restore();
      return;
    }

    Object.keys(claimPaths).forEach(teamClaimId => {
      const claimPath = claimPaths[teamClaimId].sort((a, b) => {
        return a.clearedTime - b.clearedTime;
      });

      ctx.strokeStyle = teamColorMap[teamClaimId] || '#FFF';
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([]);

      for (let i = 1; i < claimPath.length; i++) {
        const prev = claimPath[i - 1];
        const step = claimPath[i];

        const prevMidX = prev.drawX + (prev.rectWidth / 2);
        const prevMidY = prev.drawY + (prev.rectHeight / 2);
        const stepMidX = step.drawX + (step.rectWidth / 2);
        const stepMidY = step.drawY + (step.rectHeight / 2);

        ctx.beginPath();
        ctx.moveTo(prevMidX, prevMidY);
        ctx.lineTo(stepMidX, stepMidY);
        ctx.stroke();
      }
    });

    ctx.setLineDash([]);
    ctx.restore();
  }

  renderNeutralBuildings (ctx, transform, viewOptions, neutralBuildings, gameScaler) {
    // 3D building models handle neutral building rendering now (ThreeMapRenderer).
    return;
    if (!viewOptions.displayNeutralBuildings || !neutralBuildings || !neutralBuildings.length) {
      return;
    }

    const {
      middleX,
      middleY,
      xScale,
      yScale
    } = gameScaler;

    const oldFillStyle = ctx.fillStyle;
    const oldStrokeStyle = ctx.strokeStyle;
    const oldAlpha = ctx.globalAlpha;
    const oldLineWidth = ctx.lineWidth;

    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.5;

    const iconSize = nb_type => {
      if (nb_type === 'ngol') return 22;
      return 18;
    };

    neutralBuildings.forEach(nb => {
      const _projNB = window.wc3v.gameScaler.projectXY(nb.x, nb.y);
      if (!_projNB) return;  // neutral building is outside the camera frustum
      const drawX = _projNB.x + middleX;
      const drawY = _projNB.y + middleY;
      const icon = this._neutralIcons[nb.type];
      const size = iconSize(nb.type);
      const half = size / 2;

      if (icon) {
        ctx.drawImage(icon, drawX - half, drawY - half, size, size);
      } else {
        // fallback: colored square if icon not loaded
        ctx.fillStyle = nb.type === 'ngol' ? '#d4a017' : '#9966cc';
        ctx.fillRect(drawX - half, drawY - half, size, size);
      }
    });

    ctx.fillStyle = oldFillStyle;
    ctx.strokeStyle = oldStrokeStyle;
    ctx.globalAlpha = oldAlpha;
    ctx.lineWidth = oldLineWidth;
  }

  renderMapGrid (ctx, transform, viewOptions, gameScaler, mapInfo, gridData, canvas) {
    const { gridXScale, gridYScale, xScale, yScale, middleX, middleY } = gameScaler;

    if (!viewOptions.displayWalkGrid  &&
        !viewOptions.displayWaterGrid &&
        !viewOptions.displayBuildGrid) {
      return;
    }

    return;

    const { gridSize } = mapInfo;
    const { full, playable } = gridSize;

    const gridHeight = gridData.length;
    const gridWidth  = gridData[0].length;

    const { width, height } = canvas;

    const tileHeight = (height / gridHeight);
    const tileWidth  = (width  / gridWidth);

    ctx.lineWidth = 1;

    let rCol = gridHeight - 1;

    ctx.globalAlpha = 1;

    for (let col = 0; col < gridHeight; col++) {
      for (let row = 0; row < gridWidth; row++) {
        const data = gridData[rCol][row];
        const {
          NoWater,
          NoWalk,
          NoFly,
          NoBuild,
          Blight,
          x,
          y
        } = data;

        const drawX = (row * tileWidth);
        const drawY = (col * tileHeight);

        const canWalk = (!NoWalk && NoBuild) || NoWater || Blight;

        if (viewOptions.displayWalkGrid && canWalk) {
          ctx.strokeStyle = "#FFF";
          ctx.strokeRect(drawX, drawY, tileWidth, tileHeight);
        }

        if (viewOptions.displayWaterGrid && !NoWater) {
          ctx.strokeStyle = "#0000AA";
          ctx.strokeRect(drawX, drawY, tileWidth, tileHeight);
        }

        if (viewOptions.displayBuildGrid && NoBuild) {
          ctx.strokeStyle = "#00AA00";
          ctx.strokeRect(drawX, drawY, tileWidth, tileHeight);
        }
      }

      rCol--;
    }
  }
};

window.MapRenderer = MapRenderer;
