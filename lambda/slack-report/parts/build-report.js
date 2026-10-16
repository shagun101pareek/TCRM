// new-telecrm daily report — CRM metrics from conversionStatus + telecrm-only stage[]
const HOT_STATUSES       = new Set(['Session Booked','Session booked','Session Rescheduled']);
const CONVERTED_STATUSES = new Set(['Converted','Won / Converted']);
const NSHOW_STATUSES     = new Set(['No Show','Not Shown Up']);
const SB_STATUSES        = new Set(['Session Booked','Session booked','Session Rescheduled']);
const META_PLATFORMS     = new Set(['meta_form','Facebook','meta_paid','instagram_paid']);
const HOT_ALWAYS         = new Set(['Fresh','In Pipeline','Session Booked','Session booked','Session Rescheduled']);
const DECAY              = new Set(['Not Shown Up','No Show','No Response']);
const TERMINAL           = new Set(['Converted','Won / Converted','Not Converted']);
const HOT_DAYS = 7, WARM_DAYS = 15, DAY_MS = 86400000;

function telecrmStages(doc) {
  return (doc.stage || []).filter(s => s && (s.platform == null || s.platform === 'telecrm'));
}
function stageStamp(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  const s = String(v).trim();
  if (/^\d{12,}$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return new Date(n).toISOString();
  }
  return s;
}
function stageTime(s) {
  if (!s) return '';
  return stageStamp(s.occurred_at) || stageStamp(s.date);
}
function stageTimeOnDay(s, iso_date) {
  if (!s) return '';
  const occurred = stageStamp(s.occurred_at);
  if (occurred.startsWith(iso_date)) return occurred;
  const dated = stageStamp(s.date);
  if (dated.startsWith(iso_date)) return dated;
  return '';
}
function createdMs(doc) {
  const epochValue = doc.created_on_epoch;
  if (typeof epochValue === 'number' && Number.isFinite(epochValue) && epochValue > 0) return epochValue < 1e12 ? epochValue * 1000 : epochValue;
  const n = doc.created_on;
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
  if (n && typeof n === 'object' && n.$numberLong) {
    const v = Number(n.$numberLong);
    if (Number.isFinite(v) && v > 0) return v;
  }
  if (typeof n === 'string' && n.trim()) {
    const t = Date.parse(n);
    if (!Number.isNaN(t)) return t;
  }
  if (typeof doc.created_at === 'number' && Number.isFinite(doc.created_at)) return doc.created_at;
  if (typeof doc.created_at === 'string') {
    const t = Date.parse(doc.created_at);
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}
function crmStatus(doc) {
  return doc.conversionStatus || doc.status || 'Fresh';
}
function getBranch(doc) {
  return doc.telecrm_form_branch || doc.branch || '—';
}
function latestSourceValue(doc) {
  const src = doc.source;
  if (Array.isArray(src)) {
    for (let i = src.length - 1; i >= 0; i--) {
      const row = src[i];
      if (!row) continue;
      if (typeof row === 'string' && row.trim()) return row.trim();
      const v = row.source || row.value;
      if (v && typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  if (typeof doc.lead_source === 'string' && doc.lead_source.trim()) return doc.lead_source.trim();
  if (Array.isArray(doc.lead_source) && doc.lead_source.length && typeof doc.lead_source[0] === 'object') {
    return doc.lead_source[0].source || 'Unknown';
  }
  return 'Unknown';
}
function getPlatform(doc) {
  return latestSourceValue(doc);
}
function getCategory(doc) {
  return latestSourceValue(doc);
}
function getAdInfo(doc) {
  const src = doc.source;
  if (Array.isArray(src)) {
    for (const row of src) {
      if (!row || typeof row !== 'object') continue;
      const ad = row.ad_name || row.ad || row.utmAdgroup;
      const campaign = row.campaign_name || row.campaign || row.utmCampaign;
      if (ad || campaign) return [ad || '—', campaign || '—'];
    }
  }
  const raw = doc.lead_source;
  if (Array.isArray(raw) && raw.length && typeof raw[0] === 'object') {
    const ad = raw[0].ad || raw[0].ad_name || raw[0].utmAdgroup;
    const campaign = raw[0].campaign || raw[0].campaign_name || raw[0].utmCampaign;
    if (ad || campaign) return [ad || '—', campaign || '—'];
  }
  return ['—','—'];
}
function normPhone(p) {
  if (p == null) return null;
  let s = String(p).trim().replace(/^\+/, '');
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  return s;
}
function eodStatus(doc, iso_date) {
  let latest = null;
  let latestTs = '';
  for (const s of telecrmStages(doc)) {
    const ds = stageTimeOnDay(s, iso_date);
    if (!ds) continue;
    if (latest === null || ds > latestTs) { latest = s; latestTs = ds; }
  }
  const created = createdMs(doc);
  const bornToday = created >= start_ms && created < start_ms + 86400000;
  if (bornToday) {
    const current = crmStatus(doc);
    const undated = current && telecrmStages(doc).some(s =>
      s.status === current && !stageStamp(s.occurred_at) && !stageStamp(s.date));
    const datedStatus = latest && latest.status;
    if (undated && current !== 'Fresh' && (!datedStatus || datedStatus === 'Fresh' || datedStatus === current)) {
      return current;
    }
  }
  return (latest && latest.status) || 'Fresh';
}
function firstContactMs(doc) {
  const v = doc.telecrm_first_interaction_date != null ? doc.telecrm_first_interaction_date : doc.first_interaction_date;
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}
function parseDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? null : d; }
  if (typeof v === 'object' && v.$date) return new Date(v.$date);
  return null;
}
function statusUpdateDate(doc) {
  const status = crmStatus(doc);
  let aliases;
  if (status === 'Not Shown Up' || status === 'No Show') aliases = new Set(['Not Shown Up','No Show']);
  else if (status === 'Session Booked' || status === 'Session booked') aliases = new Set(['Session Booked','Session booked']);
  else aliases = new Set([status]);
  let latest = null;
  for (const s of telecrmStages(doc)) {
    if (!aliases.has(s.status)) continue;
    const d = parseDate(s.occurred_at || s.date);
    if (d && (latest === null || d > latest)) latest = d;
  }
  return latest || parseDate(doc.modified_at);
}
function classifyTemp(doc, now) {
  const s = crmStatus(doc);
  if (HOT_ALWAYS.has(s)) return 'Hot';
  if (TERMINAL.has(s)) return null;
  if (DECAY.has(s)) {
    const sud = statusUpdateDate(doc);
    if (!sud) return null;
    const age = Math.floor((now - sud) / DAY_MS);
    if (age <= HOT_DAYS) return 'Hot';
    if (age <= WARM_DAYS) return 'Warm';
    return 'Cold';
  }
  return null;
}

const w = $('Calculate Windows1').item.json;
const iso_date      = w.iso_date;
const iso_date_next = w.iso_date_next;
const start_ms      = w.start_ms;
const p0_threshold  = w.p0_threshold;
const date_label    = w.date_label;

const _QTYPE_BY_NODE = {
  "Query New Leads": "new_leads",
  "Query Older Leads": "older_leads",
  "Query Older Stage Events": "older_stage",
  "Query Status Counts": "status_counts",
  "Query Plat Stats": "plat_stats",
  "Query Sessions": "sessions",
  "Query Temperature": "temperature",
  "Query WTD": "wtd",
  "Query Prev Week": "prev_week_sessions",
  "Query WTD New Leads": "wtd_new_leads_count",
  "Query Prev New Leads": "prev_new_leads_count",
  "Query WTD Bookings": "wtd_bookings_count",
  "Query Prev Bookings": "prev_bookings_count",
  "Query FV Bookings": "fv_bookings"
};
const _MERGED_BY_TYPE = (() => {
  const m = {};
  for (const it of $input.all()) {
    const j = (it && it.json) || {};
    const t = j._queryType;
    if (!t) continue;
    (m[t] = m[t] || []).push(j);
  }
  return m;
})();
function safeAll(nodeName) {
  const t = _QTYPE_BY_NODE[nodeName];
  if (!t) return [];
  return _MERGED_BY_TYPE[t] || [];
}
function firstJson(nodeName) {
  const arr = safeAll(nodeName);
  return (arr.length && arr[0]) || {};
}

const newLeadDocs    = safeAll('Query New Leads');
const olderLeadDocs  = safeAll('Query Older Leads');
const olderStageDocs = safeAll('Query Older Stage Events');
const platStats      = safeAll('Query Plat Stats');
const tempCounts     = safeAll('Query Temperature');
const sessionsDocs   = safeAll('Query Sessions');
const wtdDoc         = firstJson('Query WTD');
const prevWeekDoc    = firstJson('Query Prev Week');
const wtdNewLeadsDoc = firstJson('Query WTD New Leads');
const prevNewLeadsDoc= firstJson('Query Prev New Leads');
const wtdBookingsDoc = firstJson('Query WTD Bookings');
const prevBookingsDoc= firstJson('Query Prev Bookings');

const overlayByPhone = {};
for (const doc of [...newLeadDocs, ...olderLeadDocs, ...olderStageDocs, ...sessionsDocs]) {
  const ph = normPhone(String(doc.phone || ''));
  if (ph) overlayByPhone[ph] = doc;
}
function overlayDoc(doc) {
  const ph = normPhone(String(doc.phone || ''));
  const nt = ph && overlayByPhone[ph];
  if (!nt) return doc;
  return Object.assign({}, doc, {
    name: nt.name || doc.name,
    conversionStatus: nt.conversionStatus || doc.conversionStatus,
    status: nt.conversionStatus || doc.status,
    source: nt.source || doc.source,
    stage: nt.stage || doc.stage,
    telecrm_form_branch: nt.telecrm_form_branch || doc.telecrm_form_branch,
    branch: nt.telecrm_form_branch || doc.branch,
    created_on: nt.created_on != null ? nt.created_on : doc.created_on,
    created_at: nt.created_on != null ? nt.created_on : doc.created_at,
    telecrm_first_interaction_date: nt.telecrm_first_interaction_date || doc.telecrm_first_interaction_date
  });
}

const new_leads   = newLeadDocs.length;
const older_leads = olderLeadDocs.length;

let fresh_new = 0, nr_new = 0, ip_new = 0, sb_new = 0;
let conv_new_s1 = 0, nc_new = 0, nshow_new_s1 = 0;
for (const doc of newLeadDocs) {
  const s = eodStatus(doc, iso_date);
  if      (s === 'Fresh')                    fresh_new++;
  else if (s === 'No Response')              nr_new++;
  else if (s === 'In Pipeline')              ip_new++;
  else if (HOT_STATUSES.has(s))              sb_new++;
  else if (CONVERTED_STATUSES.has(s))        conv_new_s1++;
  else if (s === 'Not Converted')            nc_new++;
  else if (NSHOW_STATUSES.has(s))            nshow_new_s1++;
}

let nr_older = 0, ip_older = 0, sb_older = 0, nc_older = 0;
let conv_older_s = 0, nshow_older_s = 0;
for (const doc of olderStageDocs) {
  const s = eodStatus(doc, iso_date);
  if      (s === 'No Response')       nr_older++;
  else if (s === 'In Pipeline')       ip_older++;
  else if (HOT_STATUSES.has(s))       sb_older++;
  else if (CONVERTED_STATUSES.has(s)) conv_older_s++;
  else if (s === 'Not Converted')     nc_older++;
  else if (NSHOW_STATUSES.has(s))     nshow_older_s++;
}

const sessions_detail = [];
let conv_new = 0, conv_older = 0, nshow_new = 0, nshow_older = 0;

const apptTodayDocs = (_MERGED_BY_TYPE['appointments_today'] || []).map(overlayDoc);
for (const doc of apptTodayDocs) {
  const isNew = createdMs(doc) >= start_ms;
  const [ad] = getAdInfo(doc);
  sessions_detail.push({
    name:           doc.name || '—',
    phone:          String(doc.phone || '—'),
    branch:         getBranch(doc),
    platform:       getPlatform(doc),
    category:       getCategory(doc),
    ad,
    appt_status:    doc.appt_status || '—',
    telecrm_status: crmStatus(doc) || '—',
    converted:      true
  });
  if (isNew) conv_new++; else conv_older++;
}

const apptTodayPhones = new Set(apptTodayDocs.map(d => normPhone(String(d.phone || ''))));
for (const doc of sessionsDocs) {
  const todayNshow = telecrmStages(doc).filter(s =>
    stageTimeOnDay(s, iso_date) &&
    NSHOW_STATUSES.has(s.status)
  );
  if (!todayNshow.length) continue;
  const ph = normPhone(String(doc.phone || ''));
  if (apptTodayPhones.has(ph)) continue;
  const isNew = createdMs(doc) >= start_ms;
  const [ad] = getAdInfo(doc);
  sessions_detail.push({
    name:           doc.name || '—',
    phone:          String(doc.phone || '—'),
    branch:         getBranch(doc),
    platform:       getPlatform(doc),
    category:       getCategory(doc),
    ad,
    appt_status:    '—',
    telecrm_status: crmStatus(doc) || '—',
    converted:      false
  });
  if (isNew) nshow_new++; else nshow_older++;
}
sessions_detail.sort((a,b) => (a.converted===b.converted ? a.name.localeCompare(b.name) : (a.converted?-1:1)));
const conv_today  = conv_new  + conv_older;
const nshow_today = nshow_new + nshow_older;
const total_sessions = sessions_detail.length;

let attempted_new = 0;
for (const doc of newLeadDocs) {
  if (telecrmStages(doc).some(s => s.status === 'No Response' &&
      stageTimeOnDay(s, iso_date))) {
    attempted_new++;
  }
}

const older_bucket_sum = nr_older + ip_older + sb_older + nc_older + conv_older + nshow_older;
const fresh_older      = Math.max(0, older_leads - older_bucket_sum);

const timing = { 'T+0': 0, 'T+1': 0, 'T+2': 0, '>T+2': 0 };
const IST_OFFSET = 5.5 * 3600 * 1000;
let p0_contacted = 0, p0_uncontacted = 0;
let p1_contacted = 0, p1_uncontacted = 0;
for (const doc of newLeadDocs) {
  const created      = createdMs(doc);
  const firstContact = firstContactMs(doc);
  const isContacted  = firstContact != null;
  const isP0         = created < p0_threshold;
  if (isP0) { if (isContacted) p0_contacted++; else p0_uncontacted++; }
  else      { if (isContacted) p1_contacted++; else p1_uncontacted++; }
  if (!isContacted) continue;
  const cd  = new Date(created      + IST_OFFSET).toISOString().slice(0, 10);
  const fcd = new Date(firstContact + IST_OFFSET).toISOString().slice(0, 10);
  const d_days = Math.round((Date.parse(fcd) - Date.parse(cd)) / 86400000);
  if      (d_days <= 0) timing['T+0']++;
  else if (d_days === 1) timing['T+1']++;
  else if (d_days === 2) timing['T+2']++;
  else                   timing['>T+2']++;
}
const p0_total = p0_contacted + p0_uncontacted;
const p1_total = p1_contacted + p1_uncontacted;
const p0 = p0_contacted, p1 = p1_contacted, p_unknown = 0;
const total_contacts = p0 + p1;

const plat_stats = {};
const fb_ads_counter = {};
const new_lead_conv_phones  = new Set();
const new_lead_nshow_phones = new Set();
for (const s of sessions_detail) {
  if (!s.converted && s.phone) new_lead_nshow_phones.add(normPhone(s.phone));
  if (s.converted && s.phone)  new_lead_conv_phones.add(normPhone(s.phone));
}
for (const doc of newLeadDocs) {
  const platform = getPlatform(doc);
  const category = getCategory(doc);
  const key = platform + '\u0001' + category;
  if (!plat_stats[key]) {
    plat_stats[key] = { platform, category, volume: 0, sb: 0, nr: 0, ip: 0, nc: 0, fresh: 0, conv: 0, nshow: 0 };
  }
  const cell = plat_stats[key];
  cell.volume++;
  const ph = normPhone(String(doc.phone || ''));
  const st = eodStatus(doc, iso_date);
  if      (new_lead_conv_phones.has(ph))  cell.conv++;
  else if (new_lead_nshow_phones.has(ph)) cell.nshow++;
  else if (HOT_STATUSES.has(st))          cell.sb++;
  else if (CONVERTED_STATUSES.has(st))    cell.sb++;
  else if (st === 'Fresh')                cell.fresh++;
  else if (st === 'No Response')          cell.nr++;
  else if (st === 'In Pipeline')          cell.ip++;
  else if (st === 'Not Converted')        cell.nc++;
  else if (NSHOW_STATUSES.has(st))        cell.nshow++;

  if (META_PLATFORMS.has(platform)) {
    const [ad, campaign] = getAdInfo(doc);
    const k = ad + '\u0001' + campaign;
    fb_ads_counter[k] = (fb_ads_counter[k] || 0) + 1;
  }
}
const fb_ads = Object.entries(fb_ads_counter)
  .map(([k, count]) => {
    const [ad, campaign] = k.split('\u0001');
    return { ad: ad || '\u2014', campaign: campaign || '\u2014', count };
  })
  .sort((a, b) => b.count - a.count)
  .slice(0, 5);

const bookings_detail = [];
const _seen_booking = new Set();
for (const doc of [...newLeadDocs, ...olderStageDocs]) {
  const _bph = String(doc.phone || '');
  if (_seen_booking.has(_bph)) continue;
  _seen_booking.add(_bph);
  if (!telecrmStages(doc).some(s => SB_STATUSES.has(s.status) &&
      stageTimeOnDay(s, iso_date))) continue;
  const [ad, campaign] = getAdInfo(doc);
  bookings_detail.push({
    name:     doc.name || '—',
    phone:    String(doc.phone || '—'),
    branch:   getBranch(doc),
    platform: getPlatform(doc),
    category: getCategory(doc),
    ad,
    campaign
  });
}

const nc_by_platform = platStats.map(r => ({
  platform: r._id || 'Unknown',
  count:    r.count
}));
const nc_total = nc_new + nc_older;

// Section 7: temperature computed in the Mongo facet (no writes). JS fallback if empty.
let hot = 0, warm = 0, cold = 0;
for (const r of tempCounts) {
  const b = r._id || ''; const c = r.count || 0;
  if      (b === 'Hot')  hot  += c;
  else if (b === 'Warm') warm += c;
  else if (b === 'Cold') cold += c;
}
if (!hot && !warm && !cold) {
  const nowMs = Date.now();
  const seen = new Set();
  for (const doc of [...newLeadDocs, ...olderLeadDocs, ...olderStageDocs, ...sessionsDocs]) {
    const id = String(doc.phone || doc._id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const bucket = classifyTemp(doc, nowMs);
    if (bucket === 'Hot') hot++;
    else if (bucket === 'Warm') warm++;
    else if (bucket === 'Cold') cold++;
  }
}
const total_pipeline = hot + warm + cold;

const wtd_new_leads  = wtdNewLeadsDoc.count  != null ? wtdNewLeadsDoc.count  : new_leads;
const prev_new_leads = prevNewLeadsDoc.count != null ? prevNewLeadsDoc.count : 0;
const wtd_bookings   = wtdBookingsDoc.count  != null ? wtdBookingsDoc.count  : 0;
const prev_bookings  = prevBookingsDoc.count != null ? prevBookingsDoc.count : 0;
const wtd_conv   = (wtdDoc      && wtdDoc.conv)      || 0;
const wtd_nshow  = (wtdDoc      && wtdDoc.nshow)     || 0;
const prev_conv  = (prevWeekDoc && prevWeekDoc.conv) || 0;
const prev_nshow = (prevWeekDoc && prevWeekDoc.nshow)|| 0;
const wtd_total  = wtd_conv  + wtd_nshow;
const prev_total = prev_conv + prev_nshow;
const wtd_conv_rate   = wtd_total  ? Math.round(1000 * wtd_conv  / wtd_total)  / 10 : 0;
const prev_conv_rate  = prev_total ? Math.round(1000 * prev_conv / prev_total) / 10 : 0;
const wtd_nshow_rate  = wtd_total  ? Math.round(1000 * wtd_nshow / wtd_total)  / 10 : 0;
const prev_nshow_rate = prev_total ? Math.round(1000 * prev_nshow/ prev_total) / 10 : 0;
const wtd_conv_pp  = Math.round(10 * (wtd_conv_rate  - prev_conv_rate))  / 10;
const wtd_nshow_pp = Math.round(10 * (wtd_nshow_rate - prev_nshow_rate)) / 10;

const _pad = (v, n) => String(v == null ? '' : v).padEnd(n);
const _padL = (v, n) => String(v == null ? '' : v).padStart(n);
const total_lv  = new_leads + older_leads;
const conv_pct  = total_sessions ? (100 * conv_today  / total_sessions).toFixed(1) : '0.0';
const nshow_pct = total_sessions ? (100 * nshow_today / total_sessions).toFixed(1) : '0.0';
const act_new   = fresh_new + nr_new + ip_new + sb_new + conv_new + nc_new + nshow_new;
const act_older = fresh_older + nr_older + ip_older + sb_older + conv_older + nc_older + nshow_older;
const slack_table_rows = [
  ['Metric',            'New',  'Older', 'Total'],
  ['─'.repeat(19),      '─'.repeat(5), '─'.repeat(5), '─'.repeat(5)],
  ['Lead Volume',       new_leads,  older_leads,  total_lv],
  ['→ Fresh',           fresh_new,  fresh_older,  fresh_new + fresh_older],
  ['→ Attempted',       nr_new,     nr_older,     nr_new + nr_older],
  ['→ In Pipeline',     ip_new,     ip_older,     ip_new + ip_older],
  ['→ Session Booked',  sb_new,     sb_older,     sb_new + sb_older],
  ['→ Converted',       conv_new,   conv_older,   conv_today],
  ['→ Not Converted',   nc_new,     nc_older,     nc_total],
  ['→ No Show',         nshow_new,  nshow_older,  nshow_today],
  ['─'.repeat(19),      '─'.repeat(5), '─'.repeat(5), '─'.repeat(5)],
  ['Activity Total',    act_new,    act_older,    act_new + act_older],
];
const slack_table = slack_table_rows.map(r =>
  _pad(r[0], 20) + ' ' + _padL(r[1], 5) + '  ' + _padL(r[2], 5) + '  ' + _padL(r[3], 5)
).join('\n');
const slack_summary =
  '*Stance CRM — Daily Analytics (new-telecrm) — ' + date_label + '*\n\n' +
  '*Section 1 — Lead Summary*\n```\n' + slack_table + '\n```\n' +
  '*Sessions today:* ' + total_sessions + ' unique patients · ' +
  'Converted: ' + conv_today + ' (' + conv_pct + '%) · ' +
  'No Show: ' + nshow_today + ' (' + nshow_pct + '%)\n' +
  '*New-lead contact rate:* ' + (p0_contacted + p1_contacted) + '/' + (p0_total + p1_total) +
  ' (' + ((p0_total + p1_total) ? (100*(p0_contacted + p1_contacted)/(p0_total + p1_total)).toFixed(1) : '0.0') + '%)\n\n' +
  '_Full report files attached below._';

return [{
  json: {
    date_label, iso_date,
    new_leads, older_leads, fresh_older, attempted_new,
    fresh_new, nr_new, ip_new, sb_new, conv_new_s1, nc_new, nshow_new_s1,
    sb_older, nr_older, ip_older, nc_older,
    conv_today, conv_new, conv_older,
    nshow_today, nshow_new, nshow_older,
    timing, p0, p1, p_unknown,
    p0_total, p1_total, p0_contacted, p0_uncontacted, p1_contacted, p1_uncontacted,
    total_contacts,
    plat_stats: Object.values(plat_stats),
    fb_ads,
    bookings_detail,
    sessions_detail,
    total_sessions,
    nc_by_platform, nc_total,
    hot, warm, cold, total_pipeline,
    wtd_new_leads, prev_new_leads,
    wtd_bookings, prev_bookings,
    wtd_total, wtd_conv, wtd_nshow,
    prev_total, prev_conv, prev_nshow,
    wtd_conv_rate, prev_conv_rate, wtd_nshow_rate, prev_nshow_rate,
    wtd_conv_pp, wtd_nshow_pp,
    slack_summary
  }
}];
