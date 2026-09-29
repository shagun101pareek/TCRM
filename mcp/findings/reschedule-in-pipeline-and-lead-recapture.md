# Reschedule → In Pipeline and lead recapture

Snapshot: 22 Sep 2026. Implemented in JS `finalizeTelecrmStatus` and n8n Finalize Recapture / Finalize Status.

## Rules

1. **Reschedule is In Pipeline only.** `rescheduledFrom`, `rescheduledTo`, `cancellationReason` containing RESCHEDUL, or `cancellationDetails.rescheduledToId` maps TeleCRM to **In Pipeline**. Session Rescheduled is remapped to In Pipeline. Converted / paid visit still wins.

2. **Lead recapture.** If the inbound source is website or any other non-`dash_*` platform **and** the patient already has a booked appointment (PAID / VISITED / BOOKED / CANCELLED / …), tag `source[]` with `{ source: "lead_recapture" }`. Do **not** push Fresh. Restore the last non-Fresh TeleCRM stage, or In Pipeline if none.

3. TeleCRM status is pushed only when the desired stage differs from the live/mirror stage (`should_push_telecrm`).

## Why

Website recapture was resetting Converted / In Pipeline leads to Fresh. Reschedules were proposed as Session Rescheduled; product wants In Pipeline.