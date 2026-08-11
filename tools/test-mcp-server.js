/**
 * test-mcp-server.js — the MCP server's protocol layer and tool descriptors,
 * run in plain Node against the real local data files.
 *
 * The tools are transport-agnostic descriptors and the transport is a pure
 * function of the request body, so both are testable without a Workers runtime.
 * fetch() is stubbed to read client/data off disk, which means these tests
 * exercise the REAL corpus — a tool that mis-reads the actual data shape fails
 * here rather than in an MCP client.
 *
 * Usage: node tools/test-mcp-server.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');

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

// ── serve client/ over a stubbed fetch ──────────────────────────────────────
let fetchCount = 0;
global.fetch = async (url) => {
  fetchCount++;
  const u = new URL(String(url));
  const file = path.join(CLIENT, decodeURIComponent(u.pathname));
  if (!fs.existsSync(file)) {
    return { ok: false, status: 404, async json () { throw new Error('404'); } };
  }
  const body = fs.readFileSync(file, 'utf8');
  return { ok: true, status: 200, async json () { return JSON.parse(body); } };
};

// ── load the ES modules ─────────────────────────────────────────────────────
// Both worker files are ESM and this repo is CommonJS. Strip the module syntax
// and evaluate, the same trick test-edge-worker.js uses.
function loadModule (rel, extraGlobals = {}) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const body = src
    .replace(/^import[^;]*;$/gm, '')
    .replace(/^export default\s*/m, 'const __default = ')
    .replace(/^export \{[^}]*\};$/gm, '')
    .replace(/^export /gm, '');
  const names = Object.keys(extraGlobals);
  const fn = new Function(...names,
    body + '\n;return { TOOLS: typeof TOOLS!=="undefined"?TOOLS:undefined,' +
    ' SERVER_CARD: typeof SERVER_CARD!=="undefined"?SERVER_CARD:undefined,' +
    ' handler: typeof __default!=="undefined"?__default:undefined,' +
    ' handleRpc: typeof handleRpc!=="undefined"?handleRpc:undefined,' +
    ' validateArgs: typeof validateArgs!=="undefined"?validateArgs:undefined };');
  return fn(...names.map(n => extraGlobals[n]));
}

const toolsMod = loadModule('workers/mcp/src/tools.js');
const { TOOLS, SERVER_CARD } = toolsMod;

// index.js imports from ./tools.js; supply those as globals since the import
// line is stripped.
const serverMod = loadModule('workers/mcp/src/index.js', { TOOLS, SERVER_CARD });
const { handleRpc, validateArgs } = serverMod;

// ── tool descriptors ────────────────────────────────────────────────────────
ok('tools loaded', Array.isArray(TOOLS) && TOOLS.length >= 7, TOOLS && TOOLS.length);
for (const t of TOOLS) {
  ok(t.name + ': description', typeof t.description === 'string' && t.description.length > 20);
  ok(t.name + ': schema', t.inputSchema && t.inputSchema.type === 'object');
  ok(t.name + ': readOnlyHint', t.annotations && t.annotations.readOnlyHint === true);
  ok(t.name + ': run is async fn', typeof t.run === 'function');
  for (const r of t.inputSchema.required || []) {
    ok(t.name + ': required "' + r + '" declared', !!t.inputSchema.properties[r]);
  }
}

// ── server card must satisfy the MCP schema constraints ─────────────────────
check('card $schema', SERVER_CARD.$schema,
  'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json');
ok('card name is reverse-DNS with exactly one slash',
  /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(SERVER_CARD.name), SERVER_CARD.name);
ok('card description within 1-100 chars',
  SERVER_CARD.description.length >= 1 && SERVER_CARD.description.length <= 100,
  SERVER_CARD.description.length);
ok('card has no serverInfo (removed from the spec)', SERVER_CARD.serverInfo === undefined);
ok('card has no capabilities (removed from the spec)', SERVER_CARD.capabilities === undefined);
ok('card remote is streamable-http', SERVER_CARD.remotes[0].type === 'streamable-http');

(async () => {
  const rpc = (method, params, id = 1) => handleRpc({ jsonrpc: '2.0', id, method, params });

  // ── protocol ──────────────────────────────────────────────────────────────
  let r = await rpc('initialize', {});
  check('initialize protocolVersion', r.result.protocolVersion, '2025-06-18');
  ok('initialize advertises tools', !!r.result.capabilities.tools);
  ok('initialize has instructions', typeof r.result.instructions === 'string');

  check('notifications/initialized returns nothing',
    await rpc('notifications/initialized', {}), null);
  check('unknown notification returns nothing',
    await rpc('notifications/somethingNew', {}), null);

  r = await rpc('ping', {});
  ok('ping ok', r.result && Object.keys(r.result).length === 0);

  r = await rpc('tools/list', {});
  check('tools/list count', r.result.tools.length, TOOLS.length);
  ok('descriptors carry no run()', r.result.tools.every(t => t.run === undefined));

  r = await rpc('nope/nope', {});
  check('unknown method -> -32601', r.error.code, -32601);

  r = await rpc('tools/call', { name: 'does_not_exist', arguments: {} });
  check('unknown tool -> -32602', r.error.code, -32602);
  ok('unknown tool lists alternatives', Array.isArray(r.error.data.available));

  // ── argument validation surfaces as a tool error, not a protocol error ────
  r = await rpc('tools/call', { name: 'get_build', arguments: {} });
  check('missing required -> isError', r.result.isError, true);
  ok('missing required names the arg', r.result.content[0].text.includes('buildId'));

  r = await rpc('tools/call', { name: 'search_builds', arguments: { race: 'X' } });
  check('bad enum -> isError', r.result.isError, true);

  r = await rpc('tools/call', { name: 'search_builds', arguments: { nope: 1 } });
  check('unknown arg -> isError', r.result.isError, true);
  ok('unknown arg lists accepted', r.result.content[0].text.includes('Accepted:'));

  // ── real data ─────────────────────────────────────────────────────────────
  r = await rpc('tools/call', { name: 'search_builds', arguments: { race: 'E' } });
  ok('search_builds returns text', typeof r.result.content[0].text === 'string');
  ok('search_builds structured', r.result.structuredContent.count > 0);
  ok('search_builds race filter holds',
    r.result.structuredContent.builds.every(b => b.race === 'E'));

  r = await rpc('tools/call', { name: 'search_builds', arguments: { matchup: 'EvU' } });
  ok('matchup filter works', r.result.structuredContent.count > 0);

  r = await rpc('tools/call', { name: 'search_builds', arguments: { query: 'zzzznope' } });
  check('no matches is not an error', r.result.isError, undefined);
  ok('no matches explains the library size', r.result.content[0].text.includes('curated'));

  const firstId = (await rpc('tools/call', { name: 'search_builds', arguments: { limit: 1 } }))
    .result.structuredContent.builds[0].id;
  r = await rpc('tools/call', { name: 'get_build', arguments: { buildId: firstId } });
  ok('get_build found', r.result.structuredContent.found === true);
  ok('get_build includes the page url', r.result.content[0].text.includes('wc3v.com/builds/' + firstId));

  r = await rpc('tools/call', { name: 'get_build', arguments: { buildId: 'nope' } });
  ok('unknown build lists valid ids', Array.isArray(r.result.structuredContent.validIds));

  r = await rpc('tools/call', { name: 'search_replays', arguments: { limit: 3 } });
  ok('search_replays works', r.result.structuredContent.count === 3);
  ok('search_replays reports corpus size', r.result.structuredContent.corpusSize > 100);

  const rid = r.result.structuredContent.replays[0].replayId;
  const slot = r.result.structuredContent.replays[0].players[0].slot;

  r = await rpc('tools/call', { name: 'get_replay_summary', arguments: { replayId: rid } });
  ok('get_replay_summary works', !!r.result.structuredContent.players);
  ok('summary warns about tier timings', r.result.content[0].text.includes('inferred'));

  r = await rpc('tools/call', { name: 'get_replay_summary', arguments: { replayId: 'no-such-replay' } });
  ok('missing replay is handled', r.result.structuredContent.found === false);

  r = await rpc('tools/call', { name: 'get_build_order_timeline', arguments: { replayId: rid, playerSlot: slot } });
  ok('timeline works', Array.isArray(r.result.structuredContent.steps));
  ok('timeline notes order is what is reliable', r.result.content[0].text.includes('ORDER'));

  r = await rpc('tools/call', { name: 'get_build_order_timeline', arguments: { replayId: rid, playerSlot: '99' } });
  ok('bad slot lists real slots', Array.isArray(r.result.structuredContent.slots));

  r = await rpc('tools/call', { name: 'lookup_term', arguments: { term: 'T2' } });
  ok('lookup_term matches an alias, not just the canonical name',
    r.result.structuredContent.found === true, r.result.content[0].text.slice(0, 80));

  r = await rpc('tools/call', { name: 'list_tournaments', arguments: {} });
  ok('list_tournaments works', r.result.structuredContent.count > 0);

  // ── memoisation: repeated calls must not refetch ──────────────────────────
  const before = fetchCount;
  await rpc('tools/call', { name: 'search_builds', arguments: {} });
  await rpc('tools/call', { name: 'search_builds', arguments: {} });
  check('repeat calls are memoised', fetchCount, before);

  console.log('mcp-server: ' + pass + ' passed, ' + failures.length + ' failed');
  for (const f of failures) {
    console.log('\n  FAIL ' + f.name);
    console.log('    expected: ' + JSON.stringify(f.expected));
    console.log('    actual:   ' + JSON.stringify(f.actual));
  }
  process.exit(failures.length ? 1 : 0);
})();
