#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const {
  repoRoot,
  jsFiles,
  workflowJsonFiles,
  nodeCheck,
  parseJsonFile,
  exists,
  envKeyNames,
  protectedIntegrity,
  scanSecretsInRepo,
  gitAvailable,
  isoNow,
} = require('./lib/common');

function runMcpSmoke(relPath) {
  if (!exists(relPath)) {
    return { ok: false, detail: `${relPath} missing` };
  }
  const server = path.join(repoRoot, relPath);
  const r = spawnSync(process.execPath, [server, '--self-test'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
  });
  return {
    ok: r.status === 0,
    detail: (r.stdout || r.stderr || '').trim().slice(-2000),
  };
}

function main() {
  const failures = [];
  console.log(`TeleCRM validation — ${isoNow()}`);
  console.log('');

  console.log('1. Required agent files');
  ['AGENT_CONTEXT.md', 'AGENT_CHANGELOG.md', 'MCP.md', 'scripts/README.md', 'mcp/server/index.js', 'mcp/telecrm-api/index.js', 'mcp/n8n-api/index.js', 'mcp/platforms/index.js'].forEach((p) => {
    const ok = exists(p);
    console.log(`   ${ok ? 'PASS' : 'FAIL'} exists ${p}`);
    if (!ok) failures.push(`missing ${p}`);
  });

  console.log('2. JavaScript syntax (node --check)');
  for (const p of jsFiles()) {
    const r = nodeCheck(p);
    console.log(`   ${r.ok ? 'PASS' : 'FAIL'} ${p}${r.ok ? '' : ` — ${r.output}`}`);
    if (!r.ok) failures.push(`syntax ${p}`);
  }

  console.log('3. Workflow JSON parse');
  for (const p of workflowJsonFiles()) {
    const r = parseJsonFile(p);
    console.log(`   ${r.ok ? 'PASS' : 'FAIL'} ${p}${r.ok ? '' : ` — ${r.error}`}`);
    if (!r.ok) failures.push(`json ${p}`);
  }

  console.log('4. MCP self-test');
  const mcpChecks = [
    ['mcp/server/index.js', 'mcp/server --self-test'],
    ['mcp/telecrm-api/index.js', 'mcp/telecrm-api --self-test'],
    ['mcp/n8n-api/index.js', 'mcp/n8n-api --self-test'],
    ['mcp/platforms/index.js', 'mcp/platforms --self-test'],
  ];
  for (const [rel, label] of mcpChecks) {
    const mcp = runMcpSmoke(rel);
    console.log(`   ${mcp.ok ? 'PASS' : 'FAIL'} ${label}`);
    if (!mcp.ok) {
      console.log(mcp.detail);
      failures.push(label);
    } else if (mcp.detail) {
      mcp.detail.split('\n').forEach((l) => console.log(`     ${l}`));
    }
  }

  console.log('5. Protected-file integrity');
  const integ = protectedIntegrity();
  console.log(`   ${integ.ok ? 'PASS' : 'FAIL'} protected files vs snapshot`);
  if (!integ.ok) {
    (integ.violations || []).forEach((v) => console.log(`     ${v.change}: ${v.path}`));
    if (integ.violations && integ.violations.length) failures.push('protected files changed');
    else if (integ.note) console.log(`     ${integ.note}`);
  }

  console.log('6. Secret scan (heuristic, skips .env)');
  const secrets = scanSecretsInRepo();
  console.log(`   ${secrets.length ? 'FAIL' : 'PASS'} connection-string / key material in repo files`);
  secrets.forEach((p) => console.log(`     ${p}`));
  if (secrets.length) failures.push('possible secrets in files');

  console.log('7. Project tests');
  console.log('   SKIP no test runner / test files exist in this repository');

  console.log('8. Git');
  console.log(`   ${gitAvailable() ? 'PASS git available' : 'SKIP not a git repository'}`);

  const env = envKeyNames();
  console.log('9. Env');
  console.log(`   ${env.present ? 'PASS' : 'SKIP'} .env ${env.present ? `(${env.keys.length} keys, values hidden)` : 'absent'}`);

  console.log('');
  if (failures.length) {
    console.log(`FAIL (${failures.length})`);
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('PASS');
}

try {
  main();
} catch (e) {
  console.error(`validate failed: ${e.message}`);
  process.exit(1);
}
