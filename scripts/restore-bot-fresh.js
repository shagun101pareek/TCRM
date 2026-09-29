#!/usr/bin/env node
'use strict';

/**
 * Restore TeleCRM leads the daily-report temperature push reopened to Fresh.
 *
 * Conservative: only current status Fresh, previous stage Converted
 * (or Session booked with --include-session-booked). Status field only.
 * Default is dry-run.
 *
 *   node scripts/restore-bot-fresh.js
 *   node scripts/restore-bot-fresh.js --apply
 *   node scripts/restore-bot-fresh.js --include-session-booked --apply
 *
 * Env: MONGODB_URI_PRODUCTION (preferred) or MONGODB_URI,
 * optional MONGODB_DB, TELECRM_ASYNC_API2 or TELECRM_AUTOUPDATE_TOKEN,
 * optional TELECRM_ENTERPRISE_ID.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { MongoClient } = require('mongodb');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const INCLUDE_SESSION_BOOKED = args.includes('--include-session-booked');

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

function dbNameFromUri(uri) {
  const afterAt = String(uri || '').split('@').pop() || '';
  return (afterAt.split('?')[0].split('/')[1] || '').trim();
}

const URI_ENV =
  argValue('--uri-env') ||
  (process.env.MONGODB_URI_PRODUCTION ? 'MONGODB_URI_PRODUCTION' : 'MONGODB_URI');
const MONGO_URI = process.env[URI_ENV];
const EID = process.env.TELECRM_ENTERPRISE_ID || '69da237dbbfc0db1fc1ea6e2';
const WRITE_TOKEN =
  process.env.TELECRM_ASYNC_API2 ||
  process.env.TELECRM_AUTOUPDATE_TOKEN ||
  process.env.TELECRM_ASYNC_API;
const AUTOUPDATE_URL = `https://next-api.telecrm.in/enterprise/${EID}/autoupdatelead`;
const DB_NAME =
  process.env.MONGODB_DB ||
  (URI_ENV === 'MONGODB_URI_PRODUCTION' ? 'stance-dashboard' : dbNameFromUri(MONGO_URI) || 'stance-dashboard');
const RATE_LIMIT_MS = 350;

const CONVERTED = new Set(['Converted', 'Won / Converted']);
const SESSION_BOOKED = new Set(['Session booked', 'Session Booked']);
const TEST_PHONES = new Set([
  '1231231234',
  '9999999999',
  '3456786549',
  '3334523456',
  '3456879853',
  '2467876897',
  '9895093765',
  '9113964055',
]);

function isTest(doc) {
  const phone = String(doc.phone || '');
  const name = String(doc.name || '');
  if (TEST_PHONES.has(phone)) return true;
  if (/test/i.test(name)) return true;
  if (!/^\d{10}$/.test(phone)) return true;
  return false;
}

function parseDate(v) {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof v === 'object' && v.$date) return Date.parse(v.$date);
  return 0;
}

function targetFromStage(doc) {
  const stage = (doc.stage || [])
    .slice()
    .sort((a, b) => parseDate(a.date) - parseDate(b.date));
  if (!stage.length) return null;

  let lastFreshIdx = -1;
  for (let i = stage.length - 1; i >= 0; i--) {
    if (stage[i].status === 'Fresh') {
      lastFreshIdx = i;
      break;
    }
  }
  if (lastFreshIdx <= 0) return null;
  const prev = stage[lastFreshIdx - 1] && stage[lastFreshIdx - 1].status;
  if (CONVERTED.has(prev)) return 'Converted';
  if (INCLUDE_SESSION_BOOKED && SESSION_BOOKED.has(prev)) return 'Session booked';
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pushStatus(phone10, status) {
  const resp = await fetch(AUTOUPDATE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WRITE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: { phone: '91' + phone10, status },
    }),
  });
  return resp.status;
}

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/restore-bot-fresh.js [--apply] [--include-session-booked] [--uri-env MONGODB_URI_PRODUCTION]');
    return;
  }
  if (!WRITE_TOKEN) {
    throw new Error('Set TELECRM_ASYNC_API2 (or TELECRM_AUTOUPDATE_TOKEN) in .env');
  }
  if (!MONGO_URI) {
    throw new Error(`Set ${URI_ENV} in .env`);
  }

  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  console.log(`Mongo env=${URI_ENV} db=${DB_NAME}`);

  const docs = await db
    .collection('telecrm')
    .find({ status: 'Fresh' })
    .project({ phone: 1, name: 1, status: 1, stage: 1 })
    .toArray();

  const rows = [];
  let skippedTest = 0;
  for (const doc of docs) {
    if (isTest(doc)) {
      skippedTest++;
      continue;
    }
    const target = targetFromStage(doc);
    if (!target) continue;
    rows.push({
      phone: String(doc.phone),
      name: (doc.name || '').trim(),
      target,
    });
  }

  console.log(
    `\nRestore bot Fresh → previous stage — ${
      APPLY ? 'APPLY (writes TeleCRM status only)' : 'DRY RUN (no writes)'
    }\n`
  );
  console.log(`Candidates: ${rows.length}  (skipped test/invalid: ${skippedTest})`);
  console.log(`  Converted: ${rows.filter((r) => r.target === 'Converted').length}`);
  console.log(
    `  Session booked: ${rows.filter((r) => r.target === 'Session booked').length}\n`
  );

  if (!rows.length) {
    console.log('Nothing to restore.');
    await client.close();
    return;
  }

  let pushed = 0;
  let failed = 0;
  for (const r of rows) {
    const label = `${r.phone}  ${r.name.padEnd(28)} Fresh → ${r.target}`;
    if (!APPLY) {
      console.log(`  • ${label}   (dry-run)`);
      continue;
    }
    try {
      const code = await pushStatus(r.phone, r.target);
      const ok = code >= 200 && code < 300;
      console.log(`  ${ok ? '✓' : '✗'} ${label}   [HTTP ${code}]`);
      ok ? pushed++ : failed++;
    } catch (e) {
      console.log(`  ✗ ${label}   [${e.message}]`);
      failed++;
    }
    await sleep(RATE_LIMIT_MS);
  }

  console.log(
    APPLY
      ? `\nDone — pushed ${pushed}, failed ${failed}`
      : `\nDry run — ${rows.length} would be pushed. Re-run with --apply to write.`
  );
  await client.close();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
