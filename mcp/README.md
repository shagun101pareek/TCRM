# MCP in this folder

Four project servers in `.cursor/mcp.json`, plus the Cursor **MongoDB plugin**.

| Server | File | Platform |
|---|---|---|
| `platforms` | `mcp/platforms/index.js` | Hub: status/ping all |
| `telecrm-api` | `mcp/telecrm-api/index.js` | TeleCRM REST (read / ping) |
| `n8n-api` | `mcp/n8n-api/index.js` | n8n exports + optional live REST |
| `telecrm-repo` | `mcp/server/index.js` | This repository |
| MongoDB plugin | Cursor plugin (not in `mcp.json`) | Atlas `stance-dashboard` |

Secrets stay in `.env`. Never put them in `mcp.json`.

Enable the project servers in **Cursor Settings → MCP**, then reload after `.env` changes.

Findings: `mcp/findings/`.
