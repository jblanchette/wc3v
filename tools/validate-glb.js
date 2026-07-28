/**
 * Validate a .glb/.gltf against the Khronos glTF spec (report-only).
 *
 * Usage:
 *   node tools/validate-glb.js client/assets/models/units/footman.glb
 *   node tools/validate-glb.js client/assets/models/units/footman.glb --verbose
 *   node tools/validate-glb.js client/assets/models/units/footman.glb --materials
 */
const fs = require('fs');
const validator = require('gltf-validator');

const file = process.argv[2];
const verbose = process.argv.includes('--verbose');
const showMaterials = process.argv.includes('--materials');
if (!file || !fs.existsSync(file)) { console.error('Usage: node tools/validate-glb.js <file.glb> [--verbose] [--materials]'); process.exit(1); }

// Parse the JSON chunk out of a binary GLB (for --materials inspection).
function readGlbJson (buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) return null; // not GLB
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
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
