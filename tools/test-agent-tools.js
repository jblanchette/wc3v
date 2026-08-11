/**
 * test-agent-tools.js — client/js/HomepageAgentTools.js against a mock
 * document.modelContext and a mock WC3VHome facade.
 *
 * WebMCP needs a browser with document.modelContext, so without this the tools
 * would ship having never been executed once. The mock is small because the
 * subsystem owns no state: it is an adapter over the facade, which is exactly
 * what makes it testable in plain Node.
 *
 * Usage: node tools/test-agent-tools.js
 */

const fs = require('fs');
const path = require('path');

let pass = 0;
const failures = [];
function check (name, actual, expected) {
  if (actual === expected) { pass++; return; }
  failures.push({ name, expected, actual });
}
function ok (name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push({ name, expected: 'truthy', actual: detail === undefined ? cond : detail });
}

// ── mock browser globals, then load the subsystem ───────────────────────────
const registered = [];
const doc = {
  modelContext: {
    registerTool (tool) {
      if (!tool || typeof tool.name !== 'string') throw new Error('tool needs a name');
      if (typeof tool.execute !== 'function') throw new Error('tool needs execute');
      registered.push(tool);
    }
  }
};
const win = { console };

const src = fs.readFileSync(
  path.join(__dirname, '..', 'client', 'js', 'HomepageAgentTools.js'), 'utf8');
new Function('window', 'document', src)(win, doc);

ok('subsystem attaches to window', !!win.HomepageAgentTools);

// ── mock facade ─────────────────────────────────────────────────────────────
const BUILDS = [
  { id: 'ne-dh-fast-bear', name: 'DH Standard', race: 'E', matchups: ['EvU', 'EvO'],
    level: 'improving', difficulty: 'medium', heroOpener: 'Demon Hunter',
    description: 'Fast tech to bears.', strategyPoints: ['DH first'],
    commonMistakes: [{ mistake: 'Late T2', fix: 'Click it on time' }], replays: [{}, {}] },
  { id: 'ud-dk-destroyer', name: 'DK Destroyer', race: 'U', matchups: ['UvH'],
    level: 'pro', description: 'Fast T3.', replays: [] }
];

let lastFilters = null;
let navigatedTo = null;
const home = {
  setFilters (f) { lastFilters = f; return f.race ? BUILDS.filter(b => b.race === f.race) : BUILDS.slice(); },
  getVisible () { return BUILDS.slice(); },
  getAllBuilds () { return BUILDS.slice(); },
  getBuild (id) { return BUILDS.find(b => b.id === id) || null; },
  openBuild (id) { navigatedTo = id; },
  listMyReplays: async () => ([
    { id: 'abc1234567', map: 'Turtle Rock', durationFormatted: '15:33',
      players: [{ name: 'Jeff', race: 'H' }, { name: 'Opp', race: 'O' }] }
  ])
};

// ── install ─────────────────────────────────────────────────────────────────
check('install returns true', win.HomepageAgentTools.install(home), true);
check('registers 4 tools', registered.length, 4);
check('install is idempotent',
  (win.HomepageAgentTools.install(home), registered.length), 4);

const byName = Object.fromEntries(registered.map(t => [t.name, t]));
for (const n of ['filter_builds', 'get_build_details', 'list_my_replays', 'open_build']) {
  ok('registered ' + n, !!byName[n]);
}

// ── every tool must be well-formed for a WebMCP client ──────────────────────
for (const t of registered) {
  ok(t.name + ': has description', typeof t.description === 'string' && t.description.length > 20);
  ok(t.name + ': inputSchema is an object schema',
    t.inputSchema && t.inputSchema.type === 'object' && !!t.inputSchema.properties);
  ok(t.name + ': has annotations', !!t.annotations);
  ok(t.name + ': name is valid', /^[a-zA-Z0-9_.-]{1,128}$/.test(t.name));
  // Required params must actually exist in properties.
  for (const r of t.inputSchema.required || []) {
    ok(t.name + ': required "' + r + '" is declared', !!t.inputSchema.properties[r]);
  }
}

// Read-only annotation must match reality: only open_build navigates.
check('filter_builds is read-only', byName.filter_builds.annotations.readOnlyHint, true);
check('get_build_details is read-only', byName.get_build_details.annotations.readOnlyHint, true);
check('list_my_replays is read-only', byName.list_my_replays.annotations.readOnlyHint, true);
check('open_build is NOT read-only', byName.open_build.annotations.readOnlyHint, false);

// ── execute them ────────────────────────────────────────────────────────────
function textOf (res) {
  ok('result has content array', Array.isArray(res && res.content));
  return res.content.map(c => c.text).join('\n');
}

(async () => {
  let out = textOf(await byName.filter_builds.execute({ race: 'E' }));
  ok('filter_builds passed the filter through', lastFilters && lastFilters.race === 'E');
  ok('filter_builds names the match', out.includes('DH Standard'));
  ok('filter_builds excludes the other race', !out.includes('DK Destroyer'));

  out = textOf(await byName.filter_builds.execute({}));
  ok('filter_builds with no args returns all', out.includes('DK Destroyer'));

  out = textOf(await byName.get_build_details.execute({ buildId: 'ne-dh-fast-bear' }));
  ok('details include the strategy', out.includes('DH first'));
  ok('details include common mistakes', out.includes('Late T2') && out.includes('Click it on time'));
  ok('details link the page', out.includes('https://wc3v.com/builds/ne-dh-fast-bear'));

  out = textOf(await byName.get_build_details.execute({ buildId: 'nope' }));
  ok('unknown id lists the valid ids', out.includes('ne-dh-fast-bear') && out.includes('No build'));

  out = textOf(await byName.list_my_replays.execute({}));
  ok('local replays are listed', out.includes('abc1234567') && out.includes('Turtle Rock'));
  ok('local replays link the viewer', out.includes('viewer?local='));

  // Empty library must explain how to add one rather than just saying "none".
  const emptyHome = Object.assign({}, home, { listMyReplays: async () => [] });
  registered.length = 0;
  win.HomepageAgentTools.registered = false;
  win.HomepageAgentTools.install(emptyHome);
  const empty = Object.fromEntries(registered.map(t => [t.name, t]));
  out = textOf(await empty.list_my_replays.execute({}));
  ok('empty library is explained', out.includes('.w3g'));

  // A throwing facade must be reported, not crash the tool.
  const brokenHome = Object.assign({}, home, {
    listMyReplays: async () => { throw new Error('IndexedDB blocked'); }
  });
  registered.length = 0;
  win.HomepageAgentTools.registered = false;
  win.HomepageAgentTools.install(brokenHome);
  const broken = Object.fromEntries(registered.map(t => [t.name, t]));
  out = textOf(await broken.list_my_replays.execute({}));
  ok('facade errors surface as text', out.includes('IndexedDB blocked'));

  out = textOf(await broken.open_build.execute({ buildId: 'ud-dk-destroyer' }));
  check('open_build navigates', navigatedTo, 'ud-dk-destroyer');

  // ── no modelContext: must be a silent no-op, never a page error ───────────
  const registered2 = [];
  const win2 = { console };
  new Function('window', 'document', src)(win2, {});
  check('no modelContext -> install returns false', win2.HomepageAgentTools.install(home), false);
  check('no modelContext -> nothing registered', registered2.length, 0);
  check('no facade -> install returns false', win.HomepageAgentTools.install(null), false);

  console.log('agent-tools: ' + pass + ' passed, ' + failures.length + ' failed');
  for (const f of failures) {
    console.log('\n  FAIL ' + f.name);
    console.log('    expected: ' + JSON.stringify(f.expected));
    console.log('    actual:   ' + JSON.stringify(f.actual));
  }
  process.exit(failures.length ? 1 : 0);
})();
