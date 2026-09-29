#!/usr/bin/env node
'use strict';

/**
 * Hub MCP: one status/ping across TeleCRM, n8n, this repo, and Mongo (plugin).
 * Does not write leads, execute n8n workflows, or print secrets.
 */

const telecrm = require('../telecrm-api/index.js');
const n8n = require('../n8n-api/index.js');
const { handleTool: repoHandle } = require('../server/tools');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'platforms', version: '1.0.0' };

function textResult(obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function parseTool(result) {
  const text = result && result.content && result.content[0] && result.content[0].text;
  let data = text;
  try { data = JSON.parse(text); } catch (_) { /* keep string */ }
  return { ok: !(result && result.isError), isError: !!(result && result.isError), data };
}

const TOOLS = [
  {
    name: 'platforms_status',
    description:
      'Map every connected platform (Mongo/Stance, TeleCRM, n8n, this repo) and whether env keys are present. No secrets. No network.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'platforms_ping',
    description:
      'Live ping TeleCRM (search + empty autoupdate) and n8n (healthz if URL set), plus exported n8n workflows and repo env key names. Mongo stays on the Cursor MongoDB plugin. Never upserts leads or executes workflows.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

async function statusPayload() {
  const tele = parseTool(await telecrm.handleTool('telecrm_status', {}));
  const nstat = parseTool(await n8n.handleTool('n8n_status'));
  const env = parseTool(repoHandle('get_env_key_names', {}));
  return {
    server: SERVER_INFO.name,
    writes: false,
    executesWorkflows: false,
    platforms: [
      {
        id: 'mongodb',
        name: 'MongoDB Atlas / Stance Dashboard',
        mcp: 'plugin-mongodb-mongodb',
        inProjectMcpJson: false,
        connectedVia: 'Cursor MongoDB plugin (existing Atlas session)',
        database: 'stance-dashboard',
        notes: [
          'Stance users/appointments/web_* live here.',
          'telecrm is the CRM mirror; crm_sync_materialized is the live join; new-telecrm is empty by design vs live.',
          'Do not put MONGODB_URI in mcp.json. Optional key in .env is unused by the plugin.',
        ],
      },
      {
        id: 'telecrm',
        name: 'TeleCRM cloud',
        mcp: 'telecrm-api',
        inProjectMcpJson: true,
        writes: false,
        status: tele.data,
      },
      {
        id: 'n8n',
        name: 'n8n',
        mcp: 'n8n-api',
        inProjectMcpJson: true,
        executesWorkflows: false,
        status: nstat.data,
      },
      {
        id: 'repo',
        name: 'This TeleCRM folder',
        mcp: 'telecrm-repo',
        inProjectMcpJson: true,
        envKeyNames: env.data,
      },
    ],
    howToEnableInCursor:
      'Settings → MCP: enable telecrm-repo, telecrm-api, n8n-api, platforms. MongoDB plugin is separate. Reload after .env changes. Never put tokens in mcp.json.',
  };
}

async function pingAll() {
  const [telePing, nPing, nList] = await Promise.all([
    telecrm.handleTool('telecrm_ping', {}),
    n8n.handleTool('n8n_ping'),
    n8n.handleTool('n8n_list_exported_workflows'),
  ]);
  const env = parseTool(repoHandle('get_env_key_names', {}));
  const tele = parseTool(telePing);
  const n8nPing = parseTool(nPing);
  const exported = parseTool(nList);
  const workflows = (exported.data && exported.data.workflows) || [];
  return {
    mongodb: {
      mcp: 'plugin-mongodb-mongodb',
      note: 'Ping this session with the MongoDB plugin (list-databases / count). Not reachable from this stdio server.',
    },
    telecrm: tele.data,
    n8n: {
      ping: n8nPing.data,
      exportedWorkflowCount: workflows.length,
      exportedWorkflows: workflows,
    },
    repo: env.data,
    connected: {
      telecrm: !!(tele.data && tele.data.connected),
      n8nLive: !!(n8nPing.data && n8nPing.data.connected),
      n8nExports: workflows.length > 0,
      repo: env.ok,
    },
  };
}

async function handleTool(name) {
  if (name === 'platforms_status') return textResult(await statusPayload());
  if (name === 'platforms_ping') return textResult(await pingAll());
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
      reply(id, await handleTool(params && params.name));
      return;
    }
    if (isNotification) return;
    replyError(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    if (isNotification) {
      process.stderr.write(`platforms MCP error: ${e.message}\n`);
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
          process.stderr.write(`platforms dispatch: ${e.message}\n`);
        });
      });
    } catch (e) {
      process.stderr.write(`platforms parse error: ${e.message}\n`);
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
      cwd: require('path').resolve(__dirname, '..', '..'),
      input: encode(request),
      encoding: null,
      timeout: 8000,
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
  assert(init && init.result && init.result.serverInfo.name === 'platforms', 'initialize failed');

  const tools = roundtrip({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const names = (tools.result.tools || []).map((t) => t.name);
  assert(names.includes('platforms_status') && names.includes('platforms_ping'), 'missing tools');

  const status = roundtrip({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'platforms_status', arguments: {} },
  });
  const text = status.result.content[0].text;
  assert(/plugin-mongodb-mongodb/.test(text) && /telecrm-api/.test(text) && /n8n-api/.test(text), 'status missing platforms');
  assert(!/Bearer /i.test(text), 'leaked token');

  console.log('MCP self-test PASS');
  console.log(`  tools: ${names.join(', ')}`);
  console.log('  platforms_status: ok');
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
