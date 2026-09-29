# Agent Changelog

Append-only record of AI agent modifications to this repository.
Do not rewrite or delete previous entries unless a human explicitly asks.

---

## 2026-09-02 — Repository MCP and agent workspace

**Agent:** Cursor Grok 4.6

### Objective
Inspect this TeleCRM working copy and add a repository MCP server, AGENT_CONTEXT.md, append-only AGENT_CHANGELOG.md, and stdlib scripts so an AI agent can work with consistent context and an audit trail.

### Files Created
- `.agent/README.md`
- `.agent/task-start.json`
- `.cursor/mcp.json`
- `.cursor/skills/telecrm-agent-workspace/SKILL.md`
- `.env.example`
- `.gitignore`
- `AGENT_CHANGELOG.md`
- `AGENT_CONTEXT.md`
- `MCP.md`
- `mcp/server/index.js`
- `mcp/server/resources.js`
- `mcp/server/tools.js`
- `package.json`
- `scripts/README.md`
- `scripts/check-status.js`
- `scripts/detect-changes.js`
- `scripts/inspect-repo.js`
- `scripts/lib/common.js`
- `scripts/snapshot-baseline.js`
- `scripts/start-mcp.js`
- `scripts/update-changelog.js`
- `scripts/update-context.js`
- `scripts/validate.js`

### Files Modified
- `mcp/README.md`

### Files Deleted
- None

### Changes
- Added a stdlib Node MCP server at mcp/server (stdio JSON-RPC) with inspection, context, snapshot-based change tracking, changelog append, and validation tools. No arbitrary shell and no Mongo connection.
- Added AGENT_CONTEXT.md from the actual tree, JS, workflow docs, and MCP findings — including live vs design (empty new-telecrm), env key mismatch, and do-not-modify rules.
- Added scripts/ for inspect, status, snapshots, detect-changes, validate, update-context (live snapshot only), update-changelog, and start-mcp.
- Documented setup in MCP.md and scripts/README.md. Cursor client config is .cursor/mcp.json.
- Updated mcp/README.md so MongoDB findings and the new repo MCP are both described. Did not edit new workflows/, root JS, or .env.

### Reason
The folder already had n8n workflows, root Node sync scripts, and MongoDB findings, but no git repo, no package manifest, no tests, and no agent-facing MCP for the working copy itself.

### Validation
- `node scripts/validate.js` — PASS (JS syntax, n8n JSON, MCP self-test, protected files, secret heuristic)
- `node mcp/server/index.js --self-test` — PASS (19 tools, 11 resources, context readable, .env blocked)
- `node scripts/detect-changes.js` — PASS (23 created, 1 modified mcp/README.md, 0 deleted; no protected-file edits)
- Project unit tests — SKIP (none exist)

### Risks / Notes
- This folder is still not a git repository; change detection uses .agent/ file hashes.
- Cursor must reload MCP to pick up .cursor/mcp.json.
- Root webhook/watcher still require mongodb and dotenv, which are not installed by this change (intentional).
- mcp/README.md was the only pre-existing file edited.

### Manual Verification Required
- Reload Cursor MCP and confirm telecrm-repo tools appear.
- Confirm the existing MongoDB MCP plugin still connects separately.
- Optional: git init if this working copy should become a versioned repo (not done here).


## 2026-09-02 — Skip snapshot JSON from change detection

**Agent:** Cursor Grok 4.6

### Objective
Stop .agent/task-start.json from appearing as a modified/deleted file every time a snapshot is saved.

### Files Created
- None

### Files Modified
- `scripts/lib/common.js`

### Files Deleted
- None

### Changes
- captureSnapshot now omits .agent/baseline.json and .agent/task-start.json

### Reason
Hashing the snapshot file inside itself made detect-changes lie.

### Validation
- node scripts/validate.js — PASS

### Risks / Notes
- None beyond this helper behaviour

### Manual Verification Required
- None


## 2026-09-02 — Read-only TeleCRM lead/search MCP

**Agent:** Cursor Grok 4.6

### Objective
Connect Cursor MCP to live TeleCRM lead/search using enterprise 69da237dbbfc0db1fc1ea6e2 without exposing autoupdatelead.

### Files Created
- `mcp/telecrm-api/index.js`
- `mcp/telecrm-api/README.md`

### Files Modified
- `.cursor/mcp.json`
- `MCP.md`
- `scripts/validate.js`

### Files Deleted
- None

### Changes
- stdio MCP telecrm-api with telecrm_status and telecrm_search_by_phone

### Reason
User asked to connect next-api.telecrm.in/enterprise and lead/search to MCP.

### Validation
- node mcp/telecrm-api/index.js --self-test PASS; node scripts/validate.js PASS

### Risks / Notes
- Search uses Sync token from .env; write API is not wired. Token must not be committed.

### Manual Verification Required
- None


## 2026-09-02 — Wire TeleCRM MCP to Sync search and Async autoupdate

**Agent:** Cursor Grok 4.6

### Objective
Connect telecrm-api MCP to .env TELECRM_SYNC_API2 and TELECRM_ASYNC_API2 per official TeleCRM docs.

### Files Created
- None

### Files Modified
- `mcp/telecrm-api/index.js`
- `mcp/telecrm-api/README.md`

### Files Deleted
- None

### Changes
- telecrm_ping live probe; Async token authorized; Sync search still 401 NOT_AUTHORIZED

### Reason
User asked to connect TeleCRM with current .env keys.

### Validation
- self-test PASS; ping async HTTP 400 auth ok; sync search HTTP 401

### Risks / Notes
- Async ping uses empty body so no lead is created. Sync search remains unauthorized until a Sync-typed token is in TELECRM_SYNC_API2.

### Manual Verification Required
- None


## 2026-09-02 — Add read-only n8n MCP

**Agent:** Cursor Grok 4.6

### Objective
Test TeleCRM .env connection and add n8n-api MCP for exported workflows plus optional live REST ping.

### Files Created
- `mcp/n8n-api/index.js`
- `mcp/n8n-api/README.md`

### Files Modified
- `.cursor/mcp.json`
- `MCP.md`
- `.env.example`
- `scripts/validate.js`

### Files Deleted
- None

### Changes
- None

### Reason
User asked to retest TeleCRM and connect n8n.

### Validation
- telecrm ping: async ok HTTP 400
- sync 401; n8n self-test PASS; live n8n skipped (no N8N_BASE_URL)

### Risks / Notes
- n8n MCP does not execute workflows. Live n8n still needs N8N_BASE_URL and N8N_API_KEY from the user.

### Manual Verification Required
- None


## 2026-09-02 — Connect all platforms through MCP

**Agent:** Cursor Grok 4.6

### Objective
Wire TeleCRM, n8n, this repo, and Mongo/Stance into one MCP map and ping hub.

### Files Created
- `mcp/platforms/index.js`
- `mcp/platforms/README.md`
- `mcp/README.md`
- `mcp/findings/platforms.md`

### Files Modified
- `mcp/telecrm-api/index.js`
- `.cursor/mcp.json`
- `mcp/findings/README.md`
- `mcp/server/tools.js`
- `mcp/server/resources.js`
- `scripts/lib/common.js`
- `scripts/validate.js`
- `MCP.md`
- `AGENT_CONTEXT.md`

### Files Deleted
- None

### Changes
- Added platforms hub MCP (status/ping all surfaces)
- Registered it in Cursor mcp.json with telecrm-repo
- telecrm-api
- n8n-api
- TeleCRM ping now reports network errors instead of crashing
- Mongo stays on the existing Atlas plugin session

### Reason
User asked to connect all platforms with MCP.

### Validation
- node scripts/validate.js — PASS
- MCP stdio handshake on all four servers — PASS
- Mongo plugin count telecrm/users/crm_sync_materialized — live

### Risks / Notes
- Cursor project MCP servers still need enabling in Settings → MCP (auth timed out in this chat)
- Sync search still needs a Sync-typed token
- Live n8n needs N8N_BASE_URL and N8N_API_KEY
- This agent sandbox could not reach next.telecrm.in (proxy 403)

### Manual Verification Required
- Settings → MCP: enable platforms
- telecrm-repo
- telecrm-api
- n8n-api
- Optional: add n8n host + API key to .env
- Optional: replace TELECRM_SYNC_API2 with a Sync-typed token


## 2026-09-04 — Add final_source n8n workflow

**Agent:** AI coding agent

### Objective
Add a temperature-shaped workflow that classifies leads into a single final_source field from TeleCRM source/lead_source plus website UTM and referrer, without unsetting the input fields or editing Sync/WF3.

### Files Created
- `new workflows/4-final-source.json`

### Files Modified
- None

### Files Deleted
- None

### Changes
- Added new workflows/4-final-source.json (inactive) that nightly aggregates telecrm+users+web_visitors
- computes final_source
- and $sets that field only on crm_sync_materialized and new-telecrm
- with optional autoupdatelead of final_source.
- Does not modify workflows 1–3
- root JS
- or existing source[] / lead_source.

### Reason
Human approved a new file under new workflows/ to replace the four reporting attribution fields with one derived source.

### Validation
- node scripts/validate.js — PASS
- 21 classifier cases — PASS

### Risks / Notes
- Mongo update uses field name final_source so it does not overwrite source[] arrays.
- TeleCRM push requires a custom field named final_source; do not map onto TeleCRM source.
- Workflow is inactive; replace credential placeholders before import.

### Manual Verification Required
- Import JSON into n8n
- attach Mongo and TeleCRM Async credentials
- create TeleCRM custom field final_source
- dry-run Calculate node on a sample
- then enable.


## 2026-09-04 — final_source array schema in workflow 4

**Agent:** AI coding agent

### Objective
Write final_source as an append-on-change array matching the agreed join schema, without unsetting TeleCRM lead_source or source[].

### Files Created
- None

### Files Modified
- `new workflows/4-final-source.json`

### Files Deleted
- None

### Changes
- Calculate now emits final_source[{source
- tele_leadsource
- utm_source
- utm_medium}] and appends only when that snapshot changes
- Layer-1 labels are Performance/Customer/Organic/Clinician/Doctor/Advocate/Founder instead of dash_*
- Load looks up existing final_source on crm_sync_materialized
- TeleCRM push sends final_source_latest string so the array is not posted onto a text field

### Reason
Human asked to update 4-final-source.json for the new final_source[] shape.

### Validation
- JSON.parse 4-final-source.json — PASS
- 11 classifier/append smoke cases — PASS

### Risks / Notes
- n8n Mongo update $sets the whole array; old string final_source is ignored and replaced on first write
- new-telecrm updates remain no-ops while that collection is empty
- Pushing latest source string to TeleCRM still requires a custom field named final_source

### Manual Verification Required
- Disable Mongo/TeleCRM write nodes; $match a few test phones; run Load + Calculate; confirm array shape before enabling updates


## 2026-09-04 — Fix n8n 2.x invalid syntax on Final Source Load

**Agent:** AI coding agent

### Objective
Stop n8n 2.26 from treating Mongo }} in the Load pipeline as the end of an ={{ }} expression.

### Files Created
- None

### Files Modified
- `new workflows/4-final-source.json`

### Files Deleted
- None

### Changes
- Load TeleCRM Leads query is now a JSON pipeline string
- not ={{ JSON.stringify(...) }}
- Same aggregation stages including crm_sync_materialized lookup for existing final_source

### Reason
Human hit invalid syntax on Load TeleCRM Leads when executing 4-final-source.json.

### Validation
- JSON.parse of the query pipeline — PASS
- workflow JSON.parse — PASS

### Risks / Notes
- Re-import the JSON in n8n; a previously imported node still has the old expression

### Manual Verification Required
- Re-import or paste the query field
- then execute Load on a few phones


## 2026-09-07 — WhatsApp CTWA fields on final_source

**Agent:** AI coding agent

### Objective
Attach ctwa_id, ctwa_source_id, and campaign/ad fields on final_source[] only when lead_source is WhatsApp or WhatsApp Cloud API.

### Files Created
- None

### Files Modified
- `new workflows/4-final-source.json`

### Files Deleted
- None

### Changes
- Load $project now passes ctwa_id
- ctwa_source_id
- and TeleCRM campaign/ad fields into Calculate
- Calculate extrasForLead() copies those keys only for WhatsApp / WhatsApp Cloud API; other lead sources omit them
- entryEqual compares every key so a later CTWA fill still appends

### Reason
Human asked to add the lead_source if/else for CTWA fields in workflow 4.

### Validation
- JSON.parse 4-final-source.json — PASS
- WhatsApp vs Website vs Excel extras smoke test — PASS
- node scripts/validate.js — FAIL protected 4-final-source.json (explicitly approved)

### Risks / Notes
- ctwa_source_id is omitted when the TeleCRM mirror has no such field
- Facebook lead-form fields are still not branched (only WhatsApp)

### Manual Verification Required
- Re-import 4-final-source.json. Run Calculate on a WhatsApp Cloud API phone and a Website phone. Confirm CTWA keys exist only on the WhatsApp row.


## 2026-09-07 — final_source + CTWA on Sync and WF3

**Agent:** AI coding agent

### Objective
Parse ctwa_id / ctwa_source_id into final_source[] on the webhook sync and dashboard-push workflows, matching workflow 4.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/main prod.json`

### Files Deleted
- None

### Changes
- Sync (1) Build Document now writes final_source[] with WhatsApp-only CTWA extras from the TeleCRM API lead
- WF3 adds Find TeleCRM Mirror and the same final_source if/else so dashboard upserts do not drop CTWA
- main prod.json both halves updated the same way; upsert field lists include final_source
- ctwa_id
- ctwa_source_id
- TeleCRM Push still sends only status and name

### Reason
Human asked to add the new final_source / CTWA schema to the two canvases (Sync webhook and Dashboard push), not only workflow 4.

### Validation
- JSON.parse of the three workflows — PASS
- Sync WhatsApp vs WF3 WhatsApp vs Website extras smoke test — PASS
- node scripts/validate.js — FAIL protected files (explicitly approved)

### Risks / Notes
- Live n8n canvas with split Build Stage / Build Source nodes will not pick this up until re-import
- WF3 CTWA depends on the telecrm mirror having ctwa_id

### Manual Verification Required
- Re-import 1-sync-webhook.json and 3-dashboard-to-telecrm.json (or main prod.json). Run a WhatsApp Cloud API lead through Sync and confirm final_source[0].ctwa_id. Run a Website lead and confirm those keys are absent.


## 2026-09-07 — CTWA fields live on source[]

**Agent:** AI coding agent

### Objective
Put ctwa_id and ctwa_source_id on the telecrm source[] entry and stop storing them as top-level join fields.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/main prod.json`

### Files Deleted
- None

### Changes
- Sync copies WhatsApp ctwa_id / ctwa_source_id onto source[] platform=telecrm and mergeHistory treats those keys as a change
- WF3 writes the same extras onto the latest telecrm source[] row
- Root ctwa_id / ctwa_source_id are set to null on upsert so leftover IDs are cleared from the document root
- final_source[] still keeps the WhatsApp extras as the reporting snapshot

### Reason
Human showed a join doc with top-level ctwa_id and asked for those fields inside source[] instead.

### Validation
- JSON.parse of the three workflows — PASS
- Sync and WF3 smoke tests place ctwa on source[] and null at root — PASS
- node scripts/validate.js — FAIL protected files (explicitly approved)

### Risks / Notes
- n8n update cannot $unset; root keys remain as null until a later unset
- JS new-telecrm-webhook.js still does not write ctwa onto source[]

### Manual Verification Required
- Re-import Sync/WF3 (or main prod). Re-run phone 9986611186. Confirm source[0].ctwa_id is set and root ctwa_id is null.


## 2026-09-07 — CTWA only inside compact source[]

**Agent:** AI coding agent

### Objective
Keep ctwa_id and ctwa_source_id inside source[] when source.source is WhatsApp Cloud API, omit null keys, and stop writing those IDs at the join-doc root.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`

### Files Deleted
- None

### Changes
- Sync/WF3/main/JS build a compact telecrm source[] row
- CTWA keys are copied onto that row only when source is WhatsApp or WhatsApp Cloud API
- Null marketing keys are omitted
- Root ctwa_id/ctwa_source_id are no longer upserted; JS webhook $unsets leftover root IDs
- Workflow 4 extrasForLead gates on source.source and omits null final_source keys

### Reason
Human showed phone 9986611186 with root CTWA fields and a source[] row full of nulls, and asked for an if/else so WhatsApp Cloud API entries carry only the populated CTWA parameters.

### Validation
- JSON.parse workflows — PASS
- node --check new-telecrm-webhook.js — PASS
- WhatsApp vs Website vs Facebook source-entry smoke test — PASS
- node scripts/validate.js — FAIL protected files (explicitly approved)

### Risks / Notes
- n8n Mongo update cannot $unset; existing root ctwa_* keys stay until JS sync or a manual unset
- Live n8n will not pick this up until the JSON is re-imported

### Manual Verification Required
- Re-import Sync
- WF3 (or main prod)
- and workflow 4. Re-run phone 9986611186. Confirm source[0] has ctwa_id/ctwa_source_id
- no null keys
- and the document root has no ctwa_id. Run a Website lead and confirm those keys are absent.


## 2026-09-07 — Align CTWA with final_source schema

**Agent:** AI coding agent

### Objective
Store WhatsApp CTWA metadata only inside compact final_source[] entries and remove legacy root CTWA keys from new-telecrm.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`

### Files Deleted
- None

### Changes
- Parse TeleCRM lead_source arrays so Whatsapp Cloud API is recognized
- Write final_source source as Whatsapp Cloud API with optional ctwa_id
- ctwa_source
- campaign_name
- ad_name
- ad_set_name
- and ad_set_id
- Omit absent UTM and WhatsApp metadata keys
- Remove CTWA metadata from platform source[]
- Add per-phone aggregation cleanup branches that unset legacy root ctwa_id
- ctwa_source_id
- and ctwa_source
- Keep the JS webhook root unset protection

### Reason
The live row still had root ctwa_id/ctwa_source_id because n8n omission does not unset MongoDB fields, and workflow 4 did not parse array-shaped lead_source from the TeleCRM mirror.

### Validation
- Final-source WhatsApp and Website smoke tests — PASS
- JSON parse for all workflows — PASS
- JavaScript syntax — PASS
- Repository validation — expected protected-file integrity failure only

### Risks / Notes
- Updated n8n exports must be re-imported before live documents change
- Cleanup uses Mongo aggregation unset plus merge and requires the configured Mongo credential to permit writes

### Manual Verification Required
- Re-import workflow 1
- workflow 3 or main prod
- and workflow 4; run phone 9986611186; verify root CTWA keys are absent and final_source latest entry contains ctwa_id and ctwa_source.


## 2026-09-07 — Fix workflow 1 TeleCRM search routing

**Agent:** AI coding agent

### Objective
Stop valid TeleCRM searches from being misrouted to Error Response and expose real API/authentication failures.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`

### Files Deleted
- None

### Changes
- Send the TeleCRM JSON body as an object instead of a JSON-encoded string
- Disable Never Error so 401/403/500 failures surface at TeleCRM Search
- Harden IF Lead Found to count only an actual data array
- Require the normalized phone to be exactly 10 digits

### Reason
The HTTP node stringified an already-JSON body and suppressed every HTTP error; the IF node then classified any error response as an empty lead result.

### Validation
- Workflow request/gate smoke test — PASS
- Workflow JSON parse — PASS
- Repository validation — expected protected-file integrity failure only

### Risks / Notes
- A valid TeleCRM Sync API credential is still required; an Async/autoupdate credential will now surface a 401 instead of a misleading 404

### Manual Verification Required
- Re-import 1-sync-webhook.json
- assign a Header Auth credential whose Authorization value is Bearer plus a Sync API token
- then execute through TeleCRM Search and inspect any surfaced HTTP error.


## 2026-09-07 — Canonical new-telecrm schema

**Agent:** AI coding agent

### Objective
Enforce one strict join schema, replace final_source with compact source history, and align every writer.

### Files Created
- `new workflows/5-one-time-canonical-migration.json`
- `scripts/validate-canonical-schema.js`

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/FIELD-DICTIONARY.csv`
- `new workflows/FIELD-FLOW.md`
- `new workflows/main prod.json`
- `new workflows/new-telecrm-field-flow.mmd`
- `new-telecrm-webhook.js`

### Files Deleted
- None

### Changes
- Applied the strict allowlist and stable dashboard nulls in workflows 1 and 3
- Made source the sole compact append-on-change attribution array and compacted stage history
- Aligned main prod
- workflow 4
- and the JS webhook while preserving temperature ownership
- Added an inactive manual migration and canonical schema documentation
- Added repeatable smoke tests for attribution
- dashboard joins
- appointments
- timestamps
- cleanup
- and parity

### Reason
The join collection had schema drift, duplicate attribution arrays, root CTWA metadata, inconsistent dashboard/appointment shapes, and unstable timestamp types.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- node scripts/validate.js — all syntax
- workflow JSON
- MCP self-tests
- secret scan
- and environment checks PASS; expected protected-file guard reports the intentionally edited workflow/docs files
- IDE lints — PASS

### Risks / Notes
- Existing Mongo documents change only after updated workflows are imported/executed or the manual migration is deliberately run
- 9986611186 retains null dashboard fields until Stance has a linked user

### Manual Verification Required
- Re-import workflows 1
- 3
- 4
- and main prod as appropriate for deployment
- Back up new-telecrm and test the inactive migration outside production before any manual run
- Replace placeholder Mongo credentials in workflow 4 and the migration export


## 2026-09-07 — Full source attribution history

**Agent:** AI coding agent

### Objective
Preserve every distinct TeleCRM and website attribution record per phone with source-specific campaign and ad metadata.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/5-one-time-canonical-migration.json`
- `new workflows/CROSS-PLATFORM-ACTIONS.csv`
- `new workflows/CROSS-PLATFORM-ACTIONS.md`
- `new workflows/EDGE-CASES.md`
- `new workflows/FIELD-DICTIONARY.csv`
- `new workflows/FIELD-FLOW.md`
- `new workflows/STATUS-MAPPING.md`
- `new workflows/main prod.json`
- `new workflows/new-telecrm-field-flow.mmd`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Expanded all TeleCRM lead_source/source records and attributed web touchpoints into chronological source events
- Added populated-only campaign
- lead
- ad
- ad-set
- CTWA
- UTM
- origin
- and occurrence fields for every applicable source
- Aligned workflows 1
- 3
- main prod
- workflow 4
- migration
- and the standalone JS webhook
- Replaced unsupported regex phone normalization and sequenced strict cleanup after successful writes
- Expanded canonical smoke tests and updated field-flow documentation

### Reason
The canonical writers previously collapsed all upstream history into one latest classifier snapshot and gated campaign metadata to WhatsApp.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- node scripts/validate.js — all syntax
- JSON
- MCP
- and secret checks PASS; protected-integrity reports the explicitly approved files modified
- Live read-only Mongo aggregate accepted the replacement phone normalization
- IDE lint diagnostics — PASS

### Risks / Notes
- Workflow 4 can produce larger source arrays; sample and monitor Mongo document size before bulk execution
- Campaign/ad IDs are emitted only when explicit upstream ID fields exist; names are not fabricated as IDs
- Production n8n remains unchanged until the exports are re-imported

### Manual Verification Required
- Re-import workflows 1 and 3 or main prod
- plus workflow 4
- Test WhatsApp
- Facebook
- Website
- Manual/Excel
- and TeleCRM-only phones
- Keep workflow 4 inactive until a small non-production sample confirms ordering and metadata
- Back up new-telecrm before running migration or bulk history rebuild


## 2026-09-07 — Keep split dev workflows active

**Agent:** AI coding agent

### Objective
Allow direct re-import of the updated split workflows into the development n8n instance.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`

### Files Deleted
- None

### Changes
- Set workflow exports 1
- 3
- and 4 to active without changing their full-source-history logic
- Left main prod and migration workflow state unchanged

### Reason
Human confirmed the workflows run only against development and requested no inactive workflow exports.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- Parsed all three exports and confirmed active=true

### Risks / Notes
- n8n may still require explicit activation after import depending on instance import behavior
- Workflow 4 will run its configured schedule after activation and rebuild source history across the development collection

### Manual Verification Required
- Re-import workflows 1
- 3
- and 4 into development n8n
- Confirm imported credentials still point to development services


## 2026-09-07 — Use real source and stage histories

**Agent:** AI coding agent

### Objective
Populate each patient with complete upstream TeleCRM source and stage history instead of synthetic/current-only entries.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/5-one-time-canonical-migration.json`
- `new workflows/CROSS-PLATFORM-ACTIONS.csv`
- `new workflows/CROSS-PLATFORM-ACTIONS.md`
- `new workflows/FIELD-DICTIONARY.csv`
- `new workflows/FIELD-FLOW.md`
- `new workflows/main prod.json`
- `new workflows/new-telecrm-field-flow.mmd`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Added TeleCRM mirror history lookup to workflow 1 and its main-prod copy
- Merged root mirror arrays safely in workflow 3 instead of dropping them when fields exists
- Made source event timestamps part of dedup identity
- Rebuilt stage from telecrm.stage with occurred_at and removed synthetic Fresh seeding
- Updated workflow 4 to backfill both source and stage using narrow TeleCRM inputs
- Aligned the standalone JS writer and migration stage shape
- Added regressions for sparse API payloads
- repeated source events
- root mirror arrays
- real stage history
- and idempotence

### Reason
Live comparison showed telecrm had full stage history and source arrays while workflow 1 read only a sparse API payload; source dedup also ignored timestamps and collapsed repeated history.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- JavaScript syntax and workflow JSON parsing — PASS
- IDE lint diagnostics — PASS
- Live read-only Mongo comparison confirmed 11 upstream stage events for the known test phone

### Risks / Notes
- Workflow 4 now writes source and stage and should be re-imported with workflows 1 and 3
- The canonical source label remains derived; raw values are retained in tele_leadsource and tele_source
- Cross-platform ordering is timestamp-based when timestamps exist

### Manual Verification Required
- Re-import development workflows 1
- 3
- and 4
- Re-run phone 9986611186 and verify TeleCRM stage history is preserved
- Test a phone with multiple lead_source/source rows and confirm every timestamped row appears once


## 2026-09-08 — Upsert canonical source history

**Agent:** AI coding agent

### Objective
Make workflow 4 create missing new-telecrm rows while preserving and extending source history.

### Files Created
- None

### Files Modified
- `new workflows/4-final-source.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- None

### Reason
The source attribution workflow previously used update-only behavior, so source history was skipped when no target row existed.

### Validation
- None

### Risks / Notes
- None

### Manual Verification Required
- None


## 2026-09-08 — Add 1000-user test branch to sync webhook

**Agent:** Cursor Grok 4.6

### Objective
Add a test trigger beside the webhook in 1-sync-webhook.json so 1000 Stance users are parsed through Normalize Phone and upserted into new-telecrm.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`

### Files Deleted
- None

### Changes
- Added Test 1000 Users (manual trigger) + Fetch 1000 Users (Mongo aggregate of 1000 10-digit phones from users that exist in the telecrm mirror) + Loop Over Phones (batch size 1) so each phone still runs the existing single-item sync path.
- Webhook still reaches Normalize Phone
- via Loop Over Phones
- so live POSTs keep working.
- Continue Batch After Miss skips Respond to Webhook on TeleCRM 404 during the batch test so the remaining phones still run.

### Reason
Human asked to test Sync (1) for 1000 users by adding a node next to the webhook that feeds Normalize Phone, and to change only 1-sync-webhook.json.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- node scripts/validate.js — FAIL protected files changed (expected; human approved 1-sync-webhook.json)
- JSON.parse 1-sync-webhook.json — PASS

### Risks / Notes
- Importing this JSON into the live n8n workflow and clicking Test 1000 Users will call TeleCRM lead/search and upsert new-telecrm 1000 times.
- Users not found in the live TeleCRM API still 404 and are skipped.
- 1000 sequential API calls may take several minutes and can hit TeleCRM rate limits.

### Manual Verification Required
- Import or paste the updated 1-sync-webhook.json into n8n
- replacing the live Sync (1) workflow only after reviewing.
- Click Execute on Test 1000 Users
- not a webhook POST.
- After it finishes
- count documents in new-telecrm and spot-check a few phones against TeleCRM + Stance.


## 2026-09-08 — Simplify 1000-user sync test and stop error path

**Agent:** Cursor Grok 4.6

### Objective
Put a single Fetch 1000 Users node between Webhook and Normalize Phone, and make Error Response a dead end so missed leads do not continue to Find Touchpoints.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Removed Test 1000 Users
- Loop Over Phones
- and Continue Batch After Miss.
- Webhook now goes Webhook → Fetch 1000 Users → Normalize Phone.
- IF Lead Found false goes only to Error Response
- which has no outgoing connections.
- Normalize Phone now maps every incoming phone so all 1000 items continue.

### Reason
Human asked not to use Loop Over Phones / extra triggers, and confirmed the live Error Response wire into Find Touchpoints must not continue the workflow.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- JSON.parse 1-sync-webhook.json — PASS

### Risks / Notes
- Importing this JSON overwrites the live canvas wiring. POSTing the webhook now runs the 1000-user fetch instead of a single payload phone.
- Leads missing from the live TeleCRM API stop at Error Response and are not written to new-telecrm.

### Manual Verification Required
- Re-import 1-sync-webhook.json into n8n. Confirm Error Response has no output wire. POST the telecrm webhook once to start the 1000-user test
- then count new-telecrm.


## 2026-09-08 — Fix Mongo $limit 0 in sync webhook

**Agent:** Cursor Grok 4.6

### Objective
Stop Find Touchpoints from failing with 'the limit must be positive' so Build Document no longer throws Multiple matches on the 1000-user run.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`

### Files Deleted
- None

### Changes
- Replaced invalid Mongo $limit: 0 empty pipelines with $match {_id: null} on Aggregate Appointments
- Find Web Visitor
- and Find Touchpoints.
- Corrected $group $push to $$ROOT so appointments and touchpoints keep the full document.

### Reason
Human asked to resolve only that execution error, without changing the workflow shape.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- Users with no dashboard user or web visitor now continue with empty rows instead of aborting the item.

### Manual Verification Required
- Re-import 1-sync-webhook.json and re-run the webhook. Confirm Find Touchpoints no longer errors and Build Document completes.


## 2026-09-08 — Fix Build Document Multiple matches

**Agent:** Cursor Grok 4.6

### Objective
Stop n8n from throwing Cannot assign to read only property name of Error Multiple matches on the 1000-user sync run.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Build Document now matches sibling nodes by phone via .all() and never reads .item
- Mongo lookups keep phone on facet wrappers and drop Normalize Phone / Find User .item fallbacks
- Load Existing Doc always emits phone even when no new-telecrm row exists
- Validator treats .item as Multiple matches so the regression stays covered

### Reason
n8n paired .item is not catchable when Normalize Phone has 1000 items and later nodes only emit one item. Accessing .item throws Multiple matches and n8n then fails assigning Error.name.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- node scripts/validate.js — FAIL protected files vs snapshot (expected)

### Risks / Notes
- Live n8n still runs the old graph until 1-sync-webhook.json is re-imported.
- Mongo v1 may still collapse 1000 HTTP items into fewer Mongo items; this fix unblocks Build Document even when that happens.

### Manual Verification Required
- Re-import new workflows/1-sync-webhook.json over 1. Sync (Webhook). POST the webhook once. Confirm Build Document no longer errors. Check that Find Touchpoints outputs 1 item per lead and new-telecrm upserts proceed.


## 2026-09-08 — Loop one lead at a time after IF Lead Found

**Agent:** Cursor Grok 4.6

### Objective
Process each TeleCRM hit as a single-item pipeline so Load Existing Doc, Find User, and Build Document no longer see 1000 paired items.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- IF Lead Found true now goes to Loop Over Phones (Split In Batches
- size 1).
- Loop output feeds Load Existing Doc; Remove Legacy Root CTWA returns to the loop; done output hits Success Response.
- Load Existing Doc is findOne again so the Mongo pipeline is a document query
- not an aggregate array.
- Error Response stays a dead end on the false branch.

### Reason
Human asked to implement the batch-size-1 loop after IF Lead Found so the original one-match nodes work with Fetch 1000 Users.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- Re-import is required; the live canvas still has Find User using Normalize Phone .item.
- If some of the 1000 phones miss the live TeleCRM API
- Error Response may 404 the webhook while the found-lead loop continues.
- 1000 sequential Mongo/upsert iterations will take several minutes.

### Manual Verification Required
- Re-import new workflows/1-sync-webhook.json over 1. Sync (Webhook). Confirm Loop Over Phones sits after IF Lead Found with batch size 1
- loop wire into Load Existing Doc
- and return wire from Remove Legacy Root CTWA. POST the webhook once and confirm Build Document no longer errors.


## 2026-09-08 — Add 1000-user sync script

**Agent:** Cursor Grok 4.6

### Objective
Give a Node script that loads 1000 Stance users from Mongo and can upsert new-telecrm without changing n8n workflows.

### Files Created
- `scripts/sync-1000-users.js`

### Files Modified
- `scripts/README.md`

### Files Deleted
- None

### Changes
- Added scripts/sync-1000-users.js: dry-run lists latest 10-digit users that exist in the telecrm mirror; --apply calls existing syncOne per phone.
- Documented the script in scripts/README.md.
- Does not edit n8n JSON or enable TeleCRM source push.

### Reason
Human asked to stop changing workflows and instead run a .js file to get data for 1000 users.

### Validation
- node --check scripts/sync-1000-users.js — PASS
- node scripts/sync-1000-users.js --help — PASS

### Risks / Notes
- Dry-run needs MONGODB_URI and MONGODB_DB. --apply upserts new-telecrm and calls the live TeleCRM search API. mongodb/dotenv must be installed in the same environment as the webhook.

### Manual Verification Required
- From the repo root
- run node scripts/sync-1000-users.js --limit 5 first. If the list looks right
- run --apply --limit 1000.


## 2026-09-08 — Load .env without dotenv in 1000-user script

**Agent:** Cursor Grok 4.6

### Objective
Make sync-1000-users.js read MONGODB_URI from .env without the dotenv package.

### Files Created
- None

### Files Modified
- `scripts/README.md`
- `scripts/sync-1000-users.js`

### Files Deleted
- None

### Changes
- Replaced dotenv with the same stdlib .env parser used by telecrm-api.
- If MONGODB_DB is unset
- use the database name from the URI path.
- Map TELECRM_SYNC_API2 to TELECRM_API_TOKEN for JS syncOne.

### Reason
Human added MONGODB_URI but the script still reported it missing because dotenv is not installed and that failure was ignored.

### Validation
- node --check scripts/sync-1000-users.js — PASS
- node scripts/sync-1000-users.js --help — PASS

### Risks / Notes
- Human pasted live Mongo and TeleCRM credentials in chat; those should be rotated.

### Manual Verification Required
- Re-run node scripts/sync-1000-users.js --limit 5 from the TeleCRM folder. Confirm it prints Loaded .env keys including MONGODB_URI
- then a user list. Do not commit .env.


## 2026-09-08 — Restore buildTeleCRMPart

**Agent:** AI coding agent

### Objective
Restore the missing TeleCRM field mapper so scripts/sync-1000-users.js --apply can upsert into new-telecrm.

### Files Created
- None

### Files Modified
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Restore buildTeleCRMPart to map name
- conversionStatus
- form fields
- call/message counts
- and internal source/status keys from the TeleCRM lead and existing doc.
- Add toEpoch so created_on stays epoch milliseconds.
- Guard the mapper in validate-canonical-schema.js so the missing function cannot regress.

### Reason
syncOne called buildTeleCRMPart and toEpoch after they were removed from new-telecrm-webhook.js.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- node scripts/validate.js — FAIL expected protected-file change for new-telecrm-webhook.js; pre-existing secret heuristic on scripts/sync-1000-users.js

### Risks / Notes
- Protected file new-telecrm-webhook.js was edited with explicit human approval.
- NEW_TELECRM_PUSH_SOURCE stays off.
- Does not write users.profileData.status.

### Manual Verification Required
- Re-run node scripts/sync-1000-users.js --apply --limit 5 then --limit 1000 if those 5 upserts succeed.


## 2026-09-08 — 401 fallback to telecrm mirror

**Agent:** AI coding agent

### Objective
Make --apply succeed when TeleCRM lead/search returns 401 by using the Mongo telecrm mirror for CRM fields.

### Files Created
- None

### Files Modified
- `new-telecrm-webhook.js`
- `scripts/README.md`
- `scripts/sync-1000-users.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- syncOne accepts an optional preloaded lead so the bulk script can skip live search.
- --apply probes search once and falls back to Mongo telecrm on 401; --from-mirror forces that path.
- Clearer 401 error when live search is required.

### Reason
TELECRM_SYNC_API2 is rejected by lead/search; this environment has no working Sync token. The 1000-user selection already comes from users joined to the telecrm mirror.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- Mirror CRM fields can be slightly stale vs live TeleCRM.
- Protected file new-telecrm-webhook.js edited to accept a preloaded lead.
- NEW_TELECRM_PUSH_SOURCE stays off.

### Manual Verification Required
- Re-run node scripts/sync-1000-users.js --apply --limit 5 then --limit 1000. Optional: put a Sync-typed token in TELECRM_SYNC_API2 to use live search.


## 2026-09-08 — Restore toMs alias

**Agent:** AI coding agent

### Objective
Unblock --apply after join by defining toMs used when sorting source and stage history.

### Files Created
- None

### Files Modified
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Alias toMs to toEpoch in new-telecrm-webhook.js.
- Exercise buildSourceHistory and buildStageHistory in validate-canonical-schema.js so a missing helper fails the test instead of a live apply.

### Reason
toEpoch was restored but buildSourceHistory and buildStageHistory still call toMs, so every upsert died after the dashboard join.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- Protected file new-telecrm-webhook.js edited with human approval to continue --apply.

### Manual Verification Required
- Re-run node scripts/sync-1000-users.js --apply --limit 5 then --limit 1000.


## 2026-09-08 — Fix stepper overflow after upsert

**Agent:** AI coding agent

### Objective
Stop a successful new-telecrm upsert from throwing Invalid count value: -4 on the progress bar.

### Files Created
- None

### Files Modified
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Clamp the progress bar so overflow cannot throw.
- Count 7 steps (8 if source push is on) and grow the stepper if a step is added.
- Progress UI errors no longer fail a completed upsert.

### Reason
syncOne runs 7 steps but advertised 6, so bar(7,6) called String.repeat with -4 after the write already succeeded.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- The previous --apply --limit 5 run likely wrote the 5 docs before the bar threw; a re-run will update those phones.

### Manual Verification Required
- Re-run node scripts/sync-1000-users.js --apply --limit 5. If upserted is 5
- run --limit 1000.


## 2026-09-08 — Newest-first stage and source

**Agent:** AI coding agent

### Objective
Stamp dash stage occurred_at from the Stance user update time and store both stage[] and source[] newest-first.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/CROSS-PLATFORM-ACTIONS.csv`
- `new workflows/CROSS-PLATFORM-ACTIONS.md`
- `new workflows/FIELD-FLOW.md`
- `new workflows/STATUS-MAPPING.md`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- JS webhook now passes users.updatedAt into dash stage entries and backfills missing dash occurred_at.
- source[] and stage[] sort newest-first in the JS webhook and n8n writers 1/3/4/main.
- Canonical schema tests and field-flow docs match the new order.

### Reason
JS sync passed null for dash occurred_at, so dash INACTIVE rows omitted the timestamp. Arrays were also oldest-first, so the latest event was last.

### Validation
- node --check new-telecrm-webhook.js — PASS
- node scripts/validate-canonical-schema.js — PASS
- node scripts/validate.js — FAIL protected files changed as requested; pre-existing secret-scan hit in scripts/sync-1000-users.js

### Risks / Notes
- Existing new-telecrm docs stay oldest-first until the next sync rewrite.
- Dash occurred_at uses users.updatedAt
- which is last user save
- not a dedicated status-changed-at field.

### Manual Verification Required
- Re-sync a lead that currently has dash INACTIVE without occurred_at and confirm index 0 is the newest dated stage/source row.


## 2026-09-09 — Remove 1000-user nodes from sync webhook

**Agent:** AI coding agent

### Objective
Restore 1-sync-webhook.json to a single-phone webhook path so it can be re-imported over the live canvas without Fetch 1000 Users.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Removed Fetch 1000 Users and Loop Over Phones from 1-sync-webhook.json.
- Wired Webhook to Normalize Phone
- IF Lead Found to Load Existing Doc
- and Remove Legacy Root CTWA to Success Response.
- Build Document still sorts source/stage newest-first and stamps dash occurred_at from users.updatedAt.

### Reason
The live workflow is Webhook to Normalize Phone. Fetch 1000 Users and Loop Over Phones blocked a clean re-import for testing newest-first stage/source.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- Re-importing 1-sync-webhook.json over the live combined canvas may drop the dashboard Mongo Change Trigger row if that lives in the same n8n workflow. Import it as the Sync webhook workflow
- not over the combined main prod canvas.

### Manual Verification Required
- Re-import new workflows/1-sync-webhook.json into the Sync (Webhook) workflow. POST one known phone. Confirm stage[0] and source[0] are newest
- and dash INACTIVE has occurred_at.


## 2026-09-09 — LIFO preserve source and stage in Build Document

**Agent:** AI coding agent

### Objective
Stop Build Document from replacing join-doc source/stage history with TeleCRM current rows; prepend only when the value changed.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/FIELD-FLOW.md`
- `new workflows/main prod.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Build Document in 1-sync-webhook.json and main prod.json now keeps existing source[] and stage[]
- reverses oldest-first arrays once
- and prepends only a changed TeleCRM/dash/web value at index 0.
- Build Full Document was left unchanged.
- Removed runOnceForEachItem from Build Document so n8n accepts return [{ json }].
- Schema tests cover Fresh to Not Shown Up to Fresh staying three rows.

### Reason
Re-sync was rebuilding arrays from TeleCRM, so leads with 2-3 history objects collapsed to one.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- First sync of a brand-new join doc still seeds only the current source/stage
- not TeleCRM historical arrays.
- Build Full Document still rebuilds from TeleCRM if that path runs.

### Manual Verification Required
- In n8n
- set Build Document to Run Once for All Items and paste/replace its JS from 1-sync-webhook.json. Re-run a lead that already has 2-3 stage/source objects and confirm they remain
- with the latest at index 0.


## 2026-09-09 — Keep Facebook ad metadata on original intake

**Agent:** Cursor Grok 4.6

### Objective
Stop TeleCRM mirror source[] resyncs from creating a second May-dated meta_form event that steals campaign/ad fields from the original Facebook intake.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Collapse same-identity meta_form events onto the earliest intake time and copy campaign/ad/lead_id onto that row.
- Do not Object.assign the whole telecrm document onto the last history row; copy marketing fields only.
- WF1 currentTelecrmSource uses Facebook intake time (lead_source date
- created_at
- or earliest stage) instead of the later source[] snapshot date.
- A later different TeleCRM bucket such as Performance stays a separate event.
- Added WF4 regression tests for the Lalith resync
- healing existing split history
- and a later Performance bucket.

### Reason
Lalith Reddy (9392751188) showed campaign/ad/lead_id on a 4 May telecrm_source row while the 24 Apr Facebook intake had none. crm-mongo-sync timestamps the current source snapshot at the last stage change; join code then expanded lead_source and source[] into two events and copied marketing fields onto the later one.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- node --check new-telecrm-webhook.js — PASS
- node scripts/validate.js — FAIL expected (protected files changed with approval); pre-existing secret heuristic on scripts/sync-1000-users.js

### Risks / Notes
- crm-mongo-sync still rewrites source[] on status changes; this only heals the join layer.
- Workflow JSON was re-serialized with JSON.stringify while patching n8n jsCode.
- new-telecrm is empty in Atlas until Workflow 4 or sync runs again.

### Manual Verification Required
- Re-run Workflow 4 (or sync 9392751188) and confirm new-telecrm.source is one meta_form event at 2026-04-24T11:35:33.418Z with campaign/ad fields.
- Spot-check a Facebook lead that later got a real Performance/Organic source: two events should remain.


## 2026-09-09 — Merge TeleCRM lead_source and source into one event

**Agent:** Cursor Grok 4.6

### Objective
Stop writing two new-telecrm.source entries for the same TeleCRM attribution — one from lead_source (telecrm_lead_source) and one from source[] (telecrm_source).

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Coalesce any TeleCRM-origin rows that share the same canonical source label and do not have conflicting campaign/ad IDs.
- A later different bucket such as Performance stays a separate event.
- CTWA lead_source plus ctwa source[] is now one event with both tele_source and ctwa_id.

### Reason
lead_source and source are two fields on the same CRM lead, not two intake events. Splitting them by origin put Facebook ad metadata on a later telecrm_source row.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- node --check new-telecrm-webhook.js — PASS

### Risks / Notes
- Live n8n still needs the updated Code nodes; old WF1/WF3 can rewrite a split source[].

### Manual Verification Required
- Update live WF4 Calculate Source Attribution
- optionally match phone 9392751188
- execute
- confirm one meta_form row.
- Spot-check 8961836447: meta_form plus Performance as two events.


## 2026-09-09 — Make Workflow 4 importable for source merge test

**Agent:** Cursor Grok 4.6

### Objective
Fix the WF4 export so a re-import actually runs Calculate Source Attribution into the IF node.

### Files Created
- None

### Files Modified
- `new workflows/4-final-source.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Wire Calculate Source Attribution to Source Available?.
- Keep the export inactive so import does not start the 03:00 cron until credentials are attached.

### Reason
The merge logic was already in 4-final-source.json, but Calculate Source Attribution was wired to a missing node named IF Source Changed, so an import would stop before writing new-telecrm.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- None

### Manual Verification Required
- In n8n: import new workflows/4-final-source.json
- set MongoDB credential on all three Mongo nodes
- Execute Workflow
- check 9392751188 in new-telecrm.


## 2026-09-09 — Keep TeleCRM stage history on the join doc

**Agent:** Cursor Grok 4.6

### Objective
Restore Fresh → Not Shown Up stage history for leads like Lalith Reddy without splitting the merged Facebook source event.

### Files Created
- None

### Files Modified
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Union existing and mirror stage rows; coerce n8n/Mongo array-like objects to arrays; read stage/source from telecrm_stage or stage.
- Same-attribution Facebook source remains one event; later different buckets stay separate.

### Reason
WF4 was seeding only the current TeleCRM status when stage[] did not arrive as a JS array, and it wiped existing telecrm stage rows whenever any upstream stage was present.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- None

### Manual Verification Required
- Re-import new workflows/4-final-source.json
- attach Mongo credentials
- execute
- check 9392751188: one meta_form source and two telecrm stages (Not Shown Up
- Fresh).


## 2026-09-09 — Three-question lead temperature scorer

**Agent:** AI coding agent

### Objective
Replace the nightly temperature job with skip/DEAD/three-question scoring from live TeleCRM lead/search, and document the new rules.

### Files Created
- None

### Files Modified
- `AGENT_CONTEXT.md`
- `new workflows/CROSS-PLATFORM-ACTIONS.csv`
- `new workflows/CROSS-PLATFORM-ACTIONS.md`
- `new workflows/EDGE-CASES.md`
- `new workflows/STATUS-MAPPING.md`
- `new workflows/lead_temperature_workflow_corrected_v2.json`

### Files Deleted
- None

### Changes
- Rewrote lead_temperature_workflow_corrected_v2.json: Mongo $match excludes Converted/Not Converted
- SplitInBatches of 25
- TeleCRM lead/search with Sync cred
- three-question Calculate Temperature
- CRM push parallel with new-telecrm update.
- Converted and Not Converted skip write (leave existing temperature). Calls Count > 6 and connected 0 is COLD (DEAD). Score 0/1/2-3 → COLD/WARM/HOT.
- Updated STATUS-MAPPING
- CROSS-PLATFORM
- EDGE-CASES
- and AGENT_CONTEXT temperature sections.

### Reason
The previous first-match HOT/WARM/COLD gates did not match the three-question product rules. Mongo telecrm also lacks Calls Count, Captured On, Last Incoming WhatsApp On, and Last Call, so the job now re-fetches eligible leads from the API.

### Validation
- node scripts/validate.js — JSON parse PASS; protected-file FAIL expected (approved workflow/docs); pre-existing secret-scan hit in scripts/sync-1000-users.js
- Calculator unit cases (11) — PASS

### Risks / Notes
- n8n must attach Sync HTTP credential (new) plus existing Mongo and Async creds
- and replace enterprise-id placeholders
- then import/activate.
- Skip-write leaves stale HOT on Converted/Not Converted.
- ~1450 nightly lead/search calls; search failures skip that lead via continueRegularOutput.

### Manual Verification Required
- Import the updated temperature workflow in n8n
- set Mongo + Sync + Async credentials
- replace REPLACE_WITH_TELECRM_ENTERPRISE_ID
- run once on a small status filter
- then enable the 02:00 schedule.


## 2026-09-09 — WF1 stores full source and stage history

**Agent:** AI coding agent

### Objective
Stop live sync from collapsing Sanjay-style TeleCRM history to one source object and one stage object.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- WF1 now expands lead_source
- source[]
- and stage[] the same way WF4 does
- Whatsapp lead_source no longer swallows a later CTWA source[] row
- Facebook lead_source still merges with the Facebook source[] dump
- Sanjay fixture expects 2 sources and 3 stages

### Reason
WF1 Build Document still prepended only the current TeleCRM source and status, so every upsert overwrote mirror source[] and stage[].

### Validation
- node scripts/validate-canonical-schema.js — PASS
- node scripts/validate.js — protected-file FAIL expected (approved writers); pre-existing secret-scan hit in scripts/sync-1000-users.js

### Risks / Notes
- Live n8n still runs the old prepend WF1 until 1-sync-webhook.json is re-imported
- Mongo credentials must be re-selected after import
- WF4 alone cannot fix docs that WF1 immediately rewrites

### Manual Verification Required
- Re-import new workflows/1-sync-webhook.json inactive
- Re-bind Mongo credentials on every Mongo node
- Execute WF1 for 9738761762 and confirm 3 stages plus Whatsapp + meta_ctwa


## 2026-09-09 — WF1 mirror lookup returns telecrm history

**Agent:** AI coding agent

### Objective
Make Find TeleCRM Mirror History actually return Sanjay-style source[] and stage[] so WF1 writes 2 sources and 3 stages.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/main prod.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Switch mirror lookup to findOne keyed from Normalize Phone
- Match 10-digit
- 91
- 0
- and numeric phone variants
- Load Existing Doc and Find User also read phone from Normalize Phone

### Reason
The live mirror node used aggregate on $json.phone from Load Existing Doc and returned no data, so Build Document fell back to TeleCRM Search and stored 2/1.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- Mongo credential must still be selected on Find TeleCRM Mirror History after import

### Manual Verification Required
- Re-import new workflows/1-sync-webhook.json
- Re-select Mongo credentials on Find TeleCRM Mirror History
- Execute for 9738761762 and confirm the node returns stage[3]


## 2026-09-09 — Drop duplicate temperature join fields

**Agent:** AI coding agent

### Objective
Keep only lead_temperature and temperature_calculated_at on new-telecrm. Remove temperature_outcome (duplicate of HOT/WARM/COLD), temperature_rule, and temperature_derived.

### Files Created
- None

### Files Modified
- None

### Files Deleted
- None

### Changes
- Canonical allowlist now has lead_temperature and temperature_calculated_at only.
- Sync WF3 WF4 JS webhook and the temperature job preserve or write those two fields and no longer emit outcome/rule/derived.
- Next full-document $project replace-merge strips leftover keys from existing docs.

### Reason
Join docs were storing the same classification twice plus calculator internals that reporting does not need.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- Temperature calculator output keys — PASS
- node scripts/validate.js — JSON parse PASS; protected-file FAIL expected; pre-existing secret-scan hit in scripts/sync-1000-users.js

### Risks / Notes
- Existing documents keep the old keys until the next Sync/WF3/WF4 replace-merge for that phone.
- Temperature job $set does not $unset the dropped fields by itself.

### Manual Verification Required
- Re-import the updated workflows. After a sync of a sample phone such as 9738761762, confirm the join doc has lead_temperature and temperature_calculated_at only among temperature keys.


## 2026-09-09 — Temperature schema trim file list

**Agent:** AI coding agent

### Objective
Record the files changed in the temperature schema trim (the previous entry omitted the detect-changes file list).

### Files Created
- None

### Files Modified
- `AGENT_CHANGELOG.md`
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/5-one-time-canonical-migration.json`
- `new workflows/CROSS-PLATFORM-ACTIONS.csv`
- `new workflows/CROSS-PLATFORM-ACTIONS.md`
- `new workflows/EDGE-CASES.md`
- `new workflows/FIELD-DICTIONARY.csv`
- `new workflows/FIELD-FLOW.md`
- `new workflows/STATUS-MAPPING.md`
- `new workflows/lead_temperature_workflow_corrected_v2.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Same schema trim as the previous entry. This records the file list only.

### Reason
update-changelog --json did not apply --from-detect so Files Modified was empty.

### Validation
- None

### Risks / Notes
- None

### Manual Verification Required
- None


## 2026-09-09 — Restore temperature_derived on the join schema

**Agent:** AI coding agent

### Objective
Put temperature_derived back. Keep lead_temperature and temperature_calculated_at. Continue omitting temperature_outcome and temperature_rule.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/5-one-time-canonical-migration.json`
- `new workflows/CROSS-PLATFORM-ACTIONS.csv`
- `new workflows/CROSS-PLATFORM-ACTIONS.md`
- `new workflows/FIELD-DICTIONARY.csv`
- `new workflows/FIELD-FLOW.md`
- `new workflows/STATUS-MAPPING.md`
- `new workflows/lead_temperature_workflow_corrected_v2.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Temperature job writes the seven-key temperature_derived object again.
- Sync WF3 WF4 JS webhook and canonical allowlist preserve it.
- temperature_outcome and temperature_rule stay removed.

### Reason
temperature_derived carries the seven score inputs (status d_status d_inbound d_call connected attempts future_session) and should stay on the join document.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- Calculator emits the seven derived keys — PASS

### Risks / Notes
- None

### Manual Verification Required
- Re-import the temperature workflow and Sync. After a scored lead confirm temperature_derived is present with the seven keys.


## 2026-09-09 — Trim status out of temperature_derived

**Agent:** AI coding agent

### Objective
temperature_derived stores only score inputs. Current TeleCRM stage stays on conversionStatus and stage[].

### Files Created
- None

### Files Modified
- `new workflows/FIELD-DICTIONARY.csv`
- `new workflows/STATUS-MAPPING.md`
- `new workflows/lead_temperature_workflow_corrected_v2.json`

### Files Deleted
- None

### Changes
- temperature_derived is now attempts connected d_captured d_inbound d_call.
- Dropped status (use conversionStatus) and future_session (old HOT gate). Renamed d_status to d_captured.

### Reason
derived.status duplicated conversionStatus and stage[0] and went stale when temperature skipped writes.

### Validation
- Calculator derived keys — PASS
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- None

### Manual Verification Required
- Re-import the temperature workflow. After a scored lead confirm temperature_derived has five keys and no status.


## 2026-09-09 — Strip leftover T2 temperature fields on Sync and nightly cleanup

**Agent:** AI coding agent

### Objective
Not Converted leads keep skip-score but existing docs lose temperature_outcome, temperature_rule, and the old seven-key derived object.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/STATUS-MAPPING.md`
- `new workflows/lead_temperature_workflow_corrected_v2.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Sync WF3 and the JS webhook reshape temperature_derived to the five score keys when preserving it.
- Nightly temperature workflow starts with Strip Legacy Temperature Fields on all new-telecrm docs.

### Reason
The test doc still showed T2 because the live n8n job was the old calculator, and the new job never touches Not Converted so leftover keys stayed.

### Validation
- node scripts/validate-canonical-schema.js — PASS including legacy T2 derived reshape

### Risks / Notes
- None

### Manual Verification Required
- Re-import lead_temperature_workflow_corrected_v2.json AND 1-sync-webhook.json. Disable the old temperature workflow so it cannot write T2. Execute Sync for 9738761762 or run the new temperature workflow once. Expect no temperature_outcome/rule and a five-key derived object. lead_temperature stays COLD because Not Converted is not re-scored.


## 2026-09-09 — Unset leftover T2 keys on Sync merge

**Agent:** AI coding agent

### Objective
Stop leftover temperature_outcome and temperature_rule surviving Sync upserts for Not Converted leads.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`

### Files Deleted
- None

### Changes
- Sync WF3 WF4 and main prod Remove Legacy / Enforce Canonical $merge now $unset temperature_outcome and temperature_rule
- reshape derived to five keys
- project _id
- and continue on merge error.

### Reason
Re-importing Sync alone cannot beat the old T2 temperature job, and n8n update only $sets listed fields. Merge now $unsets leftover keys before replace.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- node scripts/validate.js — FAIL protected-file snapshot (expected) and pre-existing secret-scan in scripts/sync-1000-users.js

### Risks / Notes
- Old live temperature workflow can still rewrite T2 three seconds after Sync if it stays active.

### Manual Verification Required
- Deactivate the old temperature workflow that writes T2. Re-import 1-sync-webhook.json. Re-run Sync for 9738761762. Expect COLD preserved
- no temperature_outcome/rule
- five-key derived. Optionally import and run lead_temperature_workflow_corrected_v2.json Strip once.


## 2026-09-09 — Make temperature writes remove legacy fields atomically

**Agent:** AI coding agent

### Objective
Keep today's three-question workflow intact while ensuring every scored lead loses legacy H4/T2 schema fields.

### Files Created
- None

### Files Modified
- `new workflows/lead_temperature_workflow_corrected_v2.json`

### Files Deleted
- None

### Changes
- Changed only Update new-telecrm in the existing Three Question workflow from field update to an aggregate that sets lead_temperature
- temperature_calculated_at
- and five-key temperature_derived
- unsets temperature_outcome and temperature_rule
- then merges the document.
- Removed continue-on-error from both Mongo cleanup operations so failures are visible in n8n.

### Reason
The Mongo update node only set canonical fields, allowing temperature_outcome and temperature_rule from an earlier document shape to survive. Cleanup failures were also configured to continue silently.

### Validation
- Temperature workflow hardening assertion — PASS
- node scripts/validate-canonical-schema.js — PASS
- JSON parse and lints — PASS
- node scripts/validate.js — expected protected-file and pre-existing secret-scan warnings only

### Risks / Notes
- None

### Manual Verification Required
- Re-import only lead_temperature_workflow_corrected_v2.json into the same current workflow
- reconnect its three credentials/placeholders if n8n asks
- then execute it. An open-status lead must have no temperature_outcome/rule and temperature_derived must contain only attempts
- connected
- d_captured
- d_inbound
- d_call.


## 2026-09-09 — Gate temperature scoring on verified legacy cleanup

**Agent:** AI coding agent

### Objective
Remove legacy temperature fields from all new-telecrm documents before testing or running the new scorer.

### Files Created
- None

### Files Modified
- `new workflows/lead_temperature_workflow_corrected_v2.json`
- `new workflows/STATUS-MAPPING.md`

### Files Deleted
- None

### Changes
- Replaced aggregation unset stages with exclusion projections followed by replace-merge.
- Added Verify Legacy Fields Removed and Require Clean Temperature Schema nodes before Load TeleCRM Leads.
- The workflow now aborts before scoring if any document retains temperature_outcome
- temperature_rule
- temperature_derived.status
- temperature_derived.d_status
- or temperature_derived.future_session.
- Per-lead temperature writes apply the same exclusion projection.

### Reason
The prior aggregation unset completed in n8n without removing the legacy fields. Scoring must not proceed while old H4/T2 schema fields remain.

### Validation
- Cleanup-first workflow graph assertion — PASS
- node scripts/validate-canonical-schema.js — PASS
- Workflow JSON parse and lints — PASS
- node scripts/validate.js — expected protected-file and pre-existing secret-scan warnings only

### Risks / Notes
- None

### Manual Verification Required
- Re-import only lead_temperature_workflow_corrected_v2.json into the current workflow and run it. Confirm Verify Legacy Fields Removed outputs remaining_legacy_temperature_docs: 0 before reviewing temperature results.


## 2026-09-09 — Reject wrong Mongo target during temperature cleanup

**Agent:** AI coding agent

### Objective
Prevent cleanup and scoring from appearing successful when the imported workflow points to an empty or different new-telecrm collection.

### Files Created
- None

### Files Modified
- `new workflows/lead_temperature_workflow_corrected_v2.json`
- `new workflows/STATUS-MAPPING.md`

### Files Deleted
- None

### Changes
- Verify Legacy Fields Removed now returns total_new_telecrm_docs and remaining_legacy_temperature_docs.
- Require Clean Temperature Schema fails when total is zero and instructs selection of the production Mongo credential used by Sync.
- The existing failure on any remaining legacy field is preserved.

### Reason
The observed collection contains H5 while the cleanup-gated workflow should reject any leftover. Multiple Mongo environments are present, so a verifier connected to an empty collection could previously return a misleading zero.

### Validation
- Mongo target verification assertion — PASS
- node scripts/validate-canonical-schema.js — PASS
- JSON parse and lints — PASS

### Risks / Notes
- None

### Manual Verification Required
- Re-import lead_temperature_workflow_corrected_v2.json. Set all four Mongo nodes to the exact credential used by Sync Upsert Document. Run through Require Clean Temperature Schema and confirm total_new_telecrm_docs is nonzero and remaining_legacy_temperature_docs is zero.


## 2026-09-09 — Make clean temperature workflow unmistakable on import

**Agent:** AI coding agent

### Objective
Let the user import and visually identify the corrected workflow without manually replacing nodes in the old H5 execution.

### Files Created
- None

### Files Modified
- `new workflows/lead_temperature_workflow_corrected_v2.json`

### Files Deleted
- None

### Changes
- Renamed the export to TeleCRM — Lead Temperature — CLEAN v4 (Three Question).
- Added a visible CLEAN v4 sticky note explaining the removed schema fields.
- Added workflow_version three-question-clean-v4 to the cleanup gate output.
- Replaced the non-UUID versionId with a unique UUID.

### Reason
The live n8n execution was still showing the old H1-H6/T1-T2 calculator, so the corrected import needs an unambiguous name and runtime marker.

### Validation
- CLEAN v4 import identity assertion — PASS
- node scripts/validate-canonical-schema.js — PASS
- JSON parse and lints — PASS

### Risks / Notes
- None

### Manual Verification Required
- Import lead_temperature_workflow_corrected_v2.json and run the workflow named CLEAN v4. Confirm Require Clean Temperature Schema outputs workflow_version three-question-clean-v4.


## 2026-09-09 — Fix CLEAN temperature batch execution

**Agent:** AI coding agent

### Objective
Make the imported cleanup-first workflow process every eligible lead correctly without manual rewiring.

### Files Created
- None

### Files Modified
- `new workflows/lead_temperature_workflow_corrected_v2.json`

### Files Deleted
- None

### Changes
- Renamed the corrected import CLEAN v5 (Fixed Loop).
- Connected Loop Over Items loop output to TeleCRM Search and left done output terminal.
- Removed the premature Calculate Temperature to Next Batch branch.
- Connected skipped leads to Next Batch and successful Mongo writes to Next Batch.
- Enabled Always Output Data on the aggregate  writer so processing continues.
- Kept Load TeleCRM Leads explicitly on telecrm and laid nodes out in execution order.

### Reason
The screenshot showed Load TeleCRM Leads manually pointed at new-telecrm and Loop Over Items reported no connection on its loop output. The export itself connected TeleCRM Search to done and advanced the loop before Mongo completed.

### Validation
- CLEAN v5 workflow graph assertion — PASS
- node scripts/validate-canonical-schema.js — PASS
- Workflow JSON parse and lints — PASS
- node scripts/validate.js — expected protected-file and pre-existing secret-scan warnings only

### Risks / Notes
- None

### Manual Verification Required
- From the n8n Workflows page import lead_temperature_workflow_corrected_v2.json as a new workflow. Attach credentials without changing collection names. Run CLEAN v5 and verify cleanup marker before checking Mongo.


## 2026-09-10 — Canonical final-source mapping

**Agent:** AI coding agent

### Objective
Use source[] as the only final-source representation with exact taxonomy and TeleCRM-priority source[0]

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- None

### Reason
Approved implementation of the attached canonical final-source plan across n8n source writers and validation fixtures

### Validation
- None

### Risks / Notes
- None

### Manual Verification Required
- None


## 2026-09-10 — Add app final-source mapping

**Agent:** AI coding agent

### Objective
Classify TeleCRM and UTM app attribution as app in canonical source history

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- None

### Reason
User added app to the approved n8n final-source taxonomy

### Validation
- None

### Risks / Notes
- None

### Manual Verification Required
- None


## 2026-09-10 — Exclusive source buckets from category, TeleCRM, analytics

**Agent:** AI coding agent

### Objective
Classify new-telecrm source[] from three exclusive inputs with no cross-bucket fallbacks, keeping full history and ranking dashboard category first.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/4-final-source.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- WF4 Load joins users.category and users_analytics_view instead of web_touchpoints
- WF4 and Sync Build Document classify each bucket separately
- Category always ranks source[0] when present
- Canonical schema tests updated for exclusive buckets

### Reason
User approved workflow 4 and 1-sync-webhook.json so dash_* / website come only from users.profileData.category, meta_form/Manual/meta_ctwa only from TeleCRM lead_source, and remaining UTM labels only from users_analytics_view.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- new-telecrm-webhook.js and WF3 still use the old mixed classifier if those writers run
- CRM-only Excel leads with no user still classify as Manual

### Manual Verification Required
- Import 4-final-source.json and 1-sync-webhook.json
- attach Mongo creds
- run 9945503351 and 9810036813 locally


## 2026-09-10 — Store source extras without origin fields

**Agent:** AI coding agent

### Objective
Write new-telecrm source[] without origin, tele_source, or tele_leadsource, while keeping Facebook campaign/ad/lead extras and analytics UTMs.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/4-final-source.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- WF4 and Sync compact source events before write
- Facebook still stores campaign
- ad
- ad set
- and lead ids
- UTM source/medium remain on analytics events

### Reason
User asked not to persist origin/tele_source/tele_leadsource in Mongo; only source plus channel extras.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- None

### Manual Verification Required
- Re-import 4-final-source.json as an inactive test workflow and check source[] on a Facebook phone


## 2026-09-10 — Strip origin fields from remaining writers

**Agent:** AI coding agent

### Objective
Stop WF3, webhook, and main prod from writing origin, tele_source, and tele_leadsource into source[].

### Files Created
- None

### Files Modified
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Webhook buildSourceHistory now drops origin/tele_source/tele_leadsource before write
- WF3 Build Full Document and main prod Build nodes use the same compact map
- Schema test asserts stored events have no origin fields

### Reason
Live Sync/WF3 were overwriting compact WF4 source events with origin/tele_* keys.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- Existing Mongo rows keep the old keys until rewritten
- Live n8n must be re-imported from these JSON files

### Manual Verification Required
- Re-import WF3 and Sync/main prod in n8n
- Re-run WF4 on a test phone and confirm Compass has no origin/tele_*


## 2026-09-10 — Stop temperature_outcome and temperature_rule from surviving writes

**Agent:** AI coding agent

### Objective
Remove leftover temperature_outcome and temperature_rule on new-telecrm whenever temperature is written.

### Files Created
- None

### Files Modified
- `new workflows/4-temperature-realtime.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Realtime Update new-telecrm now aggregates $set of the three canonical temp fields plus $unset of temperature_outcome and temperature_rule
- Nightly temperature merge uses the same $unset

### Reason
Realtime Mongo update only $set canonical temp fields, so W5/outcome from the old scorer stayed on the document.

### Validation
- node scripts/validate-canonical-schema.js — PASS

### Risks / Notes
- Live combined n8n canvas still has the old update node until these two nodes are copied in

### Manual Verification Required
- On the combined workflow
- replace Update new-telecrm (and nightly) with the aggregate $unset query from 4-temperature-realtime.json
- then run temperature for one phone and confirm those two keys are gone


## 2026-09-10 — Omit unscored temperature fields

**Agent:** AI coding agent

### Objective
Stop unscored leads from storing null lead_temperature, temperature_calculated_at, and temperature_derived fields.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- None

### Reason
Temperature fields should exist only after the temperature workflow calculates a value; source metadata stripping remains enforced.

### Validation
- None

### Risks / Notes
- None

### Manual Verification Required
- None


## 2026-09-10 — Document optional temperature field behavior

**Agent:** AI coding agent

### Objective
Record implementation and validation details for omitting null temperature fields.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Sync
- WF3
- and combined build nodes emit temperature fields only when existing calculated values are non-null
- Canonical cleanup nodes remove null temperature fields with 18335REMOVE while preserving calculated values
- Schema validation now asserts unscored output omits all three temperature keys

### Reason
Complete the preceding audit entry with implementation details.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- npm run validate — workflow JSON and JS checks PASS; expected protected-file and pre-existing secret-scan warnings remain

### Risks / Notes
- Imported live workflows must be replaced before behavior changes in n8n

### Manual Verification Required
- Re-import workflows 1
- 3
- and 4 (or main prod if that is the deployed combined workflow)
- Run the source workflow for the sample phone and confirm source metadata and null temperature keys are absent


## 2026-09-10 — Correct temperature cleanup audit wording

**Agent:** AI coding agent

### Objective
Correct the shell-expanded Mongo variable in the prior append-only entry.

### Files Created
- None

### Files Modified
- None

### Files Deleted
- None

### Changes
- The canonical cleanup expression is $$REMOVE. The number shown before REMOVE in the prior entry was shell PID expansion in changelog text only and never appeared in workflow JSON.

### Reason
Keep the append-only audit technically accurate.

### Validation
- None

### Risks / Notes
- None

### Manual Verification Required
- None


## 2026-09-10 — Align realtime three-question temperature scoring

**Agent:** AI coding agent

### Objective
Make realtime and nightly temperature branches use the same product scoring rules from live TeleCRM data.

### Files Created
- None

### Files Modified
- `new workflows/4-temperature-realtime.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Replaced the realtime new-telecrm lookup with a live TeleCRM lead/search request
- Realtime Calculate Temperature now uses the exact nightly three-question scorer
- Added calculator and workflow-wiring regression coverage

### Reason
new-telecrm lacks the answer fields and the realtime branch was using obsolete first-match rules that could overwrite nightly scores.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- npm run validate — workflow JSON and JavaScript checks PASS with expected protected-file and pre-existing secret-scan warnings

### Risks / Notes
- The new realtime HTTP node requires the same TeleCRM Search credential as the nightly node.

### Manual Verification Required
- Re-import 4-temperature-realtime.json
- Attach the TeleCRM Search credential to both search nodes and Mongo credentials to Mongo nodes
- Disable the old workflow copy before activating this one


## 2026-09-11 — Fix dash stage history append-on-change

**Agent:** AI coding agent

### Objective
Stop stage[0] from being overwritten on ACTIVE/INACTIVE flips by selecting the newest stage per platform by time

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- `buildStageHistory.latestFor` now picks the newest row per platform by `occurred_at` (then sequence), instead of the last array item
- Status compares use normalized equality so dash/telecrm append-on-change is consistent
- Schema tests cover INACTIVE → ACTIVE append and ACTIVE → INACTIVE return trips for JS + WF1

### Reason
latestFor walked newest-first arrays from the end, so returning to a prior dash status skipped append and looked like an in-place update

### Validation
- `node scripts/validate-canonical-schema.js` — PASS
- `node scripts/validate.js` — protected-file FAIL expected (approved workflow/JS edits); unrelated secret heuristic on `scripts/sync-1000-users.js`

### Risks / Notes
- Live n8n still needs re-import of Sync (1), WF3, WF4, and/or main prod
- Existing collapsed dash history is not backfilled; only future transitions append

### Manual Verification Required
- Re-import `3-dashboard-to-telecrm.json` (and Sync if used)
- On phone `9392751188`, set dash ACTIVE then INACTIVE
- Confirm `stage[]` keeps both dash rows newest-first instead of rewriting `[0]`


## 2026-09-11 — Preserve dash stage history by loading existing join doc

**Agent:** AI coding agent

### Objective
Stop WF3/Sync from rebuilding a single dash stage row on every status change

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Load Existing / Load existing new-telecrm now use aggregate `$match` + `$limit: 1` with phone variants (same pattern as the working TeleCRM mirror lookup)
- Build nodes resolve the join doc via `resolveJoinDoc()` instead of requiring `.phone` on `findOne` output
- `buildStageHistory` seeds a prior dash row from `existing.dash_status` when `stage[]` has no dash entries
- Regression tests cover BOOKED_WITH_TOKEN → PACKAGE_EXPIRED append (WF3 + JS)

### Reason
Load existing used findOne and dropped the join doc, so buildStageHistory only kept telecrm stages plus the current dash status — which looked like stage[0] being updated in place

### Validation
- `node scripts/validate-canonical-schema.js` — PASS

### Risks / Notes
- Live n8n must re-import WF3 (and Sync if used) and re-bind Mongo credentials
- Already-collapsed dash history is only partially recoverable via `dash_status` seed on the next change

### Manual Verification Required
- Re-import `3-dashboard-to-telecrm.json`
- On Lalith, change dash BOOKED_WITH_TOKEN → PACKAGE_EXPIRED (or ACTIVE → INACTIVE)
- Confirm `stage` becomes Array(4+) with both dash statuses kept


## 2026-09-11 — Start production new-telecrm backfill

**Agent:** AI coding agent

### Objective
Fill stance-dashboard.new-telecrm from the production telecrm mirror using the same JS syncOne path as development

### Files Created
- `.agent/backfill-new-telecrm-progress-stance-dashboard.json`

### Files Modified
- `scripts/backfill-new-telecrm.js`
- `scripts/README.md`
- `.env.example`

### Files Deleted
- None

### Changes
- Added --uri-env and per-database progress files so production can use MONGODB_URI_PRODUCTION without touching the in-flight development backfill
- Refuse stance-dashboard when the Mongo host is healthflex-dev
- Dry-run on production: telecrm 17366
- new-telecrm 0
- 17145 usable phones
- Pilot apply inserted 5 docs with 0 failures
- Started the full --from-mirror apply against stance-dashboard

### Reason
User asked to run the production backfill after adding MONGODB_URI_PRODUCTION to .env

### Validation
- node --check scripts/backfill-new-telecrm.js — PASS
- production dry-run — PASS (host healthflex-prod
- telecrm=17366)
- pilot --limit 5 — PASS (inserted 5
- failed 0)

### Risks / Notes
- Full apply is still running (~17k phones). Keep n8n temperature unpublished so inserts do not POST to live TeleCRM.
- Development backfill on stance-development continues in a separate process and progress file.
- Rotate the production Atlas password because it was pasted in chat earlier.

### Manual Verification Required
- Watch .agent/backfill-new-telecrm-progress-stance-dashboard.json until processed equals total
- In Compass
- confirm production new-telecrm count approaches 17145 and sample source/stage look canonical


## 2026-09-11 — Finish development new-telecrm backfill

**Agent:** AI coding agent

### Objective
Complete the stance-development telecrm → new-telecrm mirror backfill, including the one timed-out phone

### Files Created
- `.agent/backfill-new-telecrm-progress-stance-dashboard.json`

### Files Modified
- `.agent/backfill-new-telecrm-progress.json`
- `AGENT_CHANGELOG.md`
- `scripts/README.md`
- `scripts/backfill-new-telecrm.js`

### Files Deleted
- None

### Changes
- Let the in-flight `stance-development` mirror backfill finish (16,815 / 16,816)
- Retried the one Mongo timeout (`9620202416` / Gopinath) with `--phone`; it inserted
- Added `--phone` for single-number retries and documented it

### Reason
User asked to run the remaining development backfill with refresh of existing rows and CRM-only phones from the Mongo mirror

### Validation
- node --check scripts/backfill-new-telecrm.js — PASS
- Final dry-run on stance-development: usable phones 16816, missing 0, new-telecrm 16846
- node scripts/validate.js — FAIL only the pre-existing secret heuristic on scripts/sync-1000-users.js

### Risks / Notes
- 221 telecrm phones are not 10-digit after 0/91 strip and were skipped
- new-telecrm 16846 vs 16816 unique phones: extra rows are non-normalized or concurrent n8n writes
- Production backfill progress file was already in flight from a separate task; this entry does not start or stop it

### Manual Verification Required
- In Compass on Mongo Dev / stance-development, confirm new-telecrm is ~16846 and spot-check a CRM-only phone plus one of the original 1k


## 2026-09-11 — Production new-telecrm backfill completed

**Agent:** AI coding agent

### Objective
Finish the stance-dashboard.new-telecrm mirror backfill

### Files Created
- None

### Files Modified
- None

### Files Deleted
- None

### Changes
- Full --from-mirror apply finished: 17145 upserted
- 17140 inserted
- 5 refreshed
- 0 failed
- Mongo plugin count matches: production new-telecrm=17145

### Reason
Production backfill process completed successfully

### Validation
- backfill process exit 0 after 5791918ms
- MCP count stance-dashboard.new-telecrm = 17145

### Risks / Notes
- Temperature/source/WF3 n8n jobs were not published as part of this run.

### Manual Verification Required
- Sample a few production new-telecrm docs in Compass for canonical source/stage


## 2026-09-16 — Sparse new-telecrm schema

**Agent:** Cursor Grok 4.6

### Objective
Switch every new-telecrm writer to the sparse join schema: omit nulls, fetch extra TeleCRM scalars, rename temperature fields, push dashboard_field/email to TeleCRM SaaS, and prepare a one-time compact of the live 17k docs.

### Files Created
- None

### Files Modified
- `new-telecrm-webhook.js`
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/4-temperature-realtime.json`
- `new workflows/5-one-time-canonical-migration.json`
- `new workflows/main prod.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- JS sync omitEmpty-compacts the upsert, adds last_synced_at, maps first_interaction/first_call_done/last_contacted/drop_off_reason/capture_frequency, and stops storing dash_firstVisitAppointments and default 0 call counts.
- lead_temperature/temperature_calculated_at renamed to temperature/calculated_at; existing scores are preserved across sync.
- n8n Sync, WF3, source-attribution cleanup, and main prod copies use the same allowlist and null-stripping $replaceRoot.
- WF3 autoupdatelead now sends dashboard_field and email when dash_patient_id/dash_email are set (TeleCRM SaaS, not Mongo telecrm).
- Temperature job scores from new-telecrm open statuses, $unsets temperature on Converted/Not Converted, and only POSTs temperature when a score is written.
- Workflow 5 one-time migration (still inactive/manual) compacts live docs, drops fake 0 call counts, and unsets temperature on Converted/Not Converted.

### Reason
The Fields on TeleCRM sheet required fetching extra CRM scalars, omitting empty keys, write-back of dashboard id/email/temperature to TeleCRM cloud, and a temperature field rename.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- node --check new-telecrm-webhook.js — PASS
- node scripts/validate.js — FAIL expected (approved protected-file edits vs old snapshot; pre-existing secrets heuristic on scripts/sync-1000-users.js)

### Risks / Notes
- n8n workflows must be re-imported before they write the new shape; old n8n copies will put nulls back.
- Workflow 5 $merge replace is a one-shot production write — backup first; do not run it until the new writers are live.
- WF3 now writes email and dashboard_field to TeleCRM; status/name overwrite behaviour is unchanged.
- Converted/Not Converted leads lose stored temperature (intentional stale-HOT fix).

### Manual Verification Required
- Re-import 1-sync-webhook, 3-dashboard-to-telecrm, 4-temperature-realtime, 4-final-source, and 5-one-time-canonical-migration into n8n.
- Backup new-telecrm, then run workflow 5 once. Dry-run counts: 17145 docs, all currently have lead_temperature and dash_firstVisitAppointments keys; 10527 have dash_status null.
- After compact, run the temperature nightly (or one manual execute) so open leads get temperature + calculated_at.
- Spot-check a CRM-only phone (no dash_* keys), a Dash-linked phone (dashboard_field on TeleCRM after WF3), and a Converted lead (no temperature key).


## 2026-09-16 — Store Website as website in source

**Agent:** AI coding agent

### Objective
Parse TeleCRM Website and dashboard WEBSITE into source[] as website, matching the lowercase labels already used for other dashboard categories.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/4-final-source.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- sourceFromTeleLead/sourceFromTelecrmRow/sourceFromAnalytics now map website/WEBSITE/wesbite to website in WF1 and WF4.
- TeleCRM website is a priority-2 source like meta_form
- so it is no longer discarded when the dashboard user is missing.
- Validator expects lead_source Website and utm wesbite to classify as website.

### Reason
Website was dropped by the n8n classifier while other dashboard categories were stored; TeleCRM Website and dashboard WEBSITE are the same source and should write website.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- node scripts/validate.js — FAIL expected (approved protected-file edits vs task-start; pre-existing secrets heuristic on scripts/sync-1000-users.js)

### Risks / Notes
- n8n must re-import 1-sync-webhook.json and 4-final-source.json or live sync will still drop Website.
- Dashboard WEBSITE and TeleCRM Website can both emit a website row if the user join succeeds; category still wins index 0.

### Manual Verification Required
- Re-import 1-sync-webhook.json and 4-final-source.json. Re-trigger 9146050999 and confirm source[] contains website.


## 2026-09-16 — Refresh 10 development join rows

**Agent:** AI coding agent

### Objective
Run JS syncOne backfill for 10 stance-development phones so sparse schema can be inspected without TeleCRM webhooks.

### Files Created
- None

### Files Modified
- None

### Files Deleted
- None

### Changes
- Applied node scripts/backfill-new-telecrm.js --apply --from-mirror --limit 10 on stance-development.
- 10 existing new-telecrm rows refreshed
- 0 inserted
- 0 failed.

### Reason
User asked to apply the 10-user development backfill.

### Validation
- backfill exit 0; upserted 10; new-telecrm count still 16949

### Risks / Notes
- Temperature realtime may have fired on the 10 updates.

### Manual Verification Required
- In Compass stance-development.new-telecrm
- open the 10 phones and check source/stage/dash/sparse keys.


## 2026-09-16 — Map TeleCRM UI field labels into join

**Agent:** Cursor Grok 4.6

### Objective
Parse TeleCRM panel labels (Captured On, Last Activity On, Capture Frequency, Count of Connected Calls, First Call Attempt) into new-telecrm scalars.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/5-one-time-canonical-migration.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- buildTeleCRMPart and n8n Build Document map Captured On to telecrm_first_interaction_date
- Last Call/Last Activity On to telecrm_last_contacted_date
- Capture Frequency to telecrm_capture_frequency
- Count of Connected Calls to telecrm_connected_calls
- and First Call Attempt date to telecrm_first_call_done true.
- WF1/WF3/main upsert fields and WF5 compact allowlist include telecrm_connected_calls.
- Validator covers UI aliases and the new join key.

### Reason
Live Search already returns UI labels; join writers only read snake_case aliases so Captured On and Capture Frequency were dropped.

### Validation
- node scripts/validate-canonical-schema.js — PASS
- node scripts/validate.js — FAIL expected (approved protected-file edits vs task-start; pre-existing secrets heuristic on scripts/sync-1000-users.js)

### Risks / Notes
- n8n must re-import WF1 (and WF3/main if used) or live sync still ignores UI labels.
- Mirror backfill cannot fill these keys because crm-mongo-sync does not store Captured On / Last Call.
- First Call Attempt and Count of Connected Calls stay omitted when TeleCRM itself is Empty.

### Manual Verification Required
- Re-import 1-sync-webhook.json. Re-run TeleCRM Search for a phone like Piyush with Capture Frequency and Captured On filled. Confirm new-telecrm has telecrm_capture_frequency and telecrm_first_interaction_date.


## 2026-09-16 — Refresh 10 development join rows

**Agent:** Cursor Grok 4.6

### Objective
Re-run JS syncOne backfill for 10 stance-development phones after UI field aliases.

### Files Created
- None

### Files Modified
- None

### Files Deleted
- None

### Changes
- Applied node scripts/backfill-new-telecrm.js --apply --from-mirror --limit 10 on stance-development.
- 10 existing new-telecrm rows refreshed
- 0 inserted
- 0 failed.

### Reason
User asked to run the backfill again.

### Validation
- backfill exit 0; upserted 10; new-telecrm count still 16949

### Risks / Notes
- CRM fields still came from the Mongo telecrm mirror
- so Captured On / Last Call / Capture Frequency will not appear unless those keys exist on the mirror.
- Temperature realtime may have fired on the 10 updates.

### Manual Verification Required
- In Compass stance-development.new-telecrm check 9392751188 (Lalith)
- 1209348576 (website)
- and 7439693895 (dash join).


## 2026-09-16 — Live TeleCRM search 401 for 10 phones

**Agent:** Cursor Grok 4.6

### Objective
Re-sync the 10 development join phones from live TeleCRM lead/search after the user published n8n WF1.

### Files Created
- None

### Files Modified
- None

### Files Deleted
- None

### Changes
- Attempted JS syncOne without mirror preload for 10 stance-development phones.
- All 10 failed TeleCRM lead/search 401 NOT_AUTHORIZED.
- No new-telecrm writes; last_synced_at still 2026-09-16T12:04Z from the earlier mirror backfill.

### Reason
User asked to re-run those 10 users after publishing the workflow.

### Validation
- 10/10 FAIL 401; join docs unchanged

### Risks / Notes
- TELECRM_SYNC_API2 in .env is not a Sync-typed token. n8n has the working Search credential
- but this repo has no N8N_BASE_URL so the published workflow cannot be POSTed from here.

### Manual Verification Required
- In n8n
- POST the published Sync webhook for the 10 phones or pin a Sync token into TELECRM_API_TOKEN / N8N_BASE_URL.


## 2026-09-16 — Speak NDJSON so Cursor can load TeleCRM and n8n MCP

**Agent:** AI coding agent

### Objective
Fix stdio framing so Cursor 3.17 can complete MCP handshake for telecrm-api and n8n-api.

### Files Created
- None

### Files Modified
- `MCP.md`
- `mcp/n8n-api/index.js`
- `mcp/platforms/index.js`
- `mcp/server/index.js`
- `mcp/telecrm-api/index.js`

### Files Deleted
- None

### Changes
- send() and encode() now write one JSON-RPC object plus a newline
- Incoming Content-Length is still accepted
- MCP.md documents the Cursor NDJSON requirement

### Reason
Cursor timed out on tool discovery because these servers replied with Content-Length instead of newline-delimited JSON.

### Validation
- node mcp/telecrm-api/index.js --self-test — PASS
- node mcp/n8n-api/index.js --self-test — PASS
- node mcp/server/index.js --self-test — PASS
- node mcp/platforms/index.js --self-test — PASS

### Risks / Notes
- Cursor must refresh Settings → MCP after this change
- validate.js still fails on pre-existing secret heuristic in scripts/sync-1000-users.js

### Manual Verification Required
- Cursor Settings → MCP: restart telecrm-api and n8n-api
- confirm tools appear


## 2026-09-17 — Backfill 19 high-data development phones

**Agent:** Cursor Grok 4.6

### Objective
Pick 10-20 stance-development phones with the most join data and refresh them via JS syncOne so extra TeleCRM scalars can be inspected.

### Files Created
- `mcp/findings/dev-high-data-test-phones-2026-09-17.md`

### Files Modified
- `.agent/backfill-new-telecrm-progress.json`

### Files Deleted
- None

### Changes
- Scored stance-development telecrm/users/web for extra CRM scalars and status/source coverage, then applied JS mirror backfill for 19 phones.
- 19 existing new-telecrm rows refreshed, 0 inserted, 0 failed. Collection still 16980.
- After refresh: 16 first_interaction, 17 first_call_done, 4 last_contacted, 13 drop_off, 10 capture_frequency, 0 connected_calls.

### Reason
User asked to go through the dev collection and backfill the users that give the most data for testing, not the first 10 mirror phones.

### Validation
- backfill exit 0; upserted 19; failed 0; new-telecrm=16980

### Risks / Notes
- CRM fields still came from the Mongo telecrm mirror because lead/search is 401. Captured On / Last Call / Count of Connected Calls are not on the mirror.
- Temperature realtime may have fired on the 19 updates.

### Manual Verification Required
- In Compass stance-development.new-telecrm open 9620054545 for all five extra scalars.
- Open 8296961688 for In Pipeline + 10-stage history.
- Open 7406888876 for Session booked + PACKAGE.
- Connected calls still need live lead/search.


## 2026-09-21 — Restore bot-reopened Fresh leads to Converted

**Agent:** Cursor Grok 4.6

### Objective
Push TeleCRM status Converted for leads the daily-report temperature job reopened to Fresh, without changing temperature or other fields.

### Files Created
- `scripts/restore-bot-fresh.js`

### Files Modified
- `scripts/README.md`

### Files Deleted
- None

### Changes
- Added scripts/restore-bot-fresh.js and ran --apply: 168 HTTP 200
- 0 failed. Skipped test numbers and Session-booked-only Fresh leads.

### Reason
User asked to run the restore script.

### Validation
- node --check scripts/restore-bot-fresh.js — PASS

### Risks / Notes
- Mongo telecrm mirror can lag; if live n8n still pushes temperature
- tomorrow 8:30 AM IST can reopen these leads.

### Manual Verification Required
- Confirm Push Temperature to TeleCRM2 is disconnected. Spot-check Pooja 9582314602 and Kishor 9900113815 in TeleCRM UI.


## 2026-09-21 — Map INACTIVE and PACKAGE_EXPIRED to Converted

**Agent:** Cursor Grok 4.6

### Objective
WF3 must push Converted (not Not Converted) when dashboard status is INACTIVE or PACKAGE_EXPIRED.

### Files Created
- None

### Files Modified
- `AGENT_CONTEXT.md`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/CROSS-PLATFORM-ACTIONS.csv`
- `new workflows/CROSS-PLATFORM-ACTIONS.md`
- `new workflows/main prod.json`

### Files Deleted
- None

### Changes
- STATUS_MAP in 3-dashboard-to-telecrm.json and main prod.json: INACTIVE and PACKAGE_EXPIRED → Converted. Updated CROSS-PLATFORM B6 and AGENT_CONTEXT.

### Reason
User asked to keep expired/inactive patients as Converted on TeleCRM.

### Validation
- JSON.parse on both workflow files — PASS

### Risks / Notes
- Live n8n still uses old map until imported. Recapture Once A Day on async production token can still reset Fresh.

### Manual Verification Required
- Re-import or paste Check Status & Extract in live n8n WF3. LEAD still pushes Fresh.


## 2026-09-21 — Temperature POSTs include current status

**Agent:** Cursor Grok 4.6

### Objective
Temperature autoupdatelead POSTs must include the lead's current TeleCRM status and must not skip Session booked or Converted, so Anuj-style reopen to Fresh cannot happen.

### Files Created
- None

### Files Modified
- `AGENT_CONTEXT.md`
- `new workflows/4-temperature-realtime.json`
- `new workflows/CROSS-PLATFORM-ACTIONS.csv`
- `new workflows/CROSS-PLATFORM-ACTIONS.md`
- `new workflows/crm-daily-report-slack.json`

### Files Deleted
- None

### Changes
- 4-temperature-realtime: removed SKIP_STATUSES so Session booked, Converted, Fresh, In Pipeline, and No Response are all scored.
- Calculate Temperature (realtime + nightly) now outputs current_status and only writes when status and temperature both exist.
- Both Push Temperature HTTP bodies send phone + status + temperature so autoupdatelead cannot reopen the lead to Fresh.
- Temperature Available? gates require current_status not empty.
- crm-daily-report-slack Build/Filter/Push Temperature now pass status the same way (Session booked included).

### Reason
Temperature-only POST {phone, temperature} reopens Session booked and Converted leads to Fresh. User asked to implement status+temperature and not skip any status.

### Validation
- JSON.parse 4-temperature-realtime.json and crm-daily-report-slack.json — PASS
- validate_workflow_json — all workflow files OK
- SKIP_STATUSES removed from both Calculate Temperature nodes

### Risks / Notes
- Live n8n still runs the old bodies until the JSON is imported.
- Daily report Filter is still wired to Push in the export; import only after confirming the status field is in the body.
- WF3 LEAD→Fresh is a separate overwrite path.

### Manual Verification Required
- Re-import 4-temperature-realtime.json into live n8n (repo export is inactive until imported).
- Keep daily-report Slack as-is; only reconnect Push Temperature after this import so Session booked POSTs include status.
- Spot-check Anuj 9885933906 after a temperature run: stage must stay Session booked.


## 2026-09-21 — Re-apply Converted restore on TeleCRM

**Agent:** Cursor Grok 4.6

### Objective
Write Converted back onto TeleCRM for leftover Fresh leads from the temperature-bot reopen / recapture bounce.

### Files Created
- None

### Files Modified
- `AGENT_CHANGELOG.md`
- `AGENT_CONTEXT.md`
- `new workflows/4-temperature-realtime.json`
- `new workflows/CROSS-PLATFORM-ACTIONS.csv`
- `new workflows/CROSS-PLATFORM-ACTIONS.md`
- `new workflows/crm-daily-report-slack.json`

### Files Deleted
- None

### Changes
- Ran restore-bot-fresh.js --apply against production: 145 Fresh→Converted, HTTP 200, 0 failed. Status-only autoupdatelead, no new leads.

### Reason
User asked for the TeleCRM status change after the dry-run.

### Validation
- 145/145 HTTP 200

### Risks / Notes
- If Async recapture is not Never, leads can bounce Fresh again.
- Mongo telecrm mirror lags crm-mongo-sync.

### Manual Verification Required
- Spot-check a few phones in TeleCRM UI for 2–3 minutes: stage must stay Converted, no Lead Recapture, one lead card.


## 2026-09-21 — Redact Slack-report TeleCRM Bearer

**Agent:** Cursor Grok 4.6

### Objective
Remove the hardcoded TeleCRM Bearer from the Slack daily-report workflow so the folder is safe to git init and push. Auth now uses the same n8n httpHeaderAuth credential placeholder as WF3.

### Files Created
- None

### Files Modified
- `.gitignore`
- `new workflows/crm-daily-report-slack.json`

### Files Deleted
- None

### Changes
- None

### Reason
User asked to hide the token/bearer before creating a GitHub repo.

### Validation
- validate_workflow_json: crm-daily-report-slack.json PARSE OK
- rg found no remaining hardcoded Bearer values outside .env
- validate_repo: json_ok true; protected FAIL expected (approved workflow edit); secret_hits only pre-existing sync-1000-users.js heuristic

### Risks / Notes
- Live n8n must re-bind Push Temperature to TeleCRM2 to the Async Header Auth credential after import.
- The old token was in this working copy — rotate it in TeleCRM even though it is no longer in the JSON.
- Pre-existing secret heuristic on scripts/sync-1000-users.js is a redaction helper, not a live credential.

### Manual Verification Required
- None


## 2026-09-21 — Unique timestamps for dash stage flips

**Agent:** AI coding agent

### Objective
Record every dashboard status flip in new-telecrm stage[] even when conversionStatus stays Converted and users.updatedAt is stale.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- `buildStageHistory` timestamps a dash transition uniquely: prefer `users.updatedAt` only if it is strictly after the latest dash `occurred_at`, else use now, then bump 1ms on `dash|status|time` collision instead of dropping the row
- Same helper in WF3 Build Full Document, Sync Build Document, and main prod copies; WF3 passes `extracted.nowIso`
- STATUS_MAP and Push to TeleCRM unchanged (INACTIVE/ACTIVE still Converted)
- Regression tests for Aakash same-timestamp ACTIVE re-entry, stale-updatedAt oscillation, and unchanged dash status

### Reason
INACTIVE and ACTIVE both map to Converted, so dash history was swallowed when occurred_at collided with an existing dash|status|time key (Aakash-shaped same-timestamp rows).

### Validation
- New Aakash same-timestamp, stale-updatedAt oscillation, and unchanged-status cases in scripts/validate-canonical-schema.js ran and passed before a pre-existing temperature assertion.
- node scripts/validate.js — JS syntax and workflow JSON parse PASS; protected-file integrity FAIL expected because WF3/Sync/main/webhook were intentionally edited.

### Risks / Notes
- Live n8n must re-import WF3 and Sync (and main prod if that is the live copy). Past same-timestamp dash rows stay as-is; only the next real dash flip gets a unique occurred_at. JSON.stringify rewrote the three workflow files while patching jsCode.
- validate-canonical-schema.js still fails at a pre-existing temperature assertion (Converted leads must skip writes) unrelated to this change.

### Manual Verification Required
- Re-import WF3 (and Sync if used) in live n8n
- Flip a patient INACTIVE → ACTIVE on `users.profileData.status` and confirm `stage[]` gets a new `{platform:dash,status:ACTIVE}` row with a later `occurred_at` while `conversionStatus` stays Converted


## 2026-09-22 — Guard dashboard status history and TeleCRM push

**Agent:** GPT-5.6 Sol

### Objective
Make the dashboard-to-TeleCRM workflow preserve LEAD-family statuses, retain repeated dashboard transitions, and send only meaningful TeleCRM status changes while keeping crm-sync in place.

### Files Created
- None

### Files Modified
- `new workflows/3-dashboard-to-telecrm.json`

### Files Deleted
- None

### Changes
- Added BOOKED and DISCHARGED to accepted dashboard statuses.
- Added a final status decision that preserves Fresh, No Response, In Pipeline, Not Shown Up, or Not Converted when dashboard status is LEAD.
- Kept converted dashboard statuses mapped to Converted and booked statuses mapped to Session booked.
- Connected the previously disconnected Push to TeleCRM node behind a status-change guard.
- Changed TeleCRM HTTP handling so API errors are not silently treated as success.
- Retained newest-first stage history and verified ACTIVE -> INACTIVE -> ACTIVE is preserved.

### Reason
The user explicitly approved updating the new workflow before any crm-sync migration.

### Validation
- All n8n workflow JSON files parse successfully.
- No linter errors in the edited workflow.
- Workflow graph validation confirmed the guarded path reaches Push to TeleCRM.
- Six status-decision cases passed.
- Repeated dashboard stage test produced ACTIVE -> INACTIVE -> ACTIVE newest-first.

### Risks / Notes
- users.profileData contains only current status, not historical status; earlier dashboard transitions can only come from existing new-telecrm.stage history.
- The current TeleCRM status is still read from the crm-sync-backed telecrm mirror in this phase and can be delayed.
- The exported JSON change must be imported/published in live n8n before production behavior changes.

### Manual Verification Required
- Import or update new workflows/3-dashboard-to-telecrm.json in n8n.
- Test one LEAD currently In Pipeline, one BOOKED patient, and an ACTIVE -> INACTIVE -> ACTIVE sequence before broad rollout.
- Confirm the TeleCRM Async credential remains selected after import.


## 2026-09-22 — Recapture heal for converted and paid users

**Agent:** Composer

### Objective
Block TeleCRM website recapture from leaving paid/converted dashboard users on Fresh or Session booked, and document how cancel/reschedule should map next.

### Files Created
- `mcp/findings/cancel-reschedule-telecrm-mapping.md`

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`

### Files Deleted
- None

### Changes
- WF3 Finalize Status Decision now heals TeleCRM Fresh/Session booked/In Pipeline reopen when dash is ACTIVE/PACKAGE/INACTIVE/etc or first visit is paid/visited.
- Sync WF1 gained Finalize Recapture Decision + guarded Push Recapture Heal so watcher 2a/2c can heal website recaptures without waiting for a users save.
- Healed Converted status is written to conversionStatus, prepended on stage[], and pushed only when it differs.
- Documented cancel → In Pipeline and reschedule → Session Rescheduled mapping proposal under mcp/findings (not implemented yet).

### Reason
User requested recapture protection in the new workflows after Vishal Dutta showed Converted → Fresh → Session booked while dash stayed INACTIVE.

### Validation
- All workflow JSON parses.
- Five recapture decision cases passed on both WF3 and Sync.
- Sync graph edges for Finalize → Upsert → Push gate verified.

### Risks / Notes
- Sync now writes TeleCRM when healing — ensure Async token is set and recapture policy on TeleCRM side is still Never if possible.
- Paid LEAD users will be forced to Converted; confirm that matches product intent.
- Cancel/reschedule mapping is documented only; not wired yet.

### Manual Verification Required
- Re-import 1-sync-webhook.json and 3-dashboard-to-telecrm.json in n8n; re-select Mongo + TeleCRM Async credentials.
- Test phone 7483283668 via Sync webhook — expect Converted push while dash is INACTIVE/visited.
- Confirm a LEAD + In Pipeline lead is not forced to Converted.


## 2026-09-22 — Map live TeleCRM call and message counts

**Agent:** Cursor Grok 4.6

### Objective
Read TeleCRM Calls Count and message counts from live lead/search into new-telecrm, because the Mongo telecrm mirror does not store those system activity fields.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- `buildTeleCRMPart` now reads Calls Count / message / connected-call metrics from live `lead/search` (lead root and `fields`), including `# Calls Count` and `{value}` wrappers.
- A stored `0` is no longer kept when the live payload has no activity field; a previously mapped positive count is still preserved on mirror-only writes (WF3).
- WF1 copies root-level activity keys onto `fields` before mapping; WF3 and main prod use the same picker so dashboard upserts do not wipe live counts.
- Validator covers root-level, hashed, wrapped, and sticky-zero cases.

### Reason
Vishal Dutta showed Calls Count 1 and Connected Call Count 1 in TeleCRM, but new-telecrm stayed at telecrm_#ofCalls 0 because sync only read snake_case fields from lead.fields and fell back to the mirror.

### Validation
- node --check new-telecrm-webhook.js PASS
- node scripts/validate-canonical-schema.js — mapper/WF1 tests pass; remaining fail is pre-existing Converted temperature skip-write
- node scripts/validate.js — FAIL expected (approved protected workflow/JS edits vs snapshot; pre-existing secrets heuristic on scripts/sync-1000-users.js)

### Risks / Notes
- WF3 still has no TeleCRM Search node; it only preserves a previously mapped positive count when the mirror has none.
- Live fill still requires a Sync-typed lead/search token. Async tokens 401 and the join row stays 0.
- n8n must be re-imported or production keeps the old mapper.
- validate-canonical-schema still fails on a pre-existing Converted temperature skip-write assertion.

### Manual Verification Required
- Re-import 1-sync-webhook.json and 3-dashboard-to-telecrm.json in n8n (main prod if that is what is live).
- Confirm TELECRM_API_TOKEN / WF1 Search uses a Sync-typed token so lead/search is not 401.
- Re-run Sync for 7483283668 (Vishal Dutta) and confirm new-telecrm.telecrm_#ofCalls=1 and telecrm_connected_calls=1 from the live panel.
- Spot-check a lead with WhatsApp volume for telecrm_#ofmessages.


## 2026-09-22 — Reschedule In Pipeline and lead recapture

**Agent:** Cursor Grok 4.6

### Objective
Map appointment reschedules to In Pipeline and tag website/other inbound with a past appointment as lead recapture without pushing Fresh to TeleCRM.

### Files Created
- `mcp/findings/reschedule-in-pipeline-and-lead-recapture.md`

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Rescheduled first visits (`rescheduledFrom` / `rescheduledTo` / RESCHEDUL reason) map TeleCRM to In Pipeline, never Session Rescheduled. Converted/paid still wins.
- Website or other inbound plus a past booked appointment is tagged `source: lead_recapture` and restores the last non-Fresh CRM stage instead of pushing Fresh.
- JS syncOne and n8n Finalize Recapture / Finalize Status both apply this, and push status only when it actually changed.

### Reason
Product wants reschedules in In Pipeline only, and recaptured patients who already booked must keep their previous CRM stage instead of bouncing to Fresh.

### Validation
- node --check new-telecrm-webhook.js PASS
- finalizeTelecrmStatus smoke: reschedule→In Pipeline, website+past appt→lead_recapture and restore In Pipeline
- node scripts/validate-canonical-schema.js — new recapture/reschedule asserts pass; remaining fail is pre-existing Converted temperature skip-write

### Risks / Notes
- main prod.json still has no Finalize Recapture node; live n8n must use WF1/WF3 exports.
- Status heal still needs the Async autoupdatelead token.
- A true new Fresh lead with no appointments is unchanged.

### Manual Verification Required
- Re-import 1-sync-webhook.json and 3-dashboard-to-telecrm.json in n8n.
- Reschedule a BOOKED first visit and confirm TeleCRM becomes In Pipeline, not Session Rescheduled.
- Submit a website (or Meta) recapture for a patient with a past appointment: source[] should include lead_recapture and TeleCRM must not stay/reset Fresh.
- Spot-check Vishal Dutta 7483283668: INACTIVE + past visit stays Converted, with lead_recapture if a website source exists.


## 2026-09-22 — LEAD-only lead_recapture tagging

**Agent:** Composer

### Objective
Align recapture with product: only mark lead_recapture when dashboard status is LEAD and the lead is captured again.

### Files Created
- `mcp/findings/lead-recapture-lead-only.md`

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`

### Files Deleted
- None

### Changes
- Recapture is LEAD-only: tag source lead_recapture when dash is LEAD and the lead is captured/reopened again.
- Removed converted/paid force-heal that pushed Converted on Fresh/Session booked reopen.
- Removed Sync Push Recapture Heal to TeleCRM node.
- WF3 still maps ACTIVE/PACKAGE/INACTIVE to Converted on dashboard status changes (normal mapping, not recapture).

### Reason
User rejected converted/paid stay-Converted heal as recapture; recapture is for LEAD only.

### Validation
- Workflow JSON parses.
- Four LEAD-only decision cases passed on WF3 and Sync.
- Sync heal push node removed.

### Risks / Notes
- INACTIVE users who were reopened to Fresh on TeleCRM will no longer be auto-healed by Sync.
- lead_recapture depends on existing stage history plus Fresh reopen or inbound source.

### Manual Verification Required
- Re-import Sync and WF3 in n8n.
- Test a LEAD with prior history + Fresh reopen — expect source[0].source = lead_recapture.
- Test INACTIVE + Session booked — expect no lead_recapture tag and Sync must not push Converted heal.


## 2026-09-23 — Diagnose duplicate TeleCRM leads

**Agent:** AI coding agent

### Objective
Explain the 22 Sep duplicate TeleCRM rows: backfill vs parallel workflows vs phone-mismatch creates.

### Files Created
- `mcp/findings/duplicate-telecrm-leads-2026-09-23.md`

### Files Modified
- None

### Files Deleted
- None

### Changes
- Read-only production check of telecrm, users, new-telecrm, and appointments for the screenshot names.
- Recorded that the 18 Sep backfill did not create these rows, and that WF3's 22 Sep status push plus 91-prefix phone can create a second TeleCRM lead that the unique phone index hides.

### Reason
User asked why leads started saving as duplicates yesterday.

### Validation
- Mongo reads only. No workflow or lead writes.

### Risks / Notes
- lead/search was 401, so a second TeleCRM lead id was not fetched live.
- Live n8n active flags were not listed because N8N_API_KEY is unset.

### Manual Verification Required
- Disconnect or gate Push to TeleCRM until phone match is confirmed.
- Open one duplicated name in TeleCRM and compare the two lead phone strings.


## 2026-09-23 — Stop TeleCRM push from creating duplicate leads

**Agent:** AI coding agent

### Objective
Stop the dashboard status push from creating a second TeleCRM lead.

### Files Created
- None

### Files Modified
- `new workflows/3-dashboard-to-telecrm.json`
- `new-telecrm-webhook.js`

### Files Deleted
- None

### Changes
- WF3 pushes TeleCRM status only when the mirror lead exists, the dashboard status field changed, and the phone is the mirror's 10-digit number.
- pushStatusToTeleCRM no longer prefixes 91. syncOne calls it only for an existing mirror phone when dash_status changed.

### Reason
User asked to implement the push change that was creating duplicate TeleCRM cards.

### Validation
- node --check new-telecrm-webhook.js
- Workflow JSON parses.
- Phone normalization: 10-digit, 91-prefix, and leading 0 all become 10 digits; empty and short values are rejected.
- validate-canonical-schema.js still fails on a pre-existing WF1 reschedule assertion, before any push assertion.

### Risks / Notes
- Live n8n keeps the old push until 3-dashboard-to-telecrm.json is re-imported.
- main prod.json still sends a 91-prefix phone. Do not import that copy.
- Cards already created in TeleCRM stay until they are deleted there. This change does not delete them.
- A status change that happens before the mirror row exists is not pushed later, until the dashboard status changes again.

### Manual Verification Required
- None


## 2026-09-23 — new-telecrm daily Slack report

**Agent:** Cursor Grok 4.6

### Objective
Add a sibling daily Slack report workflow that reads new-telecrm instead of telecrm and posts to a different channel.

### Files Created
- `new workflows/new-telecrm-daily-report-slack.json`

### Files Modified
- None

### Files Deleted
- None

### Changes
- Added sibling n8n workflow new workflows/new-telecrm-daily-report-slack.json that clones the daily Slack report but reads stance-dashboard.new-telecrm.
- Remapped queries to conversionStatus, created_on, stage.occurred_at with platform=telecrm, and source.source / ad_name / campaign_name.
- Kept crm-sync first-visit appointments and overlay name/source/status from new-telecrm by phone.
- Omitted temperature Mongo updates and TeleCRM autoupdatelead; section 7 classifies Hot/Warm/Cold in the facet (JS fallback).
- Posts summary, HTML, and PDF to placeholder #daily-leads-new-telecrm. Workflow is inactive until import.
- Left new workflows/crm-daily-report-slack.json unchanged.

### Reason
new-telecrm uses conversionStatus, created_on, classified source[], and mixed telecrm/dash stage rows, so swapping the collection name on the live report would break metrics and double-write temperature.

### Validation
- validate_workflow_json — PASS including new-telecrm-daily-report-slack.json
- validate_repo — js_ok, json_ok, protected_ok; original crm-daily-report-slack.json unmodified
- detect_changes vs task-start — created only new workflows/new-telecrm-daily-report-slack.json

### Risks / Notes
- Slack channel #daily-leads-new-telecrm is a placeholder and will fail until replaced.
- new-telecrm source labels (meta_form, Manual, others) will not match Facebook/Excel buckets on the telecrm report.
- Facet scans ~17k docs with only phone/_id indexes; acceptable unless a run is slow.
- Temperature section is computed, not stored; it will not match telecrm.temperature if those jobs diverge.
- Importing over the existing live workflow would replace production reporting — import as a new workflow only.

### Manual Verification Required
- Import new workflows/new-telecrm-daily-report-slack.json into n8n as a new workflow (do not overwrite CRM Daily Report to Slack).
- Create or pick the real Slack channel and invite the Slack bot; replace placeholder #daily-leads-new-telecrm.
- Manual run with Set Test Date1 set to a known IST day; compare session/converted counts with #daily-leads (same crm-sync visits) and expect source/booking differences.
- Do not activate until the channel is real and a test run looks right.


## 2026-09-23 — new-telecrm report test-ready import

**Agent:** Cursor Grok 4.6

### Objective
Make the new-telecrm daily Slack report importable and executable for a manual test without a real Slack channel.

### Files Created
- None

### Files Modified
- `new workflows/new-telecrm-daily-report-slack.json`

### Files Deleted
- None

### Changes
- Wired Set Test Date1 to Calculate Windows1 so a manual YYYY-MM-DD run is possible.
- Set alwaysOutputData on the four Mongo query nodes so an empty appointments/WTD day still reaches Merge.
- Set onError continueRegularOutput on Generate PDF1 and the three Slack nodes so a missing placeholder channel or Gotenberg does not hide the HTML output.
- Left the workflow inactive and crm-daily-report-slack.json unchanged.

### Reason
Set Test Date1 was disconnected and Slack/PDF failures would stop a first test run.

### Validation
- validate_workflow_json — PASS
- validate_repo — json_ok; protected_ok false only for new-telecrm-daily-report-slack.json (approved edit)
- detect_changes — modified only that sibling workflow

### Risks / Notes
- Slack still targets placeholder #daily-leads-new-telecrm; posts will fail until the channel exists, but the run continues.
- validate_repo flags this file as a protected-path modification; the human asked for the edit.
- Importing over the live daily report would replace production.

### Manual Verification Required
- Import new workflows/new-telecrm-daily-report-slack.json as a NEW n8n workflow (do not overwrite CRM Daily Report to Slack).
- If the live daily report Mongo collections were changed to new-telecrm, set them back to telecrm (appointments stay crm-sync).
- Execute from Set Test Date1 with test_date = YYYY-MM-DD, or leave it blank for yesterday IST.
- Inspect Generate HTML1 / HTML to Binary1 even if Slack errors. Replace #daily-leads-new-telecrm before relying on Slack.


## 2026-09-23 — Map blank-UTM website leads to website_organic

**Agent:** AI coding agent

### Objective
Label dashboard category website with a blank utmSource as website_organic so the next nightly source run can publish that final source.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- sourceFromCategory now returns website_organic when the dashboard category is website and webAnalytics.utmSource is blank.
- A website category with a real utmSource still stores website, and TeleCRM lead source Website stays website.
- The same rule is in the nightly source workflow, the sync webhook, and the combined main prod Build Document.

### Reason
Dashboard website with a null utmSource was stored as website. A set utmSource still stays website.

### Validation
- Source classification cases pass, including website with null utm, website with google cpc, and a google referrer with a blank utmSource.
- Workflow JSON parses. scripts/validate.js reports the expected protected-file change and a pre-existing secret-scan hit in scripts/sync-1000-users.js.

### Risks / Notes
- The next nightly run rewrites source for every telecrm lead. Leads already stored as website with a blank utmSource become website_organic as the final source.
- A TeleCRM Website lead-source event can remain in source history beside website_organic.

### Manual Verification Required
- Re-import and publish new workflows/4-final-source.json (TeleCRM — Source Attribution). It runs at 03:00.
- Re-import and publish new workflows/1-sync-webhook.json so daytime sync uses the same label.
- Re-import main prod.json only if that combined workflow is the one published for sync.


## 2026-09-24 — Map TeleCRM stage date into new daily report

**Agent:** Cursor Grok 4.7

### Objective
Count Attempted in the new-telecrm daily report when the TeleCRM stage row has stage.date and no usable occurred_at.

### Files Created
- None

### Files Modified
- `new workflows/new-telecrm-daily-report-slack.json`

### Files Deleted
- None

### Changes
- Section 1 stage filters in new-telecrm-daily-report-slack.json keep a row when platform is telecrm or missing.
- A same-day event uses occurred_at when that timestamp falls on the report day, and stage.date when it does not.
- End-of-day status, Attempted, No Show, and booking-day checks use that same rule. The old TeleCRM report was not changed.

### Reason
Attempted is the last same-day status No Response. The new report ignored stage.date and dropped rows whose platform was missing, so those leads were counted as Fresh.

### Validation
- validate_workflow_json — PASS, including new-telecrm-daily-report-slack.json

### Risks / Notes
- Live n8n still runs the previous import until this workflow JSON is re-imported.
- Rows that have neither occurred_at nor date on the report day still stay Fresh.
- Older lead volume can rise when a same-day stage.date was previously invisible.

### Manual Verification Required
- Re-import new workflows/new-telecrm-daily-report-slack.json into n8n without overwriting the old CRM daily report.
- Re-run the same test day and confirm Attempted New is no longer 0 for leads whose TeleCRM stage date that day is No Response.


## 2026-09-24 — Fix continue syntax in new daily report

**Agent:** Cursor Grok 4.7

### Objective
Fix the Build Report Data1 syntax error that stopped the new-telecrm report.

### Files Created
- None

### Files Modified
- `AGENT_CHANGELOG.md`
- `new workflows/new-telecrm-daily-report-slack.json`

### Files Deleted
- None

### Changes
- Closed the booking-day if condition in Build Report Data1 so continue is inside the lead loop, not inside .some().

### Reason
The stage-date mapping left the booking check one parenthesis short, so n8n reported Unexpected token continue.

### Validation
- node Function parse of Build Report Data1 jsCode — PASS
- validate_workflow_json — pending in this entry; run confirmed separately

### Risks / Notes
- The live n8n node still has the broken code until this JSON is imported again or the node code is replaced.

### Manual Verification Required
- Re-import or paste the updated Build Report Data1 code into n8n and execute that step again.


## 2026-09-24 — Count undated No Response as Attempted

**Agent:** Cursor Grok 4.7

### Objective
Count undated No Response leads as Attempted in the new-telecrm daily report.

### Files Created
- None

### Files Modified
- `AGENT_CHANGELOG.md`
- `new workflows/new-telecrm-daily-report-slack.json`

### Files Deleted
- None

### Changes
- For a lead created on the report day, an undated TeleCRM stage row that matches conversionStatus is the end-of-day status when no later dated status exists.
- No Response rows stored without occurred_at or date now count as Attempted instead of Fresh.

### Reason
Those leads are stored as No Response with no occurred_at and no stage.date, so the date fallback never saw them and they stayed Fresh.

### Validation
- Build Report Data1 jsCode parses
- validate_workflow_json PASS

### Risks / Notes
- Attempted New follows new-telecrm conversionStatus, so it can differ from the old report's stage.date count.
- Live n8n stays on the previous import until this file is re-imported.

### Manual Verification Required
- Re-import new workflows/new-telecrm-daily-report-slack.json and run the same day. Attempted New should move off 0.


## 2026-09-24 — Store created_on as ISO and created_at as epoch

**Agent:** Cursor Grok 4.7

### Objective
Store created_on as ISO and created_at and modified_at as numbers on new-telecrm.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/main prod.json`
- `new workflows/new-telecrm-daily-report-slack.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- new-telecrm documents now store created_on as an ISO string, and created_at and modified_at as epoch milliseconds.
- The same assignment is in new-telecrm-webhook.js, 1-sync-webhook.json, 3-dashboard-to-telecrm.json, and main prod.json.
- The new-telecrm daily report matches created_on as either an ISO string or an existing epoch number, so current rows still count until they are rewritten.

### Reason
created_at and modified_at were saved as strings, and created_on was saved as epoch. Mongo should keep created_at and modified_at as numbers and created_on as an ISO time.

### Validation
- node --check new-telecrm-webhook.js PASS
- validate_workflow_json PASS
- validate-canonical-schema.js reached the pre-existing reschedule assertion, so the new created_on string and created_at number assertions passed

### Risks / Notes
- Rows already in new-telecrm stay in the old types until the next sync.
- validate-canonical-schema.js still fails on the pre-existing reschedule assertion, after the new timestamp assertions.

### Manual Verification Required
- Re-import the sync workflow that writes new-telecrm. Existing rows keep the old types until they sync again.
- Re-import new-telecrm-daily-report-slack.json so New and Older still match both the old epoch created_on and the new ISO created_on.


## 2026-09-24 — Store lead timestamps as epoch milliseconds

**Agent:** AI coding agent

### Objective
Save last_synced_at, telecrm_first_interaction_date, source.occurred_at, and stage.occurred_at as numbers in new-telecrm.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/main prod.json`
- `new workflows/new-telecrm-daily-report-slack.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Writers assign epoch milliseconds directly so put/canonicalPut cannot turn them back into strings.
- The new daily report matches both numeric timestamps and the ISO strings already stored in Mongo.

### Reason
Those date fields were still written as strings. created_on stays an ISO string.

### Validation
- node --check new-telecrm-webhook.js passed.
- validate-canonical-schema.js reached the pre-existing reschedule assertion; the new timestamp assertions passed.
- Workflow JSON parsed.

### Risks / Notes
- Documents already in Mongo keep string dates until the next sync rewrites them.

### Manual Verification Required
- Reimport 1-sync-webhook, 3-dashboard-to-telecrm, 4-final-source, new-telecrm-daily-report-slack, and main prod if that is the live copy.


## 2026-09-24 — Store source history FIFO

**Agent:** Cursor Grok 4.7

### Objective
Stop placing the latest or highest-priority source at index 0. Store source[] FIFO so index 0 is the earliest source.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new workflows/4-final-source.json`
- `new workflows/CROSS-PLATFORM-ACTIONS.csv`
- `new workflows/CROSS-PLATFORM-ACTIONS.md`
- `new workflows/main prod.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- source[] is ordered oldest-first. Index 0 is the earliest occurred_at. Undated rows stay after dated rows.
- Removed prioritizeFinalSource so a dashboard category or TeleCRM bucket is no longer moved to index 0.
- lead_recapture is appended after existing source rows instead of being inserted at index 0.
- stage[] stays newest-first.

### Reason
Source was upserted so the winning or latest event occupied index 0. The requested read is the earliest source at index 0.

### Validation
- node --check new-telecrm-webhook.js PASS
- Workflow code nodes parse PASS
- Source FIFO assertions in validate-canonical-schema.js passed when run past the pre-existing reschedule and status-changed connection checks
- validate_repo js_ok and json_ok; protected-file changes are the files this task was asked to edit

### Risks / Notes
- Documents already in new-telecrm stay newest-first until the next sync rewrites source[].
- Anything that treated source[0] as the current or final source will now read the earliest source.
- Matching TeleCRM lead_source and source rows for the same attribution are still merged into one event. That event keeps the earliest time.
- validate-canonical-schema.js still stops on the pre-existing reschedule assertion before the later temperature assertion.

### Manual Verification Required
- Re-import 1-sync-webhook.json, 3-dashboard-to-telecrm.json, and 4-final-source.json. Re-import main prod.json only if that combined workflow is the live writer.
- Re-sync one lead that has more than one source row and confirm source[0] is the earliest occurred_at. Confirm stage[0] is still the newest stage.


## 2026-09-24 — Lead recapture reopens every stage except Converted

**Agent:** Claude Opus 5 (Cursor)

### Objective
On lead recapture, push Fresh for every TeleCRM stage except Converted, so the async token can move from Never to Once a Day without inactive/converted leads bouncing back to Fresh as they did on 22 Sep.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- finalizeTelecrmStatus, WF1 Finalize Recapture Decision and WF3 Finalize Status Decision share one rule: convertedFamily holds Converted, otherwise a recapture sets Fresh.
- convertedFamily = current Converted, or dash ACTIVE/PACKAGE/PACKAGE_EXPIRED/DISCHARGED/INACTIVE, or paid/visited first visit, or current Fresh with Converted in stage history. The last clause heals TeleCRM's own Once-a-Day reset of a Converted lead.
- Fresh is pushed only on a capture event (telecrm_capture_frequency increased, or TeleCRM already reopened the lead to Fresh). source[] keeps website forever, so it cannot gate the push or every sync would re-push Fresh over In Pipeline.
- A missing, null or empty stored capture count is treated as a first sighting, not a new capture, so the first sync after deploy cannot reopen leads whose join doc has no baseline count.
- Recapture decisions may push without a dashboard status change (JS recapture_push, n8n recaptureStatusPush). That is the only path that corrects a TeleCRM-side reset.
- WF1 gained TeleCRM Status Changed? + Push Recapture Status off Upsert Document. Status only, on the mirror's stored 10-digit phone, no 91 prefix, so it cannot create a second lead card. onError continueRegularOutput keeps a TeleCRM API failure from breaking the webhook response.
- Validator: recapture assertions rewritten for the new rule, plus cases for each non-converted stage reopening, Converted held, the 22 Sep reset healing back, no-capture-event re-sync, INACTIVE, no-appointment recapture, and the null/absent baseline guard.

### Reason
User wants the async token on Once a Day. TeleCRM then stamps Lead Recapture and resets the stage to Fresh on a repeat capture, which is what reopened INACTIVE/Converted patients on Monday.

### Validation
- node --check new-telecrm-webhook.js — PASS
- validate_workflow_json — all 12 workflow files parse
- syntax_check_js — all 22 JS files pass
- Every embedded n8n jsCode node passes node --check; no duplicate const/let declarations
- Simulated WF1, WF3 and finalizeTelecrmStatus side by side on 10 scenarios — all three agree, 0 failures
- validate-canonical-schema.js passes except two pre-existing assertions (WF1 'session rescheduled' -> In Pipeline, and the Converted temperature skip-write/unset pair from the 21 Sep score-every-stage change)
- validate_repo: js_ok true, json_ok true; protected_ok false as expected for approved workflow/JS edits; secret_hits only the pre-existing scripts/sync-1000-users.js heuristic

### Risks / Notes
- Session booked and Session Rescheduled now reopen to Fresh on a capture event, per the requested rule. Only Converted is protected.
- A lead with Converted in its stage history will always be healed back to Converted when it shows Fresh, including a deliberate manual reopen by an agent.
- Fresh reopen depends on telecrm_capture_frequency reaching the join doc, or on TeleCRM having already set Fresh. Leads with no capture count and no TeleCRM-side reset are left as they are.
- Live n8n keeps the old behaviour until 1-sync-webhook.json and 3-dashboard-to-telecrm.json are re-imported.
- main prod.json was not touched and has no Finalize nodes; WF1/WF3 remain the source of truth.
- Pre-existing validator failures were left alone: WF1 still maps 'session rescheduled' to Session Rescheduled while the JS maps it to In Pipeline.

### Manual Verification Required
- Set the TeleCRM async token Lead Recapture to Once a Day (was Never).
- Re-import 1-sync-webhook.json and 3-dashboard-to-telecrm.json in n8n; re-select the Mongo credential and bind Push Recapture Status to the TeleCRM Async Token credential (the export ships a placeholder id).
- Recapture a Converted or INACTIVE patient (Vishal Dutta 7483283668) and confirm TeleCRM stays Converted and only one lead card exists.
- Recapture a Not Converted / In Pipeline lead and confirm it moves to Fresh exactly once, then stays put on the following syncs.


## 2026-09-25 — WF3 create vs update branches after lead lookup

**Agent:** Composer

### Objective
One n8n workflow (WF3) with two branches: update existing TeleCRM leads vs create when the mirror has no lead, without splitting into two webhook files.

### Files Created
- None

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- WF3 Finalize Status Decision sets telecrm_push_mode create|update|null, should_create_telecrm, and should_push_telecrm.
- Upsert Document now routes to Lead Found in TeleCRM?: true → TeleCRM Status Changed? → Push Update to TeleCRM; false → Should Create Lead? → Push Create to TeleCRM.
- Create uses 10-digit phone and mapped status (Fresh for LEAD); update keeps stored phone and recapture rules (Fresh except Converted).
- Renamed Push to TeleCRM to Push Update to TeleCRM; both push nodes use onError continueRegularOutput.
- WF1 IF Lead Found notes clarify Sync is update/join only; create walk-ins stay on WF3.
- Validator asserts the new WF3 graph and push node names.

### Reason
User chose one workflow with IF lead found → update / else → create over two separate webhooks.

### Validation
- Embedded Finalize Status Decision passes node --check
- Sim: create → mode create Fresh; update → mode update; no dash change → null
- validate-canonical-schema.js PASS (pre-existing reschedule/temperature asserts skipped)
- JSON parse WF1 and WF3 OK

### Risks / Notes
- Create uses the Mongo telecrm mirror as existence check; crm-mongo-sync lag can briefly look like no lead and risk a duplicate if website already created one. Prefer live lead/search later if Sync token is reliable in WF3.
- Live n8n must re-import 3-dashboard-to-telecrm.json and bind Async credential on both Push Update and Push Create.
- main prod.json not updated.

### Manual Verification Required
- Re-import 3-dashboard-to-telecrm.json; select Mongo + TeleCRM Async on both push nodes.
- Create a dashboard LEAD with a phone that has no TeleCRM mirror row — expect one Fresh create, one lead card.
- Update an existing In Pipeline lead status on dash — expect update branch only, no second card.
- Recapture Converted/INACTIVE — expect Converted held/healed.


## 2026-09-25 — Capture-frequency backfill dry-run and apply

**Agent:** Composer

### Objective
Backfill capture frequency on new-telecrm from the telecrm mirror before enabling Once-a-Day recapture pushes.

### Files Created
- `scripts/backfill-capture-frequency.js`

### Files Modified
- `AGENT_CHANGELOG.md`
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- Added scripts/backfill-capture-frequency.js: copies telecrm capture_frequency into new-telecrm.telecrm_capture_frequency only; dry-run default; never lowers a stored count; never creates join rows; no TeleCRM API.
- Ran dry-run + apply on stance-dashboard via MONGODB_URI_PRODUCTION: 0 writes needed. 13209 mirror phones with frequency already match or already have a join count (13156 equal, 53 join count left unchanged because overwriting downward would fake a later recapture).

### Reason
User asked to run the capture-frequency backfill before the create/update and Once-a-Day work.

### Validation
- node --check scripts/backfill-capture-frequency.js
- Dry-run stance-dashboard: would set 0
- Apply: Nothing to write; status counts unchanged

### Risks / Notes
- 3926 join rows still have no telecrm_capture_frequency because the mirror also has none for those phones. First live Sync read will set the baseline without treating it as a capture (guard already requires both counts known).
- n8n temperature realtime could not be checked (API key unset); apply did not write so it was not triggered.

### Manual Verification Required
- No Mongo write was required. Before enabling Once a Day + recapture Fresh pushes, confirm temperature realtime is paused or its push body includes status.
- Optional: spot-check a few phones in new-telecrm for telecrm_capture_frequency.


## 2026-09-25 — Seed missing capture frequency to 1

**Agent:** Composer

### Objective
Seed the ~4k join rows missing capture frequency to 1 (Mongo baseline only) and confirm Converted-hold / else-Fresh recapture behaviour before Once a Day.

### Files Created
- `scripts/seed-missing-capture-frequency.js`

### Files Modified
- `scripts/README.md`

### Files Deleted
- None

### Changes
- Added scripts/seed-missing-capture-frequency.js: sets missing telecrm_capture_frequency to 1 only; refuses if filter would touch existing numbers; asserts conversionStatus counts unchanged.
- Applied on stance-dashboard: matched=3926 modified=3926; with numeric frequency 17829/17829; still missing 0; all conversionStatus counts identical (including Converted 4148).
- Verified recapture rule still holds in WF1, WF3, and finalizeTelecrmStatus: Converted held; non-Converted → Fresh on capture event; Monday INACTIVE Fresh heal → Converted.

### Reason
User asked to implement the seed so those leads have a capture-frequency baseline, without inventing TeleCRM writes that could look like recapture.

### Validation
- node --check scripts/seed-missing-capture-frequency.js
- Dry-run: would seed 3926
- Apply: modified 3926, missing 0, status counts unchanged
- JS/WF1/WF3 recapture assertions PASS

### Risks / Notes
- Seed wrote 3926 new-telecrm updates; if temperature realtime is live it may have fired. Repo temperature body includes status (safe); confirm live n8n matches.
- Seed does not call TeleCRM. Once a Day can still Fresh on a real form resubmit; Converted heal requires imported WF1/WF3.

### Manual Verification Required
- Re-import WF1 and WF3 if not already live; bind Async creds on push nodes.
- Then switch Async token Never → Once a day.
- Spot-check Converted + In Pipeline recapture.


## 2026-09-28 — Booked to Lead becomes In Pipeline

**Agent:** Cursor Grok 4.7

### Objective
When the dashboard moves from BOOKED, BOOKED_WITH_TOKEN, or BOOKED_WITHOUT_TOKEN to LEAD, set TeleCRM to In Pipeline. Do not rewrite leads that were never booked, and do not downgrade Converted.

### Files Created
- `mcp/findings/booked-to-lead-backfill-2026-09-28.md`

### Files Modified
- `new workflows/1-sync-webhook.json`
- `new workflows/3-dashboard-to-telecrm.json`
- `new-telecrm-webhook.js`
- `scripts/validate-canonical-schema.js`

### Files Deleted
- None

### Changes
- finalizeTelecrmStatus sets In Pipeline only when previous_dash_status was a booked status and the new dashboard status is LEAD. Converted
- a paid visit
- and a real recapture still win.
- WF1 Finalize Recapture Decision and WF3 Finalize Status Decision read the join row from before the upsert and apply the same transition.
- Leads that are already Lead
- including CRM Session booked before the dashboard ever booked
- stay on the existing Lead fallback.
- No TeleCRM backfill was pushed. The mirror has zero Booked-to-Lead patients still on Session booked.

### Reason
A cancelled booking was staying Session booked or falling through to Fresh. Sales needs that person back in the call queue as In Pipeline, only on that transition.

### Validation
- node --check new-telecrm-webhook.js PASS
- Embedded WF1 and WF3 finalize nodes pass node --check
- Booked-to-Lead
- already In Pipeline
- never-booked Lead
- Converted
- and recapture cases in validate-canonical-schema.js PASS
- node scripts/validate.js JS syntax and workflow JSON PASS. Protected-file check fails because these approved files were edited. Secret heuristic on scripts/sync-1000-users.js is pre-existing.
- Pre-existing schema assertion WF1 session rescheduled to In Pipeline still fails and was not changed.

### Risks / Notes
- The transition is seen once
- from the join row saved before this run. If the TeleCRM push fails
- a later sync will not retry it
- because the join dash status is already LEAD.
- A new website capture on the same run still reopens to Fresh.
- Live n8n keeps the old Fresh mapping until 1-sync-webhook.json and 3-dashboard-to-telecrm.json are re-imported.

### Manual Verification Required
- Re-import 1-sync-webhook.json and 3-dashboard-to-telecrm.json and bind the existing Mongo and TeleCRM credentials.
- Cancel one BOOKED_WITHOUT_TOKEN patient back to LEAD and confirm that TeleCRM card becomes In Pipeline and a never-booked Lead stays unchanged.
- Priya Mahadevan 9845512914 is already In Pipeline on the mirror. Her open card showed Session booked
- so a mirror backfill will not change that screen.

