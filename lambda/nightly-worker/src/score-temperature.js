'use strict';

// Ported from new workflows/4-temperature-realtime.json → Calculate Temperature (Nightly).
// Scores one TeleCRM lead/search body. The POST must keep the current status.

// TeleCRM Lead Temperature — nightly batch scorer
// Source of truth: live TeleCRM API (lead/search response).
// Score every open stage, including Session booked.
// Converted and Not Converted are not scored and are not pushed to TeleCRM.
// TeleCRM POSTs must include current status so temperature-only updates
// cannot reopen the lead to Fresh.

const NEW_LEAD_DAYS = 14;
const MESSAGE_DAYS = 7;
const CALL_DAYS = 7;
const DEAD_CALLS = 6;
const CLOSED_STATUSES = new Set(['converted', 'not converted']);

function isClosedStatus(status) {
  return CLOSED_STATUSES.has(String(status || '').trim().toLowerCase());
}

function firstDefined(...values) {
  for (const v of values) { if (v !== undefined && v !== null && v !== '') return v; }
  return null;
}
function get(lead, ...keys) {
  const fields = lead && lead.fields && typeof lead.fields === 'object' ? lead.fields : {};
  for (const key of keys) {
    const direct = lead?.[key];
    if (direct !== undefined && direct !== null && direct !== '') return direct;
    const nested = fields?.[key];
    if (nested !== undefined && nested !== null && nested !== '') return nested;
  }
  return null;
}
function toMs(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) { const ms = value.getTime(); return Number.isNaN(ms) ? null : ms; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) return null; return value < 1e12 ? value * 1000 : value; }
  const s = String(value).trim();
  if (!s) return null;
  const numeric = Number(s);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}
function daysBetween(nowMs, value) {
  const ts = toMs(value);
  if (ts === null) return null;
  return Math.max(0, Math.floor((nowMs - ts) / 86400000));
}
function normalizePhone(raw) {
  let s = String(raw ?? '').replace(/[^0-9]/g, '');
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  return s;
}
function numericOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function unwrapLead(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.data)) { if (!raw.data.length) return null; return raw.data[0]; }
  if (raw.fields || raw.status || raw.phone || raw.Phone) return raw;
  return null;
}
function derivedFor(parts) {
  return {
    attempts: parts.calls ?? 0,
    connected: parts.connected ?? 0,
    d_captured: parts.dCaptured ?? null,
    d_inbound: parts.dMessage ?? null,
    d_call: parts.dCall ?? null,
  };
}
function result(status, temperature, shouldWrite, derived, shouldClear) {
  return { status, temperature, should_write_temperature: shouldWrite, should_clear_temperature: !!shouldClear, derived };
}

function calculateTemperature(lead, nowMs) {
  const status = String(get(lead, 'Status', 'status', 'conversionStatus') ?? '').trim();
  const calls = numericOrZero(get(lead, 'Calls Count', '#ofCalls', 'telecrm_#ofCalls', 'calls_count', 'callsCount'));
  const connected = numericOrZero(get(lead, 'Connected Call Count', 'connected_call_count', 'connectedCallCount'));
  const capturedOn = firstDefined(
    get(lead, 'Captured On', 'captured_on', 'capturedOn'),
    get(lead, 'Created On', 'created_on', 'createdOn', 'created_at', 'createdAt')
  );
  const lastIncomingWhatsApp = get(lead, 'Last Incoming WhatsApp On', 'last_incoming_whatsapp_on', 'lastIncomingWhatsAppOn');
  const lastCall = get(lead, 'Last Call', 'last_call', 'lastCall');

  const dCaptured = daysBetween(nowMs, capturedOn);
  const dMessage = daysBetween(nowMs, lastIncomingWhatsApp);
  const dCall = daysBetween(nowMs, lastCall);

  const qNew = dCaptured !== null && dCaptured < NEW_LEAD_DAYS;
  const qMessage = dMessage !== null && dMessage <= MESSAGE_DAYS;
  const qCall = dCall !== null && dCall <= CALL_DAYS && connected > 1;

  const derived = derivedFor({ calls, connected, dCaptured, dMessage, dCall });

  if (!status) return result('', null, false, derived, false);
  if (isClosedStatus(status)) return result(status, null, false, derived, false);
  if (calls > DEAD_CALLS && connected === 0) return result(status, 'COLD', true, derived);

  const score = Number(qNew) + Number(qMessage) + Number(qCall);
  if (score >= 2) return result(status, 'HOT', true, derived);
  if (score === 1) return result(status, 'WARM', true, derived);
  return result(status, 'COLD', true, derived);
}

function skipItem(phone, nowMs) {
  return { json: { phone: phone || '', current_status: null, temperature: null, calculated_at: new Date(nowMs).toISOString(), temperature_derived: null, should_write_temperature: false, should_clear_temperature: false, telecrm_phone: phone && phone.length === 10 ? ('91' + phone) : null, telecrm_temperature: null } };
}

function scoreSearchBody(raw, nowMs = Date.now()) {
  const lead = unwrapLead(raw);
  const phone = normalizePhone(get(lead || raw || {}, 'phone', 'Phone', 'Phone Number', 'phone_number'));
  if (!lead || phone.length !== 10) return skipItem(phone, nowMs).json;
  const calc = calculateTemperature(lead, nowMs);
  const canPush = calc.should_write_temperature === true && !!calc.status && calc.temperature != null;
  return {
    phone,
    current_status: calc.status || null,
    temperature: calc.temperature,
    calculated_at: new Date(nowMs).toISOString(),
    temperature_derived: calc.derived,
    should_write_temperature: canPush,
    should_clear_temperature: calc.should_clear_temperature,
    telecrm_phone: phone.length === 10 ? ('91' + phone) : null,
    telecrm_temperature: calc.temperature == null ? null : String(calc.temperature).toLowerCase(),
  };
}

module.exports = { scoreSearchBody };
