# Cross-platform action matrix — TeleCRM × Stance Dashboard × `new-telecrm`

What to expect when someone acts on **one** of the three surfaces, and what to check on the other two.

Companion docs: [STATUS-MAPPING.md](./STATUS-MAPPING.md) (status mapping) · [FIELD-DICTIONARY.csv](./FIELD-DICTIONARY.csv) (every join field) · [FIELD-FLOW.md](./FIELD-FLOW.md) (mermaid) · [EDGE-CASES.md](./EDGE-CASES.md) (bugs and gaps).

---

## The three surfaces

| Surface | What it is | Collections / APIs | Who uses it |
|---|---|---|---|
| **TeleCRM** | Call-centre CRM | TeleCRM UI + API (`lead/search`, `autoupdatelead`). Mongo `telecrm` is a **mirror** of CRM, used as a trigger — not the live lead. | Agents |
| **Stance Dashboard** | Clinic ops | `users`, `appointments`, `reports`, `events`, `centers`, `web_visitors`, `web_touchpoints` | Front desk / clinicians |
| **`new-telecrm`** | Join / reporting record | One doc per 10-digit phone. Holds `conversionStatus` (TeleCRM stage) **and** `dash_status` (Stance lifecycle) plus `source[]` / `stage[]`. | Internal dashboards / analytics |

Join key is always a **10-digit phone** (`0…` / `91…` stripped when length is 11 / 12).

### Ownership (by design)

1. **Stance owns clinic lifecycle** on `users.profileData.status`. Sync **never** writes that field.
2. **TeleCRM owns call-centre outcomes** (In Pipeline, No Response, Not Shown Up, Not Converted) until Stance reaches a booked/converted lifecycle.
3. **`new-telecrm` is a copy**, not a source of truth. Last writer wins on overlapping fields.

### Pipelines that move data

| # | Trigger | Writes TeleCRM? | Writes `new-telecrm`? | Writes Stance `users`? |
|---|---|---|---|---|
| **1** Sync webhook | POST `/webhook/telecrm` (or n8n `telecrm`) with a phone | No (unless `NEW_TELECRM_PUSH_SOURCE=true`) | Yes — full join from TeleCRM API + dash collections | **No** |
| **2a–2d** Watchers | Change on `telecrm` / `users` / `appointments` / `web_visitors` | No | Indirect — they **re-call sync (1)** | No |
| **3** Dashboard → TeleCRM | Change stream on `users` insert/update | **Yes** — `status` + `name` via `autoupdatelead` | Yes | No |
| **Temperature** | Nightly 02:00 + realtime: live `lead/search`, then `autoupdatelead` | **Yes** — `phone` + current `status` + `temperature`, except Converted and Not Converted | Yes — temp fields for every open stage that has a score | No |
| **Reconcile** | Manual job | **Yes** — only if TeleCRM still `Fresh` | No (until a later sync) | No |
| JS webhook / watcher | Same as 1 + 2, with 1.5s debounce and smarter user pick | Same as 1 | Same as 1 | No |

n8n watchers have **no debounce**. The JS watcher does.

---

## How to read a test row

For every action: perform it on the origin, wait for n8n/JS (and ~1.5s if using the JS watcher), then assert the three columns.

Legend for **risk**:

- **safe** — copies data, does not overwrite the other platform’s owned field
- **overwrite** — can rewrite TeleCRM stage (or join-doc shape) incorrectly
- **no-op** — pipeline exits; other platforms unchanged
- **gap** — product-relevant signal is dropped
- **loop** — can bounce between systems (usually idempotent, sometimes not)

---

## A. Action originates in TeleCRM (agent)

Sync (1) always: search TeleCRM API by `91` + 10-digit phone → join Stance by phone → upsert `new-telecrm`. It does **not** update `users.profileData.status`.

| # | Agent action | TeleCRM | `new-telecrm` | Stance Dashboard (`users` / appointments UI) | Risk | How to test |
|---|---|---|---|---|---|---|
| A1 | Create a new lead (Fresh) | Lead exists | Insert if missing. `conversionStatus=Fresh`. `stage[]` seeded Fresh then current. Dash fields null if no Stance user. | Unchanged. No new patient is created. | safe | Create lead → confirm join doc; confirm no `users` insert. |
| A2 | Change stage (e.g. Fresh → In Pipeline) | Stage updates | `conversionStatus` = new stage. `stage[]` appends `{platform:telecrm, status}` only if it **changed**. | **Unchanged.** Patient stays `LEAD` (or whatever they were). | safe | Change stage → join `conversionStatus`; `users.profileData.status` identical to before. |
| A3 | Mark Converted | Converted | `conversionStatus=Converted`. `isConverted` still comes from **first-visit appointments**, not this stage. | Unchanged. Does **not** become `ACTIVE`. | safe (by design) | Converted + still LEAD on dash is expected. |
| A4 | Mark No Response / Not Shown Up / Not Converted | That stage | Copied to `conversionStatus` | Unchanged | safe | Same as A2. |
| A5 | Session booked / Session Rescheduled | That stage | Copied | Unchanged. Does **not** become `BOOKED_*`. | safe | Calendar on Stance is independent. |
| A6 | Edit name, city, branch, health concern, assignee | Fields update | Copied (`name`, `telecrm_form_*`, assignee history appends on assignee change) | Unchanged | safe | Assignee history grows only on change. |
| A7 | Log a call / WhatsApp | Activity on CRM | `#ofCalls` / `#ofmessages` are **not** refreshed from search API (kept 0 or previous) | Unchanged | gap | Counts on join stay stale. Temperature may still use Mongo `telecrm` if crm-mongo-sync copies activity. |
| A8 | Set temperature on the lead | Temperature on CRM | Sync copies `lead_temperature` from API `fields.temperature` | Unchanged | safe | Nightly job may overwrite this later. |
| A9 | Duplicate leads, same phone | Both exist | Sync always takes **`data[0]`** — arbitrary | Unchanged | gap | Create two leads; see which stage lands on join. |
| A10 | Phone format `+91…` / `0…` | Stored as CRM stores it | Normalized to 10 digits for the join key | Match only if `users.phone` is the same 10-digit string | gap | `91`+10 and numeric phone on Stance can miss. |
| A11 | Lead with no Stance user | Exists | Dash_* null, `isConverted=false`. **n8n WF1** may **abort** if Aggregate Appointments returns no rows (`alwaysOutputData` missing). JS webhook still upserts. | Unchanged | gap (n8n) | Fresh-only lead: confirm join upserts in JS; confirm n8n does not stall. |
| A12 | TeleCRM webhook never arrives | CRM has the change | Join stale until watcher 2a (`telecrm` mirror) or a manual sync | Unchanged | gap | Rely on crm-mongo-sync + 2a, or JS watcher on `telecrm`. |

**Expected pairs that look “wrong” but are OK**

| TeleCRM | Stance | Why |
|---|---|---|
| Converted | `LEAD` | CRM converted; clinic has not advanced lifecycle. |
| Session booked | `LEAD` | Booked in CRM before Stance flipped to `BOOKED_*`. |
| In Pipeline | `LEAD` | Sales working; still a lead on Stance. |

---

## B. Action originates on Stance Dashboard (user profile)

Two pipelines can fire on the **same** `users` write:

1. **Watcher 2b** → sync (1) → refresh join from TeleCRM API + dash (does not push stage).
2. **Workflow 3** → map `profileData.status` → upsert join → **POST TeleCRM `status` + `name`**.

Workflow 3 on **update** uses `modified['profileData.status'] || current status`. So **any** user save (name, center, notes) still pushes the mapped TeleCRM stage. That is the highest-risk path.

| Dash `profileData.status` | TeleCRM stage WF3 pushes |
|---|---|
| `LEAD` | **Fresh** |
| `BOOKED_WITH_TOKEN` / `BOOKED_WITHOUT_TOKEN` | **Session booked** |
| `ACTIVE` / `PACKAGE` | **Converted** |
| `PACKAGE_EXPIRED` / `INACTIVE` | **Converted** |
| anything else | workflow exits (no-op) |

| # | Dashboard action | TeleCRM | `new-telecrm` | Stance Dashboard | Risk | How to test |
|---|---|---|---|---|---|---|
| B1 | Create patient, status `LEAD`, phone matches a CRM lead | WF3 pushes **Fresh**. If CRM was already In Pipeline / Converted, **that stage is wiped**. | `dash_status=LEAD`, `conversionStatus=Fresh` (from WF3), then sync may copy whatever CRM now is | New `users` doc | **overwrite** | Start with In Pipeline on CRM; create/save LEAD user; CRM must **not** become Fresh (today it will). |
| B2 | Create patient, **no** TeleCRM lead | `autoupdatelead` may **create** a lead (TeleCRM behaviour) with Fresh + name | Upserted anyway | New user | partial | Walk-in: confirm whether CRM gets a new lead. Sync (1) 404s if search finds nothing; WF3 still wrote join. |
| B3 | Change status LEAD → `BOOKED_WITH_TOKEN` | Pushed **Session booked** | `dash_status` + `conversionStatus=Session booked`; `stage[]` dash entry appended | Status on user | overwrite if CRM was Rescheduled / Not Shown Up | Book with token; CRM should be Session booked unless previous was Rescheduled (product: leave Rescheduled). |
| B4 | Same for `BOOKED_WITHOUT_TOKEN` | Same **Session booked** (no token split on CRM) | `dash_status` keeps WITH vs WITHOUT | Status on user | safe (collapsed by design) | Both token types → same CRM stage; join still shows real dash status. |
| B5 | Status → `ACTIVE` or `PACKAGE` | Pushed **Converted** | `isConverted=true` (WF3 definition: ACTIVE/PACKAGE, **not** appointments) | Status on user | safe-ish | Good if CRM was Fresh. If CRM was Not Converted, this **upgrades** (usually wanted). |
| B6 | Status → `PACKAGE_EXPIRED` or `INACTIVE` | Pushed **Converted** | `conversionStatus=Converted` | Status on user | safe-ish | Expired/inactive patients stay Converted on CRM (they already converted). |
| B7 | Edit name / center / email **without** changing status, user is still `LEAD` | Still pushes **Fresh** | Join rewritten; `latest_update.source=dash` | Saved | **overwrite** | Change only center; CRM stage must stay (today it may reset to Fresh). |
| B8 | Same edit, user is `ACTIVE` | Re-pushes **Converted** | Join rewritten | Saved | loop-ish | Usually idempotent; still hits TeleCRM API. |
| B9 | Duplicate `users` same phone | CRM updated from **whichever** user WF3 saw | n8n `findOne` in sync picks an **arbitrary** user for dash_*. JS prefers `web_visitors.patient_id` else latest `updatedAt`. | Both users exist | gap | Two users; join `dash_patient_id` may flip. |
| B10 | Change phone on the user | Push uses **new** phone (`91`+10). Old CRM lead orphaned. | New key; old `new-telecrm` doc left behind | New phone on user | gap | No merge/rename. |
| B11 | User with no phone / invalid phone | No push | No upsert from WF3 | Saved | no-op | WF3 `return []`. |
| B12 | Disallowed status (not in ALLOWED_DASH) | No push | No WF3 upsert; 2b sync may still refresh join | Saved | no-op | Confirm CRM untouched. |

---

## C. Action originates in appointments (booking / payment / visit)

Watcher **2c** → sync (1) only. That **does not** push a TeleCRM stage.

Workflow 3 does **not** watch `appointments`. Stage on CRM changes from appointments only via:

- someone also flipping `users.profileData.status` (B3–B5), or
- **reconcile** job (Fresh only), or
- a separate older `appointment-status-to-telecrm` n8n (not in this folder).

Sync conversion flags (workflow 1 / JS):

- First visit = `visitType: FIRST_VISIT` + report `isFirstAssessment: true`
- `isConverted` / `hasVisitedSession` = any of those with status `PAID` | `INVOICE_GENERATED` | `VISITED`
- `dash_firstvisitapppointment` = `'visited'` / `'not_visited'` / `null`

WF3 uses a **different** definition: any of 10 oldest appointments with `COMPLETED` or `attended===true`; `dash_firstvisitapppointment` is a **date**. Last writer wins.

| # | Appointment action | TeleCRM | `new-telecrm` | Stance Dashboard | Risk | How to test |
|---|---|---|---|---|---|---|
| C1 | Book first visit (`BOOKED`) | **Unchanged** unless dash status also becomes `BOOKED_*` (then B3) | After sync: flags false unless PAID/VISITED; `'not_visited'` if report exists | New appointment | gap | Book only, leave user as LEAD: CRM stays Fresh. Reconcile would push Session booked **if** still Fresh. |
| C2 | Book first visit **without** a first-assessment report | Unchanged | `$unwind` drops the row → looks like **no** first visit | Appointment exists | **gap** | Booked, no report: join should still show a booking (today it often does not). |
| C3 | Payment / invoice / visit (`PAID`, `INVOICE_GENERATED`, `VISITED`) | Unchanged by 2c. Reconcile → **Converted** only if CRM still Fresh | `isConverted=true`, `'visited'` | Appointment updated | gap vs CRM | Pay while CRM is Fresh: join converted, CRM still Fresh until reconcile/WF3. |
| C4 | Same payment while CRM is No Response | Reconcile **will not** heal (only Fresh) | Join converted flags true | Updated | gap | Product: should Converted overwrite No Response? Today no. |
| C5 | Cancel / no-show / `cancellationReason` | **Never** mapped to `Not Shown Up` | Reason stored on `dash_firstVisitAppointments` (sync) | Cancelled | **gap** | Cancel first visit; CRM should become Not Shown Up if Fresh/Session booked (today it does not). |
| C6 | Reschedule (`events.startTime` change, still `BOOKED`) | Stays Session booked if already pushed; never **Session Rescheduled** from dash | New `startTime` on join after sync | Event time changes | **gap** | Move session; CRM label should be Rescheduled (today no). |
| C7 | Follow-up only (`visitType` ≠ FIRST_VISIT) | Unchanged | Sync ignores for conversion | Follow-up exists | partial | PACKAGE patient with messy first-visit docs looks unconverted on join until WF3 uses dash status. |
| C8 | n8n WF1 with **zero** matching appointments | — | Workflow may **stop before upsert** | — | **gap** | Fresh lead, no assessment: join not updated (n8n). |
| C9 | Dashboard-only book (no CRM lead) | Sync 404; JS watcher **skips** | No sync upsert. WF3 may have created join if user status fired | Appointment + user | gap | Walk-in book: no CRM lead unless WF3 `autoupdatelead` created one. |

---

## D. Action originates on the website (`web_visitors` / touchpoints)

| # | Web action | TeleCRM | `new-telecrm` | Stance Dashboard | Risk | How to test |
|---|---|---|---|---|---|---|
| D1 | Visitor linked to a patient (`patient_id` set) | Unchanged (sync does not push source unless JS `PUSH_SOURCE`) | All timestamped attributed touchpoints are rebuilt into FIFO `source[]` events by n8n and JS, with the earliest source at index 0. | `web_visitors` + `web_touchpoints` | safe / chatty | Create repeated pageviews and then re-sync: each timestamped upstream event appears once and the re-sync adds no duplicate. |
| D2 | Rapid pageviews | Unchanged | n8n **2d has no debounce** → many TeleCRM searches. JS watcher coalesces 1.5s. | Chatty writes | loop-ish | Hammer pageviews; count sync executions. |
| D3 | Visitor with no `patient_id` | — | Watcher exits | Orphan visitor | no-op | No phone → no sync. |

---

## E. System jobs (not a human click)

| # | Job | TeleCRM | `new-telecrm` | Stance Dashboard | Risk | How to test |
|---|---|---|---|---|---|---|
| E1 | Nightly temperature 02:00 | POST `{phone, status, temperature}` from three-question score. Status is the live TeleCRM stage so the lead is not reopened to Fresh. | Sets temperature fields on the join for every scored open stage | Unchanged | overwrite (if status omitted) | Session booked / In Pipeline must keep their current status on the POST. |
| E2 | Converted or Not Converted lead | No temperature POST | Temperature fields left as they are | — | safe | These stages are not scored. |
| E3 | `Calls Count` > 6 and connected = 0 | Forced `cold` (`DEAD`) | Written | — | safe | Seven unanswered calls → COLD even if the lead is new. |
| E4 | Three-question score 2 or 3 | `hot` | Written | — | safe | New + recent WhatsApp (no connected calls) → HOT. Future session date no longer forces HOT. |
| E5 | Reconcile dry-run / `--apply` | `--apply` pushes Session booked or Converted **only if** Mongo `telecrm.status` is Fresh | Not written by the job | Unchanged | safe (conservative) | Booked first visit, CRM Fresh, run reconcile. |
| E6 | crm-mongo-sync updates `telecrm` | (mirror) | Watcher 2a → full sync (1) | Unchanged | loop-ish | After WF3 push, mirror update re-syncs join (usually same stage). |

---

## F. Loops (one action, multiple pipelines)

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

Sync (1) does **not** write `users`, so WF3 does **not** fire a second time from that loop. The loop **stops** after join refresh — unless WF3 already **downgraded** CRM (Fresh over In Pipeline). Then the second sync copies the **wrong** Fresh onto `conversionStatus`.

```
Appointment update ──► 2c ──► Sync (1) ──► join only (CRM stage untouched)
User status BOOKED_* ──► WF3 ──► CRM Session booked ──► Sync copies Session booked
```

If both fire, order matters: WF3 can overwrite CRM; sync then copies that overwrite onto the join.

**Schema fight:** WF1 stores `dash_centers` as `{ name }`, `dash_firstvisitapppointment` as `'visited'|'not_visited'`. WF3 stores `dash_centers` as a string and `dash_firstvisitapppointment` as a date. Consumers see whichever ran last.

---

## G. Suggested QA script (happy path)

Use **one phone** that already exists in TeleCRM as Fresh, with a matching Stance `LEAD` user.

1. **TeleCRM stage → In Pipeline.** Expect: join `conversionStatus=In Pipeline`; dash still `LEAD`.
2. **Dashboard: change only the center** (not status). Expect: CRM **stays** In Pipeline. (Today: often reset to Fresh — log as fail.)
3. **Book first visit + flip user to `BOOKED_WITH_TOKEN`.** Expect: CRM Session booked; join `dash_status=BOOKED_WITH_TOKEN`.
4. **Pay / visit first assessment.** Expect: join `isConverted=true`. CRM Converted only after reconcile (if still Fresh) or after dash `ACTIVE`/`PACKAGE`.
5. **Mark ACTIVE on dash.** Expect: CRM Converted.
6. **Converted on CRM only, leave dash LEAD.** Expect: dash still LEAD (clinic-owned).
7. **Nightly temperature.** Expect: HOT/WARM/COLD on join + CRM for every open stage, including Session booked; Converted and Not Converted are left alone. CRM stage stays the same because the POST includes `status`.

---

## H. Negative / edge checklist

- Missing phone on webhook → 400 / throw; no writes.
- TeleCRM search 401/500 with `neverError: true` → treated as **lead not found** (404), not retried.
- WF3 push `neverError: true` → silent CRM failure; join already upserted.
- Phone length 13+ after strip → accepted by n8n (`length < 10` only) → no Stance match.
- Two TeleCRM leads → `data[0]` only.
- Two Stance users → n8n `findOne`; JS prefers web visitor owner.
- Empty appointment aggregate on WF1 → possible full abort.
- Temperature invalid phone → row skipped.
- `NEW_TELECRM_PUSH_SOURCE=true` → sync also writes CRM `source` (opt-in; default off).

Treat **`1-sync-webhook.json`** and **`3-dashboard-to-telecrm.json`** as source of truth. Do not edit `main prod.json` as a third copy.
