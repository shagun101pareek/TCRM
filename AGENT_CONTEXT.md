# Agent Context

This file is the persistent briefing for an AI coding agent working in this repository.
If a fact is not known from the files here, it is marked **Unknown / needs investigation** rather than guessed.

<!-- AUTO:LIVE-SNAPSHOT:START -->

_Last refreshed: 2026-09-02 11:57:57_

- Files indexed (secrets excluded): **51**
- JavaScript files: **15**
- n8n / config JSON under `new workflows/`: **9**
- Git repository: **no**
- `.env`: **present (2 keys, values not listed here)**

### Tree

```text
.
├── .agent/
│   ├── baseline.json
│   ├── README.md
│   └── task-start.json
├── .cursor/
│   ├── skills/
│   │   ├── telecrm-agent-workspace/
│   │   │   └── SKILL.md
│   │   └── telecrm-mongodb-mcp/
│   │       ├── collections.md
│   │       └── SKILL.md
│   └── mcp.json
├── mcp/
│   ├── findings/
│   │   ├── README.md
│   │   ├── unique-utm-sources.md
│   │   └── whole-flow.md
│   ├── server/
│   │   ├── index.js
│   │   ├── resources.js
│   │   └── tools.js
│   └── README.md
├── new workflows/
│   ├── 1-sync-webhook.json
│   ├── 2a-watcher-telecrm.json
│   ├── 2b-watcher-users.json
│   ├── 2c-watcher-appointments.json
│   ├── 2d-watcher-web-visitors.json
│   ├── 3-dashboard-to-telecrm.json
│   ├── CROSS-PLATFORM-ACTIONS.csv
│   ├── CROSS-PLATFORM-ACTIONS.md
│   ├── CROSS-PLATFORM-ACTIONS.xlsx
│   ├── EDGE-CASES.md
│   ├── FIELD-DICTIONARY.csv
│   ├── FIELD-FLOW.md
│   ├── FIELD-FLOW.png
│   ├── lead_temperature_workflow_corrected_v2.json
│   ├── main prod.json
│   ├── mermaid-png-config.json
│   ├── new-telecrm-field-flow.mmd
│   └── STATUS-MAPPING.md
├── scripts/
│   ├── lib/
│   │   └── common.js
│   ├── check-status.js
│   ├── detect-changes.js
│   ├── inspect-repo.js
│   ├── README.md
│   ├── snapshot-baseline.js
│   ├── start-mcp.js
│   ├── update-changelog.js
│   ├── update-context.js
│   └── validate.js
├── .env  (present, contents hidden)
├── .env.example
├── .gitignore
├── AGENT_CHANGELOG.md
├── AGENT_CONTEXT.md
├── MCP.md
├── new-telecrm-watcher.js
├── new-telecrm-webhook.js
├── package.json
└── reconcile-telecrm-stage.js
```

<!-- AUTO:LIVE-SNAPSHOT:END -->## Project Overview

This folder is **not a product UI**. It is the Healthflex / Stance working set for joining **TeleCRM** (call-centre CRM) with the **Stance Dashboard** (clinic ops) into a per-phone reporting document in MongoDB collection `new-telecrm`.

Three surfaces:

| Surface | Role | Source of truth |
|---|---|---|
| TeleCRM (SaaS) | Agents create and work leads | TeleCRM cloud (`lead/search`, `autoupdatelead`) |
| Stance Dashboard | Clinic lifecycle, bookings, website tracking | Mongo `users`, `appointments`, `reports`, `events`, `centers`, `web_visitors`, `web_touchpoints` |
| `new-telecrm` | Join / reporting row keyed by 10-digit phone | **Copy**. Last writer wins on overlapping fields |

Mongo collection `telecrm` is a **mirror** of CRM used as a change-detection trigger. Watchers take the phone from the mirror and **re-fetch the live lead from the TeleCRM API**. Do not treat the mirror as live CRM.

**Live vs design (MCP finding, 2 Sep 2026):** `new-telecrm` has **0 documents**. Reporting today uses `telecrm` + `crm_sync_materialized`. Watcher resume tokens in `new_telecrm_watch_state` were last updated **25 Aug 2026**.

## Tech Stack

| Layer | What is actually here |
|---|---|
| Language | Node.js (`'use strict'`, CommonJS `require`) |
| Runtime observed | Node v24 on the machine that generated this file |
| HTTP | Node `http` in `new-telecrm-webhook.js` |
| Mongo | `mongodb` driver (`MongoClient`, change streams) — required by root JS, **not declared in this folder** |
| Env loading | `dotenv` — required by root JS, **not declared in this folder** |
| n8n | Workflow JSON under `new workflows/` (sync, watchers, WF3, temperature) |
| Database | MongoDB Atlas, database `stance-dashboard` |
| External APIs | TeleCRM `lead/search` and `autoupdatelead` |
| Agent tooling | This repository MCP (`mcp/server/`, stdlib only) plus a **separate** MongoDB MCP plugin and skill `.cursor/skills/telecrm-mongodb-mcp/` |
| Tests | **None** — no test directory, no runner, no `package-lock.json` at inspection time |
| Package manager | **None at inspection time.** Root JS comments assume `node scripts/…` but the JS files live at the **repo root** |

## Repository Structure

```text
.
├── new-telecrm-webhook.js      # Sync (1) — HTTP webhook + CLI syncOne(phone)
├── new-telecrm-watcher.js      # Change streams 2a–2d → syncOne
├── reconcile-telecrm-stage.js  # Fresh-only TeleCRM stage heal (dry-run default)
├── .env                        # Secrets. Never read/print/commit values
├── new workflows/              # n8n JSON + architecture docs (PROTECTED)
├── mcp/
│   ├── findings/               # Read-only Mongo query snapshots (create new files only)
│   └── server/                 # This repository's MCP server
├── scripts/                    # Agent/repo utility scripts (stdlib)
├── AGENT_CONTEXT.md            # This file
├── AGENT_CHANGELOG.md          # Append-only agent audit trail
└── MCP.md                      # How to run the repository MCP
```

`.cursor/` holds Cursor skills and MCP client config. `.agent/` holds file-hash snapshots for change detection because **this folder is not a git repository** (as of 2 Sep 2026).

## Architecture

```text
TeleCRM cloud  ──crm-mongo-sync──►  Mongo telecrm (mirror / trigger)
       │                                    │
       │ webhook POST /webhook/telecrm      │ watcher 2a
       ▼                                    ▼
   Sync (1)  syncOne(phone)
       │  TeleCRM API lead/search
       │  + users / appointments / centers / reports / events
       │  + web_visitors / web_touchpoints
       ▼
   upsert new-telecrm     ◄── WF3 also upserts (and POSTs status+name to TeleCRM)
                              Temperature job writes temp fields only
```

Watchers **2b/2c/2d** resolve a phone from `users` / `appointments` / `web_visitors` and re-call Sync (1). They do not map status themselves.

JS watcher debounce = **1.5s per phone**. n8n watchers have **no debounce**.

Sync **never** writes `users.profileData.status`. Stance owns clinic lifecycle.

## Important Files

| Path | Role | Edit? |
|---|---|---|
| `new-telecrm-webhook.js` | `syncOne`, join, HTTP `/webhook/telecrm` and `/webhook/telecrm-status-change`, CLI `node new-telecrm-webhook.js <phone>` | Not without approval |
| `new-telecrm-watcher.js` | Change streams; `require('./new-telecrm-webhook')` | Not without approval |
| `reconcile-telecrm-stage.js` | Dry-run by default; `--apply` writes TeleCRM | Not without approval |
| `new workflows/1-sync-webhook.json` | n8n Sync (1) — **source of truth** with WF3 | Not without approval |
| `new workflows/2a`–`2d` `*.json` | n8n watchers | Not without approval |
| `new workflows/3-dashboard-to-telecrm.json` | WF3 push — **source of truth** with Sync (1) | Not without approval |
| `new workflows/lead_temperature_workflow_corrected_v2.json` | Nightly 02:00 three-question HOT/WARM/COLD from TeleCRM `lead/search` | Not without approval |
| `new workflows/main prod.json` | Combined copy of sync + dashboard push | Do not edit as a third copy |
| `new workflows/STATUS-MAPPING.md` | Two status fields, mappings | Docs; still treat as design |
| `new workflows/EDGE-CASES.md` | P0 bugs and unhandled cases | Docs |
| `new workflows/FIELD-FLOW.md` | Join-doc writers and field groups | Docs |
| `new workflows/FIELD-DICTIONARY.csv` | Every join field | Docs |
| `new workflows/CROSS-PLATFORM-ACTIONS.md` | Action → expected result matrix | Docs |
| `mcp/findings/whole-flow.md` | What Mongo actually contains (2 Sep 2026) | Create sibling findings; do not “fix” live counts in place without a new snapshot |
| `.cursor/skills/telecrm-mongodb-mcp/` | How to query Atlas via MongoDB MCP | Keep hard rules |

Usage comments inside the JS files say `node scripts/new-telecrm-webhook.js`. The files are **not** under `scripts/`; they are at the repository root. `scripts/` is for agent utilities.

## Data Flow

1. Leads are created **inside TeleCRM** (Excel, Website, Facebook, WhatsApp Cloud API, Manual, Call Logs), plus WF3 `autoupdatelead` and the temperature job.
2. `crm-mongo-sync` (not in this folder) copies CRM into Mongo `telecrm`.
3. Sync (1) builds `new-telecrm` from **API + dashboard collections**, not from mirror fields.
4. Website **UTM** lives on `web_touchpoints` / `web_visitors`. TeleCRM **does not store `utm_source`**. `lead_source` is how the CRM row was created. Do not mix them.
5. Join key: **10-digit phone**. `normPhone10` strips a leading `0` only when length is 11, and `91` only when length is 12.

## APIs / Integrations

| API | URL pattern in code | Used by |
|---|---|---|
| TeleCRM lead search | `https://next.telecrm.in/autoupdate/v2/enterprise/${ENTERPRISE_ID}/lead/search` | Sync (1) |
| TeleCRM autoupdate | `https://next-api.telecrm.in/enterprise/${ENTERPRISE_ID}/autoupdatelead` | WF3, reconcile, optional source push |
| MongoDB Atlas | via `MONGODB_URI` / `MONGODB_DB` in JS comments | webhook, watcher, reconcile |
| n8n | Hosted workflows; JSON exports live in `new workflows/` | Production automations |

Webhook HTTP (JS): `GET /health`, `POST /webhook/telecrm`, `POST /webhook/telecrm-status-change`. Default `PORT` 3000.

n8n Sync webhook path: `telecrm` (full n8n URL unknown / needs investigation).

Enterprise id appears inside `1-sync-webhook.json` as a URL path segment. Treat it as environment-specific; do not copy tokens from that file.

## Database / Storage

Primary database: **`stance-dashboard`**. Ignore `healthflex-production` unless a human asks for clinical/sensor data.

| Collection | Role (from skill + findings) |
|---|---|
| `telecrm` | CRM mirror (~17k). Phone-keyed. No UTM fields |
| `new-telecrm` | Designed join. **Live count 0** as of 2 Sep 2026 |
| `crm_sync_materialized` | Older join used for reporting (~17k; 6,545 with dashboard `userId`) |
| `new_telecrm_watch_state` | JS watcher resume tokens |
| `users` / `appointments` / `centers` / `reports` / `events` | Stance |
| `web_visitors` / `web_touchpoints` | Website identity + UTM |

Mongo access from Cursor is via the **MongoDB MCP plugin** (read-only). This repository MCP does **not** connect to Mongo and must not be given the connection string.

## Development Setup

1. This folder had **no `package.json` / lockfile** when inspected. Root JS still `require('dotenv')` and `require('mongodb')` — those must be installed in whatever environment already runs the webhook/watcher. **Unknown / needs investigation** where that environment lives (this laptop vs a server).
2. Copy env keys into a local `.env` if running JS. **Never commit `.env`.** See Commands and the env mismatch below.
3. Atlas change streams require a replica set (Atlas qualifies).
4. For agent work: read this file, use `mcp/server` or `scripts/`, do not start production watchers from the agent MCP.

### Env mismatch (important)

JS comments expect: `MONGODB_URI`, `MONGODB_DB`, `TELECRM_ENTERPRISE_ID`, `TELECRM_API_TOKEN`, `TELECRM_AUTOUPDATE_TOKEN` (fallback `TELECRM_ASYNC_API`), `PORT`, optional `NEW_TELECRM_PUSH_SOURCE`.

The `.env` present in this folder on 2 Sep 2026 contained **only** (names, not values): `TELECRM_ASYNC_API2`, `TELECRM_SYNC_API2`.

So this working copy may not be a runnable Node deployment by itself. Unknown / needs investigation whether production env lives elsewhere.

## Commands

Agent / MCP (safe, stdlib):

```bash
node scripts/inspect-repo.js
node scripts/check-status.js
node scripts/snapshot-baseline.js --task-start
node scripts/detect-changes.js
node scripts/validate.js
node scripts/update-context.js
node scripts/update-changelog.js --title "…" --objective "…" --from-detect
node scripts/start-mcp.js          # stdio MCP; used by Cursor
node mcp/server/index.js --self-test
```

Project JS (not exposed as MCP tools; can write TeleCRM / Mongo):

```bash
node new-telecrm-webhook.js                 # HTTP server
node new-telecrm-webhook.js <phone>         # one-off sync
node new-telecrm-watcher.js                 # change streams (long-running)
node reconcile-telecrm-stage.js             # DRY RUN
node reconcile-telecrm-stage.js --apply     # WRITES TeleCRM — approval required
```

There is no `npm test`, linter, or typechecker in this folder.

## Testing

**None automated.** Validation today:

- `node --check` on `.js` files
- `JSON.parse` on `new workflows/*.json`
- MCP `--self-test`
- Manual QA script in `new workflows/CROSS-PLATFORM-ACTIONS.md` section G

Do not invent a test suite unless a human asks.

## Deployment

**Unknown / needs investigation.** This folder contains n8n JSON exports and standalone Node scripts. Hosting of n8n, the JS webhook/watcher process, and `crm-mongo-sync` is not documented here.

## Important Business Logic

- **Two status fields** on the join doc: `conversionStatus` (TeleCRM stage) and `dash_status` (Stance `users.profileData.status`). They are not 1:1.
- WF3 maps LEAD→Fresh, BOOKED_*→Session booked, ACTIVE/PACKAGE/PACKAGE_EXPIRED/DISCHARGED/INACTIVE→Converted, and **pushes** that to TeleCRM. Highest overwrite risk: any `users` save while status is LEAD can reset CRM to Fresh (including wiping In Pipeline).
- Sync `isConverted` / `hasVisitedSession` = first-visit + `isFirstAssessment` + `{PAID, INVOICE_GENERATED, VISITED}`. WF3 uses different definitions (`ACTIVE`/`PACKAGE`, and `COMPLETED`/`attended`). Last writer wins; field **shapes** also differ (`dash_centers`, `dash_firstvisitapppointment`).
- `resolveFinalUserStatus` exists in JS but the upsert **`$unset`s `final_user_status`**.
- Reconcile only heals TeleCRM **Fresh**.
- Temperature jobs score every open TeleCRM stage (including Session booked) and POST `{phone, status, temperature}` on `autoupdatelead`. Converted and Not Converted are not scored and are not pushed. Temperature-only POSTs reopen the lead to Fresh.
- Duplicate Stance users: JS prefers `web_visitors.patient_id`, else latest `updatedAt`. n8n uses `findOne` (arbitrary).
- Multiple TeleCRM leads for one phone: always `data[0]`.
- `NEW_TELECRM_PUSH_SOURCE` default **off**.

Full matrices: `STATUS-MAPPING.md`, `EDGE-CASES.md`, `CROSS-PLATFORM-ACTIONS.md`.

## Conventions

- Join key is a 10-digit phone string.
- `source[]` / `stage[]` entries use `platform` = `"telecrm"` or `"dash"` (literal, not a CRM field).
- Append to those arrays only when that platform’s attribution/status **changed**.
- MongoDB MCP work: **create new files under `mcp/findings/` only.** Never edit `new workflows/`, root `*.js`, or `.env`.
- Treat `1-sync-webhook.json` and `3-dashboard-to-telecrm.json` as n8n source of truth; do not diverge `main prod.json` separately.
- Agent changes: append `AGENT_CHANGELOG.md`; do not rewrite old entries.
- Prefer Git for diffs when it exists; otherwise `.agent/` snapshots.

## Known Edge Cases

See `new workflows/EDGE-CASES.md`. P0 highlights:

1. WF3 pushes on **any** user update, not only status change, and can **downgrade** TeleCRM.
2. n8n Sync `Aggregate Appointments` missing `alwaysOutputData` can abort the workflow when there are zero first-visit rows.
3. `isConverted` / `hasVisitedSession` mean different things in workflow 1 vs 3.

Also: phone formats that are not 10 digits after the narrow strip; dashboard-only patients (sync 404); cancelled first visits never become `Not Shown Up`; n8n `neverError: true` treats API 401/500 as “lead not found”.

## Known Issues

- Not a git repository (change tracking via `.agent/` snapshots).
- No declared Node dependencies in-repo; root JS requires `mongodb` and `dotenv`.
- JS path comments (`scripts/new-telecrm-*.js`) do not match file locations.
- `.env` key names do not match JS comment env names.
- Designed join collection `new-telecrm` empty; watchers idle since 25 Aug 2026 (finding snapshot).
- WF1 vs WF3 schema fight on several join fields.
- No CI, no tests, no linter.

## Do Not Modify Without Approval

**Files**

- `new workflows/**`
- `new-telecrm-webhook.js`
- `new-telecrm-watcher.js`
- `reconcile-telecrm-stage.js`
- `.env`

**Behaviours**

- Do not write `users.profileData.status` from TeleCRM or sync.
- Do not enable `NEW_TELECRM_PUSH_SOURCE=true`.
- Do not run `reconcile-telecrm-stage.js --apply`.
- Do not start the live webhook/watcher against production from agent tooling.
- Do not mix website `utm_source` with TeleCRM `lead_source`.
- Do not call Mongo insert / update / delete / drop (MongoDB MCP is read-only).
- Do not print, log, or commit secrets, tokens, or connection strings.
- Do not rewrite `AGENT_CHANGELOG.md` history.
- Do not overwrite unrelated uncommitted work (when Git exists).

## Agent Workflow

```text
Understand context (this file + get_do_not_modify)
     ↓
Inspect repository (scripts/inspect-repo.js or MCP get_repo_structure)
     ↓
snapshot_task_start / scripts/snapshot-baseline.js --task-start
     ↓
Inspect relevant files (docs first; protected JS/JSON only as read)
     ↓
Understand requested change
     ↓
Make minimal changes (never protected files without explicit approval)
     ↓
Run validation (scripts/validate.js)
     ↓
Inspect changes (detect-changes / git diff)
     ↓
Record changes (update-changelog.js / record_agent_change)
```

The agent should not modify files unnecessarily.

## MCP Information

Four project MCP servers plus the Cursor MongoDB plugin. Do not confuse them.

| MCP | Purpose | Writes? |
|---|---|---|
| **platforms** (`mcp/platforms/index.js`) | Hub: `platforms_status` / `platforms_ping` for TeleCRM, n8n, repo; Mongo noted as plugin | No |
| **telecrm-repo** (`mcp/server/index.js`) | Understand *this folder*, validate JS/JSON, track agent changes | Append `AGENT_CHANGELOG.md`; write `.agent/*.json` snapshots |
| **telecrm-api** (`mcp/telecrm-api/index.js`) | TeleCRM `lead/search` + Async ping (empty body) | **No** lead upserts |
| **n8n-api** (`mcp/n8n-api/index.js`) | List exported workflows; optional live REST | **No** workflow execute |
| **MongoDB plugin** (`plugin-mongodb-mongodb`) | Query Atlas `stance-dashboard` (Stance + CRM mirror + join) | **No.** Findings as new files under `mcp/findings/` |

Cursor config: `.cursor/mcp.json`. Enable each server in Settings → MCP.

Start hub: `node mcp/platforms/index.js`. Repo: `node scripts/start-mcp.js`.

Docs: `MCP.md`, `mcp/README.md`, `mcp/findings/platforms.md`.
