#!/usr/bin/env node
'use strict';

/**
 * Refresh the auto-generated Live Snapshot section in AGENT_CONTEXT.md.
 * Does not invent architecture text. Refuses to overwrite the rest of the file.
 */

const {
  exists,
  readText,
  writeText,
  treeLines,
  walkFiles,
  gitAvailable,
  envKeyNames,
  isoNow,
  jsFiles,
  workflowJsonFiles,
} = require('./lib/common');

const START = '<!-- AUTO:LIVE-SNAPSHOT:START -->';
const END = '<!-- AUTO:LIVE-SNAPSHOT:END -->';

function buildSnapshot() {
  const files = walkFiles({ includeDotDirs: true });
  const env = envKeyNames();
  const git = gitAvailable();
  return [
    START,
    '',
    `_Last refreshed: ${isoNow()}_`,
    '',
    `- Files indexed (secrets excluded): **${files.length}**`,
    `- JavaScript files: **${jsFiles().length}**`,
    `- n8n / config JSON under \`new workflows/\`: **${workflowJsonFiles().length}**`,
    `- Git repository: **${git ? 'yes' : 'no'}**`,
    `- \`.env\`: **${env.present ? `present (${env.keys.length} keys, values not listed here)` : 'absent'}**`,
    '',
    '### Tree',
    '',
    '```text',
    treeLines(4),
    '```',
    '',
    END,
  ].join('\n');
}

function main() {
  if (!exists('AGENT_CONTEXT.md')) {
    console.error('AGENT_CONTEXT.md is missing. Refusing to generate a generic context file.');
    process.exit(1);
  }
  const original = readText('AGENT_CONTEXT.md');
  if (!original.includes(START) || !original.includes(END)) {
    console.error('AGENT_CONTEXT.md is missing AUTO:LIVE-SNAPSHOT markers. Refusing to rewrite the file.');
    process.exit(1);
  }
  const before = original.slice(0, original.indexOf(START));
  const after = original.slice(original.indexOf(END) + END.length);
  const next = `${before}${buildSnapshot()}${after.replace(/^\n/, '')}`;
  if (next === original) {
    console.log('Live snapshot already up to date.');
    return;
  }
  writeText('AGENT_CONTEXT.md', next);
  console.log(`Updated live snapshot in AGENT_CONTEXT.md — ${isoNow()}`);
}

try {
  main();
} catch (e) {
  console.error(`update-context failed: ${e.message}`);
  process.exit(1);
}
