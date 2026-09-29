---
name: telecrm-agent-workspace
description: Persistent TeleCRM agent workspace — read AGENT_CONTEXT.md, use the telecrm-repo MCP or scripts/, validate, then append AGENT_CHANGELOG.md. Use when changing this repository, running agent scripts, or starting a coding task in TeleCRM.
---

# TeleCRM agent workspace

Follow this every time you change the repository:

```text
Understand context
     ↓
Inspect repository
     ↓
Inspect relevant files
     ↓
Understand requested change
     ↓
Make minimal changes
     ↓
Run validation/tests
     ↓
Inspect git diff / snapshots
     ↓
Record changes
     ↓
Update AGENT_CHANGELOG.md
```

## Required reading

1. [AGENT_CONTEXT.md](../../../AGENT_CONTEXT.md)
2. Do-not-modify list in that file (workflows, root JS, `.env`)
3. [MCP.md](../../../MCP.md) if using tools

## Hard rules

- Do not edit `new workflows/`, `new-telecrm-webhook.js`, `new-telecrm-watcher.js`, `reconcile-telecrm-stage.js`, or `.env` unless the human explicitly approved that file.
- Do not print `.env` values or connection strings.
- Do not run `reconcile-telecrm-stage.js --apply` or enable `NEW_TELECRM_PUSH_SOURCE`.
- Do not write `users.profileData.status` from sync.
- MongoDB cluster work: new files under `mcp/findings/` only (see `telecrm-mongodb-mcp` skill).
- Changelog is append-only.

## Commands

```bash
node scripts/snapshot-baseline.js --task-start
node scripts/validate.js
node scripts/detect-changes.js
node scripts/update-changelog.js --title "…" --objective "…" --from-detect --reason "…"
```

Prefer MCP tools `get_agent_context`, `snapshot_task_start`, `validate_repo`, `detect_changes`, `record_agent_change` when telecrm-repo is connected.
