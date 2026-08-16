/**
 * HudCharts — the always-on match graphs pinned to the bottom-centre of the
 * viewer, just above the scrubber. Two stacked rows:
 *
 *   1. Dominance — the 0-100 momentum split, as HISTORY. No numeric readout:
 *      DominanceBar (under the match header) owns the current value, and
 *      showing the same number twice on one screen is noise.
 *   2. Food — supply used per player, with the WC3 upkeep lines at 50 and 80.
 *
 * These used to be SVG charts inside a BottomPanel tab that is collapsed by
 * default and whose per-frame cursor updates were gated off whenever it was
 * hidden — so in practice nobody ever saw them.
 *
 * WHY ITS OWN CANVAS. The five map canvases work in LOGICAL space (the map
 * image, 1568-2240px) and are CSS-downscaled with object-fit:contain, so they
 * letterbox and their text needs an sx correction to stay legible. This canvas
 * is sized in REAL CSS PIXELS x DPR and positioned by CSS against #main-wrapper,
 * so 1 unit here is 1 CSS pixel, text is crisp, and "10px above the scrubber"
 * means exactly that. It is a sibling of #canvas-group, never a child — that
 * container carries the live-mode transform and the letterbox box.
 *
 * PER-FRAME COST. Everything static — panel chrome, axes, gridlines, row
 * titles, and BOTH players' full polylines — is rasterized once into two
 * offscreen bitmaps at build/resize time. A frame is:
 *
 *     clearRect, drawImage(chrome), clip, drawImage(bright), 2x fillRect, 2x fillText
 *
 * with zero allocations, zero measureText and zero layout reads. Progressive
 * reveal is a clip on the second blit, not a path rebuild.
 */

(function () {
  // Plate geometry. The panel is a cast slab with a channel cut per row —
  // see client/js/ForgedPanel.js for the material and why it looks like this.
  const PAD_X = 11;
  const PAD_Y = 9;
  // Right gutter only: live readouts and the EVEN groove label. The old
  // 106px left wordmark gutter is gone — row titles are engraved inside
  // their channels, so the plot gets the width and no text can reach the
  // plate corners.
  //
  // A readout is [race portrait][gap][numeral]: the portrait says WHOSE
  // number it is, so the numeral itself is neutral ink. Player-coloured
  // numerals read as a status colour (good/bad/warning) rather than as
  // identity, which is exactly what they are not.
  const ICON_PX = 18;      // inline glyph — see the note in _paintReadouts
  const ICON_GAP = 5;
  const NUM_W = 28;        // 3 digits of 15px Consolas, measured
  const VALUE_W = ICON_PX + ICON_GAP + NUM_W + 5;
  const ROW_H = 40;        // bronze housing; the cut channel is LIP smaller
  const ROW_GAP = 10;
  const CHAMFER = 10;
  // Visible bronze lip between the housing edge and the channel floor. This
  // is the whole reason the plot reads as cut into metal rather than painted
  // onto it — see .dom-track's note about 2px vanishing.
  const LIP = 4;

  // Under the 12.8px floor on purpose (user call): the wordmark is engraved
  // chrome naming a channel, not information text, and at 12.8 it competed
  // with the plot it labels. The readouts — the actual data — stay at 15.
  const TITLE_PX = 11;
  const VALUE_PX = 15;

  // Below this the HUD hides rather than render something unreadable.
  const MIN_W = 360;

  // Static time-axis start, shared by both rows. Never 0:00: before the
  // first supply-carrying event (~10-20s) the resource series is a
  // meaningless 0/0 flat, and nothing a chart can show happens before the
  // first food building. Corpus (334 pro replays / 393 players): first
  // food-provider completion — the first foodMax rise in resourceSeries —
  // lands at mean 33s, median 20s, p90 40s. Mean minus a ~10s lead-in,
  // rounded to the sample grid: 0:20.
  const START_T_MS = 20 * 1000;

  const FAINT_ALPHA = 0.20;   // the not-yet-played portion of every line

  // Race portraits for the readout gutter, shared across instances (the viewer
  // rebuilds this class on every replay load). Records are { img, ok, failed,
  // waiting } — `waiting` holds the invalidate callbacks of every instance that
  // asked for the icon before it landed, so a HUD built during the load still
  // repaints once the portrait arrives instead of keeping its fallback chip.
  const ICON_CACHE = new Map();

  // WC3 upkeep thresholds. Real reference lines, not decoration: crossing 50
  // costs 30% of gold income and crossing 80 costs 60%.
  const UPKEEP_LOW = 50;
  const UPKEEP_HIGH = 80;

  // Tier lanes. With exactly two players the food channel splits in half and
  // each half is washed with its owner's colour, stepping brighter when that
  // player techs. Tier is background context — which units they can even
  // build — so it belongs behind the plot rather than as a third line in it.
  //
  // The step is ALPHA, not hue: a hue shift would put a second identity colour
  // in a lane whose entire job is to say "this player", and the lane must not
  // stop being theirs when they hit T2. Index is the tier; 0 is unused.
  //
  // T1 is 0.10, not the 0.06 it started at: below that the two halves are
  // invisible for the whole opening and the split only appears when somebody
  // techs, which is backwards — the lane says whose half it is, the step says
  // what they have. Measured against the plate at 1x and 2x.
  const TIER_ALPHA = [0, 0.10, 0.18, 0.28];
  // The unplayed part of the ribbon, same idea as FAINT_ALPHA on the lines —
  // the tier timeline is visible ahead of the cursor but recessed, and the
  // reveal clip brings it up as playback reaches it.
  const TIER_FAINT = 0.34;
  const TIER_MARK_PX = 11;   // engraved chrome, same exception as TITLE_PX

  class HudCharts {
    constructor (viewer) {
      this.viewer = viewer;
      this.canvas = null;
      this.ctx = null;
      this._ro = null;

      this._dom = null;        // [{ id, color, samples }]
      this._food = null;       // [{ id, color, series }]
      this._t0 = 0;            // effective axis start, resolved in build()
      this._endT = 0;

      // Idle-fade state — see the fade block in mount().
      this._fadeRect = null;
      this._hover = false;
      this._onMouseMove = null;
      this._fadeTimer = null;

      this._rows = [];         // built layout, one entry per visible row
      this._bmpChrome = null;
      this._bmpBright = null;

      this._cssW = 0;
      this._cssH = 0;
      this._dpr = 1;
      this._built = false;
      this._dirty = true;
      this._visible = false;
      this._lastT = -1;

      // Zero-allocation integer formatting for the food readouts. Supply caps
      // at 100; 201 covers any oddity without a String() on the render path.
      this._nums = null;

      // Handed to ICON_CACHE records so a late-arriving portrait triggers a
      // rebuild. Bound once — the record dedupes on identity.
      this._onIconLoad = () => this.invalidate();
    }

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------

    mount () {
      // The wrapper owns the positioning; the canvas just fills it. Sizing a
      // <canvas> directly with left/right insets does not work — it is a
      // REPLACED element, so `width:auto` resolves from its intrinsic 300x150
      // ratio and the insets are dropped. See main.css #hud-charts.
      this.wrap = document.getElementById('hud-charts');
      this.canvas = document.getElementById('hud-charts-canvas');
      if (!this.canvas || !this.wrap) return false;
      this.ctx = this.canvas.getContext('2d');

      // ResizeObserver entries carry a POST-LAYOUT rect, so reading size here
      // never forces a reflow. This class must never touch clientWidth — see
      // GameScaler.beginFrame for what that costs mid-frame.
      if (typeof ResizeObserver !== 'undefined') {
        this._ro = new ResizeObserver(entries => {
          const e = entries[entries.length - 1];
          if (!e) return;
          const r = e.contentRect;
          this._resize(r.width, r.height);
          // RO fires post-layout, so this read is the one place a
          // getBoundingClientRect here cannot force a reflow. The screen box
          // feeds the idle-fade hover test below.
          this._fadeRect = this.canvas.getBoundingClientRect();
        });
        this._ro.observe(this.canvas);
      }

      // Idle fade. The HUD starts semi-transparent and settles to a fainter
      // resting state (.hud-dim, main.css) so it reads as ambient
      // instrumentation rather than a panel parked over the map. Pointer
      // proximity restores it; while the pointer stays inside it holds at the
      // bright end. The wrapper is pointer-events:none ON PURPOSE — the map
      // underneath keeps its clicks and drags — so hover cannot be CSS
      // :hover; it is a point-in-rect test against the cached screen box.
      this._onMouseMove = (e) => this._fadeTrack(e.clientX, e.clientY);
      document.addEventListener('mousemove', this._onMouseMove, { passive: true });
      return true;
    }

    // dominanceInfos: [{ id, color, samples:[{t,score}] }] — pass null/[] to
    //   omit the dominance row (non-1v1, or no dominance data).
    // foodInfos: [{ id, color, race, tiers, series:[{t,foodUsed,foodMax}] }] —
    //   `race` is a RaceLabels key ('O'/'H'/'U'/'E') and picks the readout
    //   portrait; `tiers` is [{t,tier}] and drives the lane ribbon (two
    //   players only). Both are optional.
    setPlayers (dominanceInfos, foodInfos) {
      this._dom = (dominanceInfos && dominanceInfos.length >= 2) ? dominanceInfos : null;
      this._food = (foodInfos && foodInfos.length) ? foodInfos : null;
      this._built = false;
      this._dirty = true;
    }

    setVisible (on) {
      this._visible = !!on;
      if (this.wrap) {
        this.wrap.classList.toggle('hud-on', this._visible);
        // Restart the idle fade from its bright end on every show. The dim
        // class lands a beat later so the element is displayed (and painted)
        // first — a class applied in the same frame as display:block would
        // skip the transition and snap straight to the resting state.
        this.wrap.classList.remove('hud-dim');
        clearTimeout(this._fadeTimer);
        if (this._visible) {
          this._fadeTimer = setTimeout(() => {
            if (this._visible && !this._hover && this.wrap) {
              this.wrap.classList.add('hud-dim');
            }
          }, 120);
        }
      }
      this._dirty = true;
    }

    // Point-in-rect hover for the idle fade. Runs on every document
    // mousemove, so it only compares against the cached box — no DOM reads,
    // and no writes unless the inside/outside state actually flips.
    _fadeTrack (x, y) {
      if (!this._visible || !this.wrap) return;
      const r = this._fadeRect;
      if (!r) return;
      const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      if (inside === this._hover) return;
      this._hover = inside;
      // Inside: hold at the bright end. Leaving: let the slow fade resume.
      this.wrap.classList.toggle('hud-dim', !inside);
    }

    invalidate () {
      this._built = false;
      this._dirty = true;
    }

    destroy () {
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      if (this._onMouseMove) {
        document.removeEventListener('mousemove', this._onMouseMove);
        this._onMouseMove = null;
      }
      clearTimeout(this._fadeTimer);
      // The bitmaps are the only large allocation here and the viewer rebuilds
      // its subsystems on every replay load, so dropping them matters.
      this._bmpChrome = null;
      this._bmpBright = null;
      this._rows.length = 0;
      this._built = false;
      if (this.wrap) this.wrap.classList.remove('hud-on', 'hud-dim');
    }

    _resize (cssW, cssH) {
      if (Math.abs(cssW - this._cssW) < 0.5 && Math.abs(cssH - this._cssH) < 0.5) return;
      this._cssW = cssW;
      this._cssH = cssH;
      // A collapsed or hidden box reports 0. Drop the built state rather than
      // keeping a stale bitmap alive against a size that no longer exists —
      // CSS hides the element below the fit threshold, but the observer still
      // fires and this must not be left claiming it is built.
      this._built = false;
      this._dirty = true;
      if (!(cssW > 0) || !(cssH > 0)) {
        this._bmpChrome = null;
        this._bmpBright = null;
        this._rows.length = 0;
      }
    }

    // ------------------------------------------------------------------
    // Build — runs on first draw and on a real resize. Never per frame.
    // ------------------------------------------------------------------

    build () {
      const cssW = this._cssW, cssH = this._cssH;
      if (!this.ctx || !(cssW > 0) || !(cssH > 0)) return false;
      if (!this._dom && !this._food) return false;
      if (cssW < MIN_W) return false;

      const cfg = (window.WC3V_CONFIG && window.WC3V_CONFIG.perf) || {};
      // NOT canvasRenderDprCap (1.0). That cap exists because the five map
      // canvases are viewport-sized and rasterized every frame five times over,
      // where retina supersampling is pure fill-rate loss. This canvas is
      // <=600x96 CSS px and is rasterized ONCE into a bitmap; legibility is the
      // whole point of the feature. 2 rather than uncapped so a 3x phone panel
      // doesn't pay 2.25x for a difference nobody can see.
      const cap = (typeof cfg.hudChartsDpr === 'number' && cfg.hudChartsDpr > 0)
        ? cfg.hudChartsDpr : 2;
      const dpr = Math.min((window.devicePixelRatio || 1), cap);
      this._dpr = dpr;

      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);

      // The housing spans everything but the right readout gutter; the plot
      // is the channel inside it.
      const frameX = PAD_X;
      const frameW = Math.max(40 + LIP * 2, cssW - frameX - VALUE_W - PAD_X);
      const plotX = frameX + LIP;
      const plotW = frameW - LIP * 2;

      // Time domain — shared by both rows so the two cursors line up. The
      // static trim only applies when the match is long enough to have a
      // life after it; a degenerate sub-minute replay keeps the full axis.
      this._endT = this._matchEnd();
      this._t0 = (this._endT - START_T_MS > 40 * 1000) ? START_T_MS : 0;
      if (!(this._endT > this._t0)) this._endT = this._t0 + 1;

      this._rows.length = 0;
      let y = PAD_Y;
      const geom = (fy) => ({
        fx: frameX, fy, fw: frameW, fh: ROW_H,            // bronze housing
        x: plotX, y: fy + LIP, w: plotW, h: ROW_H - LIP * 2   // cut channel = the plot
      });
      if (this._dom) {
        this._rows.push(this._buildDomRow(geom(y)));
        y += ROW_H + ROW_GAP;
      }
      if (this._food) {
        this._rows.push(this._buildFoodRow(geom(y)));
        y += ROW_H + ROW_GAP;
      }
      if (!this._rows.length) return false;

      if (!this._nums) {
        this._nums = new Array(201);
        for (let i = 0; i <= 200; i++) this._nums[i] = String(i);
      }
      this._paintBitmaps(cssW, cssH, dpr);
      this._built = true;
      this._dirty = true;
      return true;
    }

    _matchEnd () {
      let end = 0;
      if (this._dom) {
        for (const p of this._dom) {
          const s = p.samples;
          if (s && s.length) end = Math.max(end, s[s.length - 1].t);
        }
      }
      if (this._food) {
        for (const p of this._food) {
          const s = p.series;
          if (s && s.length) end = Math.max(end, s[s.length - 1].t);
        }
      }
      const mt = this.viewer && this.viewer.matchEndTime;
      if (mt > end) end = mt;
      return end;
    }

    _buildDomRow (g) {
      // Same fitted band DominanceChart uses (padded, symmetric-ish about 50,
      // min span 30) — a hard 0-100 axis flattens a game that lived in 40-60.
      let lo = 50, hi = 50;
      for (const p of this._dom) {
        for (const s of p.samples) {
          if (s.score < lo) lo = s.score;
          if (s.score > hi) hi = s.score;
        }
      }
      const yMin = Math.max(0, Math.min(35, Math.floor(lo - 5)));
      const yMax = Math.min(100, Math.max(65, Math.ceil(hi + 5)));
      return Object.assign({}, g, {
        kind: 'dom', title: 'DOMINANCE',
        yMin, yMax,
        series: this._dom.map(p => ({ color: p.color, pts: p.samples, key: 'score' })),
        // No numeric readout — DominanceBar above owns the current split, and
        // the same number twice on one screen is noise. The right gutter names
        // the reference groove instead, so it reads as labelled, not empty.
        readout: false,
        gutterMark: { text: 'EVEN', v: 50 },
        guides: [{ v: 50, strong: true }]
      });
    }

    _buildFoodRow (g) {
      // Fixed to the WHOLE-GAME max, unlike the old ResourceCharts which
      // rescaled to the max up to the cursor. A pre-rendered bitmap can't
      // rescale — and a fixed axis is also the only way the curve is
      // comparable across the whole match. Early game reads flatter than it
      // used to; that is the trade, and it is deliberate.
      let max = 12;
      for (const p of this._food) {
        for (const s of p.series) {
          if (s.foodUsed > max) max = s.foodUsed;
        }
      }
      max = Math.ceil(max / 10) * 10;
      const guides = [];
      if (max > UPKEEP_LOW) guides.push({ v: UPKEEP_LOW });
      if (max > UPKEEP_HIGH) guides.push({ v: UPKEEP_HIGH, strong: true });
      return Object.assign({}, g, {
        kind: 'food', title: 'FOOD',
        yMin: 0, yMax: max,
        series: this._food.map(p => ({
          color: p.color, pts: p.series, key: 'foodUsed', race: p.race,
          tiers: p.tiers
        })),
        readout: true,
        // Half the channel per player, only at two players. At three or four
        // the lanes are 8px tall and a tier mark cannot be set in them, so the
        // row falls back to a plain channel rather than an illegible one. The
        // dominance row never gets lanes: it is already split about the 50
        // groove and a second split would fight it.
        lanes: this._food.length === 2,
        guides
      });
    }

    // tierStream -> contiguous [{from, to, tier}] across the visible axis,
    // with tier 1 filling anything the stream does not cover.
    //
    // These are the times the upgrade was ORDERED, not finished (lib/Building.js
    // fires the tier event at initiation), which is also the instant the player
    // status box starts reading "Tier N". Adding the ~140s build time here would
    // put two surfaces in the same viewer on different tiers at the same moment.
    _tierSegments (tiers) {
      const out = [];
      let tier = 1;
      let from = this._t0;
      if (tiers) {
        for (const e of tiers) {
          if (!e || !(e.tier > tier)) continue;   // stream is ordered; ignore repeats
          if (e.t <= this._t0) { tier = e.tier; continue; }
          if (e.t >= this._endT) break;
          out.push({ from, to: e.t, tier });
          from = e.t;
          tier = e.tier;
        }
      }
      out.push({ from, to: this._endT, tier });
      return out;
    }

    // One lane per player, painted straight onto the channel floor so the
    // minute grid, the upkeep grooves, the curves and the glass all sit over
    // it. Lane order matches the readout gutter (series 0 on top), so the
    // portrait beside each numeral names the lane it lines up with.
    //
    // Called twice: faint into the chrome bitmap, full strength into bright,
    // so the progressive reveal clip lifts the ribbon exactly as it does the
    // lines. The lane divider is static chrome and only goes into the first
    // pass; the tier marks are a separate pass (_paintTierMarks) that has to
    // run after the curves are down.
    _paintTierLanes (g, row, opts) {
      const F = window.ForgedPanel;
      const n = row.series.length;
      const laneH = row.h / n;

      g.save();
      F.path(g, row.x, row.y, row.w, row.h, 4);
      g.clip();

      for (let si = 0; si < n; si++) {
        const s = row.series[si];
        const ly = row.y + si * laneH;
        for (const seg of this._tierSegments(s.tiers)) {
          const x0 = this._xOf(row, seg.from);
          const x1 = this._xOf(row, seg.to);
          if (x1 - x0 < 0.5) continue;
          g.fillStyle = this._rgba(s.color, TIER_ALPHA[seg.tier] * opts.mul);
          g.fillRect(x0, ly, x1 - x0, laneH);

          // The step itself, struck like the minute grid: a black cut with the
          // player's colour on its lit side. Teching up should read as an
          // event on the timeline, not as a gradient nobody notices.
          if (seg.from > this._t0) {
            const ex = Math.round(x0) + 0.5;
            g.fillStyle = 'rgba(0, 0, 0, ' + (0.7 * opts.mul) + ')';
            g.fillRect(ex - 1, ly, 1, laneH);
            g.fillStyle = this._rgba(s.color, 0.55 * opts.mul);
            g.fillRect(ex, ly, 1, laneH);
          }
        }
      }

      // Seam between the lanes. Without it two washes of nearby colour read as
      // one field and the halves stop being halves.
      if (opts.seam) {
        for (let si = 1; si < n; si++) {
          const sy = Math.round(row.y + si * laneH) + 0.5;
          g.fillStyle = 'rgba(0, 0, 0, 0.55)';
          g.fillRect(row.x, sy - 1, row.w, 1);
          g.fillStyle = 'rgba(201, 187, 150, 0.08)';
          g.fillRect(row.x, sy, row.w, 1);
        }
      }
      g.restore();
    }

    // 'T2' / 'T3' beside each step, into the BRIGHT bitmap after the curves
    // are down. Two reasons it is its own pass: a lane is 16px tall and both
    // food curves run straight through the middle of it, so a mark painted
    // with the ribbon gets sliced by the line it sits behind; and the bright
    // bitmap is the reveal layer, so the mark arrives as playback reaches the
    // tier instead of announcing it minutes early.
    _paintTierMarks (g, row) {
      const F = window.ForgedPanel;
      const n = row.series.length;
      const laneH = row.h / n;

      g.save();
      F.path(g, row.x, row.y, row.w, row.h, 4);
      g.clip();
      for (let si = 0; si < n; si++) {
        const s = row.series[si];
        const cy = row.y + si * laneH + laneH / 2;
        for (const seg of this._tierSegments(s.tiers)) {
          if (!(seg.from > this._t0)) continue;
          if (this._xOf(row, seg.to) - this._xOf(row, seg.from) < 0.5) continue;
          this._markTier(g, row, seg.tier, Math.round(this._xOf(row, seg.from)) + 0.5, cy);
        }
      }
      g.restore();
    }

    // Right of the cut normally; a tier reached late enough to run off the
    // channel flips to the left of it rather than being clipped, and one with
    // room on neither side is dropped — the step edge still carries the moment.
    _markTier (g, row, tier, ex, cy) {
      const F = window.ForgedPanel;
      const text = 'T' + tier;
      const w = F.measure(g, text, TIER_MARK_PX, { serif: true, tracking: 0.08 });
      let tx = ex + 5, align = 'left';
      if (tx + w > row.x + row.w - 2) { tx = ex - 5; align = 'right'; }
      const left = align === 'right' ? tx - w : tx;
      if (left < row.x + 2) return;

      // Seated on its own struck chip. Engrave's lowlight is a LIGHT pixel
      // under the glyphs, which does nothing over a bright curve — the mark
      // needs something dark of its own to sit on, the same way the in-game
      // UI backs a number it has to put over the field.
      g.save();
      g.fillStyle = 'rgba(0, 0, 0, 0.62)';
      g.fillRect(left - 3, cy - TIER_MARK_PX / 2 - 2, w + 6, TIER_MARK_PX + 4);
      g.restore();

      F.engrave(g, text, tx, cy, TIER_MARK_PX, {
        tracking: 0.08, align, color: 'rgba(201, 187, 150, 0.72)'
      });
    }

    // Vertical centre of one readout. Shared by the bitmap bake (portraits)
    // and the per-frame draw (numerals) so the two can never disagree.
    _readoutY (row, si) {
      return row.y + row.h / 2 - (row.series.length - 1) * 10 + si * 20;
    }

    // The race portrait for a readout, or null while it loads / if it fails.
    // Callers draw a same-size fallback chip on null so the gutter never pops.
    _icon (race) {
      const meta = (typeof RaceLabels !== 'undefined') ? RaceLabels[race] : null;
      if (!meta || !meta.icon) return null;
      const src = '/assets/wc3icons/' + meta.icon + '.jpg';

      let rec = ICON_CACHE.get(src);
      if (!rec) {
        rec = { img: new Image(), ok: false, failed: false, waiting: [] };
        ICON_CACHE.set(src, rec);
        rec.img.onload = () => {
          rec.ok = true;
          const w = rec.waiting;
          rec.waiting = [];
          for (const fn of w) fn();
        };
        rec.img.onerror = () => { rec.failed = true; rec.waiting = []; };
        rec.img.src = src;
      }
      if (rec.ok) return rec.img;
      // Still in flight: rebuild when it lands. A failed load never retries —
      // registering there would leak a callback per build forever.
      if (!rec.failed && rec.waiting.indexOf(this._onIconLoad) === -1) {
        rec.waiting.push(this._onIconLoad);
      }
      return null;
    }

    // ------------------------------------------------------------------
    // Bitmaps
    // ------------------------------------------------------------------

    _newBitmap (cssW, cssH, dpr) {
      const c = document.createElement('canvas');
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { canvas: c, ctx: g };
    }

    // Chrome carries the plate, the cut channels, the engraved wordmarks, the
    // etched reference grooves AND both series at low alpha; bright carries
    // ONLY the series at full strength on a transparent background. The split
    // is load-bearing: the reveal clip is applied to the bright blit alone, so
    // it can never brighten a wordmark or a stud.
    _paintBitmaps (cssW, cssH, dpr) {
      const F = window.ForgedPanel;
      const chrome = this._newBitmap(cssW, cssH, dpr);
      const bright = this._newBitmap(cssW, cssH, dpr);
      const g = chrome.ctx;

      F.chassis(g, 0, 0, cssW, cssH, { chamfer: CHAMFER });

      // No corner studs on this plate. The housings run nearly edge to edge
      // and the right gutter carries live readouts, so studs inside the
      // chamfers land under text or on the housing frames — the gauge keeps
      // them, this instrument keeps only the studs on each housing's lip.

      for (const row of this._rows) {
        // Bronze housing, then the channel cut into it. The LIP between the
        // two is what makes this read as metal rather than a painted band.
        F.frame(g, row.fx, row.fy, row.fw, row.fh, 7);
        F.well(g, row.x, row.y, row.w, row.h, 4);

        // Per-player tier lanes go on the bare channel floor, before anything
        // else is etched into it. Faint here, full strength into bright.
        if (row.lanes) {
          this._paintTierLanes(g, row, { mul: TIER_FAINT, seam: true });
          this._paintTierLanes(bright.ctx, row, { mul: 1 });
        }

        // Mounting studs on the housing lip, as on the gauge's rail.
        F.stud(g, row.fx + LIP / 2 + 1, row.fy + row.fh / 2, 1.8);
        F.stud(g, row.fx + row.fw - LIP / 2 - 1, row.fy + row.fh / 2, 1.8);

        // Engraved wordmark inside the channel's top-left — small on purpose:
        // it names the row, the plot is the point. (This was a 106px left
        // gutter of 12.8px tracked Georgia; the plot gets that width now.)
        F.engrave(g, row.title, row.x + 6, row.y + 9, TITLE_PX, { tracking: 0.06 });

        // Right gutter: name the reference groove on rows with no readout.
        if (row.gutterMark) {
          F.engrave(g, row.gutterMark.text,
                    cssW - PAD_X, this._yOf(row, row.gutterMark.v),
                    TITLE_PX, { tracking: 0.16, align: 'right' });
        }

        // Minute grid, etched into the channel floor. Without it the plot is
        // a curve floating in a black box with no sense of pace; with it the
        // reveal reads against real elapsed time. Interval picked to land
        // 4-8 divisions across whatever span this match actually has.
        const span = this._endT - this._t0;
        const step = [60, 120, 180, 300, 600, 900]
          .find(s => span / (s * 1000) <= 8) || 1200;
        g.save();
        F.path(g, row.x, row.y, row.w, row.h, 4);
        g.clip();
        for (let t = Math.ceil(this._t0 / (step * 1000)) * step * 1000;
             t < this._endT; t += step * 1000) {
          const gx = Math.round(this._xOf(row, t)) + 0.5;
          g.fillStyle = 'rgba(0, 0, 0, 0.55)';
          g.fillRect(gx - 1, row.y, 1, row.h);
          g.fillStyle = 'rgba(201, 187, 150, 0.07)';
          g.fillRect(gx, row.y, 1, row.h);
        }
        g.restore();

        // Reference grooves, cut into the channel floor (the 50 midline; the
        // 50/80 upkeep thresholds). Drawn as horizontal etch: a dark cut with
        // a struck highlight under it.
        for (const guide of row.guides) {
          const gy = Math.round(this._yOf(row, guide.v)) + 0.5;
          g.save();
          F.path(g, row.x, row.y, row.w, row.h, 4);
          g.clip();
          g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
          g.lineWidth = 1;
          g.beginPath(); g.moveTo(row.x, gy); g.lineTo(row.x + row.w, gy); g.stroke();
          g.strokeStyle = guide.strong
            ? 'rgba(201, 187, 150, 0.26)' : 'rgba(201, 187, 150, 0.13)';
          g.beginPath(); g.moveTo(row.x, gy + 1); g.lineTo(row.x + row.w, gy + 1); g.stroke();
          g.restore();
        }

        // Series. Faint into chrome, full strength into bright — each with a
        // filled body beneath it so the curve reads as something poured into
        // the channel rather than a hairline floating in it.
        for (const s of row.series) {
          this._strokeSeries(g, row, s, FAINT_ALPHA, 1.4, false);
          this._strokeSeries(bright.ctx, row, s, 1, 2, true);
        }

        // Tier marks go over the curves, not under them.
        if (row.lanes) this._paintTierMarks(bright.ctx, row);

        // Glass over the channel, last, so it sits on the fills.
        F.glass(g, row.x, row.y, row.w, row.h, 4);

        // Readout portraits. Static — position and image never change once
        // built — so they belong in the bitmap; only the numerals are drawn
        // per frame.
        if (row.readout) this._paintReadoutIcons(g, row, cssW);
      }

      this._bmpChrome = chrome.canvas;
      this._bmpBright = bright.canvas;
    }

    // Race portrait per readout, seated in a full-perimeter ring of the
    // player's colour — the site's "who owns this" language (.cam-race,
    // .ev-icon), and the only place colour appears in this gutter now that
    // the numerals are neutral. The ring also separates a mirror matchup,
    // where both portraits are the same image.
    //
    // 18px is an inline GLYPH read together with the number beside it, not a
    // standalone icon, so the project's 36px icon floor doesn't apply — same
    // exception the camera toolbar's 20px .cam-race takes, one size down
    // because the readout pitch here is 20px.
    _paintReadoutIcons (g, row, cssW) {
      const ix = cssW - PAD_X - NUM_W - ICON_GAP - ICON_PX;
      for (let si = 0; si < row.series.length; si++) {
        const s = row.series[si];
        const iy = Math.round(this._readoutY(row, si) - ICON_PX / 2);
        const img = this._icon(s.race);

        g.save();
        if (img) {
          g.drawImage(img, ix, iy, ICON_PX, ICON_PX);
        } else {
          // Same-size chip, so a portrait landing late swaps in place rather
          // than reflowing the gutter.
          g.fillStyle = s.color || '#555';
          g.fillRect(ix, iy, ICON_PX, ICON_PX);
        }
        g.lineWidth = 1;
        g.strokeStyle = s.color || '#888';
        g.strokeRect(ix + 0.5, iy + 0.5, ICON_PX - 1, ICON_PX - 1);
        // Hard black outer line — what seats it on the plate instead of
        // letting it float. No glow, per the material.
        g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
        g.strokeRect(ix - 0.5, iy - 0.5, ICON_PX + 1, ICON_PX + 1);
        g.restore();
      }
    }

    // One series. `body` fills the area between the curve and its baseline —
    // the dominance row fills back to the 50 line (so a lead reads as mass on
    // one side of even), the food row fills to the floor. Fill is shaded top
    // light / bottom dark like .dom-seg: a flat slab of colour reads as paint
    // no matter how good the hue is.
    _strokeSeries (g, row, s, alpha, width, body) {
      const pts = s.pts;
      if (!pts || pts.length < 2) return;
      const key = s.key;
      const baseY = row.kind === 'dom'
        ? this._yOf(row, 50)
        : row.y + row.h;

      // Trace the polyline. Samples before the axis start are skipped, but
      // the LAST pre-start sample decides where the line enters the left
      // edge — dominance samples are sparse event pairs, and dropping the
      // entry point outright would make a series that existed at t0 appear
      // minutes late. Dominance interpolates across the cut; food is a step
      // series, so it enters holding the pre-start value.
      const trace = () => {
        let began = false, endX = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          if (p.t < this._t0) continue;
          const px = this._xOf(row, p.t);
          const py = this._yOf(row, p[key]);
          if (!began) {
            if (i > 0 && p.t > this._t0) {
              const a = pts[i - 1];
              let v0 = a[key];
              if (row.kind === 'dom' && p.t !== a.t) {
                v0 += (p[key] - a[key]) * ((this._t0 - a.t) / (p.t - a.t));
              }
              g.moveTo(this._xOf(row, this._t0), this._yOf(row, v0));
              g.lineTo(px, py);
            } else {
              g.moveTo(px, py);
            }
            began = true;
          } else {
            g.lineTo(px, py);
          }
          endX = px;
        }
        return began ? endX : null;
      };

      g.save();
      // Everything this series draws stays inside its own channel.
      window.ForgedPanel.path(g, row.x, row.y, row.w, row.h, 4);
      g.clip();
      g.beginPath();
      const lastX = trace();
      if (lastX === null) { g.restore(); return; }

      if (body) {
        // Close down to the baseline and fill.
        g.lineTo(lastX, baseY);
        g.lineTo(this._xOf(row, this._t0), baseY);
        g.closePath();
        // Shaded like .dom-seg — bright where the light hits, deep at the
        // bottom. A flat wash of colour reads as paint no matter how good the
        // hue is, and at low alpha over a near-black channel it vanishes.
        const grad = g.createLinearGradient(0, row.y, 0, row.y + row.h);
        grad.addColorStop(0, this._rgba(s.color, 0.60));
        grad.addColorStop(0.55, this._rgba(s.color, 0.32));
        grad.addColorStop(1, this._rgba(s.color, 0.10));
        g.fillStyle = grad;
        g.fill();
      }

      // Re-trace for the stroke (the fill closed the path).
      g.beginPath();
      trace();
      g.lineJoin = 'round';
      g.lineCap = 'round';
      // Hard black backing under the curve — the in-game way to seat a bright
      // line on a dark field. No glow anywhere.
      if (body) {
        g.globalAlpha = 0.85;
        g.strokeStyle = '#000';
        g.lineWidth = width + 2;
        g.stroke();
      }
      g.globalAlpha = alpha;
      g.strokeStyle = s.color || '#888';
      g.lineWidth = width;
      g.stroke();
      g.restore();
    }

    // '#rrggbb' -> 'rgba(r,g,b,a)'. Memoized per (color, alpha) pair; this
    // runs only at build time but the parse is pure waste to repeat.
    _rgba (hex, a) {
      const key = hex + '|' + a;
      if (!this._rgbaCache) this._rgbaCache = new Map();
      let out = this._rgbaCache.get(key);
      if (out === undefined) {
        const h = String(hex || '#888888').replace('#', '');
        const n = h.length === 3
          ? h.split('').map(c => parseInt(c + c, 16))
          : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
        out = 'rgba(' + (n[0] | 0) + ',' + (n[1] | 0) + ',' + (n[2] | 0) + ',' + a + ')';
        this._rgbaCache.set(key, out);
      }
      return out;
    }

    _xOf (row, t) {
      const span = this._endT - this._t0;
      let u = span > 0 ? (t - this._t0) / span : 0;
      if (u < 0) u = 0; else if (u > 1) u = 1;
      return row.x + u * row.w;
    }

    _yOf (row, v) {
      const span = row.yMax - row.yMin;
      let u = span > 0 ? (v - row.yMin) / span : 0;
      if (u < 0) u = 0; else if (u > 1) u = 1;
      return row.y + row.h - u * row.h;
    }

    // ------------------------------------------------------------------
    // Per frame
    // ------------------------------------------------------------------

    // Forward-only sample lookup, matching Helpers.findIndexFrom's shape. A
    // backward jump larger than one sample falls back to a binary search
    // (log2(240) ~ 8 steps) rather than rescanning from zero.
    _valueAt (row, s, t) {
      const pts = s.pts;
      if (!pts || !pts.length) return null;
      if (t < pts[0].t) return null;

      // Cursor lives on the series record, which is rebuilt by build() — so a
      // rebuild resets it for free and there is no keyed lookup per frame.
      let i = s._cur;
      if (i === undefined || i < 0 || i >= pts.length || pts[i].t > t) {
        // Binary search: largest index with pts[i].t <= t.
        let lo = 0, hi = pts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (pts[mid].t <= t) lo = mid; else hi = mid - 1;
        }
        i = lo;
      } else {
        while (i + 1 < pts.length && pts[i + 1].t <= t) i++;
      }
      s._cur = i;

      if (row.kind === 'dom') {
        // Interpolate: dominance samples are pre/post pairs around events, not
        // a grid, so a step read would miss the swing.
        const a = pts[i];
        const b = pts[i + 1];
        if (!b || b.t === a.t) return a[s.key];
        const u = (t - a.t) / (b.t - a.t);
        return a[s.key] + (b[s.key] - a[s.key]) * u;
      }
      // Food is a step function — sample and hold.
      return pts[i][s.key];
    }

    render (gameTime) {
      if (!this._visible || !this.ctx) return;
      if (!this._built && !this.build()) return;
      if (gameTime === this._lastT && !this._dirty) return;
      this._lastT = gameTime;
      this._dirty = false;

      const ctx = this.ctx;
      const W = this._cssW, H = this._cssH;
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      // Required, not optional: the plate has rounded corners, so a bare
      // drawImage would leave the previous frame showing through them.
      ctx.clearRect(0, 0, W, H);

      ctx.drawImage(this._bmpChrome, 0, 0, W, H);

      const F = window.ForgedPanel;
      const row0 = this._rows[0];
      const cursorX = this._xOf(row0, gameTime);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cursorX, H);
      ctx.clip();
      ctx.drawImage(this._bmpBright, 0, 0, W, H);
      ctx.restore();

      // Playback cursor — a struck bone groove, not a bright rule. Three
      // 1px fillRects (shadow / cut / highlight), so still no path building.
      const cx = Math.round(cursorX);
      for (let i = 0; i < this._rows.length; i++) {
        const row = this._rows[i];
        if (cx < row.x || cx > row.x + row.w) continue;
        F.groove(ctx, cx, row.y + 1, row.h - 2, F.COLORS.bone);
      }

      // Readouts, set as in-game numerals: tabular mono with a hard black
      // backing, in NEUTRAL ink. The race portrait baked beside each one
      // (with its player-colour ring) carries whose number it is; colouring
      // the digits too made them read as a status, not an identity.
      const rx = W - PAD_X;
      for (let i = 0; i < this._rows.length; i++) {
        const row = this._rows[i];
        if (!row.readout) continue;
        for (let si = 0; si < row.series.length; si++) {
          const s = row.series[si];
          const v = this._valueAt(row, s, gameTime);
          if (v == null) continue;
          const n = Math.round(v);
          F.numeral(ctx, n >= 0 && n <= 200 ? this._nums[n] : '-',
                    rx, this._readoutY(row, si), VALUE_PX, F.COLORS.ink);
        }
      }
    }
  }

  window.HudCharts = HudCharts;
})();
