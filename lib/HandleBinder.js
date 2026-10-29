/**
 * HandleBinder — ties the units WC3V trained to the handles the replay's selection lists show.
 *
 * WC3V knows what a player trained and when; the selection lists (SelectionLedger) know which
 * handles the player had and how long each lived, but rarely which unit type a handle is (only
 * the first unit of a selected subgroup gets its type written). The handle's second number is
 * the game's object allocation counter, so handles sort by creation. Both sides are ordered by
 * creation, so units are aligned to handles with an order-preserving alignment (like a diff):
 *   - a handle whose type is known only takes a unit of that type (or a form it morphs to/from);
 *   - a unit is never tied to a handle that existed before the unit could have come out;
 *   - among alignments with as many pairs, the one whose creation times best fit a monotone
 *     counter -> time fit wins, and the ties the simulation made itself get a small bonus.
 * WC3V's training time is late as often as not (its queues also hold orders the game refused
 * for want of gold or food), so a unit's creation is a window: from queue time + build time
 * up to WC3V's training time.
 */

// Forms of one unit that keep its handle: toggled forms (Bear / Crow Form,
// Burrow, Ethereal Form, Stone Form, Metamorphosis), Destroyer Form, militia,
// the units a research turns into another type (Berserker upgrade, Barrage),
// and the Hippogryph that picks up an Archer (it becomes the Rider; the Archer
// is gone).
const FORM_CLASSES = [
  ['edoc', 'edcm'], ['edot', 'edtm'], ['ucry', 'ucrm'], ['ospw', 'ospm'], ['uobs', 'ubsp'],
  ['hpea', 'hmil'], ['ugar', 'ugrm'], ['Edem', 'Edmm'], ['ohun', 'otbk'], ['hmtt', 'hrtt'],
  ['ehip', 'ehpr']
];
const formClassOf = new Map();
for (const cls of FORM_CLASSES) for (const id of cls) formClassOf.set(id, cls[0]);
const formClass = (id) => formClassOf.get(id) || id;

// WC3V's training clock is an estimate: a unit may be listed a little before
// the earliest it could have come out; beyond this, the handle cannot be it.
const LISTED_BEFORE_TRAINED_SLACK_MS = 20 * 1000;
// Weight of the creation-time misfit (per second) against one more pair, capped
// so that a misfit alone never outweighs a pair.
const TIME_COST_PER_S = 0.002;
const TIME_COST_CAP = 0.9;
// A handle whose type the lists name, taken by a unit of that type.
const TYPED_BONUS = 0.5;
// The tie the simulation made itself: a hint, not a given. Kept outright, the
// ties it got out of creation order block the alignment of everything else.
const SIMULATION_TIE_BONUS = 0.2;
// Units the game makes in one go are a handful of counters apart (the
// allocations of one unit: ~17 for a skeleton, ~23 for a peasant, ~28 for a
// druid); units made at separate moments are hundreds apart.
const TWIN_COUNTER_GAP = 30;
const TWIN_BORN_MS = 1500;

class HandleBinder {
  // units:   [{ id, forms: Set, earliest, born, handle, worker }] — a unit came out in
  //          [earliest, born] (born: WC3V's training time, or the summon time);
  //          handle: the key WC3V tied it to during the simulation, or null
  // handles: Map key -> ledger handle ({ key, counter, first, types: [{ type }] })
  // anchors: [{ counter, born }] for the counter -> creation time fit
  // madeBy:  counter -> latest time a handle with that counter can have been
  //          made (optional; else its own first sighting)
  // Returns Map unit id -> handle key.
  static bind (units, handles, anchors = [], madeBy = null) {
    const fit = HandleBinder.counterClock(anchors);
    const result = new Map();

    // creation order on both sides
    // (the start units: the game makes a Ghoul before the Acolytes)
    const us = [...units].sort((a, b) => (a.born - b.born) || ((a.worker ? 1 : 0) - (b.worker ? 1 : 0)));
    const hs = [...handles.values()].sort((a, b) => a.counter - b.counter);
    const n = us.length, m = hs.length;
    if (!n || !m) return result;

    // Handles the game made together (counters a few apart): one event made
    // several units — summons, or one train order finishing in several
    // buildings at once. Such a handle only takes a unit WC3V also made
    // together with another; else trained units get tied to the skeletons and
    // beetles WC3V never saw summoned, and die with them.
    const twinHandle = new Set();
    for (let j = 1; j < hs.length; j++) {
      if (hs[j].counter - hs[j - 1].counter <= TWIN_COUNTER_GAP) { twinHandle.add(hs[j].key); twinHandle.add(hs[j - 1].key); }
    }
    const twinUnit = new Set();
    for (let i = 1; i < us.length; i++) {
      if (us[i].born - us[i - 1].born <= TWIN_BORN_MS) { twinUnit.add(us[i].id); twinUnit.add(us[i - 1].id); }
    }

    const gain = (u, h) => {
      const simulated = u.handle === h.key;
      if (!simulated && twinHandle.has(h.key) && !twinUnit.has(u.id)) return null;
      const latest = Math.min(h.first, madeBy ? madeBy(h.counter) : Infinity);
      if (!simulated && u.earliest > latest + LISTED_BEFORE_TRAINED_SLACK_MS) return null;
      let g = 1 + (simulated ? SIMULATION_TIE_BONUS : 0);
      if (h.types.length) {
        if (!h.types.some(x => HandleBinder.formMatches(u, x.type))) return null;
        g += TYPED_BONUS;
      }
      const est = fit ? fit(h.counter) : null;
      if (est != null) {
        const misfit = est < u.earliest ? u.earliest - est : est > u.born ? est - u.born : 0;
        g -= Math.min(TIME_COST_CAP, TIME_COST_PER_S * misfit / 1000);
      }
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
