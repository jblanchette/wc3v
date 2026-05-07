/**
 * match-replays.js — Match parsed replays to manifest builds.
 *
 * Modes:
 *   inventory:  print bucketed counts + detailed listing (default)
 *   plan:       for each manifest build, pick top N replays + emit JSON
 *
 * Usage:
 *   node tools/add-replay.js --summary > /tmp/wc3v-summary.log
 *   node tools/match-replays.js [--mode=inventory|plan] [--cap=5] [--tournament=ID] [summary-file]
 */

const fs = require('fs');
const path = require('path');

const args = {};
process.argv.slice(2).forEach(raw => {
  if (raw.startsWith('--')) {
    const [flag, ...rest] = raw.replace(/^--/, '').split('=');
    args[flag] = rest.join('=') || true;
  } else {
    args._file = raw;
  }
});

const mode = args.mode || 'inventory';
const cap = parseInt(args.cap || '5', 10);
const tournamentId = args.tournament || 'bcup-s22';

const summaryPath = args._file || '/tmp/wc3v-summary.log';
const input = fs.readFileSync(summaryPath, 'utf8');

const blocks = input.split(/\n=== /).slice(1);

const replays = [];
for (const block of blocks) {
  const lines = block.split('\n');
  const id = lines[0].replace(/ ===.*$/, '').trim();
  const inManifest = lines[0].includes('[IN MANIFEST]');

  const map = (lines.find(l => l.startsWith('  Map:')) || '').replace('  Map:', '').trim();
  const matchup = (lines.find(l => l.startsWith('  Matchup:')) || '').replace('  Matchup:', '').trim();

  const playerLines = lines.filter(l => /^  Player \d+:/.test(l));
  const players = playerLines.map(l => {
    const m = l.match(/^  Player (\d+): (.+?) \(([HOEU])\) — (\d+) events — Heroes: \[(.*?)\] — Tiers: \[(.*?)\]$/);
    if (!m) return null;
    const heroes = m[5].split(', ').map(s => s.trim()).filter(Boolean);
    const tiers = m[6].split(', ').map(s => s.trim()).filter(Boolean);
    return {
      slot: m[1],
      name: m[2].replace(/#\d+$/, ''),
      race: m[3],
      events: parseInt(m[4]),
      heroes,
      opener: heroes[0] || null,
      tiers,
    };
  }).filter(Boolean);

  replays.push({ id, map, matchup, inManifest, players });
}

// Skip partials (only one player)
const partials = replays.filter(r => r.players.length < 2);
const fullReplays = replays.filter(r => r.players.length >= 2);

if (mode === 'inventory') {
  printInventory();
} else if (mode === 'plan') {
  printPlan(false);
} else if (mode === 'apply') {
  printPlan(true);
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(1);
}

function printInventory() {
  // (same as before — see prior version) — kept brief here
  const byMatchup = {};
  for (const r of fullReplays) {
    byMatchup[r.matchup] = byMatchup[r.matchup] || [];
    byMatchup[r.matchup].push(r);
  }
  console.log(`\n=== INVENTORY: ${fullReplays.length} full replays (${partials.length} partial) ===\n`);
  for (const m of Object.keys(byMatchup).sort()) {
    console.log(`  ${m}: ${byMatchup[m].length}`);
  }
  if (partials.length) {
    console.log(`\nPartials (skipped):`);
    for (const r of partials) console.log(`  ${r.id}`);
  }
}

function printPlan(apply) {
  const manifestPath = path.join(__dirname, '..', 'client', 'data', 'builds-manifest.json');
  const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw);

  const heroOpenerToRace = { 'Death Knight': 'U', 'Lich': 'U', 'Crypt Lord': 'U', 'Dread Lord': 'U',
    'Blademaster': 'O', 'Far Seer': 'O', 'Tauren Chieftain': 'O', 'Shadow Hunter': 'O',
    'Archmage': 'H', 'Mountain King': 'H', 'Paladin': 'H', 'Blood Mage': 'H',
    'Demon Hunter': 'E', 'Keeper of the Grove': 'E', 'Priestess of the Moon': 'E', 'Warden': 'E' };

  // Round-robin distribute: each (replay, player) goes to AT MOST ONE build per
  // matching race+opener. Different players in same game can land in different builds.
  const buildAssignments = {};
  for (const b of manifest.builds) buildAssignments[b.id] = [];

  // Build candidate lists keyed by (replayId|slot) — one player perspective
  const claimed = new Set(); // "replayId|slot" → string

  // Sort builds so empty/sparse builds get first pick
  const buildsByPriority = [...manifest.builds].sort((a, b) => (a.replays||[]).length - (b.replays||[]).length);

  for (const build of buildsByPriority) {
    const candidates = [];
    for (const r of fullReplays) {
      for (const p of r.players) {
        const key = `${r.id}|${p.slot}`;
        if (claimed.has(key)) continue;
        if (p.race !== build.race) continue;
        if (p.opener !== build.heroOpener) continue;
        const opponent = r.players.find(o => o.slot !== p.slot);
        if (!opponent) continue;
        const ok = (build.matchups || []).some(mu => {
          const expected = mu.replace(build.race, '').replace('v', '');
          return expected === opponent.race || (expected === 'N' && opponent.race === 'E');
        });
        if (!ok) continue;
        candidates.push({ replay: r, player: p, opponent, key });
      }
    }

    // Top-tier player priority: prefer recognizable names
    const topNames = new Set(['AuroraHappy','Happy','HawK','TH000','Egg','Lyn','Lianpia','Cash','LawLiet','Moon','FoCuS','Lucifer','Inspired','LeonXIV','Kaho','KAHO','Sunlight','Medusa','Jens','leqi']);
    candidates.sort((a, b) => {
      const aTop = topNames.has(a.player.name) || topNames.has(a.opponent.name);
      const bTop = topNames.has(b.player.name) || topNames.has(b.opponent.name);
      if (aTop !== bTop) return aTop ? -1 : 1;
      return 0;
    });

    const selected = [];
    const seenMaps = new Set();
    const seenOpponents = new Set();
    for (const c of candidates) {
      if (selected.length >= cap) break;
      // diversity: don't repeat same map + opponent combo
      if (seenMaps.has(c.replay.map) && seenOpponents.has(c.opponent.name)) continue;
      selected.push(c);
      seenMaps.add(c.replay.map);
      seenOpponents.add(c.opponent.name);
      claimed.add(c.key);
    }
    for (const c of candidates) {
      if (selected.length >= cap) break;
      if (claimed.has(c.key)) continue;
      selected.push(c);
      claimed.add(c.key);
    }

    buildAssignments[build.id] = selected;
  }
  const usedReplays = new Set();
  for (const sels of Object.values(buildAssignments)) for (const s of sels) usedReplays.add(s.replay.id);

  // Print plan
  console.log(`\n=== MATCH PLAN (cap=${cap} per build, tournament=${tournamentId}) ===\n`);
  for (const build of manifest.builds) {
    const sel = buildAssignments[build.id];
    const existing = (build.replays || []).length;
    console.log(`### ${build.id} (race=${build.race}, opener=${build.heroOpener}, existing=${existing})`);
    if (!sel.length) { console.log('  (no matches)\n'); continue; }
    for (const s of sel) {
      const dup = (build.replays || []).some(r => r.replayId === s.replay.id);
      console.log(`  ${dup ? '[DUP]' : '  +  '} ${s.replay.id}  ${s.player.name} vs ${s.opponent.name}  ${s.replay.map}`);
      usedReplays.add(s.replay.id);
    }
    console.log('');
  }

  // Replays not assigned to anything
  const unassigned = fullReplays.filter(r => !usedReplays.has(r.id));
  if (unassigned.length) {
    console.log(`\n=== UNASSIGNED REPLAYS (${unassigned.length}) — these may want NEW build entries ===\n`);
    // group by opener-pair
    const groups = {};
    for (const r of unassigned) {
      const key = r.players.map(p => `${p.race}/${p.opener || '?'}`).sort().join(' vs ');
      groups[key] = groups[key] || [];
      groups[key].push(r);
    }
    for (const k of Object.keys(groups).sort()) {
      console.log(`${k}: ${groups[k].length}`);
      for (const r of groups[k]) console.log(`  ${r.id}  ${r.players.map(p => p.name).join(' vs ')}  on ${r.map}`);
      console.log('');
    }
  }

  // Emit JSON additions per build
  let totalAdded = 0;
  console.log(`\n=== ${apply ? 'APPLYING' : 'JSON ADDITIONS'} ===\n`);
  for (const build of manifest.builds) {
    const sel = buildAssignments[build.id];
    if (!sel.length) continue;
    const existingIds = new Set((build.replays || []).map(r => r.replayId + '|' + r.playerSlot));
    const newOnes = sel.filter(s => !existingIds.has(s.replay.id + '|' + s.player.slot));
    if (!newOnes.length) continue;
    console.log(`# ${build.id}: append ${newOnes.length} replay(s)`);
    for (const s of newOnes) {
      const entry = {
        replayId: s.replay.id,
        playerSlot: s.player.slot,
        playerName: s.player.name,
        opponentName: s.opponent.name,
        map: s.replay.map,
        outcome: '',
        notes: '',
        tournamentId
      };
      if (apply) {
        build.replays = build.replays || [];
        build.replays.push(entry);
        totalAdded++;
      } else {
        console.log(JSON.stringify(entry, null, 2));
      }
    }
    console.log('');
  }

  if (apply) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`Wrote ${totalAdded} new replay entries to ${manifestPath}`);
  }
}
