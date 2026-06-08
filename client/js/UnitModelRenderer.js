/**
 * UnitModelRenderer — renders animated 3D unit models in the Three.js scene,
 * replacing the 2D circle+icon units (hybrid: units without a 3D model, beyond
 * the perf cap, or still loading keep their 2D icon).
 *
 * Wiring mirrors the other 3D subsystems (BuildingProgressBar / PathTrailRenderer3D):
 * constructed with the ThreeMapRenderer, driven once per frame from app.render().
 *
 * Per frame it enumerates live units, instantiates a skinned GLB per unit (loaded
 * via window.GLBLoader's skinned path), places it on terrain at the unit's
 * interpolated position, faces it along its velocity, advances its idle clip, and
 * fades it by the unit's decayLevel. The set of units shown in 3D is published on
 * viewOptions._rendered3D so the 2D path can skip them (ClientPlayer.drawResolvedUnits).
 *
 * Placement rule (see GLBLoader.parseSkinned): move the WRAPPER (bone root) only,
 * never the skinned-mesh node — that would double-transform. The wrapper already
 * carries the Z-up->Y-up fix; facing is composed on top of it.
 */
(function () {
  const UP = new THREE.Vector3(0, 1, 0);
  // Z-up (MDX) -> Y-up wrapper rotation baked by the exporter (-90deg about +X).
  const ZUP_TO_YUP = new THREE.Quaternion(-0.70710678, 0, 0, 0.70710678);

  class UnitModelRenderer {
    constructor (threeMapRenderer, viewer) {
      this.renderer = threeMapRenderer;
      this.scene = threeMapRenderer.scene;
      this.viewer = viewer;
      this.manifest = null;        // itemId -> { model, scale, clips[] }
      this._abCache = {};          // model name -> Promise<ArrayBuffer>
      this.instances = {};         // unit.uuid -> instance | 'pending' | 'failed'
      this.rendered3DUuids = new Set();
      this.clock = new THREE.Clock();
      this.maxUnits = 80;          // perf cap; beyond this, units stay 2D
      this._loader = new window.GLBLoader();
      this._facingOffset = 0;      // tuned so models face their movement direction
      this._loadManifest();
    }

    _loadManifest () {
      fetch('/assets/models/units/unit-models.json')
        .then(r => (r.ok ? r.json() : {}))
        .then(m => { this.manifest = m || {}; })
        .catch(() => { this.manifest = {}; });
    }

    _fetchAB (model) {
      if (!this._abCache[model]) {
        this._abCache[model] = fetch('/assets/models/units/' + model + '.glb')
          .then(r => { if (!r.ok) throw new Error('glb ' + r.status); return r.arrayBuffer(); });
      }
      return this._abCache[model];
    }

    // Called once per frame from app.render().
    update (gameTime, players, viewOptions) {
      const dt = this.clock.getDelta();
      this.rendered3DUuids.clear();
      if (viewOptions) viewOptions._rendered3D = this.rendered3DUuids;

      const on = viewOptions && viewOptions.display3DUnits;
      if (!on || !this.manifest) {
        for (const k in this.instances) {
          const inst = this.instances[k];
          if (inst && inst.root) inst.root.visible = false;
        }
        return;
      }

      // Map center for the WC3-world -> scene transform (matches building placement).
      let cx = 0, cy = 0;
      const mi = this.renderer.mapInfo;
      if (mi && mi.bounds && mi.bounds.map) {
        const e = mi.bounds.map;
        cx = (e[0][0] + e[0][1]) / 2; cy = (e[1][0] + e[1][1]) / 2;
      }

      const alive = new Set();
      let count = 0;
      for (const player of players) {
        const units = player.units || [];
        for (const unit of units) {
          if (unit.isBuilding) continue;
          const ready = unit.readyTime != null ? unit.readyTime : unit.spawnTime;
          if (ready != null && gameTime < ready) continue;
          if (unit.destroyedAt != null && gameTime >= unit.destroyedAt) continue;
          if (unit._isLoadedAt && unit._isLoadedAt(gameTime)) continue;

          const itemId = (unit.itemId || '').toLowerCase();
          const spec = this.manifest[itemId] || this.manifest[unit.itemId];
          if (!spec || !spec.model) continue; // no 3D model → 2D fallback

          const pos = unit.getInterpolatedPosition(gameTime);
          if (!pos) continue;

          let inst = this.instances[unit.uuid];
          if (inst === undefined) {
            if (count >= this.maxUnits) continue; // cap reached; keep this unit 2D
            this._create(unit, spec, player);
            inst = this.instances[unit.uuid];
          }
          count++;
          if (inst && inst.root) {
            this._place(inst, unit, pos, gameTime, cx, cy);
            if (inst.mixer) inst.mixer.update(dt);
            inst.root.visible = true;
            alive.add(unit.uuid);
            this.rendered3DUuids.add(unit.uuid);
          } else if (inst === 'pending') {
            // still loading — count it so the cap is stable, render 2D meanwhile
          }
        }
      }

      for (const k in this.instances) {
        const inst = this.instances[k];
        if (inst && inst.root && !alive.has(k)) inst.root.visible = false;
      }
    }

    _create (unit, spec, player) {
      const uuid = unit.uuid;
      this.instances[uuid] = 'pending';
      this._fetchAB(spec.model).then(ab => {
        const res = this._loader.parse(ab.slice(0)); // fresh independent instance
        const finish = (r) => {
          if (!r || !r.isSkinnedResult) { this.instances[uuid] = 'failed'; return; }
          const inst = {
            root: r.root,
            wrapper: r.placementNode,
            skinnedMeshes: r.skinnedMeshes || [],
            mixer: null,
            facing: null,
            scale: spec.scale || 1
          };
          if (r.animations && r.animations.length) {
            inst.mixer = new THREE.AnimationMixer(r.root);
            const action = inst.mixer.clipAction(r.animations[0]);
            action.play();
            action.time = Math.random() * (r.animations[0].duration || 1); // desync idles
          }
          this._tint(inst, player.playerColor);
          inst.root.visible = false;
          this.scene.add(inst.root);
          this.instances[uuid] = inst;
          // A render may not be scheduled (paused/seek) — request one so the
          // just-loaded model becomes visible this frame instead of next input.
          if (this.viewer && this.viewer.requestRender) this.viewer.requestRender();
        };
        if (res && res.then) res.then(finish); else finish(res);
      }).catch(() => { this.instances[uuid] = 'failed'; });
    }

    // Subtle team-color emissive so players are distinguishable (proper team-color
    // texture regions were dropped on export; revisit with the WC3 shader port —
    // a ground selection ring would read more cleanly than a full-body tint).
    _tint (inst, colorHex) {
      if (!colorHex) return;
      const c = new THREE.Color(colorHex);
      for (const sm of inst.skinnedMeshes) {
        if (sm.material && sm.material.emissive) {
          sm.material.emissive.copy(c);
          sm.material.emissiveIntensity = 0.07;
        }
      }
    }

    _place (inst, unit, pos, gameTime, cx, cy) {
      const wx = pos.x, wy = pos.y;
      const groundY = this.renderer.sampleHeight ? this.renderer.sampleHeight(wx, wy) : 0;
      const w = inst.wrapper;
      w.position.set(wx - cx, groundY, -(wy - cy));
      if (inst.scale !== 1) w.scale.setScalar(inst.scale);

      // Facing from velocity (look ~120ms ahead); hold last heading when idle.
      const ahead = unit.getInterpolatedPosition(gameTime + 120);
      if (ahead) {
        const dx = ahead.x - wx, dy = ahead.y - wy;
        if (dx * dx + dy * dy > 1) inst.facing = Math.atan2(-dy, dx) + this._facingOffset;
      }
      w.quaternion.setFromAxisAngle(UP, inst.facing || 0).multiply(ZUP_TO_YUP);

      // Decay/stale fade.
      const a = unit.decayLevel != null ? unit.decayLevel : 1;
      const transparent = a < 0.999;
      for (const sm of inst.skinnedMeshes) {
        if (!sm.material) continue;
        sm.material.transparent = transparent;
        sm.material.opacity = a;
        sm.material.depthWrite = !transparent;
      }
    }

    dispose () {
      for (const k in this.instances) {
        const inst = this.instances[k];
        if (inst && inst.root) this.scene.remove(inst.root);
      }
      this.instances = {};
    }
  }

  window.UnitModelRenderer = UnitModelRenderer;
})();
