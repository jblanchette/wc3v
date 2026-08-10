/**
 * Audit exported unit GLBs for silently dropped geometry.
 *
 * The MDX -> glTF exporter drops geosets on purpose: gore and carry-props that
 * are invisible during Stand, shadow/splat decals, and additive glow overlays
 * (the Obsidian Statue's rune beams blow out to solid white without their
 * animated alpha). Every one of those is a deliberate, silent deletion.
 *
 * That silence is the problem. The Water Elemental shipped for months as 20 of
 * its 314 vertices — just the team-coloured fists — because its body layers use
 * an animated TextureID (the WC3 water flipbook) and the resolver read that as
 * "no texture". Nothing failed. The GLB was valid. `--untextured` did not catch
 * the Sea Elemental at all, because its coral geoset still carried a texture.
 *
 * So this tool grades every model on how much of its Stand-visible geometry
 * actually reached the GLB, and attributes each loss to a rule. An unattributed
 * loss is a bug.
 *
 * It imports the REAL resolver from the converter rather than restating the
 * rules, so the two cannot drift apart.
 *
 * Usage:
 *   node tools/audit-model-geometry.js                 # whole roster
 *   node tools/audit-model-geometry.js --model=wisp    # one model, per-geoset
 *   node tools/audit-model-geometry.js --min-loss=25   # only losses over 25%
 *   node tools/audit-model-geometry.js --json
 *
 * Exit code is 1 if any model has unattributed loss, so it can gate a re-export.
 */
const fs = require('fs');
const path = require('path');
const { parseMDX } = require('war3-model');
const { stripMDXChunks, pickSequences, geosetVisibleDuringStand, geosetFormVisibility } =
  require('./lib/mdx-skin');
const { getUnitMappings, resolveGeosetMaterial, reviveEffectOnlyModel, OUTPUT_DIR } =
  require('./convert-mdx-to-gltf-skinned');

const argv = process.argv.slice(2);
const get = k => { const a = argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : null; };
const onlyModel = get('model');
const minLoss = parseFloat(get('min-loss')) || 0;
const asJson = argv.includes('--json');

// Vertex count per primitive straight out of the GLB JSON chunk. No decode
// needed — POSITION's accessor count is the vertex count.
function glbGeometry (file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('not a binary GLB');
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
  const byGeoset = new Map();
  let total = 0;
  for (const mesh of (gltf.meshes || [])) {
    for (const prim of (mesh.primitives || [])) {
      const n = gltf.accessors[prim.attributes.POSITION].count;
      total += n;
      const gi = prim.extras && prim.extras.geosetId;
      if (gi != null) byGeoset.set(gi, (byGeoset.get(gi) || 0) + n);
    }
  }
  return { total, byGeoset };
}

// Why did this geoset not reach the GLB? Mirrors buildSkinnedDocument's order.
const REASONS = {
  hiddenStand: 'invisible during Stand (gore / carry prop)',
  hiddenForm: 'belongs to neither form\'s idle',
  effect: 'effect plane (decal / additive overlay)',
  nothingToDraw: 'no diffuse and no team replaceable',
  empty: 'zero vertices'
};

function auditModel (modelName, mdxPath) {
  const glbPath = path.join(OUTPUT_DIR, modelName + '.glb');
  // MDX first: a missing source explains a missing GLB, and saying so is more
  // use than reporting the symptom.
  if (!fs.existsSync(mdxPath)) return { model: modelName, error: 'MDX missing (' + mdxPath + ')' };
  if (!fs.existsSync(glbPath)) return { model: modelName, error: 'GLB missing — export failed' };

  const mdx = parseMDX(stripMDXChunks(new Uint8Array(fs.readFileSync(mdxPath)).buffer, ['LITE']));
  const picked = pickSequences(mdx);
  const idle = picked && picked.idle;
  const altIdle = picked && picked.altIdle;
  const idleStart = idle ? idle.Interval[0] : 0;
  const idleEnd = idle ? idle.Interval[1] : 0;

  // Replay the exporter's own two passes so attribution matches reality.
  const resolved = new Array(mdx.Geosets.length).fill(null);
  const geosets = [];
  for (let gi = 0; gi < mdx.Geosets.length; gi++) {
    const g = mdx.Geosets[gi];
    const nv = g.Vertices.length / 3;
    const rec = { gi, verts: nv, kept: 0, reason: null };
    geosets.push(rec);
    if (nv === 0) { rec.reason = 'empty'; continue; }
    if (altIdle) {
      const form = geosetFormVisibility(mdx, gi, idle, altIdle);
      if (!form) { rec.reason = 'hiddenForm'; continue; }
    } else if (idle && !geosetVisibleDuringStand(mdx, gi, idleStart, idleEnd)) {
      rec.reason = 'hiddenStand'; continue;
    }
    resolved[gi] = { gi, verts: nv, mat: resolveGeosetMaterial(mdx, g) };
  }
  const revived = reviveEffectOnlyModel(resolved) || [];
  for (const e of resolved) {
    if (!e) continue;
    const rec = geosets[e.gi];
    if (e.mat.skip) { rec.reason = 'effect'; continue; }
    if (!e.mat.baseName && !e.mat.replaceableId) { rec.reason = 'nothingToDraw'; continue; }
    rec.expected = true;
    if (e.mat.revived) rec.revived = true;
  }

  const glb = glbGeometry(glbPath);
  for (const rec of geosets) {
    const got = glb.byGeoset.get(rec.gi);
    if (got != null) rec.kept = got;
  }

  const sourceVerts = geosets.reduce((a, r) => a + r.verts, 0);
  // "Body" = everything the export rules say SHOULD be there.
  const expectedVerts = geosets.filter(r => r.expected).reduce((a, r) => a + r.verts, 0);
  const keptVerts = geosets.reduce((a, r) => a + r.kept, 0);
  // Unattributed = the exporter said keep it, and it is not in the file. That is
  // the only number here that means "bug".
  const unattributed = geosets
    .filter(r => r.expected && !r.kept)
    .reduce((a, r) => a + r.verts, 0);
  const droppedByRule = sourceVerts - expectedVerts;

  return {
    model: modelName,
    sourceVerts, expectedVerts, keptVerts, unattributed, droppedByRule,
    lossPct: sourceVerts ? +(100 * droppedByRule / sourceVerts).toFixed(1) : 0,
    revivedGeosets: revived.length,
    geosets
  };
}

// --- buildings mode --------------------------------------------------------
//
// Buildings run through the OTHER converter (convert-mdx-to-gltf.js) and their
// GLBs carry no per-geoset extras, so the grade is per FORM: the verts the
// converter's own selection meant to export must equal the verts in the GLB,
// and every form-visible geoset it dropped must carry a reason (particle-quad,
// fx-texture). Anything else is a silent deletion — the class of bug that
// shipped a Great Hall shorter than a Farm (Base.blp foundation eaten) with
// nothing checking: buildings retained 7-25% of their MDX verts, ungraded.
function auditBuildings () {
  const B = require('./convert-mdx-to-gltf.js');
  const files = B.findBuildingMDXFiles();
  const FORMS = [
    { suffix: '', tag: null },
    { suffix: '_upgrade1', tag: 'first' },
    { suffix: '_upgrade2', tag: 'second' },
    { suffix: '_upgrade3', tag: 'third' }
  ];

  let audited = 0;
  const bugs = [];
  const lossy = [];
  for (const mdxPath of files) {
    const folder = path.basename(path.dirname(mdxPath)).toLowerCase();
    if (onlyModel && folder !== onlyModel) continue;
    let baseSignature = null;
    for (const form of FORMS) {
      let r;
      try { r = B.mdxToBuildingGeosets(mdxPath, form.tag); }
      catch (e) { bugs.push({ model: folder + form.suffix, why: e.message.slice(0, 60) }); break; }
      if (r === undefined || r === null) continue;
      if (!form.tag) baseSignature = r.signature;
      else if (r.signature === baseSignature) continue;   // shares the base GLB

      const name = folder + form.suffix;
      const glbFile = path.join(B.BUILDINGS_OUTPUT_DIR, name + '.glb');
      if (!fs.existsSync(glbFile)) { bugs.push({ model: name, why: 'GLB missing' }); continue; }

      const expected = r.geosets.reduce((s, g) => s + g.positions.length / 3, 0);
      const droppedVerts = r.dropped.reduce((s, d) => s + d.nv, 0);
      const actual = glbGeometry(glbFile).total;
      audited++;
      if (actual !== expected) {
        bugs.push({ model: name, why: 'GLB has ' + actual + ' verts, converter selected ' + expected });
      } else if (droppedVerts) {
        const visible = expected + droppedVerts;
        lossy.push({ model: name, lossPct: Math.round(100 * droppedVerts / visible), droppedVerts, visible,
          reasons: r.dropped.map(d => d.reason).join(',') });
      }
    }
  }

  console.log('  audited ' + audited + ' building form(s) in ' + B.BUILDINGS_OUTPUT_DIR);
  if (bugs.length) {
    console.log('\n  ✗ ' + bugs.length + ' building form(s) with unattributed loss / export drift:');
    for (const b of bugs) console.log('      ' + b.model.padEnd(34) + b.why);
  } else {
    console.log('\n  ✓ every form-visible vert is either in its GLB or dropped with a reason');
  }
  const big = lossy.filter(l => l.lossPct >= (minLoss || 10)).sort((a, b) => b.lossPct - a.lossPct);
  if (big.length) {
    console.log('\n  rule-attributed loss over ' + (minLoss || 10) + '%:');
    for (const l of big) {
      console.log('      ' + l.model.padEnd(34) + l.lossPct + '%  (' + l.droppedVerts +
        ' of ' + l.visible + ' verts: ' + l.reasons + ')');
    }
  }
  return bugs.length ? 1 : 0;
}

function main () {
  if (argv.includes('--buildings')) return auditBuildings();
  const mappings = getUnitMappings();
  const byModel = {};
  for (const m of Object.values(mappings)) if (!byModel[m.model]) byModel[m.model] = m.mdxPath;

  const results = [];
  for (const [model, mdxPath] of Object.entries(byModel)) {
    if (onlyModel && model !== onlyModel) continue;
    try { results.push(auditModel(model, mdxPath)); }
    catch (e) { results.push({ model, error: e.message.slice(0, 80) }); }
  }

  if (asJson) { console.log(JSON.stringify(results, null, 2)); return 0; }

  if (onlyModel) {
    const r = results[0];
    if (!r) { console.log('no such model: ' + onlyModel); return 1; }
    if (r.error) { console.log(r.model + ': ' + r.error); return 1; }
    console.log('=== ' + r.model + ' ===');
    console.log('  source ' + r.sourceVerts + '  expected ' + r.expectedVerts +
      '  in GLB ' + r.keptVerts + (r.revivedGeosets ? '  (revived ' + r.revivedGeosets + ' effect geoset(s))' : ''));
    for (const g of r.geosets) {
      const status = g.kept ? ('kept ' + g.kept) : (g.reason ? 'dropped: ' + REASONS[g.reason] : 'MISSING');
      console.log('  [' + g.gi + '] ' + String(g.verts).padStart(5) + ' verts  ' +
        (g.revived ? '(revived) ' : '') + status);
    }
    return r.unattributed ? 1 : 0;
  }

  const errors = results.filter(r => r.error);
  const bugs = results.filter(r => !r.error && r.unattributed > 0);
  const lossy = results
    .filter(r => !r.error && !r.unattributed && r.lossPct >= minLoss && r.droppedByRule > 0)
    .sort((a, b) => b.lossPct - a.lossPct);
  const revived = results.filter(r => !r.error && r.revivedGeosets);

  console.log('  audited ' + results.length + ' models in ' + OUTPUT_DIR);

  if (errors.length) {
    console.log('\n  ' + errors.length + ' unreadable:');
    for (const r of errors) console.log('      ' + r.model.padEnd(34) + r.error);
  }

  if (revived.length) {
    console.log('\n  ' + revived.length + ' effect-only model(s) revived (their whole body is additive):');
    for (const r of revived) {
      console.log('      ' + r.model.padEnd(34) + r.keptVerts + ' verts across ' +
        r.revivedGeosets + ' geoset(s)');
    }
  }

  if (bugs.length) {
    console.log('\n  ✗ ' + bugs.length + ' model(s) with UNATTRIBUTED geometry loss:');
    for (const r of bugs) {
      console.log('      ' + r.model.padEnd(34) + r.unattributed + ' verts the exporter meant to keep are not in the GLB');
    }
  } else {
    console.log('\n  ✓ no unattributed geometry loss');
  }

  if (minLoss && lossy.length) {
    console.log('\n  rule-attributed loss over ' + minLoss + '%:');
    for (const r of lossy) {
      console.log('      ' + r.model.padEnd(34) + r.lossPct + '%  (' +
        r.droppedByRule + ' of ' + r.sourceVerts + ' verts)');
    }
  }
  return bugs.length ? 1 : 0;
}

process.exit(main());
