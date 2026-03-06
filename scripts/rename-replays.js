const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPLAYS_DIR = path.join(ROOT, 'replays');
const CLIENT_REPLAYS_DIR = path.join(ROOT, 'client', 'replays');
const MANIFEST_PATH = path.join(ROOT, 'client', 'data', 'builds-manifest.json');

// old name (without extension) → new name (without extension)
const RENAME_MAP = {
  '69283351_Life_Happy_Echo Isles 22':          'happy-vs-life-echo-isles',
  '4118386912_Kaho_Happy_EchoIsles':            'happy-vs-kaho-echo-isles',
  '1889507978_Happy_Kaho_Turtle Rock':          'happy-vs-kaho-turtle-rock',
  '9899178_Life_Happy_Turtle Rock 16':          'happy-vs-life-turtle-rock',
  '1743254442_Life_Happy_Hammerfall':            'happy-vs-life-hammerfall',
  '2290893065_Happy_Life_Shattered Exile':       'happy-vs-life-shattered-exile',
  '3317807137_Happy_Life_Springtime 13':         'happy-vs-life-springtime',
  '3614394261_Life_Happy_Autumn Leaves 20':      'happy-vs-life-autumn-leaves'
};

const execute = process.argv.includes('--execute');

console.log(execute ? '=== EXECUTING RENAMES ===' : '=== DRY RUN (use --execute to apply) ===');
console.log('');

let renamedCount = 0;
let skippedCount = 0;
let errorCount = 0;

function renameFile (oldPath, newPath, label) {
  if (!fs.existsSync(oldPath)) {
    console.log(`  SKIP ${label}: source not found`);
    skippedCount++;
    return;
  }

  if (fs.existsSync(newPath)) {
    console.log(`  SKIP ${label}: target already exists`);
    skippedCount++;
    return;
  }

  if (execute) {
    try {
      fs.renameSync(oldPath, newPath);
      console.log(`  OK   ${label}`);
      renamedCount++;
    } catch (e) {
      console.log(`  ERR  ${label}: ${e.message}`);
      errorCount++;
    }
  } else {
    console.log(`  WOULD rename: ${path.basename(oldPath)}`);
    console.log(`            to: ${path.basename(newPath)}`);
    renamedCount++;
  }
}

// rename replay files
for (const [oldName, newName] of Object.entries(RENAME_MAP)) {
  console.log(`\n${oldName} → ${newName}`);

  // .w3g source replay
  renameFile(
    path.join(REPLAYS_DIR, `${oldName}.w3g`),
    path.join(REPLAYS_DIR, `${newName}.w3g`),
    '.w3g'
  );

  // .wc3v.gz parsed output
  renameFile(
    path.join(CLIENT_REPLAYS_DIR, `${oldName}.wc3v.gz`),
    path.join(CLIENT_REPLAYS_DIR, `${newName}.wc3v.gz`),
    '.wc3v.gz'
  );

  // .wc3v uncompressed debug (may not exist)
  renameFile(
    path.join(CLIENT_REPLAYS_DIR, `${oldName}.wc3v`),
    path.join(CLIENT_REPLAYS_DIR, `${newName}.wc3v`),
    '.wc3v'
  );
}

// update builds-manifest.json
console.log('\n--- builds-manifest.json ---');
const manifest = fs.readFileSync(MANIFEST_PATH, 'utf8');
let updated = manifest;

for (const [oldName, newName] of Object.entries(RENAME_MAP)) {
  if (updated.includes(oldName)) {
    updated = updated.split(oldName).join(newName);
    console.log(`  ${execute ? 'REPLACED' : 'WOULD replace'}: "${oldName}" → "${newName}"`);
  }
}

if (updated !== manifest) {
  if (execute) {
    fs.writeFileSync(MANIFEST_PATH, updated, 'utf8');
    console.log('  Manifest written.');
  } else {
    console.log('  (manifest not written in dry-run)');
  }
}

console.log(`\n--- Summary ---`);
console.log(`  ${execute ? 'Renamed' : 'Would rename'}: ${renamedCount}`);
console.log(`  Skipped: ${skippedCount}`);
console.log(`  Errors: ${errorCount}`);

if (!execute) {
  console.log('\nRun with --execute to apply changes.');
}
