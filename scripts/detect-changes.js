#!/usr/bin/env node
'use strict';

const { detectChanges, gitAvailable, git } = require('./lib/common');

function parseArgs(argv) {
  const out = { against: 'auto', json: false, diff: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--diff') out.diff = true;
    else if (a === '--against') out.against = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/detect-changes.js [--json] [--diff] [--against baseline|task-start]

Uses Git when this folder is a git repository. Otherwise compares the
current tree to .agent/task-start.json or .agent/baseline.json.

Does not print .env contents.`);
    return;
  }

  const result = detectChanges({ against: args.against === 'baseline' ? 'baseline' : args.against });
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Change detection (${result.source})`);
  if (result.compared_to) {
    console.log(`Compared to ${result.compared_to.label} captured ${result.compared_to.captured_at}`);
  } else {
    console.log(result.note || 'No snapshot');
  }
  console.log('');
  console.log(`Created (${(result.created || []).length}):`);
  (result.created || []).forEach((p) => console.log(`  + ${p}`));
  if (!(result.created || []).length) console.log('  (none)');
  console.log(`Modified (${(result.modified || []).length}):`);
  (result.modified || []).forEach((p) => console.log(`  ~ ${p}`));
  if (!(result.modified || []).length) console.log('  (none)');
  console.log(`Deleted (${(result.deleted || []).length}):`);
  (result.deleted || []).forEach((p) => console.log(`  - ${p}`));
  if (!(result.deleted || []).length) console.log('  (none)');

  if (gitAvailable()) {
    console.log('');
    console.log('Git status:');
    console.log(result.git_status);
    if (args.diff) {
      const diff = git(['diff']);
      console.log('');
      console.log('Git diff:');
      console.log(diff.stdout || '(no unstaged diff)');
    }
  }
}

try {
  main();
} catch (e) {
  console.error(`detect-changes failed: ${e.message}`);
  process.exit(1);
}
