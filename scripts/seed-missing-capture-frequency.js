#!/usr/bin/env node
'use strict';

/**
 * Seed missing new-telecrm.telecrm_capture_frequency to a baseline (default 1).
 *
 * Mongo-only. No TeleCRM API. No status/stage/source changes. No upserts.
 * Never overwrites an existing finite count.
 *
 * Why: ~4k join rows have no capture frequency. Seeding 1 gives our recapture
 * gate a baseline so the first live Sync that sees Capture Frequency: 1 is not
 * treated as a new capture. This does NOT call TeleCRM — Once a Day still
 * depends on a real form/API resubmit; Converted heal is separate.
 *
 *   node scripts/seed-missing-capture-frequency.js
 *   node scripts/seed-missing-capture-frequency.js --apply
 *   node scripts/seed-missing-capture-frequency.js --value 1 --apply
 *
 * Env: MONGODB_URI_PRODUCTION (preferred) or MONGODB_URI; optional MONGODB_DB.
 *
 * Before --apply: pause n8n temperature realtime on new-telecrm if it is live.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

function dbNameFromUri(uri) {
  const afterAt = String(uri || '').split('@').pop() || '';
  return (afterAt.split('?')[0].split('/')[1] || '').trim();
}

function tidyNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const URI_ENV =
  argValue('--uri-env') ||
  (process.env.MONGODB_URI_PRODUCTION ? 'MONGODB_URI_PRODUCTION' : 'MONGODB_URI');
const MONGO_URI = process.env[URI_ENV];
const DB_NAME =
  argValue('--db') ||
  process.env.MONGODB_DB ||
  (URI_ENV === 'MONGODB_URI_PRODUCTION'
    ? 'stance-dashboard'
    : dbNameFromUri(MONGO_URI) || 'stance-dashboard');

const SEED_VALUE = Number(argValue('--value') || '1');
if (!Number.isFinite(SEED_VALUE) || SEED_VALUE < 1) {
  console.error('--value must be a number >= 1');
  process.exit(1);
}

const MISSING_FILTER = {
  $or: [
    { telecrm_capture_frequency: { $exists: false } },
    { telecrm_capture_frequency: null },
    { telecrm_capture_frequency: '' },
  ],
};

async function statusCounts(join) {
  return join
    .aggregate([{ $group: { _id: '$conversionStatus', n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    .toArray();
}

function printStatus(label, rows) {
  console.log(label);
  for (const row of rows) {
    console.log(`  ${row._id ?? '(null)'}: ${row.n}`);
  }
}

function statusMapsEqual(before, after) {
  const a = new Map(before.map((r) => [String(r._id), r.n]));
  const b = new Map(after.map((r) => [String(r._id), r.n]));
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

async function main() {
  if (!MONGO_URI) {
    console.error(`Missing ${URI_ENV} in .env`);
    process.exit(1);
  }

  console.log(`Mode: ${APPLY ? 'APPLY (seed missing frequency only)' : 'DRY-RUN (no writes)'}`);
  console.log(`URI env: ${URI_ENV}`);
  console.log(`Database: ${DB_NAME}`);
  console.log(`Seed value: ${SEED_VALUE}`);
  console.log('WARNING: Pause temperature realtime on new-telecrm if it is live before APPLY.');

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const join = client.db(DB_NAME).collection('new-telecrm');

  const before = await statusCounts(join);
  const total = await join.countDocuments({});
  const missing = await join.countDocuments(MISSING_FILTER);
  const withFreq = await join.countDocuments({
    telecrm_capture_frequency: { $type: 'number' },
  });

  console.log(`\nnew-telecrm docs: ${total}`);
  console.log(`with numeric telecrm_capture_frequency: ${withFreq}`);
  console.log(`missing frequency (would seed): ${missing}`);
  printStatus('conversionStatus before (must match after):', before);

  const byStatusMissing = await join
    .aggregate([
      { $match: MISSING_FILTER },
      { $group: { _id: '$conversionStatus', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ])
    .toArray();
  printStatus('missing cohort by conversionStatus:', byStatusMissing);

  const samples = await join
    .find(MISSING_FILTER, {
      projection: { phone: 1, conversionStatus: 1, telecrm_capture_frequency: 1 },
      limit: 10,
    })
    .toArray();
  console.log('Sample phones to seed:');
  for (const s of samples) {
    console.log(
      `  ${s.phone}  ${s.telecrm_capture_frequency ?? '∅'} → ${SEED_VALUE}  [${s.conversionStatus}]`,
    );
  }

  // Safety: refuse if any matched doc already has a finite count (filter bug).
  const accidental = await join.countDocuments({
    ...MISSING_FILTER,
    telecrm_capture_frequency: { $type: 'number' },
  });
  if (accidental > 0) {
    console.error(`REFUSING: filter matched ${accidental} docs that already have a number.`);
    process.exitCode = 2;
    await client.close();
    return;
  }

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to write.');
    await client.close();
    return;
  }

  if (missing === 0) {
    console.log('\nNothing to write.');
    await client.close();
    return;
  }

  // updateMany: one field only. Never touches conversionStatus / stage / source.
  const result = await join.updateMany(MISSING_FILTER, {
    $set: { telecrm_capture_frequency: SEED_VALUE },
  });

  const after = await statusCounts(join);
  const afterMissing = await join.countDocuments(MISSING_FILTER);
  const afterWithFreq = await join.countDocuments({
    telecrm_capture_frequency: { $type: 'number' },
  });

  console.log(`\nApply done. matched=${result.matchedCount} modified=${result.modifiedCount}`);
  console.log(`with numeric frequency now: ${afterWithFreq} (was ${withFreq})`);
  console.log(`still missing: ${afterMissing}`);
  printStatus('conversionStatus after:', after);

  if (!statusMapsEqual(before, after)) {
    console.error('ERROR: conversionStatus counts drifted — investigate immediately.');
    process.exitCode = 2;
  } else if (afterMissing !== 0) {
    console.error(`ERROR: expected 0 missing after seed, got ${afterMissing}`);
    process.exitCode = 2;
  } else if (result.modifiedCount !== missing) {
    console.error(
      `ERROR: modified ${result.modifiedCount} but expected ${missing} — investigate.`,
    );
    process.exitCode = 2;
  } else {
    console.log('OK: status counts unchanged; all missing frequencies seeded.');
  }

  await client.close();
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
