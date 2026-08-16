/**
 * MinimapPip — camera viewport indicator overlay.
 *
 * Renders a small inset minimap in the bottom-left corner of #main-wrapper
 * showing a darkened map background with bright player buildings and heroes.
 * Uses the full map extent (not just playable area) so the 3D camera frustum
 * always fits within the minimap bounds.
 * Supports click-to-move and drag-to-pan.
 * Only visible when zoomed in (k > 1.05).
 */
(function () {
  const BASE_SIZE = 180;
  const FULLSCREEN_SIZE = 220;
  const SHOW_THRESHOLD = 1.05;

  const BUILDING_SIZE = 5;
  const HERO_SIZE = 6;

  class MinimapPip {
    constructor (viewer) {
      this.viewer = viewer;
      this.container = null;
      this.canvas = null;
      this.ctx = null;
      this.bgCanvas = null;
      this.minimapWidth = 0;
      this.minimapHeight = 0;
      this._isDragging = false;
      this._visible = false;
      this._bound = {};
      this._lastTx = null;
      this._lastTy = null;
      this._lastK = null;
      this._lastGameTime = null;
    }

    setup () {
      this._createDOM();
      this._setupScales();
      this._renderBackground();
      this._attachEvents();
    }

    _createDOM () {
      const container = document.createElement('div');
      container.id = 'minimap-pip';
      container.className = 'minimap-pip';

      const canvas = document.createElement('canvas');
      container.appendChild(canvas);

      // Prefer the bottom-right corner stack so the economy panel stacks
      // cleanly above the minimap. Falls back to main-wrapper when the
      // stack wrapper isn't present (legacy layout).
      const stack = document.getElementById('bottom-right-stack');
      const wrapper = stack || document.getElementById('main-wrapper');
      if (wrapper) {
        wrapper.appendChild(container);
      }

      this.container = container;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');

      this._calcSize();
    }

    _calcSize () {
      const gs = this.viewer.gameScaler;
      if (!gs) return;

      const maxDim = document.fullscreenElement ? FULLSCREEN_SIZE : BASE_SIZE;
      // Use full map image dimensions for aspect ratio (includes margins)
      const fw = gs.fullMapImage.width;
      const fh = gs.fullMapImage.height;

      if (fw >= fh) {
        this.minimapWidth = maxDim;
        this.minimapHeight = Math.round(maxDim * (fh / fw));
      } else {
        this.minimapHeight = maxDim;
        this.minimapWidth = Math.round(maxDim * (fw / fh));
      }

      this.canvas.width = this.minimapWidth;
      this.canvas.height = this.minimapHeight;
      this.canvas.style.width = this.minimapWidth + 'px';
      this.canvas.style.height = this.minimapHeight + 'px';
    }

    /**
     * Create linear mappings from WC3 world coords (mapExtent) to minimap pixels.
     * These cover the FULL map, not just the playable area, so the 3D camera
     * frustum always fits within the minimap.
     */
    _setupScales () {
      const gs = this.viewer.gameScaler;
      if (!gs) return;

      const me = gs.mapExtent;
      // mapExtent.x = [minX, maxX], mapExtent.y = [top, bottom] (y inverted: top > bottom)
      this._worldMinX = me.x[0];
      this._worldMaxX = me.x[1];
      this._worldMinY = me.y[0]; // top (larger value)
      this._worldMaxY = me.y[1]; // bottom (smaller value)
    }

    /** Convert WC3 world X to minimap pixel X */
    _worldToMinimapX (wx) {
      return ((wx - this._worldMinX) / (this._worldMaxX - this._worldMinX)) * this.minimapWidth;
    }

    /** Convert WC3 world Y to minimap pixel Y (WC3 Y is inverted: top=positive) */
    _worldToMinimapY (wy) {
      return ((this._worldMinY - wy) / (this._worldMinY - this._worldMaxY)) * this.minimapHeight;
    }

    _renderBackground () {
      const gs = this.viewer.gameScaler;
      const mapImg = this.viewer.mapImage;
      if (!gs || !mapImg || !mapImg.complete) return;

      const bg = document.createElement('canvas');
      bg.width = this.minimapWidth;
      bg.height = this.minimapHeight;
      const bgCtx = bg.getContext('2d');

      // Draw FULL map image (no cropping) — includes margins so frustum fits
      bgCtx.drawImage(mapImg, 0, 0, mapImg.width, mapImg.height,
        0, 0, this.minimapWidth, this.minimapHeight);

      // Darken so player markers pop
      bgCtx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      bgCtx.fillRect(0, 0, this.minimapWidth, this.minimapHeight);

      this.bgCanvas = bg;
    }

    _attachEvents () {
      this._bound.pointerdown = (e) => this._handlePointerDown(e);
      this._bound.pointermove = (e) => this._handlePointerMove(e);
      this._bound.pointerup = (e) => this._handlePointerUp(e);

      this.canvas.addEventListener('pointerdown', this._bound.pointerdown);
      this.canvas.addEventListener('pointermove', this._bound.pointermove);
      this.canvas.addEventListener('pointerup', this._bound.pointerup);
    }

    _handlePointerDown (e) {
      e.preventDefault();
      e.stopPropagation();
      this._isDragging = true;
      this.canvas.setPointerCapture(e.pointerId);

      if (this.viewer.broadcastCamera && this.viewer.broadcastCamera.enabled) {
        this.viewer.broadcastCamera.setMode(window.CameraMode.FREE);
      }
      // _moveCameraFromEvent drives d3 programmatically from a NATIVE pointer
      // listener, so d3.event is unset, sourceEvent is null, and the camera's
      // own zoom hook never sees this as a user gesture. Say so explicitly or
      // the auto-return countdown misses the whole minimap path.
      this._noteGesture();

      this._moveCameraFromEvent(e);
    }

    _handlePointerMove (e) {
      if (!this._isDragging) return;
      e.preventDefault();
      e.stopPropagation();
      this._noteGesture();
      this._moveCameraFromEvent(e);
    }

    _noteGesture () {
      const bc = this.viewer.broadcastCamera;
      if (bc && bc.noteUserGesture) bc.noteUserGesture();
    }

    _handlePointerUp (e) {
      if (!this._isDragging) return;
      this._isDragging = false;
      this.canvas.releasePointerCapture(e.pointerId);
    }

    _moveCameraFromEvent (e) {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const gs = this.viewer.gameScaler;
      if (!gs) return;

      // Convert minimap pixel → world coords using mapExtent scales
      const wx = this._worldMinX + (mx / this.minimapWidth) * (this._worldMaxX - this._worldMinX);
      const wy = this._worldMinY - (my / this.minimapHeight) * (this._worldMinY - this._worldMaxY);

      // World coords → viewExtent canvas pixel coords (what D3 zoom uses)
      const canvasX = gs.xScale(wx) + gs.middleX;
      const canvasY = gs.yScale(wy) + gs.middleY;

      // D3 zoom.translateTo expects CSS display-space coords
      const ds = this.viewer.displayScale || 1;
      this.viewer.zoomContainer.call(this.viewer.zoom.translateTo, canvasX * ds, canvasY * ds);
    }

    update () {
      const v = this.viewer;
      if (!v.gameLoaded || !v.gameScaler || v.layoutMode === 'static-bo') {
        this._setVisible(false);
        return;
      }

      this._setVisible(true);

      // In split-screen mode, always redraw (two viewports change each frame)
      const isSplit = v.broadcastCamera && v.broadcastCamera.isSplitActive;
      if (!isSplit) {
        const { x: tx, y: ty, k } = v.transform;
        // gameTime advances every frame during playback, so comparing it raw
        // made this guard never fire while playing — a full redraw (scan of
        // every unit of every player) 60×/s for a 180px minimap. Quantize to
        // 8Hz of game time: pips move a fraction of a pixel per bucket.
        const gt = Math.floor(v.gameTime / 125);
        if (tx === this._lastTx && ty === this._lastTy &&
            k === this._lastK && gt === this._lastGameTime) return;
        this._lastTx = tx;
        this._lastTy = ty;
        this._lastK = k;
        this._lastGameTime = gt;
      }

      this._drawFrame();
    }

    _drawFrame () {
      const ctx = this.ctx;
      const w = this.minimapWidth;
      const h = this.minimapHeight;
      const v = this.viewer;

      ctx.clearRect(0, 0, w, h);

      // Darkened terrain background
      if (this.bgCanvas) {
        ctx.drawImage(this.bgCanvas, 0, 0);
      }

      // Player buildings and heroes
      this._drawPlayerEntities(ctx);

      // Split-screen mode: show two viewport regions in player colors
      const isSplit = v.broadcastCamera && v.broadcastCamera.isSplitActive;
      if (isSplit && v.broadcastCamera.splitTargets) {
        this._drawSplitViewports(ctx, w, h);
        return;
      }

      // Single viewport mode
      const viewRect = this._computeViewRect();

      // Dim outside viewport
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      if (viewRect.isQuad) {
        ctx.moveTo(viewRect.pts[0], viewRect.pts[1]);
        ctx.lineTo(viewRect.pts[2], viewRect.pts[3]);
        ctx.lineTo(viewRect.pts[4], viewRect.pts[5]);
        ctx.lineTo(viewRect.pts[6], viewRect.pts[7]);
        ctx.closePath();
      } else {
        ctx.rect(viewRect.rx, viewRect.ry, viewRect.rw, viewRect.rh);
      }
      ctx.clip('evenodd');
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();

      // Viewport border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1.5;
      if (viewRect.isQuad) {
        ctx.beginPath();
        ctx.moveTo(viewRect.pts[0], viewRect.pts[1]);
        ctx.lineTo(viewRect.pts[2], viewRect.pts[3]);
        ctx.lineTo(viewRect.pts[4], viewRect.pts[5]);
        ctx.lineTo(viewRect.pts[6], viewRect.pts[7]);
        ctx.closePath();
        ctx.stroke();
      } else {
        ctx.strokeRect(viewRect.rx + 0.5, viewRect.ry + 0.5, viewRect.rw - 1, viewRect.rh - 1);
      }

      // Teleport destination pulses — small bright dot at each active TP's
      // target so users notice incoming portals even when looking away. See
      // client/docs/Z_INDEX.md (L5 ACTION INDICATORS — minimap mirror).
      this._drawTeleportPulses(ctx);
    }

    /** Small pulsing yellow dot at each active TP destination on the minimap. */
    _drawTeleportPulses (ctx) {
      const v = this.viewer;
      if (!v.viewOptions || v.viewOptions.displayTeleports === false) return;
      if (!v.players || !v.players.length) return;
      const gt = v.gameTime;
      ctx.save();
      for (const player of v.players) {
        const tps = player.teleportEvents || [];
        for (const tp of tps) {
          const cast = tp.gameTime;
          const apply = tp.appliedAt != null ? tp.appliedAt : (tp.gameTime + tp.channelMs);
          // Pulse during channel and for a brief moment after apply.
          if (gt < cast - 200 || gt > apply + 800) continue;
          if (!tp.destination) continue;
          const mx = this._worldToMinimapX(tp.destination.x);
          const my = this._worldToMinimapY(tp.destination.y);
          if (!isFinite(mx) || !isFinite(my)) continue;
          const elapsed = gt - cast;
          const channelMs = Math.max(1, apply - cast);
          const inChannel = gt >= cast && gt < apply;
          const pulse = 0.65 + 0.35 * Math.sin(elapsed / (inChannel ? 90 : 60));
          // Category-aware pulse: single-unit hero teleports get a cyan
          // dot so a player glancing at the minimap can tell "1 hero TP'd"
          // apart from "Town Portal landed". Falls back to gold for
          // group / mass / blink and for older replays missing the field.
          const isSingleUnit = (tp.abilityCategory === 'single-unit') ||
            (tp.abilityCode === 'stel' || tp.abilityCode === 'spre' || tp.abilityCode === 'ssan');
          const haloColor  = isSingleUnit ? '#4FD2FF' : '#FFD24A';
          const coreColor  = isSingleUnit ? '#A8EAFF' : '#FFE072';
          // Outer halo
          ctx.globalAlpha = 0.5 * pulse;
          ctx.fillStyle = haloColor;
          ctx.beginPath();
          ctx.arc(mx, my, inChannel ? 6 : 8, 0, Math.PI * 2);
          ctx.fill();
          // Bright core
          ctx.globalAlpha = 0.95;
          ctx.fillStyle = coreColor;
          ctx.beginPath();
          ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
          ctx.fill();
          // Ring
          ctx.globalAlpha = 0.85;
          ctx.lineWidth = 1;
          ctx.strokeStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(mx, my, inChannel ? 5 : 7, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    /** Draw two viewport rectangles for split-screen mode, each in player color */
    _drawSplitViewports (ctx, w, h) {
      const bc = this.viewer.broadcastCamera;
      const targets = bc.splitTargets;
      const gs = this.viewer.gameScaler;
      if (!gs || !gs.viewExtent) return;

      const viewWorldW = gs.viewExtent.x[1] - gs.viewExtent.x[0];
      const viewWorldH = Math.abs(gs.viewExtent.y[1] - gs.viewExtent.y[0]);

      const sides = [
        { target: targets.left,  player: targets.players[0] },
        { target: targets.right, player: targets.players[1] }
      ];

      // Dim everything first
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.fillRect(0, 0, w, h);

      for (const side of sides) {
        const { wx, wy, k } = side.target;
        // Compute the visible world rect for this half
        const halfW = viewWorldW / k / 2;
        const halfH = viewWorldH / k / 2;

        const rx = this._worldToMinimapX(wx - halfW);
        const ry = this._worldToMinimapY(wy + halfH); // Y inverted
        const rw = this._worldToMinimapX(wx + halfW) - rx;
        const rh = this._worldToMinimapY(wy - halfH) - ry;

        // Brighten viewport area
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx, ry, rw, rh);
        ctx.clip();
        ctx.clearRect(rx, ry, rw, rh);
        if (this.bgCanvas) {
          ctx.drawImage(this.bgCanvas, 0, 0);
        }
        ctx.restore();

        // Draw viewport border in player color
        const color = side.player ? side.player.teamColor : 'rgba(255,255,255,0.8)';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
      }
    }

    _computeViewRect () {
      const v = this.viewer;
      const three = v.threeMapRenderer;

      if (three && three.ready && three.camera && window.THREE) {
        return this._computeFrustumQuad(three);
      }

      // 2D fallback — convert viewExtent canvas pixels to minimap pixels
      const gs = v.gameScaler;
      const { x: tx, y: ty, k } = v.transform;
      // Visible canvas pixel rect
      const visLeft = -tx / k;
      const visTop = -ty / k;
      const visW = gs.sceneWidth / k;
      const visH = gs.sceneHeight / k;
      // Convert canvas pixels to world coords, then to minimap
      const wLeft = gs.xScale.invert(visLeft - gs.middleX);
      const wTop = gs.yScale.invert(visTop - gs.middleY);
      const wRight = gs.xScale.invert(visLeft + visW - gs.middleX);
      const wBottom = gs.yScale.invert(visTop + visH - gs.middleY);

      return {
        isQuad: false,
        rx: this._worldToMinimapX(wLeft),
        ry: this._worldToMinimapY(wTop),
        rw: this._worldToMinimapX(wRight) - this._worldToMinimapX(wLeft),
        rh: this._worldToMinimapY(wBottom) - this._worldToMinimapY(wTop)
      };
    }

    _computeFrustumQuad (three) {
      const camera = three.camera;
      const ext = three.mapInfo.bounds.map;
      const mapCenterX = (ext[0][0] + ext[0][1]) / 2;
      const mapCenterY = (ext[1][0] + ext[1][1]) / 2;

      if (!this._unproj) {
        this._unproj = new THREE.Vector3();
        this._rayDir = new THREE.Vector3();
      }

      // NDC corners: top-left, top-right, bottom-right, bottom-left
      const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
      const pts = new Float64Array(8);

      for (let i = 0; i < 4; i++) {
        this._unproj.set(corners[i][0], corners[i][1], 0);
        this._unproj.unproject(camera);

        this._rayDir.copy(this._unproj).sub(camera.position).normalize();

        const t = -camera.position.y / this._rayDir.y;
        if (t <= 0) {
          // Fallback if ray misses ground
          return this._computeViewRect_2D();
        }

        // Three.js ground hit → WC3 world coords
        const wcX = camera.position.x + t * this._rayDir.x + mapCenterX;
        const wcY = -(camera.position.z + t * this._rayDir.z) + mapCenterY;

        pts[i * 2] = this._worldToMinimapX(wcX);
        pts[i * 2 + 1] = this._worldToMinimapY(wcY);
      }

      return { isQuad: true, pts };
    }

    _drawPlayerEntities (ctx) {
      const v = this.viewer;
      const gameTime = v.gameTime;
      const halfB = BUILDING_SIZE / 2;

      for (let pi = 0; pi < v.players.length; pi++) {
        const player = v.players[pi];
        if (player.isNeutralPlayer) continue;

        const color = player.teamColor;
        ctx.fillStyle = color;

        for (let ui = 0; ui < player.units.length; ui++) {
          const unit = player.units[ui];
          if (gameTime < unit.readyTime) continue;
          if (unit.destroyedAt && gameTime >= unit.destroyedAt) continue;

          if (unit.isBuilding) {
            if (!unit.lastPosition) continue;
            const mx = this._worldToMinimapX(unit.lastPosition.x);
            const my = this._worldToMinimapY(unit.lastPosition.y);
            ctx.fillRect(mx - halfB, my - halfB, BUILDING_SIZE, BUILDING_SIZE);
          }
        }

        // Heroes on top
        if (!player.heroes) continue;
        for (let hi = 0; hi < player.heroes.length; hi++) {
          const hero = player.heroes[hi];
          if (hero.currentX == null || isNaN(hero.currentX)) continue;
          if (gameTime < hero.readyTime) continue;
          if (hero.destroyedAt && gameTime >= hero.destroyedAt) continue;

          const mx = this._worldToMinimapX(hero.currentX);
          const my = this._worldToMinimapY(hero.currentY);

          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(mx, my, HERO_SIZE / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    _setVisible (show) {
      if (this._visible === show) return;
      this._visible = show;
      if (this.container) {
        this.container.classList.toggle('minimap-pip-visible', show);
      }
    }

    resize () {
      this._calcSize();
      this._setupScales();
      this._renderBackground();
    }

    destroy () {
      if (this.canvas) {
        this.canvas.removeEventListener('pointerdown', this._bound.pointerdown);
        this.canvas.removeEventListener('pointermove', this._bound.pointermove);
        this.canvas.removeEventListener('pointerup', this._bound.pointerup);
      }
      if (this.container && this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }
      this.container = null;
      this.canvas = null;
      this.ctx = null;
      this.bgCanvas = null;
    }
  }

  window.MinimapPip = MinimapPip;
})();
