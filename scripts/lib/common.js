'use strict';

/**
 * Shared helpers for TeleCRM agent scripts and the repository MCP server.
 * No third-party dependencies. Never prints .env values or connection strings.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');

const IGNORE_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
]);

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.xlsx', '.xls', '.pdf', '.zip', '.gz', '.woff', '.woff2',
]);

const SENSITIVE_BASENAMES = new Set([
  '.env', '.env.local', '.env.production', '.env.development',
  'credentials.json', 'secrets.json',
]);

/** Paths an agent must not modify without explicit human approval. */
const PROTECTED_PREFIXES = [
  'new workflows/',
  'new workflows\\',
];

const PROTECTED_FILES = new Set([
  'new-telecrm-webhook.js',
  'new-telecrm-watcher.js',
  'reconcile-telecrm-stage.js',
  '.env',
]);

const IMPORTANT_DOCS = [
  'AGENT_CONTEXT.md',
  'AGENT_CHANGELOG.md',
  'MCP.md',
  'scripts/README.md',
  'mcp/README.md',
  'mcp/findings/whole-flow.md',
  'mcp/findings/platforms.md',
  'mcp/findings/unique-utm-sources.md',
  'new workflows/STATUS-MAPPING.md',
  'new workflows/EDGE-CASES.md',
  'new workflows/FIELD-FLOW.md',
  'new workflows/CROSS-PLATFORM-ACTIONS.md',
  'new workflows/FIELD-DICTIONARY.csv',
];

const PIPELINES = [
  {
    id: '1',
    name: 'Sync webhook',
    files: ['new-telecrm-webhook.js', 'new workflows/1-sync-webhook.json'],
    writesTelecrm: 'Yes — earliest source when it differs from TeleCRM; status only on recapture',
    writesJoin: 'Yes — full upsert of new-telecrm',
    writesUsers: 'No',
  },
  {
    id: '2a-2d',
    name: 'Watchers',
    files: [
      'new-telecrm-watcher.js',
      'new workflows/2a-watcher-telecrm.json',
      'new workflows/2b-watcher-users.json',
      'new workflows/2c-watcher-appointments.json',
      'new workflows/2d-watcher-web-visitors.json',
    ],
    writesTelecrm: 'No',
    writesJoin: 'Indirect — re-calls sync (1)',
    writesUsers: 'No',
  },
  {
    id: '3',
    name: 'Dashboard → TeleCRM (WF3)',
    files: ['new workflows/3-dashboard-to-telecrm.json'],
    writesTelecrm: 'Yes — status, name, and earliest source via autoupdatelead',
    writesJoin: 'Yes',
    writesUsers: 'No',
  },
  {
    id: 'temperature',
    name: 'Nightly temperature',
    files: ['new workflows/lead_temperature_workflow_corrected_v2.json'],
    writesTelecrm: 'Yes — temperature only',
    writesJoin: 'Yes — temp fields only',
    writesUsers: 'No',
  },
  {
    id: 'reconcile',
    name: 'Reconcile stuck Fresh leads',
    files: ['reconcile-telecrm-stage.js'],
    writesTelecrm: 'Yes — only if still Fresh, and only with --apply',
    writesJoin: 'No (until a later sync)',
    writesUsers: 'No',
  },
];

const SECRET_TEXT_RE = [
  /mongodb(\+srv)?:\/\/[^\s"'`]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk|rk|ak)-[A-Za-z0-9]{16,}\b/g,
];

function isoNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function isoDate() {
  return isoNow().slice(0, 10);
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function resolveSafe(relPath) {
  if (relPath == null || String(relPath).trim() === '') {
    throw new Error('Path is required');
  }
  const abs = path.resolve(repoRoot, String(relPath));
  const rel = path.relative(repoRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes repository: ${relPath}`);
  }
  return abs;
}

function relFromRoot(absPath) {
  return toPosix(path.relative(repoRoot, absPath));
}

function isSensitivePath(relPath) {
  const base = path.basename(relPath);
  if (base === '.env.example') return false;
  if (SENSITIVE_BASENAMES.has(base)) return true;
  if (/^\.env($|\.(local|production|development|test))$/.test(base)) return true;
  return false;
}

function isProtectedPath(relPath) {
  const posix = toPosix(relPath);
  if (PROTECTED_FILES.has(posix)) return true;
  return PROTECTED_PREFIXES.some((p) => posix.startsWith(toPosix(p)) || posix === 'new workflows');
}

function isBinaryPath(relPath) {
  return BINARY_EXTS.has(path.extname(relPath).toLowerCase());
}

function shouldSkipDir(name) {
  return IGNORE_DIR_NAMES.has(name);
}

function walkFiles(opts = {}) {
  const includeDotDirs = opts.includeDotDirs !== false;
  const includeSensitive = opts.includeSensitive === true;
  const out = [];

  function walk(dirAbs) {
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(dirAbs, ent.name);
      if (ent.isDirectory()) {
        if (shouldSkipDir(ent.name)) continue;
        if (!includeDotDirs && ent.name.startsWith('.') && ent.name !== '.cursor') continue;
        walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      if (ent.name === '.DS_Store') continue;
      const rel = relFromRoot(abs);
      if (!includeSensitive && isSensitivePath(rel)) continue;
      out.push(rel);
    }
  }

  walk(repoRoot);
  out.sort();
  return out;
}

function fileHash(relPath) {
  const abs = resolveSafe(relPath);
  const buf = fs.readFileSync(abs);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function fileStat(relPath) {
  const abs = resolveSafe(relPath);
  const st = fs.statSync(abs);
  return {
    path: toPosix(relPath),
    size: st.size,
    mtime: st.mtime.toISOString(),
    sha256: fileHash(relPath),
    binary: isBinaryPath(relPath),
    protected: isProtectedPath(relPath),
  };
}

function readText(relPath, maxBytes = 2_000_000) {
  if (isSensitivePath(relPath)) {
    throw new Error(`Refusing to read sensitive file: ${relPath}`);
  }
  const abs = resolveSafe(relPath);
  const st = fs.statSync(abs);
  if (st.size > maxBytes) {
    throw new Error(`File too large to read (${st.size} bytes): ${relPath}`);
  }
  if (isBinaryPath(relPath)) {
    throw new Error(`Refusing to read binary file as text: ${relPath}`);
  }
  return fs.readFileSync(abs, 'utf8');
}

function redactText(text) {
  let out = String(text);
  for (const re of SECRET_TEXT_RE) {
    out = out.replace(re, '[REDACTED]');
  }
  return out;
}

function exists(relPath) {
  try {
    fs.accessSync(resolveSafe(relPath));
    return true;
  } catch {
    return false;
  }
}

function ensureDir(relPath) {
  fs.mkdirSync(resolveSafe(relPath), { recursive: true });
}

function writeText(relPath, contents) {
  const abs = resolveSafe(relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents, 'utf8');
}

function appendText(relPath, contents) {
  const abs = resolveSafe(relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, contents, 'utf8');
}

function gitAvailable() {
  if (!fs.existsSync(path.join(repoRoot, '.git'))) return false;
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return r.status === 0 && String(r.stdout).trim() === 'true';
}

function git(args) {
  const r = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function envKeyNames() {
  const abs = path.join(repoRoot, '.env');
  if (!fs.existsSync(abs)) {
    return { present: false, keys: [], note: '.env not found' };
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const keys = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i > 0) keys.push(s.slice(0, i).trim());
  }
  return { present: true, keys, note: 'Values redacted. Never print .env contents.' };
}

function treeLines(maxDepth = 4) {
  const lines = ['.'];
  function walk(dirAbs, prefix, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    entries = entries
      .filter((e) => e.name !== '.DS_Store' && !shouldSkipDir(e.name))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
    entries.forEach((ent, i) => {
      const last = i === entries.length - 1;
      const branch = last ? '└── ' : '├── ';
      const next = last ? '    ' : '│   ';
      const rel = relFromRoot(path.join(dirAbs, ent.name));
      const label = isSensitivePath(rel) ? `${ent.name}  (present, contents hidden)` : ent.name;
      lines.push(prefix + branch + label + (ent.isDirectory() ? '/' : ''));
      if (ent.isDirectory()) {
        if (!ent.name.startsWith('.') || ent.name === '.cursor' || ent.name === '.agent') {
          walk(path.join(dirAbs, ent.name), prefix + next, depth + 1);
        }
      }
    });
  }
  walk(repoRoot, '', 1);
  return lines.join('\n');
}

function globToRegExp(pattern) {
  const posix = toPosix(pattern);
  let re = '';
  for (let i = 0; i < posix.length; i += 1) {
    const ch = posix[i];
    if (ch === '*' && posix[i + 1] === '*') {
      re += '.*';
      i += 1;
      if (posix[i + 1] === '/') i += 1;
    } else if (ch === '*') {
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else if ('\\^$+{}[]()|'.includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  return new RegExp(`^${re}$`);
}

function findFiles(pattern) {
  const re = globToRegExp(pattern);
  return walkFiles({ includeDotDirs: true }).filter((p) => re.test(p) || re.test(path.basename(p)));
}

function searchRepo(query, opts = {}) {
  const { glob, maxMatches = 80, caseSensitive = false } = opts;
  if (!query) throw new Error('Search query is required');
  const flags = caseSensitive ? 'g' : 'gi';
  let re;
  try {
    re = new RegExp(query, flags);
  } catch {
    re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  }
  const files = walkFiles({ includeDotDirs: true }).filter((p) => {
    if (isBinaryPath(p) || isSensitivePath(p)) return false;
    if (glob) return globToRegExp(glob).test(p);
    return true;
  });
  const matches = [];
  for (const rel of files) {
    let text;
    try {
      text = readText(rel, 1_500_000);
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (matches.length >= maxMatches) return;
      re.lastIndex = 0;
      if (re.test(line)) {
        matches.push({
          path: rel,
          line: idx + 1,
          text: redactText(line).slice(0, 400),
        });
      }
    });
    if (matches.length >= maxMatches) break;
  }
  return { query, matchCount: matches.length, truncated: matches.length >= maxMatches, matches };
}

function agentDir() {
  return path.join(repoRoot, '.agent');
}

function baselinePath() {
  return path.join(agentDir(), 'baseline.json');
}

function taskStartPath() {
  return path.join(agentDir(), 'task-start.json');
}

function captureSnapshot() {
  const files = {};
  for (const rel of walkFiles({ includeDotDirs: true, includeSensitive: false })) {
    if (rel === '.agent/baseline.json' || rel === '.agent/task-start.json') continue;
    try {
      files[rel] = fileStat(rel);
    } catch {
      // skip unreadable
    }
  }
  return {
    captured_at: new Date().toISOString(),
    git: gitAvailable(),
    file_count: Object.keys(files).length,
    files,
  };
}

function saveSnapshot(absPath, snapshot) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(snapshot, null, 2), 'utf8');
}

function loadSnapshot(absPath) {
  if (!fs.existsSync(absPath)) return null;
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function compareSnapshots(before, after) {
  const created = [];
  const modified = [];
  const deleted = [];
  const beforeFiles = (before && before.files) || {};
  const afterFiles = (after && after.files) || {};
  const all = new Set([...Object.keys(beforeFiles), ...Object.keys(afterFiles)]);
  for (const p of [...all].sort()) {
    const a = beforeFiles[p];
    const b = afterFiles[p];
    if (!a && b) created.push(p);
    else if (a && !b) deleted.push(p);
    else if (a && b && a.sha256 !== b.sha256) modified.push(p);
  }
  return { created, modified, deleted };
}

function detectChanges(opts = {}) {
  const current = captureSnapshot();
  const gitOn = gitAvailable();
  const result = {
    source: gitOn ? 'git+snapshot' : 'snapshot',
    git_available: gitOn,
    captured_at: current.captured_at,
  };

  if (gitOn) {
    const status = git(['status', '--porcelain']);
    const diffStat = git(['diff', '--stat']);
    const untracked = git(['ls-files', '--others', '--exclude-standard']);
    result.git_status = status.stdout.trim() || '(clean)';
    result.git_diff_stat = diffStat.stdout.trim() || '(no unstaged diff)';
    result.git_untracked = untracked.stdout.trim().split('\n').filter(Boolean);
  } else {
    result.git_status = 'Not a git repository. Change detection uses file snapshots in .agent/.';
  }

  const baseline = loadSnapshot(opts.baselineAbs || baselinePath());
  const taskStart = loadSnapshot(opts.taskStartAbs || taskStartPath());
  let vs;
  let label;
  if (opts.against === 'baseline') {
    vs = baseline;
    label = 'baseline';
  } else if (opts.against === 'task-start') {
    vs = taskStart;
    label = 'task-start';
  } else {
    vs = taskStart || baseline;
    label = taskStart ? 'task-start' : 'baseline';
  }

  if (!vs) {
    result.compared_to = null;
    result.note = 'No snapshot found. Run scripts/snapshot-baseline.js before a task.';
    result.created = [];
    result.modified = [];
    result.deleted = [];
    return result;
  }

  const cmp = compareSnapshots(vs, current);
  result.compared_to = { label, captured_at: vs.captured_at, file_count: vs.file_count };
  result.created = cmp.created;
  result.modified = cmp.modified;
  result.deleted = cmp.deleted;
  return result;
}

function protectedIntegrity(snapshot) {
  const current = captureSnapshot();
  const before = snapshot || loadSnapshot(taskStartPath()) || loadSnapshot(baselinePath());
  if (!before) {
    return { ok: false, note: 'No snapshot to compare protected files against.', violations: [] };
  }
  const violations = [];
  const cmp = compareSnapshots(before, current);
  for (const p of [...cmp.modified, ...cmp.deleted]) {
    if (isProtectedPath(p)) violations.push({ path: p, change: cmp.deleted.includes(p) ? 'deleted' : 'modified' });
  }
  return { ok: violations.length === 0, violations, compared_to: before.captured_at };
}

function scanSecretsInRepo() {
  const hits = [];
  for (const rel of walkFiles({ includeDotDirs: true })) {
    if (isBinaryPath(rel) || isSensitivePath(rel)) continue;
    if (rel.startsWith('.agent/')) continue;
    let text;
    try {
      text = fs.readFileSync(resolveSafe(rel), 'utf8');
    } catch {
      continue;
    }
    for (const re of SECRET_TEXT_RE) {
      re.lastIndex = 0;
      if (re.test(text)) hits.push(rel);
    }
  }
  return [...new Set(hits)];
}

function parseChangelogEntries(md) {
  const parts = String(md).split(/^## /m).slice(1);
  return parts.map((p) => `## ${p.trim()}`);
}

function latestChangelogEntry() {
  if (!exists('AGENT_CHANGELOG.md')) return null;
  const entries = parseChangelogEntries(readText('AGENT_CHANGELOG.md'));
  return entries.length ? entries[entries.length - 1] : null;
}

function formatChangelogEntry(input) {
  const list = (arr, empty = '- None') => {
    if (!arr || !arr.length) return empty;
    return arr.map((x) => `- \`${x}\``).join('\n');
  };
  const bullets = (arr, empty = '- None') => {
    if (!arr || !arr.length) return empty;
    return arr.map((x) => `- ${x}`).join('\n');
  };
  const title = input.title || 'Untitled task';
  const date = input.date || isoDate();
  const agent = input.agent || 'AI coding agent';
  const validation = (input.validation || []).map((v) => {
    if (typeof v === 'string') return `- ${v}`;
    return `- \`${v.command}\` — ${v.result}`;
  });

  return [
    `## ${date} — ${title}`,
    '',
    `**Agent:** ${agent}`,
    '',
    '### Objective',
    input.objective || '(not specified)',
    '',
    '### Files Created',
    list(input.created),
    '',
    '### Files Modified',
    list(input.modified),
    '',
    '### Files Deleted',
    list(input.deleted),
    '',
    '### Changes',
    bullets(input.changes),
    '',
    '### Reason',
    input.reason || '(not specified)',
    '',
    '### Validation',
    validation.length ? validation.join('\n') : '- None',
    '',
    '### Risks / Notes',
    bullets(input.risks),
    '',
    '### Manual Verification Required',
    bullets(input.manual),
    '',
  ].join('\n');
}

function appendChangelog(input) {
  const header = [
    '# Agent Changelog',
    '',
    'Append-only record of AI agent modifications to this repository.',
    'Do not rewrite or delete previous entries unless a human explicitly asks.',
    '',
    '---',
    '',
  ].join('\n');

  if (!exists('AGENT_CHANGELOG.md')) {
    writeText('AGENT_CHANGELOG.md', header);
  }
  const entry = formatChangelogEntry(input);
  appendText('AGENT_CHANGELOG.md', `\n${entry}\n`);
  return entry;
}

function jsFiles() {
  return walkFiles({ includeDotDirs: true }).filter((p) => p.endsWith('.js') && !p.startsWith('node_modules/'));
}

function workflowJsonFiles() {
  return findFiles('new workflows/*.json');
}

function nodeCheck(relPath) {
  const r = spawnSync(process.execPath, ['--check', resolveSafe(relPath)], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return { path: relPath, ok: r.status === 0, output: (r.stderr || r.stdout || '').trim() };
}

function parseJsonFile(relPath) {
  try {
    JSON.parse(readText(relPath));
    return { path: relPath, ok: true };
  } catch (e) {
    return { path: relPath, ok: false, error: e.message };
  }
}

module.exports = {
  repoRoot,
  IGNORE_DIR_NAMES,
  BINARY_EXTS,
  SENSITIVE_BASENAMES,
  PROTECTED_FILES,
  PROTECTED_PREFIXES,
  IMPORTANT_DOCS,
  PIPELINES,
  isoNow,
  isoDate,
  toPosix,
  resolveSafe,
  relFromRoot,
  isSensitivePath,
  isProtectedPath,
  isBinaryPath,
  walkFiles,
  fileHash,
  fileStat,
  readText,
  redactText,
  exists,
  ensureDir,
  writeText,
  appendText,
  gitAvailable,
  git,
  envKeyNames,
  treeLines,
  findFiles,
  searchRepo,
  captureSnapshot,
  saveSnapshot,
  loadSnapshot,
  compareSnapshots,
  detectChanges,
  protectedIntegrity,
  scanSecretsInRepo,
  baselinePath,
  taskStartPath,
  agentDir,
  parseChangelogEntries,
  latestChangelogEntry,
  formatChangelogEntry,
  appendChangelog,
  jsFiles,
  workflowJsonFiles,
  nodeCheck,
  parseJsonFile,
};
