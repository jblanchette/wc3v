/**
 * BuildingStatusFx — what is HAPPENING to a building, drawn above it.
 *
 * Two markers, both billboarded sprites over the building's centre:
 *
 *   UNDER ATTACK — someone is hitting it right now. Read live off UnitBehavior:
 *                  any actor whose resolved attack target is this building.
 *   BEING REPAIRED — a worker was ordered to repair it recently.
 *
 * Why a marker at all: a replay records no hit points, so there is no health bar
 * to drain and no damage number to float. Without something, an army razing a
 * town hall looks identical to an army standing next to one — the units swing
 * (see UnitBehavior, which had to be fixed before any of this could fire) but
 * nothing acknowledges the building is taking it. The marker is the smallest
 * honest signal: it says "this is being attacked", which the replay does support,
 * and says nothing about how much damage, which it does not.
 *
 * Repair is order-driven, not state-driven: a repair order lights the marker for
 * a fixed window (see REPAIR_WINDOW_MS). WC3 repairs until the building is full
 * or the worker is re-tasked, and the replay records neither, so a start/end
 * window would be a guess presented as data.
 *
 * Deliberately NOT a health bar and not a glow. Construction progress already
 * owns the bar slot above buildings (BuildingProgressBar), and a pulsing
 * coloured light over every contested structure is exactly the neon the rest of
 * this viewer avoids. These are carved-plaque glyphs: dark slate, bronze mark.
 */
(function () {
  const SPRITE_WU = 150;        // marker size in world units
  const Y_OFFSET = 330;         // above the construction progress bar's 260
  const REPAIR_WINDOW_MS = 6000; // how long one repair order lights the marker
  const TEX_PX = 128;

  // Muted, earthy, no saturated primaries — see the WC3 art direction the rest
  // of the viewer follows.
  const PLAQUE = 'rgba(18, 16, 14, 0.88)';
  const PLAQUE_EDGE = 'rgba(0, 0, 0, 0.95)';
  const PLAQUE_RIM = 'rgba(214, 198, 168, 0.55)';
  const MARK_ATTACK = '#d8b46a';   // warm bronze
  const MARK_REPAIR = '#9fc08a';   // muted moss

  // Rounded plaque both glyphs sit on, so they read against any terrain.
  function drawPlaque (ctx, s) {
    const pad = s * 0.06, r = s * 0.18;
    const x = pad, y = pad, w = s - pad * 2, h = s - pad * 2;
    const trace = (inset) => {
      const xx = x + inset, yy = y + inset;
      const ww = w - inset * 2, hh = h - inset * 2;
      const rr = Math.max(1, r - inset);
      ctx.beginPath();
      ctx.moveTo(xx + rr, yy);
      ctx.lineTo(xx + ww - rr, yy);
      ctx.quadraticCurveTo(xx + ww, yy, xx + ww, yy + rr);
      ctx.lineTo(xx + ww, yy + hh - rr);
      ctx.quadraticCurveTo(xx + ww, yy + hh, xx + ww - rr, yy + hh);
      ctx.lineTo(xx + rr, yy + hh);
      ctx.quadraticCurveTo(xx, yy + hh, xx, yy + hh - rr);
      ctx.lineTo(xx, yy + rr);
      ctx.quadraticCurveTo(xx, yy, xx + rr, yy);
      ctx.closePath();
    };
    trace(0);
    ctx.fillStyle = PLAQUE;
    ctx.fill();
    ctx.strokeStyle = PLAQUE_EDGE;
    ctx.lineWidth = s * 0.055;
    ctx.stroke();
    trace(s * 0.045);
    ctx.strokeStyle = PLAQUE_RIM;
    ctx.lineWidth = s * 0.02;
    ctx.stroke();
  }

  // One sword: blade + crossguard + grip, drawn pointing up from the origin.
  function drawSword (ctx, s, color) {
    const bladeW = s * 0.10, bladeL = s * 0.42;
    ctx.fillStyle = color;
    // blade
    ctx.beginPath();
    ctx.moveTo(-bladeW / 2, -bladeL * 0.55);
    ctx.lineTo(bladeW / 2, -bladeL * 0.55);
    ctx.lineTo(bladeW / 2, bladeL * 0.30);
    ctx.lineTo(0, bladeL * 0.46);          // point
    ctx.lineTo(-bladeW / 2, bladeL * 0.30);
    ctx.closePath();
    ctx.fill();
    // crossguard
    ctx.fillRect(-s * 0.15, -bladeL * 0.62, s * 0.30, s * 0.055);
    // grip
    ctx.fillRect(-bladeW * 0.34, -bladeL * 0.86, bladeW * 0.68, bladeL * 0.26);
  }

  function makeAttackTexture () {
    const c = document.createElement('canvas');
    c.width = c.height = TEX_PX;
    const ctx = c.getContext('2d');
    drawPlaque(ctx, TEX_PX);
    ctx.save();
    ctx.translate(TEX_PX / 2, TEX_PX / 2);
    ctx.rotate(Math.PI * 0.22);
    drawSword(ctx, TEX_PX, MARK_ATTACK);
    ctx.rotate(-Math.PI * 0.44);
    drawSword(ctx, TEX_PX, MARK_ATTACK);
    ctx.restore();
    return new THREE.CanvasTexture(c);
  }

  function makeRepairTexture () {
    const c = document.createElement('canvas');
    c.width = c.height = TEX_PX;
    const ctx = c.getContext('2d');
    const s = TEX_PX;
    drawPlaque(ctx, s);
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate(-Math.PI * 0.20);
    ctx.fillStyle = MARK_REPAIR;
    // hammer: handle then head, the plainest "work being done" mark that stays
    // legible once the sprite is a few dozen pixels tall.
    ctx.fillRect(-s * 0.045, -s * 0.06, s * 0.09, s * 0.40);
    ctx.fillRect(-s * 0.22, -s * 0.24, s * 0.44, s * 0.17);
    ctx.fillStyle = PLAQUE;
    ctx.fillRect(-s * 0.055, -s * 0.215, s * 0.11, s * 0.115);  // carved notch
    ctx.restore();
    return new THREE.CanvasTexture(c);
  }

  class BuildingStatusFx {
    constructor (threeRenderer, viewer) {
      this.threeRenderer = threeRenderer;
      this.viewer = viewer;
      this._marks = [];
      this._attackTex = null;
      this._repairTex = null;
      this._enabled = true;
    }

    setup (playerBuildings) {
      this.dispose();
      if (!playerBuildings || !playerBuildings.length) return;
      if (typeof THREE === 'undefined' || !this.threeRenderer || !this.threeRenderer.scene) return;

      this._attackTex = makeAttackTexture();
      this._repairTex = makeRepairTexture();

      const ext = this.threeRenderer.mapInfo.bounds.map;
      const cx = (ext[0][0] + ext[0][1]) / 2;
      const cy = (ext[1][0] + ext[1][1]) / 2;

      for (const b of playerBuildings) {
        const unit = b.unit;
        if (!unit || !unit.uuid) continue;
        const repairs = unit.repairOrderTimes;
        // Only pay for a sprite pair where one could actually show. Every
        // building can be attacked, so the attack sprite is always built; the
        // repair sprite only exists for buildings the replay saw repaired.
        const groundY = this.threeRenderer.sampleHeight(b.wx, b.wy);
        const pos = new THREE.Vector3(b.wx - cx, groundY + Y_OFFSET, -(b.wy - cy));

        const mark = {
          uuid: unit.uuid,
          readyTime: b.readyTime,
          destroyedAt: b.destroyedAt,
          repairs: (repairs && repairs.length) ? repairs : null,
          attack: this._makeSprite(this._attackTex, pos),
          repair: null
        };
        if (mark.repairs) mark.repair = this._makeSprite(this._repairTex, pos);
        this._marks.push(mark);
      }
    }

    _makeSprite (tex, pos) {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false, opacity: 0.95
      });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(SPRITE_WU, SPRITE_WU, 1);
      sp.position.copy(pos);
      sp.renderOrder = 1001;   // above the construction bar stack (997–1000)
      sp.visible = false;
      this.threeRenderer.scene.add(sp);
      return sp;
    }

    setEnabled (on) {
      this._enabled = !!on;
      if (!this._enabled) this._hideAll();
    }

    _hideAll () {
      let changed = false;
      for (const m of this._marks) {
        if (m.attack && m.attack.visible) { m.attack.visible = false; changed = true; }
        if (m.repair && m.repair.visible) { m.repair.visible = false; changed = true; }
      }
      if (changed && this.threeRenderer) this.threeRenderer.requestRender();
    }

    /** Building uuids that something is currently resolved to be attacking. */
    _underAttackSet (gameTime) {
      const world = this.viewer && this.viewer.behaviorWorld;
      if (!world) return null;
      // resolve() is memoized on gameTime, so this is the same frame the unit
      // renderer already asked for — no second pass over the world.
      const frame = world.resolve(gameTime);
      if (!frame) return null;
      const set = new Set();
      for (const [, d] of frame.byUuid) {
        if (d.state === 'attack' && d.targetUuid) set.add(d.targetUuid);
      }
      return set;
    }

    update (gameTime) {
      if (!this._enabled || !this._marks.length) return;
      const attacked = this._underAttackSet(gameTime);
      let changed = false;

      // One shared pulse so every marker breathes together rather than each
      // starting its own phase — a field of independently blinking icons reads
      // as noise. Slow, and on opacity only; nothing scales or glows.
      const pulse = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(gameTime * 0.006));

      for (const m of this._marks) {
        const alive = gameTime >= m.readyTime &&
          (m.destroyedAt == null || gameTime < m.destroyedAt);

        const showAttack = alive && !!attacked && attacked.has(m.uuid);
        if (m.attack.visible !== showAttack) { m.attack.visible = showAttack; changed = true; }
        if (showAttack) m.attack.material.opacity = pulse;

        if (m.repair) {
          const showRepair = alive && !showAttack && this._repairing(m, gameTime);
          if (m.repair.visible !== showRepair) { m.repair.visible = showRepair; changed = true; }
          if (showRepair) m.repair.material.opacity = pulse;
        }
      }

      if (changed) this.threeRenderer.requestRender();
    }

    // Was a repair ordered on this building within the last window? Linear scan:
    // repairOrderTimes is deduped at 1s upstream, so it is a handful of entries
    // even for a building someone kept alive all game.
    _repairing (m, gameTime) {
      const times = m.repairs;
      for (let i = times.length - 1; i >= 0; i--) {
        const dt = gameTime - times[i];
        if (dt < 0) continue;
        return dt <= REPAIR_WINDOW_MS;   // sorted; anything earlier is further away
      }
      return false;
    }

    dispose () {
      for (const m of this._marks) {
        for (const sp of [m.attack, m.repair]) {
          if (!sp) continue;
          this.threeRenderer.scene.remove(sp);
          if (sp.material) sp.material.dispose();
        }
      }
      this._marks = [];
      if (this._attackTex) { this._attackTex.dispose(); this._attackTex = null; }
      if (this._repairTex) { this._repairTex.dispose(); this._repairTex = null; }
    }
  }

  window.BuildingStatusFx = BuildingStatusFx;
})();
