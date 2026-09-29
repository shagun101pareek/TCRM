/**
 * new-telecrm-watcher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Change-stream watcher for both sides.
 *
 * Watches: telecrm, users, appointments, web_visitors.
 * On any insert/update/replace it resolves the change → a phone number and
 * re-runs the same `syncOne(phone)` used by the webhook, so the lead's doc is
 * re-materialized (telecrm_* + dash_* + web analytics on source[] + stage[]).
 *
 * IMPORTANT — `telecrm` is watched ONLY as a change-detection TRIGGER. We never
 * read lead data out of the `telecrm` collection; when it changes (kept fresh by
 * the crm-mongo-sync job) we just take the phone and fetch the real, current lead
 * from the TeleCRM API inside syncOne. This is what captures TeleCRM-side stage
 * changes without depending on TeleCRM's outbound webhook reaching this host.
 * (If you later point TeleCRM's webhook at /webhook/telecrm, you can drop this.)
 *
 * Phone resolution per collection:
 *   telecrm        → doc.phone   (trigger only; data still comes from the API)
 *   users          → doc.phone
 *   appointments   → doc.patient    → users._id → users.phone
 *   web_visitors   → doc.patient_id → users._id → users.phone
 *
 * Durability: resume tokens are persisted in `new_telecrm_watch_state` so a
 * restart continues where it left off (no missed changes).
 *
 * Per-phone debounce coalesces bursts (e.g. chatty web_touchpoints) so we don't
 * hammer the TeleCRM API.
 *
 * Usage:  node scripts/new-telecrm-watcher.js
 *
 * NOTE: requires a replica set / Atlas (change streams). Your cluster qualifies.
 */

'use strict';

const { syncOne, getDb, normPhone10, C, now } = require('./new-telecrm-webhook');

const WATCH = ['telecrm', 'users', 'appointments', 'web_visitors'];
const STATE_COLLECTION = 'new_telecrm_watch_state';
const DEBOUNCE_MS = 1500;

// Only these ops carry a meaningful fullDocument to resolve a phone from.
const RELEVANT_OPS = new Set(['insert', 'update', 'replace']);

const _pending = new Map();   // phone → { timer, reasons:Set }
const _stats = { events: 0, syncs: 0, skipped: 0, errors: 0 };

function log(color, tag, msg) {
  console.log(`${C.gray}${now()}${C.reset} ${color}${tag}${C.reset} ${msg}`);
}

// Resolve a changed document from any watched collection → 10-digit phone.
async function resolvePhone(db, coll, doc) {
  if (!doc) return null;
  if (coll === 'telecrm' || coll === 'users') {
    return doc.phone ? normPhone10(doc.phone) : null;
  }
  // appointments / web_visitors → look up the owning user by _id
  const userId = coll === 'appointments' ? doc.patient : doc.patient_id;
  if (!userId) return null;
  const user = await db.collection('users').findOne({ _id: userId }, { projection: { phone: 1 } });
  return user && user.phone ? normPhone10(user.phone) : null;
}

// Debounced trigger: coalesce rapid changes for the same phone into one sync.
function schedule(phone, reason) {
  const entry = _pending.get(phone) || { timer: null, reasons: new Set() };
  entry.reasons.add(reason);
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => runSync(phone, entry.reasons), DEBOUNCE_MS);
  _pending.set(phone, entry);
}

async function runSync(phone, reasons) {
  _pending.delete(phone);
  const why = [...reasons].join(', ');
  log(C.cyan, '↻ resync', `${C.bold}${phone}${C.reset} ${C.gray}(triggered by: ${why})${C.reset}`);
  try {
    await syncOne(phone);
    _stats.syncs += 1;
  } catch (e) {
    if (/Lead not found in TeleCRM/.test(e.message)) {
      _stats.skipped += 1;
      log(C.yellow, '⤼ skip ', `${phone} ${C.gray}— no TeleCRM lead for this phone (dashboard-only contact)${C.reset}`);
    } else {
      _stats.errors += 1;
      log(C.red, '✗ error', `${phone} — ${e.message}`);
    }
  }
}

async function saveToken(db, coll, token) {
  if (!token) return;
  await db.collection(STATE_COLLECTION).updateOne(
    { _id: coll }, { $set: { token, updatedAt: new Date() } }, { upsert: true },
  );
}

async function loadToken(db, coll) {
  const s = await db.collection(STATE_COLLECTION).findOne({ _id: coll });
  return s && s.token;
}

async function watchCollection(db, coll) {
  const resumeAfter = await loadToken(db, coll);
  const opts = { fullDocument: 'updateLookup' };
  if (resumeAfter) opts.resumeAfter = resumeAfter;

  const stream = db.collection(coll).watch([], opts);
  log(C.green, '● watch', `${coll}${resumeAfter ? C.gray + ' (resumed)' + C.reset : ''}`);

  stream.on('change', async (change) => {
    try {
      _stats.events += 1;
      await saveToken(db, coll, change._id);
      if (!RELEVANT_OPS.has(change.operationType)) return;
      const phone = await resolvePhone(db, coll, change.fullDocument);
      if (!phone) { _stats.skipped += 1; return; }
      log(C.magenta, '⚡ event', `${coll}.${change.operationType} → phone ${C.bold}${phone}${C.reset}`);
      schedule(phone, `${coll}.${change.operationType}`);
    } catch (e) {
      _stats.errors += 1;
      log(C.red, '✗ error', `${coll} stream: ${e.message}`);
    }
  });

  stream.on('error', (e) => {
    log(C.red, '✗ error', `${coll} stream died: ${e.message} — restarting in 3s`);
    setTimeout(() => watchCollection(db, coll).catch(() => {}), 3000);
  });

  return stream;
}

async function main() {
  const db = await getDb();
  console.log('');
  console.log(`${C.green}${C.bold}  ●  new-telecrm watcher — LIVE${C.reset}`);
  console.log(`  ${C.gray}────────────────────────────────────────────${C.reset}`);
  console.log(`  ${C.cyan}watching${C.reset}   ${WATCH.join(', ')}`);
  console.log(`  ${C.cyan}target${C.reset}     ${process.env.MONGODB_DB}.new-telecrm`);
  console.log(`  ${C.cyan}debounce${C.reset}   ${DEBOUNCE_MS}ms per phone`);
  console.log(`  ${C.gray}────────────────────────────────────────────${C.reset}`);

  for (const coll of WATCH) await watchCollection(db, coll);
  console.log(`  ${C.dim}all streams open · waiting for changes…  (Ctrl-C to stop)${C.reset}\n`);

  // periodic heartbeat so you can see it's alive + throughput
  setInterval(() => {
    log(C.gray, '· stats', `events=${_stats.events} syncs=${_stats.syncs} skipped=${_stats.skipped} errors=${_stats.errors} pending=${_pending.size}`);
  }, 60000);
}

if (require.main === module) {
  main().catch((e) => { console.error(`${C.red}watcher fatal:${C.reset} ${e.message}`); process.exit(1); });
}

module.exports = { resolvePhone };
