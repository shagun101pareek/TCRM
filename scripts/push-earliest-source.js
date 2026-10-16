#!/usr/bin/env node
'use strict';

/**
 * Push new-telecrm source[0].source to TeleCRM when it differs from the
 * mirror dropdown. Dry-run by default.
 *
 * Does not call syncOne. Does not set NEW_TELECRM_PUSH_SOURCE.
 * The body is phone + source only (10-digit phone, no status).
 *
 *   node scripts/push-earliest-source.js
 *   node scripts/push-earliest-source.js --phone 9876543210
 *   node scripts/push-earliest-source.js --limit 20
 *   node scripts/push-earliest-source.js --apply --limit 20
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const repoRoot = path.resolve(__dirname, '..');

function telecrmDropdownSource(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string' || typeof raw === 'number') return String(raw).trim();
  if (Array.isArray(raw)) {
    for (let i = raw.length - 1; i >= 0; i--) {
      const row = raw[i];
      const label = telecrmDropdownSource(
        row && typeof row === 'object' && !Array.isArray(row)
          ? (row.value != null ? row.value : row.tele_source)
          : row
      );
      if (label) return label;
    }
    return '';
  }
  if (typeof raw === 'object') {
    if (raw.value != null && String(raw.value).trim()) return String(raw.value).trim();
    if (raw.tele_source != null && String(raw.tele_source).trim()) return String(raw.tele_source).trim();
  }
  return '';
}

function decideEarliestSourcePush(sources, currentTelecrmSource, phone) {
  const earliest = Array.isArray(sources) && sources[0] && sources[0].source != null
    ? String(sources[0].source).trim()
    : '';
  const current = currentTelecrmSource == null ? '' : String(currentTelecrmSource).trim();
  const pushPhone = phone == null ? '' : String(phone).trim();
  return {
    telecrm_push_source: earliest || null,
    should_push_source: Boolean(earliest) && Boolean(pushPhone) && earliest !== current,
  };
}

function parseArgs(argv) {
  const out = {
    apply: false,
    limit: null,
    skip: 0,
    phones: [],
    delayMs: 350,
    db: null,
    uriEnv: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--apply': out.apply = true; break;
      case '--limit': out.limit = Number(next()); break;
      case '--skip': out.skip = Number(next()); break;
      case '--phone': out.phones.push(next()); break;
      case '--delay-ms': out.delayMs = Number(next()); break;
      case '--db': out.db = next(); break;
      case '--uri-env': out.uriEnv = next(); break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (out.limit != null && (!Number.isFinite(out.limit) || out.limit < 0)) {
    throw new Error('--limit must be a non-negative number');
  }
  if (!Number.isFinite(out.skip) || out.skip < 0) throw new Error('--skip must be a non-negative number');
  if (!Number.isFinite(out.delayMs) || out.delayMs < 0) throw new Error('--delay-ms must be a non-negative number');
  return out;
}

function help() {
  console.log(`Usage: node scripts/push-earliest-source.js [--apply] [--phone N] [--limit N] [--skip N]

Walks new-telecrm and compares source[0].source with the telecrm mirror dropdown.
Dry-run prints the phones that would change. --apply posts { phone, source } only.

Options:
  --apply           Write TeleCRM. Default is dry-run.
  --phone N         Only this 10-digit phone (repeatable)
  --limit N         Cap rows after --skip
  --skip N          Skip the first N sorted phones
  --delay-ms N      Pause between --apply calls (default 350)
  --db NAME         Database name (default stance-dashboard)
  --uri-env KEY     .env key for the Mongo URI
`);
}

function redact(err) {
  const msg = String(err && err.message ? err.message : err);
  return msg.replace(/mongodb(\+srv)?:\/\/\S+/gi, '[redacted-mongo-uri]');
}

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

function normPhone10(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/[^0-9]/g, '');
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  return s.length === 10 ? s : '';
}

function mirrorDropdown(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const fields = doc.fields && typeof doc.fields === 'object' ? doc.fields : {};
  const fromFields = telecrmDropdownSource(fields.source);
  if (fromFields) return fromFields;
  return telecrmDropdownSource(doc.source);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadMirrors(db, phones) {
  const map = new Map();
  const variants = [];
  for (const phone of phones) variants.push(phone, '91' + phone, '0' + phone);
  for (let i = 0; i < variants.length; i += 600) {
    const chunk = variants.slice(i, i + 600);
    const docs = await db.collection('telecrm').find(
      { phone: { $in: chunk } },
      { projection: { phone: 1, source: 1, fields: 1 } },
    ).toArray();
    for (const doc of docs) {
      const key = normPhone10(doc.phone);
      if (key && !map.has(key)) map.set(key, doc);
    }
  }
  return map;
}

async function pushSource(url, token, phone, source) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: { phone, source } }),
  });
  return resp.status;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }
  loadEnv();
  const uriEnv = args.uriEnv
    || (process.env.MONGODB_URI_PRODUCTION ? 'MONGODB_URI_PRODUCTION' : 'MONGODB_URI');
  const uri = String(process.env[uriEnv] || '').trim();
  if (!uri) throw new Error(`Missing ${uriEnv} in .env`);
  const dbName = args.db || process.env.MONGODB_DB || 'stance-dashboard';
  const enterpriseId = process.env.TELECRM_ENTERPRISE_ID || '69da237dbbfc0db1fc1ea6e2';
  const token = process.env.TELECRM_ASYNC_API2
    || process.env.TELECRM_AUTOUPDATE_TOKEN
    || process.env.TELECRM_ASYNC_API
    || '';
  const url = `https://next-api.telecrm.in/enterprise/${enterpriseId}/autoupdatelead`;
  if (args.apply && !token) throw new Error('Missing TeleCRM write token (TELECRM_ASYNC_API2)');

  const wanted = args.phones.map(normPhone10).filter(Boolean);
  if (args.phones.length && wanted.length !== args.phones.length) {
    throw new Error('--phone must be a 10-digit number');
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    console.log(`Database: ${dbName}`);
    console.log(args.apply ? 'Mode: apply' : 'Mode: dry-run');
    const filter = { 'source.0.source': { $type: 'string' } };
    if (wanted.length) filter.phone = { $in: wanted };
    const rows = await db.collection('new-telecrm').find(
      filter,
      { projection: { phone: 1, source: 1 } },
    ).toArray();
    rows.sort((a, b) => String(a.phone || '').localeCompare(String(b.phone || '')));
    const sliced = rows.slice(args.skip, args.limit == null ? undefined : args.skip + args.limit);
    const phones = sliced.map((row) => normPhone10(row.phone)).filter(Boolean);
    const mirrors = await loadMirrors(db, phones);

    let skippedEmpty = 0;
    let skippedSame = 0;
    let skippedPhone = 0;
    const pending = [];
    for (const row of sliced) {
      const phone = normPhone10(row.phone);
      if (!phone) {
        skippedPhone += 1;
        continue;
      }
      const current = mirrorDropdown(mirrors.get(phone));
      const decision = decideEarliestSourcePush(row.source, current, phone);
      if (!decision.telecrm_push_source) {
        skippedEmpty += 1;
        continue;
      }
      if (!decision.should_push_source) {
        skippedSame += 1;
        continue;
      }
      pending.push({ phone, source: decision.telecrm_push_source, current });
    }

    for (const item of pending) {
      const from = item.current || '(empty)';
      console.log(`${args.apply ? 'push' : 'would push'} ${item.phone}  ${from} -> ${item.source}`);
    }
    console.log(`scanned ${sliced.length}  push ${pending.length}  same ${skippedSame}  empty ${skippedEmpty}  bad-phone ${skippedPhone}`);

    if (!args.apply) return;
    let ok = 0;
    let failed = 0;
    for (const item of pending) {
      const status = await pushSource(url, token, item.phone, item.source);
      if (status >= 200 && status < 300) ok += 1;
      else {
        failed += 1;
        console.log(`fail ${item.phone} http ${status}`);
      }
      if (args.delayMs) await sleep(args.delayMs);
    }
    console.log(`applied ok ${ok}  failed ${failed}`);
    if (failed) process.exitCode = 1;
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

module.exports = { telecrmDropdownSource, decideEarliestSourcePush, normPhone10, mirrorDropdown };
