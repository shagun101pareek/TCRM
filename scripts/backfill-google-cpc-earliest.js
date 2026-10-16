#!/usr/bin/env node
'use strict';

/**
 * Set new-telecrm source[0].source to google_cpc for Google CPC users whose
 * earliest source is website. Copies utm_source/utm_medium onto that same row.
 *
 * Does not rebuild source history. Does not call TeleCRM. Dry-run by default.
 *
 *   node scripts/backfill-google-cpc-earliest.js
 *   node scripts/backfill-google-cpc-earliest.js --apply
 *   node scripts/backfill-google-cpc-earliest.js --apply --limit 5
 *   node scripts/backfill-google-cpc-earliest.js --db stance-dashboard --uri-env MONGODB_URI_PRODUCTION --allow-other-db
 *
 * Defaults to stance-development via MONGODB_URI.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_DB = 'stance-development';

function loadEnv() {
  const abs = path.join(repoRoot, '.env');
  if (!fs.existsSync(abs)) throw new Error('.env file not found at repository root');
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
  }
}

function parseArgs(argv) {
  const out = { apply: false, limit: null, db: DEFAULT_DB, allowOtherDb: false, uriEnv: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--allow-other-db') out.allowOtherDb = true;
    else if (arg === '--limit') out.limit = Number(argv[++i]);
    else if (arg === '--db') out.db = String(argv[++i] || '').trim();
    else if (arg === '--uri-env') out.uriEnv = String(argv[++i] || '').trim();
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (out.uriEnv && !/^[A-Z][A-Z0-9_]*$/.test(out.uriEnv)) {
    throw new Error('--uri-env must be an environment variable name');
  }
  if (out.limit != null && (!Number.isInteger(out.limit) || out.limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }
  if (!out.db) throw new Error('--db must be a non-empty database name');
  return out;
}

function normPhone10(raw) {
  let s = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  return s.length === 10 ? s : '';
}

function hostFromUri(uri) {
  try {
    return new URL(uri).host || '';
  } catch (_) {
    return '';
  }
}

function redact(err) {
  return String(err && err.message ? err.message : err).replace(/mongodb(\+srv)?:\/\/\S+/gi, '[redacted-mongo-uri]');
}

async function collect(db) {
  const users = await db.collection('users').find(
    {
      'profileData.webAnalytics.utmSource': { $regex: '^google$', $options: 'i' },
      'profileData.webAnalytics.utmMedium': { $regex: '^cpc$', $options: 'i' },
    },
    { projection: { phone: 1, 'profileData.category': 1 } },
  ).toArray();

  const byPhone = new Map();
  let badPhone = 0;
  for (const user of users) {
    const phone = normPhone10(user.phone);
    if (!phone) {
      badPhone += 1;
      continue;
    }
    if (!byPhone.has(phone)) {
      byPhone.set(phone, {
        phone,
        category: user.profileData && user.profileData.category ? String(user.profileData.category) : '',
      });
    }
  }

  const phones = [...byPhone.keys()];
  const rows = phones.length
    ? await db.collection('new-telecrm').find(
      { phone: { $in: phones } },
      { projection: { phone: 1, source: 1 } },
    ).toArray()
    : [];
  const joined = new Map(rows.map((row) => [normPhone10(row.phone), row]));

  const update = [];
  const skipped = [];
  for (const lead of byPhone.values()) {
    const doc = joined.get(lead.phone);
    if (!doc) {
      skipped.push({ reason: 'no new-telecrm row', category: lead.category, earliest: '' });
      continue;
    }
    const source = Array.isArray(doc.source) ? doc.source : [];
    const earliest = source[0] && source[0].source != null ? String(source[0].source).trim() : '';
    if (earliest === 'website') {
      update.push({ phone: lead.phone, category: lead.category, sourceCount: source.length });
      continue;
    }
    skipped.push({
      reason: earliest ? `earliest is ${earliest}` : 'empty source',
      category: lead.category,
      earliest,
    });
  }
  return { users: users.length, badPhone, update, skipped };
}

function countBy(rows, keyFn) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/backfill-google-cpc-earliest.js [--apply] [--limit N] [--db NAME] [--uri-env KEY] [--allow-other-db]');
    return;
  }
  loadEnv();
  if (args.uriEnv) {
    if (!process.env[args.uriEnv]) throw new Error(`Missing ${args.uriEnv} in .env`);
    process.env.MONGODB_URI = process.env[args.uriEnv];
    console.log(`Using Mongo URI from ${args.uriEnv}`);
  }
  if (!process.env.MONGODB_URI) throw new Error('Missing MONGODB_URI in .env');
  if (args.db !== DEFAULT_DB && !args.allowOtherDb) {
    throw new Error(`Refusing database ${args.db} (expected ${DEFAULT_DB}). Pass --allow-other-db to override.`);
  }
  if (String(process.env.NEW_TELECRM_PUSH_SOURCE || 'false') === 'true') {
    throw new Error('Refusing to run: NEW_TELECRM_PUSH_SOURCE is on');
  }

  const { MongoClient } = require('mongodb');
  const host = hostFromUri(process.env.MONGODB_URI);
  if (args.db === 'stance-dashboard' && /healthflex-dev/i.test(host)) {
    throw new Error('Refusing stance-dashboard on the development Mongo host. Pass --uri-env MONGODB_URI_PRODUCTION.');
  }
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(args.db);
    const found = await collect(db);
    const targets = args.limit == null ? found.update : found.update.slice(0, args.limit);
    console.log(args.apply ? 'Mode: apply (writes new-telecrm source[0] only)' : 'Mode: dry-run (read only)');
    console.log(`Database: ${args.db}${host ? ` host: ${host}` : ''}`);
    console.log(`CPC users: ${found.users}`);
    console.log(`Would update source[0] website -> google_cpc: ${found.update.length}`);
    console.log(`Selected this run: ${targets.length}`);
    console.log(`Skipped: ${found.skipped.length} (bad phone ${found.badPhone})`);
    for (const [label, n] of countBy(found.skipped, (row) => `${row.category || '(blank)'} | ${row.reason}`)) {
      console.log(`  skip ${n} ${label}`);
    }

    if (!args.apply) return;

    const ops = targets.map((lead) => ({
      updateOne: {
        filter: { phone: lead.phone, 'source.0.source': 'website' },
        update: {
          $set: {
            'source.0.source': 'google_cpc',
            'source.0.utm_source': 'google',
            'source.0.utm_medium': 'cpc',
          },
        },
      },
    }));
    let matched = 0;
    let modified = 0;
    for (let i = 0; i < ops.length; i += 200) {
      const result = await db.collection('new-telecrm').bulkWrite(ops.slice(i, i + 200), { ordered: false });
      matched += result.matchedCount;
      modified += result.modifiedCount;
    }
    console.log(`Matched: ${matched}`);
    console.log(`Modified: ${modified}`);
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(redact(err));
  process.exit(1);
});
