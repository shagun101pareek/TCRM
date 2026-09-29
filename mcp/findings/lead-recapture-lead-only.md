# Lead recapture (LEAD-only)

Updated: 22 Sep 2026.

## Rule

`lead_recapture` is tagged **only** when:

1. `users.profileData.status` / `dash_status` is **`LEAD`**
2. There is prior TeleCRM stage history on the join
3. And either:
   - TeleCRM reopened to **Fresh** after a non-Fresh stage, or
   - An inbound capture source is present (website / meta / etc.)

Then `source[]` gets a newest entry:

```json
{ "source": "lead_recapture", "occurred_at": "..." }
```

TeleCRM stage for LEAD stays the live lead-family status (Fresh / In Pipeline / …). We do **not** force Converted.

## Not recapture

Dashboard `ACTIVE` / `PACKAGE` / `INACTIVE` / paid visit does **not** set `lead_recapture` and Sync does **not** heal TeleCRM back to Converted on website reopen.

WF3 still maps those dash statuses to **Converted** when a dashboard status change runs (normal status mapping), which is separate from lead recapture.
