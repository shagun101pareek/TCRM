#!/usr/bin/env node
'use strict';

/**
 * Load the latest Stance users that also exist in the telecrm mirror,
 * then either print/save their phones or upsert them into new-telecrm
 * via the existing JS sync (new-telecrm-webhook.js syncOne).
 *
 * Does not change n8n workflows. Does not push source back to TeleCRM.
 *
 * Usage (from repository root):
 *   node scripts/sync-1000-users.js
 *   node scripts/sync-1000-users.js --limit 1000 --out mcp/findings/sync-1000-phones.json
 *   node scripts/sync-1000-users.js --apply --limit 1000 --delay-ms 250
 *   node scripts/sync-1000-users.js --apply --from-mirror --limit 5
 *
 * Default is dry-run (Mongo read only). --apply writes new-telecrm.
 * Live TeleCRM lead/search needs a Sync-typed token. If search returns 401,
 * --apply uses the Mongo telecrm mirror for CRM fields (dashboard join still runs).
 */

const fs = require('fs');
const path = require('path');
const { repoRoot, resolveSafe } = require('./lib/common');

process.chdir(repoRoot);

const FETCH_PIPELINE = [
  {
    $match: {
      $expr: {
        $eq: [{ $strLenCP: { $toString: { $ifNull: ['$phone', ''] } } }, 10],
      },
    },
  },
  {
    $lookup: {
      from: 'telecrm',
      localField: 'phone',
      foreignField: 'phone',
      as: '_crm',
    },
  },
  { $match: { '_crm.0': { $exists: true } } },
  { $sort: { updatedAt: -1 } },
  { $limit: 1000 },
  { $project: { _id: 0, phone: 1, updatedAt: 1, firstName: '$profileData.firstName', lastName: '$profileData.lastName', dashStatus: '$profileData.status' } },
];

function parseArgs(argv) {
  const out = {
    limit: 1000,
    apply: false,
    delayMs: 250,
    outPath: null,
    fromMirror: false,
    fromApi: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--limit':
        out.limit = Number(next());
        break;
      case '--delay-ms':
        out.delayMs = Number(next());
        break;
      case '--out':
        out.outPath = next();
        break;
      case '--apply':
        out.apply = true;
        break;
      case '--dry-run':
        out.apply = false;
        break;
      case '--from-mirror':
        out.fromMirror = true;
        break;
      case '--from-api':
        out.fromApi = true;
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
  if (out.fromMirror && out.fromApi) {
    console.error('Use only one of --from-mirror or --from-api');
    process.exit(2);
  }
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > 10000) {
    console.error('--limit must be an integer from 1 to 10000');
    process.exit(2);
  }
  if (!Number.isFinite(out.delayMs) || out.delayMs < 0) {
    console.error('--delay-ms must be a number >= 0');
    process.exit(2);
  }
  return out;
}

function help() {
  console.log(`Usage: node scripts/sync-1000-users.js [options]

Select the latest 10-digit Stance users that also exist in the telecrm
mirror, then list them or sync each phone into new-telecrm.

Options:
  --limit N        How many users to load (default 1000, max 10000)
  --out FILE       Write the user list as JSON inside the repo
  --apply          Call JS syncOne for each phone (writes new-telecrm)
  --from-mirror    --apply: CRM fields from Mongo telecrm (skip lead/search)
  --from-api       --apply: require live TeleCRM lead/search (fails on 401)
  --dry-run        List only; no upserts (default)
  --delay-ms N     Pause between --apply calls (default 250)
  --help

Without --from-mirror/--from-api, --apply probes lead/search once. HTTP 401
falls back to the Mongo telecrm mirror (this .env Sync key is not accepted).

Reads .env with Node stdlib (dotenv is not required). MONGODB_DB can be
omitted when it is already the path in MONGODB_URI. NEW_TELECRM_PUSH_SOURCE
must stay off.
`);
}

function redact(err) {
  let msg = String(err && err.message ? err.message : err);
  return msg.replace(/mongodb(\+srv)?:\/\/\S+/gi, 'mongodb://***');
}

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing ${name} in .env`);
  }
  return value;
}

function databaseFromUri(uri) {
  try {
    const parsed = new URL(uri);
    const name = decodeURIComponent(parsed.pathname || '').replace(/^\//, '').trim();
    return name || '';
  } catch (_) {
    return '';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leadSourceFromMirror(doc, nested) {
  const candidates = [doc.lead_source, nested.lead_source];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const arr = Array.isArray(doc.lead_source) ? doc.lead_source : [];
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    const entry = arr[i];
    if (typeof entry === 'string' && entry.trim()) return entry.trim();
    if (entry && typeof entry.source === 'string' && entry.source.trim()) return entry.source.trim();
  }
  return '';
}

function leadFromMirror(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const nested = doc.fields && typeof doc.fields === 'object' && !Array.isArray(doc.fields)
    ? doc.fields
    : {};
  const fields = { ...doc, ...nested };
  delete fields._id;
  delete fields.fields;
  const leadSource = leadSourceFromMirror(doc, nested);
  if (leadSource) fields.lead_source = leadSource;
  return {
    status: doc.status || nested.status,
    fields,
  };
}

async function probeTeleCRMSearch() {
  const token = String(process.env.TELECRM_API_TOKEN || '').trim();
  const eid = String(process.env.TELECRM_ENTERPRISE_ID || '').trim();
  if (!token || !eid) return { ok: false, http: 0, reason: 'missing-token-or-enterprise' };
  try {
    const resp = await fetch(
      `https://next.telecrm.in/autoupdate/v2/enterprise/${eid}/lead/search?limit=1`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { phone: '910000000000' } }),
      },
    );
    return { ok: resp.ok, http: resp.status };
  } catch (_) {
    return { ok: false, http: 0, reason: 'network' };
  }
}

async function loadMirrorLead(db, phone) {
  const phone10 = String(phone || '').replace(/[^0-9]/g, '').slice(-10);
  const value = await db.collection('telecrm').findOne(
    { phone: { $in: [phone10, '91' + phone10, '0' + phone10] } },
    { sort: { modified_at: -1 } },
  );
  const lead = leadFromMirror(value);
  if (!lead) throw new Error('No telecrm mirror doc for this phone');
  return lead;
}

function loadEnv() {
  const abs = path.join(repoRoot, '.env');
  if (!fs.existsSync(abs)) {
    throw new Error('.env file not found at repository root');
  }
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
  if (!process.env.TELECRM_ENTERPRISE_ID) {
    process.env.TELECRM_ENTERPRISE_ID = '69da237dbbfc0db1fc1ea6e2';
  }
  if (loaded.length) console.log(`Loaded .env keys: ${loaded.join(', ')}`);
}

async function loadUsers(limit) {
  requireEnv('MONGODB_URI');
  requireEnv('MONGODB_DB');
  let MongoClient;
  try {
    ({ MongoClient } = require('mongodb'));
  } catch (err) {
    throw new Error('mongodb driver is not installed in this folder (same as new-telecrm-webhook.js)');
  }
  const pipeline = FETCH_PIPELINE.map((stage) => {
    if (stage.$limit != null) return { $limit: limit };
    return stage;
  });
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB);
    const rows = await db.collection('users').aggregate(pipeline).toArray();
    return rows.map((row) => ({
      phone: String(row.phone || ''),
      updatedAt: row.updatedAt || null,
      firstName: row.firstName || null,
      lastName: row.lastName || null,
      dashStatus: row.dashStatus || null,
    })).filter((row) => row.phone);
  } finally {
    await client.close();
  }
}

async function applySync(rows, delayMs, leadMode) {
  loadEnv();
  if (String(process.env.NEW_TELECRM_PUSH_SOURCE || 'false') === 'true') {
    throw new Error('Refusing to run: NEW_TELECRM_PUSH_SOURCE is on');
  }
  let useMirror = leadMode === 'mirror';
  if (leadMode === 'auto') {
    const probe = await probeTeleCRMSearch();
    useMirror = !probe.ok;
    if (useMirror) {
      console.log(
        `TeleCRM lead/search HTTP ${probe.http || 'n/a'} — using Mongo telecrm mirror for CRM fields (search needs a Sync-typed token).`,
      );
    } else {
      console.log('TeleCRM lead/search authorized — fetching live leads.');
    }
  } else if (useMirror) {
    console.log('Using Mongo telecrm mirror for CRM fields (--from-mirror).');
  }
  const { syncOne } = require(path.join(repoRoot, 'new-telecrm-webhook.js'));
  let MongoClient;
  if (useMirror) {
    ({ MongoClient } = require('mongodb'));
  }
  const client = useMirror ? new MongoClient(process.env.MONGODB_URI) : null;
  if (client) await client.connect();
  const db = client ? client.db(process.env.MONGODB_DB) : null;
  const summary = { ok: 0, failed: 0, errors: [], leadSource: useMirror ? 'mongo-telecrm-mirror' : 'telecrm-api' };
  try {
    for (let i = 0; i < rows.length; i += 1) {
      const phone = rows[i].phone;
      process.stdout.write(`[${i + 1}/${rows.length}] ${phone} `);
      try {
        const opts = {};
        if (useMirror) opts.lead = await loadMirrorLead(db, phone);
        const result = await syncOne(phone, opts);
        summary.ok += 1;
        console.log(result && result.is_new ? 'inserted' : 'upserted');
      } catch (err) {
        summary.failed += 1;
        summary.errors.push({ phone, error: redact(err) });
        console.log(`FAIL ${redact(err)}`);
      }
      if (delayMs && i < rows.length - 1) await sleep(delayMs);
    }
  } finally {
    if (client) await client.close();
  }
  return summary;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }

  loadEnv();
  console.log(args.apply ? 'Mode: apply (writes new-telecrm)' : 'Mode: dry-run (read only)');
  const rows = await loadUsers(args.limit);
  console.log(`Loaded ${rows.length} users from users ⋈ telecrm (limit ${args.limit})`);

  if (args.outPath) {
    const abs = resolveSafe(args.outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify({ count: rows.length, users: rows }, null, 2)}\n`);
    console.log(`Wrote ${args.outPath}`);
  } else if (!args.apply) {
    console.log(JSON.stringify({ count: rows.length, users: rows }, null, 2));
  }

  if (!args.apply) {
    console.log('Dry-run complete. Re-run with --apply to upsert new-telecrm.');
    return;
  }

  const leadMode = args.fromMirror ? 'mirror' : args.fromApi ? 'api' : 'auto';
  const summary = await applySync(rows, args.delayMs, leadMode);
  console.log(JSON.stringify({
    loaded: rows.length,
    upserted: summary.ok,
    failed: summary.failed,
    leadSource: summary.leadSource,
    errors: summary.errors,
  }, null, 2));
  if (summary.failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`script failed: ${redact(err)}`);
    process.exit(1);
  });
}

module.exports = { leadFromMirror, leadSourceFromMirror };
