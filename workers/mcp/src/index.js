/**
 * mcp.wc3v.com — a read-only MCP server over the wc3v replay corpus.
 *
 * Stateless Streamable HTTP, hand-rolled, no dependencies. The MCP spec permits
 * a stateless server, and for a read-only tool server with no subscriptions,
 * sampling or elicitation there is nothing for a session to hold. The
 * alternative (Cloudflare's McpAgent) is Durable-Object-backed, which means a
 * storage binding and session eviction behaviour to reason about, in exchange
 * for features this server does not use.
 *
 * Separate Worker and separate wrangler project from workers/edge on purpose: a
 * bug here must not be able to take down wc3v.com.
 *
 * No auth. Public, read-only, no user data — which is exactly why there is no
 * /.well-known/oauth-protected-resource: a 404 there is the accurate answer for
 * an unauthenticated resource, and publishing an empty one would be a lie.
 *
 * Deploy: npm run worker:mcp
 */

import { TOOLS, SERVER_CARD } from './tools.js';

const PROTOCOL_VERSION = '2025-06-18';
const JSONRPC = '2.0';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, HEAD, OPTIONS',
  'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'ETag, Content-Type'
};

function json (body, init = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status: init.status || 200,
    headers: Object.assign({ 'content-type': 'application/json' }, CORS, init.headers || {})
  });
}

function rpcResult (id, result) { return { jsonrpc: JSONRPC, id, result }; }
function rpcError (id, code, message, data) {
  const e = { jsonrpc: JSONRPC, id: id === undefined ? null : id, error: { code, message } };
  if (data !== undefined) e.error.data = data;
  return e;
}

// JSON-RPC 2.0 reserved codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

/** The public shape of a tool, minus its implementation. */
function toolDescriptor (t) {
  const d = {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema
  };
  if (t.title) d.title = t.title;
  if (t.annotations) d.annotations = t.annotations;
  return d;
}

/** Reject unknown args rather than silently ignoring a typo'd filter. */
function validateArgs (tool, args) {
  const schema = tool.inputSchema || {};
  const props = schema.properties || {};
  for (const r of schema.required || []) {
    if (args[r] === undefined || args[r] === null || args[r] === '') {
      return 'missing required argument "' + r + '"';
    }
  }
  if (schema.additionalProperties === false) {
    const unknown = Object.keys(args).filter(k => !(k in props));
    if (unknown.length) {
      return 'unknown argument(s): ' + unknown.join(', ') +
        '. Accepted: ' + Object.keys(props).join(', ');
    }
  }
  for (const [k, v] of Object.entries(args)) {
    const p = props[k];
    if (!p || v === undefined) continue;
    if (p.enum && !p.enum.includes(v)) {
      return 'argument "' + k + '" must be one of: ' + p.enum.join(', ');
    }
    if (p.type === 'integer' && !Number.isInteger(v)) {
      return 'argument "' + k + '" must be an integer';
    }
    if (p.type === 'string' && typeof v !== 'string') {
      return 'argument "' + k + '" must be a string';
    }
  }
  return null;
}

async function handleRpc (msg) {
  const { id, method, params } = msg || {};

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'wc3v', title: 'WC3V', version: SERVER_CARD.version },
        instructions:
          'Warcraft III data from wc3v.com: ' + TOOLS.length + ' read-only tools over a ' +
          'curated build library and a corpus of parsed pro tournament replays. ' +
          'Start with search_builds or search_replays. Note that tier2/tier3 timings ' +
          'in replay data are inferred and are not reliable tech benchmarks.'
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;                       // notifications take no response

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, { tools: TOOLS.map(toolDescriptor) });

    case 'tools/call': {
      const name = params && params.name;
      const tool = TOOLS.find(t => t.name === name);
      if (!tool) {
        return rpcError(id, INVALID_PARAMS, 'Unknown tool: ' + name,
          { available: TOOLS.map(t => t.name) });
      }
      const args = (params && params.arguments) || {};
      const bad = validateArgs(tool, args);
      if (bad) {
        // Argument problems come back as an MCP tool error (isError) rather than
        // a protocol error, so the model can read the message and retry.
        return rpcResult(id, { isError: true, content: [{ type: 'text', text: bad }] });
      }
      try {
        const out = await tool.run(args);
        const res = { content: [{ type: 'text', text: out.text }] };
        if (out.structured !== undefined) res.structuredContent = out.structured;
        return rpcResult(id, res);
      } catch (err) {
        return rpcResult(id, {
          isError: true,
          content: [{ type: 'text', text: 'Tool "' + name + '" failed: ' + (err && err.message) }]
        });
      }
    }

    default:
      if (typeof method === 'string' && method.startsWith('notifications/')) return null;
      return rpcError(id, METHOD_NOT_FOUND, 'Method not found: ' + method);
  }
}

export default {
  async fetch (request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Server card. Served at the spec-recommended <streamable-http-url>/server-card
    // and at the .well-known path Cloudflare's readiness scanner checks.
    if (url.pathname === '/mcp/server-card' ||
        url.pathname === '/.well-known/mcp/server-card.json') {
      const body = JSON.stringify(SERVER_CARD, null, 2);
      const etag = '"' + SERVER_CARD.version + '-' + body.length + '"';
      if (request.headers.get('if-none-match') === etag) {
        return new Response(null, { status: 304, headers: Object.assign({ etag }, CORS) });
      }
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: Object.assign({
          'content-type': 'application/mcp-server-card+json',
          'cache-control': 'public, max-age=3600',
          etag
        }, CORS)
      });
    }

    if (url.pathname === '/.well-known/ai-catalog.json') {
      return json({
        specVersion: '1.0',
        entries: [{
          identifier: 'urn:air:wc3v.com:mcp:wc3v',
          type: 'application/mcp-server-card+json',
          url: 'https://mcp.wc3v.com/mcp/server-card'
        }]
      }, { headers: { 'content-type': 'application/ai-catalog+json' } });
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return json({
        name: 'wc3v-mcp',
        endpoint: 'https://mcp.wc3v.com/mcp',
        transport: 'streamable-http',
        protocolVersion: PROTOCOL_VERSION,
        tools: TOOLS.map(t => t.name),
        serverCard: 'https://mcp.wc3v.com/mcp/server-card',
        docs: 'https://wc3v.com/api'
      });
    }

    if (url.pathname !== '/mcp') {
      return json({ error: 'Not found. The MCP endpoint is POST /mcp.' }, { status: 404 });
    }

    // A GET on /mcp would open an SSE stream in a stateful server. This one is
    // stateless and has nothing to push, so say so rather than hanging.
    if (request.method === 'GET') {
      return json({
        error: 'This server is stateless; there is no SSE stream. Use POST /mcp with a JSON-RPC body.'
      }, { status: 405, headers: { allow: 'POST, OPTIONS' } });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, { status: 405, headers: { allow: 'POST, OPTIONS' } });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json(rpcError(null, PARSE_ERROR, 'Invalid JSON'), { status: 400 });
    }

    // A batch is a JSON array; responses to notifications are omitted, and an
    // all-notification batch gets 202 with no body.
    if (Array.isArray(body)) {
      if (!body.length) return json(rpcError(null, INVALID_REQUEST, 'Empty batch'), { status: 400 });
      const results = (await Promise.all(body.map(handleRpc))).filter(Boolean);
      if (!results.length) return new Response(null, { status: 202, headers: CORS });
      return json(results);
    }

    if (!body || body.jsonrpc !== JSONRPC || typeof body.method !== 'string') {
      return json(rpcError(body && body.id, INVALID_REQUEST,
        'Expected a JSON-RPC 2.0 request with a string "method"'), { status: 400 });
    }

    let res;
    try {
      res = await handleRpc(body);
    } catch (err) {
      return json(rpcError(body.id, INTERNAL_ERROR, String(err && err.message)), { status: 500 });
    }
    if (res === null) return new Response(null, { status: 202, headers: CORS });
    return json(res);
  }
};
