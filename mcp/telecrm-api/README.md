# TeleCRM API MCP

Uses `.env` only (never `mcp.json`):

| Key | API | Endpoint |
|---|---|---|
| `TELECRM_SYNC_API2` | **Sync** (reads) | `POST https://next.telecrm.in/autoupdate/v2/enterprise/{id}/lead/search` |
| `TELECRM_ASYNC_API2` | **Async** (writes) | `POST https://next-api.telecrm.in/enterprise/{id}/autoupdatelead` |

Enterprise id default: `69da237dbbfc0db1fc1ea6e2`.

Tokens are not interchangeable. Mixed type → `401 NOT_AUTHORIZED` ([docs](https://docs.telecrm.in/authentication)).

## Tools

- `telecrm_status` — URLs and whether tokens are present (no network)
- `telecrm_ping` — live auth check; Async ping sends **empty body** (no lead created)
- `telecrm_search_by_phone` — Sync search only

## CLI

```bash
node mcp/telecrm-api/index.js --self-test
node -e "require('./mcp/telecrm-api/index.js').handleTool('telecrm_ping', {}).then(r => console.log(r.content[0].text))"
```
