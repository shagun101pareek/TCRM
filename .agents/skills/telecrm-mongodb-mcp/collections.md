# stance-dashboard collections (MCP)

Primary database: `stance-dashboard`. Ignore `healthflex-production` unless the user asks for clinical/sensor data.

## TeleCRM

| Collection | Role |
|---|---|
| `telecrm` | Canonical CRM leads (~17k). Phone-keyed. `lead_source`, `source[]`, `stage[]`. No UTM fields. |
| `new-telecrm` | Intended enriched lead store. Currently empty. |
| `crm_sync_materialized` | TeleCRM + dashboard user join. `phone`, `userId` (string). |
| `daily-telecrm-report` | Report view. |

## Website UTM

| Collection | Role |
|---|---|
| `web_visitors` | One row per anonymous visitor. `first_utm_source`, `last_utm_source`, `patient_id`. Index on `patient_id`. |
| `web_touchpoints` | Pageviews. `utm_source`, `utm_medium`, `utm_campaign`, `visitor_id`. |
| `UTM-google ads` | View of booked patients with `utmSource`. |
| `UTM-bottom funnel` | Appointments with `utmSource`. |

## Dashboard

| Collection | Role |
|---|---|
| `users` | Patients/staff. `phone` is 10-digit, indexed. `_id` is `web_visitors.patient_id`. |
| `appointments` | Visits. |
| `web_touchpoints` / `web_visitors` | First-touch vs last-touch UTM. |

## Join recipe for “UTM of TeleCRM leads”

```
web_visitors
  $match patient_id != null
  $lookup users on patient_id = _id
  $lookup telecrm on users.phone = telecrm.phone
  $group by trimmed first_utm_source
```

Do not `$objectToArray` on `telecrm.source` without `$match: { source: { $type: "object" } }` — some `source` entries are strings.
