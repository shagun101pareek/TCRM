'use strict';

const assert = require('assert');
const { attributeLead } = require('./attribute-lead');
const { scoreSearchBody } = require('./score-temperature');
const {
  sourceLoadPipeline,
  sourceWritePipeline,
  temperatureLoadPipeline,
  temperatureWritePipeline,
} = require('./pipelines');

function check(name, fn) {
  fn();
  console.log('PASS', name);
}

check('attribute a facebook lead', () => {
  const result = attributeLead({
    phone: '9876543210',
    lead_source: 'Facebook',
    source: [{ value: 'Facebook' }],
    status: 'Fresh',
    created_at: '2026-01-01T00:00:00.000Z',
    existing_source: [],
    existing_final_source: [],
    existing_stage: [],
  });
  assert.equal(result.phone, '9876543210');
  assert.equal(result.should_write_source, true);
  assert.ok(result.source.some((row) => row.source === 'meta_form'));
});

check('attribute skips a short phone', () => {
  assert.equal(attributeLead({ phone: '123' }), null);
});

check('temperature hot keeps the current status', () => {
  const now = Date.now();
  const scored = scoreSearchBody({
    data: [{
      phone: '919876543210',
      status: 'Fresh',
      fields: {
        'Captured On': new Date(now).toISOString(),
        'Calls Count': 1,
        'Connected Call Count': 2,
        'Last Call': new Date(now).toISOString(),
        'Last Incoming WhatsApp On': new Date(now).toISOString(),
      },
    }],
  }, now);
  assert.equal(scored.temperature, 'HOT');
  assert.equal(scored.telecrm_temperature, 'hot');
  assert.equal(scored.current_status, 'Fresh');
  assert.equal(scored.telecrm_phone, '919876543210');
  assert.equal(scored.should_write_temperature, true);
});

check('converted and not converted are not scored', () => {
  const now = Date.now();
  for (const status of ['Converted', 'Not Converted', 'converted', 'NOT CONVERTED']) {
    const scored = scoreSearchBody({
      data: [{
        phone: '919876543210',
        status,
        fields: {
          'Captured On': new Date(now).toISOString(),
          'Calls Count': 8,
          'Connected Call Count': 2,
          'Last Call': new Date(now).toISOString(),
          'Last Incoming WhatsApp On': new Date(now).toISOString(),
        },
      }],
    }, now);
    assert.equal(scored.temperature, null);
    assert.equal(scored.should_write_temperature, false);
    assert.equal(scored.telecrm_temperature, null);
    assert.equal(scored.current_status, status);
  }
});

check('six calls and zero connects is cold', () => {
  const scored = scoreSearchBody({
    data: [{
      phone: '919876543210',
      status: 'No Response',
      fields: { 'Calls Count': 8, 'Connected Call Count': 0 },
    }],
  });
  assert.equal(scored.temperature, 'COLD');
  assert.equal(scored.current_status, 'No Response');
});

check('source page is limited before the lookups', () => {
  const pipe = sourceLoadPipeline('a'.repeat(24), 25);
  assert.deepEqual(pipe.slice(0, 3).map((stage) => Object.keys(stage)[0]), ['$match', '$sort', '$limit']);
  assert.equal(pipe[2].$limit, 25);
  const lookupAt = pipe.findIndex((stage) => stage.$lookup);
  assert.ok(lookupAt > 2);
  const project = pipe.find((stage) => stage.$project && stage.$project.phone);
  assert.notEqual(project.$project._id, 0);
  assert.ok(pipe[0].$match._id.$gt);
  assert.ok(project.$project.web_touchpoints);
  assert.ok(pipe.some((stage) => stage.$lookup && stage.$lookup.from === 'web_touchpoints'));
});

check('website category with google cpc stays google_cpc at source zero', () => {
  const result = attributeLead({
    phone: '9876543210',
    user_category: 'WEBSITE',
    user_createdAt: '2026-01-02T00:00:00.000Z',
    web_analytics: { utmSource: 'google', utmMedium: 'cpc', gclid: 'gclid-1', firstTouchAt: '2026-01-01T00:00:00.000Z' },
    lead_source: 'Website',
    existing_source: [],
    existing_final_source: [],
    existing_stage: [],
  });
  assert.equal(result.source[0].source, 'google_cpc');
  assert.equal(result.source[0].occurred_at, '2026-01-01T00:00:00.000Z');
  assert.ok(!Object.prototype.hasOwnProperty.call(result.source[0], 'utmSource'));
  assert.equal(result.source[0].utmMedium, 'cpc');
  assert.equal(result.source[0].gclid, 'gclid-1');
  assert.equal(result.source[0].firstTouchAt, '2026-01-01T00:00:00.000Z');
  assert.ok(!Object.prototype.hasOwnProperty.call(result.source[0], 'utm_source'));
  assert.ok(!Object.prototype.hasOwnProperty.call(result.source[0], 'utm_medium'));
  assert.ok(!Object.prototype.hasOwnProperty.call(result.source[0], 'campaign_name'));
  assert.ok(!result.source.some((row) => row.source === 'website' || row.source === 'website_organic'));
});

check('web analytics fields keep their own names on the source row', () => {
  const result = attributeLead({
    phone: '9876543210',
    web_analytics: {
      totalTouchpoints: 5,
      totalSessions: 2,
      anonymousId: 'anon-1',
      firstTouchAt: '2026-01-01T00:00:00.000Z',
      lastTouchAt: '2026-01-02T00:00:00.000Z',
      landingPage: 'https://stance.health/book',
      bookingUrl: 'https://stance.health/book',
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'gmb-campaign',
      utmAdgroup: 'gmb-adgroup',
      gclid: 'gclid-1',
      referrer: 'https://www.google.com/',
      fbp: 'fb.1.123',
      utmContent: 'content-1',
      utmTerm: 'term-1',
      fbc: 'fb.1.456',
      utmReferer: 'google',
    },
    existing_source: [],
    existing_final_source: [],
    existing_stage: [],
  });
  const row = result.source[0];
  assert.equal(row.source, 'google_cpc');
  assert.equal(row.totalTouchpoints, 5);
  assert.equal(row.totalSessions, 2);
  assert.equal(row.anonymousId, 'anon-1');
  assert.equal(row.firstTouchAt, '2026-01-01T00:00:00.000Z');
  assert.equal(row.lastTouchAt, '2026-01-02T00:00:00.000Z');
  assert.equal(row.landingPage, 'https://stance.health/book');
  assert.equal(row.bookingUrl, 'https://stance.health/book');
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'utmSource'));
  assert.equal(row.utmMedium, 'cpc');
  assert.equal(row.utmCampaign, 'gmb-campaign');
  assert.equal(row.utmAdgroup, 'gmb-adgroup');
  assert.equal(row.gclid, 'gclid-1');
  assert.equal(row.referrer, 'https://www.google.com/');
  assert.equal(row.fbp, 'fb.1.123');
  assert.equal(row.utmContent, 'content-1');
  assert.equal(row.utmTerm, 'term-1');
  assert.equal(row.fbc, 'fb.1.456');
  assert.equal(row.utmReferer, 'google');
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'utm_source'));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'utm_campaign'));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'campaign_name'));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'ad_set_name'));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'ad_name'));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'landing_page'));
});

check('facebook source rows do not receive web analytics fields', () => {
  const result = attributeLead({
    phone: '9876543210',
    lead_source: [{ source: 'Facebook', date: '2026-03-01T00:00:00.000Z', campaign: 'FB Campaign' }],
    source: [{ value: 'Meta Lead Form' }],
    created_at: '2026-03-01T00:00:00.000Z',
    web_analytics: {
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'Website Campaign',
      firstTouchAt: '2026-01-01T00:00:00.000Z',
    },
    existing_source: [],
    existing_final_source: [],
    existing_stage: [],
  });
  const meta = result.source.find((row) => row.source === 'meta_form');
  const web = result.source.find((row) => row.source === 'google_cpc');
  assert.ok(meta && web);
  assert.equal(meta.campaign_name, 'FB Campaign');
  assert.ok(!Object.prototype.hasOwnProperty.call(meta, 'utmSource'));
  assert.ok(!Object.prototype.hasOwnProperty.call(meta, 'utmCampaign'));
  assert.equal(web.source, 'google_cpc');
  assert.ok(!Object.prototype.hasOwnProperty.call(web, 'utmSource'));
  assert.equal(web.utmCampaign, 'Website Campaign');
});

check('website category with no analytics is website_organic', () => {
  const result = attributeLead({
    phone: '9876543210',
    user_category: 'WEBSITE',
    user_createdAt: '2026-01-01T00:00:00.000Z',
    web_analytics: {},
    existing_source: [],
    existing_final_source: [],
    existing_stage: [],
  });
  assert.deepEqual(result.source.map((row) => row.source), ['website_organic']);
});

check('telecrm dropdown performance is dash_performance and dashboard category is not', () => {
  const fromDropdown = attributeLead({
    phone: '9876543210',
    source: [{ value: 'Performance', date: '2026-01-01T00:00:00.000Z' }],
    existing_source: [],
    existing_final_source: [],
    existing_stage: [],
  });
  assert.equal(fromDropdown.source[0].source, 'dash_performance');
  const fromCategory = attributeLead({
    phone: '9876543210',
    user_category: 'ORGANIC',
    existing_source: [],
    existing_final_source: [],
    existing_stage: [],
  });
  assert.equal(fromCategory.source.length, 0);
});

check('the same source stays one row across later visits', () => {
  const result = attributeLead({
    phone: '9876543210',
    web_analytics: { utmSource: 'google', utmMedium: 'cpc', firstTouchAt: '2026-01-01T00:00:00.000Z' },
    web_touchpoints: [
      { utm_source: 'google', utm_medium: 'cpc', ts: '2026-01-01T02:00:00.000Z' },
      { utm_source: 'google', utm_medium: 'cpc', ts: '2026-01-03T03:00:00.000Z' },
      { utm_source: '', utm_medium: '', ts: '2026-02-01T00:00:00.000Z' },
    ],
    existing_source: [],
    existing_final_source: [],
    existing_stage: [],
  });
  assert.deepEqual(result.source.map((row) => row.source), ['google_cpc']);
  assert.equal(result.source[0].occurred_at, '2026-01-01T00:00:00.000Z');
  assert.ok(!Object.prototype.hasOwnProperty.call(result.source[0], 'utmSource'));
  assert.equal(result.source[0].utmMedium, 'cpc');
  assert.ok(!result.source.some((row) => row.source === 'lead_recapture'));
});

check('source write replaces the join document', () => {
  const pipe = sourceWritePipeline('9876543210', [{ source: 'meta_form' }], []);
  assert.equal(pipe[1].$set.source[0].source, 'meta_form');
  assert.equal(pipe[pipe.length - 1].$merge.into, 'new-telecrm');
  assert.equal(pipe[pipe.length - 1].$merge.whenMatched, 'replace');
});

check('temperature page skips converted leads', () => {
  const pipe = temperatureLoadPipeline(null, 10);
  assert.equal(pipe[2].$limit, 10);
  assert.deepEqual(pipe[0].$match.conversionStatus.$nin, ['Converted', 'Not Converted']);
});

check('temperature write replaces and keeps the score', () => {
  const pipe = temperatureWritePipeline({
    phone: '9876543210',
    should_write_temperature: true,
    should_clear_temperature: false,
    temperature: 'HOT',
    calculated_at: '2026-10-14T00:00:00.000Z',
    temperature_derived: { attempts: 1, connected: 2, d_captured: 1, d_inbound: 1, d_call: 0 },
  });
  assert.equal(pipe[1].$set.temperature, 'HOT');
  assert.equal(pipe[pipe.length - 1].$merge.whenMatched, 'replace');
});

console.log('self-check ok');
