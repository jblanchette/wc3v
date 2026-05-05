/**
 * One-off script to prepare Dolphin WSL S2 replays for import.
 * - Renames .w3g files (spaces → dashes)
 * - Generates import.json with tournament + per-replay metadata
 */

const fs = require('fs');
const path = require('path');

const importDir = path.join(__dirname, '..', 'replays', 'import');

// ── Raw match table from warcraft.info ──────────────────────
// Parsed into structured data. Order is reverse-chronological from the site.
const rawMatches = [
  { date: '2026-03-19', map: 'Springtime 1.3',       p1: 'LabyRinth',  p2: 'ColorFul',  score: [0, 1] },
  { date: '2026-02-08', map: 'Springtime 1.3',       p1: 'Life',       p2: 'Happy' },
  { date: '2026-02-08', map: 'Echo Isles 2.2',       p1: 'Happy',      p2: 'Life' },
  { date: '2026-02-08', map: 'Shattered Exile',      p1: 'Happy',      p2: 'Life' },
  { date: '2026-02-08', map: 'Last Refuge 1.5',      p1: 'Life',       p2: 'Happy' },
  { date: '2026-02-08', map: 'Turtle Rock 1.6',      p1: 'Life',       p2: 'Happy' },
  { date: '2026-02-08', map: 'Hammerfall',            p1: 'FoCuS',      p2: 'Eer0' },
  { date: '2026-02-08', map: 'Turtle Rock 1.6',      p1: 'FoCuS',      p2: 'Eer0' },
  { date: '2026-02-08', map: 'Shattered Exile',      p1: 'Eer0',       p2: 'FoCuS' },
  { date: '2026-02-08', map: 'Tidehunters 1.2',      p1: 'Eer0',       p2: 'FoCuS' },
  { date: '2026-02-08', map: 'Autumn Leaves 2.0',    p1: 'Eer0',       p2: 'Life' },
  { date: '2026-02-08', map: 'Shattered Exile',      p1: 'Life',       p2: 'Eer0' },
  { date: '2026-02-08', map: 'Turtle Rock 1.6',      p1: 'Eer0',       p2: 'Life' },
  { date: '2026-02-08', map: 'Autumn Leaves 2.0',    p1: 'FoCuS',      p2: 'Happy' },
  { date: '2026-02-08', map: 'Springtime 1.3',       p1: 'FoCuS',      p2: 'Happy' },
  { date: '2026-02-08', map: 'Turtle Rock 1.6',      p1: 'FoCuS',      p2: 'Happy' },
  { date: '2026-02-07', map: 'Shattered Exile',      p1: 'FoCuS',      p2: 'Happy' },
  { date: '2026-02-07', map: 'Autumn Leaves 2.0',    p1: 'Fortitude',  p2: 'Life' },
  { date: '2026-02-07', map: 'Turtle Rock 1.6',      p1: 'Life',       p2: 'Fortitude' },
  { date: '2026-02-07', map: 'Springtime 1.3',       p1: 'Fortitude',  p2: 'Life' },
  { date: '2026-02-07', map: 'Tidehunters 1.2',      p1: 'Life',       p2: 'Fortitude' },
  { date: '2026-02-07', map: 'Twisted Meadows 1.1',  p1: 'Life',       p2: 'Fortitude' },
  { date: '2026-02-07', map: 'Autumn Leaves 2.0',    p1: 'FoCuS',      p2: 'Lyn' },
  { date: '2026-02-07', map: 'Twisted Meadows 1.1',  p1: 'FoCuS',      p2: 'Lyn' },
  { date: '2026-02-07', map: 'Echo Isles 2.2',       p1: 'FoCuS',      p2: 'Lyn' },
  { date: '2026-02-07', map: 'Turtle Rock 1.6',      p1: 'FoCuS',      p2: 'Lyn' },
  { date: '2026-02-07', map: 'Hammerfall',            p1: 'FoCuS',      p2: 'Lyn' },
  { date: '2026-02-07', map: 'Turtle Rock 1.6',      p1: 'Kaho',       p2: 'Happy' },
  { date: '2026-02-07', map: 'Last Refuge 1.5',      p1: 'Kaho',       p2: 'Happy' },
  { date: '2026-02-07', map: 'Echo Isles 2.2',       p1: 'Happy',      p2: 'Kaho' },
  { date: '2026-02-07', map: 'Springtime 1.3',       p1: 'Kaho',       p2: 'Happy' },
  { date: '2026-02-07', map: 'Hammerfall',            p1: 'Kaho',       p2: 'Happy' },
  { date: '2026-02-06', map: 'Last Refuge 1.5',      p1: 'LabyRinth',  p2: 'ColorFul' },
  { date: '2026-02-06', map: 'Autumn Leaves 2.0',    p1: 'Sok',        p2: 'Fortitude' },
  { date: '2026-02-05', map: 'Echo Isles 2.2',       p1: 'ColorFul',   p2: 'LabyRinth' },
  { date: '2026-02-05', map: 'Twisted Meadows 1.1',  p1: 'LabyRinth',  p2: 'ColorFul' },
  { date: '2026-02-05', map: 'Autumn Leaves 2.0',    p1: 'ColorFul',   p2: 'LabyRinth' },
  { date: '2026-02-05', map: 'Tidehunters 1.2',      p1: 'Sok',        p2: 'Fortitude' },
  { date: '2026-02-05', map: 'Twisted Meadows 1.1',  p1: 'Sok',        p2: 'Fortitude' },
  { date: '2026-02-05', map: 'Hammerfall',            p1: 'Fortitude',  p2: 'Sok' },
  { date: '2026-02-05', map: 'Tidehunters 1.2',      p1: 'FoCuS',      p2: 'LawLiet' },
  { date: '2026-02-05', map: 'Springtime 1.3',       p1: 'FoCuS',      p2: 'LawLiet' },
  { date: '2026-02-05', map: 'Autumn Leaves 2.0',    p1: 'FoCuS',      p2: 'LawLiet' },
  { date: '2026-02-05', map: 'Springtime 1.3',       p1: 'Kaho',       p2: 'Moon' },
  { date: '2026-02-05', map: 'Hammerfall',            p1: 'Kaho',       p2: 'Moon' },
  { date: '2026-02-05', map: 'Turtle Rock 1.6',      p1: 'Kaho',       p2: 'Moon' },
  { date: '2026-02-04', map: 'Autumn Leaves 2.0',    p1: 'Moon',       p2: 'Kaho' },
];

// ── Group into series ───────────────────────────────────────
// A series = same two players on same or adjacent dates
function seriesKey(m) {
  const players = [m.p1, m.p2].sort();
  return `${players[0]}_${players[1]}`;
}

// Group matches by series key, keeping table order (reverse-chronological)
const seriesMap = {};
for (const m of rawMatches) {
  const key = seriesKey(m);
  if (!seriesMap[key]) seriesMap[key] = [];
  seriesMap[key].push(m);
}

// Within each series, reverse to get chronological order and assign game numbers
const series = {};
for (const [key, matches] of Object.entries(seriesMap)) {
  matches.reverse(); // now chronological
  series[key] = matches.map((m, i) => ({ ...m, gameNum: i + 1, totalGames: matches.length }));
}

// Determine stage based on date and series size
function inferStage(match, seriesMatches) {
  const date = match.date;
  if (date === '2026-03-19') return 'Grand Final';
  if (date <= '2026-02-06') return 'Group Stage';
  if (date === '2026-02-07') return 'Quarterfinals';
  // Feb 8 matches
  const key = seriesKey(match);
  const players = [match.p1, match.p2].sort();
  // Life vs Happy on Feb 8 = Finals
  if (players.includes('Life') && players.includes('Happy') && date === '2026-02-08') return 'Final';
  return 'Semifinals';
}

// ── Map filenames to match data ─────────────────────────────
// Filename pattern: {hash}_{P1}_{P2}_{MapName}.w3g
const files = fs.readdirSync(importDir).filter(f => f.endsWith('.w3g'));

// Normalize map name for comparison
function normalizeMap(map) {
  return map.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Build a lookup: normalize(p1_p2_map) → array of matches (for duplicate maps in same series)
const matchLookup = {};
const allMatches = Object.values(series).flat();
for (const m of allMatches) {
  // Try both orderings since filename order may differ from table
  const keys = [
    `${m.p1}_${m.p2}_${normalizeMap(m.map)}`,
    `${m.p2}_${m.p1}_${normalizeMap(m.map)}`
  ];
  for (const k of keys) {
    if (!matchLookup[k]) matchLookup[k] = [];
    matchLookup[k].push(m);
  }
}

// Track which matches have been used (for disambiguation)
const usedMatches = new Set();

const replays = {};
const renames = [];

for (const file of files) {
  const base = path.basename(file, '.w3g');
  // Parse: {hash}_{P1}_{P2}_{MapName}
  const parts = base.split('_');
  const hash = parts[0];
  const p1 = parts[1];
  const p2 = parts[2];
  const mapPart = parts.slice(3).join('_');

  const lookupKey = `${p1}_${p2}_${normalizeMap(mapPart)}`;
  const candidates = (matchLookup[lookupKey] || []).filter(m => !usedMatches.has(m));

  let match = candidates[0] || null;
  if (match) usedMatches.add(match);

  // Clean filename: replace spaces with dashes
  const cleanBase = base.replace(/\s+/g, '-');
  const cleanFile = cleanBase + '.w3g';

  if (cleanFile !== file) {
    renames.push({ from: file, to: cleanFile });
  }

  const stage = match ? inferStage(match, null) : '';
  const round = match ? `Game ${match.gameNum}` : '';

  replays[cleanFile] = {
    stage,
    round,
    ...(match && match.score ? { outcome: {} } : {})
  };
}

// ── Rename files ────────────────────────────────────────────
console.log(`Renaming ${renames.length} files (removing spaces)...\n`);
for (const { from, to } of renames) {
  const srcPath = path.join(importDir, from);
  const destPath = path.join(importDir, to);
  fs.renameSync(srcPath, destPath);
  console.log(`  ${from} → ${to}`);
}

// ── Write import.json ───────────────────────────────────────
const importJson = {
  tournament: {
    id: 'dolphin-wsl-s2',
    name: 'Dolphin Warcraft Super League Season 2',
    shortName: 'Dolphin WSL S2',
    date: '2026-02-04',
    endDate: '2026-03-19',
    organizer: 'Dolphin',
    tier: 1,
    region: 'China',
    mapPool: [
      'Autumn Leaves',
      'Echo Isles 2',
      'Hammerfall',
      'Last Refuge',
      'Shattered Exile',
      'Springtime',
      'Tidehunters',
      'Turtle Rock',
      'Twisted Meadows'
    ],
    url: ''
  },
  replays
};

const outPath = path.join(importDir, 'import.json');
fs.writeFileSync(outPath, JSON.stringify(importJson, null, 2) + '\n');

console.log(`\nWrote import.json with ${Object.keys(replays).length} replay entries.`);
console.log(`Tournament: ${importJson.tournament.name}`);

// Print series summary
console.log('\nSeries summary:');
for (const [key, matches] of Object.entries(series)) {
  const stage = inferStage(matches[0], matches);
  const players = key.split('_');
  console.log(`  ${stage}: ${players[0]} vs ${players[1]} (${matches.length} games)`);
}
