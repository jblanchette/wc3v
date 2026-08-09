/*
  ProjectileRenderer3D — draws what ProjectileModel says is in the air.

  This file decides NOTHING. Every position, orientation and lifetime comes from
  client/js/ProjectileModel.js, which is a pure function of gameTime; this is the
  Three.js half only. Same split as UnitBehavior / UnitModelRenderer, and for the
  same reason: the model is verifiable headless (tools/projectile-check.js) and
  the renderer can't quietly invent a shot.

  PERFORMANCE — the reason this is built the way it is
  ----------------------------------------------------
  The viewer's frame cost is CPU scene-graph work, not draw calls and not fill.
  Profiling put renderer.render() at ~43ms, dominated by updateMatrixWorld plus
  skeleton.update() across ~10k scene objects; the static-pose LOD work exists
  specifically to cut that. So a projectile must NOT be a scene object. Adding
  one Object3D per arrow would land straight on the bottleneck.

  Instead: exactly TWO InstancedMeshes, allocated once at construction and never
  resized. Each frame we write matrices and colours into them and set `.count`.
  Two extra draw calls, a few hundred scalar ops, no allocation, no scene-graph
  churn. Same fixed-pool pattern as PathTrailRenderer3D.

  ART DIRECTION
  -------------
  WC3 oldschool: earthy, muted, carved. A real Warcraft arrow is a small dark
  object, not a glowing tracer, so these are small, low-saturation and dim. The
  palette is per attack type but every entry sits in the same narrow value range,
  and the additive peak is held well below 1 so nothing ever blows out into neon.
*/
(function () {
  if (!window.THREE) return;

  // Bump on every re-run of tools/build-missile-textures.js + redeploy. R2
  // serves assets/models immutable for a year, so the versioned URL IS the
  // cache-purge mechanism — same rule as MODEL_ASSET_VERSION in UnitModelRenderer.
  const MISSILE_ASSET_VERSION = '20260808a';
  const MISSILE_POOL = 32;       // instances per missile type; peak measured was 4

  // ---- geometry / lifetime ------------------------------------------------
  const RENDER_ORDER   = 4;      // above unit rings (3), below camp badges (6)
  const BOLT_WIDTH     = 17;     // world units across the streak
  const PUFF_MIN       = 30;     // impact puff starting diameter
  const PUFF_GROW      = 2.2;    // ...multiplied by this over its life
  const MUZZLE_SIZE    = 24;

  // ---- screen-space floor --------------------------------------------------
  //
  // Every size above is in WORLD units, which was tuned with the camera close
  // to the action. The gameplay camera is nowhere near that close: at the
  // map-fit distance one pixel is ~15 world units, so a 54-unit bolt is three
  // pixels long and a pixel wide. Measured with tools/fx-bench.js --zoom: the
  // bolt still rasterized, at 15 changed pixels, which is indistinguishable
  // from nothing while it moves.
  //
  // So a projectile has a minimum SCREEN size and grows in world units to hold
  // it. Capped, because an uncapped floor turns a fully zoomed-out arrow into a
  // barn door — the cap trades "always exactly readable" for "never absurd",
  // which is the right way round for something this small.
  const MIN_BOLT_PX    = 13;     // on-screen length floor
  const MIN_PUFF_PX    = 9;      // on-screen diameter floor
  const MAX_GROWTH     = 3.5;    // never inflate past this multiple of authored size

  // Peak additive brightness. Tuned against the brightest terrain in the game
  // (Ashenvale/Turtle Rock grass) — at 0.62 a bolt was invisible over green,
  // which is a worse failure than being a touch bright over dirt. The restraint
  // that keeps this out of neon territory lives in the muted TINT values below,
  // not in crushing the alpha.
  const BOLT_ALPHA     = 0.95;
  const PUFF_ALPHA     = 0.62;
  const MUZZLE_ALPHA   = 0.70;

  // Muted, low-saturation, all in one value band.
  const TINT = {
    normal: [0.78, 0.76, 0.71],   // pale steel
    pierce: [0.81, 0.75, 0.60],   // bone / fletching tan
    siege:  [0.72, 0.48, 0.29],   // soot and ember
    magic:  [0.56, 0.63, 0.78],   // dusty blue
    chaos:  [0.72, 0.42, 0.35],   // dull rust
    hero:   [0.82, 0.73, 0.52],   // warm pale gold
    spells: [0.56, 0.63, 0.78]
  };
  const TINT_FALLBACK = TINT.normal;

  // A bigger weapon gets a slightly fatter streak, not a brighter one.
  function widthFor (maxDamage) {
    const d = maxDamage || 0;
    return BOLT_WIDTH * (d >= 60 ? 1.5 : d >= 30 ? 1.2 : 1.0);
  }

  // ---- procedural textures -------------------------------------------------
  //
  // Generated into a canvas at construction, exactly like UnitModelRenderer's
  // shadowTexture() and _markerTexture(). No asset fetch, no R2 deploy, nothing
  // to cache-bust, and no filename-case trap.

  let _streakTex = null;
  function streakTexture () {
    if (_streakTex) return _streakTex;
    const S = 64, c = document.createElement('canvas');
    c.width = S * 2; c.height = S;
    const ctx = c.getContext('2d');
    // Head at u=1 (the +x end of the quad, which we align with travel).
    const g = ctx.createLinearGradient(0, 0, S * 2, 0);
    g.addColorStop(0.00, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.28)');
    g.addColorStop(0.88, 'rgba(255,255,255,0.95)');
    g.addColorStop(1.00, 'rgba(255,255,255,0.65)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S * 2, S);
    // Soft falloff across the streak so it has no hard edge.
    const v = ctx.createLinearGradient(0, 0, 0, S);
    v.addColorStop(0.0, 'rgba(0,0,0,1)');
    v.addColorStop(0.5, 'rgba(0,0,0,0)');
    v.addColorStop(1.0, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, S * 2, S);
    _streakTex = new THREE.CanvasTexture(c);
    _streakTex.colorSpace = THREE.LinearSRGBColorSpace;
    return _streakTex;
  }

  let _puffTex = null;
  function puffTexture () {
    if (_puffTex) return _puffTex;
    const S = 64, c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.14)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    _puffTex = new THREE.CanvasTexture(c);
    _puffTex.colorSpace = THREE.LinearSRGBColorSpace;
    return _puffTex;
  }

  // ---- scratch (module-level, never allocated per frame) --------------------
  const _f = new THREE.Vector3();   // travel direction
  const _v = new THREE.Vector3();   // toward camera
  const _s = new THREE.Vector3();   // side
  const _n = new THREE.Vector3();   // quad normal
  const _p = new THREE.Vector3();
  const _m = new THREE.Matrix4();
  const _camRight = new THREE.Vector3();
  const _camUp = new THREE.Vector3();
  const _camFwd = new THREE.Vector3();
  const _ax = new THREE.Vector3();   // scaled basis axes — reused so the hot
  const _ay = new THREE.Vector3();   // loop allocates nothing per instance

  class ProjectileRenderer3D {
    /**
     * @param {ThreeMapRenderer} three  owns the scene + camera + terrain sampler
     * @param {Wc3vViewer} viewer       for behaviorWorld and the uuid index
     */
    constructor (three, viewer) {
      this.three = three;
      this.viewer = viewer;
      this.group = new THREE.Group();
      this.group.name = 'projectiles';
      this.three.scene.add(this.group);

      const PM = window.ProjectileModel;
      this.maxBolts = (PM && PM.C.MAX_BOLTS) || 256;
      this.maxPuffs = ((PM && PM.C.MAX_IMPACTS) || 128) + ((PM && PM.C.MAX_MUZZLES) || 128);

      this.boltMesh = this._makeInstanced(streakTexture(), this.maxBolts);
      this.puffMesh = this._makeInstanced(puffTexture(), this.maxPuffs);
      this.group.add(this.boltMesh, this.puffMesh);

      // Per-missile sprites: each unit's REAL projectile art, baked to a 64px
      // PNG by tools/build-missile-textures.js. One InstancedMesh per missile
      // type, created on first sight and never resized. That looks like a lot of
      // meshes, but only a handful of missile types are ever airborne at once
      // (measured peak: 4 bolts total), and an unused InstancedMesh with count 0
      // costs a matrix update and nothing else. The alternative — one atlas plus
      // a custom shader for per-instance UVs — buys one draw call back and costs
      // a shader to maintain.
      this._missileManifest = null;
      this._missileMeshes = new Map();     // name -> InstancedMesh, or false for "no art"
      this._missilePending = new Set();    // name -> texture in flight; draw the streak meanwhile
      this._loadMissileManifest();

      // Recomputed once per frame in update(); see _pixelFloor.
      this._wuPerPxUnit = 0;

      this.collector = PM ? PM.createCollector({
        unitsByUuid: (viewer && viewer.unitsByUuid) || new Map(),
        // The model works in WORLD coordinates and asks us for terrain height,
        // so it stays testable headless with a flat-ground stub.
        groundZ: (wx, wy) => (three.sampleHeight ? three.sampleHeight(wx, wy) : 0)
      }) : null;

      this.lastCounts = { bolts: 0, puffs: 0 };
    }

    _loadMissileManifest () {
      fetch('/assets/models/missiles/missile-textures.json?v=' + MISSILE_ASSET_VERSION)
        .then(r => (r.ok ? r.json() : null))
        .then(j => { this._missileManifest = (j && j.missiles) || {}; })
        // A missing manifest is not an error — every bolt just keeps the generic
        // streak. This is exactly the state before the art was extracted, and it
        // is also what a deploy that forgot `deploy-assets.js --only=models`
        // looks like, so it must degrade silently rather than throw per frame.
        .catch(() => { this._missileManifest = {}; });
    }

    /**
     * The InstancedMesh for one missile type, or null while it loads / if it has
     * no art. Textures are fetched only when a unit actually fires that missile.
     */
    _missileMesh (name) {
      if (!name || !this._missileManifest) return null;
      const have = this._missileMeshes.get(name);
      if (have !== undefined) return have || null;
      // Texture still in flight. Returning null here is the whole point: the
      // caller falls back to the generic streak, so the FIRST volley a unit
      // type ever fires is a streak instead of nothing. Publishing the mesh
      // before its texture decoded drew empty quads for the entire download —
      // one engagement's worth of invisible arrows, every replay, per unit type
      // (tools/fx-bench.js caught this as PARTIAL on every unit's first case).
      if (this._missilePending.has(name)) return null;

      const spec = this._missileManifest[name];
      if (!spec) { this._missileMeshes.set(name, false); return null; }

      this._missilePending.add(name);
      const tex = new THREE.TextureLoader().load(
        '/assets/models/missiles/' + name + '.png?v=' + MISSILE_ASSET_VERSION,
        () => {
          this._missilePending.delete(name);
          const mesh = this._makeInstanced(tex, MISSILE_POOL, spec.blend === 'add');
          mesh.userData.aspect = spec.aspect || 1;
          this.group.add(mesh);
          this._missileMeshes.set(name, mesh);
          if (this.viewer && this.viewer.requestRender) this.viewer.requestRender();
        },
        undefined,
        () => { this._missilePending.delete(name); this._missileMeshes.set(name, false); }
      );
      tex.colorSpace = THREE.SRGBColorSpace;
      // NO MIPMAPS, deliberately. These are 64px sprites with a large
      // transparent margin, drawn 10-40px on screen. Every mip level averages
      // that margin into the alpha channel, so by the time the camera is at
      // gameplay distance the sampled alpha sits below any cutout and the
      // missile is discarded outright — measured: alpha-blended art fell to
      // exactly 0 changed pixels past ~5000 units while additive art survived.
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      return null;
    }

    _makeInstanced (map, count, additive) {
      const geo = new THREE.PlaneGeometry(1, 1);
      // `additive` is undefined for the built-in streak and puff sprites, which
      // are glows and always additive. Real missile art follows the engine's own
      // FilterMode: solid body art (an arrow, a glaive) alpha-blends so it reads
      // as an object, glows (frost bolts, fireballs) add.
      const add = additive === undefined ? true : !!additive;
      const mat = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
        // A hair of cutout to keep the cell's transparent margin from writing
        // anything, and no more. This used to be 0.28, which is fine at point
        // blank and fatal at gameplay distance: minified sampling drops the
        // sprite's average alpha below the cutoff and every fragment is
        // discarded. Correctness does not depend on the cutout (depthWrite is
        // off and the margin is alpha 0), so it stays low enough to never be
        // the thing that erases a missile.
        alphaTest: add ? 0 : 0.02,
        depthWrite: false,
        // depthTest ON, unlike the path-trail rings: a shot passing behind a
        // cliff should be occluded by it, which is what the game does.
        depthTest: true,
        toneMapped: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.renderOrder = RENDER_ORDER;
      // An InstancedMesh derives its bounds from instance 0 onward; with a pool
      // that is mostly unused and positions that jump around the map, letting
      // three cull it whole is a reliable way to make every projectile vanish.
      mesh.frustumCulled = false;
      mesh.count = 0;
      return mesh;
    }

    /** Called once per frame from app.render(), before threeMapRenderer.render(). */
    update (gameTime, players, viewOptions) {
      const cfg = window.WC3V_CONFIG && window.WC3V_CONFIG.perf;
      const on = !!(viewOptions && viewOptions.display3DUnits) &&
                 (!cfg || cfg.projectiles !== false) &&
                 !(viewOptions && viewOptions.displayProjectiles === false);
      if (!on || !this.collector) { this._hide(); return; }

      const behavior = this.viewer && this.viewer.behaviorWorld;
      // Memoized on gameTime — this is the SAME frame UnitModelRenderer draws,
      // so a bolt can never disagree with the unit that fired it. Never resolve
      // a different time here; the memo is a single slot.
      const frame = behavior ? behavior.resolve(gameTime) : null;
      if (!frame) { this._hide(); return; }

      if (this.viewer.unitsByUuid) this.collector.setUnits(this.viewer.unitsByUuid);
      this.collector.collect(gameTime, frame);

      let cx = 0, cy = 0;
      const mi = this.three.mapInfo;
      if (mi && mi.bounds && mi.bounds.map) {
        const e = mi.bounds.map;
        cx = (e[0][0] + e[0][1]) / 2;
        cy = (e[1][0] + e[1][1]) / 2;
      }

      const cam = this.three.camera;
      cam.matrixWorld.extractBasis(_camRight, _camUp, _camFwd);
      this._wuPerPxUnit = this._pixelFloor(cam);

      this._writeBolts(cx, cy, cam);
      this._writePuffs(cx, cy, cam);
    }

    /**
     * World units per screen pixel, per unit of distance from the camera.
     *
     * For a perspective camera the visible world height at distance d is
     * 2d/f where f = projectionMatrix[5] = 1/tan(fovY/2). Divide by the
     * viewport height in pixels and the whole thing collapses to a constant
     * that only needs multiplying by each projectile's distance:
     *
     *   worldUnitsPerPixel(d) = d * (2 / (f * heightPx))
     *
     * Returns 0 if the viewport size is unknowable, which disables the floor
     * rather than guessing — a projectile at its authored size is a much
     * smaller mistake than one scaled by a made-up number.
     */
    _pixelFloor (cam) {
      if (!cam || !cam.isPerspectiveCamera) return 0;
      const r = this.three && this.three.renderer;
      const h = (r && r.domElement && r.domElement.height) || 0;
      if (!h) return 0;
      const f = cam.projectionMatrix.elements[5];
      if (!(f > 0)) return 0;
      return 2 / (f * h);
    }

    /** Growth factor that lifts `worldSize` to at least `minPx` on screen. */
    _floorScale (worldSize, minPx, distance) {
      if (!this._wuPerPxUnit || !(worldSize > 0)) return 1;
      const need = minPx * this._wuPerPxUnit * distance;
      if (need <= worldSize) return 1;
      return Math.min(MAX_GROWTH, need / worldSize);
    }

    _writeBolts (cx, cy, cam) {
      const bolts = this.collector.bolts;

      // Every missile mesh starts empty; only the ones written to this frame end
      // up with a count. Cheap, and it means a missile type that stops firing
      // clears itself with no bookkeeping.
      for (const m of this._missileMeshes.values()) if (m) m.count = 0;
      let n = 0;   // generic-streak instances

      for (let i = 0; i < bolts.length && n < this.maxBolts; i++) {
        const b = bolts[i];

        // Real art for this unit's missile if we have it, else the generic streak.
        const art = this._missileMesh(b.art);
        const mesh = art || this.boltMesh;
        const slot = art ? art.count : n;
        if (slot >= (art ? MISSILE_POOL : this.maxBolts)) continue;

        // World → scene. Scene Z is -worldY (see UnitModelRenderer._place);
        // the model's z is already a world height, so it maps straight to Y.
        _p.set(b.x - cx, b.z, -(b.y - cy));

        // Travel direction in scene space, from the model's yaw + pitch.
        const cyaw = Math.cos(b.yaw), syaw = Math.sin(b.yaw);
        _f.set(cyaw, Math.tan(b.pitch), -syaw).normalize();

        // Streak billboard: the long axis follows travel, and the quad rolls
        // about that axis to face the camera. A fixed world-space orientation
        // would go edge-on and disappear at some camera angles.
        _v.copy(cam.position).sub(_p);
        _s.crossVectors(_f, _v);
        if (_s.lengthSq() < 1e-8) _s.crossVectors(_f, _camUp);   // looking down the barrel
        _s.normalize();
        _n.crossVectors(_s, _f);

        // Real art keeps its authored proportions (a 4:1 arrow stays a 4:1
        // arrow); the generic streak sizes by damage bracket instead.
        let len = b.len;
        let w = art ? b.len / (art.userData.aspect || 1) : widthFor(b.maxDamage);
        // Both axes scale together so the floor never distorts the sprite —
        // a stretched arrow would be a worse artifact than a small one.
        const grow = this._floorScale(len, MIN_BOLT_PX, _v.length());
        if (grow !== 1) { len *= grow; w *= grow; }
        _m.makeBasis(
          _ax.copy(_f).multiplyScalar(len),
          _ay.copy(_s).multiplyScalar(w),
          _n
        );
        _m.setPosition(_p);
        mesh.setMatrixAt(slot, _m);

        if (art) {
          // Its own colours — tinting real art by attack type would just muddy
          // it. Alpha-blended sprites also can't fade per instance, and a solid
          // arrow appearing at full strength is correct anyway.
          mesh.instanceColor.setXYZ(slot, 1, 1, 1);
          art.count = slot + 1;
        } else {
          // Fade the first sliver of flight so a bolt grows out of the muzzle
          // instead of popping into existence at full brightness.
          const a = BOLT_ALPHA * Math.min(1, b.t * 12);
          const t = TINT[b.attackType] || TINT_FALLBACK;
          mesh.instanceColor.setXYZ(slot, t[0] * a, t[1] * a, t[2] * a);
          n++;
        }
      }

      this.boltMesh.count = n;
      this.boltMesh.instanceMatrix.needsUpdate = true;
      this.boltMesh.instanceColor.needsUpdate = true;

      let drawn = n;
      for (const m of this._missileMeshes.values()) {
        if (!m) continue;
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.needsUpdate = true;
        drawn += m.count;
      }
      this.lastCounts.bolts = drawn;
    }

    _writePuffs (cx, cy, cam) {
      const mesh = this.puffMesh;
      const impacts = this.collector.impacts;
      const muzzles = this.collector.muzzles;
      let n = 0;

      // Camera-facing quads, the same basis the camp badges use.
      for (let i = 0; i < impacts.length && n < this.maxPuffs; i++, n++) {
        const p = impacts[i];
        // Grow and fade. Squared falloff so the burst reads as a quick snap
        // rather than a slow dissolve.
        const grow = 1 + (PUFF_GROW - 1) * p.age;
        const size = Math.max(PUFF_MIN, p.radius * 1.6) * grow;
        const a = PUFF_ALPHA * (1 - p.age) * (1 - p.age);
        this._billboard(mesh, n, p.x - cx, p.z, -(p.y - cy), size, p.attackType, a, cam);
      }
      for (let i = 0; i < muzzles.length && n < this.maxPuffs; i++, n++) {
        const p = muzzles[i];
        const a = MUZZLE_ALPHA * (1 - p.age);
        this._billboard(mesh, n, p.x - cx, p.z, -(p.y - cy),
          MUZZLE_SIZE * (1 + 0.5 * p.age), p.attackType, a, cam);
      }

      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      this.lastCounts.puffs = n;
    }

    _billboard (mesh, i, x, y, z, size, attackType, alpha, cam) {
      if (cam) {
        const d = _p.set(x, y, z).distanceTo(cam.position);
        size *= this._floorScale(size, MIN_PUFF_PX, d);
      }
      _m.makeBasis(
        _ax.copy(_camRight).multiplyScalar(size),
        _ay.copy(_camUp).multiplyScalar(size),
        _n.copy(_camFwd)
      );
      _m.setPosition(x, y, z);
      mesh.setMatrixAt(i, _m);
      const t = TINT[attackType] || TINT_FALLBACK;
      const a = Math.max(0, alpha);
      mesh.instanceColor.setXYZ(i, t[0] * a, t[1] * a, t[2] * a);
    }

    _hide () {
      this.boltMesh.count = 0;
      this.puffMesh.count = 0;
      for (const m of this._missileMeshes.values()) if (m) m.count = 0;
      this.lastCounts.bolts = 0;
      this.lastCounts.puffs = 0;
    }

    clear () { this._hide(); }

    dispose () {
      const missiles = [...this._missileMeshes.values()].filter(Boolean);
      this._missileMeshes.clear();
      for (const mesh of [this.boltMesh, this.puffMesh, ...missiles]) {
        if (!mesh) continue;
        this.group.remove(mesh);
        mesh.geometry.dispose();
        if (mesh.material.map) mesh.material.map.dispose();
        mesh.material.dispose();
        mesh.dispose();
      }
      if (this.group.parent) this.group.parent.remove(this.group);
      _streakTex = null;
      _puffTex = null;
    }
  }

  window.ProjectileRenderer3D = ProjectileRenderer3D;
})();
