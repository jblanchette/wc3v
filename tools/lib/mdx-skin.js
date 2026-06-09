/**
 * Shared helpers for the skinned-unit MDX→glTF pipeline.
 * Used by convert-mdx-to-gltf-skinned.js, inspect-mdx.js, check-skinning.js.
 */

// Strip chunks war3-model can't parse (Reforged MDX extended LITE fields).
function stripMDXChunks (buffer, chunkNames) {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  if (view.getUint32(0, true) !== 0x584C444D) return buffer; // not MDLX
  const pieces = [buffer.slice(0, 4)];
  let pos = 4;
  while (pos + 8 <= buffer.byteLength) {
    const keyword = String.fromCharCode(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
    const chunkSize = view.getUint32(pos + 4, true);
    const chunkEnd = pos + 8 + chunkSize;
    if (chunkEnd > buffer.byteLength) break;
    if (!chunkNames.includes(keyword)) pieces.push(buffer.slice(pos, chunkEnd));
    pos = chunkEnd;
  }
  const totalLen = pieces.reduce((s, p) => s + p.byteLength, 0);
  const result = new ArrayBuffer(totalLen);
  const dst = new Uint8Array(result);
  let off = 0;
  for (const p of pieces) { dst.set(new Uint8Array(p), off); off += p.byteLength; }
  return result;
}

// Pick the canonical sequence whose name starts with `prefix`, excluding variant
// keywords (carry/cast/pose/morph idles). Prefers the exact-named, lowest-rarity,
// earliest one — so "Stand"/"Walk"/"Attack"/"Death" beat "Stand Ready", "Walk
// Lumber", "Attack - 2", "Death Spin", etc.
const BAD_COMMON = ['alternate', 'morph'];
const SEQ_BAD = {
  stand: ['lumber', 'gold', 'channel', 'work', 'victory', 'defend', 'ready', 'turn', 'spin', 'flesh', 'bone', 'decay', 'upgrade'],
  walk: ['lumber', 'gold', 'defend'],
  attack: ['lumber', 'gold', 'defend', 'spell', 'slam', 'throw'],
  death: ['decay', 'flesh', 'bone', 'spin', 'upper', 'explode']
};
function pickByPrefix (mdx, prefix, extraBad) {
  if (!mdx.Sequences || !mdx.Sequences.length) return null;
  const bad = BAD_COMMON.concat(extraBad || []);
  let cands = mdx.Sequences.filter(s => {
    const n = s.Name.toLowerCase();
    return n.startsWith(prefix) && !bad.some(b => n.includes(b));
  });
  if (!cands.length) {
    cands = mdx.Sequences.filter(s => {
      const n = s.Name.toLowerCase();
      return n.startsWith(prefix) && !BAD_COMMON.some(b => n.includes(b));
    });
  }
  if (!cands.length) return null;
  cands = cands.slice().sort((a, b) => {
    const ae = a.Name.toLowerCase().trim() === prefix ? 0 : 1;
    const be = b.Name.toLowerCase().trim() === prefix ? 0 : 1;
    if (ae !== be) return ae - be;                       // exact name wins
    const ar = a.Rarity || 0, br = b.Rarity || 0;
    if (ar !== br) return ar - br;                        // then lowest rarity
    return a.Interval[0] - b.Interval[0];                 // then earliest
  });
  return cands[0];
}

// The idle "Stand" sequence (back-compat; used by check-skinning + inspect-mdx).
function pickStandSequence (mdx) { return pickByPrefix(mdx, 'stand', SEQ_BAD.stand); }

// Canonical clip set for the animation state machine. Categories whose sequence
// is absent (e.g. statues have no Walk/Attack) come back null and are skipped.
function pickSequences (mdx) {
  return {
    idle: pickByPrefix(mdx, 'stand', SEQ_BAD.stand),
    walk: pickByPrefix(mdx, 'walk', SEQ_BAD.walk),
    attack: pickByPrefix(mdx, 'attack', SEQ_BAD.attack),
    death: pickByPrefix(mdx, 'death', SEQ_BAD.death)
  };
}

// Evaluate a scalar AnimVector at `frame` WITHIN sequence interval [from,to],
// faithfully porting war3-model's findKeyframes/interpNum semantics. Returns null
// when no keys fall in the sequence — callers then use the track's default value.
// (Hermite/Bezier approximated as linear, which is fine for alpha visibility.)
function evalAnimScalarInSeq (av, frame, from, to) {
  const a = av.Keys;
  if (!a || !a.length) return null;
  if (a[0].Frame > to || a[a.length - 1].Frame < from) return null; // keys outside sequence
  // binary search: first index with Frame > frame
  let first = 0, count = a.length;
  while (count > 0) {
    const step = count >> 1;
    if (a[first + step].Frame <= frame) { first = first + step + 1; count -= step + 1; }
    else count = step;
  }
  let left, right;
  if (first === a.length || a[first].Frame > to) {
    if (first > 0 && a[first - 1].Frame >= from) { left = right = a[first - 1]; } else return null;
  } else if (first === 0 || a[first - 1].Frame < from) {
    if (a[first].Frame <= to) { left = right = a[first]; } else return null;
  } else { left = a[first - 1]; right = a[first]; }
  if (left.Frame === right.Frame || av.LineType === 0) return left.Vector[0]; // DontInterp / single
  const t = (frame - left.Frame) / (right.Frame - left.Frame);
  return left.Vector[0] + (right.Vector[0] - left.Vector[0]) * t;
}

// A geoset is exported only if visible (alpha > ~0) somewhere in the Stand interval.
// Uses war3-model's per-sequence evaluation: when a geoset's alpha keys lie entirely
// outside the Stand interval, the geoset defaults to VISIBLE (alpha 1) — only keys
// inside the interval can hide it. This hides damage gore, blood decals, and
// carry/morph geosets WC3 toggles to alpha 0 specifically during idle.
function geosetVisibleDuringStand (mdx, gi, start, end) {
  const ga = (mdx.GeosetAnims || []).find(a => a.GeosetId === gi);
  if (!ga || ga.Alpha === undefined) return true;
  if (typeof ga.Alpha === 'number') return ga.Alpha > 0.1;
  const av = ga.Alpha;
  if (!av.Keys || !av.Keys.length) return true;
  const probes = new Set([start, end, Math.round((start + end) / 2)]);
  for (const k of av.Keys) if (k.Frame >= start && k.Frame <= end) probes.add(k.Frame);
  let maxA = 0;
  for (const f of probes) { const a = evalAnimScalarInSeq(av, f, start, end); maxA = Math.max(maxA, a === null ? 1 : a); }
  return maxA > 0.1;
}

module.exports = { stripMDXChunks, pickStandSequence, pickSequences, evalAnimScalarInSeq, geosetVisibleDuringStand };
