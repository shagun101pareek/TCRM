#!/usr/bin/env node
'use strict';

const {
  repoRoot,
  treeLines,
  walkFiles,
  gitAvailable,
  envKeyNames,
  PIPELINES,
  IMPORTANT_DOCS,
  exists,
  isoNow,
} = require('./lib/common');

function main() {
  const files = walkFiles({ includeDotDirs: true });
  const js = files.filter((p) => p.endsWith('.js'));
  const json = files.filter((p) => p.endsWith('.json'));
  const md = files.filter((p) => p.endsWith('.md'));
  const env = envKeyNames();

  const report = {
    inspected_at: isoNow(),
    repo_root: repoRoot,
    git: gitAvailable(),
    file_count: files.length,
    counts: {
      js: js.length,
      json: json.length,
      md: md.length,
      csv: files.filter((p) => p.endsWith('.csv')).length,
    },
    env: env,
    important_docs: IMPORTANT_DOCS.map((p) => ({ path: p, exists: exists(p) })),
    pipelines: PIPELINES,
    files,
  };

  console.log(`TeleCRM repository inspection — ${report.inspected_at}`);
  console.log(`Root: ${repoRoot}`);
  console.log(`Git: ${report.git ? 'yes' : 'no'}`);
  console.log(`Files (secrets excluded): ${report.file_count}`);
  console.log(`  js=${report.counts.js} json=${report.counts.json} md=${report.counts.md} csv=${report.counts.csv}`);
  console.log('');
  console.log('Tree:');
  console.log(treeLines(5));
  console.log('');
  console.log('Env keys (values hidden):');
  if (!env.present) console.log('  .env not found');
  else env.keys.forEach((k) => console.log(`  ${k}`));
  console.log('');
  console.log('Important docs:');
  report.important_docs.forEach((d) => console.log(`  ${d.exists ? '✓' : '✗'} ${d.path}`));
  console.log('');
  console.log('Pipelines:');
  PIPELINES.forEach((p) => {
    console.log(`  [${p.id}] ${p.name}`);
    console.log(`      files: ${p.files.join(', ')}`);
  });
}

try {
  main();
} catch (e) {
  console.error(`inspect-repo failed: ${e.message}`);
  process.exit(1);
}
