# Cancel / Reschedule → TeleCRM mapping (proposal)

Snapshot: 22 Sep 2026. Design only — not implemented yet.

## Current gap

Watcher `2c` only calls Sync on appointment changes. Sync does **not** push cancel → In Pipeline or reschedule → Session Rescheduled.

## Recommended mapping

| Appointment event | Condition | TeleCRM status to push |
|---|---|---|
| Cancel (no-show / cancelled) | First-visit or booked session cancelled, customer **not** already Converted/paid | **In Pipeline** (per product ask) *or* **Not Shown Up** if sales prefers no-show semantics |
| Reschedule | `status=CANCELLED` + `cancellationReason=RESCHEDULED`, or event time change while still booked | **Session Rescheduled** |
| Paid / visited after prior cancel | Dashboard converted-family or visit `PAID`/`VISITED` | **Converted** (recapture heal already covers this) |

## Guardrails

1. Never downgrade **Converted** (or paid visit) to In Pipeline / Session Rescheduled / Fresh.
2. Only act on `visitType: FIRST_VISIT` for first-session pipeline; follow-up cancels may be no-op for TeleCRM stage.
3. Append `stage[]` with `platform: telecrm` only when status actually changes.
4. Prefer extending **Sync Finalize Recapture Decision** (or a sibling Finalize Appointment Decision) so watcher 2c → Sync remains the single write path.

## Implementation sketch (next change)

1. In Sync, after appointments aggregate, compute `appointment_action`: `cancel` | `reschedule` | `none`.
2. Apply mapping only when dash is `LEAD` / `BOOKED_*` (not converted-family).
3. Push via the same guarded `autoupdatelead` node used for recapture heal.
