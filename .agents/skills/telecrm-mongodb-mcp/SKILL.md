---
name: telecrm-mongodb-mcp
description: Map and query the Healthflex stance-dashboard MongoDB cluster for the full TeleCRM data flow — how leads enter TeleCRM, how the telecrm mirror is filled, how Stance users/appointments/web_visitors join by phone, and how new-telecrm vs crm_sync_materialized differ. Use when asking how MongoDB works, how TeleCRM gets data, sync/watchers/WF3, UTM vs lead_source, or producing MCP findings. Never edit existing workflow files — only create new files under mcp/.
---

# TeleCRM MongoDB MCP

## Hard rules

1. **Create new files only.** Never edit `new workflows/`, root `*.js`, `.env`, or other existing project files.
2. Write findings as **new files** under `mcp/findings/`.
3. **Never write connection strings, passwords, or API keys** to any file.
4. This cluster access is **read-only**. Do not call insert/update/delete/drop tools.

## Connect

- Database: `stance-dashboard`
- Reuse an existing MCP connection if `list-connections` already has one.
- Otherwise `connect` with the connection string the user provides in chat or via env. Do not persist it.

## Whole flow (read this first)

Canonical MCP finding: [../../../mcp/findings/whole-flow.md](../../../mcp/findings/whole-flow.md)

Short version:

1. **TeleCRM cloud** is the source of truth for CRM fields. Leads enter via Excel, website form, Facebook, WhatsApp Cloud API, manual, call logs, plus WF3 `autoupdatelead` and the temperature job.
2. **crm-mongo-sync** copies that into Mongo `telecrm` (mirror / trigger). Do not treat the mirror as live — watchers take the phone and re-fetch `lead/search`.
3. **Stance** writes `users`, `appointments`, `web_visitors`, `web_touchpoints` independently.
4. **Sync (1)** joins API + dash + web by 10-digit phone into `new-telecrm`. **Live count is 0.** Reporting today is `telecrm` + `crm_sync_materialized`.
5. **UTM** is website-only. **lead_source** is how the CRM row was created. Do not mix them.

## Query order

1. `list-collections` if needed
2. `collection-indexes` then `collection-schema` then a small `find`
3. `aggregate` for distinct / counts
4. Save a **new** file under `mcp/findings/`

## Additional resources

- Collection map: [collections.md](collections.md)
- Whole flow: [../../../mcp/findings/whole-flow.md](../../../mcp/findings/whole-flow.md)
- UTM snapshot: [../../../mcp/findings/unique-utm-sources.md](../../../mcp/findings/unique-utm-sources.md)
