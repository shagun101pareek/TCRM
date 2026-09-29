#!/usr/bin/env node
'use strict';

/**
 * Copy telecrm.capture_frequency → new-telecrm.telecrm_capture_frequency.
 *
 * One field only. No syncOne. No TeleCRM API. No status/stage changes.
 * Default is dry-run. Match on 10-digit phone (strip 91… / 0…).
 *
 *   node scripts/backfill-capture-frequency.js
 *   node scripts/backfill-capture-frequency.js --apply
 *   node scripts/backfill-capture-frequency.js --uri-env MONGODB_URI_PRODUCTION --db stance-dashboard --apply
 *
 * Env: MONGODB_URI_PRODUCTION (preferred) or MONGODB_URI; optional MONGODB_DB.
 *
 * Before --apply on production: pause n8n "4-temperature-realtime" if it is
 * live, because it fires on any new-telecrm update and its old body can reopen
 * leads to Fresh.
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

function normPhone10(raw) {
  let s = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  return s.length === 10 ? s : '';
}

function tidyNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return tidyNumber(value.value);
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readCaptureFrequency(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const fields = doc.fields && typeof doc.fields === 'object' ? doc.fields : {};
  return tidyNumber(
    firstDefined(
      doc.capture_frequency,
      doc['Capture Frequency'],
      doc['# Capture Frequency'],
      fields.capture_frequency,
      fields['Capture Frequency'],
      fields['# Capture Frequency'],
    ),
  );
}

function firstDefined(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
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

async function main() {
  if (!MONGO_URI) {
    console.error(`Missing ${URI_ENV} in .env`);
    process.exit(1);
  }

  console.log(`Mode: ${APPLY ? 'APPLY (writes telecrm_capture_frequency only)' : 'DRY-RUN (no writes)'}`);
  console.log(`URI env: ${URI_ENV}`);
  console.log(`Database: ${DB_NAME}`);
  console.log('WARNING: Pause temperature realtime on new-telecrm if it is live before APPLY.');

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const telecrm = db.collection('telecrm');
  const join = db.collection('new-telecrm');

  const beforeStatus = await join
    .aggregate([{ $group: { _id: '$conversionStatus', n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    .toArray();
  const joinTotal = await join.countDocuments({});
  const joinWithFreq = await join.countDocuments({
    telecrm_capture_frequency: { $exists: true, $ne: null },
  });

  console.log(`\nnew-telecrm docs: ${joinTotal} (with telecrm_capture_frequency: ${joinWithFreq})`);
  console.log('conversionStatus counts (must be unchanged after apply):');
  for (const row of beforeStatus) {
    console.log(`  ${row._id ?? '(null)'}: ${row.n}`);
  }

  // Only rows that already carry a capture count (root or fields). Avoid full-collection scan.
  const cursor = telecrm.find(
    {
      $or: [
        { capture_frequency: { $exists: true, $ne: null } },
        { 'Capture Frequency': { $exists: true, $ne: null } },
        { '# Capture Frequency': { $exists: true, $ne: null } },
        { 'fields.capture_frequency': { $exists: true, $ne: null } },
        { 'fields.Capture Frequency': { $exists: true, $ne: null } },
      ],
    },
    {
      projection: {
        phone: 1,
        capture_frequency: 1,
        'Capture Frequency': 1,
        '# Capture Frequency': 1,
        'fields.capture_frequency': 1,
        'fields.Capture Frequency': 1,
        'fields.# Capture Frequency': 1,
      },
    },
  );

  const byPhone = new Map();
  let mirrorWithFreq = 0;
  let mirrorSkippedPhone = 0;

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const phone = normPhone10(doc.phone);
    if (!phone) {
      mirrorSkippedPhone += 1;
      continue;
    }
    const freq = readCaptureFrequency(doc);
    if (freq === null) continue;
    mirrorWithFreq += 1;
    const prev = byPhone.get(phone);
    if (!prev || freq >= prev) byPhone.set(phone, freq);
  }

  console.log(`\nMirror phones with a usable capture frequency: ${byPhone.size} (${mirrorWithFreq} raw hits, ${mirrorSkippedPhone} bad phones)`);

  console.log('Loading new-telecrm phone → frequency map…');
  const joinMap = new Map();
  const joinCursor = join.find(
    {},
    { projection: { phone: 1, telecrm_capture_frequency: 1, conversionStatus: 1 } },
  );
  while (await joinCursor.hasNext()) {
    const row = await joinCursor.next();
    const phone = normPhone10(row.phone);
    if (!phone) continue;
    joinMap.set(phone, row);
  }
  console.log(`Join rows loaded: ${joinMap.size}`);

  let wouldSet = 0;
  let wouldSkipSame = 0;
  let wouldSkipHigherOrDifferent = 0;
  let wouldSkipMissingJoin = 0;
  let samples = [];
  const ops = [];

  for (const [phone, freq] of byPhone) {
    const existing = joinMap.get(phone);
    if (!existing) {
      wouldSkipMissingJoin += 1;
      continue;
    }
    const current = tidyNumber(existing.telecrm_capture_frequency);
    // Never lower a stored count. A drop (join 3 → mirror 1) would look like a
    // new capture the next time live TeleCRM returns 3 and reopen the lead to Fresh.
    if (current !== null) {
      if (current === freq) wouldSkipSame += 1;
      else wouldSkipHigherOrDifferent += 1;
      continue;
    }
    wouldSet += 1;
    if (samples.length < 10) {
      samples.push({
        phone,
        from: current,
        to: freq,
        conversionStatus: existing.conversionStatus || null,
      });
    }
    ops.push({
      updateOne: {
        filter: { phone },
        update: { $set: { telecrm_capture_frequency: freq } },
        upsert: false,
      },
    });
  }

  console.log(`\nWould set (join missing frequency only): ${wouldSet}`);
  console.log(`Already equal: ${wouldSkipSame}`);
  console.log(`Join already has a count (left unchanged): ${wouldSkipHigherOrDifferent}`);
  console.log(`No new-telecrm row (skipped, no create): ${wouldSkipMissingJoin}`);
  console.log('Sample (phone, old → new, conversionStatus):');
  for (const s of samples) {
    console.log(`  ${s.phone}  ${s.from ?? '∅'} → ${s.to}  [${s.conversionStatus}]`);
  }

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to write.');
    await client.close();
    return;
  }

  if (ops.length === 0) {
    console.log('\nNothing to write.');
    await client.close();
    return;
  }

  const BATCH = 500;
  let modified = 0;
  for (let i = 0; i < ops.length; i += BATCH) {
    const chunk = ops.slice(i, i + BATCH);
    const result = await join.bulkWrite(chunk, { ordered: false });
    modified += result.modifiedCount || 0;
    console.log(`  batch ${Math.floor(i / BATCH) + 1}: modified ${result.modifiedCount}`);
  }

  const afterStatus = await join
    .aggregate([{ $group: { _id: '$conversionStatus', n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    .toArray();
  const afterWithFreq = await join.countDocuments({
    telecrm_capture_frequency: { $exists: true, $ne: null },
  });

  console.log(`\nApply done. modified≈${modified}. with telecrm_capture_frequency now: ${afterWithFreq}`);
  console.log('conversionStatus counts after (must match before):');
  const beforeMap = new Map(beforeStatus.map((r) => [String(r._id), r.n]));
  let statusDrift = false;
  for (const row of afterStatus) {
    const key = String(row._id);
    const was = beforeMap.get(key);
    const mark = was === row.n ? 'ok' : 'DRIFT';
    if (was !== row.n) statusDrift = true;
    console.log(`  ${row._id ?? '(null)'}: ${row.n} (${mark}, was ${was})`);
  }
  if (statusDrift) {
    console.error('ERROR: conversionStatus counts drifted — investigate.');
    process.exitCode = 2;
  } else {
    console.log('Status counts unchanged.');
  }

  await client.close();
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
