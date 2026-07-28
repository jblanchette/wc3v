/**
 * DirectorOverlay — makes an AUTO-mode transition read as a deliberate
 * directorial choice instead of client lag.
 *
 * The problem it solves: AUTO would re-frame and change playback speed at the
 * same time, continuously, with the only feedback being a small "AUTO 3.4x"
 * readout in the scrubber. A viewer watching the camera drift toward a fight
 * while the time-scale slid underneath it had no way to tell the difference
 * between "the director is cutting to something" and "this page is janky".
 *
 * So a transition is now an EVENT with a beginning and an end, and it is
 * announced:
 *   - letterbox bars slide in while the transition runs, and retract when the
 *     camera has arrived. Their presence is the "we are moving" signal, and
 *     they mask the pan itself.
 *   - a shot card names what we are cutting to and shows the speed change.
 *
 * Purely presentational: it renders what AutoDirector tells it, and never
 * decides anything. All animation is CSS transform/opacity (compositor-only,
 * no layout), and the whole thing is skipped under prefers-reduced-motion
 * except the card, which is the part that carries the information.
 */
(function () {
  const CARD_HOLD_MS = 1200;   // how long the shot card stays up once the move ends

  class DirectorOverlay {
    constructor (viewer) {
      this.viewer = viewer;
      this.root = null;
      this.barTop = null;
      this.barBottom = null;
      this.card = null;
      this.cardTitle = null;
      this.cardSpeed = null;
      this._active = false;
      this._cardTimer = null;
      this._reduceMotion = false;
    }

    setup () {
      if (this.root) return;
      // Mount on the MAP box, not the gameplay column. #canvas-group is the
      // canvas stack's own positioned wrapper, so the letterbox bars frame the
      // map itself — mounting a level up letterboxed the match header and the
      // scrubber instead, which is chrome, not picture.
      const host = document.getElementById('canvas-group') ||
        document.getElementById('map-container') ||
        document.getElementById('gameplay-area') || document.body;

      const root = document.createElement('div');
      root.id = 'director-overlay';
      root.className = 'director-overlay';
      root.setAttribute('aria-hidden', 'true');

      this.barTop = document.createElement('div');
      this.barTop.className = 'do-bar do-bar-top';
      this.barBottom = document.createElement('div');
      this.barBottom.className = 'do-bar do-bar-bottom';

      // Announced politely: a screen-reader user gets the shot change as text
      // without the decorative bars.
      this.card = document.createElement('div');
      this.card.className = 'do-card';
      this.card.setAttribute('role', 'status');
      this.card.setAttribute('aria-live', 'polite');
      this.cardTitle = document.createElement('div');
      this.cardTitle.className = 'do-card-title';
      this.cardSpeed = document.createElement('div');
      this.cardSpeed.className = 'do-card-speed';
      this.card.appendChild(this.cardTitle);
      this.card.appendChild(this.cardSpeed);

      root.appendChild(this.barTop);
      root.appendChild(this.barBottom);
      root.appendChild(this.card);
      host.appendChild(root);
      this.root = root;

      try {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._reduceMotion = !!mq.matches;
        if (mq.addEventListener) mq.addEventListener('change', e => { this._reduceMotion = !!e.matches; });
      } catch (e) { /* matchMedia unavailable — keep motion */ }
    }

    /**
     * A transition has begun.
     * @param {string} label     what we're cutting to, e.g. "BATTLE · MID"
     * @param {string} icon      short glyph, e.g. "⚔"
     * @param {number} fromSpeed playback multiplier before the change
     * @param {number} toSpeed   playback multiplier after
     */
    beginTransition (label, icon, fromSpeed, toSpeed) {
      if (!this.root) this.setup();
      if (!this.root) return;

      this._active = true;
      clearTimeout(this._cardTimer);

      this.cardTitle.textContent = `${icon || '●'} ${label || 'AUTO'}`;
      const from = this._fmt(fromSpeed);
      const to = this._fmt(toSpeed);
      // Only show the arrow when the speed actually changes — otherwise the card
      // would claim a speed change that isn't happening.
      this.cardSpeed.textContent = (from === to) ? `${to}×` : `${from}× ▸ ${to}×`;
      this.cardSpeed.classList.toggle('do-slower', toSpeed < fromSpeed);
      this.cardSpeed.classList.toggle('do-faster', toSpeed > fromSpeed);

      this.root.classList.toggle('do-reduced', this._reduceMotion);
      this.root.classList.add('do-active');
      this.root.classList.add('do-card-visible');
    }

    /** The camera has arrived and the shot is holding. */
    endTransition () {
      if (!this.root || !this._active) return;
      this._active = false;
      this.root.classList.remove('do-active');   // bars retract
      clearTimeout(this._cardTimer);
      this._cardTimer = setTimeout(() => {
        if (this.root) this.root.classList.remove('do-card-visible');
      }, CARD_HOLD_MS);
    }

    /** Hard reset — leaving AUTO, seeking, or tearing down the replay. */
    clear () {
      if (!this.root) return;
      this._active = false;
      clearTimeout(this._cardTimer);
      this.root.classList.remove('do-active');
      this.root.classList.remove('do-card-visible');
    }

    destroy () {
      clearTimeout(this._cardTimer);
      if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
      this.root = null;
    }

    _fmt (s) {
      if (s == null) return '1';
      // One decimal only when it says something (2.5x yes, 2.0x no).
      return (Math.round(s * 10) % 10 === 0) ? String(Math.round(s)) : s.toFixed(1);
    }
  }

  window.DirectorOverlay = DirectorOverlay;
})();
