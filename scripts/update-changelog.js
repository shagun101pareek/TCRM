#!/usr/bin/env node
'use strict';

const fs = require('fs');
const {
  appendChangelog,
  detectChanges,
  isoDate,
} = require('./lib/common');

function parseArgs(argv) {
  const out = {
    title: null,
    agent: 'AI coding agent',
    objective: null,
    reason: null,
    created: [],
    modified: [],
    deleted: [],
    changes: [],
    validation: [],
    risks: [],
    manual: [],
    fromDetect: false,
    jsonPath: null,
    dryRun: false,
  };
  const takeList = (raw) => String(raw || '').split(/[|,]/).map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--title': out.title = next(); break;
      case '--agent': out.agent = next(); break;
      case '--objective': out.objective = next(); break;
      case '--reason': out.reason = next(); break;
      case '--created': out.created = takeList(next()); break;
      case '--modified': out.modified = takeList(next()); break;
      case '--deleted': out.deleted = takeList(next()); break;
      case '--changes': out.changes = takeList(next()); break;
      case '--validation': out.validation = takeList(next()); break;
      case '--risks': out.risks = takeList(next()); break;
      case '--manual': out.manual = takeList(next()); break;
      case '--from-detect': out.fromDetect = true; break;
      case '--json': out.jsonPath = next(); break;
      case '--dry-run': out.dryRun = true; break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
    }
  }
  return out;
}

function help() {
  console.log(`Usage: node scripts/update-changelog.js --title "Short task" [options]

Append-only. Never rewrites previous entries.

Options:
  --title TEXT           Required unless --json is used
  --agent TEXT           Default: "AI coding agent"
  --objective TEXT
  --reason TEXT
  --created a,b          File paths created
  --modified a,b
  --deleted a,b
  --changes "one|two"    Pipe- or comma-separated bullets
  --validation "cmd — PASS"
  --risks "note|note"
  --manual "check|check"
  --from-detect          Fill created/modified/deleted from detect-changes
  --json FILE            Read a JSON object with the same fields
  --dry-run              Print the entry without writing
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }

  let input = { ...args, date: isoDate() };
  if (args.jsonPath) {
    const parsed = JSON.parse(fs.readFileSync(args.jsonPath, 'utf8'));
    input = { ...input, ...parsed };
  }
  if (args.fromDetect) {
    const d = detectChanges();
    input.created = d.created || [];
    input.modified = d.modified || [];
    input.deleted = d.deleted || [];
  }
  if (!input.title) {
    console.error('--title is required (or provide it in --json)');
    process.exit(2);
  }

  const { formatChangelogEntry } = require('./lib/common');
  const entry = formatChangelogEntry(input);
  if (args.dryRun) {
    console.log(entry);
    return;
  }
  appendChangelog(input);
  console.log(`Appended changelog entry: ${input.date} — ${input.title}`);
}

try {
  main();
} catch (e) {
  console.error(`update-changelog failed: ${e.message}`);
  process.exit(1);
}
