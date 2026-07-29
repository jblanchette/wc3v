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
 *
 * Mounting: _specFromViewer() is the ONLY viewer-coupled code — it gates and
 * extracts a spec; mount(spec) does the rest and is viewer-free, so
 * client/dominance-lab.html can drive this exact class with synthetic or
 * fetched data. Score output goes through spec.onScore (the viewer wires it
 * to MatchHeader.setDominance) rather than reaching for the viewer directly.
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

  // Race is encoded twice on the caps — icon AND this label — so it is never
  // identified by color alone (DESIGN-SYSTEM.md §1.3).
  const RACE_LABELS = { H: 'Human', O: 'Orc', E: 'Night Elf', U: 'Undead' };

  const MAJOR_KINDS = { heroDeath: true, heroKill: true, baseRaze: true };
  const MAJOR_SWING_MIN = 500;   // |battleSwing delta| at/above this = major
  const SCRUB_JUMP_MS = 2500;    // larger game-time jumps = seek, stay silent
  const MAX_FIRES_PER_FRAME = 3;
  const MAX_GLYPHS = 2;
  const MAX_RINGS = 3;

  // Escalation tiers. KO is reserved for hero deaths.
  const TIER_MINOR = 1, TIER_MAJOR = 2, TIER_KO = 3;

  // Per-kind magnitude caps, mirroring helpers/dominanceConfig.json's momentum
  // block. Only used to normalize |delta| into the 0..1 --fx-i intensity, so
  // drift here degrades the FX size, never correctness.
  const FX_CAP = {
    heroDeath: 600, heroKill: 300, baseRaze: 600,
    battleSwing: 800, campClear: 250, tierUp: 250, expansion: 300
  };

  // Wall-clock rate limits. A collision downgrades a tier instead of dropping
  // the hit, so dense fighting reads as sustained pressure.
  const FX_COOLDOWN = { 1: 180, 2: 420, 3: 1500 };

  // Display-lag budgets per tier: freeze, then ease to truth.
  const HIT_STOP = { 2: { hold: 70, glide: 200 }, 3: { hold: 130, glide: 420 } };
  const HIT_STOP_MAX_HOLD = 200;   // a freeze must never be able to stick

  const FAST_DT_MS = 60;   // smoothed game-ms/frame above this ≈ 3.6x+ playback

  // Displayed-point gap at or below which the two sides are treated as level
  // and share one color (see DominanceBar.evenAdjust).
  const EVEN_BAND = 2;
  const EVEN_SCORE = 50;

  // Minimal inline SVG glyphs (decorative, currentColor).
  const GLYPHS = {
    heroDeath:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a8 8 0 0 0-8 8c0 3 1.6 5.4 4 6.8V20a1 1 0 0 0 1 1h1v-2h2v2h2v-2h2v2h1a1 1 0 0 0 1-1v-3.2c2.4-1.4 4-3.8 4-6.8a8 8 0 0 0-8-8zM8.5 12A1.75 1.75 0 1 1 8.5 8.5 1.75 1.75 0 0 1 8.5 12zm7 0a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5z"/></svg>',
    tierUp:     '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l8 8h-5v8h-6v-8H4z"/></svg>',
    expansion:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l9 7h-3v11h-4v-6H10v6H6V10H3z"/></svg>',
    campClear:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 6.9L21 9l-5 4.4L17.5 21 12 17.2 6.5 21 8 13.4 3 9l6.6-.1z"/></svg>',
    baseRaze:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 4-3 5-3 9a3 3 0 0 0 6 0c0-2-1-3-1-5 3 1 6 4 6 8a8 8 0 1 1-16 0c0-6 6-8 8-12z"/></svg>',
    battleSwing:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3l7 7-2 2-7-7zm18 0l-7 7 2 2 7-7zM10 14l-6 7h5l3-4 3 4h5l-6-7z"/></svg>'
  };
  // Crossed swords — a kill you landed reads differently from one you took.
  GLYPHS.heroKill = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 3h3.2l8 8-2.2 2.2-8-8V3zm19 0v2.2l-8 8L11.3 11l8-8h2.2zM8.7 14.5l1.6 1.6-4.1 4.1a1.6 1.6 0 0 1-2.3-2.3l4.8-3.4zm6.6 0 4.8 3.4a1.6 1.6 0 0 1-2.3 2.3l-4.1-4.1 1.6-1.6z"/></svg>';

  class DominanceBar {
    constructor (viewer) {
      this.viewer = viewer;
      this.active = false;
      this._players = [];        // [{id, color, name, race, iconId, samples, events}] in match-header order
      this._el = null;
      this._inner = null;        // shake target
      this._trackWrap = null;
      this._seamEl = null;
      this._segEls = [];
      this._ghostEls = [];
      this._scoreEls = [];
      // Text and geometry change at different rates, so they dedupe apart:
      // text is ~1 Hz, geometry stays smooth through a hit-stop glide.
      this._lastKey = '';           // "56|44|blue|green"
      this._lastGeomKey = '';       // "56.3|blue|green"
      this._lastScores = [50, 50];  // last DISPLAYED scores — FX anchor
      this._seamPct = 50;           // last WRITTEN seam position

      // Mount context (set by mount()); the viewer supplies these via _specFromViewer.
      this._container = null;
      this._anchor = null;
      this._mountId = null;
      this._onScore = null;

      // Impact-FX state. Wall-clock timing; game-time only for crossings.
      this._fx = { cursor: 0, lastGameTime: null, events: [], glyphs: [], rings: [], dtAvg: null, fast: false };
      this._fxCool = {};                                   // tier -> wall-clock ready-at
      this._hit = { holdUntil: 0, glideStart: 0, glideUntil: 0, f0: 50, f1: 50 };
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

    // The score is a zero-sum SHARE (the two sides sum to 100) and a bracket
    // boundary sits exactly at 50 — so the moment the game is anything but
    // perfectly level, one side lands above 50 and the other below, and a
    // dead-even match reads as two completely different colors. 49 vs 51 is
    // a rounding error, not a lead.
    //
    // Inside EVEN_BAND both sides are treated as level, so the gauge starts
    // (and stays) one color until somebody is genuinely ahead. Pass the two
    // DISPLAYED (rounded) values — deriving the bracket from the raw float
    // instead let 50.4/49.6 print "50 / 50" in blue and green.
    static evenAdjust (mine, theirs) {
      return Math.abs(mine - theirs) <= EVEN_BAND ? EVEN_SCORE : mine;
    }

    // Call after matchHeader.render(). No-ops (and stays hidden) unless the
    // strict 1v1 + available gate passes.
    setup () {
      const spec = this._specFromViewer();
      if (spec) this.mount(spec);
    }

    // Gate + extract. Returns a mount spec, or null when this replay has no
    // business showing a bar. The ONLY viewer-coupled code in the class.
    _specFromViewer () {
      const viewer = this.viewer;
      const mapData = viewer.mapData;
      if (viewer.mobileMode) return null;   // BO-only experience, no playback
      if (!mapData || !mapData.dominance || !mapData.dominance.available) return null;
      if (viewer.getGameMode() !== '1v1') return null;

      // Left/right order must match the MatchHeader cards.
      const ordered = (viewer.buildOrderPlayers || []).slice(0, 2);
      if (ordered.length < 2) return null;

      const starterIcons = (window.BuildOrderData && BuildOrderData.CONFIG
        && BuildOrderData.CONFIG.raceStarterIcons) || {};

      const infos = [];
      for (const bop of ordered) {
        const pid = bop.playerId;
        const pdata = mapData.players ? mapData.players[pid] : null;
        if (!pdata || !pdata.dominanceSeries || !pdata.dominanceSeries.samples.length) return null;
        const cp = (viewer.players || []).find(p => String(p.playerId) === String(pid));
        // Same canonical pro name the match-header cards show (PlayerNames is
        // the UI-wide source of truth); battle-tag suffix stripped as backup.
        const rawName = (cp && cp.displayName) || `P${pid}`;
        const name = (window.PlayerNames && PlayerNames.canonical)
          ? PlayerNames.canonical(rawName)
          : String(rawName).replace(/#.*$/, '');
        const race = (cp && cp.race) || (bop && bop.race) || '';
        infos.push({
          id: pid,
          color: (cp && cp.playerColor) || '#888',
          name: String(name).replace(/#.*$/, ''),
          race: race,
          iconId: starterIcons[race] || '',
          samples: pdata.dominanceSeries.samples,
          events: pdata.dominanceSeries.events || []
        });
      }

      const header = document.getElementById('match-header');
      const area = document.getElementById('gameplay-area');
      if (!header && !area) return null;

      return {
        players: infos,
        container: header ? header.parentNode : area,
        anchor: header ? header.nextSibling : area.firstChild,
        id: 'dominance-bar',
        // Mirror the numbers into the match-header card badges so there is
        // exactly ONE interpolator/bracket source.
        onScore: (pid, text, token) => {
          const mh = this.viewer.matchHeader;
          if (mh && typeof mh.setDominance === 'function') mh.setDominance(pid, text, token);
        }
      };
    }

    // Build + activate against a spec. Viewer-free, so the dominance lab can
    // drive the real class with synthetic or fetched data.
    mount (spec) {
      this._players = spec.players;
      this._container = spec.container;
      this._anchor = spec.anchor || null;
      this._mountId = spec.id || null;
      this._onScore = spec.onScore || null;

      // Merged FX event list, chronological, tagged with side index.
      const merged = [];
      this._players.forEach((p, side) => {
        for (const e of (p.events || [])) merged.push({ t: e.t, kind: e.kind, delta: e.delta, side });
      });
      merged.sort((a, b) => a.t - b.t);
      this._fx = { cursor: 0, lastGameTime: null, events: merged, glyphs: [], rings: [], dtAvg: null, fast: false };

      this._buildDom();
      this.active = true;
      this.update(0);
    }

    destroy () {
      this._clearLiveFx();
      if (this._el && this._el.parentNode) this._el.remove();
      this._el = null;
      this.active = false;
    }

    // Fire the impact FX pipeline for an event that did not arrive via the
    // score series (dominance lab, director cues). Honors the reduce-motion gate.
    fireImpact (kind, delta, side) {
      if (!this.active || this._reduceMotion) return;
      const ev = { kind: kind, delta: Number(delta) || 0, side: side ? 1 : 0 };

      // The series isn't moving under a manual cue, so the chunk-shear would
      // find no lost ground and skip. Stage the pre-hit width it reads from,
      // then invalidate the geometry key so the next update() restores truth.
      const hurtSide = ev.delta >= 0 ? 1 - ev.side : ev.side;
      const cur = parseFloat(this._segEls[hurtSide].style.width);
      if (!isNaN(cur)) {
        const chunk = 3 + 9 * this._intensityFor(ev);
        this._segEls[hurtSide].style.width = Math.min(100, cur + chunk).toFixed(2) + '%';
      }

      this._fire(ev, this._lastScores[0], this._lastScores[1]);
      this._lastGeomKey = '';
    }

    _buildDom () {
      if (this._el && this._el.parentNode) this._el.remove();

      const bar = document.createElement('div');
      bar.className = 'dom-bar';
      if (this._mountId) bar.id = this._mountId;

      // Inner is the shake target: shaking the chassis itself would open a
      // visible gap against the match header above and the map below.
      const inner = document.createElement('div');
      inner.className = 'dom-bar-inner';
      bar.appendChild(inner);

      // Identity cap: forged bezel + race icon + name + race label. Player
      // color rides the FULL-perimeter icon border and the name — never a
      // single-edge stripe. Race is encoded twice (icon AND text), never by
      // color alone.
      const mkCap = (p, sideClass) => {
        const cap = document.createElement('span');
        cap.className = 'dom-cap ' + sideClass;

        const tile = document.createElement('span');
        tile.className = 'dom-ident';
        if (p.iconId) {
          const img = document.createElement('img');
          img.className = 'dom-ident-img';
          img.src = '/assets/wc3icons/' + p.iconId + '.jpg';
          img.alt = '';
          img.style.borderColor = p.color;
          tile.appendChild(img);
        } else {
          tile.classList.add('dom-ident-blank');
          tile.style.borderColor = p.color;
        }
        cap.appendChild(tile);

        const text = document.createElement('span');
        text.className = 'dom-cap-text';
        const name = document.createElement('span');
        name.className = 'dom-cap-name';
        name.textContent = p.name;
        name.style.color = p.color;
        text.appendChild(name);
        const sub = document.createElement('span');
        sub.className = 'dom-cap-sub';
        sub.textContent = RACE_LABELS[p.race] || '';
        text.appendChild(sub);
        cap.appendChild(text);
        return cap;
      };
      inner.appendChild(mkCap(this._players[0], 'dom-cap-left'));

      const leftScore = document.createElement('span');
      leftScore.className = 'dom-score dom-score-left';
      inner.appendChild(leftScore);

      // Wrap is the FX stage: rings, glyphs and the KO plate live here,
      // unclipped by the well's overflow.
      const trackWrap = document.createElement('div');
      trackWrap.className = 'dom-track-wrap';

      const label = document.createElement('span');
      label.className = 'dom-label';
      label.textContent = 'Dominance';
      label.title = 'Dominance — deterministic strength share (armies, heroes, economy, tech), 50 = even';
      trackWrap.appendChild(label);

      const frame = document.createElement('div');
      frame.className = 'dom-frame';
      trackWrap.appendChild(frame);

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

      // The contested edge — its own element now, so FX transforms can't
      // distort the segments it used to be a box-shadow on.
      const seam = document.createElement('div');
      seam.className = 'dom-seam';
      trackWrap.appendChild(seam);

      // Engraved bracket teeth at the WCL boundaries.
      const ticks = document.createElement('div');
      ticks.className = 'dom-ticks';
      for (const pct of [25, 50, 75]) {
        const tick = document.createElement('i');
        tick.className = 'dom-tick' + (pct === 50 ? ' dom-tick-mid' : '');
        tick.style.left = pct + '%';
        ticks.appendChild(tick);
      }
      trackWrap.appendChild(ticks);

      inner.appendChild(trackWrap);

      const rightScore = document.createElement('span');
      rightScore.className = 'dom-score dom-score-right';
      inner.appendChild(rightScore);

      inner.appendChild(mkCap(this._players[1], 'dom-cap-right'));

      this._container.insertBefore(bar, this._anchor);

      this._el = bar;
      this._inner = inner;
      this._trackWrap = trackWrap;
      this._seamEl = seam;
      this._segEls = [segLeft, segRight];
      this._ghostEls = [ghostLeft, ghostRight];
      this._scoreEls = [leftScore, rightScore];
      this._lastKey = '';
      this._lastGeomKey = '';
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

    // `score` is the raw interpolated value; `bracket` matches what the bar
    // actually paints (rounded + even-band), so a caller can't derive a
    // different color from the same instant than the gauge is showing.
    getScoresAt (gameTime) {
      const raw = this._players.map(p => this._scoreAt(p.samples, gameTime));
      const shown = raw.map(Math.round);
      const out = {};
      this._players.forEach((p, i) => {
        const other = shown[1 - i];
        out[p.id] = {
          score: raw[i],
          bracket: DominanceBar.bracketFor(
            other == null ? shown[i] : DominanceBar.evenAdjust(shown[i], other))
        };
      });
      return out;
    }

    update (gameTime) {
      if (!this.active || !this._el) return;

      const s0 = this._scoreAt(this._players[0].samples, gameTime);
      const s1 = this._scoreAt(this._players[1].samples, gameTime);

      // FX cursor runs BEFORE the dedupe early-return: an event whose score
      // impact rounds away must still land its hit.
      this._fxTick(gameTime, s0, s1);

      // Hit-stop: the DISPLAYED score is allowed to lag the true score for a
      // beat so a hit reads as an impact rather than a slide. Playback and
      // gameTime are untouched — this is purely a render-side lie, on
      // wall-clock so it looks the same at 1x and 10x.
      let v0 = s0, v1 = s1;
      if (!this._reduceMotion) {
        const now = performance.now();
        const h = this._hit;
        if (h.holdUntil > now) {
          v0 = h.f0; v1 = h.f1;
        } else if (h.glideUntil > now) {
          const p = (now - h.glideStart) / (h.glideUntil - h.glideStart);
          const f = 1 - Math.pow(1 - p, 4);   // easeOutQuart — lands hard, settles soft
          v0 = h.f0 + (s0 - h.f0) * f;
          v1 = h.f1 + (s1 - h.f1) * f;
        }
      }

      this._lastScores[0] = v0;
      this._lastScores[1] = v1;

      const d0 = Math.round(v0);
      const d1 = Math.round(v1);
      const b0 = DominanceBar.bracketFor(DominanceBar.evenAdjust(d0, d1));
      const b1 = DominanceBar.bracketFor(DominanceBar.evenAdjust(d1, d0));

      // Geometry: smooth, so it must survive a hit-stop glide.
      const total = Math.max(1e-6, v0 + v1);
      const seamPct = (100 * v0) / total;
      const geomKey = seamPct.toFixed(1) + '|' + b0.name + '|' + b1.name;
      if (geomKey !== this._lastGeomKey) {
        this._lastGeomKey = geomKey;
        this._seamPct = seamPct;
        this._segEls[0].style.width = seamPct.toFixed(2) + '%';
        this._segEls[1].style.width = (100 - seamPct).toFixed(2) + '%';
        // Fill from each side's OWN bracket — performance is the color,
        // identity lives at the caps. backgroundColor, not the `background`
        // shorthand: CSS owns background-image for the material shading and
        // the shorthand would clobber it.
        this._segEls[0].style.backgroundColor = b0.token;
        this._segEls[1].style.backgroundColor = b1.token;
        this._seamEl.style.left = seamPct.toFixed(2) + '%';
      }

      // Text: ~1 Hz, so it dedupes separately and skips the badge mirror too.
      const key = d0 + '|' + d1 + '|' + b0.name + '|' + b1.name;
      if (key === this._lastKey) return;
      this._lastKey = key;

      this._scoreEls[0].textContent = String(d0);
      this._scoreEls[0].style.color = b0.token;
      this._scoreEls[1].textContent = String(d1);
      this._scoreEls[1].style.color = b1.token;

      if (this._onScore) {
        this._onScore(this._players[0].id, String(d0), b0.token);
        this._onScore(this._players[1].id, String(d1), b1.token);
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

      // Playback speed isn't exposed to this class, but dt IS game-ms per
      // frame. EMA-smoothed so one hitched frame can't trip it.
      fx.dtAvg = (fx.dtAvg == null) ? dt : (fx.dtAvg * 0.9 + dt * 0.1);
      fx.fast = fx.dtAvg > FAST_DT_MS;

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

    // Which of the three escalation tiers this event lands in. KO is
    // RESERVED for hero deaths — the loudest thing the gauge can do should
    // mean exactly one thing.
    _tierFor (ev) {
      if (ev.kind === 'heroDeath' || ev.kind === 'heroKill') return TIER_KO;
      if (MAJOR_KINDS[ev.kind]) return TIER_MAJOR;
      if (ev.kind === 'battleSwing' && Math.abs(ev.delta) >= MAJOR_SWING_MIN) return TIER_MAJOR;
      return TIER_MINOR;
    }

    // 0.35 .. 1.0 — escalation WITHIN a tier, so a +795 swing and a +520 one
    // are both MAJOR but visibly different sizes. Drives --fx-i in CSS.
    _intensityFor (ev) {
      const cap = FX_CAP[ev.kind] || 600;
      return 0.35 + 0.65 * Math.min(1, Math.abs(ev.delta) / cap);
    }

    _fire (ev, s0, s1) {
      const total = Math.max(1e-6, s0 + s1);
      const seamPct = (100 * s0) / total;
      const now = performance.now();

      let tier = this._tierFor(ev);
      // Cooldown collision downgrades rather than drops — a dense fight
      // should read as continuous pressure, not go silent.
      while (tier > TIER_MINOR && now < (this._fxCool[tier] || 0)) tier--;
      if (tier === TIER_MINOR && now < (this._fxCool[TIER_MINOR] || 0)) return;
      // A freeze at high playback speed is a lie you can see.
      if (this._fx.fast && tier === TIER_KO) tier = TIER_MAJOR;
      this._fxCool[tier] = now + FX_COOLDOWN[tier];

      let intensity = this._intensityFor(ev);
      if (this._fx.fast) intensity *= 0.5;
      this._el.style.setProperty('--fx-i', intensity.toFixed(2));

      const gainSide = ev.delta >= 0 ? ev.side : 1 - ev.side;
      const hurtSide = 1 - gainSide;

      if (tier === TIER_MINOR) {
        this._fireGlyph(ev, seamPct, tier);
        this._oneShotClass(this._seamEl, 'dom-seam-flare');
        return;
      }

      this._armHitStop(tier);
      this._fireGhost(hurtSide, seamPct, tier);
      this._fireShockwave(seamPct, tier);
      this._oneShotClass(this._inner, tier === TIER_KO ? 'dom-shake-ko' : 'dom-shake-major');
      this._oneShotClass(this._scoreEls[gainSide], tier === TIER_KO ? 'dom-score-slam-ko' : 'dom-score-slam');
      this._oneShotClass(this._scoreEls[hurtSide], 'dom-score-drop');
      this._fireGlyph(ev, seamPct, tier);

      if (tier === TIER_KO) this._fireKO(ev, seamPct);
    }

    // Freeze the DISPLAYED score, then ease it to truth. Wall-clock, so it
    // reads the same at every playback speed. Hard-capped so a freeze that
    // straddles a seek can never stick.
    _armHitStop (tier) {
      if (this._reduceMotion || this._fx.fast) return;
      const t = HIT_STOP[tier];
      if (!t) return;
      const now = performance.now();
      const h = this._hit;
      h.f0 = this._lastScores[0];
      h.f1 = this._lastScores[1];
      h.holdUntil = Math.min(now + t.hold, now + HIT_STOP_MAX_HOLD);
      h.glideStart = h.holdUntil;
      h.glideUntil = h.holdUntil + t.glide;
    }

    // The chunk that was just knocked off: the ghost holds the side's PRE-HIT
    // width while the live segment snaps to the new one beneath it, then
    // shears off the seam. _fxTick runs BEFORE this frame's width write, and
    // the hit-stop freeze holds it there, so the read is exact.
    _fireGhost (side, seamPctAfter, tier) {
      const ghost = this._ghostEls[side];
      const preWidth = parseFloat(this._segEls[side].style.width);
      if (isNaN(preWidth)) return;
      const postWidth = side === 0 ? seamPctAfter : 100 - seamPctAfter;
      if (preWidth <= postWidth) return;   // this side didn't lose ground
      ghost.style.width = preWidth.toFixed(2) + '%';
      ghost.style.backgroundColor = this._segEls[side].style.backgroundColor || 'rgba(255,255,255,0.7)';
      ghost.classList.toggle('dom-ghost-ko', tier === TIER_KO);
      this._oneShotClass(ghost, 'dom-ghost-shear');
    }

    _fireShockwave (seamPct, tier) {
      const rings = this._fx.rings;
      while (rings.length >= MAX_RINGS) {
        const oldest = rings.shift();
        if (oldest && oldest.parentNode) oldest.remove();
      }
      const ring = document.createElement('div');
      ring.className = 'dom-shockwave'
        + (tier === TIER_KO ? ' dom-shockwave-ko' : ' dom-shockwave-major');
      ring.style.left = seamPct.toFixed(2) + '%';
      this._trackWrap.appendChild(ring);
      rings.push(ring);
      const drop = () => {
        ring.remove();
        const i = rings.indexOf(ring);
        if (i >= 0) rings.splice(i, 1);
      };
      ring.addEventListener('animationend', drop, { once: true });
      setTimeout(drop, 1500);   // sweep if animations are disabled
    }

    // Hero deaths only: flash, lance, and the reserved HERO DOWN plate.
    _fireKO (ev, seamPct) {
      const wrap = this._trackWrap;

      const flash = document.createElement('div');
      flash.className = 'dom-ko-flash';
      this._inner.appendChild(flash);

      const lance = document.createElement('div');
      lance.className = 'dom-lance';
      lance.style.left = seamPct.toFixed(2) + '%';
      wrap.appendChild(lance);

      const plate = document.createElement('div');
      plate.className = 'dom-ko-plate';
      plate.style.left = seamPct.toFixed(2) + '%';
      plate.textContent = ev.kind === 'heroKill' ? 'HERO KILL' : 'HERO DOWN';
      wrap.appendChild(plate);

      for (const el of [flash, lance, plate]) {
        el.addEventListener('animationend', () => el.remove(), { once: true });
        setTimeout(() => el.remove(), 2000);   // sweep if animations are disabled
      }
    }

    _fireGlyph (ev, seamPct, tier) {
      const svg = GLYPHS[ev.kind];
      if (!svg) return;
      const fxg = this._fx.glyphs;
      while (fxg.length >= MAX_GLYPHS) {
        const oldest = fxg.shift();
        if (oldest && oldest.parentNode) oldest.remove();
      }
      const glyph = document.createElement('div');
      glyph.className = 'dom-glyph'
        + (ev.delta < 0 ? ' dom-glyph-loss' : '')
        + (tier === TIER_KO ? ' dom-glyph-ko' : '');
      glyph.style.left = seamPct.toFixed(2) + '%';
      glyph.innerHTML = svg;   // static, code-owned SVG strings only
      glyph.setAttribute('aria-hidden', 'true');
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
      // Hit-stop must reset too, or a freeze straddling a seek locks the
      // display at a stale score.
      this._hit.holdUntil = this._hit.glideUntil = this._hit.glideStart = 0;
      this._fxCool = {};

      if (!this._trackWrap) return;
      for (const sel of ['.dom-shockwave', '.dom-glyph', '.dom-lance', '.dom-ko-plate']) {
        this._trackWrap.querySelectorAll(sel).forEach(n => n.remove());
      }
      this._fx.glyphs = [];
      this._fx.rings = [];

      for (const g of this._ghostEls) g.classList.remove('dom-ghost-shear', 'dom-ghost-ko');
      for (const s of this._scoreEls) {
        s.classList.remove('dom-score-slam', 'dom-score-slam-ko', 'dom-score-drop');
      }
      if (this._inner) {
        this._inner.classList.remove('dom-shake-major', 'dom-shake-ko');
        this._inner.querySelectorAll('.dom-ko-flash').forEach(n => n.remove());
      }
      if (this._seamEl) this._seamEl.classList.remove('dom-seam-flare');
      if (this._el) this._el.style.removeProperty('--fx-i');
    }
  }

  window.DominanceBar = DominanceBar;
})();
