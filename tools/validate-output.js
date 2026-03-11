/*
  Validates .wc3v replay output files for structural integrity.

  Usage:
    node tools/validate-output.js --replay=NAME
    node tools/validate-output.js --all
*/

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPLAYS_DIR = path.join(__dirname, '..', 'client', 'replays');
const MAX_DECOMPRESSED_SIZE = 50 * 1024 * 1024; // 50MB warning threshold

const readCliArgs = () => {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    const match = arg.match(/^--(\w+)(?:=(.*))?$/);
    if (match) {
      args[match[1]] = match[2] !== undefined ? match[2] : true;
    }
  });
  return args;
};

const validateReplay = (filePath) => {
  const name = path.basename(filePath);
  const warnings = [];
  const errors = [];

  // 1. Check file exists
  if (!fs.existsSync(filePath)) {
    errors.push(`File not found: ${filePath}`);
    return { name, passed: false, warnings, errors };
  }

  // 2. Decompress
  let jsonText;
  try {
    const gz = fs.readFileSync(filePath);
    jsonText = zlib.gunzipSync(gz).toString('utf8');
  } catch (e) {
    errors.push(`Decompression failed: ${e.message}`);
    return { name, passed: false, warnings, errors };
  }

  // 3. Size check
  if (jsonText.length > MAX_DECOMPRESSED_SIZE) {
    warnings.push(`Large file: ${(jsonText.length / 1024 / 1024).toFixed(1)}MB decompressed (threshold: ${MAX_DECOMPRESSED_SIZE / 1024 / 1024}MB)`);
  }

  // 4. JSON parse
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    errors.push(`JSON parse error: ${e.message}`);
    // Show context around the error position
    const posMatch = e.message.match(/position (\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1]);
      const before = jsonText.substring(Math.max(0, pos - 60), pos);
      const after = jsonText.substring(pos, pos + 60);
      errors.push(`  Context: ...${before}>>HERE>>${after}...`);
    }
    return { name, passed: false, warnings, errors };
  }

  // 5. Required top-level keys
  const requiredKeys = ['players', 'world', 'replay'];
  for (const key of requiredKeys) {
    if (!data[key]) {
      errors.push(`Missing top-level key: ${key}`);
    }
  }

  // 6. Check for serialized Buffer objects ({"type":"Buffer","data":[...]})
  const bufferPattern = /"type"\s*:\s*"Buffer"\s*,\s*"data"\s*:\s*\[/;
  if (bufferPattern.test(jsonText)) {
    warnings.push('Contains serialized Buffer object(s) — these bloat the file and are likely unneeded by the client');
  }

  // 7. Replay metadata
  if (data.replay) {
    if (!data.replay.metadata || !data.replay.metadata.map) {
      errors.push('Missing replay.metadata.map — client cannot resolve map name');
    } else if (!data.replay.metadata.map.mapName) {
      errors.push('Missing replay.metadata.map.mapName');
    }
  }

  // 8. Player data validation
  if (data.players) {
    for (const [playerId, player] of Object.entries(data.players)) {
      const prefix = `Player ${playerId}`;

      if (!player.eventStream) {
        warnings.push(`${prefix}: missing eventStream`);
      } else if (!player.eventStream.length) {
        warnings.push(`${prefix}: empty eventStream`);
      }

      if (!player.units) {
        warnings.push(`${prefix}: missing units`);
      }

      if (!player.tierStream) {
        warnings.push(`${prefix}: missing tierStream`);
      }

      if (player.groupStream) {
        const groupSize = JSON.stringify(player.groupStream).length;
        warnings.push(`${prefix}: groupStream present (${(groupSize / 1024).toFixed(0)}KB) — unused by client`);
      }
    }
  }

  const passed = errors.length === 0;
  return { name, passed, warnings, errors, decompressedSize: jsonText.length };
};

const run = () => {
  const args = readCliArgs();

  let files = [];

  if (args.all) {
    files = fs.readdirSync(REPLAYS_DIR)
      .filter(f => f.endsWith('.wc3v.gz'))
      .map(f => path.join(REPLAYS_DIR, f));
  } else if (args.replay) {
    let name = args.replay;
    if (!name.endsWith('.wc3v.gz')) {
      name += '.wc3v.gz';
    }
    files = [path.join(REPLAYS_DIR, name)];
  } else {
    console.log('Usage:');
    console.log('  node tools/validate-output.js --replay=NAME');
    console.log('  node tools/validate-output.js --all');
    process.exit(1);
  }

  console.log(`Validating ${files.length} replay(s)...\n`);

  let totalPassed = 0;
  let totalFailed = 0;
  let totalWarnings = 0;

  for (const file of files) {
    const result = validateReplay(file);

    const sizeStr = result.decompressedSize
      ? ` (${(result.decompressedSize / 1024 / 1024).toFixed(1)}MB)`
      : '';

    if (result.passed && result.warnings.length === 0) {
      console.log(`  PASS  ${result.name}${sizeStr}`);
      totalPassed++;
    } else if (result.passed) {
      console.log(`  WARN  ${result.name}${sizeStr}`);
      result.warnings.forEach(w => console.log(`        - ${w}`));
      totalPassed++;
      totalWarnings += result.warnings.length;
    } else {
      console.log(`  FAIL  ${result.name}${sizeStr}`);
      result.errors.forEach(e => console.log(`        ERROR: ${e}`));
      result.warnings.forEach(w => console.log(`        WARN:  ${w}`));
      totalFailed++;
      totalWarnings += result.warnings.length;
    }
  }

  console.log(`\n${totalPassed} passed, ${totalFailed} failed, ${totalWarnings} warnings`);

  if (totalFailed > 0) {
    process.exit(1);
  }
};

// Export for use from wc3v.js
module.exports = { validateReplay };

// Only run CLI when called directly
if (require.main === module) {
  run();
}
