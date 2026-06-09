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
 *   walk   — interpolated position is moving.
 *   attack — unit is a participant in an active detected battle and stationary
 *            (inference; no per-unit attack timing exists in replays).
 *   idle   — otherwise.
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
  const FADE = 0.22;                 // cross-fade seconds between looping states
  const MOVE_EPS2 = 9;               // (wu over ~100ms)^2 to count as walking
  const CORPSE_FADE_MS = 1400;       // fade after the death clip finishes, then hide
  const HERO_RING = 0xffd24a;        // gold ring for heroes (else player color)

  // Shared flat selection-ring geometry (radius 1, laid on the ground per instance).
  let RING_GEO = null;
  function ringGeo () { if (!RING_GEO) RING_GEO = new THREE.RingGeometry(0.82, 1.0, 32); return RING_GEO; }

  class UnitModelRenderer {
    constructor (threeMapRenderer, viewer) {
      this.renderer = threeMapRenderer;
      this.scene = threeMapRenderer.scene;
      this.viewer = viewer;
      this.manifest = null;
      this._abCache = {};
      this.instances = {};           // unit.uuid -> instance | 'pending' | 'failed'
      this.rendered3DUuids = new Set();
      this.clock = new THREE.Clock();
      this.maxUnits = 80;
      this._loader = new window.GLBLoader();
      this._facingOffset = 0;        // model-forward calibration
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

    // uuids that are in an active detected battle at gameTime (for attack inference).
    _activeBattleUuids (gameTime) {
      const set = new Set();
      const battles = this.viewer && this.viewer.mapData && this.viewer.mapData.battles;
      if (!battles) return set;
      for (const b of battles) {
        if (gameTime < b.startTime || gameTime > b.endTime || !b.participants) continue;
        for (const p of b.participants) {
          const us = p.unitUuids || [];
          for (let i = 0; i < us.length; i++) set.add(us[i]);
        }
      }
      return set;
    }

    _deathStart (unit) {
      if (unit.destroyedAt != null) return unit.destroyedAt;
      if (unit.lostState && unit.lostState.state === 'lost') return unit.lostState.since;
      return null;
    }

    // Called once per frame from app.render().
    update (gameTime, players, viewOptions) {
      const dt = this.clock.getDelta();
      this.rendered3DUuids.clear();
      if (viewOptions) viewOptions._rendered3D = this.rendered3DUuids;

      const on = viewOptions && viewOptions.display3DUnits;
      if (!on || !this.manifest) {
        for (const k in this.instances) { const inst = this.instances[k]; if (inst && inst.root) { inst.root.visible = false; if (inst.ring) inst.ring.visible = false; } }
        return;
      }

      let cx = 0, cy = 0;
      const mi = this.renderer.mapInfo;
      if (mi && mi.bounds && mi.bounds.map) { const e = mi.bounds.map; cx = (e[0][0] + e[0][1]) / 2; cy = (e[1][0] + e[1][1]) / 2; }

      const battleSet = this._activeBattleUuids(gameTime);
      const alive = new Set();
      let count = 0;
      for (const player of players) {
        const units = player.units || [];
        for (const unit of units) {
          if (unit.isBuilding) continue;
          const ready = unit.readyTime != null ? unit.readyTime : unit.spawnTime;
          if (ready != null && gameTime < ready) continue;
          if (unit._isLoadedAt && unit._isLoadedAt(gameTime)) continue;

          // Death lifecycle: render through the death clip + corpse fade, then drop.
          const deathStart = this._deathStart(unit);

          const itemId = (unit.itemId || '').toLowerCase();
          const spec = this.manifest[itemId] || this.manifest[unit.itemId];
          if (!spec || !spec.model) continue; // no 3D model → 2D fallback

          const pos = unit.getInterpolatedPosition(gameTime);
          if (!pos) continue;

          let inst = this.instances[unit.uuid];
          if (inst === undefined) {
            if (count >= this.maxUnits) continue;
            this._create(unit, spec, player);
            inst = this.instances[unit.uuid];
          }
          count++;
          if (!inst || !inst.root) continue; // pending/failed → 2D meanwhile

          // Drop the unit once the death clip + corpse fade has fully elapsed.
          if (deathStart != null) {
            const total = inst.deathDur * 1000 + CORPSE_FADE_MS;
            if (gameTime >= deathStart + total) { inst.root.visible = false; if (inst.ring) inst.ring.visible = false; continue; }
          }

          this._place(inst, unit, pos, gameTime, cx, cy);
          this._animate(inst, unit, pos, gameTime, dt, deathStart, battleSet);
          inst.root.visible = true;
          if (inst.ring) inst.ring.visible = inst.state !== 'death'; // no ring on corpses
          alive.add(unit.uuid);
          this.rendered3DUuids.add(unit.uuid);
        }
      }

      for (const k in this.instances) {
        const inst = this.instances[k];
        if (inst && inst.root && !alive.has(k)) { inst.root.visible = false; if (inst.ring) inst.ring.visible = false; }
      }
    }

    _create (unit, spec, player) {
      const uuid = unit.uuid;
      this.instances[uuid] = 'pending';
      this._fetchAB(spec.model).then(ab => {
        const res = this._loader.parse(ab.slice(0));
        const finish = (r) => {
          if (!r || !r.isSkinnedResult) { this.instances[uuid] = 'failed'; return; }
          const inst = {
            root: r.root, wrapper: r.placementNode, skinnedMeshes: r.skinnedMeshes || [],
            mixer: null, actions: {}, state: null, deathDur: 1, scale: spec.scale || 1
          };
          if (r.animations && r.animations.length) {
            inst.mixer = new THREE.AnimationMixer(r.root);
            const byName = {}; for (const c of r.animations) byName[c.name] = c;
            for (const cat of CATS) if (byName[cat]) inst.actions[cat] = inst.mixer.clipAction(byName[cat]);
            inst.deathDur = (byName.death && byName.death.duration) || 1;
            // Start in idle (or the first available looping clip), desynced.
            const start = inst.actions.idle || inst.actions.walk || inst.actions.attack;
            if (start) { start.play(); start.time = Math.random() * (start.getClip().duration || 1); inst.state = start === inst.actions.idle ? 'idle' : (start === inst.actions.walk ? 'walk' : 'attack'); }
          }
          // Team/hero ground selection ring (replaces the player-color halo + hero
          // gold ring; doesn't rotate with the unit). Lives in the scene, not the
          // facing wrapper.
          const isHero = !!(unit.meta && unit.meta.hero);
          const cs = unit.collisionSize || (isHero ? 32 : (unit.meta && unit.meta.worker ? 16 : 24));
          inst.isHero = isHero;
          inst.ringRadius = cs * (isHero ? 1.7 : 1.35);
          const ringColor = isHero ? HERO_RING : (player.playerColor || '#ffffff');
          inst.ring = new THREE.Mesh(ringGeo(), new THREE.MeshBasicMaterial({
            color: new THREE.Color(ringColor), transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide
          }));
          inst.ring.rotation.x = -Math.PI / 2;
          inst.ring.renderOrder = 3;
          inst.ring.visible = false;
          this.scene.add(inst.ring);

          inst.root.visible = false;
          this.scene.add(inst.root);
          this.instances[uuid] = inst;
          if (this.viewer && this.viewer.requestRender) this.viewer.requestRender();
        };
        if (res && res.then) res.then(finish); else finish(res);
      }).catch(() => { this.instances[uuid] = 'failed'; });
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

    _animate (inst, unit, pos, gameTime, dt, deathStart, battleSet) {
      if (!inst.mixer) return;

      // --- DEATH: one-shot, seek-safe via manual clip time ---
      if (deathStart != null && gameTime >= deathStart) {
        const d = inst.actions.death;
        const ageS = (gameTime - deathStart) / 1000;
        if (d) {
          if (inst.state !== 'death') {
            for (const k of ['idle', 'walk', 'attack']) { const a = inst.actions[k]; if (a) a.stop(); }
            d.reset(); d.setLoop(THREE.LoopOnce, 1); d.clampWhenFinished = true; d.enabled = true; d.setEffectiveWeight(1); d.play();
            inst.state = 'death';
          }
          d.paused = true;
          d.time = Math.min(ageS, inst.deathDur);
          inst.mixer.update(0); // apply the seeked death pose without advancing
        }
        // opacity: full during the death clip, then fade the corpse out
        let op = 1;
        if (ageS > inst.deathDur) op = Math.max(0, 1 - (ageS - inst.deathDur) * 1000 / CORPSE_FADE_MS);
        this._setOpacity(inst, op);
        return;
      }
      if (inst.state === 'death') inst.state = null; // scrubbed back before death

      // --- ALIVE: idle / walk / attack ---
      const back = unit.getInterpolatedPosition(gameTime - 100);
      let moving = false;
      if (back) { const dx = pos.x - back.x, dy = pos.y - back.y; moving = (dx * dx + dy * dy) > MOVE_EPS2; }
      let target = 'idle';
      if (moving) target = 'walk';
      else if (inst.actions.attack && battleSet.has(unit.uuid)) target = 'attack';
      this._setLoopState(inst, target);
      inst.mixer.update(dt);

      // decay/stale fade for living units
      this._setOpacity(inst, unit.decayLevel != null ? unit.decayLevel : 1);
    }

    _setOpacity (inst, a) {
      const transparent = a < 0.999;
      for (const sm of inst.skinnedMeshes) {
        if (!sm.material) continue;
        sm.material.transparent = transparent;
        sm.material.opacity = a;
        sm.material.depthWrite = !transparent;
      }
    }

    _place (inst, unit, pos, gameTime, cx, cy) {
      const wx = pos.x, wy = pos.y;
      const groundY = this.renderer.sampleHeight ? this.renderer.sampleHeight(wx, wy) : 0;
      const w = inst.wrapper;
      w.position.set(wx - cx, groundY, -(wy - cy));
      if (inst.scale !== 1) w.scale.setScalar(inst.scale);

      // Ground selection ring (flat, does not rotate with facing).
      if (inst.ring) {
        inst.ring.position.set(wx - cx, groundY + 2, -(wy - cy));
        inst.ring.scale.set(inst.ringRadius, inst.ringRadius, inst.ringRadius);
      }

      // Facing: prefer the baked turn-rate facing (world space); fall back to a
      // velocity estimate for replays parsed before facing existed. Scene yaw is
      // the negated world facing (scene Z = -worldY).
      let wf = unit.getInterpolatedFacing ? unit.getInterpolatedFacing(gameTime) : null;
      if (wf == null) {
        const ahead = unit.getInterpolatedPosition(gameTime + 120);
        if (ahead) { const dx = ahead.x - wx, dy = ahead.y - wy; if (dx * dx + dy * dy > 1) inst._wf = Math.atan2(dy, dx); }
        wf = inst._wf || 0;
      } else { inst._wf = wf; }
      w.quaternion.setFromAxisAngle(UP, -wf + this._facingOffset).multiply(ZUP_TO_YUP);
    }

    dispose () {
      for (const k in this.instances) {
        const inst = this.instances[k];
        if (inst && inst.root) this.scene.remove(inst.root);
        if (inst && inst.ring) this.scene.remove(inst.ring);
      }
      this.instances = {};
    }
  }

  window.UnitModelRenderer = UnitModelRenderer;
})();
