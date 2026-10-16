const reportData = $input.first().json;
function normPhone(p) {
  if (p == null) return null;
  let s = String(p).trim().replace(/^\+/, '');
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2);
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
  return s;
}
const apptByPhone = {};
for (const it of $('Flatten to Tagged Items').all()) {
  const j = (it && it.json) || {};
  if (j._queryType !== 'appointments_today') continue;
  const ph = normPhone(j._id || j.phone);
  if (ph) apptByPhone[ph] = j;
}
let enriched = 0;
for (const row of (reportData.sessions_detail || [])) {
  const a = apptByPhone[normPhone(row.phone)];
  if (a && a.appt_status) {
    row.appt_status   = a.appt_status;
    row.cancel_reason = a.cancel_reason || null;
    enriched++;
  }
}
console.log('[enrich] populated appt_status on ' + enriched + '/' + (reportData.sessions_detail || []).length + ' session rows');
return [{ json: reportData, pairedItem: { item: 0 } }];
