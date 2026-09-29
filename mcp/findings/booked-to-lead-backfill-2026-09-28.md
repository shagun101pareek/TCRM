# Booked → Lead backfill check

Snapshot: 28 Sep 2026. Read-only on `stance-dashboard`. No TeleCRM status was pushed.

## Who matches Priya's journey

Join history where the latest dashboard stage is `LEAD` and an earlier dashboard stage was `BOOKED`, `BOOKED_WITH_TOKEN`, or `BOOKED_WITHOUT_TOKEN`: **20 phones**.

None of them are still **Session booked** on the TeleCRM mirror. A backfill that moves Session booked → In Pipeline would update **0** of these leads.

| Mirror status | Count | What to do |
|---|---:|---|
| Fresh | 13 | Already off Session booked. Not the stuck state. Left unchanged. |
| In Pipeline | 2 | Priya Mahadevan `9845512914`, Ankita Gandhi `9019853780`. Mirror already In Pipeline. |
| Not Converted | 3 | Sales outcome. Left unchanged. |
| Converted | 2 | Left unchanged. The new rule does not downgrade Converted. |

Priya's open TeleCRM card still showed Session booked on 28 Sep while the mirror says In Pipeline. A mirror backfill cannot fix that card, because the copy already has the target status.

## Session booked leads who are Lead today

118 mirror rows are Session booked. 5 of those patients are `LEAD` on the dashboard, and none of them has a first visit or a previous booked dashboard stage:

- Rekha Jagadeesh `9742620894`
- Uthpal Gowda `6360119608`
- pritee Ghosh `7259544762`
- Nikhil Tiwari `9336792945`
- Darshan K `6363351089`

These are CRM Session booked while the dashboard is still Lead. The new rule does not touch them.
