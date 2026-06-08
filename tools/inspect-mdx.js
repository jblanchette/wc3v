/**
 * Inspect a WC3 MDX model's skeleton / animation / skinning structure.
 *
 * Used to validate assumptions before/while building the skinned-glTF exporter
 * (tools/convert-mdx-to-gltf-skinned.js). Dumps sequences, the node hierarchy,
 * per-geoset skin data (VertexGroup/Groups or HD SkinWeights), pivot points,
 * and bind poses.
 *
 * Usage:
 *   node tools/inspect-mdx.js --file=tools/map-data/units/human/footman/footman.mdx
 *   node tools/inspect-mdx.js --unit=footman          (searches units/ recursively)
 *   node tools/inspect-mdx.js --unit=ghoul --verbose  (dump sample keyframes too)
 */
const fs = require('fs');
const path = require('path');
const { parseMDX } = require('war3-model');
const { stripMDXChunks, pickStandSequence, geosetVisibleDuringStand } = require('./lib/mdx-skin');

const UNITS_DIR = path.join(__dirname, 'map-data', 'units');

function findUnitMdx (name) {
  const target = name.toLowerCase().replace(/\.mdx$/, '');
  let found = null;
  function walk (dir) {
    if (found || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (found) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase() === target + '.mdx') found = full;
    }
  }
  walk(UNITS_DIR);
  return found;
}

function parseArgs () {
  const args = process.argv.slice(2);
  const out = { verbose: args.includes('--verbose') };
  for (const a of args) {
    if (a.startsWith('--file=')) out.file = a.slice(7);
    else if (a.startsWith('--unit=')) out.unit = a.slice(7);
  }
  return out;
}

function fmtVec (v, n = 3) {
  if (!v) return 'null';
  return '[' + Array.from(v).slice(0, n).map(x => x.toFixed(2)).join(', ') + ']';
}

function describeAnimVector (av) {
  if (!av) return 'none';
  if (typeof av === 'number') return 'const(' + av + ')';
  const lineTypes = ['DontInterp', 'Linear', 'Hermite', 'Bezier'];
  const lt = lineTypes[av.LineType] !== undefined ? lineTypes[av.LineType] : av.LineType;
  const gs = av.GlobalSeqId !== undefined && av.GlobalSeqId !== null ? ' globalSeq=' + av.GlobalSeqId : '';
  return (av.Keys ? av.Keys.length : 0) + ' keys, ' + lt + gs;
}

function main () {
  const opts = parseArgs();
  let file = opts.file;
  if (!file && opts.unit) file = findUnitMdx(opts.unit);
  if (!file) {
    console.error('Provide --file=PATH or --unit=NAME');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error('Not found: ' + file);
    process.exit(1);
  }

  const buf = fs.readFileSync(file);
  const ab = stripMDXChunks(new Uint8Array(buf).buffer, ['LITE']);
  const mdx = parseMDX(ab);

  console.log('=== ' + path.basename(file) + ' ===');
  console.log('Version: ' + mdx.Version + '   Name: ' + (mdx.Info && mdx.Info.Name));
  console.log('');

  // --- Sequences ---
  console.log('SEQUENCES (' + mdx.Sequences.length + '):');
  for (const s of mdx.Sequences) {
    const len = ((s.Interval[1] - s.Interval[0]) / 1000).toFixed(2);
    console.log('  "' + s.Name + '"  [' + s.Interval[0] + '..' + s.Interval[1] + ']  ' +
      len + 's' + (s.NonLooping ? '  (nonlooping)' : '') +
      (s.MoveSpeed ? '  move=' + s.MoveSpeed : '') +
      (s.Rarity ? '  rarity=' + s.Rarity : ''));
  }
  console.log('');

  // --- Global sequences ---
  console.log('GLOBAL SEQUENCES (' + (mdx.GlobalSequences || []).length + '): ' +
    JSON.stringify(mdx.GlobalSequences || []));
  console.log('');

  // --- Node hierarchy ---
  const bones = mdx.Bones || [];
  const helpers = mdx.Helpers || [];
  const nodes = mdx.Nodes || [];
  const pivots = mdx.PivotPoints || [];
  console.log('NODES: ' + nodes.length + ' total  (' + bones.length + ' bones, ' +
    helpers.length + ' helpers)   PivotPoints: ' + pivots.length);
  console.log('BindPoses: ' + (mdx.BindPoses ? mdx.BindPoses.length : 0));

  // Validate Parent indices reference the Nodes array range.
  let badParents = 0;
  let animatedNodes = 0;
  for (const n of nodes) {
    if (n.Parent !== undefined && n.Parent !== null && (n.Parent < 0 || n.Parent >= nodes.length)) badParents++;
    if (n.Translation || n.Rotation || n.Scaling) animatedNodes++;
  }
  console.log('  parent-index out of range: ' + badParents +
    '   nodes with anim tracks: ' + animatedNodes);
  console.log('  sample nodes (first 6):');
  for (const n of nodes.slice(0, 6)) {
    const pv = n.PivotPoint || (pivots[n.ObjectId] || pivots[nodes.indexOf(n)]);
    console.log('    #' + n.ObjectId + ' "' + n.Name + '" parent=' + n.Parent +
      ' pivot=' + fmtVec(pv) + ' flags=' + n.Flags +
      ' T:' + describeAnimVector(n.Translation) +
      ' R:' + describeAnimVector(n.Rotation) +
      ' S:' + describeAnimVector(n.Scaling));
  }
  console.log('');

  // --- Geosets / skin data ---
  console.log('GEOSETS (' + mdx.Geosets.length + '):');
  for (let gi = 0; gi < mdx.Geosets.length; gi++) {
    const g = mdx.Geosets[gi];
    const nv = g.Vertices.length / 3;
    const hasGroups = !!(g.Groups && g.Groups.length);
    const hasVG = !!(g.VertexGroup && g.VertexGroup.length);
    const hasSkin = !!(g.SkinWeights && g.SkinWeights.length);
    let maxGroupSize = 0, maxBoneIdx = 0;
    if (hasGroups) {
      for (const grp of g.Groups) {
        if (grp.length > maxGroupSize) maxGroupSize = grp.length;
        for (const b of grp) if (b > maxBoneIdx) maxBoneIdx = b;
      }
    }
    console.log('  [' + gi + '] verts=' + nv + ' faces=' + g.Faces.length +
      ' mat=' + g.MaterialID +
      (hasVG ? ' VertexGroup✓' : '') +
      (hasGroups ? ' Groups=' + g.Groups.length + '(maxSize=' + maxGroupSize +
        ',maxBoneIdx=' + maxBoneIdx + ')' : '') +
      (hasSkin ? ' SkinWeights✓(HD)' : ''));
    if (hasGroups && opts.verbose) {
      console.log('       Groups sample: ' + JSON.stringify(g.Groups.slice(0, 8)));
      console.log('       VertexGroup sample: ' + JSON.stringify(Array.from((g.VertexGroup || []).slice(0, 12))));
    }
  }
  console.log('');

  // --- GeosetAnims (visibility/alpha) ---
  const stdSeq = pickStandSequence(mdx);
  const sStart = stdSeq ? stdSeq.Interval[0] : 0, sEnd = stdSeq ? stdSeq.Interval[1] : 0;
  console.log('GEOSET ANIMS (' + (mdx.GeosetAnims || []).length + ')  [' + (stdSeq ? stdSeq.Name : 'no-stand') + ' ' + sStart + '..' + sEnd + ']:');
  for (const ga of (mdx.GeosetAnims || [])) {
    const vis = stdSeq ? geosetVisibleDuringStand(mdx, ga.GeosetId, sStart, sEnd) : true;
    let desc = vis ? 'VISIBLE' : 'hidden ';
    if (ga.Alpha === undefined) desc += ' alpha=1(none)';
    else if (typeof ga.Alpha === 'number') desc += ' alpha=' + ga.Alpha + '(const)';
    else {
      const keys = ga.Alpha.Keys || [];
      const inRange = keys.filter(k => k.Frame >= sStart && k.Frame <= sEnd);
      desc += ' ' + keys.length + ' keys, inStandRange=' + inRange.length;
      if (opts.verbose) {
        const lt = ['DontInterp', 'Linear', 'Hermite', 'Bezier'][ga.Alpha.LineType];
        desc += '  [' + lt + '] ' + keys.slice(0, 10).map(k => k.Frame + ':' + k.Vector[0].toFixed(1)).join(' ');
      }
    }
    console.log('  geoset ' + ga.GeosetId + ': ' + desc);
  }
  console.log('');

  // --- Materials / textures ---
  console.log('TEXTURES (' + (mdx.Textures || []).length + '):');
  (mdx.Textures || []).forEach((t, i) => {
    console.log('  [' + i + '] replaceableId=' + (t.ReplaceableId || 0) + '  image="' + (t.Image || '') + '"');
  });
  console.log('MATERIALS (' + (mdx.Materials || []).length + '):');
  (mdx.Materials || []).forEach((m, mi) => {
    const layers = (m.Layers || []).map(l => {
      const tid = typeof l.TextureID === 'number' ? l.TextureID : '(anim)';
      const tex = typeof l.TextureID === 'number' && mdx.Textures[l.TextureID];
      const img = tex ? (tex.Image || 'rid' + (tex.ReplaceableId || 0)) : '?';
      return 'tex' + tid + '=' + img + ' fm' + (l.FilterMode || 0);
    });
    console.log('  mat[' + mi + ']: ' + layers.join(' | '));
  });

  // --- Stand sequence keyframe peek ---
  if (opts.verbose) {
    const stand = pickStandSequence(mdx);
    if (stand) {
      console.log('');
      console.log('STAND keyframe peek (interval ' + stand.Interval[0] + '..' + stand.Interval[1] + '):');
      let shown = 0;
      for (const n of nodes) {
        if (shown >= 4) break;
        const track = n.Rotation || n.Translation;
        if (!track || typeof track === 'number' || !track.Keys) continue;
        const inRange = track.Keys.filter(k => k.Frame >= stand.Interval[0] && k.Frame <= stand.Interval[1]);
        if (!inRange.length) continue;
        console.log('  node "' + n.Name + '" ' + (n.Rotation ? 'Rotation' : 'Translation') +
          ' keys-in-range=' + inRange.length +
          ' first@' + inRange[0].Frame + '=' + fmtVec(inRange[0].Vector, 4));
        shown++;
      }
    }
  }
}

main();
