'use strict';

// Ported from new workflows/4-final-source.json → Calculate Source Attribution.
// One lead in, one attribution result out. The nightly worker calls this per page.


function blank(v) {
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return !s || s === '(absent)' || s === '(none)' || s === 'null' || s === 'undefined' || s === '(not set)';
}
function norm(v) { return blank(v) ? '' : String(v).trim().toLowerCase(); }
function tidy(v) { return blank(v) ? null : String(v).trim(); }
function firstDefined(...vals) {
  for (const v of vals) if (!blank(v)) return v;
  return null;
}
function put(obj, key, val) {
  const clean = tidy(val);
  if (clean != null) obj[key] = clean;
}
function toMs(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}
function toIso(value) {
  const ms = toMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}
function leadSourceString(doc) {
  if (typeof doc.lead_source === 'string' && !blank(doc.lead_source)) return String(doc.lead_source).trim();
  if (typeof doc.lead_source_str === 'string' && !blank(doc.lead_source_str)) return String(doc.lead_source_str).trim();
  const leadSources = Array.isArray(doc.lead_source) ? doc.lead_source : [];
  for (let i = leadSources.length - 1; i >= 0; i--) {
    const entry = leadSources[i];
    if (typeof entry === 'string' && !blank(entry)) return String(entry).trim();
    if (entry && !blank(entry.source)) return String(entry.source).trim();
  }
  return '';
}
function teleSourceValue(doc) {
  if (!blank(doc.tele_source_value)) return String(doc.tele_source_value).trim();
  const values = Array.isArray(doc.source) ? doc.source : [];
  for (let i = values.length - 1; i >= 0; i--) {
    const entry = values[i];
    const value = entry && typeof entry === 'object' ? firstDefined(entry.value, entry.tele_source) : entry;
    if (!blank(value)) return String(value).trim();
  }
  return '';
}
function referrerHost(ref) {
  if (blank(ref)) return '';
  const value = String(ref).trim();
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
    return String(parsed.hostname || '').toLowerCase();
  } catch (_) {
    return value.toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  }
}
function sourceFromCategory(category, analytics) {
  const mapped = {
    organic: 'dash_organic',
    advocate: 'dash_advocate',
    advertisement: 'dash_performance',
    referral: 'dash_customer',
    website: 'website',
    doctor: 'dash_consultant',
  };
  const label = mapped[norm(category)] || null;
  if (label !== 'website') return label;
  const doc = analytics && typeof analytics === 'object' && !Array.isArray(analytics) ? analytics : null;
  const utmSource = doc ? norm(firstDefined(doc.utm_source, doc.utmSource)) : '';
  return utmSource ? 'website' : 'website_organic';
}
function sourceFromTeleLead(lead) {
  const value = norm(lead);
  if (value === 'facebook') return 'meta_form';
  if (['excel', 'manual', 'call logs', 'ivr', 'google_sheets'].includes(value)) return 'Manual';
  if (value === 'whatsapp cloud api' || value === 'whatsapp') return 'meta_ctwa';
  if (value === 'website' || value === 'wesbite') return 'website';
  return null;
}
function sourceFromTelecrmRow(raw) {
  const row = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { source: raw };
  const fromLead = sourceFromTeleLead(row.source);
  if (fromLead) return fromLead;
  const bucket = norm(firstDefined(row.value, row.tele_source, row.tele_source_value));
  if (bucket === 'ctwa' || bucket === 'whatsapp cloud api' || bucket === 'whatsapp') return 'meta_ctwa';
  if (bucket === 'meta lead form' || bucket === 'meta_form' || bucket === 'facebook') return 'meta_form';
  if (bucket === 'website' || bucket === 'wesbite') return 'website';
  return null;
}
function sourceFromAnalytics(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const src = norm(firstDefined(doc.utm_source, doc.utmSource));
  const med = norm(firstDefined(doc.utm_medium, doc.utmMedium));
  const host = referrerHost(firstDefined(
    doc.referrer, doc.web_referred, doc.web_referrer, doc.referred_by
  ));
  if (!src && !med && blank(doc.gclid) && !host) return null;
  if (src === 'app' || src === 'stance_app' || src === 'healthflex_app') return 'app';
  if (!blank(doc.gclid) || (src === 'google' && med === 'cpc')) return 'google_cpc';
  if (src === 'gmb') return 'google_gmb';
  if (src.includes('interakt')) return 'interakt';
  if (med === 'wa' || med === 'tele_waca' || src === 'telecrm' || src === 'tele_waca') return 'Tele_WACA';
  if (src.includes('chatgpt') || host.includes('chatgpt')) return 'chatgpt';
  if (['ig', 'insta', 'instagram'].includes(src)) {
    if (!med) return 'instagram_organic';
    return med === 'paid_social' ? 'instagram_paid' : 'instagram_other';
  }
  if (src === 'meta' || src === 'facebook') {
    return med === 'paid_social' ? 'meta_paid' : 'meta_other';
  }
  if (src === 'google' && !med) return 'google_organic';
  if (!src && !med && host.includes('google')) return 'google_organic';
  if (src === 'website' || src === 'wesbite') return 'website';
  if (src || med || !blank(doc.gclid) || host) return 'others';
  return null;
}
function storedSourceLabel(value) {
  if (blank(value)) return null;
  const aliases = {
    dash_performance: 'dash_performance',
    dash_customer: 'dash_customer',
    dash_organic: 'dash_organic',
    dash_advocate: 'dash_advocate',
    dash_consultant: 'dash_consultant',
    dash_doctor: 'dash_consultant',
    meta_form: 'meta_form',
    app: 'app',
    manual: 'Manual',
    meta_ctwa: 'meta_ctwa',
    google_organic: 'google_organic',
    google_cpc: 'google_cpc',
    google_gmb: 'google_gmb',
    interakt: 'interakt',
    instagram_organic: 'instagram_organic',
    instagram_paid: 'instagram_paid',
    instagram_other: 'instagram_other',
    chatgpt: 'chatgpt',
    meta_paid: 'meta_paid',
    meta_other: 'meta_other',
    website: 'website',
    website_organic: 'website_organic',
    wesbite: 'website',
    dash_founder: 'dash_founder',
    others: 'others',
    tele_waca: 'Tele_WACA',
    'whatsapp cloud api': 'meta_ctwa',
    whatsapp: 'meta_ctwa',
  };
  return aliases[norm(value)] || String(value).trim();
}
const SOURCE_EVENT_KEYS = [
  'source', 'origin', 'occurred_at', 'tele_leadsource', 'tele_source',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
  'campaign_id', 'campaign_name', 'lead_id',
  'ad_id', 'ad_name', 'ad_set_id', 'ad_set_name',
  'ctwa_id', 'ctwa_source',
];
function sourceEvent(raw, defaults = {}) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const doc = { ...defaults, ...input };
  const label = tidy(firstDefined(
    doc.forced_source,
    storedSourceLabel(typeof input.source === 'string' ? input.source : null)
  ));
  if (blank(label)) return { source: '' };
  const entry = { source: label };
  put(entry, 'origin', firstDefined(doc.origin, doc.platform));
  const sourceOccurredMs = toMs(firstDefined(
    doc.occurred_at, doc.dateISO, doc.date, doc.ts, doc.timestamp,
    doc.created_at, doc.createdAt, doc.created_on, doc.first_seen_at
  ));
  if (sourceOccurredMs != null) entry.occurred_at = toIso(sourceOccurredMs);
  put(entry, 'tele_leadsource', firstDefined(doc.tele_leadsource, leadSourceString(doc)));
  put(entry, 'tele_source', firstDefined(doc.tele_source, doc.tele_source_value, doc.value));
  put(entry, 'utm_source', firstDefined(doc.utm_source, doc.utmSource));
  put(entry, 'utm_medium', firstDefined(doc.utm_medium, doc.utmMedium));
  put(entry, 'utm_campaign', firstDefined(doc.utm_campaign, doc.utmCampaign));
  put(entry, 'utm_term', firstDefined(doc.utm_term, doc.utmTerm));
  put(entry, 'campaign_id', firstDefined(doc.campaign_id, doc.facebook_campaign_id, doc.telecrm_campaign_id));
  put(entry, 'campaign_name', firstDefined(doc.campaign_name, doc.facebook_campaign, doc.telecrm_campaign, doc.campaign));
  put(entry, 'lead_id', firstDefined(doc.lead_id, doc.external_lead_id, doc.facebook_lead_id));
  put(entry, 'ad_id', firstDefined(doc.ad_id, doc.facebook_ad_id, doc.telecrm_ad_id));
  put(entry, 'ad_name', firstDefined(doc.ad_name, doc.facebook_ad, doc.telecrm_ad, doc.ad, doc.content));
  put(entry, 'ad_set_id', firstDefined(doc.ad_set_id, doc.facebook_ad_set_id, doc.telecrm_ad_set_id));
  put(entry, 'ad_set_name', firstDefined(doc.ad_set_name, doc.facebook_ad_set_name, doc.telecrm_ad_set_name));
  put(entry, 'ctwa_id', doc.ctwa_id);
  put(entry, 'ctwa_source', firstDefined(doc.ctwa_source, doc.ctwa_source_id));
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
      return normalized;
    })
    .filter((entry) => !blank(entry.source));
}
function sourceHistory(existing) {
  const current = cleanSourceArray(existing && existing.source);
  const legacy = cleanSourceArray(existing && existing.final_source);
  return current.length ? current : legacy;
}
function attributionFingerprint(entry) {
  const identityKeys = SOURCE_EVENT_KEYS.filter((key) => key !== 'origin');
  return JSON.stringify(identityKeys.map((key) => [key, norm(entry[key])]).filter((pair) => pair[1]));
}
function attributionSignal(doc) {
  return [
    doc.utm_source, doc.utmSource, doc.utm_medium, doc.utmMedium,
    doc.utm_campaign, doc.utmCampaign, doc.referrer, doc.web_referred,
    doc.web_referrer, doc.referred_by, doc.gclid,
    doc.campaign_id, doc.campaign_name, doc.campaign,
  ].some((value) => !blank(value));
}
function pickMarketingFields(doc) {
  const out = {};
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return out;
  put(out, 'campaign_id', firstDefined(doc.campaign_id, doc.facebook_campaign_id, doc.telecrm_campaign_id));
  put(out, 'campaign_name', firstDefined(doc.campaign_name, doc.facebook_campaign, doc.telecrm_campaign, doc.campaign));
  put(out, 'lead_id', firstDefined(doc.lead_id, doc.external_lead_id, doc.facebook_lead_id));
  put(out, 'ad_id', firstDefined(doc.ad_id, doc.facebook_ad_id, doc.telecrm_ad_id));
  put(out, 'ad_name', firstDefined(doc.ad_name, doc.facebook_ad, doc.telecrm_ad, doc.ad, doc.content));
  put(out, 'ad_set_id', firstDefined(doc.ad_set_id, doc.facebook_ad_set_id, doc.telecrm_ad_set_id));
  put(out, 'ad_set_name', firstDefined(doc.ad_set_name, doc.facebook_ad_set_name, doc.telecrm_ad_set_name));
  put(out, 'ctwa_id', doc.ctwa_id);
  put(out, 'ctwa_source', firstDefined(doc.ctwa_source, doc.ctwa_source_id));
  return out;
}
function isTelecrmOrigin(entry) {
  const origin = norm(entry && entry.origin);
  return origin === 'telecrm'
    || origin === 'telecrm_lead_source'
    || origin === 'telecrm_source'
    || origin === 'legacy_telecrm'
    || origin === 'legacy';
}
function attributionIdsConflict(left, right) {
  const keys = ['lead_id', 'campaign_id', 'campaign_name', 'ad_id', 'ad_set_id'];
  for (const key of keys) {
    const a = norm(left && left[key]);
    const b = norm(right && right[key]);
    if (a && b && a !== b) return true;
  }
  return false;
}
function sameTelecrmAttribution(left, right) {
  if (!isTelecrmOrigin(left) || !isTelecrmOrigin(right)) return false;
  if (blank(left && left.source) || norm(left.source) !== norm(right && right.source)) return false;
  if (attributionIdsConflict(left, right)) return false;
  const leftMs = toMs(left && left.occurred_at);
  const rightMs = toMs(right && right.occurred_at);
  if (leftMs != null && rightMs != null && leftMs !== rightMs) {
    const pair = [norm(left.origin), norm(right.origin)].sort().join('|');
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
  put(merged, 'origin', preferSourceOrigin(left && left.origin, right && right.origin));
  const earliestMs = toMs(earliest); if (earliestMs != null) merged.occurred_at = toIso(earliestMs);
  for (const key of SOURCE_EVENT_KEYS) {
    if (key === 'source' || key === 'origin' || key === 'occurred_at') continue;
    put(merged, key, firstDefined(left && left[key], right && right[key]));
  }
  for (const field of WEB_ANALYTICS_FIELDS) {
    const value = analyticsValue(firstDefined(left && left[field.name], right && right[field.name]));
    if (value != null) merged[field.name] = value;
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
  if (!telecrm || norm(leadSourceString(telecrm)) !== 'facebook') return null;
  const leadRows = Array.isArray(telecrm.lead_source) ? telecrm.lead_source : [];
  for (const row of leadRows) {
    if (!row || typeof row === 'string') continue;
    if (norm(row.source) !== 'facebook') continue;
    const iso = toIso(firstDefined(row.occurred_at, row.dateISO, row.date));
    if (iso) return iso;
  }
  const created = toIso(firstDefined(telecrm.created_at, telecrm.createdAt, telecrm.created_on));
  if (created) return created;
  const stages = Array.isArray(telecrm.stage) ? telecrm.stage : [];
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
  const bucket = norm(firstDefined(raw && raw.value, raw && raw.tele_source, raw && raw.source));
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
const WEB_ANALYTICS_FIELDS = [
  { name: 'totalTouchpoints', from: ['totalTouchpoints', 'total_touchpoints'] },
  { name: 'totalSessions', from: ['totalSessions', 'total_sessions'] },
  { name: 'anonymousId', from: ['anonymousId', 'anonymous_id'] },
  { name: 'firstTouchAt', from: ['firstTouchAt', 'first_touch_at'] },
  { name: 'lastTouchAt', from: ['lastTouchAt', 'last_touch_at'] },
  { name: 'landingPage', from: ['landingPage', 'landing_page'] },
  { name: 'bookingUrl', from: ['bookingUrl', 'booking_url'] },
  { name: 'utmMedium', from: ['utmMedium', 'utm_medium'] },
  { name: 'utmCampaign', from: ['utmCampaign', 'utm_campaign'] },
  { name: 'utmAdgroup', from: ['utmAdgroup', 'utm_adgroup'] },
  { name: 'gclid', from: ['gclid'] },
  { name: 'referrer', from: ['referrer', 'web_referred', 'web_referrer', 'referred_by'] },
  { name: 'fbp', from: ['fbp'] },
  { name: 'utmContent', from: ['utmContent', 'utm_content'] },
  { name: 'utmTerm', from: ['utmTerm', 'utm_term'] },
  { name: 'fbc', from: ['fbc'] },
  { name: 'utmReferer', from: ['utmReferer', 'utm_referer'] },
];
function analyticsValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return tidy(value);
}
function websiteFields(doc) {
  const src = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  const out = {};
  for (const field of WEB_ANALYTICS_FIELDS) {
    const value = analyticsValue(firstDefined.apply(null, field.from.map((name) => src[name])));
    if (value != null) out[field.name] = value;
  }
  return out;
}
function applyWebsiteFields(events, doc) {
  const fields = websiteFields(doc);
  const aliases = [];
  for (const field of WEB_ANALYTICS_FIELDS) {
    for (const name of field.from) {
      if (name !== field.name) aliases.push(name);
    }
  }
  for (const entry of Array.isArray(events) ? events : []) {
    if (!entry || typeof entry !== 'object') continue;
    const label = norm(entry && entry.source);
    if (label && label !== 'meta_form' && label !== 'meta_ctwa') {
      for (const field of WEB_ANALYTICS_FIELDS) {
        if (analyticsValue(entry[field.name]) != null) continue;
        const own = analyticsValue(firstDefined.apply(null, field.from.map((name) => entry[name])));
        const value = own != null ? own : fields[field.name];
        if (value != null) entry[field.name] = value;
      }
      for (const alias of aliases) delete entry[alias];
    }
    delete entry.utm_campaign;
    delete entry.utm_content;
    delete entry.utm_adgroup;
  }
}
function buildSourceHistory(existing, telecrm, analytics = null, user = null, touchpoints = []) {
  function publishCapture(entry) {
    if (!entry || blank(entry.source)) return null;
    const published = {};
    for (const key of Object.keys(entry)) {
      if (key === 'origin' || key === 'tele_source' || key === 'tele_leadsource') continue;
      published[key] = entry[key];
    }
    return published;
  }
  // Source history, oldest first. source[0] is the earliest capture.
  // One label is one row. TeleCRM decides whether a later visit is a recapture.
  function fifoSourceHistory(entries) {
    const pending = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || blank(entry.source)) continue;
      if (!norm(entry.source)) continue;
      pending.push(entry);
    }
    pending.sort((left, right) => {
      const leftMs = toMs(left.occurred_at);
      const rightMs = toMs(right.occurred_at);
      if (leftMs != null && rightMs != null && leftMs !== rightMs) return leftMs - rightMs;
      if (leftMs != null && rightMs == null) return -1;
      if (leftMs == null && rightMs != null) return 1;
      return 0;
    });
    const kept = [];
    for (const entry of pending) {
      const label = norm(entry.source);
      let last = -1;
      for (let i = kept.length - 1; i >= 0; i--) {
        if (norm(kept[i].source) === label) { last = i; break; }
      }
      if (last >= 0) {
        kept[last] = mergeSourceEntries(kept[last], entry);
        continue;
      }
      kept.push(entry);
    }
    return kept;
  }
  function analyticsHasSignal(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
    return !blank(firstDefined(
      doc.utm_source, doc.utmSource,
      doc.utm_medium, doc.utmMedium,
      doc.utm_campaign, doc.utmCampaign,
      doc.utm_term, doc.utmTerm,
      doc.utm_content, doc.utmContent,
      doc.utm_adgroup, doc.utmAdgroup,
      doc.referrer, doc.web_referred, doc.web_referrer, doc.referred_by,
      doc.gclid
    ));
  }
  function dashFromDropdown(value) {
    const mapped = {
      performance: 'dash_performance',
      advertisement: 'dash_performance',
      customer: 'dash_customer',
      referral: 'dash_customer',
      organic: 'dash_organic',
      clinician: 'dash_consultant',
      doctor: 'dash_consultant',
      advocate: 'dash_advocate',
      founder: 'dash_founder',
    };
    return mapped[norm(value)] || null;
  }
  function pinOrigin(rows, label) {
    if (blank(label)) return rows;
    const index = rows.findIndex((row) => norm(row && row.source) === norm(label));
    if (index <= 0) return rows;
    const [row] = rows.splice(index, 1);
    rows.unshift(row);
    return rows;
  }
  const events = [];
  const analyticsDoc = analytics && typeof analytics === 'object' && !Array.isArray(analytics) ? analytics : null;
  let originLabel = null;
  if (analyticsHasSignal(analyticsDoc)) {
    const label = sourceFromAnalytics(analyticsDoc) || 'others';
    const published = publishCapture(sourceEvent({
      occurred_at: firstDefined(
        analyticsDoc.firstTouchAt,
        analyticsDoc.lastTouchAt,
        analyticsDoc.occurred_at,
        user && firstDefined(user.createdAt, user.updatedAt)
      ),
    }, { origin: 'users_analytics_view', forced_source: label }));
    if (published) {
      events.push(published);
      originLabel = published.source;
    }
  }
  if (!events.length && norm(user && user.category) === 'website') {
    const published = publishCapture(sourceEvent({
      forced_source: 'website_organic',
      origin: 'dash_category',
      occurred_at: user && firstDefined(user.createdAt, user.updatedAt),
    }));
    if (published) {
      events.push(published);
      originLabel = published.source;
    }
  }

  const leadRows = Array.isArray(telecrm && telecrm.lead_source)
    ? telecrm.lead_source
    : (!blank(telecrm && telecrm.lead_source) ? [telecrm.lead_source] : []);
  const sourceRows = historyArray(telecrm && telecrm.source);
  const latestLead = leadSourceString(telecrm || {});
  const marketing = pickMarketingFields(telecrm || {});
  const intakeAt = facebookIntakeOccurredAt(telecrm || {});
  const capturedEvents = [];
  leadRows.forEach((row, index) => {
    const raw = row && typeof row === 'object' ? row : { source: row };
    const label = sourceFromTeleLead(raw.source);
    if (!label) return;
    const defaults = {
      origin: 'telecrm_lead_source',
      forced_source: label,
      lead_source: raw.source,
      created_at: telecrm && telecrm.created_at,
      created_on: telecrm && telecrm.created_on,
      createdAt: telecrm && telecrm.createdAt,
    };
    if (index === leadRows.length - 1) Object.assign(defaults, marketing, { lead_source: raw.source });
    if (norm(raw.source) === 'facebook' && intakeAt) defaults.occurred_at = intakeAt;
    const event = sourceEvent(raw, defaults);
    if (!blank(event.source)) capturedEvents.push(event);
  });
  sourceRows.forEach((row, index) => {
    const raw = row && typeof row === 'object' ? row : { value: row };
    const label = sourceFromTelecrmRow(raw);
    if (!label) return;
    const defaults = {
      origin: 'telecrm_source',
      forced_source: label,
      tele_leadsource: latestLead,
      tele_source_value: firstDefined(raw.value, raw.tele_source, typeof raw.source === 'string' ? raw.source : null),
    };
    if (index === sourceRows.length - 1) {
      Object.assign(defaults, marketing, {
        tele_leadsource: latestLead,
        tele_source_value: firstDefined(raw.value, raw.tele_source, typeof raw.source === 'string' ? raw.source : null),
      });
    }
    if (isFacebookSourceRow(raw, latestLead) && intakeAt) defaults.occurred_at = intakeAt;
    const event = sourceEvent(raw, defaults);
    if (!blank(event.source)) capturedEvents.push(event);
  });
  if (!capturedEvents.length && telecrm) {
    const label = sourceFromTeleLead(latestLead) || sourceFromTelecrmRow(telecrm);
    if (label) {
      const event = sourceEvent(telecrm, { origin: 'telecrm', forced_source: label });
      if (!blank(event.source)) capturedEvents.push(event);
    }
  }
  const channelLabels = new Set(['meta_form', 'manual', 'meta_ctwa', 'website']);
  const channelEvents = coalesceTelecrmSourceEvents(capturedEvents)
    .map((entry) => publishCapture(entry))
    .filter((entry) => entry && channelLabels.has(norm(entry.source)));
  if (!events.length) {
    for (const entry of channelEvents) events.push(entry);
  } else {
    const floor = toMs(events[0].occurred_at);
    for (const entry of channelEvents) {
      const label = norm(entry.source);
      if (label === 'website' || label === norm(originLabel)) continue;
      const ms = toMs(entry.occurred_at);
      if (floor != null && (ms == null || ms <= floor)) continue;
      events.push(entry);
    }
  }
  if (!events.length) {
    let chosen = null;
    for (const row of sourceRows) {
      const raw = row && typeof row === 'object' ? row : { value: row };
      const label = dashFromDropdown(firstDefined(raw.value, raw.tele_source, typeof raw.source === 'string' ? raw.source : null));
      if (!label) continue;
      const occurred = firstDefined(raw.occurred_at, raw.date, raw.dateISO, raw.ts);
      const nextMs = toMs(occurred);
      const chosenMs = chosen ? toMs(chosen.occurred) : null;
      if (!chosen || (chosenMs == null && nextMs != null) || (chosenMs != null && nextMs != null && nextMs < chosenMs)) {
        chosen = { label, occurred, raw };
      }
    }
    if (chosen) {
      const published = publishCapture(sourceEvent(chosen.raw, {
        origin: 'telecrm_source',
        forced_source: chosen.label,
        occurred_at: chosen.occurred,
        tele_source_value: firstDefined(chosen.raw.value, chosen.raw.tele_source, typeof chosen.raw.source === 'string' ? chosen.raw.source : null),
      }));
      if (published) {
        events.push(published);
        originLabel = published.source;
      }
    }
  }
  if (!events.length) {
    let dropdown = '';
    for (let i = sourceRows.length - 1; i >= 0; i--) {
      const raw = sourceRows[i] && typeof sourceRows[i] === 'object' ? sourceRows[i] : { value: sourceRows[i] };
      dropdown = firstDefined(raw.value, raw.tele_source, typeof raw.source === 'string' ? raw.source : null) || '';
      if (!blank(dropdown)) break;
    }
    const lead = leadSourceString(telecrm || {});
    const unclassified = [lead, dropdown].some((value) => {
      const key = norm(value);
      return key && key !== 'app';
    });
    if (unclassified) {
      const published = publishCapture(sourceEvent({
        forced_source: 'others',
        origin: 'unclassified',
        occurred_at: firstDefined(telecrm && telecrm.created_at, telecrm && telecrm.createdAt, user && user.createdAt),
      }));
      if (published) {
        events.push(published);
        originLabel = published.source;
      }
    }
  }
  const floorMs = events.reduce((min, entry) => {
    const ms = toMs(entry && entry.occurred_at);
    if (ms == null) return min;
    return min == null || ms < min ? ms : min;
  }, null);
  for (const row of Array.isArray(touchpoints) ? touchpoints : []) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const src = norm(firstDefined(row.utm_source, row.utmSource));
    const med = norm(firstDefined(row.utm_medium, row.utmMedium));
    if (!src && !med) continue;
    const label = sourceFromAnalytics(row);
    if (!label || label === 'others') continue;
    const occurred = firstDefined(row.occurred_at, row.ts, row.timestamp, row.date);
    const ms = toMs(occurred);
    if (floorMs != null && (ms == null || ms <= floorMs)) continue;
    const published = publishCapture(sourceEvent({
      occurred_at: occurred,
    }, { origin: 'web_touchpoint', forced_source: label }));
    if (published) {
      Object.assign(published, websiteFields(row));
      events.push(published);
    }
  }
  applyWebsiteFields(events, analyticsDoc);
  return pinOrigin(fifoSourceHistory(events), originLabel);
}
function sameSourceArray(left, right) {
  return JSON.stringify(Array.isArray(left) ? left : []) === JSON.stringify(Array.isArray(right) ? right : []);
}
function stageEntry(platform, status, occurredAt) {
  if (blank(platform) || blank(status)) return null;
  const entry = { platform: String(platform).trim(), status: String(status).trim() };
  const occurredMs = toMs(occurredAt); if (occurredMs != null) entry.occurred_at = toIso(occurredMs);
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
function collapseUnchangedStages(items) {
  function oldestFirst(left, right) {
    const leftMs = toMs(left.entry.occurred_at);
    const rightMs = toMs(right.entry.occurred_at);
    if (leftMs != null && rightMs != null && leftMs !== rightMs) return leftMs - rightMs;
    if (leftMs != null && rightMs == null) return -1;
    if (leftMs == null && rightMs != null) return 1;
    return left.sequence - right.sequence;
  }
  function newestFirst(left, right) {
    const leftMs = toMs(left.entry.occurred_at);
    const rightMs = toMs(right.entry.occurred_at);
    if (leftMs != null && rightMs != null && leftMs !== rightMs) return rightMs - leftMs;
    if (leftMs != null && rightMs == null) return -1;
    if (leftMs == null && rightMs != null) return 1;
    return right.sequence - left.sequence;
  }
  const ordered = items.slice().sort(oldestFirst);
  const lastStatus = new Map();
  const kept = [];
  for (const item of ordered) {
    const platform = norm(item.entry.platform);
    const status = norm(item.entry.status);
    if (lastStatus.get(platform) === status) continue;
    lastStatus.set(platform, status);
    kept.push(item);
  }
  return kept.sort(newestFirst).map((item) => item.entry);
}
function buildStageHistory(existing, telecrmRows, currentTelecrmStatus, dashStatus, dashOccurredAt) {
  const existingRows = cleanStage(existing && existing.stage);
  const upstream = historyArray(telecrmRows);
  const seen = new Set();
  const output = [];
  let sequence = 0;
  function add(entry) {
    if (!entry) return;
    const statusKey = [norm(entry.platform), norm(entry.status)].join('|');
    const timeKey = entry.occurred_at ? String(toMs(entry.occurred_at)) : '';
    const exactKey = statusKey + '|' + timeKey;
    if (seen.has(exactKey)) return;
    if (timeKey) {
      const datelessIndex = output.findIndex((item) => (
        norm(item.entry.platform) === norm(entry.platform)
        && norm(item.entry.status) === norm(entry.status)
        && !item.entry.occurred_at
      ));
      if (datelessIndex >= 0) {
        output[datelessIndex].entry.occurred_at = entry.occurred_at;
        seen.delete(statusKey + '|');
        seen.add(exactKey);
        return;
      }
    } else if (output.some((item) => (
      norm(item.entry.platform) === norm(entry.platform)
      && norm(item.entry.status) === norm(entry.status)
    ))) {
      return;
    }
    seen.add(exactKey);
    output.push({ entry, sequence: sequence++ });
  }
  for (const entry of existingRows) add(entry);
  const hasDashRow = existingRows.some((entry) => norm(entry.platform) === 'dash');
  if (!hasDashRow && existing && !blank(existing.dash_status)) {
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
      if (norm(item.entry.platform) !== norm(platform)) continue;
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
  const latestTelecrm = latestFor('telecrm');
  if (!blank(currentTelecrmStatus) && (!latestTelecrm || norm(latestTelecrm.status) !== norm(currentTelecrmStatus))) {
    add(stageEntry('telecrm', currentTelecrmStatus, null));
  }
  const latestDash = latestFor('dash');
  if (!blank(dashStatus)) {
    const dashStatusValue = String(dashStatus).trim();
    if (!latestDash || norm(latestDash.status) !== norm(dashStatusValue)) {
      add(stageEntry('dash', dashStatus, dashOccurredAt));
    } else if (!latestDash.occurred_at && dashOccurredAt) {
      const iso = toIso(dashOccurredAt);
      const backfillMs = toMs(iso); if (backfillMs != null) latestDash.occurred_at = toIso(backfillMs);
    }
  }
  return collapseUnchangedStages(output);
}
function appointmentView(appointment) {
  return {
    visitType: appointment.visitType || 'FIRST_VISIT',
    createdAt: toIso(appointment.createdAt),
    updatedAt: toIso(appointment.updatedAt),
    report: appointment.report ?? null,
  };
}

function normalizePhone(raw) {
  let value = String(raw ?? '').replace(/[^0-9]/g, '');
  if (value.length === 11 && value.startsWith('0')) value = value.slice(1);
  if (value.length === 12 && value.startsWith('91')) value = value.slice(2);
  return value;
}
function attributeLead(lead) {
  lead = lead || {};
  const phone = normalizePhone(lead.phone);
  if (phone.length !== 10) return null;
  const existing = { source: lead.existing_source, final_source: lead.existing_final_source, stage: lead.existing_stage };
  const telecrm = {
    lead_source: lead.lead_source,
    source: historyArray(lead.telecrm_source != null ? lead.telecrm_source : lead.source),
    stage: historyArray(lead.telecrm_stage != null ? lead.telecrm_stage : lead.stage),
    status: lead.telecrm_status,
    created_at: lead.created_at,
    created_on: lead.created_on,
    createdAt: lead.createdAt,
    ctwa_id: lead.ctwa_id,
    ctwa_source: lead.ctwa_source,
    ctwa_source_id: lead.ctwa_source_id,
    campaign_id: lead.campaign_id,
    campaign_name: lead.campaign_name,
    facebook_campaign_id: lead.facebook_campaign_id,
    facebook_campaign: lead.facebook_campaign,
    telecrm_campaign_id: lead.telecrm_campaign_id,
    telecrm_campaign: lead.telecrm_campaign,
    lead_id: lead.lead_id,
    external_lead_id: lead.external_lead_id,
    facebook_lead_id: lead.facebook_lead_id,
    ad_id: lead.ad_id,
    ad_name: lead.ad_name,
    facebook_ad_id: lead.facebook_ad_id,
    facebook_ad: lead.facebook_ad,
    telecrm_ad_id: lead.telecrm_ad_id,
    telecrm_ad: lead.telecrm_ad,
    ad_set_id: lead.ad_set_id,
    ad_set_name: lead.ad_set_name,
    facebook_ad_set_id: lead.facebook_ad_set_id,
    facebook_ad_set_name: lead.facebook_ad_set_name,
    telecrm_ad_set_id: lead.telecrm_ad_set_id,
    telecrm_ad_set_name: lead.telecrm_ad_set_name,
  };
  const user = {
    category: firstDefined(lead.user_category, lead.category),
    createdAt: lead.user_createdAt,
    updatedAt: lead.user_updatedAt,
  };
  const source = buildSourceHistory(existing, telecrm, lead.web_analytics, user, lead.web_touchpoints);
  const stage = buildStageHistory(existing, telecrm.stage, telecrm.status, null, null);
  const previous = sourceHistory(existing);
  const previousStage = cleanStage(existing.stage);
  return {
    phone,
    source,
    stage,
    should_write_source: !sameSourceArray(previous, source) ||
        !sameSourceArray(previousStage, stage) ||
        (Array.isArray(lead.existing_final_source) && lead.existing_final_source.length > 0),
    };
}

module.exports = { attributeLead };
