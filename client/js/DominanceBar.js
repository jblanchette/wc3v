/**
 * DominanceBar — live "who is ahead" tug-of-war widget.
 *
 * Renders the per-player dominance score (server-computed, see
 * lib/DominanceSeries.js) as a horizontal split bar docked under the match
 * header, plus live 0-100 numbers colored by Warcraft-Logs-style brackets.
 * Also pushes the same numbers into the MatchHeader player-card badges so
 * there is exactly ONE interpolator/bracket source.
 *
 * Display rules:
 *   • 1v1 only, and only when mapData.dominance.available (strict gate —
 *     degraded parses ship no dominanceSeries at all).
 *   • Hidden via CSS in static-bo / mobile-bo layouts (no playback there).
 *   • Bar segments are filled with each player's color (data color — allowed);
 *     the score numbers are colored by bracket (data), never chrome accent.
 *   • Linear interpolation between samples for smooth motion. The server
 *     emits pre/post sample pairs around momentum events, so hero kills etc.
 *     still register as instant steps, not 10s ramps.
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

  class DominanceBar {
    constructor (viewer) {
      this.viewer = viewer;
      this.active = false;
      this._players = [];        // [{id, color, samples}] in match-header order (left, right)
      this._el = null;
      this._segEls = [];
      this._scoreEls = [];
      this._lastKey = '';        // "56|44|blue|green" — skip DOM writes when unchanged
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
        infos.push({
          id: pid,
          color: (cp && cp.playerColor) || '#888',
          samples: pdata.dominanceSeries.samples
        });
      }
      this._players = infos;

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

      const leftScore = document.createElement('span');
      leftScore.className = 'dom-score dom-score-left';
      bar.appendChild(leftScore);

      const track = document.createElement('div');
      track.className = 'dom-track';
      const segLeft = document.createElement('div');
      segLeft.className = 'dom-seg dom-seg-left';
      segLeft.style.background = this._players[0].color;
      const segRight = document.createElement('div');
      segRight.className = 'dom-seg dom-seg-right';
      segRight.style.background = this._players[1].color;
      const mid = document.createElement('div');
      mid.className = 'dom-mid';
      track.appendChild(segLeft);
      track.appendChild(segRight);
      track.appendChild(mid);
      bar.appendChild(track);

      const rightScore = document.createElement('span');
      rightScore.className = 'dom-score dom-score-right';
      bar.appendChild(rightScore);

      const header = document.getElementById('match-header');
      if (header && header.parentNode) {
        header.parentNode.insertBefore(bar, header.nextSibling);
      } else {
        const area = document.getElementById('gameplay-area');
        if (!area) return;
        area.insertBefore(bar, area.firstChild);
      }

      this._el = bar;
      this._segEls = [segLeft, segRight];
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

      // Widths from the raw (unrounded) split so the bar and numbers agree.
      const total = Math.max(1e-6, s0 + s1);
      this._segEls[0].style.width = ((100 * s0) / total).toFixed(2) + '%';
      this._segEls[1].style.width = ((100 * s1) / total).toFixed(2) + '%';

      // Mirror into the match-header card badges (single source of truth).
      const mh = this.viewer.matchHeader;
      if (mh && typeof mh.setDominance === 'function') {
        mh.setDominance(this._players[0].id, String(d0), b0.token);
        mh.setDominance(this._players[1].id, String(d1), b1.token);
      }
    }
  }

  window.DominanceBar = DominanceBar;
})();
