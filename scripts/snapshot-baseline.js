#!/usr/bin/env node
'use strict';

const {
  captureSnapshot,
  saveSnapshot,
  baselinePath,
  taskStartPath,
  isoNow,
} = require('./lib/common');

function parseArgs(argv) {
  const out = { kind: 'baseline' };
  for (const a of argv) {
    if (a === '--task-start') out.kind = 'task-start';
    else if (a === '--baseline') out.kind = 'baseline';
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
    console.log(`Usage: node scripts/snapshot-baseline.js [--baseline|--task-start]

Captures file hashes for change detection when Git is unavailable.
  --baseline     Save .agent/baseline.json (default). Use after a completed task.
  --task-start   Save .agent/task-start.json. Use at the start of an agent task.

Does not hash .env contents into the snapshot file listing (the file is skipped).`);
    return;
  }

  const snap = captureSnapshot();
  const dest = args.kind === 'task-start' ? taskStartPath() : baselinePath();
  saveSnapshot(dest, snap);
  console.log(`Saved ${args.kind} snapshot — ${isoNow()}`);
  console.log(`  path: ${dest}`);
  console.log(`  files: ${snap.file_count}`);
  console.log(`  git: ${snap.git}`);
}

try {
  main();
} catch (e) {
  console.error(`snapshot-baseline failed: ${e.message}`);
  process.exit(1);
}
