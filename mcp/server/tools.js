'use strict';

const {
  treeLines,
  walkFiles,
  findFiles,
  searchRepo,
  readText,
  exists,
  envKeyNames,
  detectChanges,
  captureSnapshot,
  saveSnapshot,
  baselinePath,
  taskStartPath,
  gitAvailable,
  git,
  appendChangelog,
  latestChangelogEntry,
  parseChangelogEntries,
  jsFiles,
  workflowJsonFiles,
  nodeCheck,
  parseJsonFile,
  protectedIntegrity,
  scanSecretsInRepo,
  PIPELINES,
  IMPORTANT_DOCS,
  isoNow,
  isProtectedPath,
  isSensitivePath,
} = require('../../scripts/lib/common');

function textResult(obj) {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(message) {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

const TOOLS = [
  {
    name: 'get_repo_structure',
    description: 'Return the TeleCRM repository tree (secrets hidden). Use this first when entering the repo.',
    inputSchema: {
      type: 'object',
      properties: {
        max_depth: { type: 'number', description: 'Tree depth (default 4)' },
      },
    },
  },
  {
    name: 'find_files',
    description: 'Find files by glob (e.g. "**/*.js", "new workflows/*.json"). Does not return .env.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'search_repo',
    description: 'Search file contents with a regex or literal. Skips .env and binaries. Never returns secret values.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        glob: { type: 'string' },
        max_matches: { type: 'number' },
        case_sensitive: { type: 'boolean' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_project_file',
    description: 'Read a text file in the repository. Refuses .env, credentials, and binaries. Protected workflow/JS files are readable but must not be edited without approval.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the repo root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_repo_status',
    description: 'Git status if available, otherwise snapshot-based status. Reports whether protected files changed.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_agent_context',
    description: 'Read AGENT_CONTEXT.md — required before making changes.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_architecture_docs',
    description: 'List or read architecture docs (status mapping, edge cases, field flow, Mongo findings).',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Optional doc id: status-mapping | edge-cases | field-flow | cross-platform | whole-flow | field-dictionary | mcp-findings-readme',
        },
      },
    },
  },
  {
    name: 'get_do_not_modify',
    description: 'Return the hard list of files and behaviours an agent must not change without explicit approval.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_pipelines',
    description: 'List TeleCRM × Stance pipelines (sync, watchers, WF3, temperature, reconcile) and their write targets.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_env_key_names',
    description: 'List .env key names only. Never returns values.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'snapshot_task_start',
    description: 'Save a file-hash snapshot at the start of a task so created/modified/deleted can be proven later.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'detect_changes',
    description: 'List files created, modified, and deleted versus the task-start or baseline snapshot. Uses Git when present.',
    inputSchema: {
      type: 'object',
      properties: {
        against: { type: 'string', description: 'task-start (default) or baseline' },
        include_git_diff: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_git_diff',
    description: 'Return git diff when this folder is a git repository. Fails clearly if it is not.',
    inputSchema: {
      type: 'object',
      properties: {
        staged: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_changelog',
    description: 'Read AGENT_CHANGELOG.md (previous agent changes).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_latest_change',
    description: 'Return only the most recent AGENT_CHANGELOG.md entry.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'record_agent_change',
    description: 'Append an entry to AGENT_CHANGELOG.md. Append-only. Optionally fill file lists from detect-changes.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        agent: { type: 'string' },
        objective: { type: 'string' },
        reason: { type: 'string' },
        created: { type: 'array', items: { type: 'string' } },
        modified: { type: 'array', items: { type: 'string' } },
        deleted: { type: 'array', items: { type: 'string' } },
        changes: { type: 'array', items: { type: 'string' } },
        validation: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        manual: { type: 'array', items: { type: 'string' } },
        from_detect: { type: 'boolean', description: 'Fill created/modified/deleted from snapshots' },
      },
      required: ['title', 'objective'],
    },
  },
  {
    name: 'validate_repo',
    description: 'Run JS syntax checks, n8n JSON parse, protected-file integrity, and a secret heuristic. Does not start webhooks, watchers, or reconcile --apply.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'syntax_check_js',
    description: 'Run node --check on one JS file or every JS file in the repo.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional single file. Omit to check all.' },
      },
    },
  },
  {
    name: 'validate_workflow_json',
    description: 'JSON-parse n8n workflow files under new workflows/. Read-only.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const DOC_MAP = {
  'status-mapping': 'new workflows/STATUS-MAPPING.md',
  'edge-cases': 'new workflows/EDGE-CASES.md',
  'field-flow': 'new workflows/FIELD-FLOW.md',
  'cross-platform': 'new workflows/CROSS-PLATFORM-ACTIONS.md',
  'whole-flow': 'mcp/findings/whole-flow.md',
  'platforms': 'mcp/findings/platforms.md',
  'field-dictionary': 'new workflows/FIELD-DICTIONARY.csv',
  'mcp-findings-readme': 'mcp/findings/README.md',
};

function handleTool(name, args = {}) {
  try {
    switch (name) {
      case 'get_repo_structure':
        return textResult({
          generated_at: isoNow(),
          file_count: walkFiles({ includeDotDirs: true }).length,
          tree: treeLines(args.max_depth || 4),
        });

      case 'find_files':
        return textResult({ pattern: args.pattern, files: findFiles(args.pattern) });

      case 'search_repo':
        return textResult(searchRepo(args.query, {
          glob: args.glob,
          maxMatches: args.max_matches || 80,
          caseSensitive: !!args.case_sensitive,
        }));

      case 'read_project_file': {
        if (isSensitivePath(args.path)) {
          return errorResult('Refusing to read a sensitive file. Use get_env_key_names for key names only.');
        }
        const body = readText(args.path);
        const note = isProtectedPath(args.path)
          ? 'PROTECTED FILE — readable, but do not modify without explicit approval.\n\n'
          : '';
        return textResult(note + body);
      }

      case 'get_repo_status':
        return textResult({
          generated_at: isoNow(),
          git: gitAvailable(),
          env: envKeyNames(),
          important_docs: IMPORTANT_DOCS.map((p) => ({ path: p, exists: exists(p) })),
          protected: protectedIntegrity(),
          changes: detectChanges(),
        });

      case 'get_agent_context':
        if (!exists('AGENT_CONTEXT.md')) return errorResult('AGENT_CONTEXT.md is missing');
        return textResult(readText('AGENT_CONTEXT.md'));

      case 'get_architecture_docs': {
        if (!args.name) {
          return textResult({
            docs: Object.entries(DOC_MAP).map(([id, path]) => ({ id, path, exists: exists(path) })),
            hint: 'Call again with name set to a doc id.',
          });
        }
        const path = DOC_MAP[args.name];
        if (!path) return errorResult(`Unknown doc id: ${args.name}`);
        return textResult(readText(path));
      }

      case 'get_do_not_modify':
        return textResult({
          files: [
            'new workflows/** (especially 1-sync-webhook.json and 3-dashboard-to-telecrm.json)',
            'new workflows/main prod.json — combined copy; do not edit as a third source of truth',
            'new-telecrm-webhook.js',
            'new-telecrm-watcher.js',
            'reconcile-telecrm-stage.js',
            '.env',
          ],
          behaviours: [
            'Do not write users.profileData.status from TeleCRM/sync.',
            'Do not set NEW_TELECRM_PUSH_SOURCE=true without approval.',
            'Do not run reconcile-telecrm-stage.js --apply without approval.',
            'Do not start the live webhook or watcher against production from this MCP.',
            'Do not mix website utm_source with TeleCRM lead_source.',
            'Do not call Mongo insert/update/delete/drop via the MongoDB MCP.',
            'Do not print or commit .env values, tokens, or connection strings.',
            'MongoDB MCP findings: create new files under mcp/findings/ only.',
          ],
        });

      case 'list_pipelines':
        return textResult({ pipelines: PIPELINES });

      case 'get_env_key_names':
        return textResult(envKeyNames());

      case 'snapshot_task_start': {
        const snap = captureSnapshot();
        saveSnapshot(taskStartPath(), snap);
        return textResult({
          saved: '.agent/task-start.json',
          file_count: snap.file_count,
          captured_at: snap.captured_at,
        });
      }

      case 'detect_changes': {
        const result = detectChanges({ against: args.against || 'task-start' });
        if (args.include_git_diff && gitAvailable()) {
          result.git_diff = git(['diff']).stdout || '(empty)';
        }
        return textResult(result);
      }

      case 'get_git_diff':
        if (!gitAvailable()) {
          return errorResult('This folder is not a git repository. Use detect_changes (snapshot) instead.');
        }
        return textResult({
          diff: git(args.staged ? ['diff', '--cached'] : ['diff']).stdout || '(empty)',
          status: git(['status', '--porcelain']).stdout || '(clean)',
        });

      case 'get_changelog':
        if (!exists('AGENT_CHANGELOG.md')) return errorResult('AGENT_CHANGELOG.md is missing');
        return textResult(readText('AGENT_CHANGELOG.md'));

      case 'get_latest_change': {
        const latest = latestChangelogEntry();
        if (!latest) return errorResult('No changelog entries yet');
        return textResult(latest);
      }

      case 'record_agent_change': {
        const input = { ...args };
        if (args.from_detect) {
          const d = detectChanges();
          input.created = d.created;
          input.modified = d.modified;
          input.deleted = d.deleted;
        }
        const entry = appendChangelog(input);
        return textResult({ appended: true, entry });
      }

      case 'validate_repo': {
        const js = jsFiles().map(nodeCheck);
        const json = workflowJsonFiles().map(parseJsonFile);
        const secrets = scanSecretsInRepo();
        const integ = protectedIntegrity();
        const failed = [
          ...js.filter((x) => !x.ok),
          ...json.filter((x) => !x.ok),
        ];
        return textResult({
          generated_at: isoNow(),
          js_ok: js.every((x) => x.ok),
          json_ok: json.every((x) => x.ok),
          protected_ok: integ.ok,
          secret_hits: secrets,
          tests: 'SKIP — this repository has no test runner or test files',
          failures: failed,
          integrity: integ,
        });
      }

      case 'syntax_check_js': {
        const paths = args.path ? [args.path] : jsFiles();
        const results = paths.map(nodeCheck);
        return textResult({ ok: results.every((r) => r.ok), results });
      }

      case 'validate_workflow_json': {
        const results = workflowJsonFiles().map(parseJsonFile);
        return textResult({ ok: results.every((r) => r.ok), results });
      }

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return errorResult(e.message);
  }
}

module.exports = { TOOLS, handleTool, DOC_MAP };
