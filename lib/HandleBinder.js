/**
 * HandleBinder — ties the units WC3V trained to the handles the replay's selection lists show.
 *
 * WC3V knows what a player trained and when; the selection lists (SelectionLedger) know which
 * handles the player had and how long each lived, but rarely which unit type a handle is (only
 * the first unit of a selected subgroup gets its type written). The handle's second number is
 * the game's object allocation counter, so handles sort by creation. Both sides are ordered by
 * creation, so the units WC3V could not tie to a handle are aligned to the handles nobody claimed
 * with an order-preserving alignment (like a diff): a handle whose type is known only takes a
 * unit of that type (or a form it morphs to/from), a unit is never tied to a handle the game
 * listed before the unit existed, and among alignments with as many pairs, the one whose
 * creation times fit the counters best wins.
 */

// Forms of one unit that keep its handle: toggled forms (Bear / Crow Form,
// Burrow, Ethereal Form, Stone Form, Metamorphosis), Destroyer Form, militia,
// and the Headhunter the Berserker upgrade turns into a Berserker.
const FORM_CLASSES = [
  ['edoc', 'edcm'], ['edot', 'edtm'], ['ucry', 'ucrm'], ['ospw', 'ospm'], ['uobs', 'ubsp'],
  ['hpea', 'hmil'], ['ugar', 'ugrm'], ['Edem', 'Edmm'], ['ohun', 'otbk']
];
const formClassOf = new Map();
for (const cls of FORM_CLASSES) for (const id of cls) formClassOf.set(id, cls[0]);
const formClass = (id) => formClassOf.get(id) || id;

// A unit may be listed a little before WC3V thinks it finished training (WC3V's training clock
// is an estimate); beyond this, the handle cannot be that unit.
const LISTED_BEFORE_TRAINED_SLACK_MS = 20 * 1000;
// Weight of the creation-time misfit (per second) against one more pair.
const TIME_COST_PER_S = 0.002;
const TYPED_BONUS = 0.5;

class HandleBinder {
  // units: [{ id, type, forms:Set, born, handle (key or null) }]
  // handles: Map key -> ledger handle ({ key, counter, first, types:[{type}] })
  // anchors: [{ counter, born }] (optional) for the counter -> creation time fit
  static bind (units, handles, anchors = []) {
    const fit = HandleBinder.counterClock(anchors);
    const result = new Map();       // unit id -> handle key
    const taken = new Set();

    // 1. keep the ties WC3V made when they agree with what the lists say
    for (const u of units) {
      if (!u.handle) continue;
      const h = handles.get(u.handle);
      if (!h) continue;
      if (h.types.length && !h.types.some(x => HandleBinder.formMatches(u, x.type))) continue;
      if (taken.has(u.handle)) continue;
      result.set(u.id, u.handle);
      taken.add(u.handle);
    }

    // 2. align the rest by creation order
    const us = units.filter(u => !result.has(u.id)).sort((a, b) => a.born - b.born);
    const hs = [...handles.values()].filter(h => !taken.has(h.key)).sort((a, b) => a.counter - b.counter);
    const n = us.length, m = hs.length;
    if (!n || !m) return result;

    const gain = (u, h) => {
      if (u.born > h.first + LISTED_BEFORE_TRAINED_SLACK_MS) return null;
      let g = 1;
      if (h.types.length) {
        if (!h.types.some(x => HandleBinder.formMatches(u, x.type))) return null;
        g += TYPED_BONUS;
      } else if (u.typedOnly) {
        return null;
      }
      const est = fit ? fit(h.counter) : null;
      if (est != null) g -= Math.min(0.9, TIME_COST_PER_S * Math.abs(u.born - est) / 1000);
      return g;
    };

    // dp[i][j]: best total over the first i units and first j handles
    const W = m + 1;
    const dp = new Float64Array((n + 1) * W);
    const how = new Uint8Array((n + 1) * W);   // 0 skip unit, 1 skip handle, 2 pair
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        let best = dp[(i - 1) * W + j], b = 0;
        const sh = dp[i * W + j - 1];
        if (sh > best) { best = sh; b = 1; }
        const g = gain(us[i - 1], hs[j - 1]);
        if (g !== null) {
          const pr = dp[(i - 1) * W + j - 1] + g;
          if (pr > best) { best = pr; b = 2; }
        }
        dp[i * W + j] = best;
        how[i * W + j] = b;
      }
    }
    let i = n, j = m;
    while (i > 0 && j > 0) {
      const b = how[i * W + j];
      if (b === 2) { result.set(us[i - 1].id, hs[j - 1].key); i--; j--; }
      else if (b === 1) j--;
      else i--;
    }
    return result;
  }

  static formMatches (unit, type) {
    const c = formClass(type);
    for (const f of unit.forms) if (formClass(f) === c) return true;
    return false;
  }

  // Monotone fit of creation time against the allocation counter (pool-adjacent violators),
  // interpolated between anchors.
  static counterClock (anchors) {
    const pts = anchors.filter(a => a.counter != null && a.born != null)
      .sort((a, b) => a.counter - b.counter);
    if (pts.length < 3) return null;
    const blocks = [];
    for (const p of pts) {
      blocks.push({ sum: p.born, n: 1, lo: p.counter, hi: p.counter });
      while (blocks.length > 1) {
        const a = blocks[blocks.length - 2], b = blocks[blocks.length - 1];
        if (a.sum / a.n <= b.sum / b.n) break;
        blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, n: a.n + b.n, lo: a.lo, hi: b.hi });
      }
    }
    const xs = blocks.map(b => (b.lo + b.hi) / 2), ys = blocks.map(b => b.sum / b.n);
    return (c) => {
      if (c <= xs[0]) return ys[0];
      if (c >= xs[xs.length - 1]) return ys[ys.length - 1];
      let lo = 0, hi = xs.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= c) lo = mid; else hi = mid;
      }
      const f = (c - xs[lo]) / ((xs[hi] - xs[lo]) || 1);
      return ys[lo] + f * (ys[hi] - ys[lo]);
    };
  }
}

HandleBinder.formClass = formClass;

module.exports = HandleBinder;
