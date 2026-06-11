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
  const ILLUSION_RING = 0x33e1ff;    // cyan ring for Mirror Image illusions
  const ILLUSION_OPACITY = 0.55;     // illusions render ghostly/translucent
  const HIDDEN_OPACITY = 0.4;        // shadowmeld / hidden units render faint
  const CREEP_RING = 0xb8893a;          // muted bronze ring for an untouched neutral camp
  const CREEP_DISTURBED_OPACITY = 0.7;  // an engaged (not-yet-cleared) camp dims slightly
  const CREEP_MOVE_EPS2 = 4;            // (wu over ~100ms)^2 to count a creep as walking
  const CREEP_AGGRO_RANGE = 500;        // a hero/combat unit within (camp radius + this) wakes the camp
  const CREEP_MARKER_SIZE = 72;         // world-unit size of the floating "?" uncertainty badge
  const CREEP_MARKER_Y = 170;           // world-unit height of the badge above the camp
  const CLAIM_CLEARED = 2;              // NeutralGroup ClaimStates.cleared

  // Worker harvest declutter + ambient gather-loop. Mirrors the 2D worker
  // visibility gate (ClientUnit._isWorkerRelevant) and surfaces ONE representative
  // gold + lumber looper per player doing a synthetic resource↔drop-off trip; the
  // rest of the harvesting workforce stays hidden (uncertain workers always hide).
  const WORKER_BASE_RADIUS = 2000;          // world units from a base anchor (matches ClientUnit)
  const WORKER_COMBAT_VISIBLE_MS = 12 * 1000;
  const LOOP_DWELL_MS = 650;                // pause at each end (mining / dropping off)
  const LOOP_MIN_DIST = 192;                // below this a loop is pointless — render parked
  // Lumber drop-offs beyond the town halls (halls accept both resources for every
  // race). Human Lumber Mill + Undead Graveyard; Orc/NE return lumber to the hall.
  const LUMBER_DROPOFF_IDS = new Set(['hlum', 'ugrv']);

  // Shared flat selection-ring geometry (radius 1, laid on the ground per instance).
  let RING_GEO = null;
  function ringGeo () { if (!RING_GEO) RING_GEO = new THREE.RingGeometry(0.82, 1.0, 32); return RING_GEO; }

  // Shared sphere geometry for the no-model placeholder blob.
  let BLOB_GEO = null;
  function blobGeo () { if (!BLOB_GEO) BLOB_GEO = new THREE.SphereGeometry(1, 14, 12); return BLOB_GEO; }

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
      // Stash for _updateCreeps (it doesn't receive viewOptions) — drop the
      // per-creep ground rings during the guide creep tour. Per-frame, scrub-safe.
      this._suppressCreepRings = !!(viewOptions && viewOptions.suppressCreepRings);
      if (!on || !this.manifest) {
        // Undo any active guide glow so it can't stick when 3D models are
        // re-enabled (the unit then renders as a 2D icon meanwhile). Keep
        // this._hlUuids intact so the glow re-applies on the next 3D frame.
        if (this._hlUuids) {
          for (const id of this._hlUuids) this._restoreHighlight(this.instances[id] || this.creepInstances[id]);
        }
        for (const k in this.instances) { const inst = this.instances[k]; if (inst && inst.root) { inst.root.visible = false; if (inst.ring) inst.ring.visible = false; } }
        for (const k in this.creepInstances) { const inst = this.creepInstances[k]; if (inst && inst.root) { inst.root.visible = false; if (inst.ring) inst.ring.visible = false; } }
        for (const k in this.campMarkers) { const m = this.campMarkers[k]; if (m && m.sprite) m.sprite.visible = false; }
        return;
      }

      let cx = 0, cy = 0;
      const mi = this.renderer.mapInfo;
      if (mi && mi.bounds && mi.bounds.map) { const e = mi.bounds.map; cx = (e[0][0] + e[0][1]) / 2; cy = (e[1][0] + e[1][1]) / 2; }

      const battleSet = this._activeBattleUuids(gameTime);
      const engagedCamps = this._engagedCampFootprints(gameTime); // camps with a live fight
      const alive = new Set();
      const campCreeps = [];   // neutral camp creeps — rendered only by _updateCreeps
      const attackers = [];    // live hero/combat positions — gate the camps' attack anim
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

          // Death lifecycle: render through the death clip + corpse fade, then drop.
          const deathStart = this._deathStart(unit);

          const itemId = (unit.itemId || '').toLowerCase();
          const spec = this.manifest[itemId] || this.manifest[unit.itemId];
          const hasModel = !!(spec && spec.model);

          const pos = unit.getInterpolatedPosition(gameTime);
          if (!pos) continue;

          // A living hero/combat unit physically present near a camp is what makes
          // its creeps fight; collect them so _updateCreeps can stop the attack
          // animation the moment the army leaves. (Pure function of gameTime.)
          if (!player.isNeutralPlayer && !unit.isIllusion && !(unit.meta && unit.meta.worker)
              && (deathStart == null || gameTime < deathStart)) {
            attackers.push(pos);
            // Standing inside an engaged (not-yet-cleared) creep camp counts as
            // fighting it, so the unit plays its attack animation even when no
            // formal PvP battle was detected (a lone hero pulling a small camp,
            // militia grinding a gold-mine creep, etc.).
            if (!battleSet.has(unit.uuid)) {
              for (const f of engagedCamps) {
                const fdx = pos.x - f.cx, fdy = pos.y - f.cy;
                if (fdx * fdx + fdy * fdy <= f.r2) { battleSet.add(unit.uuid); break; }
              }
            }
          }

          let inst = this.instances[unit.uuid];
          if (inst === undefined) {
            if (count >= this.maxUnits) continue;
            // No 3D model (water elementals, etc.) → a minimal team-colored blob so
            // nothing renders as a 2D icon. Otherwise instantiate the skinned model.
            if (hasModel) this._create(unit, spec, player);
            else this.instances[unit.uuid] = this._createPlaceholder(unit, player);
            inst = this.instances[unit.uuid];
          }
          count++;
          if (!inst || !inst.root) continue; // pending/failed → 2D meanwhile

          // Drop the unit once the death clip + corpse fade has fully elapsed.
          if (deathStart != null) {
            const total = inst.deathDur * 1000 + CORPSE_FADE_MS;
            if (gameTime >= deathStart + total) { inst.root.visible = false; if (inst.ring) inst.ring.visible = false; continue; }
          }

          // Worker declutter + ambient harvest loop (3D). Skipped while a unit is
          // in its death window (let the death clip play). A 'hidden' worker is
          // NOT added to rendered3D, so the 2D path owns it — and the 2D path also
          // declutters harvesting workers, so it stays hidden in both views.
          let loopAnchors = null;
          const inDeath = deathStart != null && gameTime >= deathStart;
          if (!inDeath && unit._isHarvester && unit._isHarvester()) {
            const treat = this._workerTreatment(unit, pos, player, gameTime, battleSet, harvestReps);
            if (treat === 'hidden') {
              inst.root.visible = false;
              if (inst.ring) inst.ring.visible = false;
              continue;
            }
            if (treat === 'loop') loopAnchors = this._loopAnchors(inst, unit, pos, gameTime, player);
          }

          if (loopAnchors) {
            this._placeLoop(inst, unit, loopAnchors, gameTime, dt, cx, cy);
          } else {
            this._place(inst, unit, pos, gameTime, cx, cy);
            this._animate(inst, unit, pos, gameTime, dt, deathStart, battleSet);
          }
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

      this._updateCreeps(gameTime, cx, cy, dt, campCreeps, attackers);

      // Guide-mode focus glow (runs last so it wins over per-unit ring state).
      this._updateGuideHighlight();
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
    _updateCreeps (gameTime, cx, cy, dt, campCreeps, attackers) {
      const ng = this.viewer && this.viewer.mapData && this.viewer.mapData.world && this.viewer.mapData.world.neutralGroups;
      if (!ng || !this.manifest || !campCreeps || !campCreeps.length) return;

      const campState = {}; // per-camp (computed once/frame): geometry, presence, phase

      for (const unit of campCreeps) {
        const campId = unit.neutralGroupId;
        const camp = ng[campId];
        if (!camp) continue;

        let cs = campState[campId];
        if (!cs) {
          const geom = this._campGeom(camp);

          // lifecycle phase — see _campPhase (pristine → disturbed → cleared).
          const phase = this._campPhase(camp, gameTime);

          // nearest live attacker within the camp's aggro footprint (skip once
          // the camp is presumed cleared — those creeps are ghosts, not fighters)
          let attacker = null;
          if (phase !== 'cleared') {
            const aggro = geom.radius + CREEP_AGGRO_RANGE;
            const aggro2 = aggro * aggro;
            let bestD2 = aggro2;
            for (const a of attackers) {
              const adx = a.x - geom.cx, ady = a.y - geom.cy;
              const d2 = adx * adx + ady * ady;
              if (d2 <= bestD2) { bestD2 = d2; attacker = a; }
            }
          }
          cs = campState[campId] = { geom, phase, attacker };

          // One floating badge per camp (not per creep):
          //   • engaged (crossed swords) while an army is actively fighting here,
          //   • "?" (amber) for a disturbed-but-quiet camp of unknown state,
          //   • "?" (slate) for an inferred clear — but NOT a settlement-confirmed
          //     clear, where the building itself is the marker and nothing is unsure.
          let markerType = null;
          if (phase === 'cleared') markerType = camp.settledClear ? null : 'cleared';
          else if (phase === 'disturbed') markerType = attacker ? 'engaged' : 'disturbed';
          this._setCampMarker(campId, markerType, geom, cx, cy, gameTime);
        }

        const key = unit.uuid;
        let inst = this.creepInstances[key];
        if (inst === undefined) { this._createCreep(key, unit, cs.geom); inst = this.creepInstances[key]; }
        if (!inst || !inst.root) continue;
        this.rendered3DUuids.add(key); // we own this creep in 3D — suppress its 2D icon (cleared too)

        // Cleared camp → the creeps are dead. Remove their models entirely (a
        // building may now stand where they were); the camp badge marks the spot.
        if (cs.phase === 'cleared') {
          inst.root.visible = false;
          if (inst.ring) inst.ring.visible = false;
          continue;
        }

        const pos = unit.getInterpolatedPosition(gameTime) ||
          (unit.spawnPosition ? { x: unit.spawnPosition.x, y: unit.spawnPosition.y } : { x: cs.geom.cx, y: cs.geom.cy });
        const back = unit.getInterpolatedPosition(gameTime - 100);
        let moving = false, mvFacing = inst.facing0 || 0;
        if (back) {
          const dx = pos.x - back.x, dy = pos.y - back.y;
          moving = (dx * dx + dy * dy) > CREEP_MOVE_EPS2;
          if (moving) mvFacing = Math.atan2(dy, dx);
        }

        const fighting = !!cs.attacker; // already gated to non-cleared camps above

        let facing;
        if (moving) facing = mvFacing;                                              // along its own travel
        else if (fighting) facing = Math.atan2(cs.attacker.y - pos.y, cs.attacker.x - pos.x); // turn to the attacker
        else facing = inst.facing0 || 0;                                            // idle: guard outward

        let state;
        if (moving) state = 'walk';
        else if (fighting && inst.actions.attack) state = 'attack';
        else state = 'idle';

        const opacity = (cs.phase === 'disturbed') ? CREEP_DISTURBED_OPACITY : 1;
        this._placeCreep(inst, pos.x, pos.y, facing, cx, cy);
        this._setCreepRing(inst, CREEP_RING);
        this._animateCreepState(inst, dt, state);
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

    // Footprints of camps currently being fought in (disturbed phase). A combat
    // unit standing inside one is treated as engaging the creeps so it plays its
    // attack animation even without a formally detected player-vs-player battle.
    _engagedCampFootprints (gameTime) {
      const ng = this.viewer && this.viewer.mapData && this.viewer.mapData.world && this.viewer.mapData.world.neutralGroups;
      const out = [];
      if (!ng) return out;
      for (const id in ng) {
        const camp = ng[id];
        if (!camp || this._campPhase(camp, gameTime) !== 'disturbed') continue;
        const geom = this._campGeom(camp);
        const r = geom.radius + CREEP_AGGRO_RANGE;
        out.push({ cx: geom.cx, cy: geom.cy, r2: r * r });
      }
      return out;
    }

    // Camp centre + a radius covering its footprint (cached — creeps are static).
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
          isCreep: true, facing0, ringRadius: cs * 1.35, ringHex: null
        };
        this._setupMixer(inst, r.animations);
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
    _animateCreepState (inst, dt, state) {
      if (!inst.mixer) return;
      if (inst.state === 'death') inst.state = null;
      this._setLoopState(inst, state);
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
      const w = inst.wrapper;
      w.position.set(wx - cx, groundY, -(wy - cy));
      if (inst.scale !== 1) w.scale.setScalar(inst.scale);
      if (inst.ring) {
        inst.ring.position.set(wx - cx, groundY + 2, -(wy - cy));
        inst.ring.scale.set(inst.ringRadius, inst.ringRadius, inst.ringRadius);
      }
      w.quaternion.setFromAxisAngle(UP, (facing || 0) + this._facingOffset).multiply(ZUP_TO_YUP);
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
      root.traverse(o => {
        if (o.isSkinnedMesh) {
          o.material = o.material.clone();   // shares the texture map, own opacity
          o.bind(skeleton, new THREE.Matrix4());
          o.frustumCulled = false;
          skinnedMeshes.push(o);
        }
      });
      let placementNode = null;
      const wname = tpl.placementNode && tpl.placementNode.name;
      root.traverse(o => { if (!placementNode && o.name === wname) placementNode = o; });
      return { isSkinnedResult: true, root, placementNode, skinnedMeshes, animations: tpl.animations, skeleton };
    }

    _create (unit, spec, player) {
      const uuid = unit.uuid;
      this.instances[uuid] = 'pending';
      this._getTemplate(spec.model).then(tpl => {
        if (this.instances[uuid] !== 'pending') return; // seeked/removed while loading
        if (!tpl) { this.instances[uuid] = 'failed'; return; }
        this.instances[uuid] = this._buildInstance(this._cloneSkinned(tpl), unit, spec, player);
        if (this.viewer && this.viewer.requestRender) this.viewer.requestRender();
      }).catch(() => { this.instances[uuid] = 'failed'; });
    }

    _buildInstance (r, unit, spec, player) {
      const inst = {
        root: r.root, wrapper: r.placementNode, skinnedMeshes: r.skinnedMeshes || [],
        mixer: null, actions: {}, state: null, deathDur: 1, scale: spec.scale || 1
      };
      this._setupMixer(inst, r.animations);
      // Team/hero ground selection ring (player color, gold for heroes; flat, does
      // not rotate with the unit; lives in the scene, not the facing wrapper).
      const isHero = !!(unit.meta && unit.meta.hero);
      const cs = unit.collisionSize || (isHero ? 32 : (unit.meta && unit.meta.worker ? 16 : 24));
      inst.isHero = isHero;
      inst.isIllusion = !!unit.isIllusion;
      inst.ringRadius = cs * (isHero ? 1.7 : 1.35);
      const ringColor = inst.isIllusion ? ILLUSION_RING : (isHero ? HERO_RING : (player.playerColor || '#ffffff'));
      this._addRing(inst, ringColor, 0.85);
      inst.root.visible = false;
      this.scene.add(inst.root);
      return inst;
    }

    // Build the AnimationMixer + per-category actions; start idle (desynced).
    _setupMixer (inst, animations) {
      if (!animations || !animations.length) return;
      inst.mixer = new THREE.AnimationMixer(inst.root);
      const byName = {}; for (const c of animations) byName[c.name] = c;
      for (const cat of CATS) if (byName[cat]) inst.actions[cat] = inst.mixer.clipAction(byName[cat]);
      inst.deathDur = (byName.death && byName.death.duration) || 1;
      const start = inst.actions.idle || inst.actions.walk || inst.actions.attack;
      if (start) { start.play(); start.time = Math.random() * (start.getClip().duration || 1); inst.state = start === inst.actions.idle ? 'idle' : (start === inst.actions.walk ? 'walk' : 'attack'); }
    }

    // Flat ground ring added to the scene (not the facing wrapper).
    _addRing (inst, colorHex, opacity) {
      inst.ring = new THREE.Mesh(ringGeo(), new THREE.MeshBasicMaterial({
        color: new THREE.Color(colorHex), transparent: true, opacity: opacity, depthWrite: false, side: THREE.DoubleSide
      }));
      inst.ring.rotation.x = -Math.PI / 2;
      inst.ring.renderOrder = 3;
      inst.ring.visible = false;
      this.scene.add(inst.ring);
    }

    // Minimal placeholder for units with no exported 3D model (water elementals,
    // utom): a translucent team-colored blob + ground ring, so nothing falls back
    // to a flat 2D icon. No skeleton/animation; flagged isPlaceholder.
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

      const ring = new THREE.Mesh(ringGeo(), new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 3;
      ring.visible = false;
      this.scene.add(ring);

      root.visible = false;
      this.scene.add(root);
      return {
        root, wrapper, ring, skinnedMeshes: [blob], mixer: null, actions: {}, state: null,
        deathDur: 1, scale: 1, isPlaceholder: true, ringRadius: cs * 1.35, isHero, isIllusion
      };
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
          for (const k of ['idle', 'walk', 'attack']) { const a = inst.actions[k]; if (a) a.stop(); }
          d.reset(); d.setLoop(THREE.LoopOnce, 1); d.clampWhenFinished = true; d.enabled = true; d.setEffectiveWeight(1); d.play();
          inst.state = 'death';
        }
        d.paused = true;
        d.time = Math.min(ageS, inst.deathDur);
        inst.mixer.update(0); // apply the seeked death pose without advancing
      }
      return (ageS > inst.deathDur) ? Math.max(0, 1 - (ageS - inst.deathDur) * 1000 / CORPSE_FADE_MS) : 1;
    }

    _animate (inst, unit, pos, gameTime, dt, deathStart, battleSet) {
      if (!inst.mixer) return;

      // --- DEATH: one-shot, seek-safe via manual clip time ---
      if (deathStart != null && gameTime >= deathStart) {
        this._setOpacity(inst, this._applyDeath(inst, (gameTime - deathStart) / 1000));
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

      // decay/stale fade for living units, plus illusion (ghostly) + hidden (faint).
      let op = unit.decayLevel != null ? unit.decayLevel : 1;
      if (inst.isIllusion) op *= ILLUSION_OPACITY;
      if (unit._isHiddenNow) op *= HIDDEN_OPACITY;
      this._setOpacity(inst, op);
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

      // The placeholder blob is authored Y-up and rotationally symmetric — skip the
      // model facing rotation (it would tip the blob over via ZUP_TO_YUP).
      if (inst.isPlaceholder) return;

      // Facing: prefer the baked turn-rate facing (world space); fall back to a
      // velocity estimate for replays parsed before facing existed. Scene yaw is
      // +worldFacing (scene Z = -worldY).
      let wf = unit.getInterpolatedFacing ? unit.getInterpolatedFacing(gameTime) : null;
      if (wf == null) {
        const ahead = unit.getInterpolatedPosition(gameTime + 120);
        if (ahead) { const dx = ahead.x - wx, dy = ahead.y - wy; if (dx * dx + dy * dy > 1) inst._wf = Math.atan2(dy, dx); }
        wf = inst._wf || 0;
      } else { inst._wf = wf; }
      // Model forward = +X = world facing 0; scene yaw = +worldFacing (calibrated
      // via test-unit.html, see ZUP_TO_YUP + Ry(+wf)).
      w.quaternion.setFromAxisAngle(UP, wf + this._facingOffset).multiply(ZUP_TO_YUP);
    }

    // Place an instance at an explicit world position + facing. Used by the
    // synthetic harvest loop, which overrides the unit's real path position.
    _placeAt (inst, wx, wy, faceAng, cx, cy) {
      const groundY = this.renderer.sampleHeight ? this.renderer.sampleHeight(wx, wy) : 0;
      const w = inst.wrapper;
      w.position.set(wx - cx, groundY, -(wy - cy));
      if (inst.scale !== 1) w.scale.setScalar(inst.scale);
      if (inst.ring) {
        inst.ring.position.set(wx - cx, groundY + 2, -(wy - cy));
        inst.ring.scale.set(inst.ringRadius, inst.ringRadius, inst.ringRadius);
      }
      if (inst.isPlaceholder) return;
      inst._wf = faceAng;
      w.quaternion.setFromAxisAngle(UP, faceAng + this._facingOffset).multiply(ZUP_TO_YUP);
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
      if (!rec) rec = this._reps[pid] = { gold: null, lumber: null };
      for (const role of ['gold', 'lumber']) {
        const cur = rec[role] ? player.units.find(u => u.uuid === rec[role]) : null;
        if (cur && this._isLiveLooper(cur, role, gameTime)) continue;
        rec[role] = this._pickLooper(player, role, gameTime);
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
    // when it dies / changes role.
    _pickLooper (player, role, gameTime) {
      const anchors = player.getBaseAnchors ? player.getBaseAnchors() : null;
      let fallback = null;
      for (const u of player.units) {
        if (!this._isLiveLooper(u, role, gameTime)) continue;
        if (!fallback) fallback = u;
        if (anchors && anchors.length) {
          const p = u.getInterpolatedPosition(gameTime);
          if (p && this._withinBase(p, anchors)) return u.uuid;   // home harvester — prefer it
        }
      }
      return fallback ? fallback.uuid : null;
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
        this._setLoopState(inst, 'idle');
        if (inst.mixer) inst.mixer.update(dt);
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
      this._setLoopState(inst, moving ? 'walk' : 'idle');
      if (inst.mixer) inst.mixer.update(dt);
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
          if (inst && inst.ring) this.scene.remove(inst.ring);
          if (inst && inst.marker) this.scene.remove(inst.marker);
        }
      }
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

  window.UnitModelRenderer = UnitModelRenderer;
})();
