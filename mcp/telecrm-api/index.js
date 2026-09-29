#!/usr/bin/env node
'use strict';

/**
 * Read-only TeleCRM API MCP (stdio JSON-RPC).
 * Calls lead/search only. Never calls autoupdatelead.
 * Never prints tokens or .env values.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
process.chdir(repoRoot);

const DEFAULT_ENTERPRISE_ID = '69da237dbbfc0db1fc1ea6e2';
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'telecrm-api', version: '1.0.0' };

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

function enterpriseId() {
  return String(process.env.TELECRM_ENTERPRISE_ID || DEFAULT_ENTERPRISE_ID).trim();
}

function searchToken() {
  return String(
    process.env.TELECRM_API_TOKEN ||
      process.env.TELECRM_SYNC_API2 ||
      process.env.TELECRM_SYNC_API ||
      '',
  ).trim();
}

function asyncToken() {
  return String(
    process.env.TELECRM_AUTOUPDATE_TOKEN ||
      process.env.TELECRM_ASYNC_API2 ||
      process.env.TELECRM_ASYNC_API ||
      '',
  ).trim();
}

function apiError(json) {
  const err = json && json.error;
  if (!err) return null;
  return {
    code: err.code || null,
    message: typeof err.message === 'string' ? err.message : null,
  };
}

function searchUrl() {
  return `https://next.telecrm.in/autoupdate/v2/enterprise/${enterpriseId()}/lead/search`;
}

function autoupdateUrl() {
  return `https://next-api.telecrm.in/enterprise/${enterpriseId()}/autoupdatelead`;
}

function normPhone10(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/[^0-9]/g, '');
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  return s;
}

function textResult(obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const TOOLS = [
  {
    name: 'telecrm_status',
    description:
      'Show whether the read-only TeleCRM MCP can call lead/search (enterprise id, token present, URLs). Does not print secrets and does not write leads.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'telecrm_ping',
    description:
      'Live connection test. Sync token → POST lead/search (dummy phone). Async token → POST autoupdatelead with empty body (no fields, does not create a lead). Reports HTTP status only; never prints tokens.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'telecrm_search_by_phone',
    description:
      'Read-only: POST TeleCRM Sync lead/search by phone (normalized to 91 + 10 digits). Requires a Sync-typed token. Async tokens are rejected with 401 NOT_AUTHORIZED. Never calls autoupdatelead.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Phone in any common format; stripped to 10 digits then searched as 91…',
        },
      },
      required: ['phone'],
      additionalProperties: false,
    },
  },
];

function statusPayload() {
  return {
    server: SERVER_INFO.name,
    mode: 'read-only',
    writes: false,
    enterpriseId: enterpriseId(),
    syncTokenPresent: searchToken().length > 0,
    asyncTokenPresent: asyncToken().length > 0,
    tokenEnvKeysTried: {
      sync: ['TELECRM_API_TOKEN', 'TELECRM_SYNC_API2', 'TELECRM_SYNC_API'],
      async: ['TELECRM_AUTOUPDATE_TOKEN', 'TELECRM_ASYNC_API2', 'TELECRM_ASYNC_API'],
    },
    searchUrl: searchUrl(),
    autoupdateUrl: autoupdateUrl(),
    note:
      'Sync token is required for lead/search. Async token is only for autoupdatelead (writes). Mixing them returns 401 NOT_AUTHORIZED. Call telecrm_ping to test live.',
  };
}

async function safeFetch(url, opts) {
  try {
    const resp = await fetch(url, opts);
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* ignore */ }
    return { ok: resp.ok, status: resp.status, json, networkError: null };
  } catch (e) {
    return { ok: false, status: 0, json: null, networkError: e.message };
  }
}

async function pingLive() {
  const sync = searchToken();
  const asyncT = asyncToken();
  const result = {
    enterpriseId: enterpriseId(),
    syncSearch: { configured: sync.length > 0 },
    asyncWrite: { configured: asyncT.length > 0 },
  };

  if (sync) {
    const resp = await safeFetch(`${searchUrl()}?limit=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${sync}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { phone: '910000000000' } }),
    });
    const err = apiError(resp.json);
    result.syncSearch = {
      configured: true,
      ok: resp.ok,
      http: resp.status,
      errorCode: err && err.code,
      networkError: resp.networkError || undefined,
      hint: resp.networkError
        ? 'Could not reach next.telecrm.in (network).'
        : resp.ok
          ? 'Sync token is valid for lead/search.'
          : '401 NOT_AUTHORIZED means this value is not a Sync token for this enterprise (wrong type, expired, or different workspace).',
    };
  }

  if (asyncT) {
    const resp = await safeFetch(autoupdateUrl(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${asyncT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    result.asyncWrite = {
      configured: true,
      ok: resp.status === 400 || resp.status === 200,
      http: resp.status,
      networkError: resp.networkError || undefined,
      hint: resp.networkError
        ? 'Could not reach next-api.telecrm.in (network).'
        : resp.status === 400
          ? 'Async token is valid (empty body rejected; no lead created).'
          : resp.status === 200
            ? 'Unexpected 200 on empty body — check dashboard; no fields were sent.'
            : 'Async token rejected. Use an Async-typed token on next-api.telecrm.in/autoupdatelead.',
    };
  }

  const connected = !!(result.syncSearch.ok || result.asyncWrite.ok);
  return textResult({ connected, ...result });
}

async function searchByPhone(phone) {
  const token = searchToken();
  if (!token) {
    return errorResult(
      'No TeleCRM search token. Set TELECRM_API_TOKEN or TELECRM_SYNC_API2 in .env (Sync API, not the Async autoupdate token). Do not put the token in mcp.json.',
    );
  }
  const phone10 = normPhone10(phone);
  if (phone10.length < 10) {
    return errorResult(`Phone too short after normalize (got ${phone10.length} digits).`);
  }
  const searchPhone = '91' + phone10.slice(-10);
  const resp = await fetch(searchUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: { phone: searchPhone } }),
  });
  const bodyText = await resp.text();
  let json;
  try {
    json = JSON.parse(bodyText);
  } catch (_) {
    json = null;
  }
  if (!resp.ok) {
    const err = apiError(json);
    const code = err && err.code ? err.code : String(resp.status);
    return errorResult(
      `TeleCRM search HTTP ${resp.status} ${code}. Sync endpoint rejects Async tokens (401 NOT_AUTHORIZED). Set TELECRM_SYNC_API2 to a Sync-typed token for enterprise ${enterpriseId()}.`,
    );
  }
  const lead = json && Array.isArray(json.data) ? json.data[0] : null;
  if (!lead) {
    return textResult({ found: false, searchedPhone: searchPhone, count: (json && json.data && json.data.length) || 0 });
  }
  return textResult({
    found: true,
    searchedPhone: searchPhone,
    duplicateCount: json.data.length,
    note: json.data.length > 1 ? 'TeleCRM returned multiple leads; Sync uses data[0] only.' : undefined,
    lead,
  });
}

async function handleTool(name, args) {
  if (name === 'telecrm_status') return textResult(statusPayload());
  if (name === 'telecrm_ping') return pingLive();
  if (name === 'telecrm_search_by_phone') return searchByPhone(args && args.phone);
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
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: { tools: {} },
      });
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
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      const result = await handleTool(name, args);
      reply(id, result);
      return;
    }
    if (isNotification) return;
    replyError(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    if (isNotification) {
      process.stderr.write(`telecrm-api MCP error: ${e.message}\n`);
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
          process.stderr.write(`telecrm-api dispatch: ${e.message}\n`);
        });
      });
    } catch (e) {
      process.stderr.write(`telecrm-api parse error: ${e.message}\n`);
    }
  });
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();
}

function encode(msg) {
  return Buffer.from(JSON.stringify(msg) + '\n', 'utf8');
}

function decodeAll(buf) {
  const { messages } = extractMessages(buf);
  return messages;
}

function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };
  const { spawnSync } = require('child_process');
  const roundtrip = (request) => {
    const r = spawnSync(process.execPath, [__filename], {
      cwd: repoRoot,
      input: encode(request),
      encoding: null,
      timeout: 8000,
      env: {
        ...process.env,
        TELECRM_API_TOKEN: '',
        TELECRM_SYNC_API2: '',
        TELECRM_SYNC_API: '',
        TELECRM_AUTOUPDATE_TOKEN: '',
        TELECRM_ASYNC_API2: '',
        TELECRM_ASYNC_API: '',
      },
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
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'self-test', version: '1' } },
  });
  assert(init && init.result && init.result.serverInfo.name === 'telecrm-api', 'initialize failed');

  const tools = roundtrip({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = (tools.result.tools || []).map((t) => t.name);
  assert(names.includes('telecrm_status'), 'missing telecrm_status');
  assert(names.includes('telecrm_ping'), 'missing telecrm_ping');
  assert(names.includes('telecrm_search_by_phone'), 'missing telecrm_search_by_phone');
  assert(!names.some((n) => /update|create|autoupdate/i.test(n)), 'must not expose write tools');
  assert(names.length === 3, 'unexpected extra tools');

  const status = roundtrip({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'telecrm_status', arguments: {} },
  });
  const statusText = status.result.content[0].text;
  assert(/lead\/search/.test(statusText), 'status missing search URL');
  assert(!/Bearer /i.test(statusText), 'status leaked a bearer token');
  assert(/"writes": false/.test(statusText), 'must stay read-only');

  const noPhone = roundtrip({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'telecrm_search_by_phone', arguments: { phone: '12' } },
  });
  assert(noPhone.result.isError === true, 'short phone should error without calling API');

  console.log('MCP self-test PASS');
  console.log(`  tools: ${names.join(', ')}`);
  console.log('  read-only: ok');
  console.log('  no token leak: ok');
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    try {
      selfTest();
    } catch (e) {
      console.error(`MCP self-test FAIL: ${e.message}`);
      process.exit(1);
    }
  } else {
    startStdio();
  }
}

module.exports = { dispatch, SERVER_INFO, startStdio, handleTool };
