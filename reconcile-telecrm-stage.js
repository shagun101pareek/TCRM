/**
 * reconcile-telecrm-stage.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Durable self-heal for missed appointment→TeleCRM stage pushes.
 *
 * The n8n `appointment-status-to-telecrm` workflow occasionally drops a single
 * change-stream event (n8n doesn't retry), leaving a lead stuck at "Fresh" even
 * though the patient booked/paid a first-visit appointment (e.g. phone
 * 9738977035). This job finds those and re-pushes the correct stage using the
 * SAME endpoint + mapping the workflow uses.
 *
 * Mapping (identical to Map Status in the workflow):
 *   first-visit PAID / INVOICE_GENERATED / VISITED  → Converted
 *   first-visit BOOKED                              → Session booked
 *
 * Conservative by design: it only touches leads whose TeleCRM status is still
 * "Fresh" (the clear "never advanced" signature) — it never overrides a
 * call-centre outcome (No Response / Not Converted / etc.) or a manual change.
 *
 * Usage:
 *   node scripts/reconcile-telecrm-stage.js              # DRY RUN (no writes)
 *   node scripts/reconcile-telecrm-stage.js --apply      # actually push to TeleCRM
 *   node scripts/reconcile-telecrm-stage.js --since 3    # only appts from last 3 days (default 7)
 *   node scripts/reconcile-telecrm-stage.js --all        # ignore date window
 *
 * Env: MONGODB_URI, MONGODB_DB, TELECRM_ENTERPRISE_ID, TELECRM_AUTOUPDATE_TOKEN.
 */

'use strict';

require('dotenv').config();
const { MongoClient } = require('mongodb');

const EID = process.env.TELECRM_ENTERPRISE_ID;
const WRITE_TOKEN = process.env.TELECRM_AUTOUPDATE_TOKEN || process.env.TELECRM_ASYNC_API;
const AUTOUPDATE_URL = `https://next-api.telecrm.in/enterprise/${EID}/autoupdatelead`;
const RATE_LIMIT_MS = 350; // be gentle with the TeleCRM API

const CONVERTED_APPT = new Set(['PAID', 'INVOICE_GENERATED', 'VISITED']);
const ACTIVE_APPT = ['BOOKED', 'PAID', 'VISITED', 'INVOICE_GENERATED'];
const STUCK_STATUS = 'Fresh'; // only reconcile leads still at the initial state

// ── args ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all');
const sinceDays = (() => {
  const i = args.indexOf('--since');
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : 7;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Target TeleCRM stage from a patient's first-visit appointment statuses.
function targetStatus(apptStatuses) {
  if (apptStatuses.some((s) => CONVERTED_APPT.has(s))) return 'Converted';
  if (apptStatuses.includes('BOOKED')) return 'Session booked';
  return null;
}

async function pushStatus(phone10, status) {
  const resp = await fetch(AUTOUPDATE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WRITE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { phone: '91' + phone10, status } }),
  });
  return resp.status;
}

async function findStuck(db) {
  const match = { visitType: 'FIRST_VISIT', status: { $in: ACTIVE_APPT } };
  if (!ALL) match.createdAt = { $gte: Date.now() - sinceDays * 86400000 };

  return db.collection('appointments').aggregate([
    { $match: match },
    { $lookup: { from: 'users', localField: 'patient', foreignField: '_id', as: 'u' } },
    { $unwind: '$u' },
    { $lookup: { from: 'telecrm', localField: 'u.phone', foreignField: 'phone', as: 't' } },
    { $addFields: { tel: { $arrayElemAt: ['$t', 0] } } },
    { $match: { 'tel.status': STUCK_STATUS } }, // stuck at Fresh
    { $group: {
      _id: '$u.phone',
      name: { $first: { $concat: [{ $ifNull: ['$u.profileData.firstName', ''] }, ' ', { $ifNull: ['$u.profileData.lastName', ''] }] } },
      apptStatuses: { $addToSet: '$status' },
      lastAppt: { $max: '$createdAt' },
    } },
    { $sort: { lastAppt: -1 } },
  ]).toArray();
}

async function main() {
  if (!WRITE_TOKEN) throw new Error('TELECRM_AUTOUPDATE_TOKEN not set');
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db(process.env.MONGODB_DB);

  const window = ALL ? 'ALL time' : `last ${sinceDays} day(s)`;
  console.log(`\nReconcile TeleCRM stage — ${APPLY ? 'APPLY (writing to TeleCRM)' : 'DRY RUN (no writes)'} · ${window}\n`);

  const stuck = await findStuck(db);
  const actionable = stuck
    .map((s) => ({ ...s, target: targetStatus(s.apptStatuses) }))
    .filter((s) => s.target);

  if (!actionable.length) {
    console.log('✓ Nothing stuck — every first-visit lead has advanced past Fresh.');
    await c.close();
    return;
  }

  console.log(`Found ${actionable.length} stuck lead(s):\n`);
  let pushed = 0, failed = 0;
  for (const s of actionable) {
    const phone = String(s._id);
    const label = `${phone}  ${(s.name || '').trim().padEnd(22)} appts=[${s.apptStatuses.join(',')}]  Fresh → ${s.target}`;
    if (!APPLY) {
      console.log(`  • ${label}   (dry-run)`);
      continue;
    }
    try {
      const code = await pushStatus(phone, s.target);
      const ok = code >= 200 && code < 300;
      console.log(`  ${ok ? '✓' : '✗'} ${label}   [HTTP ${code}]`);
      ok ? pushed++ : failed++;
    } catch (e) {
      console.log(`  ✗ ${label}   [${e.message}]`);
      failed++;
    }
    await sleep(RATE_LIMIT_MS);
  }

  console.log(`\n${APPLY ? `Done — pushed ${pushed}, failed ${failed}` : `Dry run — ${actionable.length} would be pushed. Re-run with --apply to write.`}`);
  await c.close();
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { targetStatus, findStuck };
