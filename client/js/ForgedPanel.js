/**
 * ForgedPanel — the viewer's carved-metal material, drawn on 2D canvas.
 *
 * The site's visual register is Warcraft III's own: earthy, muted, heraldic;
 * cast bronze and cut stone; hard black outlines and struck highlights. Depth
 * comes from an outline, a 1px lit edge and an inset shadow — never from a
 * glow. Nothing here may bloom, and no fill is a saturated primary.
 *
 * The reference implementation is the dominance gauge (`.dom-*` in
 * dominance.css): a chamfered brushed-bronze frame with a well cut into it,
 * mounting studs at the ends, an engraved serif wordmark, and numerals set
 * with a hard black shadow. That is all CSS. Everything the viewer draws on a
 * canvas needs the same material or it reads as app chrome bolted onto a game
 * prop — so the recipe lives here once and HudCharts builds out of it instead
 * of inventing its own panel. Any future canvas-drawn instrument should too.
 *
 * NOTE this is the register for INSTRUMENTS (gauges, meters, readouts), the
 * family the dominance bar belongs to. Cards that present data — a fight
 * summary, an event row — use the site's ordinary panel styling instead; see
 * `.ip` / `.ev-row` / `.brp-fight` in main.css.
 *
 * Palette is lifted from tokens.css (--vc-* / the .dom-frame gradient stops)
 * rather than re-picked, so canvas and CSS stay the same fixture.
 */

(function () {
  const C = {
    // Chassis: the warm near-black slab the whole thing is cut from.
    slabTop:    '#1a1815',
    slabMid:    '#131210',
    slabBot:    '#0e0d0b',
    outline:    '#0a0908',                      // hard black perimeter
    rimLight:   'rgba(157, 132, 82, 0.16)',     // bronze struck highlight, top inside
    baseEdge:   '#2a2419',                      // lit bottom edge

    // Cast bronze, lit from above (.dom-frame's gradient stops).
    bronzeLit:  '#7a6640',
    bronze1:    '#56472b',
    bronze2:    '#42361f',
    bronze3:    '#2e2617',
    bronze4:    '#1d1810',
    bronze5:    '#100d09',
    studHi:     '#b39a63',
    studMid:    '#7a6640',
    studLow:    '#3a2f1c',

    // The cut channel.
    well:       '#0b0805',
    wellLip:    'rgba(157, 132, 82, 0.30)',     // bronze lip catching light from below

    // Engraved lettering + numerals.
    engraved:   '#6d5f42',
    engravedLo: 'rgba(200, 175, 120, 0.10)',    // light BELOW the glyphs = cut in
    ink:        '#d9d2c0',
    inkMuted:   'rgba(214, 200, 168, 0.62)',
    bone:       '#c9bb96'                        // struck bone — markers, cursors
  };

  // Two off-angle hairline hatches over the base gradient — the same trick
  // .dom-bar uses to stop a wide flat field reading as paint. Baked once into
  // a tiny tiling pattern; a per-frame path-hatch would be absurd.
  let GRAIN = null;
  function grain (ctx) {
    if (GRAIN) return GRAIN;
    const s = 24;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, s, s);
    g.lineWidth = 1;
    for (let i = -s; i < s * 2; i += 4) {
      g.strokeStyle = 'rgba(214, 190, 140, 0.030)';
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke();
      g.strokeStyle = 'rgba(0, 0, 0, 0.045)';
      g.beginPath(); g.moveTo(i + 2, 0); g.lineTo(i + 2 + s, s); g.stroke();
    }
    for (let i = -s; i < s * 2; i += 7) {
      g.strokeStyle = 'rgba(214, 190, 140, 0.018)';
      g.beginPath(); g.moveTo(i + s, 0); g.lineTo(i, s); g.stroke();
    }
    GRAIN = ctx.createPattern(cv, 'repeat');
    return GRAIN;
  }

  // Blend two '#rrggbb' colours. Memoized — the bezel gradient asks for the
  // same two stops on every bake.
  const MIX = new Map();
  function mix (a, b, t) {
    const key = a + '|' + b + '|' + t;
    let out = MIX.get(key);
    if (out !== undefined) return out;
    const p = (s) => {
      const h = String(s || '#000000').replace('#', '');
      return h.length === 3
        ? h.split('').map(ch => parseInt(ch + ch, 16))
        : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    const A = p(a), B = p(b);
    const c = (i) => Math.round(A[i] + (B[i] - A[i]) * t) | 0;
    out = 'rgb(' + c(0) + ',' + c(1) + ',' + c(2) + ')';
    MIX.set(key, out);
    return out;
  }

  // Chamfered rect — corners CUT, not rounded. Rounded corners read as a web
  // card; a cut corner reads as a machined plate.
  function path (ctx, x, y, w, h, c) {
    const k = Math.max(0, Math.min(c, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.lineTo(x + w - k, y);
    ctx.lineTo(x + w, y + k);
    ctx.lineTo(x + w, y + h - k);
    ctx.lineTo(x + w - k, y + h);
    ctx.lineTo(x + k, y + h);
    ctx.lineTo(x, y + h - k);
    ctx.lineTo(x, y + k);
    ctx.closePath();
  }

  /**
   * The full panel: grained slab, hard black perimeter, struck bronze rim
   * light along the top inside edge and a lit bottom edge.
   *
   * `tint` (optional) is mixed across the WHOLE face at low alpha — that is
   * how a callout carries its verdict colour. A coloured bar along one edge
   * is forbidden in this project (canvas included); the colour goes into the
   * full perimeter and a full-area wash instead.
   */
  function chassis (ctx, x, y, w, h, opts) {
    const o = opts || {};
    const c = o.chamfer != null ? o.chamfer : 10;

    ctx.save();
    path(ctx, x, y, w, h, c);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, C.slabTop);
    g.addColorStop(0.62, C.slabMid);
    g.addColorStop(1, C.slabBot);
    ctx.fillStyle = g;
    ctx.fill();

    // Grain, clipped to the plate.
    ctx.clip();
    ctx.fillStyle = grain(ctx);
    ctx.fillRect(x, y, w, h);

    if (o.tint) {
      ctx.globalAlpha = o.tintAlpha != null ? o.tintAlpha : 0.14;
      ctx.fillStyle = o.tint;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
    }

    // Struck highlight: one lit pixel along the top inside edge, and a dimmer
    // one along the bottom. This is the entire source of relief — no shadow
    // blur, no halo.
    ctx.strokeStyle = C.rimLight;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + c, y + 0.5);
    ctx.lineTo(x + w - c, y + 0.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120, 100, 62, 0.20)';
    ctx.beginPath();
    ctx.moveTo(x + c, y + h - 0.5);
    ctx.lineTo(x + w - c, y + h - 0.5);
    ctx.stroke();
    ctx.restore();

    // Hard black perimeter, then the accent as a FULL border if given.
    ctx.save();
    path(ctx, x + 0.5, y + 0.5, w - 1, h - 1, c);
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (o.border) {
      // A struck bezel, not a flat ring: the band is shaded top-lit to
      // bottom-dark like the cast frame, then closed with a hard black line
      // on its inner edge so it seats into the plate instead of floating on
      // top of it. A single flat stroke reads as a web card border.
      const bw = o.borderWidth || 2;
      const bx = x + bw / 2 + 1, by = y + bw / 2 + 1;
      const bwid = w - bw - 2, bhgt = h - bw - 2;
      const bc = Math.max(1, c - 1);
      const bg = ctx.createLinearGradient(0, by, 0, by + bhgt);
      bg.addColorStop(0, mix(o.border, '#ffffff', 0.34));
      bg.addColorStop(0.45, o.border);
      bg.addColorStop(1, mix(o.border, '#000000', 0.45));
      path(ctx, bx, by, bwid, bhgt, bc);
      ctx.strokeStyle = bg;
      ctx.lineWidth = bw;
      ctx.stroke();
      path(ctx, bx + bw / 2, by + bw / 2, bwid - bw, bhgt - bw, Math.max(1, bc - bw / 2));
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Cast-bronze frame — the housing a channel is cut into. Warm and
   * tarnished, lit from above, chamfered ends. The 1px top line is a struck
   * highlight, not a glow. Draw this first, then well() inset inside it; the
   * difference between the two is the visible lip, and without it the plot
   * reads as a flat painted slab instead of metal with a channel in it.
   */
  function frame (ctx, x, y, w, h, chamferPx) {
    const c = chamferPx != null ? chamferPx : 7;
    ctx.save();
    path(ctx, x, y, w, h, c);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, C.bronzeLit);
    g.addColorStop(1 / Math.max(h, 1), C.bronze1);
    g.addColorStop(0.26, C.bronze2);
    g.addColorStop(0.56, C.bronze3);
    g.addColorStop(0.84, C.bronze4);
    g.addColorStop(1, C.bronze5);
    ctx.fillStyle = g;
    ctx.fill();
    // Fine vertical mill lines, as on .dom-frame.
    ctx.clip();
    for (let i = 0; i < h; i += 2) {
      ctx.fillStyle = i % 4 === 0
        ? 'rgba(255, 235, 190, 0.028)' : 'rgba(0, 0, 0, 0.045)';
      ctx.fillRect(x, y + i, w, 1);
    }
    ctx.restore();

    ctx.save();
    path(ctx, x + 0.5, y + 0.5, w - 1, h - 1, c);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.80)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * A channel cut into the plate. Near-black warm floor, a hard shadow the
   * upper lip casts in, and a bronze lower lip catching light from below.
   * Canvas has no inset shadow, so both lips are drawn explicitly.
   */
  function well (ctx, x, y, w, h, chamferPx) {
    const c = chamferPx != null ? chamferPx : 5;
    ctx.save();
    path(ctx, x, y, w, h, c);
    ctx.fillStyle = C.well;
    ctx.fill();
    ctx.clip();

    // Shadow cast in by the top lip.
    const sh = ctx.createLinearGradient(0, y, 0, y + Math.min(6, h));
    sh.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
    sh.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = sh;
    ctx.fillRect(x, y, w, Math.min(6, h));

    // Bronze lower lip.
    ctx.fillStyle = C.wellLip;
    ctx.fillRect(x, y + h - 1, w, 1);
    ctx.restore();

    ctx.save();
    path(ctx, x + 0.5, y + 0.5, w - 1, h - 1, c);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // Glass over a channel: the top gloss line and the shade the lip throws
  // inward. Drawn AFTER the contents so it sits over them like the CSS
  // .dom-track::after does.
  function glass (ctx, x, y, w, h, chamferPx) {
    ctx.save();
    path(ctx, x, y, w, h, chamferPx != null ? chamferPx : 5);
    ctx.clip();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
    g.addColorStop(0.26, 'rgba(255, 255, 255, 0.015)');
    g.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  // Mounting stud. Lit from upper-left, ringed in hard black.
  function stud (ctx, cx, cy, r) {
    const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.36, 0, cx, cy, r);
    g.addColorStop(0, C.studHi);
    g.addColorStop(0.42, C.studMid);
    g.addColorStop(1, C.studLow);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // An etched vertical groove — a cut line flanked by a shadow and a struck
  // highlight, the way in-game art separates two fields. Used for reference
  // markers and the playback cursor.
  function groove (ctx, x, y, h, color) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.60)';
    ctx.fillRect(x - 1, y, 1, h);
    ctx.fillStyle = color || 'rgba(4, 8, 12, 0.90)';
    ctx.fillRect(x, y, 1, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fillRect(x + 1, y, 1, h);
    ctx.restore();
  }

  // Engraved plate lettering. Serif on purpose: Warcraft sets its plate text
  // in a serif face, and a wide-tracked serif reads as stamped metal where
  // the app's sans reads as a web label. The lit pixel goes BELOW the glyphs
  // — light from underneath is what makes type read as cut in, not raised.
  function engrave (ctx, text, x, y, px, opts) {
    const o = opts || {};
    ctx.save();
    ctx.font = `700 ${px}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = (o.tracking || 0.16) + 'em';
    ctx.fillStyle = o.lowlight || C.engravedLo;
    ctx.fillText(text, x, y + 1);
    ctx.fillStyle = o.color || C.engraved;
    ctx.fillText(text, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();
  }

  // Numerals, set the way in-game numerals are: tabular mono, hard black
  // shadow, no bloom.
  function numeral (ctx, text, x, y, px, color, align) {
    ctx.save();
    ctx.font = `700 ${px}px Consolas, 'Cascadia Mono', monospace`;
    ctx.textAlign = align || 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillStyle = color || C.ink;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // Body text with the same hard black backing. `weight`/`font` let callers
  // set headline vs body without another helper.
  function inked (ctx, text, x, y, px, color, opts) {
    const o = opts || {};
    ctx.save();
    ctx.font = `${o.weight || 700} ${px}px ${o.family || 'Arial, sans-serif'}`;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx && o.tracking) ctx.letterSpacing = o.tracking + 'em';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    ctx.fillText(text, x + 1, y + 1);
    ctx.fillStyle = color || C.ink;
    ctx.fillText(text, x, y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();
  }

  // Measure with the same font settings inked()/engrave() would use, so
  // layout and paint can never disagree.
  function measure (ctx, text, px, opts) {
    const o = opts || {};
    ctx.save();
    ctx.font = o.serif
      ? `700 ${px}px Georgia, 'Times New Roman', serif`
      : `${o.weight || 700} ${px}px ${o.family || 'Arial, sans-serif'}`;
    if ('letterSpacing' in ctx && o.tracking) ctx.letterSpacing = o.tracking + 'em';
    const w = ctx.measureText(text).width;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();
    return w;
  }

  window.ForgedPanel = {
    COLORS: C, path, chassis, frame, well, glass, stud, groove, engrave, numeral, inked, measure
  };
})();
