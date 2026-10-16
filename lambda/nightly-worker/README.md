# Nightly Lambda worker

This worker runs the two morning jobs that were filling the n8n heap: temperature, then source attribution. Each invoke loads one page, writes that page, and exits. The EC2 process that hosts n8n never holds the lead list.

Temperature runs first, 10 open leads per invoke. When that page comes back short, the same night switches to source attribution, 25 `telecrm` leads per invoke. When the source page comes back short, the night is done.

Scoring and the canonical schema pass are the same rules as the n8n workflows. Temperature posts `phone`, `status`, and `temperature` together, so a temperature update does not reopen the lead to Fresh. Source and temperature writes use a replace, which the n8n realtime trigger already ignores. A lead that has no `new-telecrm` row yet is inserted once, and that insert still wakes the realtime trigger.

## Files

| File | Purpose |
|---|---|
| `.env.example` | Every variable. Copy to `.env` for a local run. |
| `parameters.example.json` | Same secrets, in the shape `sam deploy` expects. |
| `template.yaml` | Lambda, 07:30 IST start, 5 minute watchdog, concurrency 1. |
| `src/index.js` | Lambda handler. |
| `src/local.js` | Run one action on this machine. |
| `src/worker.js` | Page loop, cursor, and the next-page invoke. |
| `src/attribute-lead.js` | Source attribution, one lead. |
| `src/score-temperature.js` | Temperature score, one lead. |
| `src/pipelines.js` | Paged Mongo reads and the replace writes. |
| `src/telecrm.js` | `lead/search` and `autoupdatelead`. |
| `events/*.json` | Sample Lambda events. |

## Local

```bash
cd lambda/nightly-worker
npm install
cp .env.example .env
# fill .env, or leave keys blank to reuse the repository root .env
npm run check
node src/local.js status
node src/local.js continue --dry-run
node src/local.js start --dry-run
```

`npm run check` does not connect to Mongo or TeleCRM. `start` and `continue` without `--dry-run` write production. `--dry-run` reads one page and does not write `new-telecrm` or TeleCRM. It stores its cursor on a separate document, `nightly-dry-run`, so it cannot skip leads for the real night.

A local run does not chain. Run `continue` again for the next page. On Lambda, a finished page invokes the next page itself.

## Deploy

Requires the AWS CLI and the AWS SAM CLI. Atlas must accept connections from this function. A Lambda that is not in a VPC uses changing AWS addresses, so Atlas network access has to allow those addresses (or `0.0.0.0/0` with the username and password). Do not put this function in a VPC unless that VPC has a NAT gateway; without one it cannot reach TeleCRM.

```bash
cd lambda/nightly-worker
npm install
cp parameters.example.json parameters.json
# fill parameters.json. Do not commit it.
sam build
sam deploy --guided --parameter-overrides "$(jq -r 'to_entries|map("\(.key)=\(.value|tostring)")|join(" ")' parameters.json)"
```

The start schedule is `cron(0 2 * * ? *)` UTC, which is 07:30 IST. The watchdog runs every 5 minutes and only continues a night whose cursor has been quiet for 3 minutes.

After one dry night looks right, set `DRY_RUN` to `false` (the template already does) and turn off the n8n schedule nodes **Nightly Temperature Run** and **Nightly Source Attribution Run**. Leave the realtime temperature trigger on. If both the Lambda and those two schedules stay active, the morning jobs run twice.

`ReservedConcurrentExecutions: 1` keeps two pages from running together. The account must have at least one unreserved concurrency slot free.

## Cursor

Collection `nightly_worker_state`, document `_id: "nightly"`.

`status: running` and `job: temperature` or `source`. `lastId` is the last lead this night finished. The next page is `_id` greater than that, sorted ascending, limited to the page size. A lead that fails five times is recorded on `skippedLeads` and the night moves past it. The next 07:30 start does nothing if a night is still running.
