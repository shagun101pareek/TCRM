# TeleCRM repository MCP

The **telecrm-repo** MCP server is a stdio JSON-RPC Model Context Protocol server for *this folder*. It helps an AI coding agent understand the TeleCRM × Stance join project, read architecture docs, validate JS/n8n JSON, and append `AGENT_CHANGELOG.md`.

It is **not** the MongoDB Atlas MCP and **not** the live TeleCRM API. Cluster queries stay on the MongoDB plugin (`plugin-mongodb-mongodb`). Live CRM `lead/search` stays on **`telecrm-api`**. n8n stays on **`n8n-api`**. **`platforms`** (`mcp/platforms/index.js`) is the hub: `platforms_status` / `platforms_ping` across all of those.

## What it does

- Inspect repository structure, search files, read project docs
- Serve `AGENT_CONTEXT.md`, architecture markdown, and the do-not-modify list
- Snapshot file hashes (this folder is not a git repo) and report created / modified / deleted files
- Append changelog entries
- Run `node --check` and parse n8n JSON
- Block reading `.env` values and refuse arbitrary shell

It does **not** start `new-telecrm-webhook.js`, the watcher, or `reconcile-telecrm-stage.js --apply`. Those can write TeleCRM or Mongo.

## Install / setup

Requirements: **Node.js 18+** (stdlib only; no `npm install` for this MCP).

1. Confirm `mcp/server/index.js` exists.
2. Point the MCP client at that file (working directory = repository root). Cursor is already configured in `.cursor/mcp.json`.
3. Reload the MCP session in the client.

No Mongo connection string is required for telecrm-repo. Do not put secrets in the MCP config `env` block.

### Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "platforms": {
      "command": "node",
      "args": ["mcp/platforms/index.js"]
    },
    "telecrm-repo": {
      "command": "node",
      "args": ["mcp/server/index.js"]
    },
    "telecrm-api": {
      "command": "node",
      "args": ["mcp/telecrm-api/index.js"]
    },
    "n8n-api": {
      "command": "node",
      "args": ["mcp/n8n-api/index.js"]
    }
  }
}
```

`platforms` is the hub (`platforms_status`, `platforms_ping`). Mongo stays on the Cursor MongoDB plugin — do not put a connection string in this JSON.

`telecrm-api` reads Sync/Async tokens from `.env` (`TELECRM_SYNC_API2`, `TELECRM_ASYNC_API2`). Sync → `lead/search`. Async → `autoupdatelead` (ping only; MCP does not upsert leads).

`n8n-api` lists exported workflows immediately. Live n8n needs `N8N_BASE_URL` and `N8N_API_KEY` in `.env`. Do not put tokens in this JSON. Reload Cursor Settings → MCP after changing `.env`.

Paths are resolved from the workspace root. The server `chdir`s to the repository root on startup.

### Claude Desktop (optional; not committed)

If you also use Claude Desktop, add the same command with an **absolute** path to `mcp/server/index.js`. Do not duplicate that config in this repo unless you need it checked in.

## How to run

```bash
# Foreground stdio server (what clients spawn)
node mcp/server/index.js
node scripts/start-mcp.js

# Handshake + tool smoke test (no client required)
node mcp/server/index.js --self-test
```

Leave stdio alone: Cursor speaks newline-delimited JSON (one JSON-RPC object per line). Servers still accept Content-Length on input.

## Available tools

| Tool | Purpose |
|---|---|
| `get_repo_structure` | Tree (secrets hidden) |
| `find_files` | Glob search |
| `search_repo` | Content search; skips `.env` / binaries |
| `read_project_file` | Read text; **blocks** `.env` |
| `get_repo_status` | Git or snapshot status + protected-file integrity |
| `get_agent_context` | `AGENT_CONTEXT.md` |
| `get_architecture_docs` | List or read status mapping, edge cases, field flow, findings, … |
| `get_do_not_modify` | Hard file + behaviour list |
| `list_pipelines` | Sync / watchers / WF3 / temperature / reconcile |
| `get_env_key_names` | `.env` **names only** |
| `snapshot_task_start` | Write `.agent/task-start.json` |
| `detect_changes` | Created / modified / deleted vs snapshot |
| `get_git_diff` | `git diff` if this becomes a git repo |
| `get_changelog` | Full `AGENT_CHANGELOG.md` |
| `get_latest_change` | Last changelog entry |
| `record_agent_change` | **Append** a changelog entry |
| `validate_repo` | JS syntax, workflow JSON, secret heuristic, protected files |
| `syntax_check_js` | `node --check` |
| `validate_workflow_json` | `JSON.parse` on `new workflows/*.json` |

## Available resources

| URI | Content |
|---|---|
| `telecrm://agent-context` | `AGENT_CONTEXT.md` |
| `telecrm://changelog` | `AGENT_CHANGELOG.md` |
| `telecrm://mcp-guide` | This file |
| `telecrm://scripts-readme` | `scripts/README.md` |
| `telecrm://do-not-modify` | Short hard list |
| `telecrm://agent-workflow` | Standard agent steps |
| `telecrm://status-mapping` | `new workflows/STATUS-MAPPING.md` |
| `telecrm://edge-cases` | `new workflows/EDGE-CASES.md` |
| `telecrm://field-flow` | `new workflows/FIELD-FLOW.md` |
| `telecrm://cross-platform-actions` | `new workflows/CROSS-PLATFORM-ACTIONS.md` |
| `telecrm://whole-flow` | `mcp/findings/whole-flow.md` |
| `telecrm://platforms` | `mcp/findings/platforms.md` |

Prompt: `telecrm_task` (argument `task`).

## Required environment variables

**None** for telecrm-repo.

Root JS (webhook/watcher/reconcile) documents `MONGODB_URI`, `MONGODB_DB`, `TELECRM_ENTERPRISE_ID`, `TELECRM_API_TOKEN`, `TELECRM_AUTOUPDATE_TOKEN`. Those are **not** used by this MCP. The `.env` in this folder may use different key names — see `AGENT_CONTEXT.md`. Use `get_env_key_names` rather than opening `.env`.

## Security considerations

- `.env`, `credentials.json`, and similar paths cannot be read through `read_project_file`.
- Search redacts Mongo URIs and private-key blocks if they appear in other files.
- No arbitrary shell tool.
- No Mongo write tools.
- Changelog tool only **appends** `AGENT_CHANGELOG.md`.
- Snapshot tool only writes `.agent/task-start.json` / baseline files.
- Protected workflows and root JS are readable, not writable, via this MCP.

## How an AI coding agent should use it

1. `get_agent_context` and `get_do_not_modify`
2. `get_repo_structure` / `search_repo` / `read_project_file` as needed
3. `snapshot_task_start` before edits
4. Make the smallest change; skip protected files unless the human approved them
5. `validate_repo`
6. `detect_changes` (and `get_git_diff` if git exists)
7. `record_agent_change` with evidence from step 6

Equivalent scripts live in `scripts/` if MCP is not connected.

## Example workflows

**Answer “how does WF3 overwrite TeleCRM?”**

1. `get_architecture_docs` with `name: "edge-cases"`
2. Optionally `read_project_file` on `new workflows/3-dashboard-to-telecrm.json` (read-only)

**After implementing a docs-only fix**

1. `snapshot_task_start` (if not already)
2. `validate_repo`
3. `detect_changes` with `from_detect` via `record_agent_change`

**Query live Mongo counts**

Do **not** use telecrm-repo. Use the MongoDB MCP + skill. Write a **new** file under `mcp/findings/`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Client cannot start server | Node on `PATH`; args point at `mcp/server/index.js` (or platforms / telecrm-api / n8n-api); cwd is repo root |
| MCP error -32001 Request timed out / tool discovery failed | Server must reply NDJSON (one JSON object plus a newline), not `Content-Length` headers — Cursor 3.17 waits for a newline |
| Project MCP stuck on “loading” | Settings → MCP: enable `platforms`, `telecrm-repo`, `telecrm-api`, `n8n-api`. Mongo is the plugin, not this JSON |
| `get_agent_context` errors | `AGENT_CONTEXT.md` missing |
| `detect_changes` empty / no snapshot | Run `snapshot_task_start` or `node scripts/snapshot-baseline.js --task-start` |
| `get_git_diff` errors | Folder has no `.git` — use snapshots |
| `--self-test` fails on context | `AGENT_CONTEXT.md` must exist and contain “Project Overview” |
| TeleCRM ping networkError | Sandbox or offline; retry with network. Sync 401 = wrong token type |
| n8n live skipped | Set `N8N_BASE_URL` and `N8N_API_KEY` in `.env` |
| Secrets leaked in tool output | File a bug; do not paste `.env` into chat |

Self-test:

```bash
node mcp/server/index.js --self-test
node scripts/validate.js
```
