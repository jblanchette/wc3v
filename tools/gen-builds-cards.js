/**
 * gen-builds-cards.js — precompute the tiny slice of replay-summary data the
 * homepage build cards need at first paint, so index.html no longer fetches
 * ~6-8MB of per-replay summaries before the grid renders.
 *
 * The card render (client/index.html buildCard) only uses, per build,
 * `summaries/<replays[0].replayId>.json` → players[playerSlot].researched,
 * and only the {itemId, level, icon, name} fields of each entry (the rest is
 * looked up client-side via RESEARCH_META). Everything else a card draws
 * (heroSkills, coreUpgrades, keyUnits, tierProgression) is already inline in
 * builds-manifest.json. Full summaries are still loaded lazily when a card's
 * "+more replays" modal is opened.
 *
 * Output: client/data/builds-cards.json
 *   { generatedAt, cards: { <replayId>: { <playerSlot>: [ {itemId,level,icon,name} ] } } }
 *
 * Stable key ordering + 2-space JSON so gen-asset-manifest.js's content hash
 * only moves when the data actually changes. Node built-ins only (runs on the
 * Render static build with no npm install).
 *
 * Usage:
 *   node tools/gen-builds-cards.js
 *   node tools/gen-builds-cards.js --dry-run
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const summariesDir = path.join(rootDir, 'client', 'data', 'summaries');
const manifestPath = path.join(rootDir, 'client', 'data', 'builds-manifest.json');
const outPath = path.join(rootDir, 'client', 'data', 'builds-cards.json');

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--check');

function readResearched(replayId, playerSlot) {
  const p = path.join(summariesDir, `${replayId}.json`);
  if (!fs.existsSync(p)) return null;
  let j;
  try {
    j = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return null;
  }
  const ps = j.players && j.players[playerSlot];
  if (!ps || !Array.isArray(ps.researched)) return null;
  // Keep only the fields the badge render reads (index.html ~1594-1604).
  return ps.researched.map(r => ({
    itemId: r.itemId,
    level: r.level,
    icon: r.icon,
    name: r.name
  }));
}

function main() {
  if (!fs.existsSync(manifestPath)) {
    console.error(`Manifest not found: ${manifestPath}`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (!Array.isArray(manifest.builds)) {
    console.error('Manifest has no builds[] — aborting.');
    process.exit(1);
  }

  const cards = {};
  let withData = 0, missing = 0, noReplay = 0;

  for (const build of manifest.builds) {
    const first = (build.replays || [])[0];
    if (!first || !first.replayId) { noReplay++; continue; }
    const slot = String(first.playerSlot);
    const researched = readResearched(first.replayId, slot);
    if (!researched) {
      console.log(`  no researched data for ${build.id} (${first.replayId} slot ${slot})`);
      missing++;
      continue;
    }
    if (!cards[first.replayId]) cards[first.replayId] = {};
    cards[first.replayId][slot] = researched;
    withData++;
  }

  // Stable ordering: sort replayId keys, and slot keys within each.
  const orderedCards = {};
  for (const rid of Object.keys(cards).sort()) {
    const slots = {};
    for (const s of Object.keys(cards[rid]).sort()) slots[s] = cards[rid][s];
    orderedCards[rid] = slots;
  }

  const out = { generatedAt: new Date().toISOString(), cards: orderedCards };
  const json = JSON.stringify(out, null, 2) + '\n';

  if (!dryRun) fs.writeFileSync(outPath, json);

  console.log(
    `builds-cards: ${withData} build(s) with card data, ` +
    `${missing} missing, ${noReplay} without replays` +
    `${dryRun ? ' (dry run — nothing written)' : ''}`
  );
  console.log(`  ${(Buffer.byteLength(json) / 1024).toFixed(1)} KB → ${path.relative(rootDir, outPath)}`);
}

main();
