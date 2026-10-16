# Agent / repository scripts

Small Node.js utilities (stdlib only). Run from the **repository root**.

```bash
node scripts/<name>.js [--help]
```

Do not point these at `.env` values. Do not add `reconcile --apply` or webhook/watcher starters here.

| Script | Purpose | Usage | Safe to run? |
| ------ | ------- | ----- | ------------ |
| `inspect-repo.js` | Print tree, file counts, env **key names**, pipeline map | `node scripts/inspect-repo.js` | Yes |
| `check-status.js` | Presence of agent files, git/snapshot status, protected-file integrity | `node scripts/check-status.js` | Yes |
| `snapshot-baseline.js` | Save file hashes to `.agent/` for later diffs | `node scripts/snapshot-baseline.js` `--baseline` (default) or `--task-start` | Yes |
| `detect-changes.js` | Created / modified / deleted vs snapshot; git if present | `node scripts/detect-changes.js [--json] [--diff] [--against baseline\|task-start]` | Yes |
| `validate.js` | JS syntax, n8n JSON, MCP self-test, secret heuristic | `node scripts/validate.js` | Yes |
| `update-context.js` | Refresh only the `AUTO:LIVE-SNAPSHOT` section of `AGENT_CONTEXT.md` | `node scripts/update-context.js` | Yes — does not rewrite architecture prose |
| `update-changelog.js` | Append one `AGENT_CHANGELOG.md` entry | `node scripts/update-changelog.js --title "…" --objective "…" [--from-detect]` | Yes — append-only |
| `start-mcp.js` | Start repository MCP on stdio | `node scripts/start-mcp.js` | Yes — stdio server, no TeleCRM writes |
| `sync-1000-users.js` | Load latest 10-digit `users` that exist in the `telecrm` mirror; dry-run lists phones, `--apply` upserts `new-telecrm` via JS `syncOne` | `node scripts/sync-1000-users.js` then `--apply` | Dry-run yes. `--apply` writes `new-telecrm`. Does not start the webhook server or push to TeleCRM |
| `restore-bot-fresh.js` | Restore TeleCRM `Fresh` leads whose previous stage was Converted (daily-report temperature reopen). Status only | `node scripts/restore-bot-fresh.js` then `--apply` | Dry-run yes. `--apply` writes TeleCRM `status` via autoupdatelead. Uses `MONGODB_URI_PRODUCTION` + `stance-dashboard` when set |
| `seed-missing-capture-frequency.js` | Set missing `new-telecrm.telecrm_capture_frequency` to `1` (baseline only) | `node scripts/seed-missing-capture-frequency.js` then `--apply` | Dry-run yes. Never overwrites an existing count. No TeleCRM API. Pause temperature realtime before apply |
| `backfill-capture-frequency.js` | Copy `telecrm` capture frequency → `new-telecrm.telecrm_capture_frequency` only | `node scripts/backfill-capture-frequency.js` then `--apply` | Dry-run yes. Never lowers a stored count. No TeleCRM API. Uses `MONGODB_URI_PRODUCTION` + `stance-dashboard` when set |
| `backfill-new-telecrm.js` | All usable `telecrm` phones (including CRM-only) into `new-telecrm` on `stance-development`; refreshes existing rows; CRM from the mirror | `node scripts/backfill-new-telecrm.js` then `--apply --from-mirror` | Dry-run yes. `--apply` writes `new-telecrm`. Defaults to `stance-development`. Pause temperature realtime before a full apply |
| `lib/common.js` | Shared helpers (not an entrypoint) | `require('./lib/common')` | N/A |

## Details

### inspect-repo.js

Walks the tree (skips `.env` contents and `node_modules`). Use at the start of a task.

### check-status.js

Quick health of the agent workspace. If Git is missing, says so instead of inventing a repo.

### snapshot-baseline.js

Because this folder may not be a git repository, change detection needs a hash snapshot.

- `--task-start` — call **before** edits
- `--baseline` — call after a finished, recorded task so the next task has a clean comparison

Snapshots skip `.env` so hashes never include secret file bytes in `.agent/` listings of that path.

### detect-changes.js

Compares the current tree to `.agent/task-start.json` or `.agent/baseline.json`. Prefer Git when `.git` exists. `--diff` prints `git diff` only when Git works.

### validate.js

Does **not** run TeleCRM or Mongo. Fails non-zero if JS syntax, JSON parse, MCP self-test, protected-file edits, or a connection-string heuristic fails.

There are no project unit tests; that step is reported as `SKIP`.

### update-context.js

Requires existing `AGENT_CONTEXT.md` with `<!-- AUTO:LIVE-SNAPSHOT:START/END -->` markers. Refuses to generate a generic context file.

### update-changelog.js

Append-only. `--from-detect` fills created/modified/deleted from the snapshot comparison. `--dry-run` prints the entry. `--json FILE` reads the same fields from disk.

### sync-1000-users.js

Reads Mongo only unless you pass `--apply`. Loads `.env` with Node stdlib (the `dotenv` package is not required). If `MONGODB_DB` is omitted, the database name is taken from the URI path. `--apply` calls `new-telecrm-webhook.js` `syncOne` once per phone. Live `lead/search` needs a Sync-typed token; HTTP 401 falls back to the Mongo `telecrm` mirror (`--from-mirror` forces that, `--from-api` requires live search). Refuses to run if `NEW_TELECRM_PUSH_SOURCE` is on. Does not edit n8n workflows.

### backfill-new-telecrm.js

Reads Mongo only unless you pass `--apply`. Defaults to database `stance-development` and `--from-mirror`. Refuses `--apply` when `new-telecrm` is empty (wrong-cluster guard) or when the database is not `stance-development`. Production uses `--db stance-dashboard --uri-env MONGODB_URI_PRODUCTION --allow-other-db --allow-empty-target`. Existing join rows are refreshed; missing phones are inserted. `--skip` resumes after a partial run. `--phone` retries one 10-digit number. Progress is `.agent/backfill-new-telecrm-progress.json` for development and `.agent/backfill-new-telecrm-progress-<db>.json` otherwise. Refuses to run if `NEW_TELECRM_PUSH_SOURCE` is on.

### push-earliest-source.js

Reads Mongo unless you pass `--apply`. Compares `new-telecrm` `source[0].source` with the `telecrm` mirror dropdown and prints phones that differ. `--apply` posts `{ phone, source }` only (10-digit phone, no status). Empty `source[]` is skipped. An exact match is skipped. Does not call `syncOne` and does not set `NEW_TELECRM_PUSH_SOURCE`. Defaults to `stance-dashboard` via `MONGODB_URI_PRODUCTION` when that key exists.

### start-mcp.js

Thin wrapper around `mcp/server/index.js`. MCP clients should usually spawn the server file directly (see `MCP.md`).

## Error handling

All entry scripts catch top-level errors, print `script failed: <message>`, and exit `1`. Unknown CLI flags exit `2`. Paths cannot escape the repository root (`scripts/lib/common.js` `resolveSafe`).
