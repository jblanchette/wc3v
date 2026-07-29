/**
 * DominanceBar — live "who is ahead" tug-of-war widget.
 *
 * Renders the per-player dominance score (server-computed, see
 * lib/DominanceSeries.js) as a horizontal split bar docked under the match
 * header, plus live 0-100 numbers colored by Warcraft-Logs-style brackets.
 * Also pushes the same numbers into the MatchHeader player-card badges so
 * there is exactly ONE interpolator/bracket source.
 *
 * Visual language:
 *   • Identity lives at the END CAPS (player-color dot + name — data colors).
 *   • Each segment is filled with its side's CURRENT bracket color — the
 *     leader glows blue→purple→pink while a crushed side fades green→grey.
 *     Same bracket system as the numbers, badges and chart.
 *   • Momentum events land as fighter-game impact FX: damage-ghost afterimage
 *     on the losing side, seam shockwave + bar shake + score punch on major
 *     hits (hero kills, base razes, big battle swings), event glyphs at the
 *     seam; minor events (tier/expansion/camp) get a glyph + seam flare only.
 *
 * FX rules:
 *   • Wall-clock animation timing (readable at 10× speed); game time only
 *     decides WHEN an event fires (forward crossing of event.t).
 *   • Scrub-safe: backward seeks or jumps >2.5s silently reseat the cursor
 *     and clear any live FX — no replaying history.
 *   • prefers-reduced-motion: the score keeps updating, FX never fire (the
 *     global CSS kill-switch backstops any straggler animation).
 *
 * Gates: 1v1 only, mapData.dominance.available only, hidden in BO-only
 * layouts. Linear interpolation between samples; the server emits pre/post
 * sample pairs around momentum events so hits read as instant steps.
 */

(function () {
  // Lockstep with the --dom-* tokens in tokens.css.
  const BRACKETS = [
    { min: 100, token: 'var(--dom-gold)',   name: 'gold' },
    { min: 99,  token: 'var(--dom-pink)',   name: 'pink' },
    { min: 95,  token: 'var(--dom-orange)', name: 'orange' },
    { min: 75,  token: 'var(--dom-purple)', name: 'purple' },
    { min: 50,  token: 'var(--dom-blue)',   name: 'blue' },
    { min: 25,  token: 'var(--dom-green)',  name: 'green' },
    { min: 0,   token: 'var(--dom-grey)',   name: 'grey' }
  ];

  const MAJOR_KINDS = { heroDeath: true, heroKill: true, baseRaze: true };
  const MAJOR_SWING_MIN = 500;   // |battleSwing delta| at/above this = major
  const SCRUB_JUMP_MS = 2500;    // larger game-time jumps = seek, stay silent
  const MAX_FIRES_PER_FRAME = 3;
  const MAX_GLYPHS = 2;

  // Minimal inline SVG glyphs (decorative, currentColor).
  const GLYPHS = {
    heroDeath:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a8 8 0 0 0-8 8c0 3 1.6 5.4 4 6.8V20a1 1 0 0 0 1 1h1v-2h2v2h2v-2h2v2h1a1 1 0 0 0 1-1v-3.2c2.4-1.4 4-3.8 4-6.8a8 8 0 0 0-8-8zM8.5 12A1.75 1.75 0 1 1 8.5 8.5 1.75 1.75 0 0 1 8.5 12zm7 0a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5z"/></svg>',
    tierUp:     '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l8 8h-5v8h-6v-8H4z"/></svg>',
    expansion:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l9 7h-3v11h-4v-6H10v6H6V10H3z"/></svg>',
    campClear:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 6.9L21 9l-5 4.4L17.5 21 12 17.2 6.5 21 8 13.4 3 9l6.6-.1z"/></svg>',
    baseRaze:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-2-1-3-1-5 3 1 6 4 6 8a8 8 0 1 1-16 0c0-6 6-8 8-12z"/></svg>',
    battleSwing:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3l7 7-2 2-7-7zm18 0l-7 7 2 2 7-7zM10 14l-6 7h5l3-4 3 4h5l-6-7z"/></svg>'
  };
  GLYPHS.heroKill = GLYPHS.heroDeath;

  class DominanceBar {
    constructor (viewer) {
      this.viewer = viewer;
      this.active = false;
      this._players = [];        // [{id, color, name, samples, events}] in match-header order
      this._el = null;
      this._trackWrap = null;
      this._segEls = [];
      this._ghostEls = [];
      this._scoreEls = [];
      this._lastKey = '';        // "56|44|blue|green" — skip DOM writes when unchanged

      // Impact-FX state. Wall-clock timing; game-time only for crossings.
      this._fx = { cursor: 0, lastGameTime: null, events: [], glyphs: [] };
      this._reduceMotion = false;
      try {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._reduceMotion = mq.matches;
        const onChange = (e) => { this._reduceMotion = e.matches; };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      } catch (e) { /* older browsers: motion on */ }
    }

    static bracketFor (score) {
      const s = Math.max(0, Math.min(100, score));
      for (const b of BRACKETS) {
        if (s >= b.min) return b;
      }
      return BRACKETS[BRACKETS.length - 1];
    }

    // Call after matchHeader.render(). No-ops (and stays hidden) unless the
    // strict 1v1 + available gate passes.
    setup () {
      const viewer = this.viewer;
      const mapData = viewer.mapData;
      if (viewer.mobileMode) return;   // BO-only experience, no playback
      if (!mapData || !mapData.dominance || !mapData.dominance.available) return;
      if (viewer.getGameMode() !== '1v1') return;

      // Left/right order must match the MatchHeader cards.
      const ordered = (viewer.buildOrderPlayers || []).slice(0, 2);
      if (ordered.length < 2) return;

      const infos = [];
      for (const bop of ordered) {
        const pid = bop.playerId;
        const pdata = mapData.players ? mapData.players[pid] : null;
        if (!pdata || !pdata.dominanceSeries || !pdata.dominanceSeries.samples.length) return;
        const cp = (viewer.players || []).find(p => String(p.playerId) === String(pid));
        // Same canonical pro name the match-header cards show (PlayerNames is
        // the UI-wide source of truth); battle-tag suffix stripped as backup.
        const rawName = (cp && cp.displayName) || `P${pid}`;
        const name = (window.PlayerNames && PlayerNames.canonical)
          ? PlayerNames.canonical(rawName)
          : String(rawName).replace(/#.*$/, '');
        infos.push({
          id: pid,
          color: (cp && cp.playerColor) || '#888',
          name: String(name).replace(/#.*$/, ''),
          samples: pdata.dominanceSeries.samples,
          events: pdata.dominanceSeries.events || []
        });
      }
      this._players = infos;

      // Merged FX event list, chronological, tagged with side index.
      const merged = [];
      infos.forEach((p, side) => {
        for (const e of p.events) merged.push({ t: e.t, kind: e.kind, delta: e.delta, side });
      });
      merged.sort((a, b) => a.t - b.t);
      this._fx = { cursor: 0, lastGameTime: null, events: merged, glyphs: [] };

      this._buildDom();
      this.active = true;
      this.update(0);
    }

    _buildDom () {
      const old = document.getElementById('dominance-bar');
      if (old) old.remove();

      const bar = document.createElement('div');
      bar.id = 'dominance-bar';

      const label = document.createElement('span');
      label.className = 'dom-label';
      label.textContent = 'Dominance';
      label.title = 'Dominance — deterministic strength share (armies, heroes, economy, tech), 50 = even';
      bar.appendChild(label);

      const mkCap = (p, sideClass) => {
        const cap = document.createElement('span');
        cap.className = 'dom-cap ' + sideClass;
        const dot = document.createElement('i');
        dot.className = 'dom-cap-dot';
        dot.style.background = p.color;   // player color — data color
        const name = document.createElement('span');
        name.className = 'dom-cap-name';
        name.textContent = p.name;
        name.style.color = p.color;
        cap.appendChild(dot);
        cap.appendChild(name);
        return cap;
      };
      bar.appendChild(mkCap(this._players[0], 'dom-cap-left'));

      const leftScore = document.createElement('span');
      leftScore.className = 'dom-score dom-score-left';
      bar.appendChild(leftScore);

      // Wrap is the FX stage: shock rings + glyphs live here, unclipped by
      // the pill's overflow:hidden.
      const trackWrap = document.createElement('div');
      trackWrap.className = 'dom-track-wrap';
      const track = document.createElement('div');
      track.className = 'dom-track';
      const segLeft = document.createElement('div');
      segLeft.className = 'dom-seg dom-seg-left';
      const segRight = document.createElement('div');
      segRight.className = 'dom-seg dom-seg-right';
      const ghostLeft = document.createElement('div');
      ghostLeft.className = 'dom-ghost dom-ghost-left';
      const ghostRight = document.createElement('div');
      ghostRight.className = 'dom-ghost dom-ghost-right';
      const mid = document.createElement('div');
      mid.className = 'dom-mid';
      track.appendChild(segLeft);
      track.appendChild(segRight);
      track.appendChild(ghostLeft);
      track.appendChild(ghostRight);
      track.appendChild(mid);
      trackWrap.appendChild(track);
      bar.appendChild(trackWrap);

      const rightScore = document.createElement('span');
      rightScore.className = 'dom-score dom-score-right';
      bar.appendChild(rightScore);

      bar.appendChild(mkCap(this._players[1], 'dom-cap-right'));

      const header = document.getElementById('match-header');
      if (header && header.parentNode) {
        header.parentNode.insertBefore(bar, header.nextSibling);
      } else {
        const area = document.getElementById('gameplay-area');
        if (!area) return;
        area.insertBefore(bar, area.firstChild);
      }

      this._el = bar;
      this._trackWrap = trackWrap;
      this._segEls = [segLeft, segRight];
      this._ghostEls = [ghostLeft, ghostRight];
      this._scoreEls = [leftScore, rightScore];
      this._lastKey = '';
    }

    // Lerped score at t. Samples are sorted; event pairs (t-1, t) make real
    // discontinuities survive interpolation as steps.
    _scoreAt (samples, t) {
      if (t <= samples[0].t) return samples[0].score;
      const last = samples[samples.length - 1];
      if (t >= last.t) return last.score;
      let lo = 0, hi = samples.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (samples[mid].t <= t) lo = mid;
        else hi = mid - 1;
      }
      const a = samples[lo], b = samples[lo + 1];
      const span = b.t - a.t;
      if (span <= 0) return b.score;
      const f = (t - a.t) / span;
      return a.score + (b.score - a.score) * f;
    }

    getScoresAt (gameTime) {
      const out = {};
      for (const p of this._players) {
        const score = this._scoreAt(p.samples, gameTime);
        out[p.id] = { score, bracket: DominanceBar.bracketFor(score) };
      }
      return out;
    }

    update (gameTime) {
      if (!this.active || !this._el) return;

      const s0 = this._scoreAt(this._players[0].samples, gameTime);
      const s1 = this._scoreAt(this._players[1].samples, gameTime);

      // FX cursor runs BEFORE the dedupe early-return: an event whose score
      // impact rounds away must still land its hit.
      this._fxTick(gameTime, s0, s1);

      const d0 = Math.round(s0);
      const d1 = Math.round(s1);
      const b0 = DominanceBar.bracketFor(s0);
      const b1 = DominanceBar.bracketFor(s1);

      const key = d0 + '|' + d1 + '|' + b0.name + '|' + b1.name;
      if (key === this._lastKey) return;
      this._lastKey = key;

      this._scoreEls[0].textContent = String(d0);
      this._scoreEls[0].style.color = b0.token;
      this._scoreEls[1].textContent = String(d1);
      this._scoreEls[1].style.color = b1.token;

      // Segments: width from the raw split; fill from each side's OWN
      // bracket — performance is the color, identity lives at the caps.
      const total = Math.max(1e-6, s0 + s1);
      this._segEls[0].style.width = ((100 * s0) / total).toFixed(2) + '%';
      this._segEls[1].style.width = ((100 * s1) / total).toFixed(2) + '%';
      this._segEls[0].style.background = b0.token;
      this._segEls[1].style.background = b1.token;

      // Mirror into the match-header card badges (single source of truth).
      const mh = this.viewer.matchHeader;
      if (mh && typeof mh.setDominance === 'function') {
        mh.setDominance(this._players[0].id, String(d0), b0.token);
        mh.setDominance(this._players[1].id, String(d1), b1.token);
      }
    }

    // ---------------------------------------------------------- impact FX

    _fxTick (gameTime, s0, s1) {
      const fx = this._fx;
      if (!fx.events.length) return;

      if (fx.lastGameTime == null) {
        fx.cursor = this._eventIdxAfter(gameTime);
        fx.lastGameTime = gameTime;
        return;   // no burst on load
      }

      const dt = gameTime - fx.lastGameTime;
      if (dt < 0 || dt > SCRUB_JUMP_MS) {
        // Seek — reseat silently, kill anything mid-flight.
        fx.cursor = this._eventIdxAfter(gameTime);
        fx.lastGameTime = gameTime;
        this._clearLiveFx();
        return;
      }
      fx.lastGameTime = gameTime;

      // Collect newly-crossed events; collapse to the strongest per side.
      const strongest = [null, null];
      let crossed = 0;
      while (fx.cursor < fx.events.length && fx.events[fx.cursor].t <= gameTime) {
        const ev = fx.events[fx.cursor++];
        if (++crossed > MAX_FIRES_PER_FRAME * 2) continue;
        const cur = strongest[ev.side];
        if (!cur || Math.abs(ev.delta) > Math.abs(cur.delta)) strongest[ev.side] = ev;
      }
      if (this._reduceMotion) return;

      let fires = 0;
      for (let side = 0; side < 2; side++) {
        const ev = strongest[side];
        if (!ev || fires >= MAX_FIRES_PER_FRAME) continue;
        fires++;
        this._fire(ev, s0, s1);
      }
    }

    _eventIdxAfter (t) {
      const evs = this._fx.events;
      let lo = 0, hi = evs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (evs[mid].t <= t) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    _isMajor (ev) {
      if (MAJOR_KINDS[ev.kind]) return true;
      return ev.kind === 'battleSwing' && Math.abs(ev.delta) >= MAJOR_SWING_MIN;
    }

    _fire (ev, s0, s1) {
      const total = Math.max(1e-6, s0 + s1);
      const seamPct = (100 * s0) / total;

      if (this._isMajor(ev)) {
        // Damage ghost on the harmed side: afterimage of the pre-hit width.
        if (ev.delta < 0) this._fireGhost(ev.side, seamPct);
        this._fireShockwave(seamPct, ev.kind);
        this._fireShake();
        // Punch the score that gained.
        const gainSide = ev.delta >= 0 ? ev.side : 1 - ev.side;
        this._oneShotClass(this._scoreEls[gainSide], 'dom-score-punch');
        this._fireGlyph(ev, seamPct);
      } else {
        this._fireGlyph(ev, seamPct);
        this._oneShotClass(this._segEls[0], 'dom-seam-flare');
      }
    }

    // The ghost holds the side's PRE-HIT share while the live segment snaps
    // to the new width beneath it — the visible sliver is the chunk that was
    // just knocked off, fading out. _fxTick runs BEFORE this frame's width
    // write, so the segment element still holds the exact pre-hit width.
    _fireGhost (side, seamPctAfter) {
      const ghost = this._ghostEls[side];
      const postWidth = side === 0 ? seamPctAfter : 100 - seamPctAfter;
      const preWidth = parseFloat(this._segEls[side].style.width);
      const w = (!isNaN(preWidth) && preWidth > postWidth) ? preWidth : Math.min(100, postWidth + 4);
      ghost.style.width = w.toFixed(2) + '%';
      ghost.style.background = this._segEls[side].style.background || 'rgba(255,255,255,0.7)';
      this._oneShotClass(ghost, 'dom-ghost-hit');
    }

    _fireShockwave (seamPct, kind) {
      const ring = document.createElement('div');
      ring.className = 'dom-shockwave' + (kind === 'heroDeath' || kind === 'heroKill' ? ' dom-shockwave-hero' : '');
      ring.style.left = seamPct.toFixed(2) + '%';
      this._trackWrap.appendChild(ring);
      ring.addEventListener('animationend', () => ring.remove(), { once: true });
      setTimeout(() => ring.remove(), 1500);   // sweep if animations are disabled
    }

    _fireShake () {
      this._oneShotClass(this._el, 'dom-shake');
    }

    _fireGlyph (ev, seamPct) {
      const svg = GLYPHS[ev.kind];
      if (!svg) return;
      const fxg = this._fx.glyphs;
      while (fxg.length >= MAX_GLYPHS) {
        const oldest = fxg.shift();
        if (oldest && oldest.parentNode) oldest.remove();
      }
      const glyph = document.createElement('div');
      glyph.className = 'dom-glyph' + (ev.delta < 0 ? ' dom-glyph-loss' : '');
      glyph.style.left = seamPct.toFixed(2) + '%';
      glyph.innerHTML = svg;   // static, code-owned SVG strings only
      this._trackWrap.appendChild(glyph);
      fxg.push(glyph);
      glyph.addEventListener('animationend', () => {
        glyph.remove();
        const i = fxg.indexOf(glyph);
        if (i >= 0) fxg.splice(i, 1);
      }, { once: true });
      setTimeout(() => glyph.remove(), 2000);   // sweep if animations are disabled
    }

    _oneShotClass (el, cls) {
      if (!el) return;
      el.classList.remove(cls);
      // Force restart when re-fired back-to-back.
      void el.offsetWidth;
      el.classList.add(cls);
      el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
    }

    _clearLiveFx () {
      if (!this._trackWrap) return;
      for (const sel of ['.dom-shockwave', '.dom-glyph']) {
        this._trackWrap.querySelectorAll(sel).forEach(n => n.remove());
      }
      this._fx.glyphs = [];
      for (const g of this._ghostEls) g.classList.remove('dom-ghost-hit');
      if (this._el) this._el.classList.remove('dom-shake');
      for (const s of this._scoreEls) s.classList.remove('dom-score-punch');
      this._segEls[0] && this._segEls[0].classList.remove('dom-seam-flare');
    }
  }

  window.DominanceBar = DominanceBar;
})();
