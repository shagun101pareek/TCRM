#!/usr/bin/env node
'use strict';

const {
  repoRoot,
  gitAvailable,
  git,
  exists,
  envKeyNames,
  detectChanges,
  protectedIntegrity,
  isoNow,
} = require('./lib/common');

function flag(ok, label, detail) {
  console.log(`${ok ? '✓' : '!'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function main() {
  console.log(`TeleCRM repository status — ${isoNow()}`);
  console.log(`Root: ${repoRoot}`);
  console.log('');

  flag(exists('AGENT_CONTEXT.md'), 'AGENT_CONTEXT.md');
  flag(exists('AGENT_CHANGELOG.md'), 'AGENT_CHANGELOG.md');
  flag(exists('MCP.md'), 'MCP.md');
  flag(exists('mcp/server/index.js'), 'Repository MCP server');
  flag(exists('new-telecrm-webhook.js'), 'JS sync webhook (protected)');
  flag(exists('new workflows/1-sync-webhook.json'), 'n8n Sync (1) (protected)');

  const env = envKeyNames();
  flag(env.present, '.env present', env.present ? `${env.keys.length} key(s), values hidden` : 'missing');

  const gitOn = gitAvailable();
  flag(gitOn, 'Git repository');
  if (gitOn) {
    const branch = git(['branch', '--show-current']);
    const status = git(['status', '--porcelain']);
    console.log(`  branch: ${branch.stdout.trim() || '(detached)'}`);
    console.log(`  porcelain:\n${status.stdout.trim() ? status.stdout : '  (clean)'}`);
  } else {
    console.log('  Change tracking falls back to .agent/ snapshots.');
  }

  const integrity = protectedIntegrity();
  flag(integrity.ok, 'Protected files unchanged vs snapshot', integrity.ok ? integrity.compared_to : `${integrity.violations.length} violation(s)`);
  if (!integrity.ok && integrity.violations) {
    integrity.violations.forEach((v) => console.log(`    ${v.change}: ${v.path}`));
  }

  const changes = detectChanges();
  console.log('');
  console.log(`Changes vs ${changes.compared_to ? changes.compared_to.label : 'no snapshot'}:`);
  console.log(`  created:   ${(changes.created || []).length}`);
  console.log(`  modified:  ${(changes.modified || []).length}`);
  console.log(`  deleted:   ${(changes.deleted || []).length}`);
}

try {
  main();
} catch (e) {
  console.error(`check-status failed: ${e.message}`);
  process.exit(1);
}
