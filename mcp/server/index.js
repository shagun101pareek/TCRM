#!/usr/bin/env node
'use strict';

/**
 * TeleCRM repository MCP server (stdio JSON-RPC).
 * Node.js stdlib only. No arbitrary shell. Never prints .env values.
 */

const { TOOLS, handleTool } = require('./tools');
const { PROMPTS, listResources, readResource, getPrompt } = require('./resources');
const { repoRoot } = require('../../scripts/lib/common');

process.chdir(repoRoot);

const SERVER_INFO = {
  name: 'telecrm-repo',
  version: '1.0.0',
};

const PROTOCOL_VERSION = '2024-11-05';

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
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      });
      return;
    }
    if (method === 'notifications/initialized' || method === 'initialized') {
      return;
    }
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
      const result = handleTool(name, args);
      reply(id, result);
      return;
    }
    if (method === 'resources/list') {
      reply(id, { resources: listResources() });
      return;
    }
    if (method === 'resources/read') {
      const uri = params && params.uri;
      reply(id, readResource(uri));
      return;
    }
    if (method === 'prompts/list') {
      reply(id, { prompts: PROMPTS });
      return;
    }
    if (method === 'prompts/get') {
      reply(id, getPrompt(params && params.name, (params && params.arguments) || {}));
      return;
    }
    if (isNotification) return;
    replyError(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    if (isNotification) {
      process.stderr.write(`telecrm-repo MCP error: ${e.message}\n`);
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
        dispatch(m);
      });
    } catch (e) {
      process.stderr.write(`telecrm-repo parse error: ${e.message}\n`);
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

  const roundtrip = (request) => {
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [__filename], {
      cwd: repoRoot,
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
    const replies = decodeAll(r.stdout);
    return replies[0];
  };

  const init = roundtrip({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'self-test', version: '1' },
    },
  });
  assert(init && init.result && init.result.serverInfo.name === 'telecrm-repo', 'initialize failed');

  const tools = roundtrip({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert(tools.result.tools.length >= 10, 'tools/list too small');

  const resources = roundtrip({ jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} });
  assert(resources.result.resources.length >= 5, 'resources/list too small');

  const ctx = roundtrip({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'get_agent_context', arguments: {} },
  });
  const ctxText = ctx.result.content[0].text;
  assert(/Agent Context/.test(ctxText) || /AGENT_CONTEXT/.test(ctxText) || /Project Overview/.test(ctxText), 'context missing');

  const blocked = roundtrip({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'read_project_file', arguments: { path: '.env' } },
  });
  assert(blocked.result.isError === true, '.env should be blocked');

  console.log('MCP self-test PASS');
  console.log(`  tools: ${tools.result.tools.length}`);
  console.log(`  resources: ${resources.result.resources.length}`);
  console.log('  get_agent_context: ok');
  console.log('  .env read blocked: ok');
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

module.exports = { dispatch, SERVER_INFO, startStdio };
