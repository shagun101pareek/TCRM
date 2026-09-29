# Platforms connected via MCP

Checked 2026-09-02. No secrets.

The three product surfaces (TeleCRM, Stance Dashboard, join) plus n8n and this repo.

| Platform | MCP in this session | Live? | Blocker |
|---|---|---|---|
| **MongoDB / Stance** | `plugin-mongodb-mongodb` | Yes — Atlas session already open | None. `stance-dashboard`: `telecrm` 17,035; `users` 6,602; `crm_sync_materialized` 17,036; `new-telecrm` 0 |
| **TeleCRM** | `telecrm-api` | Async auth works when network is allowed. Sync `lead/search` is 401 | `TELECRM_SYNC_API2` is not a Sync token for enterprise `69da237dbbfc0db1fc1ea6e2`. Cursor project MCP may still show **loading** until enabled in Settings → MCP |
| **n8n** | `n8n-api` | Exported JSON in `new workflows/` listed. Live instance not called | Add `N8N_BASE_URL` + `N8N_API_KEY` to `.env` (host is not in this repo) |
| **This folder** | `telecrm-repo` | Self-test PASS | Enable in Settings → MCP if tools are missing |
| **Hub** | `platforms` | `platforms_status` / `platforms_ping` | Same Cursor enable step |

## What “connected” means

- Mongo: plugin `list-databases` / `count` on the existing connection.
- TeleCRM: `.env` keys `TELECRM_ASYNC_API2` (Async, ping empty `autoupdatelead`) and `TELECRM_SYNC_API2` (must be Sync-typed for search).
- n8n: offline list of workflow JSON; live REST only with host + API key.
- Stance has no separate API MCP — clinic data is the Mongo `users` / `appointments` / `web_*` collections.

## Cursor enable

Settings → MCP: turn on `telecrm-repo`, `telecrm-api`, `n8n-api`, `platforms`. The MongoDB plugin is already a separate namespace.
