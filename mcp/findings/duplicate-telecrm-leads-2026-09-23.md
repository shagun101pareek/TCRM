# Duplicate TeleCRM rows on 22 Sep 2026

Read-only check of production `stance-dashboard` on 23 Sep 2026. No writes.

## What the TeleCRM list shows

The lead list (screenshot 10:46 IST) repeats the same person 2–3 times, created about 1 day ago, mostly Website, sometimes with different call duration or status. Examples: Nagaratha, Arjun Lal (3), Swarna Sony, Vedant Kumar, Sushmitha Narayana, Miracle Elshiya, Rishaan.

## Not the backfill

Production `new-telecrm` backfill last finished **2026-09-18T12:52:27Z** (`.agent/backfill-new-telecrm-progress-stance-dashboard.json`). That job upserts `new-telecrm` by phone from the mirror. It does not insert Stance `users` and does not create TeleCRM leads. `new-telecrm`, `telecrm`, and `users` each have a unique index on `phone`. Duplicate phone groups: **0** in all three.

## Not a second Mongo user

Each screenshot name is one `users` document and one `telecrm` document.

| Name | Phone | Dash status | Mirror status |
|---|---|---|---|
| Nagaratha m Nagaratha | 6366035394 | LEAD, never updated after create | Not Converted / No Need |
| Arjun Lal | 9711604788 | ACTIVE, 1 paid appointment | Converted |
| Swarna Sony | 7975261209 | LEAD | No Response |
| Vedant Kumar | 7054845041 | ACTIVE | Converted |
| Sushmitha Narayana | 7760750082 | PACKAGE, 2 appointments | Converted |
| Miracle Elshiya | 8088829642 | ACTIVE, 2 appointments | Converted |

`lead/search` could not confirm a second TeleCRM id. `TELECRM_SYNC_API2` is rejected by the Sync endpoint (401). The mirror cannot store a second lead with the same phone: crm-sync upserts that one row.

Website creates on 22 Sep were 61, versus 41 on 21 Sep and 49 on 17 Sep. The list total (132) is higher than mirror rows for the same window (~102). Extra TeleCRM rows that share a phone never become extra Mongo documents.

## What did start yesterday

On 22 Sep the dashboard workflow’s **Push to TeleCRM** node was connected. It had been disconnected. The body is `autoupdatelead` with `phone: "91" + 10 digits`, plus status, name, and sometimes email / `dashboard_field`.

n8n Sync no longer has that push node. `new-telecrm-webhook.js` `syncOne` still posts the same `91` + phone status push when `should_push_telecrm` is true. Live n8n could not be listed (`N8N_API_KEY` is unset).

TeleCRM updates a lead when the unique id (normally phone) matches, and creates a lead when it does not. A `91` prefix that does not match the website lead’s stored phone creates a second TeleCRM lead. crm-sync then folds both into the one 10-digit mirror row, so the list shows two leads and Mongo shows one.

## Two writers on the same lead

For patients who book and become ACTIVE/PACKAGE, stage history on the single mirror row bounces:

- Arjun Lal: Fresh → Session booked → Converted → Session booked → Converted
- Sushmitha Narayana: same pattern, one bounce per appointment
- Sonali Deskmukh (`9886842706`): Session booked ↔ Converted six times, from one paid appointment

Booking writes Session booked. WF3 sees ACTIVE/PACKAGE and pushes Converted. The next user/appointment save repeats it. That is the two workflows (dashboard push and the booking/status path) running on the same phone. It explains the status thrash. The extra list rows are the create-when-phone-does-not-match case, which the mirror hides.

## Separate case: phone edited

Rishaan is two phones, not one collapsed row. The user was created 21 Sep 05:07:42Z with phone `9741077255`. `users.phone` is now `8050736066`, and that second Website lead was created 22 Sep 04:56Z. Same pattern is not what produced Nagaratha or Arjun (those phones did not change).
