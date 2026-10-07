/**
 * new-telecrm-webhook.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Standalone webhook sync that writes leads into the `new-telecrm` collection
 * using the canonical strict schema.
 *
 * This ports the n8n `telecrm-to-mongo-sync` webhook logic into a single script,
 * and additionally:
 *   1. Fetches the FULL lead from the TeleCRM API (same call as n8n).
 *   2. Expands all TeleCRM and website attribution records into `source[]`.
 *   3. Full-joins per lead against `users` → `appointments` → `centers`
 *      and `web_visitors` / `web_touchpoints` to populate dashboard fields.
 *   4. Upserts the composed document into `new-telecrm`.
 *
 * `source[]` and `stage[]` preserve timestamped upstream history and are
 * deduplicated. `source[]` is FIFO (index 0 is the earliest event).
 * `stage[]` is newest-first (index 0 is the latest event).
 * Source-specific metadata is included only when populated.
 *
 * Usage:
 *   node scripts/new-telecrm-webhook.js                 # start webhook server
 *   node scripts/new-telecrm-webhook.js <phone>         # one-off sync (CLI test)
 *
 * Env (from .env): MONGODB_URI, MONGODB_DB, TELECRM_ENTERPRISE_ID,
 *   TELECRM_API_TOKEN, TELECRM_AUTOUPDATE_TOKEN, PORT.
 *   NEW_TELECRM_PUSH_SOURCE=true  → also write derived source back to TeleCRM
 *   (default OFF — outward write, opt-in only).
 */

'use strict';

require('dotenv').config();
const http = require('http');
const { MongoClient, ObjectId } = require('mongodb');

// ── Config ───────────────────────────────────────────────────────────────────
const TARGET_COLLECTION = 'new-telecrm';
const ENTERPRISE_ID = process.env.TELECRM_ENTERPRISE_ID;
const TELECRM_TOKEN = process.env.TELECRM_API_TOKEN;
const TELECRM_ASYNC_TOKEN = process.env.TELECRM_AUTOUPDATE_TOKEN || process.env.TELECRM_ASYNC_API;
const PUSH_SOURCE = String(process.env.NEW_TELECRM_PUSH_SOURCE || 'false') === 'true';
const PORT = Number(process.env.PORT || 3000);

const TELECRM_SEARCH_URL = `https://next.telecrm.in/autoupdate/v2/enterprise/${ENTERPRISE_ID}/lead/search`;
const TELECRM_AUTOUPDATE_URL = `https://next-api.telecrm.in/enterprise/${ENTERPRISE_ID}/autoupdatelead`;

// Valid TeleCRM source categories (trusted if already set on the lead).
const KNOWN_SOURCES = new Set([
  'Website', 'Performance', 'Meta Lead Form', 'Google Lead Form', 'Organic',
  'Founder', 'Event', 'Doctor', 'Customer', 'Clinician', 'Advocate', 'Academies', 'CTWA',
]);

// New-schema label remap for the derived `source` field.
// (Fixture expects "Perf Meta Lead Form" for paid Meta leads.)
const SOURCE_LABEL_MAP = {
  'Meta Lead Form': 'Perf Meta Lead Form',
};

const APPT_CONVERTED_STATUSES = new Set(['VISITED']);

let _client = null;
let _db = null;

// ── Interactive CLI logging ───────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const TTY = process.stdout.isTTY;
const now = () => new Date().toLocaleTimeString('en-GB');

function bar(done, total, width = 24) {
  const w = Math.max(1, Number(width) || 24);
  const t = Math.max(1, Number(total) || 1);
  const ratio = Math.max(0, Number(done) || 0) / t;
  const filled = Math.min(w, Math.max(0, Math.round(ratio * w)));
  return `${C.green}${'█'.repeat(filled)}${C.gray}${'░'.repeat(w - filled)}${C.reset}`;
}

// A per-request stepper: numbered steps, animated spinner, timing, progress bar.
function makeStepper(total, reqId) {
  let idx = 0;
  let planned = Math.max(1, Number(total) || 1);
  return {
    async run(label, fn) {
      idx += 1;
      if (idx > planned) planned = idx;
      const n = idx, t0 = Date.now();
      let frame = 0, timer = null;
      const draw = (icon, color) => {
        const line = `  ${color}${icon}${C.reset} ${C.dim}[${n}/${planned}]${C.reset} ${label}`;
        if (TTY) process.stdout.write(`\r\x1b[2K${line}`);
      };
      if (TTY) {
        draw(SPIN[0], C.cyan);
        timer = setInterval(() => { frame = (frame + 1) % SPIN.length; draw(SPIN[frame], C.cyan); }, 80);
      }
      try {
        const result = await fn();
        if (timer) clearInterval(timer);
        const ms = Date.now() - t0;
        const note = result && result.__note ? ` ${C.gray}${result.__note}${C.reset}` : '';
        const line = `  ${C.green}✓${C.reset} ${C.dim}[${n}/${planned}]${C.reset} ${label}${note} ${C.gray}${ms}ms${C.reset}`;
        process.stdout.write(TTY ? `\r\x1b[2K${line}\n` : `${line}\n`);
        try {
          process.stdout.write(`  ${bar(n, planned)} ${C.dim}${Math.round((n / planned) * 100)}%${C.reset}\r`);
        } catch (_) { /* progress UI must never fail a successful step */ }
        return result;
      } catch (e) {
        if (timer) clearInterval(timer);
        const line = `  ${C.red}✗${C.reset} ${C.dim}[${n}/${planned}]${C.reset} ${label} ${C.red}${e.message}${C.reset}`;
        process.stdout.write(TTY ? `\r\x1b[2K${line}\n` : `${line}\n`);
        throw e;
      }
    },
    done() { if (TTY) process.stdout.write('\r\x1b[2K'); },
  };
}

function banner(reqId, phone) {
  console.log('');
  console.log(`${C.blue}${C.bold}┌─ 📥 webhook #${reqId} ${C.reset}${C.gray}· ${now()} · phone=${C.reset}${C.bold}${phone}${C.reset}`);
}
function sub(msg) { console.log(`  ${C.gray}·${C.reset} ${C.dim}${msg}${C.reset}`); }

async function getDb() {
  if (_db) return _db;
  _client = new MongoClient(process.env.MONGODB_URI);
  await _client.connect();
  _db = _client.db(process.env.MONGODB_DB);
  await _db.collection(TARGET_COLLECTION).createIndex({ phone: 1 }, { unique: true });
  return _db;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function normPhone10(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/[^0-9]/g, '');
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  return s;
}

function toEpoch(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}
const toMs = toEpoch;

function toIso(v) {
  const ms = toEpoch(v);
  return ms == null ? null : new Date(ms).toISOString();
}

const BSON_DATE_FIELDS = [
  'created_at',
  'modified_at',
  'last_synced_at',
  'calculated_at',
  'dash_dob',
  'telecrm_first_interaction_date',
  'telecrm_last_contacted_date',
];

function toBsonDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const ms = toEpoch(value);
  return ms == null ? null : new Date(ms);
}

function withBsonDates(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const out = { ...doc };
  for (const key of BSON_DATE_FIELDS) {
    if (out[key] == null || out[key] === '') continue;
    const date = toBsonDate(out[key]);
    if (date) out[key] = date;
  }
  for (const key of ['source', 'stage']) {
    if (!Array.isArray(out[key])) continue;
    out[key] = out[key].map((entry) => {
      if (!entry || typeof entry !== 'object' || entry.occurred_at == null || entry.occurred_at === '') return entry;
      const date = toBsonDate(entry.occurred_at);
      return date ? { ...entry, occurred_at: date } : entry;
    });
  }
  return out;
}

// Newest dated event first. Rows without occurred_at stay after dated rows so
// unknown time never masquerades as "latest". Equal/missing times keep later
// insertion first.
function compareHistoryNewestFirst(left, right) {
  const leftMs = toMs(left.entry.occurred_at);
  const rightMs = toMs(right.entry.occurred_at);
  if (leftMs != null && rightMs != null && leftMs !== rightMs) return rightMs - leftMs;
  if (leftMs != null && rightMs == null) return -1;
  if (leftMs == null && rightMs != null) return 1;
  return right.sequence - left.sequence;
}

// Earliest dated source first. Rows without occurred_at stay after dated rows
// so an unknown time never becomes the earliest source. Equal times keep
// earlier insertion first.
function compareHistoryOldestFirst(left, right) {
  const leftMs = toMs(left.entry.occurred_at);
  const rightMs = toMs(right.entry.occurred_at);
  if (leftMs != null && rightMs != null && leftMs !== rightMs) return leftMs - rightMs;
  if (leftMs != null && rightMs == null) return -1;
  if (leftMs == null && rightMs != null) return 1;
  return left.sequence - right.sequence;
}

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v;
  return undefined;
}

function isBlankVal(v) {
  if (v == null) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  return false;
}

function compactObj(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isBlankVal(v)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      const nested = compactObj(v);
      if (nested && Object.keys(nested).length) out[k] = nested;
    } else {
      out[k] = v;
    }
  }
  return out;
}

const REQUIRED_JOIN_KEYS = new Set([
  'phone', 'conversionStatus', 'source', 'stage',
  'created_on_epoch', 'created_at', 'modified_at', 'last_synced_at',
]);

function omitEmpty(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'temperature_derived' && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = v;
      continue;
    }
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      if (REQUIRED_JOIN_KEYS.has(k)) out[k] = v;
      continue;
    }
    if (Array.isArray(v)) {
      if (!v.length && !REQUIRED_JOIN_KEYS.has(k)) continue;
      out[k] = v;
      continue;
    }
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const nested = compactObj(v);
      if (nested && Object.keys(nested).length) out[k] = nested;
      else if (REQUIRED_JOIN_KEYS.has(k)) out[k] = nested;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function tidyNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// TeleCRM system activity metrics live on lead/search, not the Mongo telecrm mirror.
// They may sit on the lead root or inside fields, and UI labels sometimes include a "# " prefix.
const CALL_COUNT_KEYS = [
  'Calls Count', '# Calls Count', '#ofCalls', 'calls_count', 'callsCount', 'telecrm_#ofCalls',
];
const MESSAGE_COUNT_KEYS = [
  'Messages sent lead', '# Messages sent lead', 'Messages Count', '# Messages Count',
  '#ofmessages', 'messages_count', 'messagesCount', 'Messages sent', 'telecrm_#ofmessages',
];
const CONNECTED_CALL_KEYS = [
  'Count of Connected Calls', 'Connected Call Count', '# Connected Call Count',
  'connected_call_count', 'connectedCallCount',
];

function unwrapActivityValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.value !== undefined && value.value !== null && value.value !== '') return value.value;
    if (value.count !== undefined && value.count !== null && value.count !== '') return value.count;
  }
  return value;
}

function pickActivityCount(lead, previous, keys) {
  const nested = lead && lead.fields && typeof lead.fields === 'object' && !Array.isArray(lead.fields)
    ? lead.fields
    : {};
  const root = lead && typeof lead === 'object' && !Array.isArray(lead) ? lead : {};
  const live = [];
  for (const key of keys) {
    live.push(unwrapActivityValue(root[key]));
    live.push(unwrapActivityValue(nested[key]));
  }
  const n = tidyNumber(firstDefined(...live));
  if (n !== undefined) return n;
  const prev = tidyNumber(unwrapActivityValue(previous));
  if (prev !== undefined && prev > 0) return prev;
  return undefined;
}

function tidyBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1' || String(value).trim().toLowerCase() === 'true') return true;
  if (value === 0 || value === '0' || String(value).trim().toLowerCase() === 'false') return false;
  return undefined;
}

function firstCallDoneValue(f, prev) {
  const bool = tidyBoolean(firstDefined(
    f.first_call_done, f['First Call Done'], f.telecrm_first_call_done, prev.telecrm_first_call_done
  ));
  if (bool === true || bool === false) return bool;
  return toIso(firstDefined(f['First Call Attempt'], f['First Call Attempt Date'], f.first_call_attempt))
    ? true
    : undefined;
}

// Unified stage timeline, same shape as source[]: each entry is
// { platform: 'telecrm' | 'dash', status, dateISO }. Append-on-change per
// platform so a re-sync only adds an entry when that platform's status changes.
function mergeStage(arr, entry) {
  if (!entry || !entry.status) return arr;
  const out = Array.isArray(arr) ? [...arr] : [];
  let lastSame = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].platform === entry.platform) { lastSame = out[i]; break; }
  }
  if (!lastSame || lastSame.status !== entry.status) out.push(entry);
  return out;
}

async function fetchTeleCRMLead(phone10) {
  const searchPhone = '91' + phone10;
  const resp = await fetch(TELECRM_SEARCH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TELECRM_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { phone: searchPhone } }),
  });
  if (!resp.ok) {
    let code = String(resp.status);
    try {
      const body = await resp.json();
      if (body && body.error && body.error.code) code = String(body.error.code);
    } catch (_) { /* ignore non-JSON error bodies */ }
    if (resp.status === 401) {
      throw new Error(
        `TeleCRM search failed: 401 ${code} (lead/search needs a Sync-typed token in TELECRM_API_TOKEN / TELECRM_SYNC_API2)`,
      );
    }
    throw new Error(`TeleCRM search failed: ${resp.status} ${code}`);
  }
  const json = await resp.json();
  const lead = (json.data || [])[0];
  if (!lead) throw new Error(`Lead not found in TeleCRM for phone=${searchPhone}`);
  return lead;
}

const VALID_LEAD_SOURCES = new Set([
  'Manual', 'Excel', 'IVR', 'Call Logs', 'Website', 'Facebook',
  'Whatsapp Cloud API', 'GOOGLE_SHEETS', 'Whatsapp', 'Webhook',
]);

// Map the lead → a source category, following the proven n8n precedence.
function mapSourceCategory(f) {
  const rawLeadSource = String(f.lead_source || '').trim();
  const hasCTWA = !!f.ctwa_id || rawLeadSource === 'Whatsapp Cloud API';
  const hasFBLeadId = !!(f.external_lead_id || f.facebook_lead_id);
  const hasCampaign = !!(f.campaign_name || f.facebook_campaign);
  const hasDashboard = !!f.dashboard_field;

  let category;
  if (f.source && KNOWN_SOURCES.has(f.source)) category = f.source;
  else if (hasCTWA) category = 'CTWA';
  else if (rawLeadSource === 'Facebook' || (hasFBLeadId && hasCampaign)) category = 'Meta Lead Form';
  else if (rawLeadSource === 'Website' || hasDashboard) category = 'Website';
  else category = 'Organic';

  // Determine the standardized lead source from the user's allowed list
  let leadSource = f.lead_source;
  if (hasCTWA) leadSource = 'Whatsapp Cloud API';
  else if (!leadSource || !VALID_LEAD_SOURCES.has(leadSource)) {
    if (rawLeadSource === 'Facebook' || hasFBLeadId) leadSource = 'Facebook';
    else if (rawLeadSource === 'Website' || hasDashboard) leadSource = 'Website';
    else if (VALID_LEAD_SOURCES.has(rawLeadSource)) leadSource = rawLeadSource;
    else leadSource = 'Manual';
  }

  const needsPush = !(f.source && KNOWN_SOURCES.has(f.source));
  return { category, label: SOURCE_LABEL_MAP[category] || category, needsPush, leadSource };
}

function tidyScalar(value) {
  if (canonicalBlank(value)) return null;
  return String(value).trim();
}

function normalizeTemperatureDerived(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const numOrZero = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const dayOrNull = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const captured = raw.d_captured !== undefined && raw.d_captured !== null && raw.d_captured !== ''
    ? raw.d_captured
    : raw.d_status;
  return {
    attempts: numOrZero(raw.attempts),
    connected: numOrZero(raw.connected),
    d_captured: dayOrNull(captured),
    d_inbound: dayOrNull(raw.d_inbound),
    d_call: dayOrNull(raw.d_call),
  };
}

function buildTeleCRMPart(lead, existing) {
  const f = (lead && (lead.fields || lead)) || {};
  const prev = existing && typeof existing === 'object' ? existing : {};
  const status = firstDefined(lead && lead.status, f.status, prev.conversionStatus) || 'Fresh';
  const mapped = mapSourceCategory(f);
  return {
    name: tidyScalar(f.name) || prev.name || null,
    conversionStatus: status,
    telecrm_form_branch: tidyScalar(f.branch),
    telecrm_form_city: tidyScalar(f.city),
    telecrm_form_postcode: tidyScalar(firstDefined(f.post_code, f.postcode, f.pincode)),
    telecrm_form_health_concern: firstDefined(f.health_concern, prev.telecrm_form_health_concern) ?? null,
    'telecrm_#ofCalls': pickActivityCount(lead, prev['telecrm_#ofCalls'], CALL_COUNT_KEYS),
    'telecrm_#ofmessages': pickActivityCount(lead, prev['telecrm_#ofmessages'], MESSAGE_COUNT_KEYS),
    telecrm_connected_calls: pickActivityCount(lead, prev.telecrm_connected_calls, CONNECTED_CALL_KEYS),
    telecrm_first_interaction_date: toIso(firstDefined(
      f.first_interaction_date, f['Captured On'], f.telecrm_first_interaction_date, prev.telecrm_first_interaction_date
    )),
    telecrm_first_call_done: firstCallDoneValue(f, prev),
    telecrm_last_contacted_date: toIso(firstDefined(
      f.last_contacted_date, f['Last Call'], f['Last Activity On'],
      f['Last Incoming Activity On'], f['Last Incoming whatsapp message date'],
      f.telecrm_last_contacted_date, prev.telecrm_last_contacted_date
    )),
    telecrm_drop_off_reason: tidyScalar(firstDefined(
      f.drop_off_reason, f['drop-off_reason_1'], prev.telecrm_drop_off_reason
    )),
    telecrm_capture_frequency: tidyNumber(firstDefined(
      f.capture_frequency, f['Capture Frequency'], f['# Capture Frequency'], prev.telecrm_capture_frequency
    )),
    created_on: firstDefined(
      f.created_on, f.created_at, lead && lead.createdAt, prev.created_on_epoch, prev.created_on
    ),
    modified_at: firstDefined(f.modified_on, f.modified_at, lead && lead.modifiedAt, prev.modified_at),
    _sourceCategory: mapped.category,
    _leadSource: mapped.leadSource,
    _telecrmStatus: status,
  };
}


function canonicalBlank(value) {
  if (value == null) return true;
  const normalized = String(value).trim().toLowerCase();
  return !normalized || ['(absent)', '(none)', 'null', 'undefined', '(not set)'].includes(normalized);
}

function canonicalNorm(value) {
  return canonicalBlank(value) ? '' : String(value).trim().toLowerCase();
}

function canonicalPut(target, key, value) {
  if (!canonicalBlank(value)) target[key] = String(value).trim();
}

function leadSourceString(doc) {
  if (typeof doc.lead_source === 'string' && !canonicalBlank(doc.lead_source)) return String(doc.lead_source).trim();
  if (typeof doc.lead_source_str === 'string' && !canonicalBlank(doc.lead_source_str)) return String(doc.lead_source_str).trim();
  const leadSources = Array.isArray(doc.lead_source) ? doc.lead_source : [];
  for (let i = leadSources.length - 1; i >= 0; i--) {
    const entry = leadSources[i];
    if (typeof entry === 'string' && !canonicalBlank(entry)) return String(entry).trim();
    if (entry && !canonicalBlank(entry.source)) return String(entry.source).trim();
  }
  return '';
}
function teleSourceValue(doc) {
  if (!canonicalBlank(doc.tele_source_value)) return String(doc.tele_source_value).trim();
  const values = Array.isArray(doc.source) ? doc.source : [];
  for (let i = values.length - 1; i >= 0; i--) {
    const entry = values[i];
    const value = entry && typeof entry === 'object' ? firstDefined(entry.value, entry.tele_source) : entry;
    if (!canonicalBlank(value)) return String(value).trim();
  }
  return '';
}
function referrerHost(ref) {
  if (canonicalBlank(ref)) return '';
  const value = String(ref).trim();
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    return String(parsed.hostname || '').toLowerCase();
  } catch (_) {
    return value.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  }
}
function sourceLabel(doc) {
  const bucket = canonicalNorm(teleSourceValue(doc));
  const lead = canonicalNorm(leadSourceString(doc));
  const rawSource = typeof doc.source === 'string' ? canonicalNorm(doc.source) : '';
  const src = canonicalNorm(doc.utm_source);
  const med = canonicalNorm(doc.utm_medium);
  const host = referrerHost(doc.referrer);
  const labels = {
    performance: 'Performance', customer: 'Customer', organic: 'Organic',
    clinician: 'Clinician', doctor: 'Doctor', advocate: 'Advocate', founder: 'Founder',
  };
  if (labels[bucket]) return labels[bucket];
  if (bucket === 'ctwa' || rawSource === 'ctwa') return 'meta_ctwa';
  if (lead === 'whatsapp cloud api' || lead === 'whatsapp' || rawSource === 'whatsapp cloud api' || rawSource === 'whatsapp') return 'Whatsapp Cloud API';
  if (bucket === 'meta lead form' || lead === 'facebook' || rawSource === 'facebook' || rawSource === 'meta lead form' || rawSource === 'meta_form') return 'meta_form';
  if (lead === 'excel' || lead === 'manual' || lead === 'call logs' || lead === 'ivr' || lead === 'google_sheets') return 'Manual';
  if (!canonicalBlank(doc.gclid) || (src === 'google' && med === 'cpc')) return 'google_cpc';
  if (src === 'gmb') return 'google_gmb';
  if (src.includes('interakt')) return 'interakt';
  if (med === 'wa' || med === 'tele_waca' || src === 'telecrm' || src === 'tele_waca') return 'Tele_WACA';
  if (src.includes('chatgpt') || host.includes('chatgpt')) return 'chatgpt';
  if (src === 'website') return 'website';
  if (['ig', 'insta', 'instagram'].includes(src)) {
    if (!med) return 'instagram_organic';
    return med === 'paid_social' ? 'instagram_paid' : 'instagram_other';
  }
  if (src === 'meta' || src === 'facebook') return med === 'paid_social' ? 'meta_paid' : 'meta_other';
  if (src === 'google' && !med) return host.includes('doubleclick') ? 'google_cpc' : 'google_organic';
  if (!src && host.includes('google')) return 'google_organic';
  if (!src && host.includes('instagram')) return 'instagram_organic';
  if (!src && host.includes('facebook')) return 'meta_other';
  if (lead === 'website' || bucket === 'website') return 'website';
  return 'others';
}
const SOURCE_EVENT_KEYS = [
  'source', 'origin', 'occurred_at', 'tele_leadsource', 'tele_source',
  'utm_source', 'utm_medium', 'utm_campaign',
  'campaign_id', 'campaign_name', 'lead_id',
  'ad_id', 'ad_name', 'ad_set_id', 'ad_set_name',
  'ctwa_id', 'ctwa_source',
];
function sourceEvent(raw, defaults = {}) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const doc = { ...defaults, ...input };
  const entry = { source: sourceLabel(doc) };
  canonicalPut(entry, 'origin', firstDefined(doc.origin, doc.platform));
  const sourceOccurredIso = toIso(firstDefined(
    doc.occurred_at, doc.dateISO, doc.date, doc.ts, doc.timestamp,
    doc.created_at, doc.createdAt, doc.created_on, doc.created_on_epoch, doc.first_seen_at
  ));
  if (sourceOccurredIso) entry.occurred_at = sourceOccurredIso;
  canonicalPut(entry, 'tele_leadsource', firstDefined(doc.tele_leadsource, leadSourceString(doc)));
  canonicalPut(entry, 'tele_source', firstDefined(doc.tele_source, doc.tele_source_value, doc.value));
  canonicalPut(entry, 'utm_source', firstDefined(doc.utm_source, doc.utmSource));
  canonicalPut(entry, 'utm_medium', firstDefined(doc.utm_medium, doc.utmMedium));
  canonicalPut(entry, 'utm_campaign', firstDefined(doc.utm_campaign, doc.utmCampaign));
  canonicalPut(entry, 'campaign_id', firstDefined(doc.campaign_id, doc.facebook_campaign_id, doc.telecrm_campaign_id));
  canonicalPut(entry, 'campaign_name', firstDefined(doc.campaign_name, doc.facebook_campaign, doc.telecrm_campaign, doc.campaign));
  canonicalPut(entry, 'lead_id', firstDefined(doc.lead_id, doc.external_lead_id, doc.facebook_lead_id));
  canonicalPut(entry, 'ad_id', firstDefined(doc.ad_id, doc.facebook_ad_id, doc.telecrm_ad_id));
  canonicalPut(entry, 'ad_name', firstDefined(doc.ad_name, doc.facebook_ad, doc.telecrm_ad, doc.ad, doc.content));
  canonicalPut(entry, 'ad_set_id', firstDefined(doc.ad_set_id, doc.facebook_ad_set_id, doc.telecrm_ad_set_id));
  canonicalPut(entry, 'ad_set_name', firstDefined(doc.ad_set_name, doc.facebook_ad_set_name, doc.telecrm_ad_set_name));
  canonicalPut(entry, 'ctwa_id', doc.ctwa_id);
  canonicalPut(entry, 'ctwa_source', firstDefined(doc.ctwa_source, doc.ctwa_source_id));
  return entry;
}
function cleanSourceArray(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => {
      const normalized = sourceEvent(entry, {
        origin: entry.origin || (entry.platform ? 'legacy_' + entry.platform : 'legacy'),
        tele_source_value: entry.tele_source || entry.value,
      });
      if (!canonicalBlank(entry.source) && !Object.prototype.hasOwnProperty.call(entry, 'value')) {
        normalized.source = String(entry.source).trim();
      }
      return normalized;
    })
    .filter((entry) => !canonicalBlank(entry.source));
}
function sourceHistory(existing) {
  const current = cleanSourceArray(existing && existing.source);
  const legacy = cleanSourceArray(existing && existing.final_source);
  return current.length ? current : legacy;
}
function attributionFingerprint(entry) {
  const identityKeys = SOURCE_EVENT_KEYS.filter((key) => key !== 'origin');
  return JSON.stringify(identityKeys.map((key) => [key, canonicalNorm(entry[key])]).filter((pair) => pair[1]));
}
function attributionSignal(doc) {
  return [
    doc.utm_source, doc.utmSource, doc.utm_medium, doc.utmMedium,
    doc.utm_campaign, doc.utmCampaign, doc.referrer, doc.gclid,
    doc.campaign_id, doc.campaign_name, doc.campaign,
  ].some((value) => !canonicalBlank(value));
}
function pickMarketingFields(doc) {
  const out = {};
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return out;
  canonicalPut(out, 'campaign_id', firstDefined(doc.campaign_id, doc.facebook_campaign_id, doc.telecrm_campaign_id));
  canonicalPut(out, 'campaign_name', firstDefined(doc.campaign_name, doc.facebook_campaign, doc.telecrm_campaign, doc.campaign));
  canonicalPut(out, 'lead_id', firstDefined(doc.lead_id, doc.external_lead_id, doc.facebook_lead_id));
  canonicalPut(out, 'ad_id', firstDefined(doc.ad_id, doc.facebook_ad_id, doc.telecrm_ad_id));
  canonicalPut(out, 'ad_name', firstDefined(doc.ad_name, doc.facebook_ad, doc.telecrm_ad, doc.ad, doc.content));
  canonicalPut(out, 'ad_set_id', firstDefined(doc.ad_set_id, doc.facebook_ad_set_id, doc.telecrm_ad_set_id));
  canonicalPut(out, 'ad_set_name', firstDefined(doc.ad_set_name, doc.facebook_ad_set_name, doc.telecrm_ad_set_name));
  canonicalPut(out, 'ctwa_id', doc.ctwa_id);
  canonicalPut(out, 'ctwa_source', firstDefined(doc.ctwa_source, doc.ctwa_source_id));
  return out;
}
function isTelecrmOrigin(entry) {
  const origin = canonicalNorm(entry && entry.origin);
  return origin === 'telecrm'
    || origin === 'telecrm_lead_source'
    || origin === 'telecrm_source'
    || origin === 'legacy_telecrm'
    || origin === 'legacy';
}
function attributionIdsConflict(left, right) {
  const keys = ['lead_id', 'campaign_id', 'campaign_name', 'ad_id', 'ad_set_id'];
  for (const key of keys) {
    const a = canonicalNorm(left && left[key]);
    const b = canonicalNorm(right && right[key]);
    if (a && b && a !== b) return true;
  }
  return false;
}
function sameTelecrmAttribution(left, right) {
  if (!isTelecrmOrigin(left) || !isTelecrmOrigin(right)) return false;
  if (canonicalBlank(left && left.source) || canonicalNorm(left.source) !== canonicalNorm(right && right.source)) return false;
  if (attributionIdsConflict(left, right)) return false;
  const leftMs = toMs(left && left.occurred_at);
  const rightMs = toMs(right && right.occurred_at);
  if (leftMs != null && rightMs != null && leftMs !== rightMs) {
    const pair = [canonicalNorm(left.origin), canonicalNorm(right.origin)].sort().join('|');
    return pair === 'telecrm_lead_source|telecrm_source'
      || pair === 'telecrm|telecrm_lead_source'
      || pair === 'telecrm|telecrm_source';
  }
  return true;
}
function preferSourceOrigin(left, right) {
  const rank = { telecrm_lead_source: 3, telecrm: 2, telecrm_source: 1 };
  const leftRank = rank[left] || 0;
  const rightRank = rank[right] || 0;
  if (rightRank > leftRank) return right;
  return left || right;
}
function mergeSourceEntries(left, right) {
  const leftMs = toMs(left && left.occurred_at);
  const rightMs = toMs(right && right.occurred_at);
  let earliest = left && left.occurred_at;
  if (leftMs == null) earliest = right && right.occurred_at;
  else if (rightMs != null && rightMs < leftMs) earliest = right.occurred_at;
  const merged = { source: (left && left.source) || (right && right.source) };
  canonicalPut(merged, 'origin', preferSourceOrigin(left && left.origin, right && right.origin));
  const earliestIso = toIso(earliest);
  if (earliestIso) merged.occurred_at = earliestIso;
  for (const key of SOURCE_EVENT_KEYS) {
    if (key === 'source' || key === 'origin' || key === 'occurred_at') continue;
    canonicalPut(merged, key, firstDefined(left && left[key], right && right[key]));
  }
  return merged;
}
function coalesceTelecrmSourceEvents(entries) {
  const output = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const index = output.findIndex((existing) => sameTelecrmAttribution(existing, entry));
    if (index >= 0) output[index] = mergeSourceEntries(output[index], entry);
    else output.push(entry);
  }
  return output;
}
function facebookIntakeOccurredAt(telecrm) {
  if (!telecrm || canonicalNorm(leadSourceString(telecrm)) !== 'facebook') return null;
  const leadRows = Array.isArray(telecrm.lead_source) ? telecrm.lead_source : [];
  for (const row of leadRows) {
    if (!row || typeof row === 'string') continue;
    if (canonicalNorm(row.source) !== 'facebook') continue;
    const iso = toIso(firstDefined(row.occurred_at, row.dateISO, row.date));
    if (iso) return iso;
  }
  const created = toIso(firstDefined(telecrm.created_at, telecrm.createdAt, telecrm.created_on));
  if (created) return created;
  const stages = historyArray(telecrm.stage);
  let earliest = null;
  let earliestMs = null;
  for (const row of stages) {
    const iso = toIso(firstDefined(row && row.occurred_at, row && row.dateISO, row && row.date));
    const ms = toMs(iso);
    if (ms == null) continue;
    if (earliestMs == null || ms < earliestMs) {
      earliestMs = ms;
      earliest = iso;
    }
  }
  return earliest;
}
function isFacebookSourceRow(raw, lead) {
  const bucket = canonicalNorm(firstDefined(raw && raw.value, raw && raw.tele_source, raw && raw.source));
  return bucket === 'facebook'
    || bucket === 'meta lead form'
    || bucket === 'meta_form';
}
function historyArray(value) {
  if (Array.isArray(value)) return value.filter((row) => row != null && row !== '');
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => /^\d+$/.test(key)).sort((a, b) => Number(a) - Number(b));
    if (keys.length) return keys.map((key) => value[key]);
  }
  if (value == null || value === '') return [];
  return [value];
}
function categoryCaptureLabel(category, analytics) {
  const mapped = {
    organic: 'dash_organic',
    advocate: 'dash_advocate',
    advertisement: 'dash_performance',
    referral: 'dash_customer',
    website: 'website',
    doctor: 'dash_consultant',
  };
  const label = mapped[canonicalNorm(category)] || null;
  if (label !== 'website') return label;
  const doc = analytics && typeof analytics === 'object' && !Array.isArray(analytics) ? analytics : null;
  const utmSource = doc ? canonicalNorm(firstDefined(doc.utm_source, doc.utmSource, doc.first_utm_source, doc.last_utm_source)) : '';
  return utmSource ? 'website' : 'website_organic';
}
function knownCaptureLabel(doc) {
  const rawSource = typeof doc.source === 'string' ? canonicalNorm(doc.source) : '';
  const value = canonicalNorm(firstDefined(
    leadSourceString(doc), rawSource, doc.value, doc.tele_source, teleSourceValue(doc)
  ));
  if (!value) return null;
  if (value === 'ctwa' || value === 'whatsapp cloud api' || value === 'whatsapp') return 'meta_ctwa';
  if (value === 'facebook' || value === 'meta lead form' || value === 'meta_form') return 'meta_form';
  if (['excel', 'manual', 'call logs', 'ivr', 'google_sheets'].includes(value)) return 'Manual';
  if (value === 'website' || value === 'wesbite') return 'website';
  return null;
}
function publishCapture(entry) {
  if (!entry || canonicalBlank(entry.source) || canonicalNorm(entry.source) === 'lead_recapture') return null;
  const published = {};
  for (const key of Object.keys(entry)) {
    if (key === 'origin' || key === 'tele_source' || key === 'tele_leadsource') continue;
    published[key] = entry[key];
  }
  return published;
}
// Oldest capture first. source[0] is the earliest source.
// A dashboard category is one event. Each TeleCRM capture with its own time is kept.
// Page hits are used only when there is no category and no TeleCRM capture.
// lead_recapture is never stored.
function fifoSourceHistory(entries) {
  const kept = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || canonicalBlank(entry.source)) continue;
    const label = canonicalNorm(entry.source);
    if (!label || label === 'others' || label === 'lead_recapture') continue;
    const key = label + '|' + String(toMs(entry.occurred_at) || '');
    const index = kept.findIndex((prev) => (
      canonicalNorm(prev.source) + '|' + String(toMs(prev.occurred_at) || '') === key
    ));
    if (index >= 0) kept[index] = mergeSourceEntries(kept[index], entry);
    else kept.push(entry);
  }
  return kept
    .map((entry, sequence) => ({ entry, sequence }))
    .sort(compareHistoryOldestFirst)
    .map((item) => item.entry);
}
function buildSourceHistory(existing, telecrm, touchpoints = [], visitor = null, user = null) {
  const events = [];
  const categoryLabel = categoryCaptureLabel(user && user.category, visitor);
  if (categoryLabel) {
    const entry = { source: categoryLabel };
    const occurredIso = toIso(user && firstDefined(user.createdAt, user.updatedAt));
    if (occurredIso) entry.occurred_at = occurredIso;
    events.push(entry);
  }

  const leadRows = Array.isArray(telecrm && telecrm.lead_source)
    ? telecrm.lead_source
    : (!canonicalBlank(telecrm && telecrm.lead_source) ? [telecrm.lead_source] : []);
  const sourceRows = historyArray(telecrm && telecrm.source);
  const marketing = pickMarketingFields(telecrm || {});
  const intakeAt = facebookIntakeOccurredAt(telecrm || {});
  const captured = [];
  function consider(raw, defaults) {
    const event = sourceEvent(raw, defaults);
    const label = knownCaptureLabel(raw) || knownCaptureLabel({ ...defaults, ...raw });
    if (label) event.source = label;
    if (canonicalBlank(event.source) || canonicalNorm(event.source) === 'others' || canonicalNorm(event.source) === 'lead_recapture') return;
    captured.push(event);
  }
  leadRows.forEach((row, index) => {
    const raw = row && typeof row === 'object' ? row : { source: row };
    const defaults = {
      origin: 'telecrm_lead_source',
      lead_source: raw.source,
      created_at: telecrm && telecrm.created_at,
      created_on: telecrm && telecrm.created_on,
      createdAt: telecrm && telecrm.createdAt,
    };
    if (index === leadRows.length - 1) Object.assign(defaults, marketing, { lead_source: raw.source });
    if (canonicalNorm(raw.source) === 'facebook' && intakeAt) defaults.occurred_at = intakeAt;
    consider(raw, defaults);
  });
  sourceRows.forEach((row, index) => {
    const raw = row && typeof row === 'object' ? row : { value: row };
    const defaults = {
      origin: 'telecrm_source',
      tele_leadsource: leadSourceString(telecrm || {}),
      tele_source_value: firstDefined(raw.value, raw.tele_source, typeof raw.source === 'string' ? raw.source : null),
    };
    if (index === sourceRows.length - 1) Object.assign(defaults, marketing);
    consider(raw, defaults);
  });
  for (const entry of coalesceTelecrmSourceEvents(captured)) {
    const published = publishCapture(entry);
    if (published) events.push(published);
  }

  if (!events.length) {
    const webRows = (Array.isArray(touchpoints) ? touchpoints : [])
      .filter((row) => row && typeof row === 'object' && attributionSignal(row));
    for (const row of webRows) {
      const published = publishCapture(sourceEvent(row, { origin: 'web_touchpoint' }));
      if (published) events.push(published);
    }
    if (!events.length && visitor && attributionSignal(visitor)) {
      const published = publishCapture(sourceEvent({
        ...visitor,
        utm_source: firstDefined(visitor.first_utm_source, visitor.last_utm_source, visitor.utm_source),
        utm_medium: firstDefined(visitor.first_utm_medium, visitor.last_utm_medium, visitor.utm_medium),
        utm_campaign: firstDefined(visitor.first_utm_campaign, visitor.last_utm_campaign, visitor.utm_campaign),
        referrer: firstDefined(visitor.first_referrer, visitor.last_referrer, visitor.referrer),
        occurred_at: firstDefined(visitor.first_seen_at, visitor.createdAt),
      }, { origin: 'web_visitor' }));
      if (published) events.push(published);
    }
  }
  return fifoSourceHistory(events);
}
function sameSourceArray(left, right) {
  return JSON.stringify(Array.isArray(left) ? left : []) === JSON.stringify(Array.isArray(right) ? right : []);
}
function stageEntry(platform, status, occurredAt) {
  if (canonicalBlank(platform) || canonicalBlank(status)) return null;
  const entry = { platform: String(platform).trim(), status: String(status).trim() };
  const occurredIso = toIso(occurredAt);
  if (occurredIso) entry.occurred_at = occurredIso;
  return entry;
}
function cleanStage(raw) {
  return historyArray(raw).map((entry) => {
    if (typeof entry === 'string') return stageEntry('telecrm', entry, null);
    return stageEntry(
      (entry && entry.platform) || 'telecrm',
      entry && firstDefined(entry.status, entry.value, entry.stage),
      entry && firstDefined(entry.occurred_at, entry.dateISO, entry.date, entry.ts, entry.updatedAt, entry.createdAt)
    );
  }).filter(Boolean);
}
function buildStageHistory(existing, telecrmRows, currentTelecrmStatus, dashStatus, dashOccurredAt, nowIso) {
  const existingRows = cleanStage(existing && existing.stage);
  const upstream = historyArray(telecrmRows);
  const seen = new Set();
  const output = [];
  let sequence = 0;
  function add(entry) {
    if (!entry) return;
    const statusKey = [canonicalNorm(entry.platform), canonicalNorm(entry.status)].join('|');
    const timeKey = entry.occurred_at ? String(toMs(entry.occurred_at)) : '';
    const exactKey = statusKey + '|' + timeKey;
    if (seen.has(exactKey)) return;
    if (timeKey) {
      const datelessIndex = output.findIndex((item) => (
        canonicalNorm(item.entry.platform) === canonicalNorm(entry.platform)
        && canonicalNorm(item.entry.status) === canonicalNorm(entry.status)
        && !item.entry.occurred_at
      ));
      if (datelessIndex >= 0) {
        output[datelessIndex].entry.occurred_at = entry.occurred_at;
        seen.delete(statusKey + '|');
        seen.add(exactKey);
        return;
      }
    } else if (output.some((item) => (
      canonicalNorm(item.entry.platform) === canonicalNorm(entry.platform)
      && canonicalNorm(item.entry.status) === canonicalNorm(entry.status)
    ))) {
      return;
    }
    seen.add(exactKey);
    output.push({ entry, sequence: sequence++ });
  }
  for (const entry of existingRows) add(entry);
  const hasDashRow = existingRows.some((entry) => canonicalNorm(entry.platform) === 'dash');
  if (!hasDashRow && existing && !canonicalBlank(existing.dash_status)) {
    add(stageEntry(
      'dash',
      existing.dash_status,
      firstDefined(existing.modified_at, existing.updated_at, existing.updatedAt)
    ));
  }
  for (const row of upstream) {
    if (typeof row === 'string') add(stageEntry('telecrm', row, null));
    else if (row && typeof row === 'object') {
      add(stageEntry(
        'telecrm',
        firstDefined(row.status, row.value, row.stage),
        firstDefined(row.occurred_at, row.dateISO, row.date, row.ts, row.updatedAt, row.createdAt)
      ));
    }
  }
  const latestFor = (platform) => {
    let best = null;
    for (let i = 0; i < output.length; i++) {
      const item = output[i];
      if (canonicalNorm(item.entry.platform) !== canonicalNorm(platform)) continue;
      if (!best) {
        best = item;
        continue;
      }
      const ms = toMs(item.entry.occurred_at);
      const bestMs = toMs(best.entry.occurred_at);
      if (ms != null && (bestMs == null || ms > bestMs)) best = item;
      else if ((ms == null && bestMs == null) || (ms != null && bestMs != null && ms === bestMs)) {
        if (item.sequence > best.sequence) best = item;
      }
    }
    return best ? best.entry : null;
  };
  function uniqueDashOccurredAt(latestDash, status, preferred) {
    const preferredMs = toMs(preferred);
    const latestMs = toMs(latestDash && latestDash.occurred_at);
    let iso = null;
    if (preferredMs != null && (latestMs == null || preferredMs > latestMs)) {
      iso = toIso(preferred);
    }
    if (!iso) iso = toIso(nowIso) || new Date().toISOString();
    const statusKey = ['dash', canonicalNorm(status)].join('|');
    while (seen.has(statusKey + '|' + String(toMs(iso) || ''))) {
      const ms = toMs(iso);
      iso = new Date((ms == null ? Date.now() : ms) + 1).toISOString();
    }
    return iso;
  }
  const latestTelecrm = latestFor('telecrm');
  if (!canonicalBlank(currentTelecrmStatus) && (!latestTelecrm || canonicalNorm(latestTelecrm.status) !== canonicalNorm(currentTelecrmStatus))) {
    add(stageEntry('telecrm', currentTelecrmStatus, null));
  }
  const latestDash = latestFor('dash');
  if (!canonicalBlank(dashStatus)) {
    const dashStatusValue = String(dashStatus).trim();
    if (!latestDash || canonicalNorm(latestDash.status) !== canonicalNorm(dashStatusValue)) {
      add(stageEntry('dash', dashStatus, uniqueDashOccurredAt(latestDash, dashStatusValue, dashOccurredAt)));
    } else if (!latestDash.occurred_at && dashOccurredAt) {
      const backfillIso = toIso(dashOccurredAt);
      if (backfillIso) latestDash.occurred_at = backfillIso;
    }
  }
  return output.sort(compareHistoryNewestFirst).map((item) => item.entry);
}
async function getFirstVisitAppointments(db, userId) {
  return db.collection('appointments').aggregate([
    { $match: { visitType: 'FIRST_VISIT', $expr: { $eq: [{ $toString: '$patient' }, String(userId)] } } },
    { $sort: { createdAt: 1 } },
    { $project: {
      _id: 0, visitType: 1, createdAt: 1, updatedAt: 1,
      report: { $ifNull: ['$report', null] }, status: 1,
      cancellationReason: 1, rescheduledFrom: 1, rescheduledTo: 1, cancellationDetails: 1,
    } },
  ]).toArray();
}

function getHost(url) {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.hostname;
  } catch (_) { return null; }
}

function getPath(url) {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    return u.pathname;
  } catch (_) { return url.startsWith('/') ? url : null; }
}

async function joinDashboard(db, phone10) {
  const out = {
    dash_email: null, dash_firstName: null, dash_lastName: null, dash_gender: null,
    dash_dob: null, dash_patientType: null, dash_status: null,
    dash_consultant: null, dash_centers_id: null,
    dash_firstvisitapppointment: null,
  };

  // A phone can have more than one users doc (duplicates). Pull them all, then
  // prefer the user that actually owns a web_visitors record; fall back to the
  // most-recently-updated. This avoids picking a duplicate with no web data.
  const users = await db.collection('users').aggregate([
    { $addFields: { __phoneDigits: { $replaceAll: { input: { $replaceAll: { input: { $replaceAll: { input: { $replaceAll: { input: { $replaceAll: { input: { $toString: { $ifNull: ['$phone', ''] } }, find: ' ', replacement: '' } }, find: '-', replacement: '' } }, find: '+', replacement: '' } }, find: '(', replacement: '' } }, find: ')', replacement: '' } } } },
    { $addFields: { __phone10: {
      $switch: {
        branches: [
          { case: { $and: [{ $eq: [{ $strLenCP: '$__phoneDigits' }, 12] }, { $eq: [{ $substrCP: ['$__phoneDigits', 0, 2] }, '91'] }] }, then: { $substrCP: ['$__phoneDigits', 2, 10] } },
          { case: { $and: [{ $eq: [{ $strLenCP: '$__phoneDigits' }, 11] }, { $eq: [{ $substrCP: ['$__phoneDigits', 0, 1] }, '0'] }] }, then: { $substrCP: ['$__phoneDigits', 1, 10] } },
        ],
        default: '$__phoneDigits',
      },
    } } },
    { $match: { __phone10: phone10 } },
    { $sort: { updatedAt: -1 } },
    { $project: { __phoneDigits: 0, __phone10: 0 } },
  ]).toArray();
  if (!users.length) { out.__matched = { user: false }; return out; }
  const userIds = users.map(u => u._id);
  const wvEarly = await db.collection('web_visitors').findOne({ patient_id: { $in: userIds } });
  const user = (wvEarly && users.find(u => String(u._id) === String(wvEarly.patient_id)))
    || users.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];
  out.__matched = { user: true, userDupes: users.length };

  const pd = user.profileData || {};
  out.dash_patient_id = String(user._id);
  out.dash_email = user.email || null;
  out.dash_firstName = pd.firstName || null;
  out.dash_lastName = pd.lastName || null;
  out.dash_gender = pd.gender || null;
  out.dash_dob = toIso(pd.dob) || (pd.dob ? String(pd.dob).trim() : null);
  out.dash_patientType = pd.patientType || null;
  out.dash_status = pd.status || null;
  out._dashCategory = pd.category || null;
  out._userCreatedAt = user.createdAt || null;
  out._dashStatusOccurredAt = firstDefined(user.updatedAt, user.createdAt) || null;

  // Store source-system IDs exactly as strings; names are not part of the canonical schema.
  if (pd.consultant) out.dash_consultant = String(pd.consultant);
  const centerId = Array.isArray(pd.centers) ? pd.centers[0] : pd.centers;
  if (centerId) out.dash_centers_id = String(centerId);

  // first-visit appointments → conversion signals
  const appts = await getFirstVisitAppointments(db, user._id);
  const converted = appts.some(a => APPT_CONVERTED_STATUSES.has(a.status));
  out.dash_firstvisitapppointment = appts.length ? (converted ? 'visited' : 'not_visited') : null;
  out._appointments = appts;

  out.__matched.appointments = appts.length;
  // web analytics from web_visitors (linked by patient_id = user._id)
  const wv = await db.collection('web_visitors').findOne({ patient_id: user._id });
  out.__matched.webVisitor = !!wv;
  if (wv) {
    // Keep every attributed touchpoint; the earliest row still supplies dashboard fallbacks.
    const touchpoints = await db.collection('web_touchpoints').find({ visitor_id: wv._id }).sort({ ts: 1 }).toArray();
    const firstTP = touchpoints[0] || null;
    out._touchpoints = touchpoints;
    out._webVisitor = wv;

    const utmSource = (firstDefined(firstTP && firstTP.utm_source, wv.first_utm_source, wv.last_utm_source) || '').trim() || null;
    const utmMedium = (firstDefined(firstTP && firstTP.utm_medium, wv.first_utm_medium, wv.last_utm_medium) || '').trim() || null;
    const utmCampaign = (firstDefined(firstTP && firstTP.utm_campaign, wv.first_utm_campaign, wv.last_utm_campaign) || '').trim() || null;
    const utmContent = (firstDefined(firstTP && firstTP.utm_content, wv.last_utm_content) || '').trim() || null;
    const utmAdgroup = (firstDefined(firstTP && firstTP.utm_adgroup, wv.first_utm_adgroup, wv.last_utm_adgroup) || '').trim() || null;
    const utmTerm = (firstDefined(firstTP && firstTP.utm_term, wv.first_utm_term, wv.last_utm_term) || '').trim() || null;

    const referrer = firstDefined(firstTP && firstTP.referrer, wv.first_referrer, wv.last_referrer) || null;
    const landingPage = firstDefined(firstTP && firstTP.landing_page, wv.first_landing_page, wv.last_landing_page) || null;

    // The ENTIRE web-analytics universe lives on the dash source[] entry
    // (same field names as the former dash_webAnalytics object, now inline in
    // source[]). There is deliberately no separate dash_webAnalytics object.
    out._dashEntry = {
      platform: 'dash',
      anonymousId: wv.anonymous_id || (firstTP && firstTP.anonymous_id) || null,
      firstTouchAt: toIso(wv.first_seen_at),
      lastTouchAt: toIso(wv.last_seen_at),
      totalSessions: wv.sessions_count != null ? wv.sessions_count : null,
      totalTouchpoints: wv.pageviews_count != null ? wv.pageviews_count : null,
      bookingUrl: wv.booking_url || null,
      landingPage,
      referrer,
      utmSource,
      utmMedium,
      utmContent,
      utmCampaign,
      utmAdgroup,
      utmTerm,
      utmMatchtype: firstDefined(firstTP && firstTP.utm_matchtype, wv.first_utm_matchtype) || null,
      utmDevice: firstDefined(firstTP && firstTP.utm_device, wv.first_utm_device) || null,
      utmNetwork: firstDefined(firstTP && firstTP.utm_network, wv.first_utm_network) || null,
      placement: firstDefined(firstTP && firstTP.placement, wv.first_placement) || null,
      assetId: firstDefined(firstTP && firstTP.asset_id, wv.last_asset_id) || null,
      referrerHost: firstDefined(firstTP && firstTP.referrer_host, wv.last_referrer_host, getHost(referrer)) || null,
      pagePath: firstDefined(firstTP && firstTP.page_path, wv.last_page_path, getPath(landingPage)) || null,
      referralType: firstDefined(firstTP && firstTP.referral_type, wv.last_referral_type) || null,
      // identifiers (CSV "identifiers" universe)
      gclid: wv.gclid || (firstTP && firstTP.gclid) || null,
      fbclid: wv.fbclid || (firstTP && firstTP.fbclid) || null,
      fbp: wv.fbp || null,
      fbc: wv.fbc || null,
      ga_client_id: wv.ga_client_id || null,
      gcl_au: wv.gcl_au || (firstTP && firstTP.gcl_au) || null,
      gbraid: wv.gbraid || (firstTP && firstTP.gbraid) || null,
      wbraid: wv.wbraid || (firstTP && firstTP.wbraid) || null,
      // last-touch attribution (distinct from first-touch above)
      lastTouch: {
        landingPage: wv.last_landing_page || null,
        referrer: wv.last_referrer || null,
        utmSource: (wv.last_utm_source || '').trim() || null,
        utmMedium: (wv.last_utm_medium || '').trim() || null,
        utmCampaign: (wv.last_utm_campaign || '').trim() || null,
        utmContent: (wv.last_utm_content || '').trim() || null,
        utmTerm: (wv.last_utm_term || '').trim() || null,
        utmAdgroup: (wv.last_utm_adgroup || '').trim() || null,
      },
      // session + web-record context
      sessionId: wv.session_id || null,
      lastSessionId: wv.last_session_id || null,
      webVisitorId: wv._id ? String(wv._id) : null,
      webCenterId: wv.center_id ? String(wv.center_id) : null,
      webOrganizationId: wv.organization_id ? String(wv.organization_id) : null,
      webIsActive: wv.isActive != null ? wv.isActive : null,
      webCreatedAt: wv.createdAt ? toIso(new Date(wv.createdAt).getTime()) : null,
      webUpdatedAt: wv.updatedAt ? toIso(new Date(wv.updatedAt).getTime()) : null,
      dateISO: toIso(wv.first_seen_at) || new Date().toISOString(),
    };
    out._dashEntry = compactObj(out._dashEntry);
  }

  return out;
}

// Optional: push derived source back to TeleCRM (opt-in only).
async function pushSourceToTeleCRM(phone10, source) {
  const resp = await fetch(TELECRM_AUTOUPDATE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TELECRM_ASYNC_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { phone: '91' + phone10, source } }),
  });
  console.log(`[new-telecrm] source push → TeleCRM ${resp.status} (phone=${phone10}, source=${source})`);
}

function canonicalTelecrmStatus(raw) {
  const key = String(raw || '').trim().toLowerCase();
  const map = {
    fresh: 'Fresh',
    'no response': 'No Response',
    'in pipeline': 'In Pipeline',
    'not shown up': 'Not Shown Up',
    'not converted': 'Not Converted',
    'session booked': 'Session booked',
    'session rescheduled': 'In Pipeline',
    converted: 'Converted',
  };
  return map[key] || null;
}

function telecrmStageHistory(stages) {
  const out = [];
  for (const row of Array.isArray(stages) ? stages : []) {
    if (String(row && row.platform ? row.platform : '').toLowerCase() !== 'telecrm') continue;
    const mapped = canonicalTelecrmStatus(row.status);
    if (mapped) out.push(mapped);
  }
  return out;
}

function finalizeTelecrmStatus(input) {
  const doc = input && typeof input === 'object' ? input : {};
  const normalize = (value) => String(value == null ? '' : value).trim().toLowerCase();
  const upper = (value) => String(value == null ? '' : value).trim().toUpperCase();
  const current = firstDefined(doc.currentTelecrmStatus, doc.telecrm_previous_status, doc.conversionStatus);
  const dashStatus = upper(doc.dash_status);
  const appts = Array.isArray(doc.appointments) ? doc.appointments : [];
  const actuallyVisited = normalize(doc.dash_firstvisitapppointment) === 'visited'
    || appts.some((appt) => String(appt && appt.status || '').trim().toUpperCase() === 'VISITED');
  const history = telecrmStageHistory(doc.stage);
  const reopenedFresh = normalize(current) === 'fresh' && history.some((entry) => entry !== 'Fresh');
  const countOrNaN = (value) => (value === null || value === undefined || value === '' ? NaN : Number(value));
  const captureCount = countOrNaN(doc.capture_frequency);
  const previousCaptureCount = countOrNaN(doc.previous_capture_frequency);
  // Both counts must be known. A missing stored count is a first sighting, not a new capture,
  // otherwise the first sync after deploy would read every stored count as 0 and reopen the lead.
  const capturedAgain = Number.isFinite(captureCount)
    && Number.isFinite(previousCaptureCount)
    && captureCount > previousCaptureCount;
  // Only a capture *event* may reopen a stage. source[] keeps website forever, so it
  // cannot gate the push: every sync would otherwise re-push Fresh.
  const recaptureEvent = capturedAgain || reopenedFresh;
  const convertedDash = new Set(['ACTIVE', 'PACKAGE', 'PACKAGE_EXPIRED', 'DISCHARGED', 'INACTIVE']);
  const bookedDash = new Set(['BOOKED', 'BOOKED_WITH_TOKEN', 'BOOKED_WITHOUT_TOKEN']);
  const leadStatuses = {
    fresh: 'Fresh',
    'no response': 'No Response',
    'in pipeline': 'In Pipeline',
    'not shown up': 'Not Shown Up',
    'not converted': 'Not Converted',
  };
  const recaptureOpen = new Set(['fresh', 'no response', 'in pipeline', 'session booked', 'session rescheduled']);
  // Converted means a real visit or a dashboard lifecycle status, not a token payment.
  // The last clause catches TeleCRM's own Lead Recapture resetting a Converted lead to Fresh.
  // A stored Converted value does not win while the patient is still booked, or has just
  // returned from booked to LEAD, unless they actually visited.
  const convertedFamily = convertedDash.has(dashStatus)
    || actuallyVisited
    || (reopenedFresh && history.includes('Converted'));

  let desired = canonicalTelecrmStatus(doc.conversionStatus) || canonicalTelecrmStatus(current);
  let healReason = null;

  if (convertedFamily) {
    desired = 'Converted';
    if (recaptureOpen.has(normalize(current))) {
      healReason = actuallyVisited && !convertedDash.has(dashStatus)
        ? 'visited_recapture_heal'
        : 'converted_dash_recapture_heal';
    }
  } else if (bookedDash.has(dashStatus)) {
    desired = 'Session booked';
  } else if (dashStatus === 'LEAD' && bookedDash.has(upper(doc.previous_dash_status))) {
    // Only the Booked → Lead transition. A lead that was never booked stays on the fallback below.
    desired = 'Not Shown Up';
    if (normalize(current) !== 'not shown up') healReason = 'booked_to_lead';
  } else if (normalize(current) === 'converted') {
    desired = 'Converted';
  } else if (dashStatus === 'LEAD') {
    desired = leadStatuses[normalize(current)] || 'Fresh';
  }

  const nowMs = toEpoch(doc.nowIso) || Date.now();
  // TeleCRM owns lead recapture. Do not store that label on the Mongo source.
  let source = (Array.isArray(doc.source) ? doc.source : [])
    .filter((row) => normalize(row && row.source) !== 'lead_recapture');

  const stage = Array.isArray(doc.stage) ? doc.stage.slice() : [];
  const shouldPush = Boolean(desired) && normalize(current) !== normalize(desired);
  if (shouldPush && desired) {
    const latestTele = stage.find((row) => normalize(row && row.platform) === 'telecrm');
    if (!latestTele || normalize(latestTele.status) !== normalize(desired)) {
      stage.unshift({ platform: 'telecrm', status: desired, occurred_at: toIso(nowMs) });
    }
  }

  return {
    conversionStatus: desired || current || 'Fresh',
    source,
    stage,
    should_push_telecrm: shouldPush,
    recapture_heal_reason: healReason,
    is_lead_recapture: false,
    // A recapture may push without a dashboard status change; that is the only way a
    // TeleCRM-side reset of a Converted lead gets corrected.
    recapture_push: shouldPush && recaptureEvent && convertedFamily,
  };
}

// A sync that loaded BOOKED_* can finish after the user is already LEAD and
// would otherwise write Session booked over the Not Shown Up push.
function applyFreshDashStatus(doc, freshStatus, nowMs) {
  const upper = (value) => String(value == null ? '' : value).trim().toUpperCase();
  const norm = (value) => String(value == null ? '' : value).trim().toLowerCase();
  const booked = new Set(['BOOKED', 'BOOKED_WITH_TOKEN', 'BOOKED_WITHOUT_TOKEN']);
  const loaded = upper(doc && doc.dash_status);
  if (upper(freshStatus) !== 'LEAD' || !booked.has(loaded)) {
    return { doc, suppressed: false };
  }
  const at = toIso(nowMs || Date.now());
  const stage = Array.isArray(doc.stage) ? doc.stage.slice() : [];
  const latestDash = stage.find((row) => norm(row && row.platform) === 'dash');
  if (!latestDash || norm(latestDash.status) !== 'lead') {
    stage.unshift({ platform: 'dash', status: 'LEAD', occurred_at: at });
  }
  const latestTele = stage.find((row) => norm(row && row.platform) === 'telecrm');
  if (!latestTele || norm(latestTele.status) !== 'not shown up') {
    stage.unshift({ platform: 'telecrm', status: 'Not Shown Up', occurred_at: at });
  }
  return {
    suppressed: true,
    doc: {
      ...doc,
      dash_status: 'LEAD',
      conversionStatus: 'Not Shown Up',
      should_push_telecrm: false,
      stage,
      modified_at: at,
      last_synced_at: at,
    },
  };
}

function phoneForTelecrmUpdate(raw) {
  let s = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  return s.length === 10 ? s : '';
}

// Phone-verification creates the Stance user as firstName "Lead". That word is not a person.
function realPersonName(value) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!text || text.toLowerCase() === 'lead') return '';
  if (text.split(' ').every((word) => word.toLowerCase() === 'lead')) return '';
  return text;
}

// The insert sync loads the user before the booking form is saved, then upserts
// minutes later. Copy the profile from a read taken immediately before that write.
// A stub named Lead must not replace a real name already stored for this phone.
function applyFreshProfile(doc, freshUser, existing) {
  const base = doc && typeof doc === 'object' ? { ...doc } : {};
  const previous = existing && typeof existing === 'object' ? existing : {};
  const user = freshUser && typeof freshUser === 'object' ? freshUser : null;
  const pd = user && user.profileData && typeof user.profileData === 'object' ? user.profileData : null;
  if (!pd) return base;
  const freshPerson = realPersonName([pd.firstName, pd.lastName].filter(Boolean).join(' '));
  const existingPerson = realPersonName(previous.name);
  if (!freshPerson && existingPerson) {
    base.name = existingPerson;
    for (const key of ['dash_firstName', 'dash_lastName', 'dash_gender', 'dash_email', 'dash_dob']) {
      if (previous[key] != null && String(previous[key]).trim() !== '') base[key] = previous[key];
    }
    return base;
  }
  if (pd.firstName) base.dash_firstName = pd.firstName;
  if (pd.lastName) base.dash_lastName = pd.lastName;
  if (freshPerson) base.name = freshPerson;
  else {
    const joined = [pd.firstName, pd.lastName].filter(Boolean).join(' ');
    if (joined) base.name = joined;
  }
  if (pd.gender) base.dash_gender = pd.gender;
  if (user.email) base.dash_email = user.email;
  if (pd.dob != null && pd.dob !== '') base.dash_dob = toIso(pd.dob) || String(pd.dob).trim();
  return base;
}

// Updates the lead already stored under this phone. Does not prefix 91:
// TeleCRM treats that as a different id and creates a second lead.
async function pushStatusToTeleCRM(phone10, status, name, mirrorPhone) {
  if (!TELECRM_ASYNC_TOKEN || !status) return { skipped: true, reason: 'no-token-or-status' };
  const phone = phoneForTelecrmUpdate(mirrorPhone);
  if (!phone) return { skipped: true, reason: 'no-existing-lead' };
  const fields = { phone, status };
  if (name) fields.name = name;
  const resp = await fetch(TELECRM_AUTOUPDATE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TELECRM_ASYNC_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  console.log(`[new-telecrm] status push → TeleCRM ${resp.status} (phone=${phone}, status=${status})`);
  return { http: resp.status };
}

// Resolve Final User Status from the TeleCRM stage + Dash user status.
// Precedence (per the Stage mapping sheet):
//   1. Dash user status wins when it is a definitive lifecycle state
//      (ACTIVE / PACKAGE / PACKAGE_EXPIRED / BOOKED_WITH_TOKEN /
//       BOOKED_WITHOUT_TOKEN / INACTIVE).
//   2. Otherwise (Dash is LEAD / null / empty) the TeleCRM stage decides:
//        Session booked / Session Rescheduled  => BOOKED
//        Converted                             => ACTIVE (converted, lifecycle not yet on Dash)
//        Fresh / No Response / In Pipeline /
//        Not Shown Up / Not Converted          => LEAD
const DEFINITIVE_DASH = new Set([
  'ACTIVE', 'PACKAGE', 'PACKAGE_EXPIRED',
  'BOOKED_WITH_TOKEN', 'BOOKED_WITHOUT_TOKEN', 'INACTIVE',
]);
function resolveFinalUserStatus(telecrmStage, dashStatus) {
  if (dashStatus && DEFINITIVE_DASH.has(dashStatus)) return dashStatus;
  const stage = telecrmStage || '';
  if (stage === 'Session booked' || stage === 'Session Rescheduled') return 'BOOKED';
  if (stage === 'Converted') return 'ACTIVE';
  if (['Fresh', 'No Response', 'In Pipeline', 'Not Shown Up', 'Not Converted'].includes(stage)) return 'LEAD';
  return dashStatus === 'LEAD' ? 'LEAD' : (dashStatus || 'LEAD');
}

// ── Core sync for one phone ───────────────────────────────────────────────────
let _reqCounter = 0;

async function syncOne(rawPhone, options = {}) {
  const reqId = ++_reqCounter;
  const t0 = Date.now();
  const phone10 = normPhone10(rawPhone);
  banner(reqId, phone10 || rawPhone);
  if (!phone10) throw new Error('No/invalid phone');

  const total = PUSH_SOURCE ? 8 : 7;
  const step = makeStepper(total, reqId);
  const preloaded = options.lead && typeof options.lead === 'object' ? options.lead : null;

  const db = await step.run('Connect / ensure DB + index', async () => {
    await getDb();
    return { __note: `→ ${process.env.MONGODB_DB}.${TARGET_COLLECTION}` };
  }).then(() => getDb());

  const lead = await step.run(preloaded ? 'Use Mongo telecrm mirror as lead' : 'Fetch lead from TeleCRM API', async () => {
    const l = preloaded || await fetchTeleCRMLead(phone10);
    const f = l.fields || l;
    return Object.assign(l, { __note: `→ ${f.name || '—'} · status=${l.status || f.status || '—'}` });
  });

  const existing = await step.run('Load existing new-telecrm doc', async () => {
    const e = (await db.collection(TARGET_COLLECTION).findOne({ phone: phone10 })) || {};
    return Object.assign(e, { __note: e.phone ? 'found → will merge history' : 'none → fresh insert' });
  });
  const isNew = !existing.phone;
  const mirror = await step.run('Load TeleCRM mirror history', async () => {
    const value = await db.collection('telecrm').findOne(
      { phone: { $in: [phone10, '91' + phone10, '0' + phone10] } },
      { sort: { modified_at: -1 } }
    );
    return Object.assign(value || {}, { __note: value ? 'history found' : 'no mirror history' });
  });
  delete mirror.__note;
  const nowIso = new Date().toISOString();

  const tel = await step.run('Map canonical TeleCRM fields', async () => {
    const t = buildTeleCRMPart(lead, existing);
    t.__note = `leadSource="${t._leadSource || '—'}" · telecrmStatus=${t._telecrmStatus}`;
    return t;
  });
  const telNote = tel.__note; delete tel.__note;

  const dash = await step.run('Join users → appointments → web_visitors', async () => {
    const d = await joinDashboard(db, phone10);
    const m = d.__matched || {};
    d.__note = m.user
      ? `user ✓ · appts=${m.appointments || 0} · analytics ${m.webVisitor ? '✓' : '✗'}`
      : 'no matching dashboard user';
    return d;
  });
  const dashNote = dash.__note; delete dash.__note; const matched = dash.__matched || {}; delete dash.__matched;

  const sourceCategory = tel._sourceCategory; delete tel._sourceCategory;
  delete tel._leadSource;
  const dEntry = dash._dashEntry; delete dash._dashEntry;
  const touchpoints = dash._touchpoints || []; delete dash._touchpoints;
  const webVisitor = dash._webVisitor || null; delete dash._webVisitor;
  const dashCategory = dash._dashCategory || null; delete dash._dashCategory;
  const userCreatedAt = dash._userCreatedAt || null; delete dash._userCreatedAt;
  const dashOccurredAt = dash._dashStatusOccurredAt; delete dash._dashStatusOccurredAt;
  const telStatus = tel._telecrmStatus; delete tel._telecrmStatus;

  const apiFields = lead.fields || lead;
  const mirrorFields = mirror.fields && typeof mirror.fields === 'object' ? mirror.fields : {};
  const fields = { ...mirror, ...mirrorFields, ...apiFields };
  if (Array.isArray(mirror.lead_source) && mirror.lead_source.length) fields.lead_source = mirror.lead_source;
  if (Array.isArray(mirror.source) && mirror.source.length) fields.source = mirror.source;
  if (Array.isArray(mirror.stage) && mirror.stage.length) fields.stage = mirror.stage;
  const srcArr = buildSourceHistory(existing, fields, touchpoints, webVisitor, {
    category: dashCategory,
    createdAt: userCreatedAt,
  });

  const stageArrRaw = buildStageHistory(existing, fields.stage, telStatus, dash.dash_status, dashOccurredAt, new Date().toISOString());
  const createdEpoch = toEpoch(tel.created_on);
  const preservedTemperature = firstDefined(existing.temperature, existing.lead_temperature);
  const preservedCalculatedAt = firstDefined(existing.calculated_at, existing.temperature_calculated_at);
  const decision = finalizeTelecrmStatus({
    conversionStatus: tel.conversionStatus,
    currentTelecrmStatus: telStatus,
    dash_status: dash.dash_status,
    previous_dash_status: existing.dash_status,
    dash_firstvisitapppointment: dash.dash_firstvisitapppointment,
    source: srcArr,
    stage: stageArrRaw,
    appointments: dash._appointments || [],
    capture_frequency: tel.telecrm_capture_frequency,
    previous_capture_frequency: existing.telecrm_capture_frequency,
    nowIso,
  });
  const srcArrFinal = decision.source;
  const stageArr = decision.stage;
  const doc = omitEmpty({
    phone: phone10,
    name: tel.name,
    conversionStatus: decision.conversionStatus,
    dash_status: dash.dash_status,
    dash_patient_id: dash.dash_patient_id,
    dash_firstName: dash.dash_firstName,
    dash_lastName: dash.dash_lastName,
    dash_email: dash.dash_email,
    dash_gender: dash.dash_gender,
    dash_dob: dash.dash_dob,
    dash_patientType: dash.dash_patientType,
    dash_consultant: dash.dash_consultant,
    dash_centers_id: dash.dash_centers_id,
    dash_firstvisitapppointment: dash.dash_firstvisitapppointment,
    telecrm_form_branch: tel.telecrm_form_branch,
    telecrm_form_city: tel.telecrm_form_city,
    telecrm_form_postcode: tel.telecrm_form_postcode,
    telecrm_form_health_concern: tel.telecrm_form_health_concern,
    'telecrm_#ofCalls': tel['telecrm_#ofCalls'],
    'telecrm_#ofmessages': tel['telecrm_#ofmessages'],
    telecrm_connected_calls: tel.telecrm_connected_calls,
    telecrm_first_interaction_date: tel.telecrm_first_interaction_date,
    telecrm_first_call_done: tel.telecrm_first_call_done,
    telecrm_last_contacted_date: tel.telecrm_last_contacted_date,
    telecrm_drop_off_reason: tel.telecrm_drop_off_reason,
    telecrm_capture_frequency: tel.telecrm_capture_frequency,
    source: srcArrFinal,
    stage: stageArr,
    created_on_epoch: createdEpoch,
    created_at: toIso(createdEpoch),
    modified_at: toIso(tel.modified_at) || toIso(nowIso),
    last_synced_at: toIso(nowIso),
    temperature: preservedTemperature ?? null,
    calculated_at: toIso(preservedCalculatedAt),
    temperature_derived: normalizeTemperatureDerived(existing.temperature_derived),
  });

  let stored = doc;
  let staleBookedSuppressed = false;
  if (dash.dash_patient_id && ObjectId.isValid(String(dash.dash_patient_id))) {
    const freshUser = await db.collection('users').findOne(
      { _id: new ObjectId(String(dash.dash_patient_id)) },
      { projection: {
        email: 1,
        'profileData.status': 1,
        'profileData.firstName': 1,
        'profileData.lastName': 1,
        'profileData.gender': 1,
        'profileData.dob': 1,
      } },
    );
    stored = applyFreshProfile(stored, freshUser, existing);
    const freshStatus = freshUser && freshUser.profileData && freshUser.profileData.status;
    const applied = applyFreshDashStatus(stored, freshStatus, Date.now());
    stored = applied.doc;
    staleBookedSuppressed = applied.suppressed;
    delete stored.should_push_telecrm;
  }

  const dashboardName = realPersonName(stored.name);
  const crmNameIsPlaceholder = !realPersonName(tel.name);
  const nameNeedsPush = Boolean(dashboardName)
    && dashboardName.toLowerCase() !== String(tel.name || '').trim().toLowerCase()
    && crmNameIsPlaceholder;
  if (nameNeedsPush) stored.name = dashboardName;
  stored = withBsonDates(stored);

  await step.run(`Upsert into ${TARGET_COLLECTION}`, async () => {
    const r = await db.collection(TARGET_COLLECTION).replaceOne(
      { phone: phone10 },
      stored,
      { upsert: true },
    );
    return { __note: r.upsertedCount ? 'inserted new doc' : 'updated existing doc' };
  });

  const dashStatusChanged = String((existing && existing.dash_status) || '') !== String((dash && dash.dash_status) || '');
  const statusPush = !staleBookedSuppressed && decision.should_push_telecrm && decision.conversionStatus && mirror && mirror.phone
    && (dashStatusChanged || decision.recapture_push);
  if (statusPush) {
    await step.run('Push healed TeleCRM status', async () => {
      const result = await pushStatusToTeleCRM(
        phone10,
        decision.conversionStatus,
        nameNeedsPush ? dashboardName : tel.name,
        mirror.phone,
      );
      const note = result.skipped
        ? `skipped (${result.reason || 'no async token'})`
        : `heal ${decision.recapture_heal_reason || decision.conversionStatus} → ${result.http}`;
      return { __note: note };
    });
  } else if (nameNeedsPush && mirror && mirror.phone && tel.conversionStatus) {
    await step.run('Push updated name to TeleCRM', async () => {
      const result = await pushStatusToTeleCRM(phone10, tel.conversionStatus, dashboardName, mirror.phone);
      const note = result.skipped
        ? `skipped (${result.reason || 'no async token'})`
        : `name → ${result.http}`;
      return { __note: note };
    });
  }

  if (PUSH_SOURCE) {
    await step.run('Push derived source → TeleCRM', async () => {
      const { needsPush } = mapSourceCategory(lead.fields || lead);
      if (!needsPush) return { __note: 'skipped (TeleCRM already has valid source)' };
      await pushSourceToTeleCRM(phone10, sourceCategory);
      return { __note: `pushed "${sourceCategory}"` };
    });
  }

  step.done();
  // ── Summary card ────────────────────────────────────────────────────────────
  const ms = Date.now() - t0;
  const yn = (v) => (v ? `${C.green}yes${C.reset}` : `${C.gray}no${C.reset}`);
  const latestSource = srcArr.length ? (srcArr[0].source || srcArr[0].utmSource || '—') : '—';
  const loggedStage = stored.stage || stageArr;
  const lastTel = loggedStage.find(s => s.platform === 'telecrm');
  const lastDash = loggedStage.find(s => s.platform === 'dash');
  console.log(`  ${C.magenta}│${C.reset} ${C.bold}${stored.name || '—'}${C.reset}  ${C.gray}(${isNew ? 'new lead' : 'existing lead'})${C.reset}`);
  console.log(`  ${C.magenta}│${C.reset} source     ${C.cyan}${latestSource}${C.reset}   temp ${doc.temperature || '—'}`);
  console.log(`  ${C.magenta}│${C.reset} stage[]    telecrm ${C.cyan}${(lastTel && lastTel.status) || '—'}${C.reset} · dash ${C.cyan}${(lastDash && lastDash.status) || '—'}${C.reset}  ${C.gray}(${loggedStage.length} entries)${C.reset}`);
  console.log(`  ${C.magenta}│${C.reset} dashboard  user ${yn(matched.user)} · appts ${matched.appointments || 0} · webAnalytics ${yn(matched.webVisitor)}`);
  console.log(`  ${C.magenta}│${C.reset} dashboard  first visit ${C.cyan}${doc.dash_firstvisitapppointment || '—'}${C.reset}`);
  console.log(`${C.blue}${C.bold}└─ ${C.green}✓ done${C.reset} ${C.gray}in ${ms}ms · ${telNote} · ${dashNote}${C.reset}\n`);

  return { phone: phone10, is_new: isNew };
}

// ── HTTP webhook server ───────────────────────────────────────────────────────
function startServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    // Accept both our path and TeleCRM's existing n8n path, so this server is a
    // drop-in for the TeleCRM webhook (…/webhook/telecrm-status-change).
    const WEBHOOK_PATHS = new Set(['/webhook/telecrm', '/webhook/telecrm-status-change']);
    if (req.method === 'POST' && WEBHOOK_PATHS.has((req.url || '').split('?')[0])) {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        console.log(`\n${C.yellow}⚡ ${now()}${C.reset} ${C.dim}POST ${req.url} · ${body.length} bytes from ${req.socket.remoteAddress}${C.reset}`);
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch (_) {
          console.log(`  ${C.red}✗ invalid JSON body${C.reset}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
        const fields = payload.fields || payload;
        const phone = fields && fields.phone;
        if (!phone) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'missing phone' }));
        }
        try {
          const result = await syncOne(phone);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, ...result }));
        } catch (e) {
          console.error(`[new-telecrm] sync error: ${e.message}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(PORT, async () => {
    await getDb().catch((e) => { console.error(`${C.red}DB connect failed:${C.reset} ${e.message}`); process.exit(1); });
    console.log('');
    console.log(`${C.green}${C.bold}  ●  new-telecrm webhook — LIVE${C.reset}`);
    console.log(`  ${C.gray}────────────────────────────────────────────${C.reset}`);
    console.log(`  ${C.cyan}listening${C.reset}  http://localhost:${PORT}/webhook/telecrm`);
    console.log(`  ${C.cyan}db${C.reset}         ${process.env.MONGODB_DB}.${TARGET_COLLECTION}`);
    console.log(`  ${C.cyan}src push${C.reset}   ${PUSH_SOURCE ? C.yellow + 'ON (writes to TeleCRM)' + C.reset : C.gray + 'off' + C.reset}`);
    console.log(`  ${C.gray}────────────────────────────────────────────${C.reset}`);
    console.log(`  ${C.dim}waiting for TeleCRM events…  (Ctrl-C to stop)${C.reset}`);
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────
if (require.main === module) {
  const argPhone = process.argv[2];
  if (argPhone) {
    syncOne(argPhone)
      .then((r) => { console.log('done', r); return _client && _client.close(); })
      .then(() => process.exit(0))
      .catch((e) => { console.error(e); process.exit(1); });
  } else {
    startServer();
  }
}

module.exports = {
  syncOne, buildTeleCRMPart, mapSourceCategory, joinDashboard,
  buildSourceHistory, buildStageHistory, toEpoch, toMs, bar,
  resolveFinalUserStatus, getDb, normPhone10, TARGET_COLLECTION, C, now,
  omitEmpty, finalizeTelecrmStatus, applyFreshDashStatus, applyFreshProfile, realPersonName,
  toBsonDate, withBsonDates,
};
