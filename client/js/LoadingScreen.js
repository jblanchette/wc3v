/**
 * LoadingScreen — staged, verbose viewer loading overlay.
 *
 * Replaces the old #loading-overlay (spinner + one text line), the vestigial
 * #loading-icon, and the ?local=ID #local-loading-overlay with a single
 * body-level card: a step checklist (pending / active / done / skipped /
 * warn), per-step live counters ("Trees 87 / 130", "12.4 MB / 38.1 MB"),
 * one weighted overall progress bar, and a detail line. No time estimates —
 * progression is the step list filling in.
 *
 * Robustness lives HERE, not at call sites:
 *   - unknown step ids are ignored (mobile plan drops the 3D steps, but the
 *     3D code paths still emit ticks on desktop-only reloads mid-flight);
 *   - beginStep(id) force-completes every earlier unfinished step, so a
 *     skipped endStep can never wedge a phase;
 *   - counters auto-complete their step when full;
 *   - finish() force-completes everything — overall completion is driven
 *     externally by setLoadingStatus(false), exactly like the old overlay;
 *   - progress arriving after finish() is dropped.
 *
 * The bar is clamped monotonic: weighted fractions only ever move it forward,
 * so a step whose byte total turns out wrong (gzip Content-Length is the
 * compressed size while the reader yields decompressed bytes) degrades to an
 * "X MB received" indeterminate mode instead of walking the bar backwards.
 */
(function () {
  const FADE_MS = 220;
  // An active step with no counter still contributes some fraction so the
  // bar creeps during indeterminate phases (JSON decode, IDB hydrate).
  const INDETERMINATE_ACTIVE_FRAC = 0.35;
  // Asymptote for byte progress with no usable total: frac approaches 0.95
  // as bytes stream in, scaled so ~4 MB received reads as halfway.
  const NO_TOTAL_SCALE_BYTES = 4 * 1024 * 1024;

  const STATUS_GLYPH = {
    pending: '○',   // ○
    active:  '◆',   // ◆
    done:    '✓',   // ✓
    skipped: '—',   // —
    warn:    '⚠',   // ⚠
    error:   '✕'    // ✕
  };

  function fmtBytes (n) {
    if (!(n > 0)) return '0 KB';
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  class LoadingScreen {
    constructor (viewer) {
      this.viewer = viewer || null;
      this.root = null;
      this.titleEl = null;
      this.stepsEl = null;
      this.barEl = null;
      this.barFillEl = null;
      this.percentEl = null;
      this.detailEl = null;
      this.steps = new Map();     // id → step state
      this.order = [];            // step ids in plan order
      this.finished = false;
      this.failed = false;
      this._maxOverallFrac = 0;
      this._fadeTimer = null;
    }

    setup () {
      // Adopt the inline boot block (script-loading coverage) — the real
      // overlay takes over in the same visual position.
      const boot = document.getElementById('boot-loading');
      if (boot) boot.remove();
      const bootStyle = document.getElementById('boot-loading-style');
      if (bootStyle) bootStyle.remove();

      this.root = document.createElement('div');
      this.root.className = 'ls-overlay';
      this.root.innerHTML = `
        <div class="ls-card">
          <div class="ls-title"></div>
          <ul class="ls-steps"></ul>
          <div class="ls-bar-row">
            <div class="ls-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div class="ls-bar-fill"></div>
            </div>
            <span class="ls-percent">0%</span>
          </div>
          <div class="ls-detail" role="status" aria-live="polite"></div>
        </div>`;
      document.body.appendChild(this.root);

      this.titleEl = this.root.querySelector('.ls-title');
      this.stepsEl = this.root.querySelector('.ls-steps');
      this.barEl = this.root.querySelector('.ls-bar');
      this.barFillEl = this.root.querySelector('.ls-bar-fill');
      this.percentEl = this.root.querySelector('.ls-percent');
      this.detailEl = this.root.querySelector('.ls-detail');
    }

    destroy () {
      if (this._fadeTimer) clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
      if (this.root) this.root.remove();
      this.root = null;
      this.steps.clear();
      this.order = [];
    }

    setTitle (text) {
      if (this.titleEl) this.titleEl.textContent = text || '';
    }

    // steps: [{ id, label, weight }] — resets all step state and renders rows.
    definePlan (steps) {
      if (!this.root) return;
      this.steps.clear();
      this.order = [];
      this.finished = false;
      this.failed = false;
      this._maxOverallFrac = 0;
      this.stepsEl.innerHTML = '';

      steps.forEach(({ id, label, weight }) => {
        const li = document.createElement('li');
        li.className = 'ls-step is-pending';
        li.innerHTML = `
          <span class="ls-step-icon" aria-hidden="true">${STATUS_GLYPH.pending}</span>
          <span class="ls-step-label"></span>
          <span class="ls-step-count"></span>`;
        li.querySelector('.ls-step-label').textContent = label;
        this.stepsEl.appendChild(li);

        this.steps.set(id, {
          id, label,
          weight: weight || 1,
          state: 'pending',
          countDone: 0, countTotal: 0,
          bytesLoaded: 0, bytesTotal: 0, bytesOverrun: false,
          el: li,
          iconEl: li.querySelector('.ls-step-icon'),
          countEl: li.querySelector('.ls-step-count')
        });
        this.order.push(id);
      });
      this._renderBar();
    }

    show () {
      if (!this.root) return;
      if (this._fadeTimer) { clearTimeout(this._fadeTimer); this._fadeTimer = null; }
      this.root.classList.remove('ls-fade-out');
      this.root.style.display = '';
    }

    // Force-complete everything and fade out. Called via setLoadingStatus(false).
    finish () {
      if (!this.root || this.finished) return;
      this.finished = true;
      for (const s of this.steps.values()) {
        if (!this._isTerminal(s.state)) this._setState(s, 'done');
      }
      this._maxOverallFrac = 1;
      this._renderBar();
      this.root.classList.add('ls-fade-out');
      this._fadeTimer = setTimeout(() => {
        if (this.root) this.root.style.display = 'none';
      }, FADE_MS);
    }

    // Hard failure (replay 404, parse timeout): keep the overlay up with a
    // clear message instead of the old eternal spinner.
    fail (message) {
      if (!this.root || this.finished) return;
      this.failed = true;
      for (const s of this.steps.values()) {
        if (s.state === 'active') this._setState(s, 'error');
      }
      if (this.detailEl) {
        this.detailEl.textContent = `${message} — reload the page to try again.`;
        this.detailEl.classList.add('is-error');
      }
    }

    // Phase boundary: marks `id` active and force-completes every earlier
    // step still in flight. Call only when the prior phase is truly over.
    beginStep (id) {
      const step = this._get(id);
      if (!step) return;
      for (const prevId of this.order) {
        if (prevId === id) break;
        const prev = this.steps.get(prevId);
        if (!this._isTerminal(prev.state)) this._setState(prev, 'done');
      }
      if (!this._isTerminal(step.state)) this._setState(step, 'active');
      this._renderBar();
    }

    stepProgress (id, done, total) {
      const step = this._liveStep(id);
      if (!step) return;
      step.countDone = done;
      step.countTotal = total;
      this._afterCounterChange(step);
    }

    stepTick (id, n = 1) {
      const step = this._liveStep(id);
      if (!step) return;
      step.countDone += n;
      this._afterCounterChange(step);
    }

    // Grow a total incrementally (e.g. neutral buildings register their group
    // count, then player buildings add theirs).
    stepAddTotal (id, n) {
      const step = this._liveStep(id);
      if (!step) return;
      step.countTotal += n;
      this._afterCounterChange(step);
    }

    stepBytes (id, loaded, total) {
      const step = this._liveStep(id);
      if (!step) return;
      step.bytesLoaded = loaded;
      step.bytesTotal = total || 0;
      // Content-Encoding: gzip — the reader yields decompressed bytes while
      // Content-Length was the compressed size. Switch to "received" mode.
      step.bytesOverrun = !total || loaded > total;
      this._renderStepCount(step);
      this._renderBar();
    }

    setDetail (id, text) {
      if (this.finished || this.failed || !this.detailEl) return;
      // id kept for symmetry/call-site clarity; the single detail line always
      // shows the most recent message.
      this.detailEl.textContent = text || '';
    }

    endStep (id, status = 'done') {
      const step = this._get(id);
      if (!step || this._isTerminal(step.state)) return;
      this._setState(step, status);
      this._renderBar();
    }

    ////
    // internals
    ////

    _get (id) {
      return this.steps.get(id) || null;
    }

    // Progress mutators: drop after finish, ignore unknown ids, and
    // auto-activate a pending step (ticks can precede its beginStep).
    _liveStep (id) {
      if (this.finished) return null;
      const step = this._get(id);
      if (!step || this._isTerminal(step.state)) return null;
      if (step.state === 'pending') this._setState(step, 'active');
      return step;
    }

    _isTerminal (state) {
      return state === 'done' || state === 'skipped' || state === 'warn' || state === 'error';
    }

    _setState (step, state) {
      step.state = state;
      step.el.className = `ls-step is-${state}`;
      step.iconEl.textContent = STATUS_GLYPH[state] || STATUS_GLYPH.pending;
      this._renderStepCount(step);
    }

    _afterCounterChange (step) {
      if (step.countTotal > 0 && step.countDone >= step.countTotal) {
        this._setState(step, 'done');
      } else {
        this._renderStepCount(step);
      }
      this._renderBar();
    }

    _renderStepCount (step) {
      let text = '';
      if (step.bytesLoaded > 0) {
        text = (step.bytesOverrun || this._isTerminal(step.state))
          ? fmtBytes(step.bytesLoaded)
          : `${fmtBytes(step.bytesLoaded)} / ${fmtBytes(step.bytesTotal)}`;
      } else if (step.countTotal > 0) {
        text = `${Math.min(step.countDone, step.countTotal)} / ${step.countTotal}`;
      }
      step.countEl.textContent = text;
    }

    _stepFrac (step) {
      if (this._isTerminal(step.state)) return 1;
      if (step.bytesLoaded > 0) {
        if (step.bytesTotal > 0 && !step.bytesOverrun) {
          return Math.min(step.bytesLoaded / step.bytesTotal, 1);
        }
        // No trustworthy total — asymptotic, monotonic, capped.
        return Math.min(0.95, step.bytesLoaded / (step.bytesLoaded + NO_TOTAL_SCALE_BYTES));
      }
      if (step.countTotal > 0) return Math.min(step.countDone / step.countTotal, 1);
      return step.state === 'active' ? INDETERMINATE_ACTIVE_FRAC : 0;
    }

    _renderBar () {
      if (!this.barFillEl) return;
      let weightSum = 0;
      let acc = 0;
      for (const s of this.steps.values()) {
        weightSum += s.weight;
        acc += s.weight * this._stepFrac(s);
      }
      const frac = weightSum > 0 ? acc / weightSum : 0;
      this._maxOverallFrac = Math.max(this._maxOverallFrac, frac);
      const pct = Math.round(this._maxOverallFrac * 100);
      this.barFillEl.style.width = `${pct}%`;
      if (this.barEl) this.barEl.setAttribute('aria-valuenow', String(pct));
      if (this.percentEl) this.percentEl.textContent = `${pct}%`;
    }
  }

  window.LoadingScreen = LoadingScreen;
})();
