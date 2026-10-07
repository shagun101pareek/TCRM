'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const workflowsDir = path.join(root, 'new workflows');
const allowed = [
  'phone', 'name', 'conversionStatus',
  'dash_status', 'dash_patient_id', 'dash_firstName', 'dash_lastName',
  'dash_email', 'dash_gender', 'dash_dob', 'dash_patientType',
  'dash_consultant', 'dash_centers_id', 'dash_firstvisitapppointment',
  'telecrm_form_branch', 'telecrm_form_city', 'telecrm_form_postcode',
  'telecrm_form_health_concern', 'telecrm_#ofCalls', 'telecrm_#ofmessages',
  'telecrm_connected_calls', 'telecrm_first_interaction_date', 'telecrm_first_call_done',
  'telecrm_last_contacted_date', 'telecrm_drop_off_reason', 'telecrm_capture_frequency',
  'source', 'stage', 'created_on_epoch', 'created_at', 'modified_at', 'last_synced_at',
  'temperature', 'calculated_at', 'temperature_derived',
].sort();
const requiredJoinKeys = [
  'phone', 'conversionStatus', 'source', 'stage',
  'created_on_epoch', 'created_at', 'modified_at', 'last_synced_at',
];
const temperatureKeys = new Set([
  'temperature', 'calculated_at', 'temperature_derived',
]);
const sourceEventKeys = new Set([
  'source', 'occurred_at',
  'utm_source', 'utm_medium', 'utm_campaign',
  'campaign_id', 'campaign_name', 'lead_id',
  'ad_id', 'ad_name', 'ad_set_id', 'ad_set_name',
  'ctwa_id', 'ctwa_source',
]);
function epoch(iso) {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) throw new Error(`bad iso ${iso}`);
  return new Date(ms).toISOString();
}
function assertPublicSource(entry) {
  assert(!Object.prototype.hasOwnProperty.call(entry, 'origin'), `origin must not be stored: ${JSON.stringify(entry)}`);
  assert(!Object.prototype.hasOwnProperty.call(entry, 'tele_source'), `tele_source must not be stored: ${JSON.stringify(entry)}`);
  assert(!Object.prototype.hasOwnProperty.call(entry, 'tele_leadsource'), `tele_leadsource must not be stored: ${JSON.stringify(entry)}`);
}

function workflow(file) {
  return JSON.parse(fs.readFileSync(path.join(workflowsDir, file), 'utf8'));
}

function node(wf, name) {
  const result = wf.nodes.find((entry) => entry.name === name);
  assert(result, `${wf.name} is missing ${name}`);
  return result;
}

function compileCodeNodes(wf) {
  for (const item of wf.nodes) {
    if (item.type === 'n8n-nodes-base.code') {
      assert.doesNotThrow(() => new Function('$', '$input', item.parameters.jsCode), `${wf.name}/${item.name} JS syntax`);
    }
  }
}

function n8nSelector(values) {
  return (name) => {
    const list = (values[name] || []).map((json) => ({ json }));
    const first = () => ({ json: list[0] ? list[0].json : {} });
    return {
      first,
      get item() {
        if (list.length !== 1) {
          const err = new Error('Multiple matches');
          Object.defineProperty(err, 'name', { value: 'Error', writable: false });
          throw err;
        }
        return first();
      },
      all: () => list,
    };
  };
}

function runBuild(code, values) {
  const current = (values['Find Analytics View'] && values['Find Analytics View'][0])
    || (values['Find Touchpoints'] && values['Find Touchpoints'][0])
    || (values['Find Web Visitor'] && values['Find Web Visitor'][0])
    || {};
  return new Function('$', '$input', '$json', code)(
    n8nSelector(values),
    { all: () => [] },
    current,
  )[0].json;
}

const wf1 = workflow('1-sync-webhook.json');
const wf3 = workflow('3-dashboard-to-telecrm.json');
const wf4 = workflow('4-final-source.json');
const wfTemp = workflow('4-temperature-realtime.json');
const main = workflow('main prod.json');
const migration = workflow('5-one-time-canonical-migration.json');
for (const wf of [wf1, wf3, wf4, wfTemp, main, migration]) compileCodeNodes(wf);
execFileSync(process.execPath, ['--check', path.join(root, 'new-telecrm-webhook.js')]);

const { buildTeleCRMPart, buildSourceHistory, buildStageHistory, toMs, toEpoch, bar, finalizeTelecrmStatus, applyFreshDashStatus, applyFreshProfile, withBsonDates } = require(path.join(root, 'new-telecrm-webhook.js'));
assert.strictEqual(typeof toMs, 'function', 'toMs must be defined');
assert.strictEqual(toMs, toEpoch);
const sourceHist = buildSourceHistory(
  {},
  {
    lead_source: [{ source: 'Website', occurred_at: '2026-01-02T00:00:00.000Z' }],
    source: [{ value: 'website', occurred_at: '2026-01-01T00:00:00.000Z' }],
  },
  [],
  null,
);
assert.ok(Array.isArray(sourceHist) && sourceHist.length >= 1, 'buildSourceHistory must return events');
assert.ok(
  toMs(sourceHist[0].occurred_at) <= toMs(sourceHist[sourceHist.length - 1].occurred_at),
  'source history must be oldest-first so index 0 is the earliest source',
);
const stageHist = buildStageHistory(
  {},
  [{ status: 'Fresh', date: '2026-01-01T00:00:00.000Z' }],
  'Not Converted',
  'LEAD',
  '2026-01-02T00:00:00.000Z',
);
assert.ok(Array.isArray(stageHist), 'buildStageHistory must return an array');
assert.strictEqual(stageHist[0].platform, 'dash');
assert.strictEqual(stageHist[0].status, 'LEAD');
assert.strictEqual(stageHist[0].occurred_at, epoch('2026-01-02T00:00:00.000Z'));
const backfilledDash = buildStageHistory(
  { stage: [{ platform: 'dash', status: 'INACTIVE' }] },
  [],
  null,
  'INACTIVE',
  '2026-06-01T00:00:00.000Z',
);
assert.strictEqual(backfilledDash[0].platform, 'dash');
assert.strictEqual(backfilledDash[0].occurred_at, epoch('2026-06-01T00:00:00.000Z'));

const seededFromDashStatus = buildStageHistory(
  {
    dash_status: 'BOOKED_WITH_TOKEN',
    modified_at: '2026-09-11T05:58:48.229Z',
    stage: [
      { platform: 'telecrm', status: 'Not Shown Up', occurred_at: '2026-05-04T20:31:18.779Z' },
      { platform: 'telecrm', status: 'Fresh', occurred_at: '2026-04-24T11:35:33.418Z' },
    ],
  },
  [],
  null,
  'PACKAGE_EXPIRED',
  '2026-09-11T06:29:17.409Z',
);
assert.deepStrictEqual(
  seededFromDashStatus.filter((entry) => entry.platform === 'dash').map((entry) => `${entry.status}@${entry.occurred_at}`),
  [
    `PACKAGE_EXPIRED@${epoch('2026-09-11T06:29:17.409Z')}`,
    `BOOKED_WITH_TOKEN@${epoch('2026-09-11T05:58:48.229Z')}`,
  ],
  'missing dash stage rows must be seeded from existing.dash_status before append',
);

const dashActivated = buildStageHistory(
  {
    stage: [
      { platform: 'dash', status: 'INACTIVE', occurred_at: '2026-04-24T12:00:00.000Z' },
      { platform: 'telecrm', status: 'Not Shown Up', occurred_at: '2026-05-04T20:31:18.779Z' },
      { platform: 'telecrm', status: 'Fresh', occurred_at: '2026-04-24T11:35:33.418Z' },
    ],
  },
  [],
  null,
  'ACTIVE',
  '2026-09-11T03:00:00.000Z',
);
assert.deepStrictEqual(
  dashActivated.filter((entry) => entry.platform === 'dash').map((entry) => entry.status),
  ['ACTIVE', 'INACTIVE'],
  'dash ACTIVE must append instead of overwriting stage[0]',
);
assert.strictEqual(dashActivated[0].status, 'ACTIVE');
assert.strictEqual(dashActivated[0].occurred_at, epoch('2026-09-11T03:00:00.000Z'));
assert.ok(
  dashActivated.some((entry) => entry.platform === 'dash' && entry.status === 'INACTIVE' && entry.occurred_at === epoch('2026-04-24T12:00:00.000Z')),
  'previous dash INACTIVE must remain in stage history',
);

const dashOscillation = buildStageHistory(
  {
    stage: [
      { platform: 'dash', status: 'ACTIVE', occurred_at: '2026-09-11T03:00:00.000Z' },
      { platform: 'dash', status: 'INACTIVE', occurred_at: '2026-04-24T12:00:00.000Z' },
      { platform: 'telecrm', status: 'Not Shown Up', occurred_at: '2026-05-04T20:31:18.779Z' },
      { platform: 'telecrm', status: 'Fresh', occurred_at: '2026-04-24T11:35:33.418Z' },
    ],
  },
  [],
  null,
  'INACTIVE',
  '2026-09-11T03:03:50.681Z',
);
assert.deepStrictEqual(
  dashOscillation.filter((entry) => entry.platform === 'dash').map((entry) => `${entry.status}@${entry.occurred_at}`),
  [
    `INACTIVE@${epoch('2026-09-11T03:03:50.681Z')}`,
    `ACTIVE@${epoch('2026-09-11T03:00:00.000Z')}`,
    `INACTIVE@${epoch('2026-04-24T12:00:00.000Z')}`,
  ],
  'returning to a previous dash status must append a new timed stage row',
);
assert.strictEqual(dashOscillation[0].platform, 'dash');
assert.strictEqual(dashOscillation[0].status, 'INACTIVE');
assert.strictEqual(dashOscillation[0].occurred_at, epoch('2026-09-11T03:03:50.681Z'));

const sameTs = '2026-07-31T03:00:25.211Z';
const observedAt = '2026-09-21T12:40:00.000Z';
const aakashSameTimestamp = buildStageHistory(
  {
    stage: [
      { platform: 'dash', status: 'ACTIVE', occurred_at: sameTs },
      { platform: 'dash', status: 'INACTIVE', occurred_at: sameTs },
      { platform: 'telecrm', status: 'Converted', occurred_at: '2026-04-24T14:13:56.390Z' },
      { platform: 'telecrm', status: 'Fresh', occurred_at: '2026-04-15T07:23:34.689Z' },
    ],
  },
  [],
  'Converted',
  'ACTIVE',
  sameTs,
  observedAt,
);
const aakashDash = aakashSameTimestamp.filter((entry) => entry.platform === 'dash');
assert.strictEqual(aakashDash[0].status, 'ACTIVE');
assert.ok(
  toMs(aakashDash[0].occurred_at) > toMs(sameTs),
  'same-timestamp re-entry to ACTIVE must append a later occurred_at, not drop',
);
assert.strictEqual(aakashDash[0].occurred_at, epoch(observedAt));
assert.ok(
  aakashDash.some((entry) => entry.status === 'ACTIVE' && entry.occurred_at === epoch(sameTs)),
  'original ACTIVE row at the shared timestamp must remain',
);
assert.ok(
  aakashDash.some((entry) => entry.status === 'INACTIVE' && entry.occurred_at === epoch(sameTs)),
  'original INACTIVE row at the shared timestamp must remain',
);
assert.strictEqual(aakashDash.length, 3, 'Aakash-shaped same-timestamp flip must grow dash history by one row');

const staleOscillation = buildStageHistory(
  {
    stage: [
      { platform: 'dash', status: 'ACTIVE', occurred_at: sameTs },
      { platform: 'dash', status: 'INACTIVE', occurred_at: '2026-04-24T12:00:00.000Z' },
    ],
  },
  [],
  null,
  'INACTIVE',
  sameTs,
  observedAt,
);
assert.deepStrictEqual(
  staleOscillation.filter((entry) => entry.platform === 'dash').map((entry) => `${entry.status}@${entry.occurred_at}`),
  [
    `INACTIVE@${epoch(observedAt)}`,
    `ACTIVE@${epoch(sameTs)}`,
    `INACTIVE@${epoch('2026-04-24T12:00:00.000Z')}`,
  ],
  'stale updatedAt oscillation must append INACTIVE at observation time',
);

const unchangedDash = buildStageHistory(
  {
    stage: [
      { platform: 'dash', status: 'INACTIVE', occurred_at: sameTs },
    ],
  },
  [],
  'Converted',
  'INACTIVE',
  sameTs,
  observedAt,
);
assert.deepStrictEqual(
  unchangedDash.filter((entry) => entry.platform === 'dash').map((entry) => `${entry.status}@${entry.occurred_at}`),
  [`INACTIVE@${epoch(sameTs)}`],
  'unchanged dash status must not grow stage[]',
);

assert.doesNotThrow(() => bar(7, 6), 'progress bar must clamp overflow (was Invalid count value: -4)');
assert.doesNotThrow(() => bar(0, 6));
assert.doesNotThrow(() => bar(8, 7));
assert.doesNotThrow(() => bar(1, 0));
assert.ok(/[█░]/.test(bar(7, 6)));
const mapped = buildTeleCRMPart({
  status: 'Not Converted',
  fields: {
    name: 'Schema Test',
    branch: 'Koramangala',
    city: 'Bangalore',
    post_code: '560034',
    health_concern: 'back pain',
    created_on: 1720000000000,
    modified_on: 1720000100000,
    lead_source: 'Whatsapp Cloud API',
    ctwa_id: 'ctwa-1',
  },
}, { 'telecrm_#ofCalls': 3, 'telecrm_#ofmessages': 1, name: 'Keep Me' });
assert.strictEqual(typeof buildTeleCRMPart, 'function', 'buildTeleCRMPart must be defined');
assert.strictEqual(mapped.name, 'Schema Test');
assert.strictEqual(mapped.conversionStatus, 'Not Converted');
assert.strictEqual(mapped.telecrm_form_branch, 'Koramangala');
assert.strictEqual(mapped.telecrm_form_city, 'Bangalore');
assert.strictEqual(mapped.telecrm_form_postcode, '560034');
assert.strictEqual(mapped.telecrm_form_health_concern, 'back pain');
assert.strictEqual(mapped['telecrm_#ofCalls'], 3);
assert.strictEqual(mapped['telecrm_#ofmessages'], 1);
assert.strictEqual(mapped.telecrm_drop_off_reason, null);
assert.strictEqual(mapped._telecrmStatus, 'Not Converted');
assert.strictEqual(mapped._leadSource, 'Whatsapp Cloud API');
assert.ok(mapped._sourceCategory);

const uiMapped = buildTeleCRMPart({
  status: 'Fresh',
  fields: {
    name: 'UI Alias',
    'Captured On': 1720000000000,
    'Last Call': 1720001000000,
    'Capture Frequency': 1,
    'Count of Connected Calls': 4,
    'First Call Attempt': 1720000500000,
    'Calls Count': 7,
  },
}, {});
assert.strictEqual(uiMapped.telecrm_first_interaction_date, new Date(1720000000000).toISOString());
assert.strictEqual(uiMapped.telecrm_last_contacted_date, new Date(1720001000000).toISOString());
const dob = new Date('2001-05-18T00:00:00.000Z');
assert.strictEqual(toEpoch(dob), dob.getTime(), 'Date values must not be scaled by the epoch heuristic');
const storedDates = withBsonDates({
  created_at: '2026-07-13T07:40:44.887Z',
  modified_at: '2026-09-09T05:06:14.776Z',
  last_synced_at: '2026-10-06T10:19:53.313Z',
  dash_dob: '2001-05-18T00:00:00.000Z',
  created_on_epoch: 1783928444887,
  source: [{ source: 'dash_customer', occurred_at: '2025-08-18T06:26:42.829Z' }],
  stage: [{ platform: 'telecrm', status: 'Converted', occurred_at: '2026-10-06T10:19:53.313Z' }],
});
for (const key of ['created_at', 'modified_at', 'last_synced_at', 'dash_dob']) {
  assert.ok(storedDates[key] instanceof Date, `${key} must be a BSON Date`);
}
assert.strictEqual(storedDates.dash_dob.toISOString(), '2001-05-18T00:00:00.000Z');
assert.ok(storedDates.source[0].occurred_at instanceof Date);
assert.ok(storedDates.stage[0].occurred_at instanceof Date);
assert.strictEqual(storedDates.created_on_epoch, 1783928444887);
assert.strictEqual(uiMapped.telecrm_capture_frequency, 1);
assert.strictEqual(uiMapped.telecrm_connected_calls, 4);
assert.strictEqual(uiMapped.telecrm_first_call_done, true);
assert.strictEqual(uiMapped['telecrm_#ofCalls'], 7);

const rootActivity = buildTeleCRMPart({
  status: 'Session booked',
  'Calls Count': 1,
  'Messages Count': 4,
  'Connected Call Count': 1,
  fields: { name: 'Vishal' },
}, { 'telecrm_#ofCalls': 0, 'telecrm_#ofmessages': 0 });
assert.strictEqual(rootActivity['telecrm_#ofCalls'], 1, 'root Calls Count must win over sticky 0');
assert.strictEqual(rootActivity['telecrm_#ofmessages'], 4);
assert.strictEqual(rootActivity.telecrm_connected_calls, 1);
assert.strictEqual(rootActivity.name, 'Vishal');

const hashActivity = buildTeleCRMPart({
  status: 'Fresh',
  fields: {
    name: 'Hash',
    '# Calls Count': 2,
    '# Messages sent lead': 3,
    '# Connected Call Count': 1,
  },
}, {});
assert.strictEqual(hashActivity['telecrm_#ofCalls'], 2);
assert.strictEqual(hashActivity['telecrm_#ofmessages'], 3);
assert.strictEqual(hashActivity.telecrm_connected_calls, 1);

const stickyZero = buildTeleCRMPart({
  status: 'Fresh',
  fields: { name: 'Zero' },
}, { 'telecrm_#ofCalls': 0, 'telecrm_#ofmessages': 0, telecrm_connected_calls: 0 });
assert.strictEqual(stickyZero['telecrm_#ofCalls'], undefined, 'mirror-missing 0 must not stick');
assert.strictEqual(stickyZero['telecrm_#ofmessages'], undefined);
assert.strictEqual(stickyZero.telecrm_connected_calls, undefined);

const wrappedActivity = buildTeleCRMPart({
  status: 'Fresh',
  fields: {
    'Calls Count': { value: 5 },
    'Messages sent lead': { count: 8 },
  },
}, {});
assert.strictEqual(wrappedActivity['telecrm_#ofCalls'], 5);
assert.strictEqual(wrappedActivity['telecrm_#ofmessages'], 8);

const rescheduledDecision = finalizeTelecrmStatus({
  conversionStatus: 'Session Rescheduled',
  currentTelecrmStatus: 'Session Rescheduled',
  dash_status: 'BOOKED_WITHOUT_TOKEN',
  source: [{ source: 'website', occurred_at: '2026-09-01T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'Session booked', occurred_at: '2026-08-01T00:00:00.000Z' }],
  appointments: [{ status: 'BOOKED', rescheduledFrom: ['abc'] }],
  nowIso: '2026-09-22T00:00:00.000Z',
});
assert.strictEqual(rescheduledDecision.conversionStatus, 'Session booked', 'a reschedule that stays booked stays Session booked');
assert.strictEqual(rescheduledDecision.should_push_telecrm, true);
assert.strictEqual(rescheduledDecision.recapture_heal_reason, null);
assert.strictEqual(rescheduledDecision.stage[0].status, 'Session booked');
assert.strictEqual(rescheduledDecision.stage.length, 1, 'do not append a second Session booked row');

const recaptureDecision = finalizeTelecrmStatus({
  conversionStatus: 'Fresh',
  currentTelecrmStatus: 'Fresh',
  dash_status: 'LEAD',
  source: [{ source: 'website', occurred_at: '2026-09-22T00:00:00.000Z' }],
  stage: [
    { platform: 'telecrm', status: 'Fresh', occurred_at: '2026-09-22T00:00:00.000Z' },
    { platform: 'telecrm', status: 'In Pipeline', occurred_at: '2026-08-01T00:00:00.000Z' },
  ],
  appointments: [{ status: 'CANCELLED', cancellationReason: 'OTHER' }],
  nowIso: '2026-09-22T00:00:00.000Z',
});
assert.strictEqual(recaptureDecision.conversionStatus, 'Fresh', 'a lead that was never booked stays Fresh');
assert.strictEqual(recaptureDecision.should_push_telecrm, false, 'already Fresh — nothing to push');
assert.strictEqual(recaptureDecision.source.length, 1);
assert.strictEqual(recaptureDecision.source[0].source, 'website');
assert.strictEqual(recaptureDecision.is_lead_recapture, false, 'Mongo must not implement lead_recapture');

// A second TeleCRM capture does not rewrite Mongo source or reopen the stage.
for (const stage of ['No Response', 'In Pipeline', 'Not Shown Up', 'Not Converted']) {
  const reopened = finalizeTelecrmStatus({
    conversionStatus: stage,
    currentTelecrmStatus: stage,
    dash_status: 'LEAD',
    source: [{ source: 'website', occurred_at: '2026-09-01T00:00:00.000Z' }],
    stage: [{ platform: 'telecrm', status: stage, occurred_at: '2026-09-01T00:00:00.000Z' }],
    appointments: [{ status: 'BOOKED' }],
    capture_frequency: 3,
    previous_capture_frequency: 2,
    nowIso: '2026-09-24T00:00:00.000Z',
  });
  assert.strictEqual(reopened.conversionStatus, stage, `${stage} must stay put when TeleCRM captures again`);
  assert.strictEqual(reopened.should_push_telecrm, false, `${stage} must not be reopened`);
  assert.strictEqual(reopened.is_lead_recapture, false);
  assert(!reopened.source.some((entry) => entry.source === 'lead_recapture'));
}

// First sighting of a capture count is not a capture event: an absent or null stored count
// must not read as 0, or the first sync after deploy would reopen every lead.
for (const storedCount of [undefined, null, '']) {
  const firstSighting = finalizeTelecrmStatus({
    conversionStatus: 'In Pipeline',
    currentTelecrmStatus: 'In Pipeline',
    dash_status: 'LEAD',
    source: [{ source: 'website', occurred_at: '2026-09-01T00:00:00.000Z' }],
    stage: [{ platform: 'telecrm', status: 'In Pipeline', occurred_at: '2026-09-01T00:00:00.000Z' }],
    appointments: [{ status: 'BOOKED' }],
    capture_frequency: 9,
    previous_capture_frequency: storedCount,
    nowIso: '2026-09-24T00:00:00.000Z',
  });
  assert.strictEqual(firstSighting.conversionStatus, 'In Pipeline', `stored count ${String(storedCount)} is a baseline, not a capture`);
  assert.strictEqual(firstSighting.should_push_telecrm, false);
}

// A recaptured lead with no appointment history reopens too: JS must match the n8n gate.
const recaptureNoAppointments = finalizeTelecrmStatus({
  conversionStatus: 'No Response',
  currentTelecrmStatus: 'No Response',
  dash_status: 'LEAD',
  source: [{ source: 'meta_form', occurred_at: '2026-09-01T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'No Response', occurred_at: '2026-09-01T00:00:00.000Z' }],
  appointments: [],
  capture_frequency: 2,
  previous_capture_frequency: 1,
  nowIso: '2026-09-24T00:00:00.000Z',
});
assert.strictEqual(recaptureNoAppointments.conversionStatus, 'No Response', 'a second capture must not reopen No Response');
assert.strictEqual(recaptureNoAppointments.should_push_telecrm, false);
assert(!recaptureNoAppointments.source.some((entry) => entry.source === 'lead_recapture'));

// Converted is the exception: it is never reopened, even on a capture event.
const convertedHeld = finalizeTelecrmStatus({
  conversionStatus: 'Converted',
  currentTelecrmStatus: 'Converted',
  dash_status: 'LEAD',
  source: [{ source: 'website', occurred_at: '2026-09-01T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'Converted', occurred_at: '2026-09-01T00:00:00.000Z' }],
  appointments: [{ status: 'BOOKED' }],
  capture_frequency: 4,
  previous_capture_frequency: 2,
  nowIso: '2026-09-24T00:00:00.000Z',
});
assert.strictEqual(convertedHeld.conversionStatus, 'Converted', 'Converted must not reopen to Fresh');
assert.strictEqual(convertedHeld.should_push_telecrm, false);

// Monday regression: TeleCRM's own Lead Recapture reset a Converted lead to Fresh.
const mondayReset = finalizeTelecrmStatus({
  conversionStatus: 'Fresh',
  currentTelecrmStatus: 'Fresh',
  dash_status: 'LEAD',
  source: [{ source: 'website', occurred_at: '2026-09-24T00:00:00.000Z' }],
  stage: [
    { platform: 'telecrm', status: 'Fresh', occurred_at: '2026-09-24T00:00:00.000Z' },
    { platform: 'telecrm', status: 'Converted', occurred_at: '2026-08-01T00:00:00.000Z' },
  ],
  appointments: [{ status: 'PAID' }],
  nowIso: '2026-09-24T00:00:00.000Z',
});
assert.strictEqual(mondayReset.conversionStatus, 'Converted', 'a Converted lead reset to Fresh must heal back');
assert.strictEqual(mondayReset.should_push_telecrm, true);
assert.strictEqual(mondayReset.recapture_push, true, 'heal must push without a dash status change');

// Same lead, no new capture: a standing website source must not re-push Fresh on every sync.
const noEventResync = finalizeTelecrmStatus({
  conversionStatus: 'In Pipeline',
  currentTelecrmStatus: 'In Pipeline',
  dash_status: 'LEAD',
  source: [{ source: 'website', occurred_at: '2026-09-01T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'In Pipeline', occurred_at: '2026-09-01T00:00:00.000Z' }],
  appointments: [{ status: 'BOOKED' }],
  capture_frequency: 2,
  previous_capture_frequency: 2,
  nowIso: '2026-09-24T00:00:00.000Z',
});
assert.strictEqual(noEventResync.conversionStatus, 'In Pipeline', 'no capture event must not reopen the stage');
assert.strictEqual(noEventResync.should_push_telecrm, false);

// Inactive / package-expired patients are Converted on TeleCRM and stay there.
const inactiveRecapture = finalizeTelecrmStatus({
  conversionStatus: 'Fresh',
  currentTelecrmStatus: 'Fresh',
  dash_status: 'INACTIVE',
  source: [{ source: 'website', occurred_at: '2026-09-24T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'Converted', occurred_at: '2026-08-01T00:00:00.000Z' }],
  appointments: [{ status: 'PAID' }],
  capture_frequency: 3,
  previous_capture_frequency: 2,
  nowIso: '2026-09-24T00:00:00.000Z',
});
assert.strictEqual(inactiveRecapture.conversionStatus, 'Converted', 'INACTIVE must not bounce to Fresh');
assert.strictEqual(inactiveRecapture.should_push_telecrm, true);

const convertedRecapture = finalizeTelecrmStatus({
  conversionStatus: 'Fresh',
  currentTelecrmStatus: 'Fresh',
  dash_status: 'INACTIVE',
  dash_firstvisitapppointment: 'visited',
  source: [{ source: 'website', occurred_at: '2026-09-22T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'Converted', occurred_at: '2026-07-31T00:00:00.000Z' }],
  appointments: [{ status: 'VISITED' }],
  nowIso: '2026-09-22T00:00:00.000Z',
});
assert.strictEqual(convertedRecapture.conversionStatus, 'Converted');
assert.strictEqual(convertedRecapture.source.length, 1);
assert.strictEqual(convertedRecapture.source[0].source, 'website');
assert(!convertedRecapture.source.some((entry) => entry.source === 'lead_recapture'));

const trueFresh = finalizeTelecrmStatus({
  conversionStatus: 'Fresh',
  currentTelecrmStatus: 'Fresh',
  dash_status: 'LEAD',
  source: [{ source: 'website', occurred_at: '2026-09-22T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'Fresh', occurred_at: '2026-09-22T00:00:00.000Z' }],
  appointments: [],
  nowIso: '2026-09-22T00:00:00.000Z',
});
assert.strictEqual(trueFresh.conversionStatus, 'Fresh');
assert(!trueFresh.source.some((entry) => entry.source === 'lead_recapture'));

// Booked → Lead is Not Shown Up. A lead that was never booked is not rewritten.
for (const previous of ['BOOKED', 'BOOKED_WITH_TOKEN', 'BOOKED_WITHOUT_TOKEN']) {
  const cancelledBooking = finalizeTelecrmStatus({
    conversionStatus: 'Session booked',
    currentTelecrmStatus: 'Session booked',
    dash_status: 'LEAD',
    previous_dash_status: previous,
    source: [{ source: 'website', occurred_at: '2026-09-22T00:00:00.000Z' }],
    stage: [{ platform: 'telecrm', status: 'Session booked', occurred_at: '2026-09-22T00:00:00.000Z' }],
    appointments: [{ status: 'CANCELLED', cancellationReason: 'PATIENT_REQUEST' }],
    capture_frequency: 1,
    previous_capture_frequency: 1,
    nowIso: '2026-09-25T00:00:00.000Z',
  });
  assert.strictEqual(cancelledBooking.conversionStatus, 'Not Shown Up', `${previous} → LEAD must be Not Shown Up`);
  assert.strictEqual(cancelledBooking.should_push_telecrm, true);
  assert.strictEqual(cancelledBooking.recapture_heal_reason, 'booked_to_lead');
}

const alreadyPipeline = finalizeTelecrmStatus({
  conversionStatus: 'In Pipeline',
  currentTelecrmStatus: 'In Pipeline',
  dash_status: 'LEAD',
  previous_dash_status: 'BOOKED_WITHOUT_TOKEN',
  source: [{ source: 'website', occurred_at: '2026-09-22T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'In Pipeline', occurred_at: '2026-09-25T00:00:00.000Z' }],
  appointments: [{ status: 'CANCELLED', cancellationReason: 'PATIENT_REQUEST' }],
  capture_frequency: 1,
  previous_capture_frequency: 1,
  nowIso: '2026-09-25T00:00:00.000Z',
});
assert.strictEqual(alreadyPipeline.conversionStatus, 'Not Shown Up');
assert.strictEqual(alreadyPipeline.should_push_telecrm, true, 'Booked → Lead moves In Pipeline to Not Shown Up');

const standingLead = finalizeTelecrmStatus({
  conversionStatus: 'Session booked',
  currentTelecrmStatus: 'Session booked',
  dash_status: 'LEAD',
  previous_dash_status: 'LEAD',
  source: [{ source: 'website', occurred_at: '2026-09-22T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'Session booked', occurred_at: '2026-09-22T00:00:00.000Z' }],
  appointments: [],
  capture_frequency: 1,
  previous_capture_frequency: 1,
  nowIso: '2026-09-25T00:00:00.000Z',
});
assert.strictEqual(standingLead.conversionStatus, 'Fresh', 'Lead that was never booked does not become In Pipeline');

const convertedAfterBooking = finalizeTelecrmStatus({
  conversionStatus: 'Converted',
  currentTelecrmStatus: 'Converted',
  dash_status: 'LEAD',
  previous_dash_status: 'BOOKED_WITH_TOKEN',
  source: [{ source: 'website', occurred_at: '2026-09-22T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'Converted', occurred_at: '2026-09-22T00:00:00.000Z' }],
  appointments: [{ status: 'VISITED' }],
  dash_firstvisitapppointment: 'visited',
  capture_frequency: 1,
  previous_capture_frequency: 1,
  nowIso: '2026-09-25T00:00:00.000Z',
});
assert.strictEqual(convertedAfterBooking.conversionStatus, 'Converted', 'a visited patient must not become Not Shown Up');

const paidStillBooked = finalizeTelecrmStatus({
  conversionStatus: 'Converted',
  currentTelecrmStatus: 'Converted',
  dash_status: 'BOOKED_WITH_TOKEN',
  source: [{ source: 'website', occurred_at: '2026-09-22T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'Converted', occurred_at: '2026-09-22T00:00:00.000Z' }],
  appointments: [{ status: 'PAID' }],
  dash_firstvisitapppointment: 'not_visited',
  capture_frequency: 1,
  previous_capture_frequency: 1,
  nowIso: '2026-09-25T00:00:00.000Z',
});
assert.strictEqual(paidStillBooked.conversionStatus, 'Session booked', 'a paid token without a visit stays Session booked');
assert.strictEqual(paidStillBooked.should_push_telecrm, true);

const visitedWhileBooked = finalizeTelecrmStatus({
  conversionStatus: 'Session booked',
  currentTelecrmStatus: 'Session booked',
  dash_status: 'BOOKED_WITH_TOKEN',
  source: [{ source: 'website', occurred_at: '2026-09-22T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'Session booked', occurred_at: '2026-09-22T00:00:00.000Z' }],
  appointments: [{ status: 'VISITED' }],
  dash_firstvisitapppointment: 'visited',
  capture_frequency: 1,
  previous_capture_frequency: 1,
  nowIso: '2026-09-25T00:00:00.000Z',
});
assert.strictEqual(visitedWhileBooked.conversionStatus, 'Converted', 'a VISITED first visit is Converted');

const staleBooked = applyFreshDashStatus({
  dash_status: 'BOOKED_WITHOUT_TOKEN',
  conversionStatus: 'Session booked',
  should_push_telecrm: false,
  stage: [
    { platform: 'telecrm', status: 'Session booked', occurred_at: 1 },
    { platform: 'dash', status: 'BOOKED_WITHOUT_TOKEN', occurred_at: 1 },
  ],
}, 'LEAD', 50);
assert.strictEqual(staleBooked.suppressed, true);
assert.strictEqual(staleBooked.doc.dash_status, 'LEAD');
assert.strictEqual(staleBooked.doc.conversionStatus, 'Not Shown Up');
assert.strictEqual(staleBooked.doc.should_push_telecrm, false);
assert.strictEqual(staleBooked.doc.stage[0].status, 'Not Shown Up');
const stillBooked = applyFreshDashStatus({
  dash_status: 'BOOKED_WITHOUT_TOKEN',
  conversionStatus: 'Session booked',
  stage: [],
}, 'BOOKED_WITHOUT_TOKEN', 50);
assert.strictEqual(stillBooked.suppressed, false);
assert.strictEqual(stillBooked.doc.conversionStatus, 'Session booked');

const healedName = applyFreshProfile(
  { name: 'Lead', dash_firstName: 'Lead', dash_gender: 'MALE', phone: '6360159564' },
  {
    email: 'premaprema10554@gmail.com',
    profileData: { firstName: 'Prema', lastName: 'Prema', gender: 'FEMALE', dob: 1285027200, status: 'LEAD' },
  },
  { name: 'Lead', dash_firstName: 'Lead', dash_gender: 'MALE' },
);
assert.strictEqual(healedName.name, 'Prema Prema', 'a fresh profile replaces the phone-verification name');
assert.strictEqual(healedName.dash_firstName, 'Prema');
assert.strictEqual(healedName.dash_lastName, 'Prema');
assert.strictEqual(healedName.dash_gender, 'FEMALE');
assert.strictEqual(healedName.dash_email, 'premaprema10554@gmail.com');
assert.strictEqual(healedName.dash_dob, '2010-09-21T00:00:00.000Z');
assert.strictEqual(healedName.phone, '6360159564');
const keepRealName = applyFreshProfile(
  { name: 'Lead', dash_firstName: 'Lead', dash_gender: 'MALE' },
  { profileData: { firstName: 'Lead', gender: 'MALE', status: 'LEAD' } },
  { name: 'Prema Prema', dash_firstName: 'Prema', dash_lastName: 'Prema', dash_gender: 'FEMALE', dash_email: 'prema@example.com' },
);
assert.strictEqual(keepRealName.name, 'Prema Prema', 'a later stub read must not replace a real name');
assert.strictEqual(keepRealName.dash_firstName, 'Prema');
assert.strictEqual(keepRealName.dash_gender, 'FEMALE');
assert.strictEqual(keepRealName.dash_email, 'prema@example.com');

const recaptureBeatsBooking = finalizeTelecrmStatus({
  conversionStatus: 'Session booked',
  currentTelecrmStatus: 'Session booked',
  dash_status: 'LEAD',
  previous_dash_status: 'BOOKED',
  source: [{ source: 'website', occurred_at: '2026-09-22T00:00:00.000Z' }],
  stage: [{ platform: 'telecrm', status: 'Session booked', occurred_at: '2026-09-22T00:00:00.000Z' }],
  appointments: [{ status: 'CANCELLED', cancellationReason: 'PATIENT_REQUEST' }],
  capture_frequency: 2,
  previous_capture_frequency: 1,
  nowIso: '2026-09-25T00:00:00.000Z',
});
assert.strictEqual(recaptureBeatsBooking.conversionStatus, 'Not Shown Up', 'Booked → Lead stays Not Shown Up when TeleCRM capture frequency rises');
assert(!recaptureBeatsBooking.source.some((entry) => entry.source === 'lead_recapture'));

const { leadFromMirror } = require(path.join(root, 'scripts/sync-1000-users.js'));
const fromMirror = leadFromMirror({
  phone: '9879990466',
  status: 'Not Converted',
  name: 'Mirror Test',
  branch: 'Indiranagar',
  lead_source: [{ source: 'Website', date: '2026-01-01T00:00:00.000Z' }],
  fields: { city: 'Bangalore' },
});
assert.strictEqual(fromMirror.status, 'Not Converted');
assert.strictEqual(fromMirror.fields.name, 'Mirror Test');
assert.strictEqual(fromMirror.fields.branch, 'Indiranagar');
assert.strictEqual(fromMirror.fields.city, 'Bangalore');
assert.strictEqual(fromMirror.fields.lead_source, 'Website');

const wf1Code = node(wf1, 'Build Document').parameters.jsCode;
const baseValues = {
  'Normalize Phone': [{ phone10: '9879990466' }],
  'TeleCRM Search': [{
    data: [{
      status: 'Not Converted',
      fields: {
        phone: '9879990466',
        name: 'Schema Test',
        ctwa_id: 'ctwa-1',
        ctwa_source_id: 'source-1',
        campaign_name: 'Campaign',
        ad_name: 'Ad',
        ad_set_name: 'Set',
        ad_set_id: 'set-1',
        created_on: 1720000000000,
        modified_on: 1720000100000,
      },
    }],
  }],
  'Load Existing Doc': [{}],
  'Find TeleCRM Mirror History': [{
    phone: '9879990466',
    lead_source: [
      { source: 'Whatsapp Cloud API', date: '2026-01-01T00:00:00.000Z' },
      { source: 'Whatsapp Cloud API', date: '2026-01-02T00:00:00.000Z' },
    ],
    source: [{ value: 'ctwa', date: '2026-01-01T00:01:00.000Z' }],
    stage: [
      { status: 'Fresh', date: '2026-01-01T00:00:00.000Z' },
      { status: 'Not Shown Up', date: '2026-01-02T00:00:00.000Z' },
      { status: 'Not Converted', date: '2026-01-03T00:00:00.000Z' },
    ],
    status: 'Not Converted',
  }],
  'Find User': [{}],
  'Aggregate Appointments': [],
  'Find Web Visitor': [{}],
  'Find Touchpoints': [{}],
};

const whatsapp = runBuild(wf1Code, baseValues);
for (const key of requiredJoinKeys) {
  assert(Object.prototype.hasOwnProperty.call(whatsapp, key), `missing required join key ${key}`);
}
for (const key of Object.keys(whatsapp)) {
  assert(allowed.includes(key), `unexpected join key ${key}`);
}
for (const key of temperatureKeys) {
  assert(!Object.prototype.hasOwnProperty.call(whatsapp, key), `${key} must be absent until scored`);
}
assert(!Object.prototype.hasOwnProperty.call(whatsapp, 'dash_patient_id'), 'missing dashboard user must omit dash_* keys');
assert(!Object.prototype.hasOwnProperty.call(whatsapp, 'dash_firstVisitAppointments'), 'dash_firstVisitAppointments must not be stored');
assert(!Object.prototype.hasOwnProperty.call(whatsapp, 'lead_temperature'), 'legacy lead_temperature must not be stored');
assert.strictEqual(whatsapp.source.length, 2, 'each dated TeleCRM capture stays in source history');
assert.strictEqual(whatsapp.source.filter((entry) => entry.source === 'meta_ctwa').length, 2);
assert.strictEqual(whatsapp.source[0].source, 'meta_ctwa');
assert.ok(toMs(whatsapp.source[0].occurred_at) <= toMs(whatsapp.source[1].occurred_at), 'source history is oldest-first');
assert.strictEqual(whatsapp.source[0].ctwa_id, 'ctwa-1');
assert.strictEqual(whatsapp.source[0].ctwa_source, 'source-1');
for (const entry of whatsapp.source) {
  assertPublicSource(entry);
  assert(Object.keys(entry).every((key) => sourceEventKeys.has(key)), `unexpected source event key: ${JSON.stringify(entry)}`);
  assert(Object.values(entry).every((value) => value !== null && value !== ''), `blank source event value: ${JSON.stringify(entry)}`);
}
assert(!Object.prototype.hasOwnProperty.call(whatsapp, 'ctwa_id'), 'CTWA must not exist at root');
assert(!Object.prototype.hasOwnProperty.call(whatsapp, 'final_source'), 'final_source must not exist');
assert.strictEqual(typeof whatsapp.created_on_epoch, 'number');
assert(whatsapp.created_on_epoch > 1e12);
assert.strictEqual(whatsapp.created_at, new Date(whatsapp.created_on_epoch).toISOString());
assert.strictEqual(typeof whatsapp.last_synced_at, 'string');
assert(!Number.isNaN(Date.parse(whatsapp.last_synced_at)));
assert.strictEqual(typeof whatsapp.modified_at, 'string');
assert(!Number.isNaN(Date.parse(whatsapp.modified_at)));
assert(!Object.prototype.hasOwnProperty.call(whatsapp, 'created_on'));
assert.deepStrictEqual(
  whatsapp.stage.map((entry) => entry.status),
  ['Not Converted', 'Not Shown Up', 'Fresh'],
  'empty join doc must keep the full TeleCRM stage history',
);
assert(whatsapp.stage.every((entry) => entry.occurred_at), 'new stage rows must keep their timestamps');

const legacyTemp = JSON.parse(JSON.stringify(baseValues));
legacyTemp['Load Existing Doc'] = [{
  phone: '9879990466',
  lead_temperature: 'COLD',
  temperature_outcome: 'COLD',
  temperature_rule: 'T2',
  temperature_derived: {
    status: 'Not Converted',
    d_status: 0,
    d_inbound: null,
    d_call: null,
    connected: 0,
    attempts: 0,
    future_session: false,
  },
}];
const cleanedTemp = runBuild(wf1Code, legacyTemp);
assert.deepStrictEqual(
  Object.keys(cleanedTemp.temperature_derived).sort(),
  ['attempts', 'connected', 'd_call', 'd_captured', 'd_inbound'],
);
assert.strictEqual(cleanedTemp.temperature_derived.d_captured, 0);
assert.strictEqual(cleanedTemp.temperature, 'COLD');
assert(!Object.prototype.hasOwnProperty.call(cleanedTemp, 'lead_temperature'));
assert(!Object.prototype.hasOwnProperty.call(cleanedTemp, 'temperature_outcome'));
assert(!Object.prototype.hasOwnProperty.call(cleanedTemp, 'temperature_rule'));

const unpaired = JSON.parse(JSON.stringify(baseValues));
unpaired['Normalize Phone'] = [{ phone10: '9879990466' }, { phone10: '9999999999' }];
unpaired['TeleCRM Search'] = [
  baseValues['TeleCRM Search'][0],
  { data: [{ status: 'Fresh', fields: { phone: '9999999999', name: 'Other' } }] },
];
unpaired['Find User'] = [{ phone: '9879990466' }];
const unpairedDoc = runBuild(wf1Code, unpaired);
assert.strictEqual(unpairedDoc.phone, '9879990466', 'Build Document must pair by phone when Normalize Phone has multiple items');
assert.strictEqual(unpairedDoc.name, 'Schema Test');

const matchedValues = JSON.parse(JSON.stringify(baseValues));
matchedValues['Find User'] = [{
  _id: 'user-1',
  updatedAt: '2026-01-04T00:00:00.000Z',
  email: 'user@example.com',
  profileData: {
    status: 'ACTIVE',
    firstName: 'Matched',
    lastName: 'User',
    consultant: 'consultant-1',
    centers: ['center-1', 'center-2'],
  },
}];
matchedValues['Aggregate Appointments'] = [{
  visitType: 'FIRST_VISIT',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  report: 'report-1',
  status: 'PAID',
}];
const matched = runBuild(wf1Code, matchedValues);
assert.strictEqual(matched.dash_patient_id, 'user-1');
assert.strictEqual(matched.dash_centers_id, 'center-1');
assert.strictEqual(matched.dash_firstvisitapppointment, 'not_visited', 'PAID is not a visit');
assert(!Object.prototype.hasOwnProperty.call(matched, 'dash_firstVisitAppointments'));

const websiteValues = JSON.parse(JSON.stringify(baseValues));
websiteValues['TeleCRM Search'][0].data[0].fields = {
  phone: '9879990466',
  name: 'Website Test',
  lead_source: [{ source: 'Website' }],
  created_on: 1720000000000,
};
websiteValues['TeleCRM Search'][0].data[0].status = 'Fresh';
websiteValues['Find TeleCRM Mirror History'] = [{
  phone: '9879990466',
  lead_source: [{ source: 'Website', date: '2026-01-01T00:00:00.000Z' }],
  source: [],
  stage: [{ status: 'Fresh', date: '2026-01-01T00:00:00.000Z' }],
  status: 'Fresh',
}];
websiteValues['Find User'] = [{
  _id: 'user-web',
  createdAt: '2026-01-01T00:00:00.000Z',
  profileData: { category: 'WEBSITE' },
}];
websiteValues['Find Analytics View'] = [{
  phone: '9879990466',
  profileData: {
    category: 'WEBSITE',
    webAnalytics: {
      utmSource: 'google',
      utmMedium: 'cpc',
      gclid: 'gclid-1',
      firstTouchAt: '2026-02-01T00:00:00.000Z',
    },
  },
}];
const website = runBuild(wf1Code, websiteValues);
assert.strictEqual(website.source[0].source, 'website', 'Dashboard WEBSITE with a UTM source stores website');
assert.ok(toMs(website.source[0].occurred_at) <= toMs(website.source[website.source.length - 1].occurred_at), 'website source history is oldest-first');
assertPublicSource(website.source[0]);
assert(!website.source.some((entry) => entry.source === 'google_cpc'), 'analytics UTM must not add a second source');
assert(website.source.every((entry) => entry.source !== 'WEBSITE'), 'Website source label is lowercase like dash_organic');

const websiteOrganicValues = JSON.parse(JSON.stringify(websiteValues));
websiteOrganicValues['Find Analytics View'] = [{
  phone: '9879990466',
  profileData: {
    category: 'WEBSITE',
    webAnalytics: { utmSource: null },
  },
}];
const websiteOrganic = runBuild(wf1Code, websiteOrganicValues);
assert.deepStrictEqual(
  websiteOrganic.source.map((entry) => entry.source),
  ['website_organic', 'website'],
  'dashboard website and the TeleCRM website capture are both kept, earliest first',
);
assertPublicSource(websiteOrganic.source[0]);

const metaValues = JSON.parse(JSON.stringify(baseValues));
metaValues['TeleCRM Search'][0].data[0].fields = {
  phone: '9879990466',
  name: 'Meta Test',
  lead_source: [{ source: 'Facebook', date: '2026-03-01T00:00:00.000Z' }],
  source: [{
    value: 'Meta Lead Form',
    date: '2026-03-01T00:01:00.000Z',
    campaign_id: 'campaign-1',
    campaign: 'Campaign One',
    lead_id: 'lead-1',
    ad_id: 'ad-1',
    ad: 'Ad One',
    ad_set_id: 'set-1',
    ad_set_name: 'Set One',
  }],
  created_on: 1720000000000,
};
metaValues['Find TeleCRM Mirror History'] = [{
  phone: '9879990466',
  lead_source: metaValues['TeleCRM Search'][0].data[0].fields.lead_source,
  source: metaValues['TeleCRM Search'][0].data[0].fields.source,
  stage: [{ status: 'Fresh', date: '2026-03-01T00:00:00.000Z' }],
  status: 'Fresh',
}];
const meta = runBuild(wf1Code, metaValues);
const metaBucket = meta.source.find((entry) => entry.source === 'meta_form');
assertPublicSource(metaBucket);
assert.strictEqual(metaBucket.source, 'meta_form');
assert.strictEqual(metaBucket.campaign_id, 'campaign-1');
assert.strictEqual(metaBucket.campaign_name, 'Campaign One');
assert.strictEqual(metaBucket.lead_id, 'lead-1');
assert.strictEqual(metaBucket.ad_id, 'ad-1');
assert.strictEqual(metaBucket.ad_name, 'Ad One');
assert.strictEqual(metaBucket.occurred_at, epoch('2026-03-01T00:00:00.000Z'));

const repeatValues = JSON.parse(JSON.stringify(baseValues));
repeatValues['Load Existing Doc'] = [{ ...whatsapp }];
const repeated = runBuild(wf1Code, repeatValues);
assert.strictEqual(repeated.source.length, whatsapp.source.length, 'unchanged attribution must not append');
assert.deepStrictEqual(repeated.stage, whatsapp.stage, 'unchanged stage history must be idempotent');

const lifoValues = JSON.parse(JSON.stringify(baseValues));
lifoValues['Load Existing Doc'] = [{
  phone: '9879990466',
  source: [
    { source: 'website', origin: 'telecrm', occurred_at: '2026-01-01T00:00:00.000Z' },
    { source: 'google_cpc', origin: 'web_touchpoint', occurred_at: '2026-02-01T00:00:00.000Z' },
  ],
  stage: [
    { platform: 'telecrm', status: 'Fresh', occurred_at: '2026-03-01T00:00:00.000Z' },
    { platform: 'telecrm', status: 'Not Shown Up', occurred_at: '2026-04-01T00:00:00.000Z' },
    { platform: 'telecrm', status: 'Fresh', occurred_at: '2026-05-01T00:00:00.000Z' },
  ],
}];
const lifo = runBuild(wf1Code, lifoValues);
assert.deepStrictEqual(
  lifo.stage.filter((entry) => entry.platform === 'telecrm').map((entry) => entry.status),
  ['Fresh', 'Not Shown Up', 'Fresh', 'Not Converted', 'Not Shown Up', 'Fresh'],
  'existing join stage history is unioned with TeleCRM mirror stages, newest first',
);
assert.ok(lifo.source.length >= 1, 'TeleCRM capture history is stored');
assert.strictEqual(lifo.source[0].source, 'meta_ctwa');
assert.ok(lifo.source.every((entry) => entry.source === 'meta_ctwa'), 'stored page hits are not appended ahead of the TeleCRM capture');

const sanjayValues = JSON.parse(JSON.stringify(baseValues));
sanjayValues['Normalize Phone'] = [{ phone10: '9738761762' }];
sanjayValues['TeleCRM Search'] = [{
  data: [{
    status: 'Not Converted',
    fields: {
      phone: '9738761762',
      name: 'Sanjay',
      ctwa_id: 'ctwa-sanjay',
      created_on: 1777016828418,
      modified_on: Date.parse('2026-09-09T08:23:33.463Z'),
    },
  }],
}];
sanjayValues['Load Existing Doc'] = [{
  phone: '9738761762',
  source: [{
    source: 'Whatsapp Cloud API',
    origin: 'telecrm',
    occurred_at: '2026-04-24T07:47:08.418Z',
    tele_leadsource: 'Whatsapp Cloud API',
    ctwa_id: 'ctwa-sanjay',
  }],
  stage: [{ 'telecrm_#ofCalls': 0, 'telecrm_#ofmessages': 0, telecrm_form_branch: null }],
}];
sanjayValues['Find TeleCRM Mirror History'] = [{
  phone: '9738761762',
  lead_source: 'Whatsapp Cloud API',
  created_at: '2026-04-24T07:47:08.418Z',
  ctwa_id: 'ctwa-sanjay',
  source: [
    { source: 'Whatsapp Cloud API', status: 'No Response', date: '2026-04-24T14:13:27.421Z' },
    { value: 'CTWA', date: '2026-05-25T09:25:03.767Z' },
  ],
  stage: [
    { status: 'Fresh', date: '2026-04-24T07:47:08.418000Z' },
    { status: 'No Response', date: '2026-04-24T14:13:27.421Z' },
    { status: 'Not Converted', date: '2026-05-25T09:25:24.905Z' },
  ],
  status: 'Not Converted',
}];
const sanjay = runBuild(wf1Code, sanjayValues);
assert.deepStrictEqual(
  sanjay.stage.map((entry) => entry.status),
  ['Not Converted', 'No Response', 'Fresh'],
  'Sanjay must keep Fresh, No Response, and Not Converted',
);
assert.ok(sanjay.source.filter((entry) => entry.source === 'meta_ctwa').length >= 1);
assert.strictEqual(sanjay.source[0].source, 'meta_ctwa');
assert.strictEqual(sanjay.source[0].occurred_at, epoch('2026-04-24T07:47:08.418Z'));
assert.ok(sanjay.source.every((entry, index) => index === 0 || toMs(sanjay.source[index - 1].occurred_at) <= toMs(entry.occurred_at)));

const wf3Code = node(wf3, 'Build Full Document').parameters.jsCode;
const dashboardResult = runBuild(wf3Code, {
  'Fetch User Doc': [{
    _id: 'user-2',
    phone: '9879990466',
    updatedAt: '2026-05-04T00:00:00.000Z',
    profileData: { firstName: 'Dashboard', lastName: 'User', status: 'ACTIVE', centers: [] },
  }],
  'Check Status & Extract': [{
    phone10: '9879990466',
    telecrmStage: 'Converted',
    dashStatus: 'ACTIVE',
  }],
  'Load existing new-telecrm': [{}],
  'Aggregate Appointments': [],
  'Find Web Visitor': [{}],
  'Find Touchpoints': [],
  'Find TeleCRM Mirror': [{
    phone: '9879990466',
    fields: { branch: 'Nested branch' },
    lead_source: [
      { source: 'Facebook', date: '2026-05-01T00:00:00.000Z' },
      { source: 'Website', date: '2026-05-02T00:00:00.000Z' },
    ],
    source: [{ value: 'Meta Lead Form', date: '2026-05-01T00:01:00.000Z' }],
    stage: [
      { status: 'Fresh', date: '2026-05-01T00:00:00.000Z' },
      { status: 'In Pipeline', date: '2026-05-03T00:00:00.000Z' },
    ],
    status: 'In Pipeline',
  }],
});
dashboardResult.source.forEach(assertPublicSource);
assert.deepStrictEqual(
  dashboardResult.source.map((entry) => entry.source),
  ['meta_form', 'website'],
  'WF3 keeps each TeleCRM capture, oldest first',
);
assert.deepStrictEqual(
  dashboardResult.stage.filter((entry) => entry.platform === 'telecrm').map((entry) => entry.status),
  ['In Pipeline', 'Fresh'],
  'WF3 stage history must use mirror status, not the dashboard-to-CRM mapping',
);
assert.strictEqual(dashboardResult.stage[0].platform, 'dash');
assert.strictEqual(dashboardResult.stage[0].status, 'ACTIVE');
assert.strictEqual(dashboardResult.stage[0].occurred_at, epoch('2026-05-04T00:00:00.000Z'));

const wf3History = runBuild(wf3Code, {
  'Fetch User Doc': [{
    _id: 'user-1',
    phone: '9392751188',
    updatedAt: '2026-09-11T06:29:17.409Z',
    profileData: { status: 'PACKAGE_EXPIRED', firstName: 'Lalith', lastName: 'Reddy', centers: ['center-1'] },
  }],
  'Check Status & Extract': [{
    phone10: '9392751188',
    dashStatus: 'PACKAGE_EXPIRED',
    telecrmStage: 'Not Converted',
    uid: 'user-1',
    primaryCenterId: 'center-1',
    centerIds: ['center-1'],
    nowIso: '2026-09-11T06:29:17.409Z',
  }],
  'Aggregate Appointments': [],
  'Find Web Visitor': [{}],
  'Find Touchpoints': [{}],
  'Load existing new-telecrm': [{
    phone: '9392751188',
    dash_status: 'BOOKED_WITH_TOKEN',
    conversionStatus: 'Session booked',
    stage: [
      { platform: 'dash', status: 'BOOKED_WITH_TOKEN', occurred_at: '2026-09-11T05:58:48.229Z' },
      { platform: 'telecrm', status: 'Not Shown Up', occurred_at: '2026-05-04T20:31:18.779Z' },
      { platform: 'telecrm', status: 'Fresh', occurred_at: '2026-04-24T11:35:33.418Z' },
    ],
    source: [{ source: 'meta_form', occurred_at: '2026-04-24T11:35:33.418Z' }],
  }],
  'Find TeleCRM Mirror': [{
    phone: '9392751188',
    status: 'Not Shown Up',
    lead_source: 'Facebook',
    stage: [
      { status: 'Not Shown Up', date: '2026-05-04T20:31:18.779Z' },
      { status: 'Fresh', date: '2026-04-24T11:35:33.418Z' },
    ],
  }],
});
assert.deepStrictEqual(
  wf3History.stage.filter((entry) => entry.platform === 'dash').map((entry) => `${entry.status}@${entry.occurred_at}`),
  [
    `PACKAGE_EXPIRED@${epoch('2026-09-11T06:29:17.409Z')}`,
    `BOOKED_WITH_TOKEN@${epoch('2026-09-11T05:58:48.229Z')}`,
  ],
  'WF3 must append PACKAGE_EXPIRED and keep prior BOOKED_WITH_TOKEN',
);
assert.strictEqual(wf3History.stage.length, 4);

const dashHistoryValues = JSON.parse(JSON.stringify(baseValues));
dashHistoryValues['Load Existing Doc'] = [{
  phone: '9879990466',
  stage: [
    { platform: 'dash', status: 'INACTIVE', occurred_at: '2026-04-24T12:00:00.000Z' },
    { platform: 'telecrm', status: 'Not Shown Up', occurred_at: '2026-05-04T20:31:18.779Z' },
    { platform: 'telecrm', status: 'Fresh', occurred_at: '2026-04-24T11:35:33.418Z' },
  ],
}];
dashHistoryValues['Find User'] = [{
  _id: 'user-1',
  updatedAt: '2026-09-11T03:00:00.000Z',
  profileData: { status: 'ACTIVE', firstName: 'Lalith', lastName: 'Reddy', centers: ['center-1'] },
}];
const dashHistory = runBuild(wf1Code, dashHistoryValues);
assert.deepStrictEqual(
  dashHistory.stage.filter((entry) => entry.platform === 'dash').map((entry) => `${entry.status}@${entry.occurred_at}`),
  [`ACTIVE@${epoch('2026-09-11T03:00:00.000Z')}`, `INACTIVE@${epoch('2026-04-24T12:00:00.000Z')}`],
  'WF1 must append dash ACTIVE and keep prior INACTIVE',
);

const dashReturnValues = JSON.parse(JSON.stringify(dashHistoryValues));
dashReturnValues['Load Existing Doc'] = [{
  phone: '9879990466',
  stage: dashHistory.stage,
}];
dashReturnValues['Find User'] = [{
  _id: 'user-1',
  updatedAt: '2026-09-11T03:03:50.681Z',
  profileData: { status: 'INACTIVE', firstName: 'Lalith', lastName: 'Reddy', centers: ['center-1'] },
}];
const dashReturn = runBuild(wf1Code, dashReturnValues);
assert.deepStrictEqual(
  dashReturn.stage.filter((entry) => entry.platform === 'dash').map((entry) => `${entry.status}@${entry.occurred_at}`),
  [
    `INACTIVE@${epoch('2026-09-11T03:03:50.681Z')}`,
    `ACTIVE@${epoch('2026-09-11T03:00:00.000Z')}`,
    `INACTIVE@${epoch('2026-04-24T12:00:00.000Z')}`,
  ],
  'WF1 must append dash INACTIVE when returning from ACTIVE',
);

for (const [wf, build] of [
  [wf1, 'Build Document'],
  [wf3, 'Build Full Document'],
  [wf4, 'Calculate Source Attribution'],
  [main, 'Build Document'],
  [main, 'Build Full Document'],
]) {
  const code = node(wf, build).parameters.jsCode;
  assert(code.includes('item.sequence > best.sequence'), `${wf.name}/${build} must pick newest stage by time/sequence`);
  assert(!code.includes('for (let i = output.length - 1; i >= 0; i--)'), `${wf.name}/${build} must not treat array end as latest stage`);
}

for (const [wf, build, upsert] of [
  [wf1, 'Build Document', 'Upsert Document'],
  [wf3, 'Build Full Document', 'Upsert Document'],
  [main, 'Build Document', 'Upsert Document'],
  [main, 'Build Full Document', 'Upsert Document1'],
]) {
  assert.strictEqual(node(wf, upsert).parameters.fields.split(',').sort().join(','), allowed.filter((key) => key !== 'phone').join(','));
  assert(!node(wf, build).parameters.jsCode.includes('final_source:'), `${wf.name}/${build} must not write final_source`);
}

for (const name of [
  'Upsert Document',
]) {
  assert.deepStrictEqual(node(main, name).parameters, node(wf1, name).parameters, `main/${name} must match workflow 1`);
}
assert.deepStrictEqual(wf1.connections.Webhook.main[0].map((edge) => edge.node), ['Normalize Phone']);
assert(!wf1.nodes.some((item) => item.name === 'Fetch 1000 Users'), 'sync webhook must not fetch 1000 users');
assert(!wf1.nodes.some((item) => item.name === 'Loop Over Phones'), 'sync webhook must not loop phones');
assert.deepStrictEqual(wf1.connections['IF Lead Found'].main[0].map((edge) => edge.node), ['Load Existing Doc']);
assert.deepStrictEqual(wf1.connections['IF Lead Found'].main[1].map((edge) => edge.node), ['Error Response']);
assert.strictEqual(wf1.connections['Error Response'], undefined, 'Error Response must stop the workflow');
assert.deepStrictEqual(wf1.connections['Remove Legacy Root CTWA'].main[0].map((edge) => edge.node), ['Success Response']);
assert.strictEqual(node(wf1, 'Load Existing Doc').parameters.operation, 'aggregate', 'join lookup must use aggregate so n8n returns the existing document');
assert(node(wf1, 'Load Existing Doc').parameters.query.includes('$match'), 'existing join lookup must $match phone variants');
assert(node(wf1, 'Load Existing Doc').parameters.query.includes('$limit'), 'existing join lookup must limit to one document');
assert.strictEqual(node(wf3, 'Load existing new-telecrm').parameters.operation, 'aggregate', 'WF3 join lookup must use aggregate');
assert(node(wf3, 'Load existing new-telecrm').parameters.query.includes('Check Status & Extract'));
assert(node(wf1, 'Build Document').parameters.jsCode.includes('resolveJoinDoc'), 'WF1 must resolve existing join docs from aggregate output');
assert(node(wf3, 'Build Full Document').parameters.jsCode.includes('resolveJoinDoc'), 'WF3 must resolve existing join docs from aggregate output');
const normalizedMainDashboardCode = node(main, 'Build Full Document').parameters.jsCode
  .replaceAll("'Aggregate Appointments1'", "'Aggregate Appointments'")
  .replaceAll("'Find Web Visitor1'", "'Find Web Visitor'")
  .replaceAll("'Find Touchpoints1'", "'Find Touchpoints'");
assert.strictEqual(normalizedMainDashboardCode, node(wf3, 'Build Full Document').parameters.jsCode);
assert(!node(wf1, 'Find User').parameters.query.includes('$regexReplace'));
assert(!node(wf1, 'Find User').parameters.query.includes('.item'), 'Find User must not use paired .item');
assert(!node(wf1, 'Find TeleCRM Mirror History').parameters.query.includes('.item'), 'mirror lookup must not use paired .item');
assert.strictEqual(node(wf1, 'Find TeleCRM Mirror History').parameters.operation, 'findOne', 'mirror lookup must use findOne so n8n returns the telecrm document');
assert(node(wf1, 'Find TeleCRM Mirror History').parameters.query.includes('Normalize Phone'), 'mirror lookup must read phone from Normalize Phone');
assert(node(wf1, 'Load Existing Doc').parameters.query.includes('Normalize Phone'), 'existing join lookup must read phone from Normalize Phone');
assert(!node(wf1, 'Find Web Visitor').parameters.query.includes('.item'), 'Find Web Visitor must not use paired .item');
assert(!node(wf1, 'Build Document').parameters.jsCode.includes('.item'), 'Build Document must not use paired .item');
assert(!node(wf1, 'Find Touchpoints').parameters.query.includes("'$limit': 1"));
assert.strictEqual(node(wf1, 'Find Analytics View').parameters.collection, 'users_analytics_view');
assert.deepStrictEqual(wf1.connections['Find Touchpoints'].main[0].map((edge) => edge.node), ['Find Analytics View']);
assert.deepStrictEqual(wf1.connections['Find Analytics View'].main[0].map((edge) => edge.node), ['Build Document']);
assert.deepStrictEqual(wf1.connections['Build Document'].main[0].map((edge) => edge.node), ['Finalize Recapture Decision']);
assert.deepStrictEqual(wf1.connections['Finalize Recapture Decision'].main[0].map((edge) => edge.node), ['Re-read User Status']);
assert.deepStrictEqual(wf1.connections['Re-read User Status'].main[0].map((edge) => edge.node), ['Apply Fresh User Status']);
assert.deepStrictEqual(wf1.connections['Apply Fresh User Status'].main[0].map((edge) => edge.node), ['Upsert Document']);
assert(node(wf1, 'Apply Fresh User Status').parameters.jsCode.includes("freshStatus === 'LEAD'"), 'WF1 must keep Not Shown Up when the fresh user status is LEAD');
assert(node(wf1, 'Apply Fresh User Status').parameters.jsCode.includes('applyFreshProfile'), 'WF1 must copy the fresh profile name before upsert');
assert(node(wf1, 'Re-read User Status').parameters.query.includes('Normalize Phone'), 'WF1 re-read must use the same phone as Find User');
assert(!node(wf1, 'Finalize Recapture Decision').parameters.jsCode.includes('tagLeadRecapture'), 'WF1 must not write lead_recapture into source');
assert(node(wf1, 'Finalize Recapture Decision').parameters.jsCode.includes("!== 'lead_recapture'"), 'WF1 must drop a stored lead_recapture source');
assert(node(wf1, 'Finalize Recapture Decision').parameters.jsCode.includes('recaptureEvent && convertedFamily'));
assert(node(wf1, 'Finalize Recapture Decision').parameters.jsCode.includes("desiredTelecrmStatus = 'Session booked'"), 'WF1 booked dash stays Session booked');
assert(!node(wf1, 'Finalize Recapture Decision').parameters.jsCode.includes("? 'Session Rescheduled'"), 'WF1 must not keep Session Rescheduled while still booked');
assert(node(wf1, 'Finalize Recapture Decision').parameters.jsCode.includes("desiredTelecrmStatus = 'Not Shown Up'"), 'WF1 Booked → Lead is Not Shown Up');
assert(node(wf1, 'Build Document').parameters.jsCode.includes("new Set(['VISITED'])"), 'WF1 visit flag is VISITED only');
assert(!node(wf1, 'Build Document').parameters.jsCode.includes("'PAID', 'INVOICE_GENERATED', 'VISITED'"), 'WF1 must not treat payment as a visit');
assert(!node(wf3, 'Finalize Status Decision').parameters.jsCode.includes('tagLeadRecapture'), 'WF3 must not write lead_recapture into source');
assert(node(wf3, 'Finalize Status Decision').parameters.jsCode.includes("!== 'lead_recapture'"), 'WF3 must drop a stored lead_recapture source');
assert(node(wf3, 'Finalize Status Decision').parameters.jsCode.includes('recaptureEvent && convertedFamily'));
assert(node(wf1, 'Finalize Recapture Decision').parameters.jsCode.includes('bookedDashStatuses.has(previousDash)'), 'WF1 must map Booked → Lead from the previous dash status');
assert(node(wf1, 'Finalize Recapture Decision').parameters.jsCode.includes('Load Existing Doc'), 'WF1 previous dash status comes from the join row before upsert');
assert(node(wf3, 'Finalize Status Decision').parameters.jsCode.includes('bookedDashStatuses.has(previousDash)'), 'WF3 must map Booked → Lead from the previous dash status');
assert(node(wf3, 'Finalize Status Decision').parameters.jsCode.includes("desiredTelecrmStatus = 'Not Shown Up'"), 'WF3 Booked → Lead is Not Shown Up');
assert(node(wf3, 'Build Full Document').parameters.jsCode.includes("new Set(['VISITED'])"), 'WF3 visit flag is VISITED only');
assert(!node(wf3, 'Build Full Document').parameters.jsCode.includes("'PAID', 'INVOICE_GENERATED', 'VISITED'"), 'WF3 must not treat payment as a visit');
assert(node(wf3, 'Finalize Status Decision').parameters.jsCode.includes('Load existing new-telecrm'), 'WF3 previous dash status comes from the join row before upsert');
assert(node(wf1, 'Aggregate Appointments').parameters.query.includes('rescheduledFrom'), 'WF1 must read reschedule fields');
assert(node(wf3, 'Aggregate Appointments').parameters.query.includes('rescheduledFrom'), 'WF3 must read reschedule fields');
assert.deepStrictEqual(
  wf1.connections['Upsert Document'].main[0].map((edge) => edge.node),
  ['Remove Legacy Root CTWA', 'TeleCRM Status Changed?'],
);
assert.deepStrictEqual(
  wf3.connections['Upsert Document'].main[0].map((edge) => edge.node),
  ['Verify new-telecrm Write'],
  'WF3 must verify the join row after Upsert',
);
assert.strictEqual(node(wf3, 'Upsert Document').parameters.operation, 'findOneAndReplace');
assert.strictEqual(node(wf3, 'Upsert Document').typeVersion, 1.3);
assert.strictEqual(node(wf3, 'Upsert Document').parameters.updateKey, 'phone');
assert.strictEqual(node(wf3, 'Upsert Document').parameters.upsert, true);
assert.deepStrictEqual(
  wf3.connections['Verify new-telecrm Write'].main[0].map((edge) => edge.node),
  ['Require new-telecrm Write'],
  'WF3 must assert the read-after-write result',
);
assert.deepStrictEqual(
  wf3.connections['Require new-telecrm Write'].main[0].map((edge) => edge.node),
  ['Remove Legacy Root CTWA', 'Lead Found in TeleCRM?'],
  'WF3 must branch create vs update only after write verification',
);
assert.deepStrictEqual(
  wf3.connections['Lead Found in TeleCRM?'].main[0].map((edge) => edge.node),
  ['TeleCRM Status Changed?'],
  'WF3 update branch',
);
assert.deepStrictEqual(
  wf3.connections['Lead Found in TeleCRM?'].main[1].map((edge) => edge.node),
  ['Should Create Lead?'],
  'WF3 create branch gate',
);
assert.deepStrictEqual(
  wf3.connections['Should Create Lead?'].main[0].map((edge) => edge.node),
  ['Push Create to TeleCRM'],
);
assert.deepStrictEqual(
  wf3.connections['TeleCRM Status Changed?'].main[0].map((edge) => edge.node),
  ['Push Update to TeleCRM'],
);
assert(node(wf3, 'Finalize Status Decision').parameters.jsCode.includes("telecrm_push_mode = 'update'"));
assert(node(wf3, 'Finalize Status Decision').parameters.jsCode.includes("telecrm_push_mode = 'create'"));
assert(node(wf3, 'Finalize Status Decision').parameters.jsCode.includes('should_create_telecrm'));
assert(
  node(wf3, 'Finalize Status Decision').parameters.jsCode.startsWith("const doc = { ...(($('Build Full Document').first().json) || {}) };"),
  'WF3 Finalize must preserve the built join document and its phone after the profile re-read',
);
assert(
  !node(wf3, 'Finalize Status Decision').parameters.jsCode.startsWith('const doc = { ...($input.first().json || {}) };'),
  'WF3 Finalize must not replace the join document with the projected user profile',
);
assert(node(wf3, 'Finalize Status Decision').parameters.jsCode.includes('should_push_name'), 'WF3 pushes a real name when status did not change');
assert(node(wf3, 'Finalize Status Decision').parameters.jsCode.includes("toLowerCase() === 'lead'"), 'WF3 must not treat the phone-verification placeholder as a person name');
assert(node(wf3, 'Check Status & Extract').parameters.jsCode.includes('nameFieldsChanged'), 'WF3 must notice firstName/lastName updates');
assert(node(wf3, 'Check Status & Extract').parameters.jsCode.includes("hasOwnProperty.call(modified, 'profileData')"), 'WF3 must notice a whole profileData save');
assert(node(wf3, 'Mongo Change Trigger').parameters.operationTypes.includes('replace'), 'WF3 must watch user replace');
assert.strictEqual(node(wf3, 'Mongo Change Trigger').parameters.database, 'stance-dashboard', 'WF3 must watch production stance-dashboard users');
const wf3FetchUserQuery = node(wf3, 'Fetch User Doc').parameters.query;
assert(wf3FetchUserQuery.includes('ev.documentId'), 'WF3 user lookup must accept documentId');
assert(wf3FetchUserQuery.includes('ev.documentKey._id'), 'WF3 user lookup must accept documentKey._id');
assert(wf3FetchUserQuery.includes('ev.fullDocument._id'), 'WF3 user lookup must accept fullDocument._id');
assert(wf3FetchUserQuery.includes("'$toString': '$_id'"), 'WF3 user lookup must match string and ObjectId IDs');
assert.strictEqual(node(wf3, 'Fetch User Doc').onError, undefined, 'WF3 user lookup must not swallow Mongo errors');
assert.deepStrictEqual(
  wf3.connections['Fetch User Doc'].main[0].map((edge) => edge.node),
  ['Require Fetched User'],
  'WF3 must fail loudly when no user is fetched',
);
assert(node(wf3, 'Require Fetched User').parameters.jsCode.includes('Fetch User Doc returned no user'));
assert(node(wf3, 'Verify new-telecrm Write').parameters.query.includes('Finalize Status Decision'));
assert(node(wf3, 'Verify new-telecrm Write').parameters.query.includes('Check Status & Extract'));
assert(node(wf3, 'Verify new-telecrm Write').parameters.query.includes('input.phone'));
assert.strictEqual(node(wf3, 'Verify new-telecrm Write').onError, undefined, 'WF3 write verification must not swallow Mongo errors');
assert(node(wf3, 'Require new-telecrm Write').parameters.jsCode.includes('write verification failed'));
assert(node(wf3, 'Require new-telecrm Write').parameters.jsCode.includes('extracted.phone10'));
for (const name of [
  'Fetch User Doc',
  'Aggregate Appointments',
  'Find Touchpoints',
  'Load existing new-telecrm',
  'Re-read User Profile',
]) {
  assert(!node(wf3, name).parameters.query.includes("'$limit': 0"), `WF3/${name} must use a valid empty-result pipeline`);
}
assert.deepStrictEqual(
  wf3.connections['Build Full Document'].main[0].map((edge) => edge.node),
  ['Re-read User Profile'],
  'WF3 must re-read the user after the slow join',
);
assert.deepStrictEqual(
  wf3.connections['Re-read User Profile'].main[0].map((edge) => edge.node),
  ['Finalize Status Decision'],
);
assert(node(wf3, 'Re-read User Profile').parameters.query.includes('dash_patient_id'), 'WF3 profile re-read uses the joined patient id');
assert(node(wf3, 'Finalize Status Decision').parameters.jsCode.includes('applyFreshProfile'), 'WF3 must apply the fresh profile before upsert');
assert(
  node(wf3, 'Push Update to TeleCRM').parameters.jsonBody.includes('should_push_name'),
  'name-only push must keep the current TeleCRM status',
);
assert(
  node(wf3, 'TeleCRM Status Changed?').parameters.conditions.conditions[0].leftValue.includes('should_push_name'),
  'update branch must run for a name push',
);
assert.strictEqual(wf1.connections['Success Response'], undefined, 'Success Response must not continue the workflow');

assert(!wf4.nodes.some((item) => item.name === 'Update crm_sync_materialized'));
assert(!wf4.nodes.some((item) => item.name === 'Push Source to TeleCRM'));
assert.strictEqual(node(wf4, 'Update Canonical Source').parameters.fields, 'source,stage');
assert.strictEqual(node(wf4, 'Update Canonical Source').parameters.upsert, true);
assert(node(wf4, 'Load TeleCRM Leads').parameters.query.includes('users_analytics_view'));
assert(node(wf4, 'Load TeleCRM Leads').parameters.query.includes('user_category'));
assert(!node(wf4, 'Load TeleCRM Leads').parameters.query.includes('web_touchpoints'));
const sourceUpdaterResult = new Function('$', '$input', node(wf4, 'Calculate Source Attribution').parameters.jsCode)(
  null,
  {
    all: () => [{
      json: {
        phone: '919879990466',
        lead_source: [{ source: 'Whatsapp Cloud API', date: '2026-04-01T00:00:00.000Z' }],
        telecrm_source: [{ value: 'ctwa', date: '2026-04-01T00:01:00.000Z' }],
        telecrm_stage: [
          { status: 'Fresh', date: '2026-04-01T00:00:00.000Z' },
          { status: 'Not Converted', date: '2026-04-02T00:00:00.000Z' },
        ],
        telecrm_status: 'Not Converted',
        ctwa_id: 'ctwa-new',
        existing_final_source: [{ source: 'website', tele_leadsource: 'Website' }],
        existing_stage: [{ platform: 'telecrm', status: 'Fresh' }],
      },
    }],
  },
)[0].json;
assert.strictEqual(sourceUpdaterResult.phone, '9879990466');
assert.ok(sourceUpdaterResult.source.length >= 1, 'source history stores the TeleCRM capture');
assert.strictEqual(sourceUpdaterResult.source[0].source, 'meta_ctwa');
const ctwaEvent = sourceUpdaterResult.source.find((entry) => entry.source === 'meta_ctwa');
assertPublicSource(ctwaEvent);
assert.strictEqual(ctwaEvent.ctwa_id, 'ctwa-new');
assert.strictEqual(sourceUpdaterResult.source[0], ctwaEvent, 'TeleCRM capture source is the only source');
assert.strictEqual(sourceUpdaterResult.source.filter((entry) => entry.source === 'website').length, 0);

function runSourceUpdater(lead) {
  return new Function('$', '$input', node(wf4, 'Calculate Source Attribution').parameters.jsCode)(
    null,
    { all: () => [{ json: lead }] },
  )[0].json;
}

function classifiedSource(input) {
  const result = runSourceUpdater({
    phone: '9879990466',
    ...input,
  });
  return result.source[0] ? result.source[0].source : null;
}

const sourceCases = [
  [{ user_category: 'ORGANIC' }, 'dash_organic'],
  [{ user_category: 'Advertisement' }, 'dash_performance'],
  [{ user_category: 'REFERRAL' }, 'dash_customer'],
  [{ user_category: 'ADVOCATE' }, 'dash_advocate'],
  [{ user_category: 'DOCTOR' }, 'dash_consultant'],
  [{ user_category: 'WEBSITE' }, 'website_organic'],
  [{ user_category: 'WEBSITE', web_analytics: { utmSource: null } }, 'website_organic'],
  [{ user_category: 'WEBSITE', web_analytics: { utmSource: 'google', utmMedium: 'cpc' } }, 'website'],
  [{ user_category: 'website', web_analytics: { referrer: 'https://www.google.com/search?q=stance' } }, 'website_organic'],
  [{ telecrm_source: [{ value: 'Performance' }] }, null],
  [{ telecrm_source: [{ value: 'organic' }] }, null],
  [{ telecrm_source: [{ value: 'Clinician' }] }, null],
  [{ telecrm_source: [{ value: 'FOUNDER' }] }, null],
  [{ lead_source: 'Website' }, 'website'],
  [{ lead_source: 'App' }, null],
  [{ lead_source: 'Facebook' }, 'meta_form'],
  [{ lead_source: 'Excel' }, 'Manual'],
  [{ lead_source: 'manual' }, 'Manual'],
  [{ lead_source: 'Whatsapp Cloud API' }, 'meta_ctwa'],
  [{ web_analytics: { utmSource: 'google', utmMedium: null } }, 'google_organic'],
  [{ web_analytics: { utmSource: 'google', utmMedium: 'CPC' } }, 'google_cpc'],
  [{ web_analytics: { utmSource: 'GMB' } }, 'google_gmb'],
  [{ web_analytics: { utmSource: 'app' } }, 'app'],
  [{ web_analytics: { utmSource: 'stance_app' } }, 'app'],
  [{ web_analytics: { utmSource: 'healthflex_app' } }, 'app'],
  [{ web_analytics: { utmSource: 'Interakt WACA' } }, 'interakt'],
  [{ web_analytics: { utmSource: 'ig', utmMedium: null } }, 'instagram_organic'],
  [{ web_analytics: { utmSource: 'insta', utmMedium: 'paid_social' } }, 'instagram_paid'],
  [{ web_analytics: { utmSource: 'instagram', utmMedium: 'referral' } }, 'instagram_other'],
  [{ web_analytics: { utmSource: 'chatgpt.com' } }, 'chatgpt'],
  [{ web_analytics: { utmSource: 'facebook', utmMedium: 'paid_social' } }, 'meta_paid'],
  [{ web_analytics: { utmSource: 'meta', utmMedium: 'referral' } }, 'meta_other'],
  [{ web_analytics: { utmSource: 'wesbite' } }, 'website'],
  [{ web_analytics: { utmSource: 'unknown-network' } }, null],
  [{ web_analytics: { utmMedium: 'WA' } }, 'Tele_WACA'],
];
for (const [input, expected] of sourceCases) {
  assert.strictEqual(classifiedSource(input), expected, JSON.stringify(input));
}
assert.strictEqual(
  classifiedSource({ web_analytics: { referrer: 'https://www.google.com/search?q=stance' } }),
  'google_organic',
);
assert.strictEqual(
  classifiedSource({
    user_category: 'Advertisement',
    lead_source: 'Facebook',
    telecrm_source: [{ value: 'performance' }],
    web_analytics: { utmSource: 'google', utmMedium: 'cpc' },
  }),
  'dash_performance',
  'Dashboard category must beat TeleCRM lead_source and analytics UTM',
);
assert.strictEqual(
  classifiedSource({
    lead_source: 'Facebook',
    web_analytics: { utmSource: 'google', utmMedium: 'cpc' },
  }),
  'meta_form',
  'TeleCRM lead_source must beat analytics when category is absent',
);
assert.strictEqual(
  classifiedSource({
    lead_source: 'App',
    web_analytics: { utmSource: 'meta', utmMedium: 'paid_social' },
  }),
  'meta_paid',
  'App lead_source must not classify; analytics UTM wins that bucket',
);

const facebookResync = runSourceUpdater({
  phone: '9392751188',
  lead_source: 'Facebook',
  created_at: 1777030533418,
  telecrm_source: [{
    source: 'Facebook',
    status: 'Not Shown Up',
    date: '2026-05-04T20:31:18.779Z',
    ad: 'Tailored leads campaign -1 –3 – Copy',
    campaign: 'SH_TOF_LeadGen_27112025_LAL',
    lead_id: '1291984475621543',
    ad_set_name: 'SH_TOF_LeadGen_27112025_LAL',
    ad_set_id: '120238030923080460',
  }],
  telecrm_stage: [
    { status: 'Fresh', date: '2026-04-24T11:35:33.418000Z' },
    { status: 'Not Shown Up', date: '2026-05-04T20:31:18.779Z' },
  ],
  telecrm_status: 'Not Shown Up',
});
const facebookEvents = facebookResync.source.filter((entry) => entry.source === 'meta_form');
assert.strictEqual(facebookEvents.length, 1, 'Facebook form metadata must stay on the original intake event');
assertPublicSource(facebookEvents[0]);
assert.strictEqual(facebookEvents[0].occurred_at, epoch('2026-04-24T11:35:33.418Z'));
assert.strictEqual(facebookEvents[0].campaign_name, 'SH_TOF_LeadGen_27112025_LAL');
assert.strictEqual(facebookEvents[0].lead_id, '1291984475621543');
assert.strictEqual(facebookEvents[0].ad_name, 'Tailored leads campaign -1 –3 – Copy');
assert.strictEqual(facebookEvents[0].ad_set_id, '120238030923080460');
assert.strictEqual(facebookEvents[0].ad_set_name, 'SH_TOF_LeadGen_27112025_LAL');
assert.strictEqual(
  facebookResync.source.filter((entry) => entry.source === 'meta_form').length,
  1,
  'Facebook lead_source and source[] must not be stored as two events',
);
assert.deepStrictEqual(
  facebookResync.stage.map((entry) => entry.status),
  ['Not Shown Up', 'Fresh'],
  'TeleCRM stage history must keep Fresh and Not Shown Up',
);
assert.strictEqual(facebookResync.stage[0].occurred_at, epoch('2026-05-04T20:31:18.779Z'));
assert.strictEqual(facebookResync.stage[1].occurred_at, epoch('2026-04-24T11:35:33.418Z'));

const healedExisting = runSourceUpdater({
  phone: '9392751188',
  lead_source: 'Facebook',
  created_at: 1777030533418,
  telecrm_source: [{
    source: 'Facebook',
    date: '2026-05-04T20:31:18.779Z',
    campaign: 'SH_TOF_LeadGen_27112025_LAL',
    lead_id: '1291984475621543',
    ad: 'Tailored leads campaign -1 –3 – Copy',
    ad_set_id: '120238030923080460',
    ad_set_name: 'SH_TOF_LeadGen_27112025_LAL',
  }],
  existing_source: [
    {
      source: 'meta_form',
      origin: 'telecrm_source',
      occurred_at: '2026-05-04T20:31:18.779Z',
      tele_leadsource: 'Facebook',
      campaign_name: 'SH_TOF_LeadGen_27112025_LAL',
      lead_id: '1291984475621543',
      ad_name: 'Tailored leads campaign -1 –3 – Copy',
      ad_set_id: '120238030923080460',
      ad_set_name: 'SH_TOF_LeadGen_27112025_LAL',
    },
    {
      source: 'meta_form',
      origin: 'telecrm_lead_source',
      occurred_at: '2026-04-24T11:35:33.418Z',
      tele_leadsource: 'Facebook',
    },
  ],
});
assert.strictEqual(healedExisting.source.filter((entry) => entry.source === 'meta_form').length, 1);
assert.strictEqual(healedExisting.source[0].occurred_at, epoch('2026-04-24T11:35:33.418Z'));
assert.strictEqual(healedExisting.source[0].campaign_name, 'SH_TOF_LeadGen_27112025_LAL');

const laterBucket = runSourceUpdater({
  phone: '9392751188',
  lead_source: 'Facebook',
  created_at: 1777030533418,
  telecrm_source: [
    {
      source: 'Facebook',
      date: '2026-04-24T11:35:33.418Z',
      campaign: 'SH_TOF_LeadGen_27112025_LAL',
      lead_id: '1291984475621543',
    },
    { value: 'Performance', date: '2026-05-04T20:31:18.779Z' },
  ],
});
assert.strictEqual(laterBucket.source.filter((entry) => entry.source === 'meta_form').length, 1);
assert.strictEqual(laterBucket.source[0].source, 'meta_form', 'TeleCRM Performance bucket must not become dash_performance');
assert.strictEqual(laterBucket.source.filter((entry) => entry.source === 'dash_performance').length, 0);
assertPublicSource(laterBucket.source.filter((entry) => entry.source === 'meta_form')[0]);
const categoryWins = runSourceUpdater({
  phone: '9392751188',
  user_category: 'ORGANIC',
  lead_source: 'Facebook',
  created_at: 1777030533418,
  telecrm_source: [
    {
      source: 'Facebook',
      date: '2026-04-24T11:35:33.418Z',
      campaign: 'SH_TOF_LeadGen_27112025_LAL',
      lead_id: '1291984475621543',
    },
    { value: 'Performance', date: '2026-05-04T20:31:18.779Z' },
  ],
  web_analytics: { utmSource: 'google', utmMedium: 'cpc' },
});
const organicCapture = runSourceUpdater({
  phone: '9098765456',
  user_category: 'ORGANIC',
  user_createdAt: '2026-10-01T08:33:06.856Z',
  lead_source: 'Website',
  created_at: '2026-10-01T08:33:08.596Z',
  web_analytics: { referrer: 'https://stance.health/book', utmSource: null },
  existing_source: [
    { source: 'dash_organic', occurred_at: '2026-10-01T08:33:06.856Z' },
    { source: 'website', occurred_at: '2026-10-01T08:33:08.596Z' },
    { source: 'others', occurred_at: '2026-10-01T08:33:16.617Z' },
    { source: 'others', occurred_at: '2026-10-01T08:33:46.559Z' },
    { source: 'lead_recapture', occurred_at: '2026-10-01T08:38:12.346Z' },
  ],
});
assert.deepStrictEqual(
  organicCapture.source.map((entry) => entry.source),
  ['dash_organic', 'website'],
  'dashboard category and the TeleCRM capture are kept oldest-first',
);
assert.deepStrictEqual(
  categoryWins.source.map((entry) => entry.source),
  ['meta_form', 'dash_organic'],
  'earliest TeleCRM capture is source[0], then the later dashboard category',
);
assertPublicSource(categoryWins.source[0]);
assert(!categoryWins.source.some((entry) => entry.source === 'google_cpc'));
assert(!categoryWins.source.some((entry) => entry.source === 'lead_recapture'));
assert(!categoryWins.source.some((entry) => entry.source === 'others'));
assert.deepStrictEqual(
  sourceUpdaterResult.stage.map((entry) => entry.status),
  ['Not Converted', 'Fresh'],
);
assert(!Object.prototype.hasOwnProperty.call(sourceUpdaterResult, 'final_source'));
assert.deepStrictEqual(
  wf4.connections['Calculate Source Attribution'].main[0].map((edge) => edge.node),
  ['Source Available?'],
  'workflow 4 import must connect Calculate Source Attribution to the IF node',
);
assert(
  wf4.connections['Update Canonical Source'].main[0].some((edge) => edge.node === 'Enforce Canonical Schema'),
  'workflow 4 cleanup must run after the canonical source write',
);
assert(!wf4.connections['Calculate Source Attribution'].main[0].some((edge) => edge.node === 'Enforce Canonical Schema'));
assert.strictEqual(wf4.active, false, 'source attribution export must stay inactive until credentials are attached');
assert.strictEqual(migration.active, false, 'migration must remain inactive');
assert.strictEqual(node(migration, 'Manual Trigger Only').type, 'n8n-nodes-base.manualTrigger');
assert(node(migration, 'Project Canonical Schema').parameters.query.includes('"$merge"'));
assert(node(migration, 'Project Canonical Schema').parameters.query.includes('"campaign_id"'));
assert(node(migration, 'Project Canonical Schema').parameters.query.includes('"occurred_at"'));
assert(node(migration, 'Project Canonical Schema').parameters.query.includes('"$toLong"'), 'migration must store timestamps as epoch milliseconds');
assert(node(migration, 'Project Canonical Schema').parameters.query.includes('"temperature"'));
assert(node(migration, 'Project Canonical Schema').parameters.query.includes('dash_firstVisitAppointments'));

const webhookJs = fs.readFileSync(path.join(root, 'new-telecrm-webhook.js'), 'utf8');
const stripOrigin = "key === 'origin' || key === 'tele_source' || key === 'tele_leadsource'";
assert(webhookJs.includes(stripOrigin), 'webhook must strip origin/tele_source/tele_leadsource before write');
assert(webhookJs.includes('omitEmpty'), 'webhook must omit empty join keys');
assert(webhookJs.includes('last_synced_at'), 'webhook must write last_synced_at');
assert(webhookJs.includes('Captured On'), 'webhook must map TeleCRM Captured On');
assert(webhookJs.includes('telecrm_connected_calls'), 'webhook must store connected call count');
assert(webhookJs.includes('# Calls Count'), 'webhook must read hashed Calls Count alias');
assert(webhookJs.includes('pickActivityCount'), 'webhook must pick live activity counts over the mirror');
assert(node(wf1, 'Build Document').parameters.jsCode.includes('Captured On'), 'WF1 must map TeleCRM Captured On');
assert(node(wf1, 'Build Document').parameters.jsCode.includes('telecrm_connected_calls'), 'WF1 must store connected call count');
assert(node(wf1, 'Build Document').parameters.jsCode.includes('flattenLeadActivity'), 'WF1 must copy root activity fields onto fields');
assert(node(wf1, 'Build Document').parameters.jsCode.includes('# Calls Count'), 'WF1 must read hashed Calls Count alias');
assert(node(wf3, 'Build Full Document').parameters.jsCode.includes('Captured On'), 'WF3 must map TeleCRM Captured On');
assert(node(wf3, 'Build Full Document').parameters.jsCode.includes('pickActivityCount'), 'WF3 must preserve live call/message counts');
assert(!webhookJs.includes('dash_firstVisitAppointments'), 'webhook must not store dash_firstVisitAppointments');
assert(node(wf3, 'Build Full Document').parameters.jsCode.includes(stripOrigin), 'WF3 must strip origin fields before write');
assert(node(main, 'Build Document').parameters.jsCode.includes(stripOrigin), 'main Build Document must strip origin fields');
assert(node(main, 'Build Full Document').parameters.jsCode.includes(stripOrigin), 'main Build Full Document must strip origin fields');
assert(node(wf1, 'Build Document').parameters.jsCode.includes(stripOrigin), 'sync Build Document must strip origin fields');
assert(node(wf4, 'Calculate Source Attribution').parameters.jsCode.includes(stripOrigin), 'WF4 must strip origin fields');

const canonicalCleanupNodes = [
  node(wf1, 'Remove Legacy Root CTWA'),
  node(wf3, 'Remove Legacy Root CTWA'),
  node(wf4, 'Enforce Canonical Schema'),
  node(main, 'Remove Legacy Root CTWA'),
  node(main, 'Remove Legacy Root CTWA1'),
];
for (const item of canonicalCleanupNodes) {
  const query = item.parameters.query;
  assert(query.includes('$$REMOVE'), `${item.name} must remove null temperature fields`);
  for (const key of temperatureKeys) {
    assert(query.includes(key), `${item.name} cleanup must handle ${key}`);
  }
}

const realtimeTempUpdate = node(wfTemp, 'Update new-telecrm');
const nightlyTempUpdate = node(wfTemp, 'Update new-telecrm (Nightly)');
const realtimeTempSearch = node(wfTemp, 'TeleCRM Search (Realtime)');
const nightlyTempSearch = node(wfTemp, 'TeleCRM Search');
assert.strictEqual(realtimeTempSearch.type, 'n8n-nodes-base.httpRequest');
assert.strictEqual(realtimeTempSearch.parameters.url, nightlyTempSearch.parameters.url);
assert.strictEqual(realtimeTempSearch.parameters.jsonBody, nightlyTempSearch.parameters.jsonBody);
assert.deepStrictEqual(
  wfTemp.connections['Extract Phone'].main[0].map((edge) => edge.node),
  ['TeleCRM Search (Realtime)'],
);
assert.deepStrictEqual(
  wfTemp.connections['TeleCRM Search (Realtime)'].main[0].map((edge) => edge.node),
  ['Calculate Temperature'],
);
assert(node(wfTemp, 'Load TeleCRM Leads').parameters.collection === 'new-telecrm', 'nightly scorer must iterate new-telecrm');
assert(node(wfTemp, 'Load TeleCRM Leads').parameters.query.includes('conversionStatus'));
assert(node(wfTemp, 'Update new-telecrm').parameters.query.includes('should_clear_temperature'));
assert(node(wfTemp, 'Update new-telecrm (Nightly)').parameters.query.includes('should_clear_temperature'));
assert(node(wf3, 'Push Update to TeleCRM').parameters.jsonBody.includes('dashboard_field'));
assert(node(wf3, 'Push Update to TeleCRM').parameters.jsonBody.includes('dash_email'));
assert(node(wf3, 'Push Create to TeleCRM').parameters.jsonBody.includes('telecrm_push_phone'));
assert(node(wf3, 'Push Create to TeleCRM').parameters.jsonBody.includes('conversionStatus'));
assert.strictEqual(realtimeTempUpdate.parameters.operation, 'aggregate', 'realtime temperature write must unset leftover fields');
assert.strictEqual(nightlyTempUpdate.parameters.operation, 'aggregate');
for (const item of [realtimeTempUpdate, nightlyTempUpdate]) {
  const query = item.parameters.query;
  assert(query.includes("$unset"), `${item.name} must $unset legacy temperature keys`);
  assert(query.includes('temperature_outcome'), `${item.name} must drop temperature_outcome`);
  assert(query.includes('temperature_rule'), `${item.name} must drop temperature_rule`);
  assert(!query.includes('temperature_outcome: $json'), `${item.name} must not $set temperature_outcome`);
  assert(!query.includes('temperature_rule: $json'), `${item.name} must not $set temperature_rule`);
}
const realtimeCalc = node(wfTemp, 'Calculate Temperature').parameters.jsCode;
const nightlyCalc = node(wfTemp, 'Calculate Temperature (Nightly)').parameters.jsCode;
assert.strictEqual(realtimeCalc, nightlyCalc, 'realtime and nightly must use the same three-question scorer');
assert(!realtimeCalc.includes("temperature_outcome:"), 'realtime scorer must not emit temperature_outcome');
assert(!realtimeCalc.includes("temperature_rule:"), 'realtime scorer must not emit temperature_rule');
assert(!nightlyCalc.includes("temperature_outcome:"), 'nightly scorer must not emit temperature_outcome');
assert(!nightlyCalc.includes("temperature_rule:"), 'nightly scorer must not emit temperature_rule');

function runTemperatureCalculator(lead) {
  return new Function('$input', realtimeCalc)({
    all: () => [{ json: { data: [lead] } }],
  })[0].json;
}
const now = Date.now();
const daysAgo = (days) => new Date(now - days * 86400000).toISOString();
const oneCorrect = runTemperatureCalculator({
  status: 'Fresh',
  fields: {
    phone: '9879990466',
    'Captured On': daysAgo(5),
    'Calls Count': 0,
    'Connected Call Count': 0,
  },
});
assert.strictEqual(oneCorrect.temperature, 'WARM', 'one correct answer must be WARM');
const twoCorrect = runTemperatureCalculator({
  status: 'In Pipeline',
  fields: {
    phone: '9879990466',
    'Captured On': daysAgo(30),
    'Last Incoming WhatsApp On': daysAgo(2),
    'Last Call': daysAgo(2),
    'Calls Count': 3,
    'Connected Call Count': 2,
  },
});
assert.strictEqual(twoCorrect.temperature, 'HOT', 'two correct answers must be HOT');
assert.deepStrictEqual(
  Object.keys(twoCorrect.temperature_derived).sort(),
  ['attempts', 'connected', 'd_call', 'd_captured', 'd_inbound'],
);
const deadLead = runTemperatureCalculator({
  status: 'Fresh',
  fields: {
    phone: '9879990466',
    'Captured On': daysAgo(1),
    'Calls Count': 7,
    'Connected Call Count': 0,
  },
});
assert.strictEqual(deadLead.temperature, 'COLD', 'DEAD override must beat question score');
const convertedLead = runTemperatureCalculator({
  status: 'Converted',
  fields: { phone: '9879990466', 'Captured On': daysAgo(1) },
});
assert.strictEqual(convertedLead.should_write_temperature, false, 'Converted leads must skip writes');
assert.strictEqual(convertedLead.should_clear_temperature, true, 'Converted leads must unset stored temperature');

console.log('Canonical schema validation PASS');
