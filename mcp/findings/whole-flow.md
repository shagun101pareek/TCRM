# TeleCRM × MongoDB whole flow

Snapshot: 2 Sep 2026. Database `stance-dashboard` (Atlas, read-only).  
This is the MCP map of **how data moves**, not a UTM list. Unique UTMs: [unique-utm-sources.md](./unique-utm-sources.md).

Existing workflow specs in `new workflows/` are the design. This file adds **what is actually in Mongo today**.

---

## 1. Three surfaces (do not treat as one system)

| Surface | What it is | Where the data lives | Who uses it |
|---|---|---|---|
| **TeleCRM** | Call-centre CRM (SaaS) | TeleCRM cloud: UI + `lead/search` + `autoupdatelead` | Agents |
| **Stance Dashboard** | Clinic ops | Mongo `users`, `appointments`, `reports`, `events`, `centers`, `web_visitors`, `web_touchpoints` | Front desk / clinicians |
| **Join / reporting** | One row per 10-digit phone | **Designed:** `new-telecrm`. **Live today:** `crm_sync_materialized` (17,024 docs). `new-telecrm` = **0 docs**. | Analytics |

Join key is always a **10-digit phone** (`0…` / `91…` stripped when length is 11 / 12).

`telecrm` in Mongo is a **mirror** of the CRM, used as a change-detection trigger. It is not the live lead. When the JS watcher fires, it takes the phone from the mirror and **re-fetches the lead from the TeleCRM API**.

---

## 2. How TeleCRM gets data (into the CRM)

Leads are created **inside TeleCRM**, not by Mongo.

| Channel | What lands in TeleCRM | How we see it in Mongo `telecrm` |
|---|---|---|
| Excel import | `lead_source = Excel` | 10,546 docs (largest bucket) |
| Website form | `lead_source = Website` | 4,213 docs |
| Meta / Facebook lead form | `lead_source = Facebook` + campaign / ad / lead_id on `source[]` | 1,945 docs |
| WhatsApp Cloud API / CTWA | `lead_source = Whatsapp Cloud API`, `ctwa_id` | 298 docs |
| Manual create in CRM UI | `lead_source = Manual` | 19 docs |
| Call logs | `lead_source = Call Logs` | 1 doc |
| Agent edits (stage, name, assignee, temperature) | CRM fields update | Copied on next crm-mongo-sync |
| **Stance WF3** `autoupdatelead` | Pushes `status` + `name` from dashboard lifecycle | Mirror updates → watcher 2a would re-sync join |
| Nightly temperature job | POSTs `hot` / `warm` / `cold` | Mirror `temperature` |
| Reconcile job | Session booked / Converted **only if CRM is still Fresh** | Mirror `status` |
| Opt-in `NEW_TELECRM_PUSH_SOURCE=true` | Derived `source` written back | Default **off** |

TeleCRM **does not store website `utm_source`**. Capture method (`lead_source`) and marketing bucket (`source[].value`) are CRM fields. UTMs live only on Stance web tracking.

---

## 3. How Mongo gets TeleCRM data

```
TeleCRM cloud (source of truth for CRM fields)
    │
    ├─► crm-mongo-sync job ──► Mongo collection `telecrm`   (mirror, 17,023 docs)
    │
    ├─► outbound webhook POST /webhook/telecrm  (if pointed at this host)
    │         │
    │         ▼
    │   Sync (1)  ── fetch lead/search API by 91+phone
    │         │
    └─► Watcher 2a (change stream on `telecrm`)
              │     trigger only — does not read lead fields from the mirror
              ▼
        Sync (1) / syncOne(phone)
              │
              ├─► TeleCRM API lead/search     (fresh CRM fields)
              ├─► users / appointments / centers / reports / events
              └─► web_visitors + web_touchpoints
                    │
                    ▼
              upsert `new-telecrm`   ← LIVE COUNT = 0
```

**Live implication:** the join collection the new workflows write (`new-telecrm`) is empty. Watcher resume tokens in `new_telecrm_watch_state` last updated **25 Aug 2026** (~8 days stale). The pipeline is designed and has run before; it is not currently filling the join.

What *is* populated: `telecrm` mirror + `crm_sync_materialized` (older join used for reporting: 17,024 rows, **6,545 with a dashboard `userId`**, 10,479 CRM-only).

---

## 4. How Stance / website data gets into Mongo

These collections are written by the Stance app and the website tracker, independent of TeleCRM.

| Collection | Docs (2 Sep 2026) | Written when |
|---|---:|---|
| `users` | 6,592 | Patient / staff created or saved on dashboard |
| `appointments` | 83,405 | Book / pay / visit / cancel |
| `web_visitors` | 5,727 | Anonymous site visitor; `patient_id` set when linked (290 linked) |
| `web_touchpoints` | 13,723 | Each pageview (UTM on the hit) |
| `centers`, `reports`, `events` | (ops) | Clinic master data + assessments + calendar |

`users` by type: PATIENT 6,429 · CONSULTANT 116 · STAFF 33 · CENTER_HEAD 12 · ADMIN 2.

Dashboard `profileData.status`: INACTIVE 5,130 · PACKAGE 563 · ACTIVE 267 · PACKAGE_EXPIRED 180 · BOOKED_WITHOUT_TOKEN 137 · LEAD 132 · BOOKED_WITH_TOKEN 20 · null 163.

---

## 5. Pipelines that move data between surfaces

| # | Trigger | Reads | Writes TeleCRM? | Writes `new-telecrm`? | Writes `users`? | Live status |
|---|---|---|---|---|---|---|
| **1 Sync** | Webhook POST with a phone, or watchers | TeleCRM API + dash collections | No (unless `PUSH_SOURCE`) | Yes — full upsert | **No** | Code exists; join empty |
| **2a** | Change on Mongo `telecrm` | Phone only, then API | No | Via (1) | No | Resume token 25 Aug |
| **2b** | Change on `users` | Phone | No | Via (1) | No | Resume token 25 Aug |
| **2c** | Change on `appointments` | `patient` → users.phone | No | Via (1) | No | Resume token 25 Aug |
| **2d** | Change on `web_visitors` | `patient_id` → users.phone | No | Via (1) | No | Resume token 25 Aug; no-op if no patient_id |
| **3 WF3** | `users` insert/update | dash status + name | **Yes** — `status` + `name` via `autoupdatelead` | Yes | No | Highest overwrite risk (LEAD → Fresh) |
| **Temperature** | Nightly 02:00 over Mongo `telecrm` | Mirror activity fields | **Yes** — temperature only | Temp fields only | No | Converted leads skipped |
| **Reconcile** | Manual | Mirror `status` + appointments | **Yes** if still Fresh | No | No | Conservative |

JS watcher debounce = 1.5s per phone. n8n watchers have no debounce.

Sync **never** writes `users.profileData.status`. Stance owns clinic lifecycle. TeleCRM owns call-centre outcomes until Stance reaches BOOKED_* / ACTIVE / PACKAGE.

---

## 6. Status mapping (two fields, not one)

On the join doc (when it exists):

| Field | Comes from | Meaning |
|---|---|---|
| `conversionStatus` | TeleCRM `lead.status` | Fresh, In Pipeline, Session booked, Session Rescheduled, Converted, No Response, Not Shown Up, Not Converted |
| `dash_status` | `users.profileData.status` | LEAD, BOOKED_WITH_TOKEN, BOOKED_WITHOUT_TOKEN, ACTIVE, PACKAGE, PACKAGE_EXPIRED, INACTIVE |

WF3 map (dashboard → CRM): LEAD→Fresh · BOOKED_*→Session booked · ACTIVE/PACKAGE→Converted · PACKAGE_EXPIRED/INACTIVE→Not Converted.

Converted on CRM + LEAD on dash is **expected** (clinic has not advanced lifecycle).

### Live TeleCRM `status` on the mirror

| status | Leads |
|---:|---:|
| Not Converted | 11,760 |
| Converted | 3,871 |
| No Response | 545 |
| Fresh | 384 |
| In Pipeline | 350 |
| Session booked | 92 |
| Not Shown Up | 20 |
| (null) | 1 |

---

## 7. Attribution: CRM source vs website UTM

These are different questions. Do not mix them.

```
Website pageview
  → web_touchpoints.utm_source
  → copied onto web_visitors.first_utm_source / last_utm_source
  → Sync builds source[] entry with platform = "dash"

TeleCRM lead create
  → fields.lead_source (Excel / Website / Facebook / …)
  → fields.source / campaign / ad (marketing bucket + Meta form meta)
  → crm-mongo-sync copies onto Mongo telecrm.lead_source and telecrm.source[]
  → Sync builds source[] entry with platform = "telecrm"
```

Join path for “UTM of a TeleCRM lead”:

`web_visitors.patient_id` → `users._id` → `users.phone` = `telecrm.phone`

Most CRM leads never hit the website tracker (Excel / Facebook form / CTWA). Only ~283 TeleCRM phones currently match a linked web visitor.

---

## 8. What is true in Mongo right now vs the design

| Designed | Live (2 Sep 2026) |
|---|---|
| `new-telecrm` is the join / reporting record | **0 documents** |
| Watchers 2a–2d keep the join fresh | Resume tokens idle since **25 Aug 2026** |
| Sync reads TeleCRM API, not the mirror | Mirror `telecrm` is populated (17,023) and is what reporting uses today |
| `crm_sync_materialized` is a materialised view of the old join | 17,024 docs; 6,545 linked to a dashboard user |
| Website UTM on the join as `source[]` dash entry | UTMs exist on `web_visitors` / `web_touchpoints` only |

---

## 9. Loop (one dashboard save)

```
Dashboard user save
  ├─► 2b watcher ──► Sync (1) ──► TeleCRM search ──► upsert new-telecrm
  └─► WF3 ──► upsert new-telecrm ──► autoupdatelead (status+name)
                                              │
                                              ▼
                                    TeleCRM lead changes
                                              │
                         webhook and/or telecrm mirror ──► Sync (1) again
```

Sync does not write `users`, so WF3 does not fire a second time from that loop. Damage happens if WF3 already downgraded CRM (Fresh over In Pipeline); the second sync then copies the wrong Fresh onto `conversionStatus`.

---

## 10. Repo files (do not edit from MCP work)

| File | Role |
|---|---|
| `new-telecrm-webhook.js` | Sync (1) — API fetch + dash join + upsert `new-telecrm` |
| `new-telecrm-watcher.js` | Change streams 2a–2d → `syncOne(phone)` |
| `reconcile-telecrm-stage.js` | Fresh-only CRM stage heal |
| `new workflows/1-sync-webhook.json` | n8n Sync (1) |
| `new workflows/2a`–`2d` | n8n watchers |
| `new workflows/3-dashboard-to-telecrm.json` | WF3 push |
| `new workflows/FIELD-FLOW.md` | Field-level mermaid |
| `new workflows/CROSS-PLATFORM-ACTIONS.md` | Action matrix |
| `new workflows/FIELD-DICTIONARY.csv` | Every join field |

MCP findings stay under `mcp/findings/`. Never write connection strings here.
