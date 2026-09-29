#!/usr/bin/env node
'use strict';

/**
 * Read-only n8n MCP (stdio JSON-RPC).
 * Lists exported workflows in this repo. Optionally pings a live n8n
 * instance via N8N_BASE_URL + N8N_API_KEY. Never executes workflows.
 * Never prints tokens.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
process.chdir(repoRoot);

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'n8n-api', version: '1.0.0' };

function loadDotenv() {
  const abs = path.join(repoRoot, '.env');
  if (!fs.existsSync(abs)) return;
  const text = fs.readFileSync(abs, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key]) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadDotenv();

function n8nBase() {
  return String(process.env.N8N_BASE_URL || process.env.N8N_URL || '').trim().replace(/\/+$/, '');
}

function n8nKey() {
  return String(process.env.N8N_API_KEY || process.env.N8N_MCP_TOKEN || '').trim();
}

function textResult(obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function listExported() {
  const dir = path.join(repoRoot, 'new workflows');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const rel = path.join('new workflows', f);
      let name = f;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (j && typeof j.name === 'string') name = j.name;
      } catch (_) { /* ignore */ }
      return { file: rel, name };
    });
}

const TOOLS = [
  {
    name: 'n8n_status',
    description: 'Show n8n MCP config: whether N8N_BASE_URL / N8N_API_KEY are set (not the values), plus exported workflow files in this repo. No network.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'n8n_ping',
    description: 'Live ping of n8n: GET /healthz and optionally GET /api/v1/workflows?limit=1 with X-N8N-API-KEY. Does not execute workflows.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'n8n_list_exported_workflows',
    description: 'List n8n workflow JSON exports under new workflows/ (read-only). Does not call the n8n instance.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'n8n_list_live_workflows',
    description: 'GET /api/v1/workflows from the live n8n instance (names/ids/active only). Requires N8N_BASE_URL and N8N_API_KEY. Does not execute.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function statusPayload() {
  const base = n8nBase();
  return {
    server: SERVER_INFO.name,
    mode: 'read-only',
    executesWorkflows: false,
    baseUrlConfigured: base.length > 0,
    apiKeyConfigured: n8nKey().length > 0,
    envKeys: ['N8N_BASE_URL', 'N8N_URL', 'N8N_API_KEY', 'N8N_MCP_TOKEN'],
    exportedWorkflowCount: listExported().length,
    howToConnect:
      'In n8n: Settings → n8n API → Create API key. Add to .env: N8N_BASE_URL=https://YOUR-N8N-HOST and N8N_API_KEY=... Do not put them in mcp.json. Reload Cursor MCP. Instance MCP is Settings → Instance-level MCP (separate from this REST client).',
    note: 'This repo does not record the production n8n URL. Workflow JSON uses path "telecrm" only.',
  };
}

async function pingLive() {
  const base = n8nBase();
  const key = n8nKey();
  if (!base) {
    return errorResult(
      'N8N_BASE_URL is not set. Add it to .env (example https://your-instance.app.n8n.cloud) plus N8N_API_KEY from n8n Settings → n8n API. Do not paste secrets in chat.',
    );
  }
  const out = { baseHost: (() => { try { return new URL(base).host; } catch (_) { return '[invalid-url]'; } })() };

  const health = await fetch(base + '/healthz').catch((e) => ({ ok: false, status: 0, _err: e.message }));
  if (health._err) {
    out.healthz = { ok: false, error: health._err };
  } else {
    out.healthz = { ok: health.ok, http: health.status };
  }

  if (key) {
    const resp = await fetch(base + '/api/v1/workflows?limit=1', {
      headers: { 'X-N8N-API-KEY': key, Accept: 'application/json' },
    }).catch((e) => ({ ok: false, status: 0, _err: e.message }));
    if (resp._err) {
      out.api = { ok: false, error: resp._err };
    } else {
      out.api = { ok: resp.ok, http: resp.status };
    }
  } else {
    out.api = { ok: false, hint: 'N8N_API_KEY missing — healthz may still work.' };
  }

  out.connected = !!(out.healthz && out.healthz.ok) || !!(out.api && out.api.ok);
  return textResult(out);
}

async function listLive() {
  const base = n8nBase();
  const key = n8nKey();
  if (!base || !key) {
    return errorResult('Need N8N_BASE_URL and N8N_API_KEY in .env to list live workflows.');
  }
  const resp = await fetch(base + '/api/v1/workflows?limit=50', {
    headers: { 'X-N8N-API-KEY': key, Accept: 'application/json' },
  });
  if (!resp.ok) {
    return errorResult(`n8n workflows HTTP ${resp.status}. Check API key and that the n8n API is enabled.`);
  }
  const json = await resp.json();
  const items = json.data || json;
  const list = Array.isArray(items)
    ? items.map((w) => ({ id: w.id, name: w.name, active: w.active }))
    : [];
  return textResult({ count: list.length, workflows: list });
}

async function handleTool(name) {
  if (name === 'n8n_status') return textResult(statusPayload());
  if (name === 'n8n_ping') return pingLive();
  if (name === 'n8n_list_exported_workflows') return textResult({ workflows: listExported() });
  if (name === 'n8n_list_live_workflows') return listLive();
  return errorResult(`Unknown tool: ${name}`);
}

function send(msg) {
  // Cursor's MCP SDK speaks NDJSON (one JSON object + newline), not Content-Length.
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function dispatch(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  try {
    if (method === 'initialize') {
      reply(id, { protocolVersion: PROTOCOL_VERSION, serverInfo: SERVER_INFO, capabilities: { tools: {} } });
      return;
    }
    if (method === 'notifications/initialized' || method === 'initialized') return;
    if (method === 'ping') {
      if (!isNotification) reply(id, {});
      return;
    }
    if (method === 'tools/list') {
      reply(id, { tools: TOOLS });
      return;
    }
    if (method === 'tools/call') {
      reply(id, await handleTool(params && params.name, (params && params.arguments) || {}));
      return;
    }
    if (isNotification) return;
    replyError(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    if (isNotification) {
      process.stderr.write(`n8n-api MCP error: ${e.message}\n`);
      return;
    }
    replyError(id, -32000, e.message);
  }
}

function extractMessages(buffer) {
  const messages = [];
  let rest = buffer;
  while (rest.length) {
    const headerEnd = rest.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const header = rest.slice(0, headerEnd).toString('utf8');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (match) {
        const len = Number(match[1]);
        const start = headerEnd + 4;
        if (rest.length < start + len) break;
        const body = rest.slice(start, start + len).toString('utf8');
        rest = rest.slice(start + len);
        messages.push(JSON.parse(body));
        continue;
      }
    }
    const nl = rest.indexOf('\n');
    if (nl === -1) break;
    const line = rest.slice(0, nl).toString('utf8').replace(/\r$/, '').trim();
    rest = rest.slice(nl + 1);
    if (!line || /^content-length:/i.test(line)) continue;
    messages.push(JSON.parse(line));
  }
  return { messages, rest };
}

function startStdio() {
  let buffer = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    try {
      const extracted = extractMessages(buffer);
      buffer = extracted.rest;
      extracted.messages.forEach((m) => {
        Promise.resolve(dispatch(m)).catch((e) => {
          process.stderr.write(`n8n-api dispatch: ${e.message}\n`);
        });
      });
    } catch (e) {
      process.stderr.write(`n8n-api parse error: ${e.message}\n`);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();
}

function encode(msg) {
  return Buffer.from(JSON.stringify(msg) + '\n', 'utf8');
}

function decodeAll(buf) {
  return extractMessages(buf).messages;
}

function selfTest() {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const { spawnSync } = require('child_process');
  const roundtrip = (request) => {
    const r = spawnSync(process.execPath, [__filename], {
      cwd: repoRoot,
      input: encode(request),
      encoding: null,
      timeout: 8000,
      env: { ...process.env, N8N_BASE_URL: '', N8N_URL: '', N8N_API_KEY: '', N8N_MCP_TOKEN: '' },
    });
    if (r.status !== 0 && r.status !== null) {
      throw new Error(`server exit ${r.status}: ${(r.stderr || Buffer.alloc(0)).toString()}`);
    }
    const out = (r.stdout || Buffer.alloc(0)).toString('utf8');
    if (/Content-Length:/i.test(out)) throw new Error('stdout must be NDJSON, not Content-Length');
    if (out && !out.includes('\n')) throw new Error('stdout missing trailing newline');
    return decodeAll(r.stdout)[0];
  };

  const init = roundtrip({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'self-test', version: '1' } },
  });
  assert(init && init.result && init.result.serverInfo.name === 'n8n-api', 'initialize failed');

  const tools = roundtrip({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = (tools.result.tools || []).map((t) => t.name);
  assert(names.includes('n8n_status') && names.includes('n8n_ping'), 'missing tools');
  assert(!names.some((n) => /execut/i.test(n)), 'must not execute workflows');

  const listed = roundtrip({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'n8n_list_exported_workflows', arguments: {} },
  });
  const text = listed.result.content[0].text;
  assert(/1-sync-webhook|Sync/.test(text), 'exported workflows missing');
  assert(!/Bearer /i.test(text), 'leaked token');

  console.log('MCP self-test PASS');
  console.log(`  tools: ${names.join(', ')}`);
  console.log('  exported workflows: ok');
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    try { selfTest(); } catch (e) {
      console.error(`MCP self-test FAIL: ${e.message}`);
      process.exit(1);
    }
  } else {
    startStdio();
  }
}

module.exports = { handleTool, SERVER_INFO, startStdio };
