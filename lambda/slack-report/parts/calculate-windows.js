const IST_OFFSET_MS = 19800000;

let inputJson = {};
try { inputJson = $input.first().json; } catch(e) { try { inputJson = $json; } catch(e2) {} }

const rawDate = String(inputJson.test_date || '').trim();
let y, m, d;
if (rawDate.length === 10 && rawDate[4] === '-' && rawDate[7] === '-') {
  y = parseInt(rawDate.slice(0,4), 10);
  m = parseInt(rawDate.slice(5,7), 10);
  d = parseInt(rawDate.slice(8,10), 10);
} else {
  const istYesterday = new Date(Date.now() + IST_OFFSET_MS - 86400000);
  y = istYesterday.getUTCFullYear();
  m = istYesterday.getUTCMonth() + 1;
  d = istYesterday.getUTCDate();
}

const start_ms = Date.UTC(y, m-1, d) - IST_OFFSET_MS;
const end_ms   = start_ms + 86400000;
const pad = n => String(n).padStart(2,'0');
const iso_date      = `${y}-${pad(m)}-${pad(d)}`;
const nextIst       = new Date(start_ms + 86400000 + IST_OFFSET_MS);
const iso_date_next = `${nextIst.getUTCFullYear()}-${pad(nextIst.getUTCMonth()+1)}-${pad(nextIst.getUTCDate())}`;
const start_utc_iso = new Date(start_ms).toISOString();
const end_utc_iso   = new Date(end_ms).toISOString();

const istDay       = new Date(start_ms + IST_OFFSET_MS);
const weekday      = istDay.getUTCDay();
const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
const weekStartIst = new Date(istDay.getTime() + mondayOffset * 86400000);
const week_start_ms      = Date.UTC(weekStartIst.getUTCFullYear(), weekStartIst.getUTCMonth(), weekStartIst.getUTCDate()) - IST_OFFSET_MS;
const prev_week_start_ms = week_start_ms - 7*86400000;
const prev_week_end_ms   = week_start_ms;

const istClockIso = ms => {
  const dt = new Date(ms + IST_OFFSET_MS);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}.000Z`;
};
const start_ist_iso        = istClockIso(start_ms);
const end_ist_iso          = istClockIso(end_ms);
const week_start_ist_iso   = istClockIso(week_start_ms);
const prev_week_start_ist_iso = istClockIso(prev_week_start_ms);
const prev_week_end_ist_iso   = istClockIso(prev_week_end_ms);
const toIsoDate = ms => { const dt = new Date(ms+IST_OFFSET_MS); return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth()+1)}-${pad(dt.getUTCDate())}`; };

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

return [{ json: {
  start_ms, end_ms, iso_date, iso_date_next,
  start_utc_iso, end_utc_iso,
  start_ist_iso, end_ist_iso, week_start_ist_iso, prev_week_start_ist_iso, prev_week_end_ist_iso,
  week_start_ms, prev_week_start_ms, prev_week_end_ms,
  week_start_utc_iso:      new Date(week_start_ms).toISOString(),
  prev_week_start_utc_iso: new Date(prev_week_start_ms).toISOString(),
  prev_week_end_utc_iso:   new Date(prev_week_end_ms).toISOString(),
  wtd_iso_start: toIsoDate(week_start_ms),
  prev_iso_start: toIsoDate(prev_week_start_ms),
  prev_iso_end: toIsoDate(prev_week_end_ms),
  p0_threshold: start_ms + 17*3600000,
  date_label: `${d} ${MONTHS[m-1]} ${y}${rawDate ? ' (test)' : ''}`,
  y, m, d, is_test: rawDate.length === 10
}}];
