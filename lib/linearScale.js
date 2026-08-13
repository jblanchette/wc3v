//
// linearScale — the one d3 function the PARSER actually needed.
//
// GameScaler builds four scales (`xScale`, `yScale`, `gridXScale`,
// `gridYScale`) and uses exactly this much of the API:
//
//     scaleLinear().domain([a, b]).range([c, d])   then   scale(v), scale.invert(v)
//
// Pulling all of d3 into the parser for that also pulled `d3-color` into the
// browser parser bundle, which ships to every visitor who opens a replay and
// carries a ReDoS advisory (GHSA-36jr-mh4h-2g58). The vulnerable code is colour
// STRING parsing, which the parser never does — but shipping a known-vulnerable
// parser to users because a transitive dependency came along for one linear
// interpolation is not a trade worth keeping.
//
// THIS DOES NOT TOUCH THE CLIENT'S D3. The viewer still loads D3 v5 from the
// CDN and injects it into its own GameScaler (client/js/app.js). Only
// lib/PathFinder.js — the Node/bundle parser path — uses this.
//
// EXACT FLOATING-POINT PARITY IS THE POINT, NOT JUST THE FORMULA.
//
// This mirrors d3-scale v1's `bimap` operation-for-operation, including the
// branch that SWAPS the endpoints when the domain descends:
//
//     if (d1 < d0) d0 = deinterpolate(d1, d0), r0 = reinterpolate(r1, r0);
//     else         d0 = deinterpolate(d0, d1), r0 = reinterpolate(r0, r1);
//
// Both branches are algebraically the same line, but they evaluate it in a
// different order and therefore round differently in the last bits. WC3's y
// axis is inverted, so GameScaler hands this a descending domain and takes the
// swapped branch constantly. A "mathematically equivalent" version that skipped
// the swap changed exported unit coordinates, which cascaded into battle boxes
// and order target uuids — caught by diffing a reparse against the previous
// output, which is the gate this file has to keep passing:
//
//     node tools/diff-wc3v.js <before>.wc3v.gz <after>.wc3v.gz   -> IDENTICAL
//
// The degenerate case is d3's too: `normalize` collapses to a constant 0.5 when
// the domain has zero extent, so the scale returns the midpoint of the range
// rather than NaN or Infinity.
//
// Two-element domain/range only, unclamped, untransformed — all GameScaler
// asks for. Anything else throws rather than silently returning a subtly
// different number from the d3 it replaced.
//

// d3-scale: deinterpolateLinear(a, b)
const deinterpolate = (a, b) => {
  b -= (a = +a);
  if (b) return (x) => (x - a) / b;
  const c = isNaN(b) ? NaN : 0.5;
  return () => c;
};

// d3-interpolate: interpolateNumber(a, b).
//
// The exact expression matters. d3 evaluates `a * (1 - t) + b * t`, NOT the
// algebraically identical `a + (b - a) * t`. The two disagree in the last bits
// and that disagreement is observable in exported unit coordinates.
const reinterpolate = (a, b) => {
  a = +a;
  b = +b;
  return (t) => a * (1 - t) + b * t;
};

// d3-scale: bimap(domain, range, deinterpolate, reinterpolate)
const bimap = (domain, range) => {
  const d0 = domain[0], d1 = domain[1];
  const r0 = range[0], r1 = range[1];
  let dfn, rfn;
  if (d1 < d0) {
    dfn = deinterpolate(d1, d0);
    rfn = reinterpolate(r1, r0);
  } else {
    dfn = deinterpolate(d0, d1);
    rfn = reinterpolate(r0, r1);
  }
  return (x) => rfn(dfn(x));
};

const linearScale = () => {
  let domain = [0, 1];
  let range = [0, 1];
  let output = null;   // memoized like d3's `output` / `input`
  let input = null;

  const scale = (x) => {
    if (!output) output = bimap(domain, range);
    return output(+x);
  };

  const rescale = () => { output = null; input = null; return scale; };

  scale.domain = (d) => {
    if (d === undefined) return domain.slice();
    if (!Array.isArray(d) || d.length !== 2) {
      throw new Error('linearScale.domain expects a two-element array');
    }
    domain = [+d[0], +d[1]];
    return rescale();
  };

  scale.range = (r) => {
    if (r === undefined) return range.slice();
    if (!Array.isArray(r) || r.length !== 2) {
      throw new Error('linearScale.range expects a two-element array');
    }
    range = [+r[0], +r[1]];
    return rescale();
  };

  // d3: piecewise(range, domain, interpolateNumber) — the same bimap with the
  // roles reversed, so invert rounds the way d3's invert rounds.
  scale.invert = (y) => {
    if (!input) input = bimap(range, domain);
    return input(+y);
  };

  return scale;
};

// Shaped like the d3 namespace GameScaler is handed, so the injection site
// reads the same and GameScaler needs no change at all.
module.exports = { scaleLinear: linearScale };
