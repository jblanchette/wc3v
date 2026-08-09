/**
 * Validate a .glb/.gltf against the Khronos glTF spec (report-only).
 *
 * Usage:
 *   node tools/validate-glb.js client/assets/models/units/footman.glb
 *   node tools/validate-glb.js client/assets/models/units/footman.glb --verbose
 *   node tools/validate-glb.js client/assets/models/units/footman.glb --materials
 *   node tools/validate-glb.js --untextured [DIR]   # roster-wide white-blob sweep
 */
const fs = require('fs');
const path = require('path');
const validator = require('gltf-validator');

const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const showMaterials = argv.includes('--materials');
const untexturedSweep = argv.includes('--untextured');
const file = argv.find(a => !a.startsWith('--'));

// Parse the JSON chunk out of a binary GLB (for --materials inspection).
function readGlbJson (buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) return null; // not GLB
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
}

/**
 * Sweep a directory for models that will render as untextured white geometry.
 *
 * A GLB with no materials, or whose materials carry no baseColorTexture, gets
 * three.js's default white material — which is exactly how a broken export
 * looks on the map. The usual cause is a diffuse texture the exporter could not
 * resolve, so it dropped the material and carried on. That is a warning in a
 * build log nobody reads; it is a white blob on screen.
 *
 * Purely a JSON-chunk read, so it is fast enough to run over the whole roster.
 */
function sweepUntextured (dir) {
  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.glb')).sort();
  const bad = [];
  for (const f of files) {
    let gltf;
    try { gltf = readGlbJson(fs.readFileSync(path.join(dir, f))); }
    catch (e) { bad.push([f, 'unreadable: ' + e.message]); continue; }
    if (!gltf) { bad.push([f, 'not a binary GLB']); continue; }
    const mats = gltf.materials || [];
    if (!mats.length) { bad.push([f, 'NO MATERIALS']); continue; }
    const textured = mats.filter(m => (m.pbrMetallicRoughness || {}).baseColorTexture);
    // A material with no texture is legitimate when it is a flat team-colour
    // overlay (replaceableId 1/2) — the client tints those at runtime. Only flag
    // a model where NOTHING carries a texture.
    if (!textured.length) bad.push([f, `${mats.length} material(s), none textured`]);
  }
  console.log(`  scanned ${files.length} models in ${dir}`);
  if (!bad.length) { console.log('  ✓ every model carries a textured material'); return 0; }
  console.log(`  ✗ ${bad.length} untextured:`);
  for (const [f, why] of bad) console.log(`      ${f.padEnd(36)} ${why}`);
  return 1;
}

if (untexturedSweep) {
  const dir = file || path.join(__dirname, '..', 'client', 'assets', 'models', 'units');
  process.exit(sweepUntextured(dir));
}

if (!file || !fs.existsSync(file)) {
  console.error('Usage: node tools/validate-glb.js <file.glb> [--verbose] [--materials]');
  console.error('       node tools/validate-glb.js --untextured [DIR]');
  process.exit(1);
}

if (showMaterials) {
  const gltf = readGlbJson(fs.readFileSync(file));
  console.log(file + '  — MATERIALS');
  (gltf && gltf.materials || []).forEach((m, i) => {
    const pbr = m.pbrMetallicRoughness || {};
    const tex = pbr.baseColorTexture ? 'tex#' + pbr.baseColorTexture.index : 'no-tex';
    const factor = pbr.baseColorFactor ? 'factor=[' + pbr.baseColorFactor.map(x => +x.toFixed(2)).join(',') + ']' : '';
    const alpha = (m.alphaMode || 'OPAQUE') + (m.alphaCutoff != null ? '(' + m.alphaCutoff + ')' : '');
    const wc3 = m.extras ? JSON.stringify(m.extras) : '{}';
    console.log('  [' + i + '] ' + (m.name || '') + '  ' + tex + ' ' + factor +
      '  alpha=' + alpha + (m.doubleSided ? ' 2sided' : '') + '  wc3=' + wc3);
  });
}

validator.validateBytes(new Uint8Array(fs.readFileSync(file)))
  .then(report => {
    const i = report.issues;
    console.log(file);
    console.log('  errors=' + i.numErrors + ' warnings=' + i.numWarnings +
      ' infos=' + i.numInfos + ' hints=' + i.numHints);
    if (report.info) {
      console.log('  version=' + report.info.version +
        ' drawCalls~' + (report.info.drawCallCount || '?') +
        ' animations=' + (report.info.animationCount || 0) +
        ' totalVerts=' + (report.info.totalVertexCount || '?'));
    }
    const show = verbose ? i.messages : i.messages.filter(m => m.severity <= 1); // 0=error,1=warning
    for (const m of show) {
      const sev = ['ERROR', 'WARN', 'INFO', 'HINT'][m.severity] || m.severity;
      console.log('  [' + sev + '] ' + m.code + ' @ ' + (m.pointer || '') + ' — ' + m.message);
    }
    process.exit(i.numErrors > 0 ? 1 : 0);
  })
  .catch(err => { console.error(err); process.exit(1); });
