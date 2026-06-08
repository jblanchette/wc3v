/**
 * Validate a .glb/.gltf against the Khronos glTF spec (report-only).
 *
 * Usage:
 *   node tools/validate-glb.js client/assets/models/units/footman.glb
 *   node tools/validate-glb.js client/assets/models/units/footman.glb --verbose
 */
const fs = require('fs');
const validator = require('gltf-validator');

const file = process.argv[2];
const verbose = process.argv.includes('--verbose');
if (!file || !fs.existsSync(file)) { console.error('Usage: node tools/validate-glb.js <file.glb> [--verbose]'); process.exit(1); }

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
