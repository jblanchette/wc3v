/**
 * EventFeed — the on-canvas half of the action-label system.
 *
 * Replaces the old FloatingText pills that floated over (and covered) the
 * units. Two coordinated pieces:
 *
 *   1. A DOM feed (#event-feed) in the right-side gutter beside the map,
 *      under the camera toolbar (anchored to #main-wrapper, not the canvas
 *      group, so it stays off the playfield). Newest
 *      high-signal event on top, older rows fade and drop off. It reuses the
 *      exact `ev-` row markup the insights log uses (EventModel.buildRowEl),
 *      so the feed and the panel are visually identical.
 *
 *   2. Compact CASTER PIPS drawn on the canvas at each event's location. A pip
 *      is a small player-colored marker — NOT a big icon — so it never buries
 *      the unit. For unit-targeted spells it draws a thin connector + arrow to
 *      the target ("who hit whom"); for AoE it draws a faint ground ring. The
 *      legible icon + text lives in the feed row, not on the map.
 *
 * Reads exclusively from a prebuilt EventModel (immutable post-parse), so
 * there is no per-frame stream scanning — just a windowed slice by gameTime.
 */

const EventFeed = class {

  constructor (viewer) {
    this.viewer = viewer;
    this.model = null;
    this.containerEl = null;

    // WALL-CLOCK timing. The feed is paced by real time, NOT game time, so a
    // card is guaranteed a minimum on-screen duration no matter how fast the
    // replay runs. (At 10x, 1.5s of game time is 150ms of wall time — far too
    // fast to read; wall pacing fixes that.)
    this.MIN_SHOW_MS = 1500;   // hard floor: shown at least this long under load
    this.LINGER_MS = 4200;     // when idle, cards linger this long before fading
    this.FADE_MS = 450;        // wall fade-out after the hold window
    this.MAX_ROWS = 6;         // concurrent cards on screen
    this._holdMs = 4200;       // current hold (adapts: shorter when backlogged)
    this.PENDING_MAX = 6;      // short smoothing buffer for bursts
    this.HIGH_SPEED = 3;       // above this we stop showing detail (user choice)
    this.HIDDEN_DECAY_MS = 1400; // how long the "+N hidden" note lingers
    this.SCRUB_JUMP_MS = 2500; // game-time jump treated as a seek (reseat, no burst)

    this.enabled = true;
    this._pipIconCache = {};

    // Engine state.
    this._cursor = 0;          // next model.events index to consider
    this._active = [];         // [{ ev, wallShown, el }]
    this._pending = [];        // queued events waiting for a slot
    this._hidden = 0;          // events suppressed (flood / speed)
    this._hiddenWall = 0;      // last time _hidden was bumped
    this._lastGameTime = 0;
    this._domSig = '';
  }

  setup () {
    this.containerEl = document.getElementById('event-feed');
  }

  setModel (model) {
    this.model = model;
    this.reset();
  }

  reset () {
    this._cursor = 0;
    this._active = [];
    this._pending = [];
    this._hidden = 0;
    this._hiddenWall = 0;
    this._lastGameTime = 0;
    this._domSig = '';
    if (this.containerEl) this.containerEl.innerHTML = '';
  }

  _now () {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }

  _speed () {
    const s = this.viewer && this.viewer.scrubber && this.viewer.scrubber.speed;
    return (typeof s === 'number' && s > 0) ? s : 1;
  }

  // Wall-clock alpha shared by the card row and its pip, so they appear and
  // disappear together. Full opacity through the current hold, then a short
  // fade. Hold shrinks to MIN_SHOW_MS when there's a backlog so the feed keeps
  // up; expands to LINGER_MS when idle so quiet moments read comfortably.
  _cardAlpha (card, now) {
    const age = now - card.wallShown;
    if (age < this._holdMs) return 1;
    return Math.max(0, 1 - (age - this._holdMs) / this.FADE_MS);
  }

  setEnabled (on) {
    this.enabled = !!on;
    if (this.containerEl) this.containerEl.classList.toggle('ev-feed-off', !this.enabled);
    if (!this.enabled) this.reset();
  }

  // ---------------------------------------------------------------------------
  // DOM feed
  // ---------------------------------------------------------------------------

  // Called every frame from the render loop. Wall-clock paced: ingest events
  // that crossed the playhead, promote them into visible slots respecting a
  // minimum show time, and surface a "+N hidden" note when bursts/high speed
  // overflow the feed.
  update (gameTime) {
    // Lazy-bind the feed container in case setup() ran before the DOM node
    // existed (defensive — removes any init-order dependency).
    if (!this.containerEl) this.containerEl = document.getElementById('event-feed');
    if (!this.enabled || !this.model || !this.containerEl) return;

    const now = this._now();
    const speed = this._speed();
    const dt = gameTime - this._lastGameTime;

    // Backward scrub OR a forward seek (jump much larger than any real per-frame
    // advance, even at 40x): reseat the cursor silently so we don't replay the
    // skipped span as a burst of "new" cards.
    if (gameTime < this._lastGameTime - 400 || dt > this.SCRUB_JUMP_MS) {
      this._reseat(gameTime);
    }
    this._lastGameTime = gameTime;

    // Ingest every onCanvas event the playhead just passed.
    const evs = this.model.events;
    while (this._cursor < evs.length && evs[this._cursor].gameTime <= gameTime) {
      const ev = evs[this._cursor++];
      if (ev.onCanvas) this._ingest(ev, speed, now);
    }

    this._expire(now);     // retire cards past the hold + fade (uses prior hold)
    this._promote(now);    // fill freed slots from the pending buffer

    // Adaptive hold for the NEXT expire + this frame's fades/pips. Only a
    // genuine backlog (slots full AND events still queued) shortens the hold —
    // measuring after promote avoids a single new event flicking the hold and
    // making cards fade/un-fade.
    this._holdMs = this._pending.length ? this.MIN_SHOW_MS : this.LINGER_MS;

    if (this._hidden > 0 && now - this._hiddenWall > this.HIDDEN_DECAY_MS) {
      this._hidden = 0;
    }

    this._syncDom(speed);
    this._applyFades(now);
  }

  // Reseat the cursor to the current playhead without showing anything.
  _reseat (gameTime) {
    const evs = this.model.events;
    let lo = 0, hi = evs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (evs[mid].gameTime <= gameTime) lo = mid + 1; else hi = mid;
    }
    this._cursor = lo;
    this._active = [];
    this._pending = [];
    this._hidden = 0;
    this._domSig = '';
    if (this.containerEl) this.containerEl.innerHTML = '';
  }

  _ingest (ev, speed, now) {
    // Above the detail cutoff the user only wants a count, not cards.
    if (speed > this.HIGH_SPEED) { this._bumpHidden(now); return; }
    if (this._pending.length >= this.PENDING_MAX) { this._bumpHidden(now); return; }
    this._pending.push(ev);
  }

  _bumpHidden (now) {
    this._hidden++;
    this._hiddenWall = now;
  }

  _promote (now) {
    while (this._active.length < this.MAX_ROWS && this._pending.length) {
      this._active.push({ ev: this._pending.shift(), wallShown: now, el: null });
    }
    // Anything still pending once the buffer can't drain fast enough is shed to
    // the hidden counter so the backlog never shows stale cards.
    while (this._pending.length > this.PENDING_MAX) {
      this._pending.shift();
      this._bumpHidden(now);
    }
  }

  _expire (now) {
    const life = this._holdMs + this.FADE_MS;
    // In-place compaction — a .filter() here built a new array every frame,
    // during playback that's 60 arrays/s for a list that changes a few times
    // a minute.
    const a = this._active;
    let w = 0;
    for (let i = 0; i < a.length; i++) {
      if ((now - a[i].wallShown) < life) a[w++] = a[i];
    }
    a.length = w;
  }

  // Rebuild DOM only when the visible set (or hidden note) changes.
  _syncDom (speed) {
    // Signature built without intermediate arrays (was slice+reverse+map+join
    // per frame just to conclude "unchanged").
    const overflow = this._hidden > 0;
    let sig = '#' + (overflow ? Math.min(this._hidden, 99) : 0) +
      '@' + (speed > this.HIGH_SPEED ? 'hi' : 'lo');
    for (let i = this._active.length - 1; i >= 0; i--) {
      sig += '|' + this._active[i].ev.id;
    }
    if (sig === this._domSig) return;
    this._domSig = sig;

    const frag = document.createDocumentFragment();
    for (let i = this._active.length - 1; i >= 0; i--) {   // newest on top
      const card = this._active[i];
      card.el = window.EventModel.buildRowEl(card.ev, { showTime: false });
      card._lastAlphaQ = undefined;   // fresh element — reapply opacity
      card.el.classList.add('ev-feed-row');
      frag.appendChild(card.el);
    }
    if (overflow) frag.appendChild(this._buildHiddenNote(speed));

    this.containerEl.innerHTML = '';
    this.containerEl.appendChild(frag);
  }

  _buildHiddenNote (speed) {
    const note = document.createElement('div');
    note.className = 'ev-feed-hidden';
    const fast = speed > this.HIGH_SPEED;
    // AUTO mode feeds a raw float (e.g. 3.4285714) — show at most one decimal,
    // and none when it's a whole number (6x, not 6.0x).
    const n = (Math.round(speed * 10) % 10 === 0) ? String(Math.round(speed)) : speed.toFixed(1);
    note.textContent = fast
      ? `+${this._hidden} events · ${n}x — slow down for detail`
      : `+${this._hidden} more this moment`;
    return note;
  }

  _applyFades (now) {
    for (const card of this._active) {
      if (!card.el) continue;
      // Quantized diff: cards sit at alpha 1.0 for their whole hold time, so
      // an unconditional style write per card per frame was pure waste (and a
      // string alloc each). Only fade transitions actually write.
      const q = Math.round(this._cardAlpha(card, now) * 100);
      if (card._lastAlphaQ === q) continue;
      card._lastAlphaQ = q;
      card.el.style.opacity = (q / 100).toFixed(2);
    }
  }

  // ---------------------------------------------------------------------------
  // Canvas pips
  // ---------------------------------------------------------------------------

  _pipIcon (id) {
    if (!id) return null;
    if (this._pipIconCache[id]) return this._pipIconCache[id];
    const img = new Image();
    img.src = '/assets/wc3icons/' + id + '.jpg';
    img._loaded = false;
    img.onload = () => { img._loaded = true; };
    this._pipIconCache[id] = img;
    return img;
  }

  // Pips mirror the FEED: one per active card, sharing its wall-clock fade. So
  // they hold for the min show time and vanish above the speed cutoff too —
  // the map never flickers faster than it's readable.
  renderPips (ctx, gameTime) {
    if (!this.enabled || !this.model || !this._active.length) return;
    const scaler = this.viewer && this.viewer.gameScaler;
    if (!scaler || typeof scaler.projectXY !== 'function') return;

    const now = this._now();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const card of this._active) {
      const e = card.ev;
      if (!e.pos) continue;
      const alpha = this._cardAlpha(card, now);
      if (alpha <= 0.02) continue;
      this._drawPip(ctx, scaler, e, alpha);
    }
    ctx.restore();
  }

  _project (scaler, pos) {
    const p = scaler.projectXY(pos.x, pos.y);
    if (!p) return null;
    return { x: p.x + scaler.middleX, y: p.y + scaler.middleY };
  }

  _drawPip (ctx, scaler, e, alpha) {
    const cp = this._project(scaler, e.pos);
    if (!cp) return;
    const color = e.playerColor || '#ddd';
    const accent = e.color || '#fff';

    // Connector / AoE ring first so the marker sits on top.
    if (e.targetPos) {
      const tp = this._project(scaler, e.targetPos);
      if (tp) {
        if (e.targeting === 'unit') {
          this._drawConnector(ctx, cp, tp, color, alpha, e.target && e.target.enemy);
        } else if (e.isAoe) {
          this._drawAoeRing(ctx, tp, accent, alpha);
        }
      }
    }

    // The marker is an ICON CHIP floating just ABOVE the caster (never on it),
    // tethered by a short leader line so it's unambiguous who acted. Small +
    // brief — the words live in the right-edge feed — but clearly visible.
    const ICON = 30;
    const PAD = 3;
    const chip = ICON + PAD * 2;            // 36px outer
    const rise = 6 * (1 - alpha);           // drift up slightly as it ages
    const anchorX = cp.x;
    const anchorY = cp.y;
    const chipCX = anchorX;
    const chipCY = anchorY - 34 - rise;     // sits above the unit
    const chipX = chipCX - chip / 2;
    const chipY = chipCY - chip / 2;

    // Leader line from chip bottom to the unit.
    ctx.globalAlpha = alpha * 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(chipCX, chipY + chip);
    ctx.lineTo(anchorX, anchorY);
    ctx.stroke();
    // Small dot at the unit anchor.
    ctx.beginPath();
    ctx.arc(anchorX, anchorY, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Chip background + player-color border (drop shadow for legibility on the
    // busy 3D map).
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = 'rgba(10,14,20,0.95)';
    this._roundRect(ctx, chipX, chipY, chip, chip, 6);
    ctx.fill();
    ctx.restore();

    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = color;
    this._roundRect(ctx, chipX, chipY, chip, chip, 6);
    ctx.stroke();

    // Icon (clipped to a rounded square). Fall back to an accent fill + glyph.
    const icon = this._pipIcon(e.icon);
    const ix = chipX + PAD, iy = chipY + PAD;
    if (icon && icon._loaded) {
      ctx.save();
      this._roundRect(ctx, ix, iy, ICON, ICON, 4);
      ctx.clip();
      ctx.globalAlpha = alpha;
      ctx.drawImage(icon, ix, iy, ICON, ICON);
      ctx.restore();
    } else {
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = accent;
      this._roundRect(ctx, ix, iy, ICON, ICON, 4);
      ctx.fill();
    }

    // Corner badge for the highest-signal moments + enemy-target casts.
    let glyph = null, badgeColor = accent;
    if (e.type === 'HeroLevel') { glyph = '✦'; badgeColor = '#FFD700'; }
    else if (e.type === 'heroRevive') { glyph = '✚'; badgeColor = '#00FF88'; }
    else if (e.type === 'tierUpgrade') { glyph = '▲'; badgeColor = '#FFFFFF'; }
    else if (e.target && e.target.enemy) { glyph = '▶'; badgeColor = '#FF6B6B'; }
    if (glyph) {
      const bx = chipX + chip - 2, by = chipY + 2;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fillStyle = badgeColor;
      ctx.fill();
      ctx.fillStyle = '#0b0e14';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, bx, by + 0.5);
    }
  }

  _roundRect (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  _drawConnector (ctx, from, to, color, alpha, enemy) {
    ctx.globalAlpha = alpha * 0.75;
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = enemy ? '#FF6B6B' : color;
    ctx.setLineDash(enemy ? [] : [4, 3]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrowhead at the target.
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const ah = 6;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - ah * Math.cos(ang - 0.4), to.y - ah * Math.sin(ang - 0.4));
    ctx.lineTo(to.x - ah * Math.cos(ang + 0.4), to.y - ah * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fillStyle = enemy ? '#FF6B6B' : color;
    ctx.globalAlpha = alpha * 0.9;
    ctx.fill();
  }

  _drawAoeRing (ctx, at, color, alpha) {
    ctx.globalAlpha = alpha * 0.55;
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = color;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(at.x, at.y, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
};

window.EventFeed = EventFeed;
