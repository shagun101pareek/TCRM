#!/usr/bin/env node
'use strict';

/**
 * Backfill Stance patients created in a date window (IST) that are missing from new-telecrm.
 * Dry-run by default. With --create-in-telecrm, creates the lead in TeleCRM first
 * (same payload as WF3 "Push Create to TeleCRM"); crm-mongo-sync then fills `telecrm`.
 *
 * Usage (from repository root):
 *   node scripts/backfill-recent-users.js --from 2026-10-08
 *   node scripts/backfill-recent-users.js --from 2026-10-08 --apply --create-in-telecrm --limit 1
 *   node scripts/backfill-recent-users.js --from 2026-10-08 --to 2026-10-12 --apply --create-in-telecrm
 *   node scripts/backfill-recent-users.js --apply --create-in-telecrm --phone 9619277055
 *
 * --phone N (repeatable) targets those phones even if they already have a new-telecrm row.
 * --no-captured-on stops sending the Stance createdAt as TeleCRM "Captured On".
 */

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/common');

process.chdir(repoRoot);

for (const raw of fs.readFileSync(path.join(repoRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq < 1) continue;
  const key = line.slice(0, eq).trim();
  let val = line.slice(eq + 1).trim();
  if (/^(['"]).*\1$/.test(val)) val = val.slice(1, -1);
  if (!process.env[key]) process.env[key] = val;
}
// new-telecrm-webhook.js reads these at require time.
process.env.MONGODB_URI = process.env.MONGODB_URI_PRODUCTION;
process.env.MONGODB_DB = 'stance-dashboard';
process.env.TELECRM_ENTERPRISE_ID = process.env.TELECRM_ENTERPRISE_ID || '69da237dbbfc0db1fc1ea6e2';
process.env.TELECRM_AUTOUPDATE_TOKEN = process.env.TELECRM_AUTOUPDATE_TOKEN || process.env.TELECRM_ASYNC_API2;
process.env.NEW_TELECRM_PUSH_SOURCE = 'false';

const { MongoClient } = require('mongodb');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const todayIst = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
const FROM = new Date(`${opt('--from', '2026-10-08')}T00:00:00+05:30`).getTime();
const TO = new Date(`${opt('--to', todayIst)}T23:59:59.999+05:30`).getTime();
const APPLY = flag('--apply');
const CREATE = flag('--create-in-telecrm');
const LIMIT = Number(opt('--limit', 0)) || Infinity;
const DELAY_MS = Number(opt('--delay-ms', 500));
const SEND_CAPTURED_ON = !flag('--no-captured-on');
const ONLY_PHONES = argv
  .map((a, i) => (a === '--phone' ? argv[i + 1] : null))
  .filter(Boolean)
  .map((p) => normPhone10(p));

const STATUS_MAP = {
  LEAD: 'Fresh',
  BOOKED: 'Session booked',
  BOOKED_WITH_TOKEN: 'Session booked',
  BOOKED_WITHOUT_TOKEN: 'Session booked',
  ACTIVE: 'Converted',
  PACKAGE: 'Converted',
  PACKAGE_EXPIRED: 'Converted',
  DISCHARGED: 'Converted',
  INACTIVE: 'Converted',
};

function normPhone10(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/[^0-9]/g, '');
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  return s;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const redact = (e) => String(e && e.message ? e.message : e).replace(/mongodb(\+srv)?:\/\/\S+/gi, '[uri]');

async function createInTeleCRM(fields) {
  const url = `https://next-api.telecrm.in/enterprise/${process.env.TELECRM_ENTERPRISE_ID}/autoupdatelead`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.TELECRM_AUTOUPDATE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`autoupdatelead ${resp.status} ${body.slice(0, 200)}`);
  }
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI_PRODUCTION missing in .env');
  if (CREATE && !process.env.TELECRM_AUTOUPDATE_TOKEN) throw new Error('No Async token (TELECRM_ASYNC_API2) in .env');

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB);

  const userFilter = ONLY_PHONES.length
    ? { userType: 'PATIENT', phone: { $in: ONLY_PHONES.flatMap((p) => [p, `91${p}`, `0${p}`]) } }
    : { userType: 'PATIENT', createdAt: { $gte: FROM, $lte: TO } };
  const users = await db.collection('users').find(
    userFilter,
    { projection: { phone: 1, email: 1, createdAt: 1, profileData: 1 } },
  ).sort({ createdAt: 1 }).toArray();

  const byPhone = new Map();
  for (const u of users) {
    const p = normPhone10(u.phone);
    if (p.length === 10 && !byPhone.has(p)) byPhone.set(p, u);
  }
  const phones = [...byPhone.keys()];
  const variants = phones.flatMap((p) => [p, `91${p}`, `0${p}`]);

  const inJoin = new Set(
    (await db.collection('new-telecrm').find({ phone: { $in: variants } }, { projection: { phone: 1 } }).toArray())
      .map((d) => normPhone10(d.phone)),
  );
  const mirrorDocs = await db.collection('telecrm').find({ phone: { $in: variants } }).sort({ modified_at: 1 }).toArray();
  const mirror = new Map(mirrorDocs.map((d) => [normPhone10(d.phone), d]));

  const missing = (ONLY_PHONES.length ? phones : phones.filter((p) => !inJoin.has(p))).slice(0, LIMIT);
  console.log(`window ${new Date(FROM).toISOString()} → ${new Date(TO).toISOString()}`);
  console.log(`patients=${users.length} unique phones=${phones.length} in new-telecrm=${inJoin.size} missing=${missing.length}`);
  console.log(`missing but already in telecrm mirror=${missing.filter((p) => mirror.has(p)).length}`);

  if (!APPLY) {
    for (const p of missing.slice(0, 15)) {
      const pd = byPhone.get(p).profileData || {};
      console.log(`  ${p}  ${pd.status || '-'}  ${[pd.firstName, pd.lastName].filter(Boolean).join(' ')}`);
    }
    console.log('Dry run. Add --apply (and --create-in-telecrm to create TeleCRM leads).');
    await client.close();
    return;
  }

  const { syncOne } = require(path.join(repoRoot, 'new-telecrm-webhook.js'));
  const { leadFromMirror } = require('./sync-1000-users');
  const summary = { created: 0, synced: 0, failed: 0, errors: [] };

  for (let i = 0; i < missing.length; i += 1) {
    const p = missing[i];
    const u = byPhone.get(p);
    const pd = u.profileData || {};
    const status = STATUS_MAP[pd.status] || 'Fresh';
    const name = [pd.firstName, pd.lastName].filter(Boolean).join(' ').trim() || null;
    process.stdout.write(`[${i + 1}/${missing.length}] ${p} `);
    try {
      let lead = leadFromMirror(mirror.get(p));
      if (!lead && CREATE) {
        // TeleCRM silently drops creates sent with a bare 10-digit phone.
        const fields = { phone: `91${p}`, status, name, dashboard_field: String(u._id) };
        if (u.email) fields.email = u.email;
        if (SEND_CAPTURED_ON && u.createdAt) fields['Captured On'] = Number(u.createdAt);
        await createInTeleCRM(fields);
        summary.created += 1;
      }
      if (!lead) lead = { status, fields: { phone: `91${p}`, name, status } };
      const rawCreated = lead.fields.created_on ?? lead.fields.created_at;
      const leadCreated = (typeof rawCreated === 'number' ? rawCreated : Date.parse(rawCreated)) || Infinity;
      if (u.createdAt && Number(u.createdAt) < leadCreated) lead.fields.created_on = Number(u.createdAt);
      await syncOne(p, { lead });
      summary.synced += 1;
      console.log('ok');
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({ phone: p, error: redact(err) });
      console.log(`FAIL ${redact(err)}`);
    }
    if (DELAY_MS && i < missing.length - 1) await sleep(DELAY_MS);
  }

  console.log(JSON.stringify(summary, null, 2));
  await client.close();
  process.exit(summary.failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`script failed: ${redact(err)}`);
  process.exit(1);
});
