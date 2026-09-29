# Development high-data test phones (17 Sep 2026)

Database: `stance-development`. Writer: JS `syncOne` via `scripts/backfill-new-telecrm.js --apply --from-mirror`. CRM fields came from Mongo `telecrm` (not live `lead/search`; Sync token still 401).

## Why these 19

`--limit 10` takes the first usable mirror phones. This set is scored for extra CRM scalars on the mirror (`first_interaction_date`, `first_call_done`, `last_contacted_date`, `drop_off_reason`, `capture_frequency`) plus CRM status, dash status, source bucket, and dash/web join.

Mirror extras at query time: `last_contacted_date` 15, `first_interaction_date` 2110, `first_call_done` 2114, `drop_off_reason` 2608, `capture_frequency` 13412. UI labels (`Captured On`, `Last Call`, `Count of Connected Calls`) are still 0 on the mirror.

## Backfill result

19 refreshed, 0 inserted, 0 failed. `new-telecrm` still 16980. `last_synced_at` ~ `2026-09-17T09:20:57Z`–`09:21:06Z`.

After refresh, among these 19 join rows: first_interaction 16, first_call_done 17, last_contacted 4, drop_off 13, capture_frequency 10, connected_calls 0.

## Phones

| Phone | Name | Why picked | CRM status | Dash | Extra that landed |
|---|---|---|---|---|---|
| 9392751188 | Lalith Reddy | known test | Not Shown Up | INACTIVE | stage history only |
| 7028910047 | Piyush Ravi | known test | Converted | PACKAGE / visited | website source |
| 9591500700 | Ravindhar | known + extra CRM | Not Converted | CRM-only | first, first_call_done, drop_off |
| 9620054545 | nikin Nambiar | all extra CRM + last_contacted | Converted | INACTIVE / visited | first, call done, last, drop, capture=1 |
| 6360441739 | Gopinath Gopi | last_contacted | Not Converted | INACTIVE | first, call done, last, drop, capture=1 |
| 8888099994 | Jitendra Sahoo | last_contacted | Not Converted | INACTIVE | call done, last, drop, capture=1 |
| 7406888876 | Sandeep Katakol | Session booked | Session booked | PACKAGE / visited | first, first_call_done |
| 8296961688 | Shylendrakumar | In Pipeline | In Pipeline | INACTIVE + web | first, first_call_done, 4 sources / 10 stages |
| 9019518259 | Shiva G | Fresh | Fresh | PACKAGE / visited | first, call done, drop Too Expensive, capture=1 |
| 9650920339 | (no name) | Not Converted + drop + web | Not Converted | INACTIVE | first, call done, drop, capture=1, 7 sources |
| 8095500499 | Soumya Mohanty | Not Shown Up | Not Shown Up | INACTIVE | first, first_call_done |
| 9620771181 | Jacob J | No Response + CTWA | No Response | INACTIVE / visited | first, call done, capture=2 |
| 9945611081 | Aishwarya Suresh | website + dash + web | Not Converted | INACTIVE | first, call done, drop |
| 9880712456 | Ashish gupta | meta_paid | Not Converted | INACTIVE / visited | first, call done, drop |
| 9723222515 | Ashish Ravi | meta_ctwa CRM-only | Not Converted | none | first, call done, drop, capture=1 |
| 8971492907 | Arun G | CRM-only + last_contacted | Not Converted | none | first, call done, last, drop, capture=1 |
| 8097406604 | Rohan Bheda | BOOKED_WITHOUT_TOKEN | Not Converted | booked + web | first, call done, drop, capture=1 |
| 7411143624 | Akash Sanmukh | dash LEAD | Not Converted | LEAD + web | first, call done, drop, 10 sources |
| 8277205983 | Gulafsha Trarannum | multi stage | Not Converted | INACTIVE | first, call done, drop, capture=2 |

Richest single row for the five scalars: **9620054545**. Connected-call count is still omitted (not on the mirror). Lalith / Piyush stay useful for status/dash coverage, not for those extra keys.
