# n8n MCP (read-only)

This repo’s workflow JSON does **not** include the live n8n host (`AGENT_CONTEXT.md`: URL unknown). This MCP:

1. Lists exports under `new workflows/` (works offline).
2. Optionally talks to a live n8n instance via REST. It does **not** execute workflows.

## Connect the live instance

In n8n: **Settings → n8n API → Create an API key**.

Add to `.env` (not `mcp.json`, not chat):

```
N8N_BASE_URL=https://YOUR-INSTANCE
N8N_API_KEY=
```

Then reload Cursor MCP (`n8n-api`).

Official instance-level MCP (Cursor talking to n8n’s `/mcp-server/http`) is a separate toggle: [Connect to n8n MCP server](https://docs.n8n.io/connect/connect-to-n8n-mcp-server). Prefer that in Cursor Settings if you want n8n’s own tools; keep secrets out of this git folder.

## Tools

- `n8n_status` / `n8n_ping`
- `n8n_list_exported_workflows`
- `n8n_list_live_workflows` (needs API key)

```bash
node mcp/n8n-api/index.js --self-test
```
