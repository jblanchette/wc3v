/**
 * UnitModelRenderer — renders animated 3D unit models in the Three.js scene,
 * replacing the 2D circle+icon units (hybrid: units without a 3D model, beyond
 * the perf cap, or still loading keep their 2D icon).
 *
 * Per frame it enumerates live units, instantiates a skinned GLB per unit (via
 * window.GLBLoader's skinned path), places it on terrain at the unit's interpolated
 * position, faces it along its baked turn-rate facing, drives an animation STATE
 * MACHINE (idle / walk / attack / death) over the unit's clip set, and fades it by
 * decay/death. The set of units shown in 3D is published on viewOptions._rendered3D
 * so the 2D path skips them (ClientPlayer.drawResolvedUnits).
 *
 * Animation states:
 *   death  — unit.destroyedAt or lostState 'lost' reached; play the death clip once
 *            (clamped, seek-safe via manual time), hold the corpse, then fade out.
 *   morph  — inside a form-change window (Obsidian Statue ⇄ Destroyer): the GLB's
 *            one-shot morph transition clip, seek-safe via manual time.
 *   walk   — interpolated position is moving.
 *   attack — unit is a participant in an active detected battle and stationary
 *            (inference; no per-unit attack timing exists in replays).
 *   idle   — otherwise.
 *
 * Static-pose LOD (perf.staticPoseLOD): visible units too small on screen to read
 * animation swap to a plain mesh with the idle pose baked into shared geometry,
 * removing their bones from the scene graph — the dominant frame cost culling
 * can't touch. See _lodParams/_setStatic/_bakeStaticPose.
 *
 * Placement rule (see GLBLoader.parseSkinned): move the WRAPPER (bone root) only,
 * never the skinned-mesh node — that would double-transform. The wrapper carries
 * the Z-up->Y-up fix; facing is composed on top of it.
 */
(function () {
  const UP = new THREE.Vector3(0, 1, 0);
  // Z-up (MDX) -> Y-up wrapper rotation baked by the exporter (-90deg about +X).
  const ZUP_TO_YUP = new THREE.Quaternion(-0.70710678, 0, 0, 0.70710678);
  const CATS = ['idle', 'walk', 'attack', 'death'];
  // Bind-pose bounding spheres are tight; an animated pose (a swing, a death
  // sprawl) reaches outside them. Inflating before enabling frustum culling
  // keeps units from popping out at the screen edge.
  const SKINNED_BOUNDS_INFLATE = 2.5;
  // Cache-bust for unit GLBs + manifest. R2 serves assets/models immutable (1y),
  // so when a model's CONTENT changes (materials, geometry) the URL must change or
  // returning viewers keep the stale file. BUMP THIS whenever the roster is
  // re-exported (convert-mdx-to-gltf-skinned.js --all) and redeployed.
  const MODEL_ASSET_VERSION = '20260809a';
  const FADE = 0.22;                 // cross-fade seconds between looping states
  // Only used by the worker harvest-loop "is it parked at its anchor" test.
  // Animation state itself comes from UnitBehavior, which reads path-segment
  // velocity instead of finite-differencing interpolated positions.
  const MOVE_EPS2 = 9;               // (wu over ~100ms)^2 to count as walking
  // Facing slew — the render-side turn-rate limit. Mirrors the engine cap that
  // UnitBehavior and KinematicResim both use (0.2 rad per 30ms WC3 frame), read
  // off UnitBehavior when it's loaded so there is one number, not three.
  const FACING_RATE_FALLBACK = 0.2 / 30;   // rad per ms of GAME time
  // A game-time step larger than this is a seek, not playback: snap the facing
  // instead of slewing, so a scrub lands on the pose the authority computed.
  const FACING_SNAP_MS = 400;
  const CORPSE_FADE_MS = 1400;       // fade after the death clip finishes, then hide
  const HERO_RING = 0xffd24a;        // gold ring for heroes (else player color)
  const ILLUSION_RING = 0x33e1ff;    // cyan ring for Mirror Image illusions
  const ILLUSION_OPACITY = 0.55;     // illusions render ghostly/translucent
  const HIDDEN_OPACITY = 0.4;        // shadowmeld / hidden units render faint
  const CREEP_RING = 0xb8893a;          // muted bronze ring for an untouched neutral camp
  const CREEP_DISTURBED_OPACITY = 0.7;  // an engaged (not-yet-cleared) camp dims slightly
  // (CREEP_MOVE_EPS2 / CREEP_AGGRO_RANGE removed: camp creeps have single-sample
  // paths so they cannot move, and camp aggro is now decided per creep by
  // UnitBehavior rather than by proximity to the camp centroid.)
  const CREEP_MARKER_SIZE = 72;         // world-unit size of the floating "?" uncertainty badge
  const CREEP_MARKER_Y = 170;           // world-unit height of the badge above the camp
  // Camp cull bounds. Generous on purpose — a camp popping in at the screen
  // edge is far worse than carrying a few extra skeletons, and the test is one
  // sphere per camp either way. PAD covers creep spread beyond the bbox plus
  // model height; Y lifts the sphere centre to mid-model.
  const CAMP_CULL_PAD = 700;
  const CAMP_CULL_Y = 250;
  // Same idea for player units, which move — so the sphere is per-unit rather
  // than per-camp. PAD covers the tallest model plus a frame of movement at max
  // speed, so a unit never pops in at the screen edge.
  const UNIT_CULL_PAD = 500;
  const UNIT_CULL_Y = 200;
  const CLAIM_CLEARED = 2;              // NeutralGroup ClaimStates.cleared

  // Worker harvest declutter + ambient gather-loop. Mirrors the 2D worker
  // visibility gate (ClientUnit._isWorkerRelevant) and surfaces ONE representative
  // gold + lumber looper per player doing a synthetic resource↔drop-off trip; the
  // rest of the harvesting workforce stays hidden (uncertain workers always hide).
  const WORKER_BASE_RADIUS = 2000;          // world units from a base anchor (matches ClientUnit)
  const WORKER_COMBAT_VISIBLE_MS = 12 * 1000;
  const LOOP_DWELL_MS = 650;                // pause at each end (mining / dropping off)
  // Facing change (radians, per frame) past which a unit counts as turning and
  // must keep its skeleton rather than drop to a frozen static pose. Small
  // enough to catch a slow pivot, large enough to ignore facing jitter.
  const TURN_EPSILON = 0.01;
  const LOOP_MIN_DIST = 192;                // below this a loop is pointless — render parked
  // Lumber drop-offs beyond the town halls (halls accept both resources for every
  // race). Human Lumber Mill + Undead Graveyard; Orc/NE return lumber to the hall.
  const LUMBER_DROPOFF_IDS = new Set(['hlum', 'ugrv']);

  // Shared flat unit-ring geometry (radius 1, laid on the ground per instance).
  let RING_GEO = null;
  function ringGeo () { if (!RING_GEO) RING_GEO = new THREE.RingGeometry(0.82, 1.0, 32); return RING_GEO; }

  // Shared flat SELECTION-ring geometry. Deliberately a different shape from
  // ringGeo above: a thin bright hoop (6% of radius vs the unit ring's 18%),
  // drawn at a larger radius so the two read as different things even with
  // Settings -> Unit Rings on. 48 segments keeps it smooth at that radius.
  let SEL_RING_GEO = null;
  function selRingGeo () { if (!SEL_RING_GEO) SEL_RING_GEO = new THREE.RingGeometry(0.94, 1.0, 48); return SEL_RING_GEO; }

  // Selection ring sizing / lifetime.
  const SEL_RING_SCALE = 1.28;    // multiples of inst.ringRadius — clear gap outside the unit ring
  const SEL_RING_ALPHA = 0.95;
  // The selection stream is HOLD-UNTIL-NEXT (Helpers.StandardStreamSearch), so
  // without a ceiling the last selection of the match stays ringed forever —
  // through the post-game tail, and through any stretch where a player stops
  // issuing UpdateSubgroup (alt-tab, a game ending on a leave). Measured max gap
  // between real selection records is 4,669 ms, so 12 s is ~2.5x the worst
  // observed and never truncates a legitimately-held selection.
  const SEL_MAX_HOLD_MS = 12000;
  const SEL_FADE_MS = 600;

  // Shared sphere geometry for the no-model placeholder blob.
  let BLOB_GEO = null;
  function blobGeo () { if (!BLOB_GEO) BLOB_GEO = new THREE.SphereGeometry(1, 14, 12); return BLOB_GEO; }

  // Shared soft blob-shadow decal (unit-radius plane + radial-gradient alpha).
  // WC3 grounds every unit with a soft dark shadow offset toward the sun's cast
  // direction (see reference-shots/) — the viewer had none. Cheap: one shared
  // gradient texture on a 1×1 plane, scaled + laid flat per instance.
  let SHADOW_GEO = null;
  function shadowGeo () { if (!SHADOW_GEO) SHADOW_GEO = new THREE.PlaneGeometry(1, 1); return SHADOW_GEO; }
  let SHADOW_TEX = null;
  function shadowTexture () {
    if (SHADOW_TEX) return SHADOW_TEX;
    const s = 64, cv = document.createElement('canvas'); cv.width = cv.height = s;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    SHADOW_TEX = new THREE.CanvasTexture(cv);
    SHADOW_TEX.needsUpdate = true;
    return SHADOW_TEX;
  }
  // Ground-plane offset of the shadow from the unit's feet, toward where the sun
  // casts it (matches WC3_LIGHT_DIR_YUP in GLBLoader: sun upper-left → shadow to
  // +x / +z in scene space). Scaled by unit radius.
  const SHADOW_OFFSET_X = 0.22, SHADOW_OFFSET_Z = 0.22;

  // ── Instanced ring/shadow pools (perf.instancedRings) ──────────────────────
  // Legacy: every unit carried TWO scene Meshes (selection ring + blob shadow),
  // each with its own material — 2 scene-graph objects + 2 draw calls + 2
  // materials per unit, all walked by scene.updateMatrixWorld every frame.
  // Pooled: ONE InstancedMesh per kind for the whole scene. Instances keep
  // lightweight DESCRIPTOR objects with the same field names the legacy meshes
  // had (position / scale / visible / material.color / material.opacity), so
  // every consumer — creep recolour, decay fade, guide highlight — works
  // unchanged; a per-frame flush writes the visible descriptors into the pools.
  //
  // Per-instance alpha needs a custom shader (InstancedMesh gives matrix +
  // color only). Colors are written in the linear working space (THREE.Color
  // already stores linear) and converted on output via colorspace_fragment,
  // matching what MeshBasicMaterial did.
  const POOL_VS = `
    attribute float aAlpha;
    varying vec3 vColor;
    varying float vAlpha;
    varying vec2 vUv;
    void main () {
      vUv = uv;
      vAlpha = aAlpha;
      #ifdef USE_INSTANCING_COLOR
        vColor = instanceColor;
      #else
        vColor = vec3(1.0);
      #endif
      vec4 p = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        p = instanceMatrix * p;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * p;
    }`;
  const RING_FS = `
    varying vec3 vColor;
    varying float vAlpha;
    void main () {
      gl_FragColor = vec4(vColor, vAlpha);
      #include <colorspace_fragment>
    }`;
  const SHADOW_FS = `
    uniform sampler2D uMap;
    varying float vAlpha;
    varying vec2 vUv;
    void main () {
      vec4 t = texture2D(uMap, vUv);
      gl_FragColor = vec4(0.0, 0.0, 0.0, t.a * vAlpha);
      #include <colorspace_fragment>
    }`;

  class RingShadowPool {
    constructor (scene, geometry, material, capacity, renderOrder) {
      // Clone the shared geometry: the aAlpha instanced attribute must not
      // leak onto the legacy per-unit meshes that share ringGeo()/shadowGeo().
      const geo = geometry.clone();
      this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
      this.alpha.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAlpha', this.alpha);
      const mesh = this.mesh = new THREE.InstancedMesh(geo, material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.renderOrder = renderOrder;
      mesh.frustumCulled = false;   // spans the map; units are culled upstream
      mesh.count = 0;
      scene.add(mesh);
      // The pool object itself never moves — keep it out of the matrix walk.
      mesh.updateMatrixWorld(true);
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      this.capacity = capacity;
      this.i = 0;
      this._m = new THREE.Matrix4();
      this._q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      this._s = new THREE.Vector3();
    }
    begin () { this.i = 0; }
    push (pos, scale, color, alphaVal) {
      if (this.i >= this.capacity) return;
      const i = this.i++;
      this._s.set(scale, scale, scale);
      this._m.compose(pos, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      if (color) this.mesh.instanceColor.setXYZ(i, color.r, color.g, color.b);
      this.alpha.setX(i, alphaVal);
    }
    end () {
      this.mesh.count = this.i;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
      this.alpha.needsUpdate = true;
    }
    dispose (scene) {
      scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      if (this.mesh.dispose) this.mesh.dispose();
    }
  }

  class UnitModelRenderer {
    constructor (threeMapRenderer, viewer) {
      this.renderer = threeMapRenderer;
      this.scene = threeMapRenderer.scene;
      this.viewer = viewer;
      this.manifest = null;
      this._abCache = {};
      this._templates = {};          // model name -> Promise<parsed template> (parsed once, cloned per unit)
      this.instances = {};           // unit.uuid -> instance | 'pending' | 'failed'
      this.creepInstances = {};      // creep unit.uuid -> instance | 'pending' | 'failed'
      this.campMarkers = {};         // campUuid -> { sprite, type } floating badge ("?" / crossed-swords)
      this.rendered3DUuids = new Set();
      this.clock = new THREE.Clock();
      this.maxUnits = 400;           // generous cap; instancing shares geometry+textures
      this._loader = new window.GLBLoader();
      this._facingOffset = 0;        // model-forward calibration
      // Instanced ring/shadow pools. Decided at construction (a new renderer
      // is built per replay load) — flipping perf.instancedRings mid-session
      // needs a reload, since existing instances hold the other representation.
      this._poolsEnabled = !(window.WC3V_CONFIG && window.WC3V_CONFIG.perf &&
        window.WC3V_CONFIG.perf.instancedRings === false);
      this._ringPool = null;
      this._shadowPool = null;
      // Selection hoops get their OWN pool rather than borrowing inst.ring:
      // that descriptor already has three writers (the displayUnitRings toggle,
      // _setCreepRing's camp-phase colour, _updateGuideHighlight's snapshot /
      // restore) and a fourth would have to fight the guide glow over who runs
      // last. One extra draw call buys all of that away.
      this._selectionPool = null;
      this._selColors = new Map();   // playerId -> THREE.Color, allocated once each
      this._frameSeq = 0;            // stamped onto every instance _place() touches
      this._loadManifest();
    }

    _ensurePools () {
      if (!this._poolsEnabled || this._ringPool) return;
      const cap = this.maxUnits + 360;   // player units + camp creeps
      this._ringPool = new RingShadowPool(this.scene, ringGeo(), new THREE.ShaderMaterial({
        vertexShader: POOL_VS, fragmentShader: RING_FS,
        transparent: true, depthWrite: false, side: THREE.DoubleSide
      }), cap, 3);
      this._shadowPool = new RingShadowPool(this.scene, shadowGeo(), new THREE.ShaderMaterial({
        vertexShader: POOL_VS, fragmentShader: SHADOW_FS,
        uniforms: { uMap: { value: shadowTexture() } },
        transparent: true, depthWrite: false
      }), cap, 1);
      // renderOrder 4 = above the unit-ring pool (3), so a selected unit that
      // also has its ambient ring on shows the hoop on top. Capacity 96: WC3
      // caps a selection at 12 units and the map caps at 8 seats.
      this._selectionPool = new RingShadowPool(this.scene, selRingGeo(), new THREE.ShaderMaterial({
        vertexShader: POOL_VS, fragmentShader: RING_FS,
        transparent: true, depthWrite: false, side: THREE.DoubleSide
      }), 96, 4);
    }

    // Player-colour THREE.Color, cached forever. The pools take the shared
    // reference and copy out of it, so handing the same object to every push is
    // safe and allocates nothing.
    _selColor (player) {
      let c = this._selColors.get(player.playerId);
      if (!c) {
        c = new THREE.Color(player.playerColor || '#FFFFFF');
        this._selColors.set(player.playerId, c);
      }
      return c;
    }

    // WC3-style selection hoops for every player's CURRENT selection, in that
    // player's colour. Runs after _updateGuideHighlight and before _flushPools.
    //
    // ClientPlayer.currentGroup is already the resolved ClientUnit[] (rebuilt
    // only when the selection stream index actually moves) and is capped at 12
    // by the game, so iterating it directly beats mirroring it into a Set —
    // worst case here is 96 array reads and 96 hash lookups, typically 0-24,
    // and it allocates nothing.
    //
    // Two things this pass deliberately does NOT cover:
    //   - BUILDINGS. update() skips isBuilding, so they have no entry in
    //     this.instances at all. ClientPlayer.renderSelectionMarkers rings them
    //     in 2D off frameData.buildingPositions instead.
    //   - Off-screen units. The frustum-park path continues before _place, so
    //     their ring position is last frame's; the _posFrame stamp below drops
    //     them rather than paint a ghost hoop where they used to be.
    //
    // NOTE ~5-12% of selection references never resolve to an exported unit
    // (measured 87.7-94.6% resolve; rare itemIdHash collisions keep only the
    // last instance). Those units correctly get no hoop. That is the data, not
    // a bug — do not paper over it here.
    _flushSelection (players, gameTime, viewOptions) {
      const pool = this._selectionPool;
      if (!pool) return;
      pool.begin();

      const enabled = !(window.WC3V_CONFIG && window.WC3V_CONFIG.perf &&
        window.WC3V_CONFIG.perf.selectionRings === false) &&
        !(viewOptions && viewOptions.displaySelectionRings === false);

      if (enabled) {
        for (const player of players) {
          if (!player || player.isNeutralPlayer) continue;
          const group = player.currentGroup;
          if (!group || !group.length) continue;

          // Age out a stale hold (see SEL_MAX_HOLD_MS).
          let hold = 1;
          const t = player.currentGroupT;
          if (t != null) {
            const age = gameTime - t;
            if (age > SEL_MAX_HOLD_MS) continue;
            if (age > SEL_MAX_HOLD_MS - SEL_FADE_MS) {
              hold = (SEL_MAX_HOLD_MS - age) / SEL_FADE_MS;
            }
          }

          const color = this._selColor(player);
          for (let i = 0; i < group.length; i++) {
            const unit = group[i];
            if (!unit) continue;
            const inst = this.instances[unit.uuid];
            if (!inst || typeof inst === 'string') continue;      // pending / failed -> 2D fallback
            if (!inst.root || !inst.root.visible) continue;       // dead, swept, or 3D off
            if (inst.state === 'death') continue;                 // corpse mid-fade still has a visible root
            // _place / _placeAt stamp this. Anything that `continue`d before
            // placement this frame (frustum park, pre-readyTime, _destroyed,
            // harvest declutter) still holds LAST frame's ring position — a
            // ghost hoop at the unit's last on-screen spot.
            if (inst._posFrame !== this._frameSeq) continue;
            const ring = inst.ring;
            if (!ring) continue;

            // Fade with the body: a lost/decaying unit shouldn't keep a crisp
            // hoop after it has faded out (same lesson as _setOpacity).
            const decay = inst._lastOpacity != null ? inst._lastOpacity : 1;
            const alpha = SEL_RING_ALPHA * hold * decay;
            if (alpha <= 0.004) continue;

            // Lift 1 unit above the ambient ring (groundY + 2) so the two can
            // never z-fight when both are on. One reused scratch vector.
            const p = this._selPos || (this._selPos = new THREE.Vector3());
            p.set(ring.position.x, ring.position.y + 1, ring.position.z);
            pool.push(p, (inst.ringRadius || 24) * SEL_RING_SCALE, color, alpha);
          }
        }
      }

      pool.end();
    }

    // Write every visible pooled ring/shadow descriptor into the InstancedMesh
    // pools. Runs at the END of update() — after the unit loop, _updateCreeps
    // and _updateGuideHighlight, so it sees their final visible/color/opacity.
    _flushPools () {
      const rp = this._ringPool;
      if (!rp) return;
      const sp = this._shadowPool;
      rp.begin(); sp.begin();
      const scan = (map) => {
        for (const k in map) {
          const inst = map[k];
          if (!inst || typeof inst === 'string') continue;
          const r = inst.ring;
          if (r && r.isPooled && r.visible && r.material.opacity > 0.004) {
            rp.push(r.position, r.scale.x, r.material.color, r.material.opacity);
          }
          const s = inst.shadow;
          if (s && s.isPooled && s.visible && s.material.opacity > 0.004) {
            sp.push(s.position, s.scale.x, null, s.material.opacity);
          }
        }
      };
      scan(this.instances);
      scan(this.creepInstances);
      rp.end(); sp.end();
    }

    // Zero the pools without scanning (3D disabled / early-outs) so stale
    // rings from the last flushed frame can't linger on screen.
    _clearPools () {
      if (!this._ringPool) return;
      this._ringPool.begin(); this._ringPool.end();
      this._shadowPool.begin(); this._shadowPool.end();
      if (this._selectionPool) { this._selectionPool.begin(); this._selectionPool.end(); }
    }

    _loadManifest () {
      this._manifestReady = fetch('/assets/models/units/unit-models.json?v=' + MODEL_ASSET_VERSION)
        .then(r => (r.ok ? r.json() : {}))
        .then(m => { this.manifest = m || {}; })
        .catch(() => { this.manifest = {}; });
    }

    // Prefetch + parse the model templates this replay is known to need
    // (unit itemIds are all known before playback starts). Fire-and-forget
    // and throttled — runs behind the tail of the loading overlay and into
    // early playback, so first appearances stop stuttering on model pop-in.
    // Units keep their 2D-icon fallback while a template is still warming,
    // exactly as with on-demand loading.
    warm (itemIds) {
      const start = () => {
        const models = new Set();
        for (const raw of itemIds || []) {
          const id = String(raw || '');
          const spec = this.manifest[id.toLowerCase()] || this.manifest[id];
          if (spec && spec.model && !this._templates[spec.model]) models.add(spec.model);
        }
        const queue = [...models];
        let idx = 0;
        const next = () => {
          if (idx >= queue.length) return;
          const model = queue[idx++];
          // _getTemplate memoizes into _templates and never rejects.
          this._getTemplate(model).then(() => next());
        };
        const CONCURRENCY = 4;
        for (let i = 0; i < CONCURRENCY && i < queue.length; i++) next();
      };
      if (this.manifest) start();
      else if (this._manifestReady) this._manifestReady.then(start);
    }

    _fetchAB (model) {
      if (!this._abCache[model]) {
        this._abCache[model] = fetch('/assets/models/units/' + model + '.glb?v=' + MODEL_ASSET_VERSION)
          .then(r => { if (!r.ok) throw new Error('glb ' + r.status); return r.arrayBuffer(); });
      }
      return this._abCache[model];
    }


    // Render-time collision separation for 3D units. WC3 never lets two units
    // occupy the same space; the server enforces that at recorded path samples,
    // but between samples (~400 ms) two units interpolating across each other can
    // visually overlap. This nudges overlapping ground units apart along their
    // centre line — a pure function of gameTime (scrub-safe). Air units (fly /
    // hover / float) live on a separate collision layer and are left alone, as are
    // buildings, corpses, un-spawned units, and camp creeps. Returns a map
    // uuid → {x,y} of adjusted positions (only for units that actually moved).
    _separateUnits (players, gameTime) {
      const out = {};
      // Pooled scratch arrays — this runs every frame over every ground unit;
      // six fresh arrays per frame was steady GC pressure for nothing.
      let s = this._sepScratch;
      if (!s) s = this._sepScratch = { ex: [], ey: [], er: [], eu: [], ox: [], oy: [] };
      const ex = s.ex, ey = s.ey, er = s.er, eu = s.eu, ox = s.ox, oy = s.oy;
      ex.length = 0; ey.length = 0; er.length = 0; eu.length = 0; ox.length = 0; oy.length = 0;
      for (const player of players) {
        for (const unit of (player.units || [])) {
          if (unit.isBuilding || unit.neutralGroupId != null) continue;
          const mt = unit.meta && unit.meta.moveType;
          if (mt === 'fly' || mt === 'hover' || mt === 'float') continue; // air layer
          const r = unit.collisionSize || 0;
          if (r <= 0) continue;
          const ready = unit.readyTime != null ? unit.readyTime : unit.spawnTime;
          if (ready != null && gameTime < ready) continue;
          const d = this._deathStart(unit);
          if (d != null && gameTime >= d) continue; // dead / corpse — don't shove
          const p = unit.getInterpolatedPosition(gameTime);
          if (!p) continue;
          eu.push(unit.uuid); ex.push(p.x); ey.push(p.y); er.push(r); ox.push(p.x); oy.push(p.y);
        }
      }
      const n = eu.length;
      if (n < 2) return out;

      // Spatial hash so we only test nearby pairs (armies can be 60+ units).
      //
      // Built ONCE, with integer keys, and the Map is reused across frames.
      // It used to be rebuilt on each of the 4 relaxation iterations using
      // template-literal keys — 4 Map allocations plus 4N string allocations
      // every frame. Building once is sound here: a relaxation push is a few
      // world units, while the 3x3 cell scan already reaches 128 units past the
      // unit's own cell, so a unit nudged over a boundary is still tested
      // against everything that could possibly overlap it.
      const CELL = 128;
      // Integer key. Cell coords are small (map is ~16k units => ~128 cells),
      // so a 16-bit-shifted pack is collision-free and stays a Smi.
      const key = (gx, gy) => (gx + 32768) * 65536 + (gy + 32768);
      if (!this._sepGrid) this._sepGrid = new Map();
      const grid = this._sepGrid;
      grid.clear();
      for (let i = 0; i < n; i++) {
        const k = key(Math.floor(ex[i] / CELL), Math.floor(ey[i] / CELL));
        let b = grid.get(k); if (!b) grid.set(k, b = []); b.push(i);
      }
      const ITER = 4;
      for (let it = 0; it < ITER; it++) {
        for (let i = 0; i < n; i++) {
          const gx = Math.floor(ex[i] / CELL), gy = Math.floor(ey[i] / CELL);
          for (let ay = gy - 1; ay <= gy + 1; ay++) {
            for (let ax = gx - 1; ax <= gx + 1; ax++) {
              const b = grid.get(key(ax, ay)); if (!b) continue;
              for (const j of b) {
                if (j <= i) continue;
                let dx = ex[j] - ex[i], dy = ey[j] - ey[i];
                const min = er[i] + er[j];
                let d2 = dx * dx + dy * dy;
                if (d2 >= min * min) continue;
                let dist = Math.sqrt(d2);
                if (dist < 1e-4) { dx = (i % 2 ? 1 : -1); dy = 0; dist = 1; } // coincident → arbitrary axis
                const push = (min - dist) * 0.5, nx = dx / dist, ny = dy / dist;
                ex[i] -= nx * push; ey[i] -= ny * push;
                ex[j] += nx * push; ey[j] += ny * push;
              }
            }
          }
        }
      }
      for (let i = 0; i < n; i++) {
        if (ex[i] !== ox[i] || ey[i] !== oy[i]) out[eu[i]] = { x: ex[i], y: ey[i] };
      }
      return out;
    }

    _deathStart (unit) {
      if (unit.destroyedAt != null) return unit.destroyedAt;
      if (unit.lostState && unit.lostState.state === 'lost') return unit.lostState.since;
      return null;
    }

    // Called once per frame from app.render().
    update (gameTime, players, viewOptions) {
      const dt = this.clock.getDelta();
      // Stamped by _place/_placeAt. _flushSelection uses it to tell "placed
      // this frame" from "holding a stale position" — see the note there.
      this._frameSeq = (this._frameSeq | 0) + 1;
      this._beginFacingFrame(gameTime);
      this.rendered3DUuids.clear();
      if (viewOptions) viewOptions._rendered3D = this.rendered3DUuids;

      const on = viewOptions && viewOptions.display3DUnits;
      // Stash for _updateCreeps (it doesn't receive viewOptions) — drop the
      // per-creep ground rings during the guide creep tour. Per-frame, scrub-safe.
      this._suppressCreepRings = !!(viewOptions && viewOptions.suppressCreepRings);
      // Team-color ground rings under player units are opt-in (Settings → Unit
      // Rings). Creep camp rings are camp-state UI and ignore this flag; the
      // guide focus glow also still lights a ring on its highlighted units.
      this._showUnitRings = !!(viewOptions && viewOptions.displayUnitRings);
      if (!on || !this.manifest) {
        // Undo any active guide glow so it can't stick when 3D models are
        // re-enabled (the unit then renders as a 2D icon meanwhile). Keep
        // this._hlUuids intact so the glow re-applies on the next 3D frame.
        if (this._hlUuids) {
          for (const id of this._hlUuids) this._restoreHighlight(this.instances[id] || this.creepInstances[id]);
        }
        for (const k in this.instances) { const inst = this.instances[k]; if (inst && inst.root) { inst.root.visible = false; if (inst.ring) inst.ring.visible = false; if (inst.shadow) inst.shadow.visible = false; } }
        for (const k in this.creepInstances) { const inst = this.creepInstances[k]; if (inst && inst.root) { inst.root.visible = false; if (inst.ring) inst.ring.visible = false; if (inst.shadow) inst.shadow.visible = false; } }
        for (const k in this.campMarkers) { const m = this.campMarkers[k]; if (m && m.sprite) m.sprite.visible = false; }
        // The pools would otherwise keep drawing the last flushed frame.
        this._clearPools();
        return;
      }
      this._ensurePools();
      this._bakeBudget = 1;   // one first-time static-pose bake per frame (see _bakedGeosFor)

      let cx = 0, cy = 0;
      const mi = this.renderer.mapInfo;
      if (mi && mi.bounds && mi.bounds.map) { const e = mi.bounds.map; cx = (e[0][0] + e[0][1]) / 2; cy = (e[1][0] + e[1][1]) / 2; }

      // Every animation decision for this frame, from the single authority.
      // Memoized on gameTime, so the split-screen path's second call is free.
      // Read the world off the viewer rather than caching it here: this renderer
      // is constructed in the async terrain chain, long after buildBehaviorWorld()
      // runs, so anything pushed at construction time would arrive as undefined
      // and silently drop every unit to idle.
      const behavior = this.viewer && this.viewer.behaviorWorld;
      const bframe = behavior ? behavior.resolve(gameTime) : null;
      // `inBattle` is still needed by the WORKER declutter rules (a worker near
      // a fight stays visible); it is no longer what decides an attack.
      const battleSet = bframe ? bframe.inBattle : new Set();
      const sepMap = this._separateUnits(players, gameTime); // no two ground units share space
      const alive = this._aliveScratch || (this._aliveScratch = new Set());
      alive.clear();
      // Built once per frame and shared with _updateCreeps below.
      const frustum = this._cullFrustum();
      const lod = this._lodParams();   // static-pose distance thresholds (null = LOD off)
      const campCreeps = [];   // neutral camp creeps — rendered only by _updateCreeps
      let count = 0;
      for (const player of players) {
        const units = player.units || [];
        const harvestReps = player.isNeutralPlayer ? null : this._harvestRepsFor(player, gameTime);
        for (const unit of units) {
          if (unit.isBuilding) continue;

          // Camp creeps are rendered exclusively by _updateCreeps (engagement-aware
          // attack + the engaged/cleared appearance treatment). Skip them here so
          // they don't double-render as plain idle units.
          if (unit.neutralGroupId != null) { campCreeps.push(unit); continue; }

          const ready = unit.readyTime != null ? unit.readyTime : unit.spawnTime;
          if (ready != null && gameTime < ready) continue;
          if (unit._isLoadedAt && unit._isLoadedAt(gameTime)) continue;

          // Retired: ClientUnit.update sets _destroyed once a unit's lost/stale
          // fade has run all the way to zero, and the 2D path stops drawing it
          // (ClientUnit.preRender bails on the same flag). 3D didn't check it,
          // so it kept the instance "alive": the body faded to alpha 0 via
          // decayLevel while the ring, shadow and nameplate stayed at FULL
          // opacity, and the uuid still landed in rendered3D — suppressing the
          // 2D icon as well. The result on screen was a bare selection circle
          // with no unit inside it. Falling through to the sweep below hides
          // the root, ring and shadow together.
          if (unit._destroyed) continue;

          // Death lifecycle: render through the death clip + corpse fade, then drop.
          const deathStart = this._deathStart(unit);

          // Resolve the form the unit is in AT THIS game time, not its final
          // one — a statue that becomes a Destroyer at 10:00 must render as a
          // statue before then, and flip back when the user scrubs backwards.
          const rawItemId = unit.itemIdAt ? unit.itemIdAt(gameTime) : unit.itemId;
          // toLowerCase allocated a string per unit per frame; the raw id only
          // changes on morphs, so memoize the lowered form on the unit.
          let itemId;
          if (rawItemId === unit._mrLcRaw) {
            itemId = unit._mrLcVal;
          } else {
            itemId = (rawItemId || '').toLowerCase();
            unit._mrLcRaw = rawItemId;
            unit._mrLcVal = itemId;
          }
          const spec = this.manifest[itemId] || this.manifest[rawItemId];
          const hasModel = !!(spec && spec.model);

          const pos = unit.getInterpolatedPosition(gameTime);
          if (!pos) continue;

          let inst = this.instances[unit.uuid];
          if (inst === undefined) {
            if (count >= this.maxUnits) continue;
            // No 3D model in the manifest → a minimal team-coloured blob so
            // nothing renders as a 2D icon. Otherwise instantiate the skinned
            // model. (This used to name water elementals as the example; they
            // have had a model for a while, it was just exporting as 20 of its
            // 314 vertices. See tools/audit-model-geometry.js.)
            if (hasModel) this._create(unit, spec, player);
            else this.instances[unit.uuid] = this._createPlaceholder(unit, player);
            inst = this.instances[unit.uuid];
          }
          count++;
          if (!inst || !inst.root) continue; // pending/failed → 2D meanwhile

          // Off-camera → out of the scene graph, and skip the placement /
          // animation / opacity work below. Same mechanism as the camp cull:
          // three updates every bone's matrix regardless of `visible`, and a
          // late-game army is several thousand bones. Purely a function of the
          // camera this frame, so it re-attaches (correctly posed for gameTime)
          // the instant the shot moves back — seek-safe by construction.
          if (this._offScreen(frustum, pos.x, pos.y, cx, cy)) {
            this._parkCreep(inst, true);
            alive.add(unit.uuid);
            this.rendered3DUuids.add(unit.uuid);
            continue;
          }
          this._parkCreep(inst, false);

          // Keep a morphing unit's form in sync with the timeline. Both forms
          // share one GLB, so this is a visibility + clip-set swap, never a
          // rebuild. No-op for the vast majority of units (spec.form absent).
          if (spec && spec.form && inst.form !== spec.form) {
            this._setForm(inst, spec.form);
            if (spec.scale && inst.scale !== spec.scale) {
              inst.scale = spec.scale;
              if (inst.wrapper) inst.wrapper.scale.setScalar(spec.scale);
            }
            // A statue walks; a Destroyer flies. Follow the form.
            inst.flyHeight = (spec.flyHeight != null)
              ? spec.flyHeight
              : ((unit.meta && unit.meta.moveHeight) || 0);
          }
          // Just after a morph event, play the transition clip (seek-safe)
          // instead of snapping between forms, and ramp flight altitude across
          // it so the Destroyer lifts off rather than teleporting up.
          const morph = (spec && spec.form) ? this._morphWindow(inst, unit, spec, gameTime) : null;
          if (morph) inst.flyHeight = morph.fromFly + (morph.toFly - morph.fromFly) * morph.frac;

          // Drop the unit once the death clip + corpse fade has fully elapsed.
          if (deathStart != null) {
            const total = inst.deathDur * 1000 + CORPSE_FADE_MS;
            if (gameTime >= deathStart + total) { inst.root.visible = false; if (inst.ring) inst.ring.visible = false; if (inst.shadow) inst.shadow.visible = false; continue; }
          }

          // Worker declutter + ambient harvest loop (3D). Skipped while a unit is
          // in its death window (let the death clip play). A 'hidden' worker is
          // NOT added to rendered3D, so the 2D path owns it — and the 2D path also
          // declutters harvesting workers, so it stays hidden in both views.
          let loopAnchors = null;
          const inDeath = deathStart != null && gameTime >= deathStart;
          if (!inDeath && unit._isHarvester && unit._isHarvester(gameTime)) {
            const treat = this._workerTreatment(unit, pos, player, gameTime, battleSet, harvestReps);
            if (treat === 'hidden') {
              inst.root.visible = false;
              if (inst.ring) inst.ring.visible = false;
              if (inst.shadow) inst.shadow.visible = false;
              continue;
            }
            if (treat === 'loop') loopAnchors = this._loopAnchors(inst, unit, pos, gameTime, player);
          }

          // Static-pose LOD: a unit too far away to read animation swaps to a
          // baked idle-pose plain mesh, taking its bones out of the scene graph
          // entirely (culling can't help here — these units are ON screen, and
          // three walks every bone + updates every visible skeleton per frame).
          // Death and morph windows force the animated path: the corpse pose
          // and the transition are the two things a frozen pose would get wrong.
          // Movement is ALWAYS animated. The LOD test above is screen-size
          // only, but a frozen unit still gets its position updated every
          // frame — so a small-on-screen walker slid across the ground locked
          // in an idle pose. adaptiveLOD made it worse by raising the
          // threshold under frame-time pressure, which is exactly when a fight
          // has put many units on screen. Freeze only units that are genuinely
          // standing still:
          //   - never a harvest looper: it marches its route continuously,
          //   - never a unit whose behaviour state is anything but idle,
          //   - never a unit that is turning; a rotating model with a locked
          //     skeleton reads as broken just like sliding does.
          // Idle armies and standing workers are the bulk of the units at
          // full-map zoom, so the perf win this LOD was built for survives.
          const d = bframe ? bframe.byUuid.get(unit.uuid) : null;
          const turning = (inst._wf != null && d && d.facing != null)
            ? Math.abs(Math.atan2(Math.sin(d.facing - inst._wf),
                                  Math.cos(d.facing - inst._wf))) > TURN_EPSILON
            : false;
          const stationary = !loopAnchors && !turning && (!d || d.state === 'idle');

          this._setStatic(inst, lod && stationary && !inDeath && !morph && inst._tpl && !inst.isPlaceholder &&
            this._beyondLod(inst, pos, cx, cy, lod));

          if (loopAnchors) {
            this._placeLoop(inst, unit, loopAnchors, gameTime, dt, cx, cy);
          } else {
            // Place at the collision-separated position (units never share space in
            // WC3); drive animation from the RAW path position so being nudged apart
            // doesn't read as walking.
            this._place(inst, unit, sepMap[unit.uuid] || pos, gameTime, cx, cy, d);
            if (inst._staticOn) this._applyLivingOpacity(inst, unit); // frozen pose still fades
            else this._animate(inst, unit, gameTime, dt, deathStart, d, morph);
          }
          inst.root.visible = true;
          if (inst.ring) inst.ring.visible = this._showUnitRings && inst.state !== 'death'; // no ring on corpses; rings opt-in
          if (inst.shadow) inst.shadow.visible = inst.state !== 'death';
          alive.add(unit.uuid);
          this.rendered3DUuids.add(unit.uuid);
        }
      }

      for (const k in this.instances) {
        const inst = this.instances[k];
        if (inst && inst.root && !alive.has(k)) { inst.root.visible = false; if (inst.ring) inst.ring.visible = false; if (inst.shadow) inst.shadow.visible = false; }
      }

      this._updateCreeps(gameTime, cx, cy, dt, campCreeps, bframe, frustum, lod);

      // Guide-mode focus glow (runs last so it wins over per-unit ring state).
      this._updateGuideHighlight();

      // WC3 selection hoops. Its own pool, so it reads final positions without
      // contending with anything above for inst.ring.
      this._flushSelection(players, gameTime, viewOptions);

      // Instanced rings/shadows: write the frame's visible descriptors into
      // the pools. Must be the LAST step — it consumes the final
      // visible/color/opacity state everything above just decided.
      this._flushPools();
    }

    // Neutral creeps. Rendered from the neutral player's own ClientUnits (stable
    // uuid + their spawn/guard position), so it works whether or not the camp
    // export carries baked coords, and never double-renders with the main unit
    // loop. Two things the replay genuinely knows drive the look:
    //   • live attacker presence — a hero/combat unit standing in the camp makes
    //     it fight; the attack animation stops the instant the army walks away.
    //   • the camp's lifecycle (firstInteractionTime / clearedTime) — once a camp
    //     has been engaged its creeps are shown "disturbed", and once it's been
    //     credited/cleared they fade to a faint "ghost" with a floating "?".
    // We deliberately DON'T play creep deaths/corpses: the replay can't know which
    // creep died when, so faking it would mislead. The "?" badge says exactly that.
    _updateCreeps (gameTime, cx, cy, dt, campCreeps, bframe, frustum, lod) {
      const ng = this.viewer && this.viewer.mapData && this.viewer.mapData.world && this.viewer.mapData.world.neutralGroups;
      if (!ng || !this.manifest || !campCreeps || !campCreeps.length) return;

      const campState = {}; // per-camp (computed once/frame): geometry, presence, phase
      const sphere = this._campSphere || (this._campSphere = new THREE.Sphere());

      for (const unit of campCreeps) {
        const campId = unit.neutralGroupId;
        const camp = ng[campId];
        if (!camp) continue;

        let cs = campState[campId];
        if (!cs) {
          const geom = this._campGeom(camp);

          // lifecycle phase — see _campPhase (pristine → disturbed → cleared).
          const phase = this._campPhase(camp, gameTime);

          // Whether the camp is FIGHTING is now derived from whether any of its
          // creeps actually resolved a target, rather than from "some player
          // unit is within 500 units of the camp centroid" — which made the
          // whole camp swing in unison, including creeps far out of their own
          // range, for as long as the camp stayed disturbed (measured at 10.7
          // minutes; 10 of 101 camps never clear at all).
          const engaged = !!(bframe && bframe.campsEngaged.has(campId));

          // Camp-level cull. Creeps are static guards standing in camps the
          // camera is usually nowhere near, and they dominate the scene graph
          // (~80 bones each, ~2/3 of all bones on a creep-heavy map). Testing
          // ONE sphere per camp — not per creep — parks the whole group.
          //
          // An engaged camp is never parked: a fight there is exactly what the
          // viewer might cut to, and it must be posed correctly when it does.
          const gy = this.renderer.sampleHeight ? this.renderer.sampleHeight(geom.cx, geom.cy) : 0;
          sphere.center.set(geom.cx - cx, gy + CAMP_CULL_Y, -(geom.cy - cy));
          sphere.radius = geom.radius + CAMP_CULL_PAD;
          const onScreen = !frustum || frustum.intersectsSphere(sphere);
          const dormant = !engaged && !onScreen;

          cs = campState[campId] = { geom, phase, engaged, dormant };

          // One floating badge per camp (not per creep):
          //   • engaged (crossed swords) while an army is actively fighting here,
          //   • "?" (amber) for a disturbed-but-quiet camp of unknown state,
          //   • "?" (slate) for an inferred clear — but NOT a settlement-confirmed
          //     clear, where the building itself is the marker and nothing is unsure.
          let markerType = null;
          if (phase === 'cleared') markerType = camp.settledClear ? null : 'cleared';
          else if (phase === 'disturbed') markerType = engaged ? 'engaged' : 'disturbed';
          this._setCampMarker(campId, markerType, geom, cx, cy, gameTime);
        }

        const key = unit.uuid;
        let inst = this.creepInstances[key];
        if (inst === undefined) { this._createCreep(key, unit, cs.geom); inst = this.creepInstances[key]; }
        if (!inst || !inst.root) continue;
        this.rendered3DUuids.add(key); // we own this creep in 3D — suppress its 2D icon (cleared too)

        // Off-screen and not fighting → out of the scene graph entirely, and
        // skip every per-creep update below. Re-attached the moment the camera
        // comes back, re-posed from gameTime on that frame (nothing here is
        // stateful across frames), so scrubbing and seeking stay correct.
        // Cleared camp → the creeps are dead. Park them: they will never render
        // again at this game time, and by late game most camps are cleared, so
        // leaving their skeletons in the graph is pure waste. (Scrubbing back
        // before the clear un-parks them on the next frame.)
        if (cs.phase === 'cleared') {
          this._parkCreep(inst, true);
          inst.root.visible = false;
          if (inst.ring) inst.ring.visible = false;
          continue;
        }

        // Off-screen and not fighting → out of the scene graph entirely, and
        // skip every per-creep update below. Re-attached the moment the camera
        // comes back, re-posed from gameTime on that frame (nothing here is
        // stateful across frames), so scrubbing and seeking stay correct.
        if (cs.dormant) { this._parkCreep(inst, true); continue; }
        this._parkCreep(inst, false);

        // Per-creep decision. Each creep resolves its OWN target at its OWN
        // range, so a Murloc at the back of a camp with a footman at the front
        // simply has no target and stands there — which is the requirement.
        //
        // Creeps can also WALK: lib/CreepGuardSim reconstructs guard aggro,
        // chase and leash-back into their path, and UnitBehavior resolves that
        // motion to 'walk' like any other unit's. A creep that was never pulled
        // still has a single-sample path and simply never reaches that state.
        const d = bframe ? bframe.byUuid.get(unit.uuid) : null;
        const pos = (d && d.x != null) ? { x: d.x, y: d.y }
          : (unit.spawnPosition ? { x: unit.spawnPosition.x, y: unit.spawnPosition.y }
            : { x: cs.geom.cx, y: cs.geom.cy });

        let state = 'idle';
        if (d && d.state === 'attack' && inst.actions.attack) state = 'attack';
        else if (d && d.state === 'walk' && inst.actions.walk) state = 'walk';
        // Facing: at its target while fighting, at a nearby threat while merely
        // watching one, else outward from the camp centre ("guard" pose).
        const facing = (d && d.facing != null) ? d.facing : (inst.facing0 || 0);

        const opacity = (cs.phase === 'disturbed') ? CREEP_DISTURBED_OPACITY : 1;
        // Distant guards freeze in their baked idle pose (camp bones dominate
        // the scene graph on creep-heavy maps); a fighting or WALKING creep
        // stays animated. Freezing a walker is the bug that made small
        // on-screen units slide along in an idle pose.
        this._setStatic(inst, lod && state === 'idle' && inst._tpl &&
          this._beyondLod(inst, pos, cx, cy, lod));
        this._placeCreep(inst, pos.x, pos.y, facing, cx, cy);
        this._setCreepRing(inst, CREEP_RING);
        if (!inst._staticOn) this._animateCreepState(inst, dt, state, unit, gameTime, d);
        this._setOpacity(inst, opacity);
        inst.root.visible = true;
        if (inst.ring) inst.ring.visible = !this._suppressCreepRings;  // hidden during the guide creep tour
      }
    }

    // Camp lifecycle phase at a given time: 'pristine' (untouched) →
    // 'disturbed' (engaged, creeps still up) → 'cleared' (creeps dead). A
    // settlement-confirmed (or otherwise CLEARED) claim is authoritative even
    // when the exact clear time wasn't measured — fall back to the settle/claim
    // time so the creeps actually disappear instead of lingering as ghosts.
    _campPhase (camp, gameTime) {
      const engagedAt = camp.firstInteractionTime;
      if (engagedAt == null || gameTime < engagedAt) return 'pristine';
      let clearedAt = camp.clearedTime;
      if (clearedAt == null && camp.claimState === CLAIM_CLEARED) {
        clearedAt = (camp.settledClear && camp.settledClear.gameTime != null) ? camp.settledClear.gameTime
          : (camp.claimTime != null ? camp.claimTime : engagedAt);
      }
      return (clearedAt != null && gameTime >= clearedAt) ? 'cleared' : 'disturbed';
    }


    // Camp centre + a radius covering its footprint (cached — creeps are static).
    // Camera frustum for camp culling, rebuilt once per frame. Uses the SAME
    // camera that renders the scene, so anything this rejects is provably
    // off-screen — the test can never hide something the viewer would see.
    _cullFrustum () {
      const r = this.renderer;
      if (!r || !r.camera || !THREE.Frustum) return null;
      if (!this._frustum) { this._frustum = new THREE.Frustum(); this._frustumMat = new THREE.Matrix4(); }
      r.camera.updateMatrixWorld();
      this._frustumMat.multiplyMatrices(r.camera.projectionMatrix, r.camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._frustumMat);
      return this._frustum;
    }

    // True when a unit-sized sphere at (wx, wy) is off-camera. `frustum` is the
    // once-per-frame frustum from _cullFrustum; a null frustum means "keep
    // everything", so a missing camera can never blank the scene.
    _offScreen (frustum, wx, wy, cx, cy) {
      if (!frustum) return false;
      const sph = this._cullSphere || (this._cullSphere = new THREE.Sphere());
      const gy = this.renderer.sampleHeight ? this.renderer.sampleHeight(wx, wy) : 0;
      sph.center.set(wx - cx, gy + UNIT_CULL_Y, -(wy - cy));
      sph.radius = UNIT_CULL_PAD;
      return !frustum.intersectsSphere(sph);
    }

    // Park (or restore) an instance's whole subtree.
    //
    // `visible = false` is NOT enough: three walks the entire graph in
    // updateMatrixWorld regardless of visibility, and a unit carries ~80-160
    // bones. Detaching from the scene is what actually removes the per-frame
    // matrix cost, and skipping the caller's per-instance work removes the rest.
    _parkCreep (inst, parked) {
      if (!inst || !inst.root || inst._parked === parked) return;
      inst._parked = parked;
      if (parked) {
        if (inst.root.parent) inst.root.parent.remove(inst.root);
        // Pooled descriptors aren't in the scene — hiding them is enough (the
        // per-frame flush simply skips them); the flow re-shows on unpark.
        if (inst.ring) {
          if (inst.ring.isPooled) inst.ring.visible = false;
          else if (inst.ring.parent) inst.ring.parent.remove(inst.ring);
        }
        if (inst.shadow) {
          if (inst.shadow.isPooled) inst.shadow.visible = false;
          else if (inst.shadow.parent) inst.shadow.parent.remove(inst.shadow);
        }
      } else {
        if (!inst.root.parent) this.scene.add(inst.root);
        if (inst.ring && !inst.ring.isPooled && !inst.ring.parent) this.scene.add(inst.ring);
        if (inst.shadow && !inst.shadow.isPooled && !inst.shadow.parent) this.scene.add(inst.shadow);
      }
    }

    // ── Static-pose LOD ──────────────────────────────────────────────────────
    // The remaining per-frame cost after culling is bones on VISIBLE units:
    // three walks every bone in updateMatrixWorld and runs skeleton.update()
    // for every visible skinned mesh, whether or not its mixer advanced (see
    // the mixer-budget note in clientConfig.js). So a unit too small on screen
    // to read animation is swapped to a plain Mesh with the idle pose baked
    // into shared geometry, and its bone subtree + skinned meshes leave the
    // scene graph. The static meshes share the instance's cloned materials, so
    // team colour, decay fade and blend state carry over untouched.

    // Per-frame LOD thresholds, or null when disabled. "Too small" is a screen
    // height test: a nominal-height unit projecting under perf.staticPoseMinPx
    // pixels goes static; re-animates at 85% of that distance (hysteresis so a
    // unit near the boundary doesn't flap between modes every frame).
    _lodParams () {
      const cfg = window.WC3V_CONFIG && window.WC3V_CONFIG.perf;
      if (!cfg || cfg.staticPoseLOD === false) return null;
      const cam = this.renderer && this.renderer.camera;
      if (!cam || !cam.isPerspectiveCamera) return null;
      // CSS box height, not the drawing-buffer height — the buffer is sized to
      // the map image (oversampled), and pixels-on-screen is what legibility is.
      //
      // Reading clientHeight here every frame forced a synchronous reflow
      // (measured ~0.27ms/frame: per-frame style writes keep layout dirty).
      // The three-canvas shares its CSS box with the main canvas, whose
      // metrics GameScaler.beginFrame caches — use those, and fall back to a
      // 1s-throttled direct read when they're unavailable.
      let px = 0;
      const viewer = this.renderer.viewer;
      const gs = viewer && viewer.gameScaler;
      const m = gs && gs._frameMetrics;
      if (m && m.ok) {
        px = m.cssH;
      } else {
        const now = performance.now();
        if (!this._lodPx || (now - this._lodPxAt) > 1000) {
          const el = this.renderer.canvas;
          this._lodPx = (el && (el.clientHeight || el.height)) || 900;
          this._lodPxAt = now;
        }
        px = this._lodPx;
      }
      // Adaptive governor (mainLoop) scales the threshold under frame-time
      // pressure: boost 1 = configured quality, boost 3 = freeze anything
      // under ~3x the base cutoff. 1 when disabled or on fast hardware.
      // HEROES keep the UNBOOSTED threshold — they're what the camera frames,
      // there are at most a handful of them, and a visibly frozen hero at
      // follow distance is the one degradation that reads as broken.
      const boost = (viewer && viewer._lodBoost) || 1;
      const basePx = cfg.staticPoseMinPx || 24;
      const NOMINAL_HEIGHT = 140;    // wu; a coarse everyman unit, not per-model
      const denom = 2 * Math.tan(cam.fov * Math.PI / 360);
      const dOn = (px * NOMINAL_HEIGHT) / (denom * basePx * boost);
      const dOnHero = (boost === 1) ? dOn : (px * NOMINAL_HEIGHT) / (denom * basePx);
      // Reused scratch — this runs every frame and the object never escapes
      // the frame (consumed by _beyondLod only).
      const out = this._lodScratch ||
        (this._lodScratch = { cam: null, on2: 0, off2: 0, hOn2: 0, hOff2: 0 });
      out.cam = cam;
      out.on2 = dOn * dOn;
      out.off2 = (dOn * 0.85) * (dOn * 0.85);
      out.hOn2 = dOnHero * dOnHero;
      out.hOff2 = (dOnHero * 0.85) * (dOnHero * 0.85);
      return out;
    }

    // True when the unit at world (pos.x, pos.y) is beyond the static-pose
    // distance for its current mode. Vertical term uses the wrapper's
    // last-placed height rather than resampling terrain (this runs before
    // _place); one frame of staleness is nothing at these distances, and 0 on
    // the first frame only errs toward keeping the unit animated-adjacent.
    _beyondLod (inst, pos, cx, cy, lod) {
      const p = lod.cam.position;
      const dx = p.x - (pos.x - cx);
      const dy = p.y - (inst.wrapper ? inst.wrapper.position.y : 0);
      const dz = p.z - (-(pos.y - cy));
      const d2 = dx * dx + dy * dy + dz * dz;
      if (inst.isHero) return d2 > (inst._staticOn ? lod.hOff2 : lod.hOn2);
      return d2 > (inst._staticOn ? lod.off2 : lod.on2);
    }

    // Swap an instance between animated (skeleton in graph) and static (baked
    // pose) modes. Symmetric and cheap: add/remove a handful of children.
    _setStatic (inst, on) {
      on = !!on;
      if (!inst || !inst.root || !inst.wrapper) return;
      const cur = inst._staticOn || false;
      if (on && cur) {
        // Already static — but a two-form unit may have changed form without a
        // morph clip forcing the animated path; re-bake for the new form.
        if (inst._staticForm !== (inst.form || 'base')) this._ensureStaticMeshes(inst);
        return;
      }
      if (on === cur) return;
      if (on && !this._ensureStaticMeshes(inst)) return;  // no bake possible → stay animated
      const w = inst.wrapper;
      if (on) {
        for (const b of inst._boneRoots) w.remove(b);
        const holder = inst._meshHolder;
        if (holder && holder.parent) { inst._meshHolderParent = holder.parent; holder.parent.remove(holder); }
        w.add(inst.staticGroup);
      } else {
        if (inst.staticGroup && inst.staticGroup.parent) inst.staticGroup.parent.remove(inst.staticGroup);
        for (const b of inst._boneRoots) w.add(b);
        if (inst._meshHolder && inst._meshHolderParent && !inst._meshHolder.parent) {
          inst._meshHolderParent.add(inst._meshHolder);
        }
      }
      inst._staticOn = on;
    }

    // Build (or rebuild, on form change) the instance's static mesh set from
    // the template's baked geometry. Geometry is shared across every instance
    // of the model; materials are the instance's own (opacity / team colour).
    _ensureStaticMeshes (inst) {
      const form = inst.form || 'base';
      if (inst.staticGroup && inst._staticForm === form) return true;
      const tpl = inst._tpl;
      if (!tpl || !inst.skinnedMeshes || !inst.skinnedMeshes.length) return false;
      const baked = this._bakedGeosFor(tpl, form);
      if (!baked || baked.length !== inst.skinnedMeshes.length) return false;
      if (!inst._boneRoots) {
        // Snapshot BEFORE the static group is ever added: at this point the
        // wrapper's children are exactly the clone's root joints.
        inst._boneRoots = inst.wrapper.children.slice();
        inst._meshHolder = inst.skinnedMeshes[0].parent || null;
      }
      const wasAttached = !!(inst.staticGroup && inst.staticGroup.parent);
      if (wasAttached) inst.staticGroup.parent.remove(inst.staticGroup);
      const group = new THREE.Group();
      inst.staticMeshes = [];
      for (let i = 0; i < baked.length; i++) {
        const src = inst.skinnedMeshes[i];
        const m = new THREE.Mesh(baked[i], src.material);
        m.userData.wc3Form = src.userData.wc3Form;
        m.visible = src.visible;   // mirror the current form's visibility
        inst.staticMeshes.push(m);
        group.add(m);
      }
      inst.staticGroup = group;
      inst._staticForm = form;
      if (wasAttached) inst.wrapper.add(group);
      return true;
    }

    // Baked static geometry for a template + form, computed once and cached on
    // the template (shared by all instances). null = bake failed → LOD opts out.
    _bakedGeosFor (tpl, form) {
      if (!tpl._bakedGeos) tpl._bakedGeos = {};
      if (tpl._bakedGeos[form] === undefined) {
        // Budget: at most ONE first-time bake per frame. When the adaptive LOD
        // governor ramps, dozens of units cross the threshold on the same
        // frame and every distinct template would bake synchronously in that
        // one frame — measured 140-200ms worst-frame spikes. A deferred unit
        // simply stays animated until its template's turn comes (typically
        // the very next frame), which is invisible; the spike is not.
        // Deferral is NOT cached — null means "bake impossible", undefined
        // means "not yet tried".
        if (this._bakeBudget !== undefined && this._bakeBudget <= 0) return null;
        if (this._bakeBudget !== undefined) this._bakeBudget--;
        try { tpl._bakedGeos[form] = this._bakeStaticPose(tpl, form); }
        catch (e) { tpl._bakedGeos[form] = null; }
      }
      return tpl._bakedGeos[form];
    }

    // CPU-skin the template's idle pose (t=0) into plain BufferGeometries, one
    // per skinned mesh (index-aligned). Baked with the wrapper at IDENTITY, so
    // the result lives in raw Z-up model space — exactly what the bones would
    // produce — and the client's per-frame wrapper transform (position, facing
    // × ZUP_TO_YUP, scale) applies to it unchanged. The template is the clone
    // source for future instances, so everything mutated here is restored.
    _bakeStaticPose (tpl, form) {
      const wrapper = tpl.placementNode;
      const bones = tpl.skeleton.bones, inv = tpl.skeleton.boneInverses;
      if (!bones.length || !tpl.skinnedMeshes || !tpl.skinnedMeshes.length) return null;

      const savedW = wrapper ? {
        p: wrapper.position.clone(), q: wrapper.quaternion.clone(), s: wrapper.scale.clone()
      } : null;
      const savedBones = bones.map(b => ({ p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() }));
      if (wrapper) { wrapper.position.set(0, 0, 0); wrapper.quaternion.set(0, 0, 0, 1); wrapper.scale.set(1, 1, 1); }

      // Pose at idle t=0 (the form's own idle for two-form models); a model
      // with no clips bakes its rest pose, which for MDX is the authored stand.
      let mixer = null;
      const clips = tpl.animations || [];
      const clip = (form === 'alternate' ? clips.find(c => c.name === 'idle_alt') : null) ||
        clips.find(c => c.name === 'idle') || clips[0] || null;
      if (clip) {
        mixer = new THREE.AnimationMixer(tpl.root);
        const a = mixer.clipAction(clip);
        a.play(); a.paused = true; a.time = 0;
        mixer.update(0);
      }
      tpl.root.updateMatrixWorld(true);

      const bm = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, inv[i]));
      const nm = bm.map(m => new THREE.Matrix3().getNormalMatrix(m));

      const out = [];
      const vp = new THREE.Vector3(), vn = new THREE.Vector3();
      const ap = new THREE.Vector3(), an = new THREE.Vector3(), t = new THREE.Vector3();
      for (const sm of tpl.skinnedMeshes) {
        const g = sm.geometry;
        const pos = g.attributes.position, nor = g.attributes.normal;
        const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
        if (!pos || !si || !sw) return null;
        const count = pos.count;
        const oP = new Float32Array(count * 3), oN = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          vp.fromBufferAttribute(pos, i);
          if (nor) vn.fromBufferAttribute(nor, i); else vn.set(0, 0, 1);
          ap.set(0, 0, 0); an.set(0, 0, 0);
          let tw = 0;
          for (let k = 0; k < 4; k++) {
            const w = k === 0 ? sw.getX(i) : k === 1 ? sw.getY(i) : k === 2 ? sw.getZ(i) : sw.getW(i);
            if (!w) continue;
            const j = k === 0 ? si.getX(i) : k === 1 ? si.getY(i) : k === 2 ? si.getZ(i) : si.getW(i);
            if (!bm[j]) continue;
            tw += w;
            t.copy(vp).applyMatrix4(bm[j]).multiplyScalar(w); ap.add(t);
            t.copy(vn).applyMatrix3(nm[j]).multiplyScalar(w); an.add(t);
          }
          if (tw < 1e-6) { ap.copy(vp); an.copy(vn); }  // unweighted vertex → untransformed
          if (an.lengthSq() > 1e-8) an.normalize(); else an.set(0, 0, 1);
          oP[i * 3] = ap.x; oP[i * 3 + 1] = ap.y; oP[i * 3 + 2] = ap.z;
          oN[i * 3] = an.x; oN[i * 3 + 1] = an.y; oN[i * 3 + 2] = an.z;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(oP, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(oN, 3));
        if (g.attributes.uv) geo.setAttribute('uv', g.attributes.uv);   // shared with the template
        if (g.index) geo.setIndex(g.index);
        geo.computeBoundingSphere();
        out.push(geo);
      }

      if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(tpl.root); }
      bones.forEach((b, i) => {
        b.position.copy(savedBones[i].p); b.quaternion.copy(savedBones[i].q); b.scale.copy(savedBones[i].s);
      });
      if (savedW) { wrapper.position.copy(savedW.p); wrapper.quaternion.copy(savedW.q); wrapper.scale.copy(savedW.s); }
      return out;
    }

    _campGeom (camp) {
      if (camp._geom) return camp._geom;
      const b = camp.unitBounds || camp.bounds || { minX: 0, maxX: 0, minY: 0, maxY: 0 };
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      const radius = 0.5 * Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
      camp._geom = { cx, cy, radius };
      return camp._geom;
    }

    _createCreep (key, unit, geom) {
      this.creepInstances[key] = 'pending';
      const itemId = (unit.itemId || '').toLowerCase();
      const spec = this.manifest[itemId] || this.manifest[unit.itemId];
      if (!spec || !spec.model) { this.creepInstances[key] = 'failed'; return; }
      // Idle facing: outward from the camp centre (creeps "guard" their spot).
      const sp = unit.spawnPosition || {};
      const sx = (sp.x != null) ? sp.x : geom.cx;
      const sy = (sp.y != null) ? sp.y : geom.cy;
      let facing0 = Math.atan2(sy - geom.cy, sx - geom.cx);
      if (!isFinite(facing0) || (Math.abs(sx - geom.cx) < 1 && Math.abs(sy - geom.cy) < 1)) facing0 = (key.length % 6) * 1.0;
      const cs = unit.collisionSize || 28;
      this._getTemplate(spec.model).then(tpl => {
        if (this.creepInstances[key] !== 'pending') return;
        if (!tpl) { this.creepInstances[key] = 'failed'; return; }
        const r = this._cloneSkinned(tpl);
        const inst = {
          root: r.root, wrapper: r.placementNode, skinnedMeshes: r.skinnedMeshes || [],
          mixer: null, actions: {}, state: null, deathDur: 1, scale: spec.scale || 1,
          isCreep: true, facing0, ringRadius: cs * 1.35, ringHex: null,
          flyHeight: (spec.flyHeight != null)
            ? spec.flyHeight
            : ((unit.meta && unit.meta.moveHeight) || 0)
        };
        inst._tpl = tpl;   // static-pose LOD bakes its geometry from the template
        this._setupMixer(inst, r.animations, spec.form);
        this._addRing(inst, CREEP_RING, 0.7);
        inst.ringHex = CREEP_RING;
        inst.root.visible = false;
        this.scene.add(inst.root);
        this.creepInstances[key] = inst;
        if (this.viewer && this.viewer.requestRender) this.viewer.requestRender();
      }).catch(() => { this.creepInstances[key] = 'failed'; });
    }

    // Recolour a creep's ground ring (untouched bronze → cleared slate) on change.
    _setCreepRing (inst, hex) {
      if (!inst.ring || inst.ringHex === hex) return;
      inst.ring.material.color.set(hex);
      inst.ringHex = hex;
    }

    // Creep animation: looping state machine only (idle/walk/attack). Creeps never
    // play a death clip — see _updateCreeps for why.
    //
    // Attacking creeps go through the SAME swing clock as player units. A ranged
    // creep fires real projectiles, and those launch on the cooldown grid; if the
    // clip just looped at its natural speed here, the arrow would leave at a
    // different moment than the bow released. It also makes the swing seek-safe,
    // which a dt-driven loop never was.
    _animateCreepState (inst, dt, state, unit, gameTime, d) {
      if (!inst.mixer) return;
      if (inst.state === 'death') inst.state = null;
      if (state === 'attack' && d && inst.actions.attack) {
        this._applyAttack(inst, d, unit, gameTime);
        return;
      }
      this._setLoopState(inst, state);
      // Stride-lock the walk cycle to the creep's ground speed, same as player
      // units, so a chasing troll's feet track the ground instead of skating.
      if (state === 'walk' && inst.actions.walk && d && d.strideScale) {
        inst.actions.walk.setEffectiveTimeScale(d.strideScale);
      }
      inst.mixer.update(dt);
    }

    // A floating billboard badge above a camp centre. One per camp:
    //   'engaged'   — crossed swords, pulsing: an army is fighting here right now.
    //   'disturbed' — amber "?": engaged-but-quiet, exact state unknown.
    //   'cleared'   — slate "?": an inferred clear (suppressed for settled clears).
    _setCampMarker (campId, type, geom, cx, cy, gameTime) {
      let m = this.campMarkers[campId];
      if (!type) { if (m && m.sprite) m.sprite.visible = false; return; }
      if (!m) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this._markerTexture(type), transparent: true, depthTest: false, depthWrite: false
        }));
        sprite.renderOrder = 6;
        this.scene.add(sprite);
        m = this.campMarkers[campId] = { sprite, type };
      } else if (m.type !== type) {
        m.sprite.material.map = this._markerTexture(type);
        m.sprite.material.needsUpdate = true;
        m.type = type;
      }
      // The "engaged" (crossed-swords) badge is bigger and gently pulses so it
      // reads as a live fight; the static "?" badges sit at the base size.
      const size = (type === 'engaged')
        ? CREEP_MARKER_SIZE * (1.18 + 0.12 * Math.sin((gameTime || 0) / 150))
        : CREEP_MARKER_SIZE;
      m.sprite.scale.set(size, size, 1);
      const groundY = this.renderer.sampleHeight ? this.renderer.sampleHeight(geom.cx, geom.cy) : 0;
      m.sprite.position.set(geom.cx - cx, groundY + CREEP_MARKER_Y, -(geom.cy - cy));
      m.sprite.visible = true;
    }

    // Lazily draw + cache the "?" badge texture for each marker type.
    _markerTexture (type) {
      if (!this._markerTex) this._markerTex = {};
      if (this._markerTex[type]) return this._markerTex[type];
      const S = 128;
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const g = c.getContext('2d');

      if (type === 'engaged') {
        // crossed-swords combat badge — signals a live creep fight at this camp
        g.beginPath(); g.arc(S / 2, S / 2, 52, 0, Math.PI * 2);
        g.fillStyle = 'rgba(58,30,16,0.86)'; g.fill();
        g.lineWidth = 7; g.strokeStyle = '#f0883a'; g.stroke();
        g.lineCap = 'round'; g.lineJoin = 'round';
        const sword = (x0, y0, x1, y1) => {
          const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
          const px = -dy / len, py = dx / len;             // unit perpendicular
          const gx = x0 + dx * 0.20, gy = y0 + dy * 0.20;  // crossguard above the hilt
          g.strokeStyle = '#ffe6b0'; g.lineWidth = 10;     // blade
          g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
          g.strokeStyle = '#f0883a'; g.lineWidth = 9;      // crossguard
          g.beginPath(); g.moveTo(gx - px * 14, gy - py * 14); g.lineTo(gx + px * 14, gy + py * 14); g.stroke();
          g.fillStyle = '#f0883a'; g.beginPath(); g.arc(x0, y0, 6, 0, Math.PI * 2); g.fill(); // pommel
        };
        sword(S * 0.30, S * 0.86, S * 0.70, S * 0.20);
        sword(S * 0.70, S * 0.86, S * 0.30, S * 0.20);
        const tex = new THREE.CanvasTexture(c);
        if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
        this._markerTex[type] = tex;
        return tex;
      }

      const cleared = (type === 'cleared');
      g.beginPath(); g.arc(S / 2, S / 2, 50, 0, Math.PI * 2);
      g.fillStyle = cleared ? 'rgba(38,42,50,0.82)' : 'rgba(58,44,16,0.82)';
      g.fill();
      g.lineWidth = 7; g.strokeStyle = cleared ? '#9aa3ad' : '#f4c659'; g.stroke();
      g.font = 'bold 74px sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeText('?', S / 2, S / 2 + 3);
      g.fillStyle = cleared ? '#d7dde4' : '#ffffff'; g.fillText('?', S / 2, S / 2 + 3);
      const tex = new THREE.CanvasTexture(c);
      if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      this._markerTex[type] = tex;
      return tex;
    }

    // Place a creep at a world position + facing.
    _placeCreep (inst, wx, wy, facing, cx, cy) {
      const groundY = this.renderer.sampleHeight ? this.renderer.sampleHeight(wx, wy) : 0;
      const bodyY = groundY + (inst.flyHeight || 0);
      const w = inst.wrapper;
      w.position.set(wx - cx, bodyY, -(wy - cy));
      if (inst.scale !== 1) w.scale.setScalar(inst.scale);
      this._updateCullBounds(inst, w.position.x, bodyY, w.position.z);
      if (inst.ring) {
        inst.ring.position.set(wx - cx, groundY + 2, -(wy - cy));
        inst.ring.scale.set(inst.ringRadius, inst.ringRadius, inst.ringRadius);
      }
      UnitModelRenderer.faceQuaternion(this._slewFacing(inst, facing || 0), this._facingOffset, w.quaternion);
    }

    // Parse each model GLB ONCE into a template (shared); clone per unit so
    // instances share geometry + GPU textures but get an independent skeleton.
    _getTemplate (model) {
      if (!this._templates[model]) {
        this._templates[model] = this._fetchAB(model)
          .then(ab => { const res = this._loader.parse(ab.slice(0)); return (res && res.then) ? res : Promise.resolve(res); })
          .then(r => (r && r.isSkinnedResult) ? r : null)
          .catch(() => null);
      }
      return this._templates[model];
    }

    // Inlined SkeletonUtils.clone (no ESM addon): deep-clone the hierarchy, build a
    // fresh skeleton from the cloned bones (independent animation), per-instance
    // materials (independent opacity), sharing geometry + textures with the template.
    _cloneSkinned (tpl) {
      const root = tpl.root.clone(true);
      const boneByName = {};
      root.traverse(o => { if (o.isBone) boneByName[o.name] = o; });
      const bones = tpl.skeleton.bones.map(b => boneByName[b.name]);
      const boneInverses = tpl.skeleton.boneInverses.map(m => m.clone());
      const skeleton = new THREE.Skeleton(bones, boneInverses);
      const skinnedMeshes = [];
      const cullEnabled = !(window.WC3V_CONFIG && window.WC3V_CONFIG.perf &&
        window.WC3V_CONFIG.perf.frustumCull === false);
      root.traverse(o => {
        if (o.isSkinnedMesh) {
          o.material = o.material.clone();   // shares the texture map, own opacity
          o.bind(skeleton, new THREE.Matrix4());
          // Frustum culling for a SKINNED mesh needs its own bounding sphere,
          // maintained by us — see _updateCullBounds for why the previous
          // geometry-sphere approach silently made units disappear.
          if (cullEnabled && this._isUntransformed(o, root)) {
            o.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this._cullRadius(o.geometry));
            o.frustumCulled = true;
          } else {
            o.boundingSphere = null;
            o.frustumCulled = false;
          }
          skinnedMeshes.push(o);
        }
      });
      let placementNode = null;
      const wname = tpl.placementNode && tpl.placementNode.name;
      root.traverse(o => { if (!placementNode && o.name === wname) placementNode = o; });
      return { isSkinnedResult: true, root, placementNode, skinnedMeshes, animations: tpl.animations, skeleton };
    }

    // True when nothing between a skinned mesh and the instance root carries a
    // transform — the invariant GLBLoader.parseSkinned exports (the mesh node is
    // identity; the unit's placement lives on the SIBLING wrapper). We maintain
    // the cull sphere in scene coordinates and three multiplies it by the mesh's
    // matrixWorld, so any transform here would displace it. Rather than assume
    // every model in the roster honours the invariant, one that doesn't simply
    // opts out of culling — the same behaviour as WC3V_CONFIG.perf.frustumCull.
    _isUntransformed (mesh, root) {
      for (let n = mesh; n && n !== root; n = n.parent) {
        if (n.position.lengthSq() > 1e-8) return false;
        if (n.scale.x !== 1 || n.scale.y !== 1 || n.scale.z !== 1) return false;
        const q = n.quaternion;
        if (Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z) + Math.abs(1 - Math.abs(q.w)) > 1e-6) return false;
      }
      return true;
    }

    // Cull radius for one skinned geometry, measured from the model's PIVOT
    // (the wrapper's position) rather than from the bind-pose sphere centre —
    // the sphere we maintain is always centred on the unit's feet. Folding the
    // centre offset in keeps a tall model (meat wagon, frost wyrm) inside its
    // own sphere. Inflated so an animated pose — a swing, a death sprawl —
    // still falls inside. Cached on the shared template geometry.
    _cullRadius (geometry) {
      if (!geometry) return 256;
      if (geometry.__wc3vCullRadius != null) return geometry.__wc3vCullRadius;
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const bs = geometry.boundingSphere;
      const base = bs ? (bs.radius + bs.center.length()) : 128;
      geometry.__wc3vCullRadius = base * SKINNED_BOUNDS_INFLATE;
      return geometry.__wc3vCullRadius;
    }

    /**
     * Re-centre each skinned mesh's cull sphere on where the unit actually is.
     * Called from every placement path, so the sphere never goes stale.
     *
     * Three's Frustum.intersectsObject PREFERS `object.boundingSphere` when the
     * object defines one — SkinnedMesh does — and only falls back to the
     * geometry sphere when it doesn't. Left null, three computes it ONCE
     * (lazily, on the first frame the unit is drawn) from the live bone
     * matrices, then caches it forever. And because the exporter keeps the
     * skinned-mesh node at identity and puts the unit's transform on the
     * SIBLING wrapper / bone root (see GLBLoader.parseSkinned), that cached
     * sphere is a WORLD-space sphere frozen at wherever the unit first
     * appeared. Every unit that then walked further than its own radius
     * (~55 wu) got culled while plainly on screen: the body vanished but its
     * selection ring, shadow and nameplate kept drawing, and the 2D icon was
     * suppressed too, so the unit was simply gone. Inflating
     * geometry.boundingSphere (what this used to do) never had any effect —
     * three never reads it for a skinned mesh.
     *
     * Scene coords, because the mesh node's matrixWorld is identity.
     */
    _updateCullBounds (inst, sx, sy, sz) {
      const meshes = inst.skinnedMeshes;
      if (!meshes) return;
      // Read the live wrapper scale rather than inst.scale: the exporter may
      // already bake a scale into the wrapper node, and _place only overrides it
      // when inst.scale !== 1. The wrapper scales the bones, hence the model.
      const w = inst.wrapper;
      const scale = w ? Math.max(w.scale.x, w.scale.y, w.scale.z) : (inst.scale || 1);
      for (let i = 0; i < meshes.length; i++) {
        const bs = meshes[i].boundingSphere;
        if (!bs) continue;   // placeholder blob, or culling disabled
        bs.center.set(sx, sy, sz);
        bs.radius = this._cullRadius(meshes[i].geometry) * scale;
      }
    }

    _create (unit, spec, player) {
      const uuid = unit.uuid;
      this.instances[uuid] = 'pending';
      this._getTemplate(spec.model).then(tpl => {
        if (this.instances[uuid] !== 'pending') return; // seeked/removed while loading
        if (!tpl) { this.instances[uuid] = 'failed'; return; }
        const inst = this._buildInstance(this._cloneSkinned(tpl), unit, spec, player);
        inst._tpl = tpl;   // static-pose LOD bakes its geometry from the template
        this.instances[uuid] = inst;
        if (this.viewer && this.viewer.requestRender) this.viewer.requestRender();
      }).catch(() => { this.instances[uuid] = 'failed'; });
    }

    _buildInstance (r, unit, spec, player) {
      const inst = {
        root: r.root, wrapper: r.placementNode, skinnedMeshes: r.skinnedMeshes || [],
        mixer: null, actions: {}, state: null, deathDur: 1, scale: spec.scale || 1,
        // Flight altitude. `spec.flyHeight` wins for two-form units, where
        // unit.meta only ever describes the FINAL form (a statue that becomes a
        // Destroyer would otherwise hover from the moment it was built).
        flyHeight: (spec.flyHeight != null)
          ? spec.flyHeight
          : ((unit.meta && unit.meta.moveHeight) || 0)
      };
      this._setupMixer(inst, r.animations, spec.form);
      // Team/hero ground selection ring (player color, gold for heroes; flat, does
      // not rotate with the unit; lives in the scene, not the facing wrapper).
      const isHero = !!(unit.meta && unit.meta.hero);
      const cs = unit.collisionSize || (isHero ? 32 : (unit.meta && unit.meta.worker ? 16 : 24));
      inst.isHero = isHero;
      inst.isIllusion = !!unit.isIllusion;
      // NOT game data — see below. `collisionSize` IS real (unitbalance.slk
      // `collision`); the 1.35 / 1.7 multipliers are ours.
      //
      // WC3's real answer is Art - Selection Scale (unitskin.txt `scale`, metadata
      // id `ussc`), which we now extract into helpers/modelScale.json as
      // `selectionScale`. It is unusable on its own: it scales SelectionCircle.mdx,
      // and that model is not in tools/map-data (only the circle TEXTURES are), so
      // the absolute radius it multiplies is unknown. Deriving the base from
      // footprints gives 25-40 world units depending on the building, and from the
      // footman's current ring gives ~42 — no clean constant. Swapping 1.35 for
      // another invented constant would not make this more correct.
      //
      // To close it: extract SelectionCircle.mdx, measure its bind-pose radius, and
      // use `selectionScale * thatRadius`.
      inst.ringRadius = cs * (isHero ? 1.7 : 1.35);
      const ringColor = inst.isIllusion ? ILLUSION_RING : (isHero ? HERO_RING : (player.playerColor || '#ffffff'));
      this._addRing(inst, ringColor, 0.85);
      this._applyTeamColor(inst, player.playerColor);
      this._addShadow(inst, cs);
      inst.root.visible = false;
      this.scene.add(inst.root);
      return inst;
    }

    // Set the player's colour on team-tinted unit materials — composite geosets
    // (e.g. the footman tabard: team colour shows through the texture) and flat
    // team-colour/glow geosets. GLBLoader tags them via material.userData.wc3 and
    // exposes a uTeamColor uniform. No-op for units with no team geoset.
    _applyTeamColor (inst, playerColorHex) {
      const col = new THREE.Color(playerColorHex || '#ffffff');
      for (const m of inst.skinnedMeshes) {
        const mat = m.material, wc3 = mat && mat.userData && mat.userData.wc3;
        if (wc3 && (wc3.replaceableId || wc3.teamBlend) && mat.uniforms && mat.uniforms.uTeamColor) {
          mat.uniforms.uTeamColor.value.copy(col);
        }
      }
    }

    // Soft ground shadow (scene-level decal, tracks ring visibility). Radius keyed
    // to collision size; offset toward the sun's cast direction in _place.
    _addShadow (inst, cs) {
      if (this._poolsEnabled) {
        inst.shadow = {
          isPooled: true,
          position: new THREE.Vector3(),
          scale: new THREE.Vector3(1, 1, 1),
          visible: false,
          material: { opacity: 0.9 }
        };
        inst.shadowOpacity = 0.9;
        inst.shadowRadius = cs * 2.0;
        return;
      }
      inst.shadow = new THREE.Mesh(shadowGeo(), new THREE.MeshBasicMaterial({
        map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.9, color: 0x000000
      }));
      inst.shadow.rotation.x = -Math.PI / 2;
      inst.shadow.renderOrder = 1;   // under the selection ring (3), over terrain
      inst.shadow.visible = false;
      inst.shadowOpacity = 0.9;      // baseline the instance fade scales
      inst.shadowRadius = cs * 2.0;  // a touch wider than the model footprint
      this.scene.add(inst.shadow);
    }

    // Position the ground shadow under a unit standing at (wx,wy,groundY).
    _placeShadow (inst, wx, wy, groundY, cx, cy) {
      if (!inst.shadow) return;
      const r = inst.shadowRadius;
      inst.shadow.position.set(wx - cx + r * SHADOW_OFFSET_X, groundY + 1, -(wy - cy) + r * SHADOW_OFFSET_Z);
      inst.shadow.scale.set(r, r, r);
    }

    // Build the AnimationMixer + per-category actions; start idle (desynced).
    _setupMixer (inst, animations, form) {
      const f = form || 'base';
      this._applyFormMeshes(inst, f);
      if (!animations || !animations.length) { inst.form = f; return; }
      inst.mixer = new THREE.AnimationMixer(inst.root);
      inst.animations = animations;
      this._bindFormActions(inst, f);
      const start = inst.actions.idle || inst.actions.walk || inst.actions.attack;
      if (start) { start.play(); start.time = Math.random() * (start.getClip().duration || 1); inst.state = start === inst.actions.idle ? 'idle' : (start === inst.actions.walk ? 'walk' : 'attack'); }
    }

    // Show only the geometry belonging to `form`. Two-form GLBs (Obsidian
    // Statue ⇄ Destroyer) carry both forms' meshes tagged 'base'/'alternate';
    // meshes tagged 'both' — and every mesh in a single-form model, which has
    // no tag at all — are left alone.
    _applyFormMeshes (inst, form) {
      for (const m of inst.skinnedMeshes) {
        const tag = m.userData && m.userData.wc3Form;
        if (!tag || tag === 'both') continue;
        m.visible = (tag === form);
      }
      // Static-pose LOD meshes mirror the same tags (kept in sync so a form
      // change landing while the unit is frozen still shows the right form).
      if (inst.staticMeshes) {
        for (const m of inst.staticMeshes) {
          const tag = m.userData && m.userData.wc3Form;
          if (!tag || tag === 'both') continue;
          m.visible = (tag === form);
        }
      }
    }

    // Bind the clip set for a form. The converter emits the alternate form's
    // clips under a `_alt` suffix (idle_alt, walk_alt, …), so the animation
    // state machine keeps using the canonical category names either way.
    _bindFormActions (inst, form) {
      const byName = {}; for (const c of inst.animations) byName[c.name] = c;
      const suffix = (form === 'alternate') ? '_alt' : '';
      inst.actions = {};
      for (const cat of CATS) {
        const clip = byName[cat + suffix] || byName[cat];
        if (clip) inst.actions[cat] = inst.mixer.clipAction(clip);
      }
      const death = byName['death' + suffix] || byName.death;
      inst.deathDur = (death && death.duration) || 1;
      // The transition INTO this form: "Morph" plays base → alternate, "Morph
      // Alternate" plays alternate → base (see tools/lib/mdx-skin.js). Bound as
      // a state alongside the loops so _setLoopState can cross-fade out of it.
      const morphIn = (form === 'alternate') ? byName.morph : byName.morph_alt;
      if (morphIn) {
        inst.actions.morph = inst.mixer.clipAction(morphIn);
        inst.morphDur = morphIn.duration || 1;
      } else {
        inst.morphDur = 0;
      }
      inst.form = form;
    }

    // Switch a live instance between forms — driven by the unit's morph
    // timeline, so scrubbing across the morph flips it both ways. Cheap enough
    // to call every frame: it early-outs unless the form actually changed.
    _setForm (inst, form) {
      if (!form || inst.form === form) return;
      this._applyFormMeshes(inst, form);
      if (!inst.mixer || !inst.animations) { inst.form = form; return; }

      // A form swap can rebind to a different mesh/material set — force the
      // next _setOpacity to reapply rather than trust the last-value memo.
      inst._lastOpacity = undefined;

      const prevState = inst.state;
      for (const key of Object.keys(inst.actions)) {
        const a = inst.actions[key];
        if (a) a.stop();
      }
      this._bindFormActions(inst, form);

      // Carry the animation state across the swap so a walking Destroyer keeps
      // walking instead of snapping to idle mid-stride. 'morph' is never
      // carried: the rebound morph action belongs to the OTHER direction, and
      // _applyMorph must see a non-morph state to start it fresh.
      const carry = (prevState && prevState !== 'morph') ? prevState : null;
      const next = (carry && inst.actions[carry]) || inst.actions.idle;
      if (next) {
        next.play();
        inst.state = (carry && inst.actions[carry]) ? carry : 'idle';
      } else {
        inst.state = null;
      }
    }

    // Flat ground ring — a pooled descriptor (see RingShadowPool), or a real
    // scene Mesh when perf.instancedRings is off.
    _addRing (inst, colorHex, opacity) {
      if (this._poolsEnabled) {
        inst.ring = {
          isPooled: true,
          position: new THREE.Vector3(),
          scale: new THREE.Vector3(1, 1, 1),
          visible: false,
          material: { color: new THREE.Color(colorHex), opacity: opacity }
        };
        inst.ringOpacity = opacity;   // baseline the instance fade scales
        return;
      }
      inst.ring = new THREE.Mesh(ringGeo(), new THREE.MeshBasicMaterial({
        color: new THREE.Color(colorHex), transparent: true, opacity: opacity, depthWrite: false, side: THREE.DoubleSide
      }));
      inst.ring.rotation.x = -Math.PI / 2;
      inst.ring.renderOrder = 3;
      inst.ring.visible = false;
      inst.ringOpacity = opacity;   // baseline the instance fade scales
      this.scene.add(inst.ring);
    }

    // Minimal placeholder for units with no exported 3D model: a translucent
    // team-coloured blob + ground ring, so nothing falls back to a flat 2D icon.
    // No skeleton/animation; flagged isPlaceholder.
    //
    // The remaining cases are things with no mesh in the game either — the Plague
    // Cloud (uplg) is a pure particle emitter with zero geosets. Water elementals
    // are NOT in this set any more.
    _createPlaceholder (unit, player) {
      const root = new THREE.Group();
      const wrapper = new THREE.Group();
      root.add(wrapper);
      const isHero = !!(unit.meta && unit.meta.hero);
      const isIllusion = !!unit.isIllusion;
      const cs = unit.collisionSize || 24;
      const color = new THREE.Color(isIllusion ? ILLUSION_RING : (isHero ? HERO_RING : (player.playerColor || '#ffffff')));
      const blob = new THREE.Mesh(blobGeo(), new THREE.MeshLambertMaterial({
        color, emissive: color, emissiveIntensity: 0.3, transparent: true, opacity: 0.6
      }));
      blob.scale.setScalar(cs * 0.8);
      blob.position.y = cs * 0.9;     // float at body height above the ground ring
      blob.frustumCulled = false;
      wrapper.add(blob);

      // Same pooled-descriptor-or-Mesh split as every other unit ring.
      const ringHolder = {};
      this._addRing(ringHolder, color, 0.85);
      const ring = ringHolder.ring;

      root.visible = false;
      this.scene.add(root);
      return {
        root, wrapper, ring, skinnedMeshes: [blob], mixer: null, actions: {}, state: null,
        deathDur: 1, scale: 1, isPlaceholder: true, ringRadius: cs * 1.35, isHero, isIllusion
      };
    }

    // Is `gameTime` inside a morph transition window for this unit? Returns
    // { t, dur, frac, fromFly, toFly } while the morph-in clip of the CURRENT
    // form should be playing, else null. Anchored to the recorded morph event
    // in unit.morphHistory — a pure function of gameTime, so scrubbing across
    // (or into the middle of) the window poses it correctly in both directions.
    _morphWindow (inst, unit, spec, gameTime) {
      const history = unit.morphHistory;
      if (!history || !history.length || !inst.actions || !inst.actions.morph || !inst.morphDur) return null;
      // Latest morph event at or before gameTime (the one that produced the
      // current form). History is tiny (statue ⇄ Destroyer flips), linear is fine.
      let idx = -1;
      for (let i = 0; i < history.length; i++) {
        if (history[i].gameTime > gameTime) break;
        idx = i;
      }
      if (idx < 0) return null;
      const ageS = (gameTime - history[idx].gameTime) / 1000;
      if (ageS >= inst.morphDur) return null;
      // Altitude ramp endpoints: the form we morphed FROM → the form we're in.
      const fromId = (idx > 0 ? history[idx - 1].itemId : unit._formBaseItemId) || '';
      const fromSpec = this.manifest[fromId.toLowerCase()] || this.manifest[fromId];
      return {
        t: ageS,
        dur: inst.morphDur,
        frac: Math.min(1, ageS / inst.morphDur),
        fromFly: (fromSpec && fromSpec.flyHeight != null) ? fromSpec.flyHeight : 0,
        toFly: (spec.flyHeight != null) ? spec.flyHeight : 0
      };
    }

    // Pose the one-shot morph transition clip at its window-relative time —
    // manual clip time + mixer.update(0), the same seek-safe pattern as
    // _applyDeath, so pausing mid-morph or scrubbing holds the right frame.
    _applyMorph (inst, morph) {
      const a = inst.actions.morph;
      if (!a) return;
      if (inst.state !== 'morph') {
        for (const k of ['idle', 'walk', 'attack']) { const x = inst.actions[k]; if (x) x.stop(); }
        a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
        a.enabled = true; a.setEffectiveWeight(1); a.setEffectiveTimeScale(1); a.play();
        inst.state = 'morph';
      }
      a.paused = true;
      a.time = Math.min(morph.t, morph.dur);
      inst.mixer.update(0);   // apply the seeked pose without advancing
    }

    // Cross-fade the looping state machine to `target` (idle/walk/attack).
    _setLoopState (inst, target) {
      if (inst.state === target) return;
      const to = inst.actions[target];
      if (!to) return; // no clip for this state (e.g. no attack) — keep current
      const from = inst.actions[inst.state];
      to.enabled = true; to.setEffectiveWeight(1); to.setEffectiveTimeScale(1); to.reset(); to.play();
      if (from && from !== to) from.crossFadeTo(to, FADE, false);
      inst.state = target;
    }

    // Drive the one-shot death clip, seek-safe (manual clip time, mixer.update(0)).
    // Returns the corpse opacity for this frame.
    _applyDeath (inst, ageS) {
      const d = inst.actions.death;
      if (d) {
        if (inst.state !== 'death') {
          for (const k of ['idle', 'walk', 'attack', 'morph']) { const a = inst.actions[k]; if (a) a.stop(); }
          d.reset(); d.setLoop(THREE.LoopOnce, 1); d.clampWhenFinished = true; d.enabled = true; d.setEffectiveWeight(1); d.play();
          inst.state = 'death';
        }
        d.paused = true;
        d.time = Math.min(ageS, inst.deathDur);
        inst.mixer.update(0); // apply the seeked death pose without advancing
      }
      return (ageS > inst.deathDur) ? Math.max(0, 1 - (ageS - inst.deathDur) * 1000 / CORPSE_FADE_MS) : 1;
    }

    // Synthesized attack cadence: a unit swings on its REAL cooldown
    // (meta.combat from unitweapons.slk), the attack clip playing once per swing
    // with the hit landing at the clip's own damage frame (~damagePoint). Driven
    // deterministically from gameTime (paused action + manual time, like
    // _applyDeath) so it's identical on any scrub/seek. Replays don't record
    // individual attack events, so a steady cadence is the best faithful
    // synthesis.
    //
    // The clock comes from ProjectileModel, NOT from UnitBehavior's swingPhase.
    // Two reasons, and both matter:
    //
    //   1. It has to be the SAME clock the projectile scheduler uses, or the
    //      arrow leaves the bow at a different moment than the bow twangs.
    //   2. UnitBehavior's cadence FREEZES. Its anchor is
    //      max(lastPathSampleTime, t - dwell) with dwell capped at 2s; both
    //      terms slide with t, so two seconds into any engagement the phase
    //      pins to a constant. Measured on a real replay: a ranged unit held
    //      clipFill 0.500 for 45 seconds and a melee unit held 1.000 for 24.
    //      The swing simply stopped cycling. An absolute grid can't do that.
    _applyAttack (inst, d, unit, gameTime) {
      const a = inst.actions.attack;
      if (!a) { this._setLoopState(inst, 'idle'); inst.mixer.update(0); return; }
      const clipDur = (a.getClip() && a.getClip().duration) || 1;

      const PM = window.ProjectileModel;
      const combat = unit && unit.meta && unit.meta.combat;
      let fill;
      if (PM && d.isSupportCast) {
        // Replenish is a flat pulse, not an attack cooldown — same grid, its
        // own period.
        fill = PM.gridPhase(d.uuid, gameTime, (d.swingPeriod || 1) * 1000);
      } else if (PM && combat) {
        fill = PM.clipFillAt(d.uuid, gameTime, combat);
      } else {
        fill = d.clipFill;   // ProjectileModel absent (e.g. a stripped build)
      }

      if (inst.state !== 'attack') {
        for (const k of ['idle', 'walk', 'morph']) { const x = inst.actions[k]; if (x) x.stop(); }
        a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
        a.enabled = true; a.setEffectiveWeight(1); a.setEffectiveTimeScale(1); a.play();
        inst.state = 'attack';
      }
      a.paused = true;
      // In-swing → play through the clip; in the cooldown gap → hold the recovery
      // (last) frame so ranged units with long cooldowns don't loop unnaturally.
      // The fill compresses the clip into the unit's real damagePoint+backswing,
      // which is what makes a ranged unit read as "fire, hold, fire" against a
      // melee unit's continuous swinging — and it is now the same 0..1 the
      // projectile launches off, so the arrow leaves exactly at the release.
      a.time = Math.min(fill * clipDur, clipDur);
      inst.mixer.update(0);   // apply the seeked pose without advancing
    }

    /**
     * Draw the state UnitBehavior decided. This function no longer INFERS
     * anything — it used to decide "attack" from mere membership in a battle's
     * participant list, with no target and no range test, which is what had
     * units swinging at empty air for whole battle windows.
     */
    _animate (inst, unit, gameTime, dt, deathStart, d, morph) {
      if (!inst.mixer) return;

      // --- DEATH: one-shot, seek-safe via manual clip time ---
      if (deathStart != null && gameTime >= deathStart) {
        this._setOpacity(inst, this._applyDeath(inst, (gameTime - deathStart) / 1000));
        return;
      }
      if (inst.state === 'death') inst.state = null; // scrubbed back before death

      // --- MORPH transition: one-shot, wins over the looping states ---
      if (morph) {
        this._applyMorph(inst, morph);
        this._applyLivingOpacity(inst, unit);
        return;
      }

      const state = d ? d.state : 'idle';

      if (state === 'walk') {
        this._setLoopState(inst, 'walk');
        // Stride-lock: play the walk cycle at (ground speed ÷ base move speed) so
        // feet track the ground instead of skating. The speed comes from the
        // smoothed PATH SEGMENT velocity, not a finite difference of interpolated
        // positions — the old estimate swung between 0 and 4x on the same walk.
        if (inst.actions.walk) inst.actions.walk.setEffectiveTimeScale(d.strideScale);
        inst.mixer.update(dt);
      } else if ((state === 'attack' || state === 'cast') && inst.actions.attack) {
        // 'cast' is a support channel (statue Replenish). WC3 gives the statue
        // one clip — "Attack Spell" — for both, so the same cadence drives it;
        // only the aim differs (an ally instead of an enemy).
        this._applyAttack(inst, d, unit, gameTime);   // scrub-safe cadence; drives the mixer itself
      } else {
        this._setLoopState(inst, 'idle');
        inst.mixer.update(dt);
      }

      this._applyLivingOpacity(inst, unit);
    }

    // decay/stale fade for living units, plus illusion (ghostly) + hidden (faint).
    _applyLivingOpacity (inst, unit) {
      let op = unit.decayLevel != null ? unit.decayLevel : 1;
      if (inst.isIllusion) op *= ILLUSION_OPACITY;
      if (unit._isHiddenNow) op *= HIDDEN_OPACITY;
      this._setOpacity(inst, op);
    }

    _setOpacity (inst, a) {
      // Runs for every visible unit every frame, but almost every unit sits at
      // a=1 almost always — skip the whole material walk when nothing changed.
      // (Quantized compare: sub-0.001 fade deltas are invisible.)
      if (inst._lastOpacity !== undefined && Math.abs(inst._lastOpacity - a) < 0.001) return;
      inst._lastOpacity = a;
      const fading = a < 0.999;
      // The ground ring and blob shadow are separate scene meshes, so they used
      // to hold full opacity while the body faded — a bright, crisp selection
      // circle around a unit that was barely there (and, at decayLevel 0, around
      // nothing at all). Fade the whole presentation together.
      if (inst.ring) inst.ring.material.opacity = (inst.ringOpacity != null ? inst.ringOpacity : 0.85) * a;
      if (inst.shadow) inst.shadow.material.opacity = (inst.shadowOpacity != null ? inst.shadowOpacity : 0.9) * a;
      for (const sm of inst.skinnedMeshes) {
        const m = sm.material; if (!m) continue;
        // WC3 skinned ShaderMaterial: fade via the uOpacity uniform, and while
        // fading force alpha-blending (restoring each material's own base blend
        // state when opaque again so team-glow/additive geosets keep their mode).
        if (m.uniforms && m.uniforms.uOpacity) {
          m.uniforms.uOpacity.value = a;
          const baseT = m.userData.baseTransparent, baseD = m.userData.baseDepthWrite;
          m.transparent = fading ? true : !!baseT;
          m.depthWrite = fading ? false : (baseD !== false);
        } else {
          // Non-shader materials (placeholder blobs) — legacy opacity path.
          m.transparent = fading; m.opacity = a; m.depthWrite = !fading;
        }
      }
    }

    _place (inst, unit, pos, gameTime, cx, cy, d) {
      const wx = pos.x, wy = pos.y;
      const groundY = this.renderer.sampleHeight ? this.renderer.sampleHeight(wx, wy) : 0;
      // Air units (Destroyer, gargoyle, frost wyrm; hoverers like the banshee
      // sit lower) fly at a fixed altitude above the terrain. Their selection
      // ring and shadow stay on the GROUND — that's how WC3 renders them, and
      // it's what makes the altitude readable.
      const bodyY = groundY + (inst.flyHeight || 0);
      const w = inst.wrapper;
      w.position.set(wx - cx, bodyY, -(wy - cy));
      if (inst.scale !== 1) w.scale.setScalar(inst.scale);
      this._updateCullBounds(inst, w.position.x, bodyY, w.position.z);

      // Ground ring (flat, does not rotate with facing).
      if (inst.ring) {
        inst.ring.position.set(wx - cx, groundY + 2, -(wy - cy));
        inst.ring.scale.set(inst.ringRadius, inst.ringRadius, inst.ringRadius);
      }
      inst._posFrame = this._frameSeq;   // this instance holds a FRESH position
      this._placeShadow(inst, wx, wy, groundY, cx, cy);

      // The placeholder blob is authored Y-up and rotationally symmetric — skip the
      // model facing rotation (it would tip the blob over via ZUP_TO_YUP).
      if (inst.isPlaceholder) return;

      // Facing: prefer UnitBehavior's, which is the baked turn-rate facing
      // TURNED TOWARD the resolved target when there is one (rate-limited, and
      // anchored to data rather than integrated per frame so it stays
      // seek-safe). Without this an attacking unit swung in whatever direction
      // it last walked, which is most of why valid attacks still looked wrong.
      let wf = (d && d.facing != null) ? d.facing : null;
      if (wf == null && unit.getInterpolatedFacing) wf = unit.getInterpolatedFacing(gameTime);
      if (wf == null) {
        const ahead = unit.getInterpolatedPosition(gameTime + 120);
        if (ahead) { const dx = ahead.x - wx, dy = ahead.y - wy; if (dx * dx + dy * dy > 1) inst._wf = Math.atan2(dy, dx); }
        wf = inst._wf || 0;
      } else { inst._wf = wf; }
      // Model forward = +X = world facing 0; scene yaw = +worldFacing (calibrated
      // via test-unit.html, see ZUP_TO_YUP + Ry(+wf)). Rate-limited on the way in
      // so the mesh can never out-turn the engine — see _slewFacing.
      UnitModelRenderer.faceQuaternion(this._slewFacing(inst, wf), this._facingOffset, w.quaternion);
    }

    /**
     * Open a frame for the facing slew: work out how much every model is
     * allowed to turn, and whether this is a seek.
     *
     * The budget is spent against GAME time, not wall time, so a unit turns at
     * the same in-game rate whatever the playback speed or frame rate. Called
     * once at the top of update(); the split-screen path calls update() twice
     * per frame with the same gameTime, and that second call correctly gets a
     * zero budget rather than turning everything twice.
     */
    _beginFacingFrame (gameTime) {
      const prev = this._facingLastTime;
      const step = (prev == null) ? Infinity : gameTime - prev;
      // Backward or a big forward jump means the user scrubbed. Slewing across a
      // seek would leave the model pointing at wherever it happened to be before
      // the jump, so snap to the authority's answer instead.
      this._facingSnap = !(step >= 0 && step <= FACING_SNAP_MS);
      const rate = (window.UnitBehavior && window.UnitBehavior.C)
        ? window.UnitBehavior.C.TURN_RAD_PER_FRAME_CAP / window.UnitBehavior.C.WC3_FRAME_MS
        : FACING_RATE_FALLBACK;
      this._facingBudget = this._facingSnap ? Infinity : rate * step;
      this._facingLastTime = gameTime;
    }

    /**
     * What facing to actually DRAW, given the one UnitBehavior asked for.
     *
     * UnitBehavior is a pure function of game time — that is what makes seeking
     * exact — but purity also means it cannot remember the previous frame, so
     * when a unit switches target mid-fight its answer moves instantly, through
     * any angle. The mesh does not have to obey instantly, and it shouldn't: a
     * model that snaps 180° between two frames is the "spinning on the spot"
     * artifact, and no WC3 unit can turn faster than its turn rate.
     *
     * So this is the last line of defence, and a structural one — whatever the
     * authority does upstream, the model physically cannot rotate faster than
     * the engine cap. It is render-only state, discarded on a seek.
     */
    _slewFacing (inst, want) {
      if (want == null || !isFinite(want)) return inst._wfShown || 0;
      const shown = inst._wfShown;
      if (shown == null || this._facingSnap) { inst._wfShown = want; return want; }
      const budget = this._facingBudget;
      if (!(budget > 0)) return shown;
      let d = want - shown;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) <= budget) { inst._wfShown = want; return want; }
      const next = shown + (d > 0 ? budget : -budget);
      inst._wfShown = next;
      return next;
    }

    // Place an instance at an explicit world position + facing. Used by the
    // synthetic harvest loop, which overrides the unit's real path position.
    _placeAt (inst, wx, wy, faceAng, cx, cy) {
      const groundY = this.renderer.sampleHeight ? this.renderer.sampleHeight(wx, wy) : 0;
      const w = inst.wrapper;
      w.position.set(wx - cx, groundY, -(wy - cy));
      if (inst.scale !== 1) w.scale.setScalar(inst.scale);
      this._updateCullBounds(inst, w.position.x, groundY, w.position.z);
      if (inst.ring) {
        inst.ring.position.set(wx - cx, groundY + 2, -(wy - cy));
        inst.ring.scale.set(inst.ringRadius, inst.ringRadius, inst.ringRadius);
      }
      inst._posFrame = this._frameSeq;   // see _place
      this._placeShadow(inst, wx, wy, groundY, cx, cy);
      if (inst.isPlaceholder) return;
      inst._wf = faceAng;
      UnitModelRenderer.faceQuaternion(faceAng, this._facingOffset, w.quaternion);
    }

    // ── Worker harvest treatment (declutter + ambient gather loop) ───────────
    // Returns 'render' (normal path-driven draw), 'hidden', or 'loop'. Only
    // called for harvesters (_isHarvester). Mirrors ClientUnit._isWorkerRelevant
    // for the relevance cases, then applies the parser's confidence mark.
    _workerTreatment (unit, pos, player, gameTime, battleSet, reps) {
      // Actively building → always draw (walking to / summoning / constructing).
      // Highest priority so a builder is never decluttered like an idle worker.
      if (unit._inBuildWindow && unit._inBuildWindow(gameTime)) return 'render';
      // Relevant right now → draw normally (scouting, in a fight, pulled, or
      // operating away from base). Covers army ghouls and pulled workers.
      if (unit.scoutInfo) return 'render';
      if (battleSet.has(unit.uuid)) return 'render';
      if (unit.combatOrderTimes) {
        for (let i = 0; i < unit.combatOrderTimes.length; i++) {
          const t = unit.combatOrderTimes[i];
          if (gameTime >= t && gameTime <= t + WORKER_COMBAT_VISIBLE_MS) return 'render';
        }
      }
      const anchors = player.getBaseAnchors ? player.getBaseAnchors() : null;
      if (anchors && anchors.length && !this._withinBase(pos, anchors)) {
        return 'render';   // away from every base → relevant (expanding/scouting)
      }
      // In-base harvesting workforce: only confident workers show.
      const kind = unit.harvestKind ? unit.harvestKind() : null;
      if (!kind) return 'hidden';                 // uncertain (idle ghoul, default-role worker)
      if (kind === 'gold-internal') return 'hidden';         // wisp inside the gold mine — invisible in WC3
      if (kind.indexOf('-static') !== -1) return 'render';   // acolyte/lumber-wisp channel at real pos
      // Looper: only the per-player representative of its role animates.
      const role = kind.slice(0, kind.indexOf('-'));
      if (reps && reps[role] === unit.uuid) return 'loop';
      return 'hidden';
    }

    // Stable representative gold + lumber looper per player (the only loopers
    // shown). Cached so it doesn't flicker; re-picked only when the current rep
    // dies or stops being a confident looper of its role.
    _harvestRepsFor (player, gameTime) {
      if (!this._reps) this._reps = {};
      const pid = player.playerId;
      let rec = this._reps[pid];
      if (!rec) rec = this._reps[pid] = { gold: null, lumber: null, _goldUnit: null, _lumberUnit: null };
      // Keep the unit REFERENCE alongside the uuid: re-finding the unit by
      // uuid was an O(units) scan + closure per role per player per frame.
      let g = rec._goldUnit;
      if (!(g && g.uuid === rec.gold && this._isLiveLooper(g, 'gold', gameTime))) {
        g = this._pickLooper(player, 'gold', gameTime);
        rec._goldUnit = g; rec.gold = g ? g.uuid : null;
      }
      let l = rec._lumberUnit;
      if (!(l && l.uuid === rec.lumber && this._isLiveLooper(l, 'lumber', gameTime))) {
        l = this._pickLooper(player, 'lumber', gameTime);
        rec._lumberUnit = l; rec.lumber = l ? l.uuid : null;
      }
      return rec;
    }

    _isLiveLooper (unit, role, gameTime) {
      if (!unit || !unit.harvestKind || unit.harvestKind() !== role + '-loop') return false;
      const ready = unit.readyTime != null ? unit.readyTime : unit.spawnTime;
      if (ready != null && gameTime < ready) return false;
      const ds = this._deathStart(unit);
      if (ds != null && gameTime >= ds) return false;
      return true;
    }

    // Pick a representative looper of this role, preferring one that is HOME in
    // the base right now (a real harvester) over a roaming army worker — UD
    // ghouls harvest lumber AND fight, so "confident lumber" alone isn't enough.
    // Falls back to the first live looper. Cached by the caller; re-picked only
    // when it dies / changes role. Returns the UNIT (caller records its uuid).
    _pickLooper (player, role, gameTime) {
      const anchors = player.getBaseAnchors ? player.getBaseAnchors() : null;
      let fallback = null;
      for (const u of player.units) {
        if (!this._isLiveLooper(u, role, gameTime)) continue;
        if (!fallback) fallback = u;
        if (anchors && anchors.length) {
          const p = u.getInterpolatedPosition(gameTime);
          if (p && this._withinBase(p, anchors)) return u;   // home harvester — prefer it
        }
      }
      return fallback;
    }

    _withinBase (pos, anchors) {
      const r2 = WORKER_BASE_RADIUS * WORKER_BASE_RADIUS;
      for (let i = 0; i < anchors.length; i++) {
        const dx = pos.x - anchors[i].x, dy = pos.y - anchors[i].y;
        if (dx * dx + dy * dy <= r2) return true;
      }
      return false;
    }

    // Resource anchor (A) + drop-off anchor (B) for the synthetic loop. A is the
    // worker's real (parked) position — after a harvest command the auto gather
    // trips aren't in the replay, so the path "parks" the worker at the resource.
    // A only refreshes while parked so the loop never chases its own animation.
    _loopAnchors (inst, unit, realPos, gameTime, player) {
      const back = unit.getInterpolatedPosition(gameTime - 120);
      const parked = !back ||
        ((realPos.x - back.x) * (realPos.x - back.x) + (realPos.y - back.y) * (realPos.y - back.y)) < MOVE_EPS2;
      if (!inst._loopA || parked) {
        inst._loopA = { x: realPos.x, y: realPos.y };
        inst._loopB = this._nearestDropoff(player, realPos.x, realPos.y, unit.harvestKind(), gameTime);
      }
      if (!inst._loopB) return null;
      return { a: inst._loopA, b: inst._loopB };
    }

    _nearestDropoff (player, ax, ay, kind, gameTime) {
      const HALL = window.ClientPlayer && window.ClientPlayer.HALL_IDS;
      const lumber = kind && kind.indexOf('lumber') === 0;
      let best = null, bestD = Infinity;
      for (const u of player.units) {
        if (!u.isBuilding) continue;
        const ok = (HALL && HALL.has(u.itemId)) || (lumber && LUMBER_DROPOFF_IDS.has(u.itemId));
        if (!ok) continue;
        // A worker can only RETURN resources to a finished building — a graveyard
        // (or hall) that's still a construction site can't receive lumber/gold yet.
        if (!this._dropoffReady(u, gameTime)) continue;
        const p = u.lastPosition || u.spawnPosition || (u.path && u.path[0]);
        if (!p || p.x == null) continue;
        const d = (p.x - ax) * (p.x - ax) + (p.y - ay) * (p.y - ay);
        if (d < bestD) { bestD = d; best = { x: p.x, y: p.y }; }
      }
      if (!best && player.startingPosition) best = { x: player.startingPosition.x, y: player.startingPosition.y };
      return best;
    }

    // True once a building has finished construction at `gameTime`. Pre-placed
    // buildings (no observed constructionStartTime) are already standing; ones
    // raised during the replay become valid drop-offs at start + buildTime
    // (the same window BuildingProgressBar uses). Missing balance data → assume
    // ready, so we never over-hide when buildTime is unknown.
    _dropoffReady (u, gameTime) {
      const start = u.constructionStartTime;
      if (start == null) return true;
      const bal = this.viewer && this.viewer.unitBalance && this.viewer.unitBalance[u.itemId];
      const buildTime = bal && bal.buildTime;
      if (!buildTime) return true;
      return gameTime >= start + buildTime * 1000;
    }

    // Drive the representative worker along a deterministic (scrub-safe) loop:
    // resource → drop-off → back, with a short dwell (mining/dropping) at each end.
    _placeLoop (inst, unit, anchors, gameTime, dt, cx, cy) {
      const a = anchors.a, b = anchors.b;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const decay = unit.decayLevel != null ? unit.decayLevel : 1;

      if (dist < LOOP_MIN_DIST) {   // too close to bother — render parked at the resource
        this._placeAt(inst, a.x, a.y, inst._wf || 0, cx, cy);
        if (!inst._staticOn) {
          this._setLoopState(inst, 'idle');
          if (inst.mixer) inst.mixer.update(dt);
        }
        this._setOpacity(inst, decay);
        return;
      }

      const speed = (unit.meta && unit.meta.movespeed) || 270;
      const legMs = Math.max(700, (dist / speed) * 1000);
      const cycle = 2 * (legMs + LOOP_DWELL_MS);
      if (inst._loopPhase == null) inst._loopPhase = this._phaseOffset(unit.uuid, cycle);
      const phase = (((gameTime + inst._loopPhase) % cycle) + cycle) % cycle;

      let fx, fy, moving, faceAng;
      if (phase < legMs) {                              // resource → drop-off
        const t = phase / legMs; fx = a.x + dx * t; fy = a.y + dy * t; moving = true; faceAng = Math.atan2(dy, dx);
      } else if (phase < legMs + LOOP_DWELL_MS) {       // dwell at drop-off
        fx = b.x; fy = b.y; moving = false; faceAng = Math.atan2(a.y - b.y, a.x - b.x);
      } else if (phase < 2 * legMs + LOOP_DWELL_MS) {   // drop-off → resource
        const t = (phase - legMs - LOOP_DWELL_MS) / legMs; fx = b.x - dx * t; fy = b.y - dy * t; moving = true; faceAng = Math.atan2(-dy, -dx);
      } else {                                          // dwell at resource (harvesting)
        fx = a.x; fy = a.y; moving = false; faceAng = Math.atan2(dy, dx);
      }

      this._placeAt(inst, fx, fy, faceAng, cx, cy);
      // A frozen (static-LOD) looper still marches the route — position comes
      // from _placeAt above — it just doesn't tick its animation.
      if (!inst._staticOn) {
        this._setLoopState(inst, moving ? 'walk' : 'idle');
        if (inst.mixer) inst.mixer.update(dt);
      }
      this._setOpacity(inst, decay);
    }

    // Deterministic per-uuid phase offset so a player's gold + lumber loopers
    // don't march in lockstep. Pure function of the uuid (scrub-safe).
    _phaseOffset (uuid, cycle) {
      let h = 0;
      for (let i = 0; i < (uuid || '').length; i++) h = (h * 31 + uuid.charCodeAt(i)) | 0;
      return Math.abs(h) % Math.max(1, Math.round(cycle));
    }

    // ── Guided-walkthrough focus glow ────────────────────────────────────────
    // Make the step's emphasised UNITS glow gold (emissive pulse) + brighten
    // their existing ground ring. This is a surface-light effect on the real 3D
    // model, so it can never occlude the unit or its nameplate the way the old
    // 2D screen-space ring did. Driven by performance.now() (not dt) so it
    // pulses even while the guide is paused, and is scrub-safe. Buildings/camps
    // are handled separately by ThreeMapRenderer.highlightGroundRings (instanced
    // building materials are shared and can't be glowed per-building).
    //
    // uuidSet: Set of unit uuids to glow (null/empty clears). colorHex: glow
    // colour (default gold). startTime: shared with the ground-ring pulse so the
    // two cues breathe in phase.
    setGuideHighlight (uuidSet, colorHex, startTime) {
      const prev = this._hlUuids;
      if (prev) {
        for (const id of prev) {
          if (uuidSet && uuidSet.has && uuidSet.has(id)) continue;
          this._restoreHighlight(this.instances[id] || this.creepInstances[id]);
        }
      }
      const active = !!(uuidSet && uuidSet.size);
      this._hlUuids = active ? uuidSet : null;
      this._hlColor = active ? new THREE.Color(colorHex || 0xffce3a) : null;
      this._hlStart = active ? (startTime || ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now())) : null;
    }

    // Put a previously-glowing instance back to its captured baseline.
    _restoreHighlight (inst) {
      if (!inst || !inst._hlOrig) return;
      const o = inst._hlOrig;
      for (let i = 0; i < inst.skinnedMeshes.length; i++) {
        const m = inst.skinnedMeshes[i] && inst.skinnedMeshes[i].material, s = o.mats[i];
        if (m && m.emissive && s) { m.emissive.setHex(s.hex); if ('emissiveIntensity' in m) m.emissiveIntensity = s.intensity; }
      }
      if (inst.ring && o.ring) {
        inst.ring.material.color.setHex(o.ring.hex);
        inst.ring.material.opacity = o.ring.opacity;
        // For creeps, force the phase-driven re-colour next frame (the snapshot
        // can be stale if the camp's phase changed mid-highlight); _setCreepRing
        // re-applies the correct current colour because the cached hex no longer
        // matches.
        if (inst.isCreep) inst.ringHex = null;
      }
      inst._hlOrig = null;
    }

    _updateGuideHighlight () {
      if (!this._hlUuids || !this._hlColor) return;
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const age = now - (this._hlStart || now);
      const loud = Math.max(0, 1 - age / 1700);            // attention grab → calm
      const pulse = 0.5 + 0.5 * Math.sin(now / 300);        // gentle breathing
      // Modulate the emissive COLOUR brightness (not emissiveIntensity) so the
      // pulse reads identically on MeshStandardMaterial (skinned models) AND
      // MeshLambertMaterial (placeholder blobs) — Lambert ignores emissiveIntensity.
      const bright = 0.55 + 0.55 * loud + 0.14 * pulse;     // ~0.62 calm → ~1.24 loud
      const ringOp = Math.min(1, 0.6 + 0.35 * loud);
      for (const id of this._hlUuids) {
        const inst = this.instances[id] || this.creepInstances[id];
        if (!inst || !inst.root || !inst.root.visible) continue;
        // Snapshot the baseline lazily — handles instances that finish loading
        // AFTER the highlight set was assigned (so clear can always restore).
        if (!inst._hlOrig) {
          inst._hlOrig = {
            mats: inst.skinnedMeshes.map(sm => (sm && sm.material && sm.material.emissive)
              ? { hex: sm.material.emissive.getHex(), intensity: ('emissiveIntensity' in sm.material) ? sm.material.emissiveIntensity : 1 } : null),
            ring: inst.ring ? { hex: inst.ring.material.color.getHex(), opacity: inst.ring.material.opacity } : null
          };
        }
        for (const sm of inst.skinnedMeshes) {
          if (!sm || !sm.material || !sm.material.emissive) continue;
          sm.material.emissive.copy(this._hlColor).multiplyScalar(bright);
          if ('emissiveIntensity' in sm.material) sm.material.emissiveIntensity = 1;
        }
        if (inst.ring) {
          inst.ring.visible = true;
          inst.ring.material.color.copy(this._hlColor);
          inst.ring.material.opacity = ringOp;
        }
      }
    }

    dispose () {
      const all = [this.instances, this.creepInstances];
      for (const map of all) {
        for (const k in map) {
          const inst = map[k];
          if (inst && inst.root) this.scene.remove(inst.root);
          if (inst && inst.ring && !inst.ring.isPooled) this.scene.remove(inst.ring);
          if (inst && inst.shadow && !inst.shadow.isPooled) this.scene.remove(inst.shadow);
          if (inst && inst.marker) this.scene.remove(inst.marker);
        }
      }
      if (this._ringPool) { this._ringPool.dispose(this.scene); this._ringPool = null; }
      if (this._shadowPool) { this._shadowPool.dispose(this.scene); this._shadowPool = null; }
      if (this._selectionPool) { this._selectionPool.dispose(this.scene); this._selectionPool = null; }
      this._selColors.clear();
      for (const k in this.campMarkers) {
        const m = this.campMarkers[k];
        if (m && m.sprite) this.scene.remove(m.sprite);
      }
      this.instances = {};
      this.creepInstances = {};
      this.campMarkers = {};
      this._hlUuids = null;
    }
  }

  /**
   * The one place a world facing becomes a scene orientation.
   *
   * Model forward = +X = world facing 0; scene yaw = +worldFacing, composed on
   * top of the exporter's Z-up→Y-up wrapper rotation. Every placement path goes
   * through this, and so does client/test-fx.html — a bench that reimplemented
   * the composition would be testing its own copy of the maths and would agree
   * with itself no matter how wrong both were.
   *
   * @param {number} worldFacing  radians, world space
   * @param {number} [offset]     model-forward calibration
   * @param {THREE.Quaternion} [out]
   */
  UnitModelRenderer.faceQuaternion = function (worldFacing, offset, out) {
    const q = out || new THREE.Quaternion();
    return q.setFromAxisAngle(UP, (worldFacing || 0) + (offset || 0)).multiply(ZUP_TO_YUP);
  };
  UnitModelRenderer.ZUP_TO_YUP = ZUP_TO_YUP;

  window.UnitModelRenderer = UnitModelRenderer;
})();
