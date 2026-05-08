// Fixture-based regression harness for ReplayAnalyzer.
//
// Loads client/js/ReplayAnalyzer.js into a vm sandbox, reads pro summaries
// directly from client/data/summaries/*.json, then runs each fixture in
// tests/analyzer-fixtures.json and asserts the report against the named
// expectations.
//
// The point: catch silent regressions in scoring. Today, fixture #3
// ("HU footman vs HU rifleman") is expected to FAIL on a clean checkout
// because the analyzer is build-composition-blind — the failure documents
// the bug objectively. After Phase 2-3 lands (composition signal + soft
// cap), it should pass.
//
// Run with:  node tools/test-analyzer-fixtures.js
// Optional:  --skip-phase2  → skip fixtures marked requiresPhase2=true
//                              so green CI is achievable before fixes land

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT       = path.resolve(__dirname, '..');
const SUMMARIES  = path.join(ROOT, 'client', 'data', 'summaries');
const FIXTURES   = path.join(ROOT, 'tests', 'analyzer-fixtures.json');
const ANALYZER   = path.join(ROOT, 'client', 'js', 'ReplayAnalyzer.js');

const args = new Set(process.argv.slice(2));
const skipPhase2 = args.has('--skip-phase2');

// Minimal sandbox to run the analyzer. The analyzer attaches itself to
// `window.ReplayAnalyzer` via the IIFE wrapper at the bottom of the file.
const sandbox = { console, setTimeout, clearTimeout, window: {}, globalThis: null };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ANALYZER, 'utf8'), sandbox);

const ReplayAnalyzer = sandbox.window.ReplayAnalyzer;
if (!ReplayAnalyzer || typeof ReplayAnalyzer.compare !== 'function') {
  console.error('FATAL: ReplayAnalyzer did not load — check the IIFE/window wiring in ReplayAnalyzer.js');
  process.exit(2);
}

const loadSummary = (id) => {
  const p = path.join(SUMMARIES, `${id}.json`);
  if (!fs.existsSync(p)) throw new Error(`summary not found: ${id}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

// Self-comparisons need two distinct objects so the analyzer's mutations
// (if any) don't entangle. Cheap deep clone via JSON since summaries are
// pure JSON.
const cloneSummary = (s) => JSON.parse(JSON.stringify(s));

const checkExpectations = (report, expect) => {
  const errs = [];

  if (typeof expect.overallMin === 'number' && report.overall.score < expect.overallMin) {
    errs.push(`overall ${report.overall.score} < expected min ${expect.overallMin}`);
  }
  if (typeof expect.overallMax === 'number' && report.overall.score > expect.overallMax) {
    errs.push(`overall ${report.overall.score} > expected max ${expect.overallMax}`);
  }
  if (expect.guards) {
    for (const [k, v] of Object.entries(expect.guards)) {
      if (report.guards[k] !== v) errs.push(`guards.${k} = ${report.guards[k]}, expected ${v}`);
    }
  }
  if (typeof expect.compositionDivergent === 'boolean') {
    const actual = !!(report.guards && report.guards.compositionDivergent);
    if (actual !== expect.compositionDivergent) {
      errs.push(`compositionDivergent = ${actual}, expected ${expect.compositionDivergent}`);
    }
  }
  if (expect.categoriesAllUnavailable) {
    for (const [k, v] of Object.entries(report.categories)) {
      if (v.available) errs.push(`categories.${k}.available = true, expected all categories unavailable`);
    }
  }
  if (expect.warningsContain) {
    for (const w of expect.warningsContain) {
      const hit = (report.warnings || []).some(x => String(x).toLowerCase().includes(String(w).toLowerCase()));
      if (!hit) errs.push(`expected warning containing "${w}", got: [${(report.warnings || []).join(' | ')}]`);
    }
  }
  return errs;
};

const summarizeReport = (r) => {
  const cats = Object.entries(r.categories)
    .map(([k, v]) => v.available ? `${k}=${v.score}` : `${k}=N/A`)
    .join(' ');
  return `overall=${r.overall.score} (${r.overall.grade}) | ${cats}`;
};

const main = () => {
  const json = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
  const fixtures = json.fixtures || [];

  let passed = 0, failed = 0, skipped = 0;
  const failures = [];

  for (const fx of fixtures) {
    if (skipPhase2 && fx.requiresPhase2) {
      console.log(`SKIP: ${fx.name} (requiresPhase2)`);
      skipped++;
      continue;
    }

    let report;
    try {
      const userSummary = (fx.user.replayId === fx.pro.replayId)
        ? cloneSummary(loadSummary(fx.user.replayId))
        : loadSummary(fx.user.replayId);
      const proSummary = loadSummary(fx.pro.replayId);
      report = ReplayAnalyzer.compare({
        userSummary, userSlot: fx.user.slot,
        proSummary, proSlot: fx.pro.slot,
        proResult: fx.proResult || 'unknown'
      });
    } catch (e) {
      console.log(`ERROR: ${fx.name}: ${e.message}`);
      failed++;
      failures.push({ name: fx.name, errs: [e.message] });
      continue;
    }

    const errs = checkExpectations(report, fx.expect || {});
    if (errs.length === 0) {
      console.log(`PASS: ${fx.name}`);
      console.log(`      ${summarizeReport(report)}`);
      passed++;
    } else {
      console.log(`FAIL: ${fx.name}`);
      console.log(`      ${summarizeReport(report)}`);
      errs.forEach(e => console.log(`      - ${e}`));
      failed++;
      failures.push({ name: fx.name, errs });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (of ${fixtures.length})`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach(f => {
      console.log(`  ${f.name}`);
      f.errs.forEach(e => console.log(`    - ${e}`));
    });
    process.exit(1);
  }
};

main();
