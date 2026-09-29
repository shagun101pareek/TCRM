# Agent working state

This directory holds **file-hash snapshots** so an agent can prove created / modified / deleted files when Git is not available.

| File | When |
|---|---|
| `task-start.json` | Start of an agent task (`scripts/snapshot-baseline.js --task-start`) |
| `baseline.json` | After a recorded task (`scripts/snapshot-baseline.js`) |

These JSON snapshots are gitignored. They must not contain `.env` values.

Do not store connection strings here.
