# Platforms hub MCP

One stdio server that **maps and pings** every platform this project talks to.

| Platform | Dedicated MCP | Hub tools |
|---|---|---|
| MongoDB Atlas / Stance | Cursor plugin `plugin-mongodb-mongodb` | Status only (plugin holds the live session) |
| TeleCRM | `telecrm-api` | `platforms_ping` → `telecrm_ping` |
| n8n | `n8n-api` | exports always; live REST if `.env` has host + key |
| This folder | `telecrm-repo` | env **key names** only |

Does **not** upsert TeleCRM leads, execute n8n workflows, or print tokens.

```bash
node mcp/platforms/index.js --self-test
```
