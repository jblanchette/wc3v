/*
  PathTrailRenderer3D — renders 3D hero path trails inside the
  ThreeMapRenderer scene. Replaces the legacy 2D `ClientUnit.renderPath`.

  Three switchable styles (set via viewOptions.pathTrailStyle):
    - 'combo'      Footsteps + sonar rings together (default)
    - 'footsteps'  Discrete footprint stamps along the path, alternating L/R
    - 'rings'      Sonar-style expanding rings emitted at the hero's position

  Performance notes:
    - Footsteps are rebuilt at most every REBUILD_INTERVAL_MS or when the
      hero's path index advances (whichever comes first).
    - Rings update per-frame but only mutate a small fixed-size InstancedMesh
      — no geometry recreation.
    - All shared materials use AdditiveBlending with alpha premultiplied into
      the color channels — no custom shaders needed for fading.
*/
(function () {
  if (!window.THREE) return;

  const STYLES = ['combo', 'footsteps', 'rings'];

  // ---- shared ----
  const Y_OFFSET             = 6;
  const HERO_TTL_MS          = 2000;
  const RENDER_ORDER         = 2;
  const REBUILD_INTERVAL_MS  = 500;        // wall-clock throttle for static rebuilds

  // ---- rings ----
  const RING_LIFETIME_MS     = 1700;
  const RING_SPAWN_DT_MS     = 1100;       // cadence — sparser pulses
  const RING_MAX             = 8;          // pool per hero — only need a couple visible at once
  const RING_INNER_R         = 22;         // initial radius
  const RING_OUTER_R         = 145;        // final radius
  const RING_HEAD_ALPHA      = 1.15;       // can exceed 1 with additive

  // ---- footsteps ----
  // Stamp position / yaw / side are normally pre-baked into hero.footprints by
  // lib/footprintGen.js at parse time. Replays parsed before that feature (or
  // any stale .wc3v) lack the field — `generateFootprints` below recomputes it
  // client-side from the hero's path. The algorithm is identical & fully
  // deterministic, so the fallback matches the server pre-bake exactly.
  const FOOT_W               = 40;         // sprite world width
  const FOOT_L               = 62;         // sprite world length
  const FOOT_MAX             = 56;         // max visible stamps per hero per frame
  const FOOT_HEAD_ALPHA      = 1.1;        // can exceed 1 with additive
  const FOOT_Y               = Y_OFFSET + 3;

  // ---- footprint generation (mirror of lib/footprintGen.js) -------------
  // Keep these in sync with the server module. They must produce byte-identical
  // stamps so a re-parsed replay and a fallback-computed one render the same.
  const FOOT_SPACING         = 180;        // world units between stamps
  const FOOT_LATERAL         = 20;         // perpendicular offset from centerline
  const PATH_MIN_TIME_GAP    = 5 * 1000;
  const PATH_MIN_GAP_DIST    = 1500;
  const PATH_MAX_TIME_GAP    = 300 * 1000;
  const PATH_MAX_GAP_DIST    = 500;
  const PATH_IDLE_GAP_TIME   = 10 * 1000;

  function footIsGap (a, b) {
    if (!a || !b) return false;
    if (b.isJump) return true;
    const dt = b.gameTime - a.gameTime;
    if (dt > PATH_IDLE_GAP_TIME) return true;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > PATH_MIN_GAP_DIST && dt < PATH_MIN_TIME_GAP) return true;
    if (dist > PATH_MAX_GAP_DIST && dt > PATH_MAX_TIME_GAP) return true;
    return false;
  }

  function generateFootprints (path) {
    if (!path || path.length < 2) return [];

    const out = [];
    let stampIdx = 0;
    let carry = 0;
    let segmentStart = true;

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (!a || !b) continue;
      if (isNaN(a.x) || isNaN(a.y) || isNaN(b.x) || isNaN(b.y)) continue;

      if (segmentStart) { carry = 0; segmentStart = false; }
      if (footIsGap(a, b)) { segmentStart = true; continue; }

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      if (segLen <= 0) continue;

      const dirX = dx / segLen;
      const dirY = dy / segLen;
      const yaw = Math.atan2(dx, -dy);

      let walked = -carry;
      while (walked + FOOT_SPACING <= segLen) {
        walked += FOOT_SPACING;
        const sign = (stampIdx % 2 === 0) ? 1 : -1;
        const perpX = -dirY * FOOT_LATERAL * sign;
        const perpY =  dirX * FOOT_LATERAL * sign;
        const tInEdge = walked / segLen;
        out.push({
          x: a.x + dirX * walked + perpX,
          y: a.y + dirY * walked + perpY,
          yaw: yaw,
          gameTime: a.gameTime + (b.gameTime - a.gameTime) * tInEdge,
          side: sign
        });
        stampIdx++;
      }
      carry = segLen - walked;
    }

    return out;
  }

  // ---- procedural textures (lazy) ----
  let _footTex = null, _ringTex = null;

  function makeCanvas (w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function getFootTex () {
    if (_footTex) return _footTex;
    _footTex = makeCanvas(64, 96, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#fff';
      // sole — larger and rounder
      g.beginPath(); g.ellipse(32, 60, 22, 30, 0, 0, Math.PI * 2); g.fill();
      // arch break — slightly wider so the boot reads as two parts
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.ellipse(32, 42, 16, 6, 0, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'source-over';
      // ball of foot — larger
      g.beginPath(); g.ellipse(32, 22, 18, 16, 0, 0, Math.PI * 2); g.fill();
      // toe nubs — bigger, slightly closer in
      g.beginPath(); g.ellipse(22, 11, 5, 6, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(42, 11, 5, 6, 0, 0, Math.PI * 2); g.fill();
    });
    return _footTex;
  }

  function getRingTex () {
    if (_ringTex) return _ringTex;
    _ringTex = makeCanvas(128, 128, (g, w, h) => {
      const cx = 64, cy = 64;
      // soft annulus: peak at r=48, falling off both ways. Bolder, wider band.
      for (let r = 0; r < 64; r++) {
        const peak = 48;
        const dist = Math.abs(r - peak);
        const a = Math.max(0, 1 - dist / 22);   // wider falloff
        if (a <= 0) continue;
        g.beginPath();
        g.arc(cx, cy, r + 0.5, 0, Math.PI * 2);
        g.strokeStyle = `rgba(255,255,255,${a})`;
        g.lineWidth = 2.4;                       // thicker stroke
        g.stroke();
      }
      // Bright core stripe at the peak radius
      g.beginPath();
      g.arc(cx, cy, 48, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,255,255,1)';
      g.lineWidth = 4;
      g.stroke();
    });
    return _ringTex;
  }

  class PathTrailRenderer3D {
    constructor (threeMapRenderer) {
      this.three = threeMapRenderer;
      this._pool = new Map();
      this._scratchColor = new THREE.Color();
      this._lastTime = performance.now();
      this.group = new THREE.Group();
      this.group.name = 'pathTrails3D';
      this.three.scene.add(this.group);
    }

    update (gameTime, players, viewOptions) {
      if (!this.three || !this.three.ready || !this.three.mapInfo) return;
      if (viewOptions && viewOptions.displayPath === false) {
        this._hideAll();
        return;
      }

      const style = STYLES.includes(viewOptions && viewOptions.pathTrailStyle)
        ? viewOptions.pathTrailStyle : STYLES[0];

      const now = performance.now();
      const realDt = Math.min(100, now - this._lastTime);
      this._lastTime = now;

      const ext = this.three.mapInfo.bounds.map;
      const cx = (ext[0][0] + ext[0][1]) / 2;
      const cy = (ext[1][0] + ext[1][1]) / 2;

      const seen = new Set();

      for (const player of players) {
        if (!player.heroes) continue;
        for (const hero of player.heroes) {
          if (!hero || !hero.path || !hero.path.length) continue;
          if (gameTime < hero.readyTime) continue;
          if (hero._destroyed) continue;
          this._updateHero(hero, gameTime, now, realDt, cx, cy, style);
          seen.add(hero.uuid);
        }
      }

      for (const [uuid, entry] of this._pool) {
        if (seen.has(uuid)) continue;
        if (gameTime - entry.lastSeen > HERO_TTL_MS) {
          this._disposeEntry(entry);
          this._pool.delete(uuid);
        } else {
          entry.group.visible = false;
        }
      }
    }

    dispose () {
      for (const entry of this._pool.values()) this._disposeEntry(entry);
      this._pool.clear();
      if (this.group && this.group.parent) this.group.parent.remove(this.group);
    }

    clear () {
      for (const entry of this._pool.values()) this._disposeEntry(entry);
      this._pool.clear();
      this._lastTime = performance.now();
    }

    // ---- entry lifecycle --------------------------------------------------

    _styleNeedsFoot (style) { return style === 'combo' || style === 'footsteps'; }
    _styleNeedsRing (style) { return style === 'combo' || style === 'rings'; }

    _updateHero (hero, gameTime, realNow, realDt, cx, cy, style) {
      let entry = this._pool.get(hero.uuid);
      if (!entry) {
        entry = this._createEntry(hero);
        this._pool.set(hero.uuid, entry);
      }
      if (entry.style !== style) {
        // Selective teardown: only dispose sub-meshes the new style doesn't need.
        if (!this._styleNeedsFoot(style) && entry.footMesh) {
          this._disposeMesh(entry, entry.footMesh);
          entry.footMesh = null;
        }
        if (!this._styleNeedsRing(style) && entry.ringMesh) {
          this._disposeMesh(entry, entry.ringMesh);
          entry.ringMesh = null;
          entry.ringPool = null;
          entry.ringSpawnAccum = 0;
        }
        entry.style = style;
        entry.lastBuildAt = -Infinity;
        entry.lastBuildPathIdx = -1;
      }
      entry.lastSeen = gameTime;
      entry.group.visible = true;

      this._scratchColor.set(hero.playerColor);
      const pr = this._scratchColor.r;
      const pg = this._scratchColor.g;
      const pb = this._scratchColor.b;

      // Hide unused sub-meshes (visibility-only; they were already torn down on style change above)
      if (!this._styleNeedsFoot(style) && entry.footMesh) entry.footMesh.visible = false;
      if (!this._styleNeedsRing(style) && entry.ringMesh) entry.ringMesh.visible = false;

      if (this._styleNeedsRing(style)) {
        this._renderRings(entry, hero, gameTime, realNow, cx, cy, pr, pg, pb);
      }
      if (this._styleNeedsFoot(style)) {
        this._renderFootsteps(entry, hero, gameTime, realNow, cx, cy, pr, pg, pb);
      }
    }

    _createEntry (hero) {
      const group = new THREE.Group();
      group.name = `trail-${hero.uuid}`;
      this.group.add(group);
      return {
        group,
        style: null,
        lastSeen: 0,
        lastBuildAt: -Infinity,
        lastBuildPathIdx: -1,
        ringMesh: null, ringPool: null, ringSpawnAccum: 0,
        footMesh: null
      };
    }

    _disposeMesh (entry, mesh) {
      if (!mesh) return;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
      entry.group.remove(mesh);
    }

    _tearDownStyle (entry) {
      this._disposeMesh(entry, entry.ringMesh); entry.ringMesh = null; entry.ringPool = null; entry.ringSpawnAccum = 0;
      this._disposeMesh(entry, entry.footMesh); entry.footMesh = null;
    }

    _disposeEntry (entry) {
      this._tearDownStyle(entry);
      if (entry.group && entry.group.parent) entry.group.parent.remove(entry.group);
    }

    _hideAll () {
      for (const entry of this._pool.values()) entry.group.visible = false;
    }

    // Walk hero.path, splitting at gaps, returning Array<Array<pathNode>>.
    _buildSegments (hero, gameTime) {
      const path = hero.path;
      const lastIdx = Math.min(hero.recordIndexes.path, path.length - 1);
      if (lastIdx < 1) return [];
      const decay = ClientUnit.PATH_DECAY_TIME;
      const segments = [];
      let current = null;
      for (let i = 0; i <= lastIdx; i++) {
        const node = path[i];
        if (!node) continue;
        if (node.gameTime > gameTime) break;
        if (gameTime - node.gameTime > decay) continue;
        const prev = current && current.length ? current[current.length - 1] : null;
        if (prev && ClientUnit.isPathGap(prev, node)) {
          if (current.length >= 2) segments.push(current);
          current = [node];
        } else {
          if (!current) current = [];
          current.push(node);
        }
      }
      if (current && current.length >= 2) segments.push(current);
      return segments;
    }

    _shouldRebuild (entry, hero, realNow) {
      const idx = hero.recordIndexes.path;
      const overdue = (realNow - entry.lastBuildAt) >= REBUILD_INTERVAL_MS;
      const advanced = idx !== entry.lastBuildPathIdx;
      return overdue || advanced;
    }

    _markRebuilt (entry, hero, realNow) {
      entry.lastBuildAt = realNow;
      entry.lastBuildPathIdx = hero.recordIndexes.path;
    }

    // ---- STYLE: rings -----------------------------------------------------

    _renderRings (entry, hero, gameTime, realNow, cx, cy, pr, pg, pb) {
      this._ensureRingMesh(entry);
      const inst = entry.ringMesh;
      const pool = entry.ringPool;
      const dummy = inst.userData._dummy;

      // Spawn at hero's interpolated position.
      const hp = hero.getInterpolatedPosition ? hero.getInterpolatedPosition(gameTime) : null;
      if (hp && !isNaN(hp.x)) {
        const dtMs = Math.min(100, realNow - (entry._ringLastTime || realNow));
        entry._ringLastTime = realNow;
        entry.ringSpawnAccum = (entry.ringSpawnAccum || 0) + dtMs;
        while (entry.ringSpawnAccum >= RING_SPAWN_DT_MS) {
          entry.ringSpawnAccum -= RING_SPAWN_DT_MS;
          // overwrite oldest slot
          let oldest = 0, oldestAge = -1;
          for (let i = 0; i < RING_MAX; i++) {
            const age = realNow - pool[i].spawnAt;
            if (age > oldestAge) { oldestAge = age; oldest = i; }
          }
          // Cache terrain Y at spawn so per-frame ring updates skip sampleHeight.
          pool[oldest].spawnAt = realNow;
          pool[oldest].wx = hp.x;
          pool[oldest].wy = hp.y;
          pool[oldest].yWorld = this.three.sampleHeight(hp.x, hp.y) + Y_OFFSET;
        }
      } else {
        entry._ringLastTime = realNow;
      }

      // Update per-ring instance matrix + color (no sampleHeight in this loop).
      let live = 0;
      for (let i = 0; i < RING_MAX; i++) {
        const r = pool[i];
        const age = realNow - r.spawnAt;
        if (r.spawnAt < 0 || age > RING_LIFETIME_MS || isNaN(r.wx)) continue;

        const t = age / RING_LIFETIME_MS;        // 0..1
        const radius = RING_INNER_R + (RING_OUTER_R - RING_INNER_R) * t;
        const alpha = RING_HEAD_ALPHA * (1 - t);
        dummy.position.set(r.wx - cx, r.yWorld, -(r.wy - cy));
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(radius * 2, radius * 2, 1);
        dummy.updateMatrix();
        inst.setMatrixAt(live, dummy.matrix);
        inst.instanceColor.setXYZ(live, pr * alpha, pg * alpha, pb * alpha);
        live++;
      }
      inst.count = live;
      inst.instanceMatrix.needsUpdate = true;
      inst.instanceColor.needsUpdate = true;
      inst.visible = live > 0;
    }

    _ensureRingMesh (entry) {
      if (entry.ringMesh) return;
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        map: getRingTex(),
        transparent: true,
        depthTest: false,           // draw on top — rings span heights so terrain
        depthWrite: false,          // would otherwise clip the far side of the ring
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide
      });
      const inst = new THREE.InstancedMesh(geo, mat, RING_MAX);
      inst.count = 0;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const colorBuf = new Float32Array(RING_MAX * 3);
      inst.instanceColor = new THREE.InstancedBufferAttribute(colorBuf, 3);
      inst.instanceColor.setUsage(THREE.DynamicDrawUsage);
      inst.renderOrder = RENDER_ORDER;
      inst.frustumCulled = false;
      inst.userData._dummy = new THREE.Object3D();
      entry.group.add(inst);
      entry.ringMesh = inst;
      entry.ringPool = [];
      for (let i = 0; i < RING_MAX; i++) {
        entry.ringPool.push({ spawnAt: -1, wx: NaN, wy: NaN, yWorld: 0 });
      }
    }

    // ---- STYLE: footsteps -------------------------------------------------

    // Iterate the hero's pre-baked footprints array (from server-side
    // generateFootprints). Stamp positions/yaw/sides are deterministic — only
    // visibility (current gameTime window) and per-stamp alpha (age fade)
    // need recomputing per rebuild.
    _renderFootsteps (entry, hero, gameTime, realNow, cx, cy, pr, pg, pb) {
      if (!this._shouldRebuild(entry, hero, realNow)) return;

      this._ensureFootMesh(entry);
      const inst = entry.footMesh;

      // Footprints are normally pre-baked by lib/footprintGen.js. Stale .wc3v
      // files (parsed before that feature) lack the field — recompute it once
      // from the hero's path and cache it on the hero. Deterministic, so the
      // result is identical to a freshly re-parsed replay.
      let stamps = hero.footprints;
      if (!stamps) {
        stamps = hero.footprints = generateFootprints(hero.path);
      }
      if (!stamps.length) {
        inst.count = 0;
        inst.visible = false;
        this._markRebuilt(entry, hero, realNow);
        return;
      }

      const dummy = inst.userData._dummy;
      const eulerScratch = inst.userData._euler;
      const decay = ClientUnit.PATH_DECAY_TIME;

      // Advance the start cursor monotonically as gameTime moves forward;
      // reset if we scrubbed backwards.
      let startIdx = entry._footStartIdx || 0;
      if (startIdx >= stamps.length) startIdx = stamps.length - 1;
      if (startIdx > 0 && stamps[startIdx].gameTime > gameTime) startIdx = 0;
      while (startIdx < stamps.length && (gameTime - stamps[startIdx].gameTime) > decay) {
        startIdx++;
      }
      entry._footStartIdx = startIdx;

      let live = 0;
      for (let i = startIdx; i < stamps.length; i++) {
        const s = stamps[i];
        if (s.gameTime > gameTime) break;
        const age = gameTime - s.gameTime;
        if (age > decay) continue;
        if (live >= FOOT_MAX) break;

        // Cache terrain Y once per stamp (deterministic, persisted on object).
        if (s._yWorld === undefined) {
          s._yWorld = this.three.sampleHeight(s.x, s.y) + FOOT_Y;
        }

        dummy.position.set(s.x - cx, s._yWorld, -(s.y - cy));
        eulerScratch.set(-Math.PI / 2, s.yaw, 0, 'YXZ');
        dummy.quaternion.setFromEuler(eulerScratch);
        dummy.scale.set(FOOT_W, FOOT_L, 1);
        dummy.updateMatrix();
        inst.setMatrixAt(live, dummy.matrix);

        const ageA = 1 - age / decay;
        const a = FOOT_HEAD_ALPHA * ageA;
        inst.instanceColor.setXYZ(live, pr * a, pg * a, pb * a);
        live++;
      }

      inst.count = live;
      inst.instanceMatrix.needsUpdate = true;
      inst.instanceColor.needsUpdate = true;
      inst.visible = live > 0;

      this._markRebuilt(entry, hero, realNow);
    }

    _ensureFootMesh (entry) {
      if (entry.footMesh) return;
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        map: getFootTex(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.DoubleSide
      });
      const inst = new THREE.InstancedMesh(geo, mat, FOOT_MAX);
      inst.count = 0;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const colorBuf = new Float32Array(FOOT_MAX * 3);
      inst.instanceColor = new THREE.InstancedBufferAttribute(colorBuf, 3);
      inst.instanceColor.setUsage(THREE.DynamicDrawUsage);
      inst.renderOrder = RENDER_ORDER;
      inst.frustumCulled = false;
      inst.userData._dummy = new THREE.Object3D();
      inst.userData._euler = new THREE.Euler();
      entry.group.add(inst);
      entry.footMesh = inst;
    }

  }

  PathTrailRenderer3D.STYLES = STYLES;
  window.PathTrailRenderer3D = PathTrailRenderer3D;
})();
