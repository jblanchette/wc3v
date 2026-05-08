// Smoke test for CompareMatcher.rankCandidates composition-aware reordering.
//
// Loads ReplayAnalyzer + CompareMatcher into a vm sandbox, mocks fetch to
// serve the manifest and summaries from disk, then asserts that for a HU
// footman "user" the top-ranked candidates are graded same-build pros — NOT
// divergent rifle/caster pros even when they'd otherwise rank well on
// metadata.
//
// Run: node tools/test-matcher-ranking.js

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT      = path.resolve(__dirname, '..');
const SUMMARIES = path.join(ROOT, 'client', 'data', 'summaries');
const MANIFEST  = path.join(ROOT, 'client', 'data', 'builds-manifest.json');

const sandbox = { console, setTimeout, clearTimeout, window: {}, globalThis: null };
sandbox.globalThis = sandbox;
sandbox.fetch = async (url) => {
  if (url === '/data/builds-manifest.json') {
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) };
  }
  const m = url.match(/^\/data\/summaries\/(.+)\.json$/);
  if (m) {
    const p = path.join(SUMMARIES, m[1] + '.json');
    if (!fs.existsSync(p)) return { ok: false, status: 404 };
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
  }
  return { ok: false, status: 404 };
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'client/js/ReplayAnalyzer.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'client/js/CompareMatcher.js'), 'utf8'), sandbox);

const CompareMatcher = sandbox.window.CompareMatcher;
if (!CompareMatcher) {
  console.error('FATAL: CompareMatcher not loaded');
  process.exit(2);
}

// Build a userSummary by reading a real pro's summary from disk and using
// it as the user-side input. Cleanest way to get a realistic shape.
const useAsUser = (id, slot) => {
  const s = JSON.parse(fs.readFileSync(path.join(SUMMARIES, id + '.json'), 'utf8'));
  s.replayId = 'local-test-' + id;
  s.fingerprint = 'local-test-fingerprint-' + id;  // Avoid matching manifest
  return { summary: s, slot };
};

const main = async () => {
  const matcher = new CompareMatcher();
  const failures = [];

  // ── Test 1: HU all-footman user should rank graded same-build pros at top
  // 1499624326_Ugly_TH000_Hammerfall slot 2 = HU mass-footman, 1116s
  {
    const { summary, slot } = useAsUser('1499624326_Ugly_TH000_Hammerfall', '2');
    const ranked = await matcher.rankCandidates(summary, slot, { limit: 8 });
    console.log('\n[Test 1] HU all-footman user — top 8 candidates:');
    ranked.forEach((c, i) => {
      const sig = c.composition ? `${c.composition.userSignatureName || '-'} vs ${c.composition.proSignatureName || '-'}` : 'no comp';
      console.log(`  ${i+1}. score=${c.score} grades=${c.grades} divergent=${c.divergent} | ${sig} | ${c.entry.playerName} (${c.entry.replayId})`);
    });
    const top = ranked[0];
    if (!top.grades) failures.push('Test 1: top candidate should grade');
    if (top.divergent) failures.push('Test 1: top candidate should NOT be build-divergent');
    // Tier 1 (graded+sameBuild) candidates should all come before any divergent
    const firstDivergentIdx = ranked.findIndex(c => c.divergent);
    if (firstDivergentIdx !== -1) {
      const beforeDivergent = ranked.slice(0, firstDivergentIdx);
      const allGood = beforeDivergent.every(c => c.grades && !c.divergent);
      if (!allGood) failures.push('Test 1: divergent candidate appeared before a graded-non-divergent one');
    }
  }

  // ── Test 2: autoPick should NOT pick a divergent candidate even at high metadata score
  // Synthesize a "user" who'd score high on metadata vs a divergent pro by reusing
  // a HU footman summary; if the manifest has a HU footman pro on the same map,
  // autoPick should prefer that. If not, autoPick should fall through to null.
  {
    const { summary, slot } = useAsUser('2576049378_Fortitude_Sok_Hammerfall', '1');
    const auto = await matcher.autoPick(summary, slot);
    console.log(`\n[Test 2] autoPick for HU footman user: ${auto ? auto.playerName + ' (' + auto.replayId + ')' : 'null'}`);
    if (auto) {
      // Find this entry in candidates to verify it's not divergent
      const ranked = await matcher.rankCandidates(summary, slot, { limit: 8 });
      const picked = ranked.find(c => c.entry.replayId === auto.replayId && String(c.entry.playerSlot) === String(auto.playerSlot));
      if (!picked) failures.push('Test 2: autoPick returned an entry not in ranked candidates');
      else if (picked.divergent) failures.push(`Test 2: autoPick chose a divergent candidate (signature ${picked.composition && picked.composition.proSignatureName})`);
      else if (!picked.grades) failures.push('Test 2: autoPick chose an ungraded candidate');
      else if (picked.score < 85) failures.push(`Test 2: autoPick chose a sub-85 metadata candidate (score=${picked.score})`);
    }
    // null is acceptable — means no candidate cleared all 3 bars
  }

  if (failures.length === 0) {
    console.log(`\n${failures.length === 0 ? 'OK' : 'FAIL'}: matcher ranking smoke test`);
    process.exit(0);
  } else {
    console.log('\nFAILURES:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
};

main().catch(e => {
  console.error('ERROR:', e.message);
  console.error(e.stack);
  process.exit(2);
});
