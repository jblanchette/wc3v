// Both players' creep routes, drawn on the map they were walked on.
//
// A creep route is a spatial fact. Every surface that had one drew it as a
// numbered list of camp names, which is the right shape for "what did they
// kill" and the wrong shape for "where did they go" — the thing a route
// actually answers is whether somebody crossed the map, cut a corner, or never
// left their quarter of it, and no list says that.
//
// Everything here reads from a STORED SUMMARY. Not a live parse, not a .wc3v:
//
//   summary.mapInfo.bounds.map                world extent, for the transform
//   summary.mapInfo.name                      the map folder, for the image
//   summary.neutralCamps[].bounds             every camp on the map
//   summary.players[slot].heroBuilds[].camps  where each player went, in order
//   summary.players[slot].startingPosition    where they started
//
// which is why it works on the desktop's report and the site's compare drawer
// from the same code. This file was lifted out of CompareInline, where it was
// 220 inline lines that only the compare drawer could reach.
//
// A flat 2D canvas on purpose. GameScaler needs d3 and a live viewer, and
// MapRenderer needs a GameScaler; neither is worth carrying to plot a dozen
// points on a static image, and the desktop ships neither.
//
// TEXT STAYS OFF THE CANVAS. A map canvas is downscaled logical space, so
// anything written on it is small at every size the layout allows. The ordinals
// are markers rather than reading matter; every number a reader is meant to
// read goes in DOM beside the map, which is what `readout()` builds.

(function () {
  'use strict';

  // Ring padding around a projected camp, in canvas pixels. From
  // MapRenderer.renderNeutralGroups.
  const RING_PAD = 4;

  // Neutral buildings worth drawing. Gold mines are what a route is usually
  // about, so they are drawn larger.
  const NEUTRAL_TYPES = ['ngol', 'nfoh', 'nmoo', 'nmer', 'ntav', 'ngme', 'ngad', 'nmrk'];

  // Everything on the canvas is sized against this, so one drawing works at the
  // 340px it gets on the Overview and the 520px it gets on Economy without a
  // second set of numbers.
  const REF = 600;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  };

  const fmtMs = (ms) => {
    const m = Math.floor((ms || 0) / 60000);
    const s = Math.floor(((ms || 0) % 60000) / 1000);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Ordered, deduped camps for one player. A camp two heroes both visited
  // appears once, at the earlier time.
  const campsOf = (player) => {
    const all = [];
    for (const h of ((player && player.heroBuilds) || [])) {
      for (const c of (h.camps || [])) {
        if (c && c.x !== null && c.x !== undefined && c.y !== null && c.y !== undefined) {
          all.push(c);
        }
      }
    }
    all.sort((a, b) => (a.gameTimeMs || 0) - (b.gameTimeMs || 0));
    const seen = Object.create(null);
    const out = [];
    for (const c of all) {
      const key = c.groupId || `${c.x},${c.y}`;
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(c);
    }
    return out;
  };

  const loadImage = (src) => new Promise((resolve) => {
    if (!src) { resolve(null); return; }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

  // ── The transform ─────────────────────────────────────────────────────────
  //
  // Both bounds are [[xMin, yMax], [xMax, yMin]] — top-left then bottom-right.
  //
  // map.jpg covers the MAP extent, but a WC3 map's playable area is smaller than
  // that: Turtle Rock is 16384 units of map around 12288 of camera, so a third
  // of a square drawn at map extent is unplayable margin with nothing in it. The
  // view is therefore the CAMERA extent, and the background is cropped to match
  // — which buys about 35% more map for the same widget.
  //
  // Expanded to contain every point first. Nothing should sit outside the camera
  // bounds, but a route clipped in half is a far worse failure than a little
  // margin, so the drawing gives way rather than the data.
  const viewBounds = (mapInfo, pts) => {
    const b = mapInfo && mapInfo.bounds;
    if (!b || !b.map) return null;
    const [[mapXMin, mapYMax], [mapXMax, mapYMin]] = b.map;
    let xMin, yMax, xMax, yMin;
    if (b.camera) {
      [[xMin, yMax], [xMax, yMin]] = b.camera;
    } else {
      xMin = mapXMin; yMax = mapYMax; xMax = mapXMax; yMin = mapYMin;
    }
    const pad = 256;
    for (const p of pts) {
      xMin = Math.min(xMin, p.x - pad); xMax = Math.max(xMax, p.x + pad);
      yMin = Math.min(yMin, p.y - pad); yMax = Math.max(yMax, p.y + pad);
    }
    // Never wider than the art itself.
    xMin = Math.max(xMin, mapXMin); xMax = Math.min(xMax, mapXMax);
    yMin = Math.max(yMin, mapYMin); yMax = Math.min(yMax, mapYMax);
    if (xMax - xMin <= 0 || yMax - yMin <= 0) return null;
    return { xMin, xMax, yMin, yMax, mapXMin, mapXMax, mapYMin, mapYMax };
  };

  const transformFor = (view, pts, W, H) => {
    if (view) {
      const worldW = view.xMax - view.xMin;
      const worldH = view.yMax - view.yMin;
      if (worldW > 0 && worldH > 0) {
        return (wx, wy) => ({
          x: ((wx - view.xMin) / worldW) * W,
          // WC3 +Y is north. Canvas +Y is down. Flip.
          y: ((view.yMax - wy) / worldH) * H
        });
      }
    }
    // No bounds: a summary stored before mapInfo existed, or a map not in the
    // library. Self-scale off the points themselves so the SHAPE of the route
    // still reads, even though it is no longer registered to terrain.
    if (!pts.length) return null;
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const pad = 800;
    const xmin = Math.min(...xs) - pad, xmax = Math.max(...xs) + pad;
    const ymin = Math.min(...ys) - pad, ymax = Math.max(...ys) + pad;
    return (wx, wy) => ({
      x: ((wx - xmin) / (xmax - xmin)) * W,
      y: ((ymax - wy) / (ymax - ymin)) * H
    });
  };

  // ── Painting ──────────────────────────────────────────────────────────────

  const paint = (canvas, model, assets) => {
    const ctx = canvas.getContext('2d');
    const W = model.size;
    const H = model.size;
    // Marker scale. Deliberately NOT W/REF: the ordinals, dots and route lines
    // are markers rather than a picture of the map, so shrinking them with the
    // canvas makes a 340px map unreadable to save space it is not short of. Held
    // within a narrow band so one drawing works at every size the layout uses.
    const k = Math.max(0.85, Math.min(1.15, W / REF));

    // Backing store at device resolution; the context is scaled so every
    // coordinate below is in CSS pixels. Without this the whole plot is a blur
    // on any display with a scale factor, which is most of them.
    const dpr = Math.min(3, (window.devicePixelRatio || 1));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const view = viewBounds(model.mapInfo, model.allPoints);
    const w2c = transformFor(view, model.allPoints, W, H);
    if (!w2c) return false;

    // 1. Terrain. map.jpg covers the full map extent, so a flat draw to
    //    0,0 → W,H lines up with the transform above.
    if (assets.mapImage && view) {
      // Source rect = where the view sits inside the full-extent art.
      const img = assets.mapImage;
      const fx = img.naturalWidth / (view.mapXMax - view.mapXMin);
      const fy = img.naturalHeight / (view.mapYMax - view.mapYMin);
      ctx.drawImage(
        img,
        (view.xMin - view.mapXMin) * fx,
        (view.mapYMax - view.yMax) * fy,
        (view.xMax - view.xMin) * fx,
        (view.yMax - view.yMin) * fy,
        0, 0, W, H
      );
    } else {
      ctx.fillStyle = '#0a0d10';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#1d2228';
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        const v = (i / 8) * W;
        ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, v); ctx.lineTo(W, v); ctx.stroke();
      }
    }

    // 2. Neutral buildings. Trees are deliberately NOT overlaid: the minimap
    //    already represents terrain the way the game does, and tree dots on top
    //    of it would draw the same thing twice.
    if (assets.neutrals && assets.neutrals.length) {
      ctx.globalAlpha = 0.95;
      for (const nb of assets.neutrals) {
        if (!nb || nb.x === null || nb.x === undefined || nb.y === null || nb.y === undefined) continue;
        const cp = w2c(nb.x, nb.y);
        const sz = (nb.type === 'ngol' ? 18 : 14) * k;
        const half = sz / 2;
        const icon = assets.icons && assets.icons[nb.type];
        if (icon && icon.complete && icon.naturalWidth) {
          ctx.drawImage(icon, cp.x - half, cp.y - half, sz, sz);
        } else {
          ctx.fillStyle = nb.type === 'ngol' ? '#d4a017' : '#9966cc';
          ctx.fillRect(cp.x - half, cp.y - half, sz, sz);
        }
      }
      ctx.globalAlpha = 1;
    }

    // 3. Vignette, over the terrain layers and under the route, so the lines
    //    read against a busy minimap without hiding it.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(0, 0, W, H);

    // Project a world-space bounds rectangle to a screen-space centre and
    // radius. From MapRenderer.renderNeutralGroups.
    const projectCamp = (b) => {
      const c1 = w2c(b.minX, b.minY), c2 = w2c(b.maxX, b.minY);
      const c3 = w2c(b.minX, b.maxY), c4 = w2c(b.maxX, b.maxY);
      const minPX = Math.min(c1.x, c2.x, c3.x, c4.x);
      const maxPX = Math.max(c1.x, c2.x, c3.x, c4.x);
      const minPY = Math.min(c1.y, c2.y, c3.y, c4.y);
      const maxPY = Math.max(c1.y, c2.y, c3.y, c4.y);
      return {
        cx: (minPX + maxPX) / 2,
        cy: (minPY + maxPY) / 2,
        radius: Math.max(maxPX - minPX, maxPY - minPY) / 2 + RING_PAD * k
      };
    };

    // 4. Every camp on the map, as a thin ring. The camps NOBODY took are the
    //    half of the story a route alone cannot tell.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5 * k;
    for (const ring of model.allCamps) {
      if (!ring.bounds) continue;
      const { cx, cy, radius } = projectCamp(ring.bounds);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // 5. One route per seat.
    const drawRoute = (route) => {
      const camps = route.camps;
      const startPos = route.start;
      if (!camps.length && !startPos) return;
      const color = route.color;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5 * k;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 3 * k;
      ctx.beginPath();
      let first = true;
      if (startPos) {
        const sp = w2c(startPos.x, startPos.y);
        ctx.moveTo(sp.x, sp.y); first = false;
      }
      for (const c of camps) {
        const cp = w2c(c.x, c.y);
        if (first) { ctx.moveTo(cp.x, cp.y); first = false; }
        else ctx.lineTo(cp.x, cp.y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (startPos) {
        const sp = w2c(startPos.x, startPos.y);
        const half = 6 * k;
        ctx.fillStyle = color;
        ctx.fillRect(sp.x - half, sp.y - half, half * 2, half * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * k;
        ctx.strokeRect(sp.x - half, sp.y - half, half * 2, half * 2);
      }

      const dot = 9 * k;
      camps.forEach((c, i) => {
        const cp = w2c(c.x, c.y);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, dot, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#0a0d10';
        ctx.lineWidth = 2 * k;
        ctx.stroke();
        ctx.fillStyle = '#0a0d10';
        ctx.font = `bold ${Math.max(10, Math.round(11 * k))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), cp.x, cp.y);
      });
    };

    // Later seats on top. Drawn back to front so seat order decides overlap
    // rather than whichever happened to be painted last.
    for (let i = model.routes.length - 1; i >= 0; i--) drawRoute(model.routes[i]);
    return true;
  };

  // ── Model ─────────────────────────────────────────────────────────────────

  const buildModel = (summary, opts) => {
    const players = (summary && summary.players) || {};
    const slots = opts.seats && opts.seats.length
      ? opts.seats.map(String)
      : Object.keys(players).filter(s => players[s] && !players[s].isNeutralPlayer);

    const routes = slots.map((slot) => {
      const p = players[slot] || {};
      return {
        slot,
        name: (opts.nameFor && opts.nameFor(slot, p)) || p.name || `Seat ${slot}`,
        race: p.race || null,
        color: opts.colorFor ? opts.colorFor(slot, p) : '#5fa5cb',
        start: p.startingPosition || null,
        camps: campsOf(p)
      };
    }).filter(r => r.camps.length || r.start);

    const allCamps = (summary && summary.neutralCamps) || [];

    // Everything the fallback transform has to fit when there are no bounds.
    const allPoints = [];
    for (const r of routes) {
      if (r.start) allPoints.push({ x: r.start.x, y: r.start.y });
      for (const c of r.camps) allPoints.push({ x: c.x, y: c.y });
    }
    for (const c of allCamps) {
      if (c && c.bounds) {
        allPoints.push({
          x: (c.bounds.minX + c.bounds.maxX) / 2,
          y: (c.bounds.minY + c.bounds.maxY) / 2
        });
      }
    }

    return {
      mapInfo: (summary && summary.mapInfo) || null,
      folder: (summary && summary.mapInfo && summary.mapInfo.name) || null,
      size: opts.size || 340,
      routes,
      allCamps,
      allPoints
    };
  };

  // The numbers, in DOM, beside the map. Doubles as the legend: each row is
  // led by its own route's colour, so no separate key is needed.
  const readout = (model) => {
    const box = el('div', 'crm-read');
    for (const r of model.routes) {
      const row = el('div', 'crm-seat');
      const pip = el('span', 'crm-pip');
      pip.style.background = r.color;
      row.appendChild(pip);

      const body = el('div', 'crm-seat-b');
      body.appendChild(el('span', 'crm-name', r.name));

      const levels = r.camps.reduce((n, c) => n + (c.totalLevel || 0), 0);
      const xp = r.camps.reduce((n, c) => n + (c.xpGained || 0), 0);
      const first = r.camps.length ? r.camps[0].gameTimeMs : null;

      const stats = el('span', 'crm-stats');
      stats.appendChild(el('b', null, String(r.camps.length)));
      stats.appendChild(el('span', null, r.camps.length === 1 ? ' camp' : ' camps'));
      if (levels) {
        stats.appendChild(el('span', 'crm-sep', ' · '));
        stats.appendChild(el('b', null, String(levels)));
        stats.appendChild(el('span', null, ' levels'));
      }
      body.appendChild(stats);

      const more = [];
      if (first !== null && first !== undefined) more.push(`first ${fmtMs(first)}`);
      if (xp) more.push(`${xp.toLocaleString()} XP`);
      if (more.length) body.appendChild(el('span', 'crm-sub', more.join(' · ')));

      row.appendChild(body);
      box.appendChild(row);
    }

    const touched = new Set();
    for (const r of model.routes) for (const c of r.camps) if (c.groupId) touched.add(c.groupId);
    const untouched = model.allCamps.filter(c => c && c.groupId && !touched.has(c.groupId)).length;
    if (untouched) {
      box.appendChild(el('div', 'crm-foot',
        `${untouched} camp${untouched === 1 ? '' : 's'} nobody took`));
    }
    return box;
  };

  // ── Public ────────────────────────────────────────────────────────────────

  const CreepRouteMap = {
    // Is there anything to draw? Callers use this to decide whether to build a
    // section at all, rather than mounting one that renders empty.
    unavailable (summary) {
      if (!summary) return 'No game.';
      const players = (summary.players) || {};
      const any = Object.keys(players).some(s => campsOf(players[s]).length);
      if (!any) return 'No creep camps were taken in this game.';
      return null;
    },

    /**
     * summary  a stored match summary
     * opts
     *   size        px, square. 340 on a report column, 520 on a wide tab.
     *   seats       slots to draw. Every human seat by default.
     *   colorFor    (slot, player) => css colour
     *   nameFor     (slot, player) => display name. The stored summary carries
     *               raw battle tags; every other name on these screens is
     *               cleaned, and the caller is what knows how.
     *   mapAsset    (folder, file) => url. '/maps/…' on the site, the CDN on
     *               the desktop. Omit and the map draws on the grid fallback.
     *   iconAsset   (type) => url for a neutral-building sprite. Optional.
     *
     * Returns { el, destroy } or null when there is nothing to draw. The canvas
     * paints asynchronously; `el` is usable immediately.
     */
    build (summary, opts = {}) {
      if (this.unavailable(summary)) return null;
      const model = buildModel(summary, opts);
      if (!model.routes.length) return null;

      const wrap = el('div', 'crm');
      const figure = el('div', 'crm-fig');
      const canvas = document.createElement('canvas');
      canvas.className = 'crm-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label',
        `Creep routes on ${model.folder || 'this map'}`);
      canvas.style.width = `${model.size}px`;
      canvas.style.height = `${model.size}px`;
      figure.appendChild(canvas);
      wrap.appendChild(figure);
      wrap.appendChild(readout(model));

      let dead = false;
      (async () => {
        const assets = { mapImage: null, neutrals: null, icons: null };
        if (model.folder && opts.mapAsset) {
          assets.mapImage = await loadImage(opts.mapAsset(model.folder, 'map.jpg'));
        }
        if (opts.neutrals) {
          try { assets.neutrals = await opts.neutrals(model.folder); } catch (e) { /* optional layer */ }
        }
        if (assets.neutrals && assets.neutrals.length && opts.iconAsset) {
          const pairs = await Promise.all(NEUTRAL_TYPES.map(async (t) =>
            [t, await loadImage(opts.iconAsset(t))]));
          assets.icons = {};
          for (const [t, img] of pairs) if (img) assets.icons[t] = img;
        }
        if (dead || !canvas.isConnected) return;
        try {
          if (!paint(canvas, model, assets)) {
            figure.replaceChildren(el('div', 'crm-empty', 'No map data for this game.'));
          }
        } catch (e) {
          figure.replaceChildren(el('div', 'crm-empty', 'The route map could not be drawn.'));
        }
      })();

      return {
        el: wrap,
        destroy () { dead = true; }
      };
    },

    // Exported because MatchSummaryView's own creep blocks want the same
    // ordering and dedupe, and two answers to "which camps did this player
    // take" is one too many.
    campsOf
  };

  if (typeof window !== 'undefined') window.CreepRouteMap = CreepRouteMap;
  if (typeof module !== 'undefined' && module.exports) module.exports = CreepRouteMap;
})();
