#!/usr/bin/env node
'use strict';

/**
 * Backfill every usable telecrm mirror phone into new-telecrm via JS syncOne.
 *
 * Development default is database stance-development. CRM fields come from the
 * Mongo telecrm mirror. Existing new-telecrm rows are refreshed (replaceOne upsert).
 * Includes CRM-only phones that have no Stance user.
 *
 * Does not change n8n workflows. Does not push source back to TeleCRM.
 *
 * Usage (from repository root):
 *   node scripts/backfill-new-telecrm.js
 *   node scripts/backfill-new-telecrm.js --limit 5
 *   node scripts/backfill-new-telecrm.js --apply --from-mirror --limit 5
 *   node scripts/backfill-new-telecrm.js --apply --from-mirror
 *   node scripts/backfill-new-telecrm.js --apply --from-mirror --skip 500
 *   node scripts/backfill-new-telecrm.js --db stance-dashboard --uri-env MONGODB_URI_PRODUCTION --allow-other-db --allow-empty-target --from-mirror
 */

const fs = require('fs');
const path = require('path');
const { repoRoot } = require('./lib/common');
const { leadFromMirror } = require('./sync-1000-users');

process.chdir(repoRoot);

const DEFAULT_DB = 'stance-development';
const PRODUCTION_DB = 'stance-dashboard';
const PRODUCTION_URI_ENV = 'MONGODB_URI_PRODUCTION';
let progressPath = path.join(repoRoot, '.agent', 'backfill-new-telecrm-progress.json');

function parseArgs(argv) {
  const out = {
    limit: null,
    skip: 0,
    phones: [],
    apply: false,
    delayMs: 0,
    fromMirror: true,
    fromApi: false,
    db: DEFAULT_DB,
    uriEnv: '',
    quiet: null,
    allowOtherDb: false,
    allowEmptyTarget: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--limit':
        out.limit = Number(next());
        break;
      case '--skip':
        out.skip = Number(next());
        break;
      case '--phone':
        out.phones.push(String(next() || '').trim());
        break;
      case '--delay-ms':
        out.delayMs = Number(next());
        break;
      case '--db':
        out.db = String(next() || '').trim();
        break;
      case '--uri-env':
        out.uriEnv = String(next() || '').trim();
        break;
      case '--apply':
        out.apply = true;
        break;
      case '--dry-run':
        out.apply = false;
        break;
      case '--from-mirror':
        out.fromMirror = true;
        out.fromApi = false;
        break;
      case '--from-api':
        out.fromApi = true;
        out.fromMirror = false;
        break;
      case '--quiet':
        out.quiet = true;
        break;
      case '--verbose':
        out.quiet = false;
        break;
      case '--allow-other-db':
        out.allowOtherDb = true;
        break;
      case '--allow-empty-target':
        out.allowEmptyTarget = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
    }
  }
  if (out.limit != null && (!Number.isInteger(out.limit) || out.limit < 1)) {
    console.error('--limit must be a positive integer');
    process.exit(2);
  }
  if (!Number.isInteger(out.skip) || out.skip < 0) {
    console.error('--skip must be an integer >= 0');
    process.exit(2);
  }
  if (!Number.isFinite(out.delayMs) || out.delayMs < 0) {
    console.error('--delay-ms must be a number >= 0');
    process.exit(2);
  }
  if (!out.db) {
    console.error('--db must be a non-empty database name');
    process.exit(2);
  }
  if (out.uriEnv && !/^[A-Z][A-Z0-9_]*$/.test(out.uriEnv)) {
    console.error('--uri-env must be an environment variable name');
    process.exit(2);
  }
  if (out.quiet == null) out.quiet = Boolean(out.apply && (out.limit == null || out.limit > 20));
  return out;
}

function help() {
  console.log(`Usage: node scripts/backfill-new-telecrm.js [options]

Load every usable 10-digit phone from the telecrm mirror, then list them or
upsert each into new-telecrm via JS syncOne. Existing join rows are refreshed.
CRM-only phones (no Stance user) are included.

Options:
  --db NAME              Database (default ${DEFAULT_DB})
  --uri-env KEY          Use this .env key as MONGODB_URI (example ${PRODUCTION_URI_ENV})
  --limit N              Cap how many phones to process after --skip
  --skip N               Skip the first N unique phones (resume)
  --phone N              Only this 10-digit phone (repeatable)
  --apply                Call syncOne for each phone (writes new-telecrm)
  --from-mirror          CRM fields from Mongo telecrm (default)
  --from-api             Require live TeleCRM lead/search
  --dry-run              Counts and sample only; no upserts (default)
  --delay-ms N           Pause between --apply calls (default 0)
  --quiet                Hide syncOne banners (default for large --apply)
  --verbose              Keep syncOne banners
  --allow-other-db       Permit a database other than ${DEFAULT_DB}
  --allow-empty-target   Permit apply when new-telecrm is empty
  --help

NEW_TELECRM_PUSH_SOURCE must stay off. Pause n8n temperature realtime on
new-telecrm inserts before a full apply, or ~16k insert events will fire it.
`);
}

function redact(err) {
  let msg = String(err && err.message ? err.message : err);
  return msg.replace(/mongodb(\+srv)?:\/\/\S+/gi, '[redacted-mongo-uri]');
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

function databaseFromUri(uri) {
  try {
    const parsed = new URL(uri);
    return decodeURIComponent(parsed.pathname || '').replace(/^\//, '').trim();
  } catch (_) {
    return '';
  }
}

function hostFromUri(uri) {
  try {
    return new URL(uri).host || '';
  } catch (_) {
    return '';
  }
}

function progressPathFor(db) {
  const safe = String(db || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
  if (safe === DEFAULT_DB) {
    return path.join(repoRoot, '.agent', 'backfill-new-telecrm-progress.json');
  }
  return path.join(repoRoot, '.agent', `backfill-new-telecrm-progress-${safe}.json`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normPhone10(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/[^0-9]/g, '');
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  return s;
}

function toMs(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function loadEnv() {
  const abs = path.join(repoRoot, '.env');
  if (!fs.existsSync(abs)) throw new Error('.env file not found at repository root');
  const loaded = [];
  const text = fs.readFileSync(abs, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || process.env[key]) continue;
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
    loaded.push(key);
  }
  if (!process.env.MONGODB_DB) {
    const fromUri = databaseFromUri(process.env.MONGODB_URI || '');
    if (fromUri) process.env.MONGODB_DB = fromUri;
  }
  if (!process.env.TELECRM_API_TOKEN && process.env.TELECRM_SYNC_API2) {
    process.env.TELECRM_API_TOKEN = process.env.TELECRM_SYNC_API2;
  }
  if (loaded.length) console.log(`Loaded .env keys: ${loaded.join(', ')}`);
}

async function loadMirrorLead(db, phone) {
  const phone10 = normPhone10(phone);
  const value = await db.collection('telecrm').findOne(
    { phone: { $in: [phone10, '91' + phone10, '0' + phone10] } },
    { sort: { modified_at: -1 } },
  );
  const lead = leadFromMirror(value);
  if (!lead) throw new Error('No telecrm mirror doc for this phone');
  return lead;
}

async function collectPhones(db) {
  const byPhone = new Map();
  let raw = 0;
  let invalid = 0;
  const cursor = db.collection('telecrm').find(
    {},
    { projection: { phone: 1, name: 1, status: 1, modified_at: 1 } },
  );
  for await (const doc of cursor) {
    raw += 1;
    const phone10 = normPhone10(doc.phone);
    if (phone10.length !== 10) {
      invalid += 1;
      continue;
    }
    const modified = toMs(doc.modified_at);
    const prev = byPhone.get(phone10);
    if (!prev || modified >= prev.modified) {
      byPhone.set(phone10, {
        phone: phone10,
        name: doc.name || null,
        status: doc.status || null,
        modified,
      });
    }
  }
  const phones = [...byPhone.values()];
  return { raw, invalid, unique: phones.length, phones };
}

async function existingPhones(db) {
  const set = new Set();
  const cursor = db.collection('new-telecrm').find({}, { projection: { phone: 1 } });
  for await (const doc of cursor) {
    const phone10 = normPhone10(doc.phone);
    if (phone10.length === 10) set.add(phone10);
  }
  return set;
}

function writeProgress(payload) {
  fs.mkdirSync(path.dirname(progressPath), { recursive: true });
  fs.writeFileSync(progressPath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function withQuiet(enabled, fn) {
  if (!enabled) return fn();
  const log = console.log;
  const write = process.stdout.write.bind(process.stdout);
  console.log = () => {};
  process.stdout.write = () => true;
  try {
    return await fn();
  } finally {
    console.log = log;
    process.stdout.write = write;
  }
}

async function applySync(rows, args, db) {
  if (String(process.env.NEW_TELECRM_PUSH_SOURCE || 'false') === 'true') {
    throw new Error('Refusing to run: NEW_TELECRM_PUSH_SOURCE is on');
  }
  if (!args.fromMirror) {
    throw new Error('This backfill is locked to --from-mirror unless you pass --from-api');
  }
  console.log('Using Mongo telecrm mirror for CRM fields (--from-mirror).');
  console.log('Pause n8n temperature realtime on new-telecrm inserts if it is still active.');
  const webhook = require(path.join(repoRoot, 'new-telecrm-webhook.js'));
  const { syncOne, getDb } = webhook;
  const summary = {
    ok: 0,
    inserted: 0,
    refreshed: 0,
    failed: 0,
    errors: [],
    leadSource: 'mongo-telecrm-mirror',
  };
  const startedAt = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 1) {
    const phone = rows[i].phone;
    const n = args.skip + i + 1;
    const total = args.skip + rows.length;
    process.stdout.write(`[${n}/${total}] ${phone} `);
    try {
      const lead = await loadMirrorLead(db, phone);
      const result = await withQuiet(args.quiet, () => syncOne(phone, { lead }));
      summary.ok += 1;
      if (result && result.is_new) {
        summary.inserted += 1;
        console.log('inserted');
      } else {
        summary.refreshed += 1;
        console.log('refreshed');
      }
    } catch (err) {
      summary.failed += 1;
      const error = redact(err);
      summary.errors.push({ phone, error });
      console.log(`FAIL ${error}`);
    }
    if (i === rows.length - 1 || (i + 1) % 25 === 0) {
      writeProgress({
        db: process.env.MONGODB_DB,
        startedAt,
        updatedAt: new Date().toISOString(),
        processed: n,
        total,
        ok: summary.ok,
        inserted: summary.inserted,
        refreshed: summary.refreshed,
        failed: summary.failed,
        lastPhone: phone,
      });
    }
    if (args.delayMs && i < rows.length - 1) await sleep(args.delayMs);
  }
  try {
    const joinDb = await getDb();
    if (joinDb && joinDb.client) await joinDb.client.close();
  } catch (_) { /* process exit will drop the leftover pool */ }
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }

  loadEnv();
  if (!args.uriEnv && args.db === PRODUCTION_DB && process.env[PRODUCTION_URI_ENV]) {
    args.uriEnv = PRODUCTION_URI_ENV;
  }
  if (args.uriEnv) {
    process.env.MONGODB_URI = requireEnv(args.uriEnv);
    console.log(`Using Mongo URI from ${args.uriEnv}`);
  }
  requireEnv('MONGODB_URI');
  process.env.MONGODB_DB = args.db;
  progressPath = progressPathFor(args.db);
  const uriDb = databaseFromUri(process.env.MONGODB_URI || '');
  const uriHost = hostFromUri(process.env.MONGODB_URI || '');
  if (uriHost) console.log(`Mongo host: ${uriHost}`);
  if (uriDb && uriDb !== args.db) {
    console.log(`URI path database is ${uriDb}; using --db ${args.db}`);
  }
  if (args.db === PRODUCTION_DB && /healthflex-dev/i.test(uriHost)) {
    throw new Error(`Refusing ${PRODUCTION_DB} on development Mongo host ${uriHost}. Pass --uri-env ${PRODUCTION_URI_ENV}.`);
  }
  if (args.db !== DEFAULT_DB && !args.allowOtherDb) {
    throw new Error(`Refusing database ${args.db} (expected ${DEFAULT_DB}). Pass --allow-other-db to override.`);
  }
  if (String(process.env.NEW_TELECRM_PUSH_SOURCE || 'false') === 'true') {
    throw new Error('Refusing to run: NEW_TELECRM_PUSH_SOURCE is on');
  }

  const { MongoClient } = require('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB);
    const telecrmCount = await db.collection('telecrm').estimatedDocumentCount();
    const joinCount = await db.collection('new-telecrm').estimatedDocumentCount();
    console.log(args.apply ? 'Mode: apply (writes new-telecrm)' : 'Mode: dry-run (read only)');
    console.log(`Database: ${process.env.MONGODB_DB}`);
    console.log(`telecrm=${telecrmCount} new-telecrm=${joinCount}`);

    if (args.apply && joinCount === 0 && !args.allowEmptyTarget) {
      throw new Error('new-telecrm is empty; refusing apply so this is not the wrong cluster. Pass --allow-empty-target to override.');
    }

    const collected = await collectPhones(db);
    const existing = await existingPhones(db);
    let overlap = 0;
    let missing = 0;
    for (const row of collected.phones) {
      if (existing.has(row.phone)) overlap += 1;
      else missing += 1;
    }
    let sliced = collected.phones.slice(args.skip, args.limit == null ? undefined : args.skip + args.limit);
    if (args.phones.length) {
      const wanted = new Set(args.phones.map((phone) => normPhone10(phone)).filter((phone) => phone.length === 10));
      sliced = collected.phones.filter((row) => wanted.has(row.phone));
      const missingWanted = [...wanted].filter((phone) => !sliced.some((row) => row.phone === phone));
      if (missingWanted.length) {
        throw new Error(`--phone not found in telecrm: ${missingWanted.join(', ')}`);
      }
    }
    console.log(`usable unique 10-digit phones=${collected.unique} (raw=${collected.raw}, invalid=${collected.invalid})`);
    console.log(`already in new-telecrm=${overlap} missing=${missing} skip=${args.skip} selected=${sliced.length}`);
    console.log('Existing join rows will be refreshed; missing phones will be inserted.');

    if (!args.apply) {
      console.log(JSON.stringify({
        db: process.env.MONGODB_DB,
        mongoHost: uriHost,
        uriEnv: args.uriEnv || 'MONGODB_URI',
        telecrm: telecrmCount,
        newTelecrm: joinCount,
        uniquePhones: collected.unique,
        invalidPhones: collected.invalid,
        alreadyPresent: overlap,
        missing,
        selected: sliced.slice(0, 10).map((row) => ({
          phone: row.phone,
          name: row.name,
          status: row.status,
          present: existing.has(row.phone),
        })),
      }, null, 2));
      console.log('Dry-run complete. Re-run with --apply --from-mirror to upsert new-telecrm.');
      return;
    }

    const summary = await applySync(sliced, args, db);
    const after = await db.collection('new-telecrm').estimatedDocumentCount();
    const result = {
      db: process.env.MONGODB_DB,
      selected: sliced.length,
      upserted: summary.ok,
      inserted: summary.inserted,
      refreshed: summary.refreshed,
      failed: summary.failed,
      newTelecrmAfter: after,
      leadSource: summary.leadSource,
      errors: summary.errors,
    };
    console.log(JSON.stringify(result, null, 2));
    writeProgress({
      ...result,
      finishedAt: new Date().toISOString(),
      lastPhone: sliced.length ? sliced[sliced.length - 1].phone : null,
    });
    if (summary.failed) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`script failed: ${redact(err)}`);
    process.exit(1);
  });
}

module.exports = { normPhone10, collectPhones };
