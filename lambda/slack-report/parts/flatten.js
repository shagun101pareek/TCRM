const FACET_BUCKETS = ["new_leads", "older_leads", "older_stage", "status_counts", "plat_stats", "sessions", "temperature", "wtd_new_leads_count", "prev_new_leads_count", "wtd_bookings_count", "prev_bookings_count", "fv_bookings"];
const items = [];
let standaloneSeen = 0;
for (const it of $input.all()) {
  const j = (it && it.json) || {};
  const isFacet = FACET_BUCKETS.every(k => Array.isArray(j[k]));
  if (isFacet) {
    for (const b of FACET_BUCKETS) {
      for (const d of j[b]) {
        items.push({ json: { ...d, _queryType: b }, pairedItem: { item: 0 } });
      }
    }
    continue;
  }
  if ('appt_status' in j || 'cancel_reason' in j) {
    items.push({ json: { ...j, _queryType: 'appointments_today' }, pairedItem: { item: 0 } });
    continue;
  }
  const qtype = standaloneSeen === 0 ? 'wtd' : 'prev_week_sessions';
  standaloneSeen++;
  items.push({ json: { ...j, _queryType: qtype }, pairedItem: { item: 0 } });
}
return items;
