const d = $input.item.json;

const total_s     = d.total_sessions;
const conv        = d.conv_today;
const nshow       = d.nshow_today;
const conv_rate   = total_s ? Math.round(100 * conv / total_s * 10) / 10 : 0;
const nshow_rate  = total_s ? Math.round(100 * nshow / total_s * 10) / 10 : 0;
const wtd_conv_rate   = d.wtd_total  ? Math.round(100 * d.wtd_conv  / d.wtd_total  * 10) / 10 : 0;
const prev_conv_rate  = d.prev_total ? Math.round(100 * d.prev_conv / d.prev_total * 10) / 10 : 0;
const wtd_nshow_rate  = d.wtd_total  ? Math.round(100 * d.wtd_nshow  / d.wtd_total  * 10) / 10 : 0;
const prev_nshow_rate = d.prev_total ? Math.round(100 * d.prev_nshow / d.prev_total * 10) / 10 : 0;

const kpi_new   = d.new_leads;
const kpi_sb    = d.sb_new + d.sb_older;
const nc_total  = d.nc_total;

const other_new = d.new_leads - (d.fresh_new + d.nr_new + d.ip_new +
                                  d.sb_new + d.conv_new + d.nc_new + d.nshow_new);

let s1_labels = ['Fresh', 'Attempted', 'In Pipeline', 'Session Booked',
                 'Converted', 'Not Converted', 'No Show'];
let s1_values = [d.fresh_new, d.nr_new, d.ip_new, d.sb_new,
                 d.conv_new, d.nc_new, d.nshow_new];
if (other_new > 0) { s1_labels.push('Other'); s1_values.push(other_new); }
const s1_colors = ['#94a3b8','#f59e0b','#3b82f6','#8b5cf6','#22c55e','#ef4444','#f97316','#64748b'];

const timing_labels = Object.keys(d.timing);
const timing_values = Object.values(d.timing);

const plat_items = (d.plat_stats || []).slice().sort((a, b) => b.volume - a.volume);
const plat_names = plat_items.map(v => v.platform);
const ps_sb      = plat_items.map(v => v.sb);
const ps_nr      = plat_items.map(v => v.nr);
const ps_ip      = plat_items.map(v => v.ip);
const ps_nc      = plat_items.map(v => v.nc);
const ps_fresh   = plat_items.map(v => v.fresh);
const ps_conv    = plat_items.map(v => v.conv);
const ps_nshow   = plat_items.map(v => v.nshow);

const nc_labels = (d.nc_by_platform || []).map(r => r.platform);
const nc_values = (d.nc_by_platform || []).map(r => r.count);

const temp_labels = ['Hot','Warm','Cold'];
const temp_values = [d.hot, d.warm, d.cold];
const temp_colors = ['#ef4444','#f59e0b','#94a3b8'];

const wtd_metrics = ['New Leads','Bookings','Sessions','Converted','No Shows'];
const wtd_current = [d.wtd_new_leads, d.wtd_bookings, d.wtd_total, d.wtd_conv, d.wtd_nshow];
const wtd_prev    = [d.prev_new_leads, d.prev_bookings, d.prev_total, d.prev_conv, d.prev_nshow];

const fb_top5      = (d.fb_ads || []).slice(0, 5);
const fb_ad_labels = fb_top5.map(a => a.ad.length > 38 ? a.ad.slice(0, 38) + '\u2026' : a.ad);
const fb_ad_full   = fb_top5.map(a => a.ad);
const fb_campaigns = fb_top5.map(a => a.campaign);
const fb_ad_values = fb_top5.map(a => a.count);

function j(v) { return JSON.stringify(v); }

function pct_h(n, denom) {
  return denom ? `${(100*n/denom).toFixed(1)}%` : '\u2014';
}

function pp_h(diff) {
  const cls  = diff >= 0 ? 'pos' : 'neg';
  const sign = diff >= 0 ? '+' : '';
  return `<span class="${cls}">${sign}${diff.toFixed(1)}pp</span>`;
}

function chg_h(cur, prev) {
  if (!prev) return '\u2014';
  const delta = (cur - prev) / prev * 100;
  const cls  = delta >= 0 ? 'pos' : 'neg';
  const sign = delta >= 0 ? '+' : '';
  return `<span class="${cls}">${sign}${delta.toFixed(1)}%</span>`;
}

let sess_rows = '';
for (const s of (d.sessions_detail || [])) {
  const yn_cls = s.converted ? 'converted' : 'noshow';
  const yn_txt = s.converted ? 'Yes' : 'No';
  sess_rows += `<tr><td>${s.name}</td><td>${s.branch}</td>` +
    `<td>${s.platform}</td><td>${s.appt_status}</td>` +
    `<td>${s.telecrm_status}</td>` +
    `<td><span class="badge ${yn_cls}">${yn_txt}</span></td></tr>`;
}

let booking_rows = '';
for (const b of (d.bookings_detail || [])) {
  booking_rows += `<tr><td>${b.name}</td><td>${b.branch}</td>` +
    `<td>${b.platform}</td><td>${b.category}</td>` +
    `<td class="ad-cell">${b.ad}</td></tr>`;
}

let plat_tbl = '';
for (const v of plat_items) {
  plat_tbl += `<tr><td>${v.platform}</td><td>${v.category}</td><td><b>${v.volume}</b></td>` +
    `<td>${v.sb}</td><td>${v.nr}</td><td>${v.ip}</td>` +
    `<td>${v.nc}</td><td>${v.conv}</td><td>${v.fresh}</td><td>${v.nshow}</td></tr>`;
}

const plat_vol_total   = plat_items.reduce((s,v) => s+v.volume,0);
const plat_sb_total    = plat_items.reduce((s,v) => s+v.sb,0);
const plat_nr_total    = plat_items.reduce((s,v) => s+v.nr,0);
const plat_ip_total    = plat_items.reduce((s,v) => s+v.ip,0);
const plat_nc_total    = plat_items.reduce((s,v) => s+v.nc,0);
const plat_conv_total  = plat_items.reduce((s,v) => s+v.conv,0);
const plat_fr_total    = plat_items.reduce((s,v) => s+v.fresh,0);
const plat_ns_total    = plat_items.reduce((s,v) => s+v.nshow,0);

const timing_total = timing_values.reduce((s,v) => s+v, 0);

const nc_plat_rows = (d.nc_by_platform||[]).map(r =>
  `<tr><td>${r.platform}</td><td>${r.count}</td><td>${pct_h(r.count,nc_total)}</td></tr>`
).join('');

const lag_rows = Object.entries(d.timing).map(([b,c]) =>
  `<tr><td>${b}</td><td>${c}</td></tr>`
).join('');

let fb_section = '';
if (fb_top5.length > 0) {
  const fb_rows = fb_top5.map((a, i) => {
    const campTrunc = fb_campaigns[i].length > 40 ? fb_campaigns[i].slice(0,40)+'\u2026' : fb_campaigns[i];
    return `<tr><td>${i+1}</td><td class="ad-cell" title="${fb_ad_full[i]}">${fb_ad_labels[i]}</td><td class="ad-cell" title="${fb_campaigns[i]}">${campTrunc}</td><td><b>${fb_ad_values[i]}</b></td></tr>`;
  }).join('');
  const fb_chart_js = `fit("fbAdsChart","bar",{labels:${j(fb_ad_labels)},datasets:[{label:"Leads",data:${j(fb_ad_values)},backgroundColor:"#3b82f6",borderRadius:5,borderSkipped:false}]},{indexAxis:"y",plugins:{legend:{display:false}},scales:{x:{ticks:{stepSize:1}},y:{grid:{display:false}}}});`;
  fb_section = `<div class="section"><div class="section-title">Meta \u2014 Top Ad Creatives</div><div class="split wide-chart"><div class="chart-side"><div class="chart-wrap h200"><canvas id="fbAdsChart"></canvas></div></div><div class="table-side"><table><thead><tr><th>#</th><th>Ad Creative</th><th>Campaign</th><th>Leads</th></tr></thead><tbody>${fb_rows}</tbody></table></div></div></div>\n<!-- fbChartJs:${fb_chart_js} -->`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stance CRM \u2014 Daily Analytics (new-telecrm) \u2014 ${d.date_label}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>
@page{size:A4 landscape;margin:6mm}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#1e293b;font-size:11px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:100%;margin:0 auto;padding:8px 6px}
.section,.split,.grid2,.grid3{break-inside:avoid;page-break-inside:avoid}
header{margin-bottom:24px}
header h1{font-size:1.5rem;font-weight:700;color:#0f172a}
header p{color:#64748b;margin-top:3px;font-size:.85rem}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:20px}
.kpi{background:#fff;border-radius:10px;padding:16px 18px;box-shadow:0 1px 3px rgba(0,0,0,.07)}
.kpi .lbl{font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;font-weight:600;margin-bottom:5px}
.kpi .val{font-size:1.8rem;font-weight:700;line-height:1}
.kpi .sub{font-size:.72rem;color:#94a3b8;margin-top:3px}
.kpi.green .val{color:#16a34a}.kpi.red .val{color:#dc2626}
.kpi.blue .val{color:#2563eb}.kpi.purple .val{color:#7c3aed}
.section{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.07);margin-bottom:18px;overflow:hidden}
.section-title{font-size:.88rem;font-weight:700;color:#334155;padding:14px 18px 10px;border-bottom:1px solid #f1f5f9}
.split{display:grid;grid-template-columns:1fr 1fr;gap:0}
.split.wide-chart{grid-template-columns:42% 58%}
.split.narrow-chart{grid-template-columns:28% 72%}
.chart-side{padding:16px 18px;border-right:1px solid #f8fafc}
.table-side{padding:12px 16px;overflow-x:auto}
.chart-wrap{position:relative}
.chart-wrap.h200{height:200px}.chart-wrap.h240{height:240px}
.chart-wrap.h280{height:280px}.chart-wrap.h320{height:320px}
table{width:100%;border-collapse:collapse;font-size:.7rem;table-layout:auto;word-wrap:break-word;overflow-wrap:break-word}
th{background:#f8fafc;color:#64748b;font-weight:600;text-align:left;padding:5px 6px;border-bottom:2px solid #e2e8f0;word-wrap:break-word}
td{padding:4px 6px;border-bottom:1px solid #f1f5f9;vertical-align:middle;color:#374151;word-wrap:break-word;overflow-wrap:break-word}
tr:last-child td{border-bottom:none}
tr:hover td{background:#fafbfc}
td.num{text-align:right;font-variant-numeric:tabular-nums}
td b{color:#1e293b}
.ad-cell{max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.66rem}
.table-side{padding:8px 10px;overflow:hidden}
.chart-side{padding:10px 12px;border-right:1px solid #f8fafc;display:flex;align-items:center;justify-content:center}
.chart-side .chart-wrap{width:100%}
tfoot td{font-weight:700;color:#1e293b;border-top:2px solid #e2e8f0;border-bottom:none}
.badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:.7rem;font-weight:600}
.badge.converted{background:#dcfce7;color:#16a34a}
.badge.noshow{background:#fee2e2;color:#dc2626}
.pos{color:#16a34a;font-weight:600}.neg{color:#dc2626;font-weight:600}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;margin-bottom:18px}
</style>
</head>
<body>
<div class="page">

<header>
  <h1>Stance CRM \u2014 Daily Analytics (new-telecrm)</h1>
  <p>${d.date_label} &nbsp;\u00b7&nbsp; 00:00 \u2013 23:59 IST</p>
</header>

<div class="kpis">
  <div class="kpi blue"><div class="lbl">Total Leads</div><div class="val">${kpi_new}</div><div class="sub">new today</div></div>
  <div class="kpi purple"><div class="lbl">Session Bookings</div><div class="val">${d.sb_new}</div><div class="sub">new today</div></div>
  <div class="kpi"><div class="lbl">Sessions Today</div><div class="val">${total_s}</div><div class="sub">unique patients</div></div>
  <div class="kpi green"><div class="lbl">Converted</div><div class="val">${conv}</div><div class="sub">Rate ${conv_rate}%</div></div>
  <div class="kpi red"><div class="lbl">No Shows</div><div class="val">${nshow}</div><div class="sub">Rate ${nshow_rate}%</div></div>
  <div class="kpi"><div class="lbl">Not Converted</div><div class="val">${d.nc_new}</div><div class="sub">new today</div></div>
</div>

<div class="grid2">
  <div class="section">
    <div class="section-title">1. New Leads Breakdown \u2014 by Current Status</div>
    <div class="split">
      <div class="chart-side"><div class="chart-wrap h240"><canvas id="s1Chart"></canvas></div></div>
      <div class="table-side">
        <table>
          <thead><tr><th>Status</th><th>New</th><th>Older</th><th>Total</th></tr></thead>
          <tbody>
            <tr><td><em>Lead Volume</em></td><td><em>${d.new_leads}</em></td><td><em>${d.older_leads}</em></td><td><em>${d.new_leads + d.older_leads}</em></td></tr>
            <tr><td>\u2192 Fresh</td><td>${d.fresh_new}</td><td>${d.fresh_older || 0}</td><td>${d.fresh_new + (d.fresh_older || 0)}</td></tr>
            <tr><td>\u2192 Attempted</td><td>${d.nr_new}</td><td>${d.nr_older || 0}</td><td>${d.nr_new + (d.nr_older || 0)}</td></tr>
            <tr><td>\u2192 In Pipeline</td><td>${d.ip_new}</td><td>${d.ip_older || 0}</td><td>${d.ip_new + (d.ip_older || 0)}</td></tr>
            <tr><td>\u2192 Session Booked</td><td>${d.sb_new}</td><td>${d.sb_older}</td><td>${kpi_sb}</td></tr>
            <tr><td>\u2192 Converted</td><td>${d.conv_new}</td><td>${d.conv_older}</td><td><b>${conv}</b></td></tr>
            <tr><td>\u2192 Not Converted</td><td>${d.nc_new}</td><td>${d.nc_older}</td><td>${nc_total}</td></tr>
            <tr><td>\u2192 No Show</td><td>${d.nshow_new}</td><td>${d.nshow_older}</td><td><b>${nshow}</b></td></tr>
          </tbody>
          <tfoot><tr><td><b>Activity Total</b></td><td><b>${d.fresh_new + d.nr_new + d.ip_new + d.sb_new + d.conv_new + d.nc_new + d.nshow_new}</b></td><td><b>${(d.fresh_older || 0) + (d.nr_older || 0) + (d.ip_older || 0) + d.sb_older + d.conv_older + d.nc_older + d.nshow_older}</b></td><td><b>${(d.fresh_new + d.nr_new + d.ip_new + d.sb_new + d.conv_new + d.nc_new + d.nshow_new) + ((d.fresh_older || 0) + (d.nr_older || 0) + (d.ip_older || 0) + d.sb_older + d.conv_older + d.nc_older + d.nshow_older)}</b></td></tr></tfoot>
        </table>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">7. Total Pipeline Temperature</div>
    <div class="split">
      <div class="chart-side"><div class="chart-wrap h240"><canvas id="tempChart"></canvas></div></div>
      <div class="table-side">
        <table>
          <thead><tr><th>Bucket</th><th>Count</th><th>%</th></tr></thead>
          <tbody>
            <tr><td>\ud83d\udd34 Hot</td><td>${d.hot}</td><td>${pct_h(d.hot,d.total_pipeline)}</td></tr>
            <tr><td>\ud83d\udfe1 Warm</td><td>${d.warm}</td><td>${pct_h(d.warm,d.total_pipeline)}</td></tr>
            <tr><td>\u26ab Cold</td><td>${d.cold}</td><td>${pct_h(d.cold,d.total_pipeline)}</td></tr>
          </tbody>
          <tfoot><tr><td>Total</td><td>${d.total_pipeline}</td><td>100%</td></tr></tfoot>
        </table>
      </div>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">3. Lead Source Breakdown \u2014 Today's New Leads</div>
  <div class="split wide-chart">
    <div class="chart-side"><div class="chart-wrap h280"><canvas id="platChart"></canvas></div></div>
    <div class="table-side">
      <table>
        <thead><tr><th>Platform</th><th>Category</th><th>Vol</th><th>SB</th><th>NR</th><th>IP</th><th>NC</th><th>Conv</th><th>Fresh</th><th>NS</th></tr></thead>
        <tbody>${plat_tbl}</tbody>
        <tfoot><tr>
          <td colspan="2">Total</td>
          <td>${plat_vol_total}</td><td>${plat_sb_total}</td><td>${plat_nr_total}</td><td>${plat_ip_total}</td>
          <td>${plat_nc_total}</td><td>${plat_conv_total}</td><td>${plat_fr_total}</td><td>${plat_ns_total}</td>
        </tr></tfoot>
      </table>
    </div>
  </div>
</div>

<div class="grid2">
  <div class="section">
    <div class="section-title">2a. Creation-to-First-Contact Lag</div>
    <div class="split">
      <div class="chart-side"><div class="chart-wrap h200"><canvas id="lagChart"></canvas></div></div>
      <div class="table-side">
        <table>
          <thead><tr><th>Bucket</th><th>Count</th></tr></thead>
          <tbody>${lag_rows}</tbody>
          <tfoot><tr><td>Total</td><td>${timing_total}</td></tr></tfoot>
        </table>
      </div>
    </div>
  </div>

    <div class="section">
    <div class="section-title">2b. New Leads \u2014 Creation Window \u00d7 Contacted</div>
    <div class="split">
      <div class="chart-side"><div class="chart-wrap h200"><canvas id="p01Chart"></canvas></div></div>
      <div class="table-side">
        <table>
          <thead><tr><th>Window</th><th>Total</th><th>Contacted</th><th>Contacted %</th></tr></thead>
          <tbody>
            <tr><td>Before 5 PM (P0)</td><td>${d.p0_total}</td><td>${d.p0_contacted}</td><td>${d.p0_total ? (100*d.p0_contacted/d.p0_total).toFixed(1) : "0.0"}%</td></tr>
            <tr><td>After 5 PM (P1)</td><td>${d.p1_total}</td><td>${d.p1_contacted}</td><td>${d.p1_total ? (100*d.p1_contacted/d.p1_total).toFixed(1) : "0.0"}%</td></tr>
          </tbody>
          <tfoot><tr><td>Total</td><td>${d.p0_total+d.p1_total}</td><td>${d.p0_contacted+d.p1_contacted}</td><td>${(d.p0_total+d.p1_total) ? (100*(d.p0_contacted+d.p1_contacted)/(d.p0_total+d.p1_total)).toFixed(1) : "0.0"}%</td></tr></tfoot>
        </table>
        <p style="font-size:.7rem;color:#94a3b8;margin-top:8px">${d.p0_total+d.p1_total} new leads \u00b7 split by created_on (5 PM IST) and whether <code>telecrm_first_interaction_date</code> is set</p>
      </div>
    </div>
  </div>
</div>

<div class="section">
  <div class="section-title">5. Sessions Today \u2014 Conversions &amp; No-Shows (${total_s} unique patients \u00b7 ${conv_rate}% conversion rate)</div>
  <div class="split narrow-chart">
    <div class="chart-side"><div class="chart-wrap h240"><canvas id="sessChart"></canvas></div></div>
    <div class="table-side">
      <table>
        <thead><tr><th>Patient</th><th>Branch</th><th>Platform</th><th>Appt Status</th><th>CRM Status</th><th>Converted?</th></tr></thead>
        <tbody>${sess_rows}</tbody>
      </table>
    </div>
  </div>
</div>

<div class="grid2">
  <div class="section">
    <div class="section-title">4. Session Bookings Today (${(d.bookings_detail||[]).length} total)</div>
    <div class="split narrow-chart">
      <div class="chart-side"><div class="chart-wrap h200"><canvas id="sbChart"></canvas></div></div>
      <div class="table-side">
        <table>
          <thead><tr><th>Name</th><th>Branch</th><th>Platform</th><th>Category</th><th>Ad</th></tr></thead>
          <tbody>${booking_rows}</tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">6. Not Converted Today \u2014 by Platform (${nc_total} total)</div>
    <div class="split">
      <div class="chart-side"><div class="chart-wrap h200"><canvas id="ncPlatChart"></canvas></div></div>
      <div class="table-side">
        <table>
          <thead><tr><th>Platform</th><th>Count</th><th>%</th></tr></thead>
          <tbody>${nc_plat_rows}</tbody>
          <tfoot><tr><td>Total</td><td>${nc_total}</td><td>100%</td></tr></tfoot>
        </table>
      </div>
    </div>
  </div>
</div>

${fb_section}

<div class="section">
  <div class="section-title">8. Week-to-Date vs Previous Week</div>
  <div class="split wide-chart">
    <div class="chart-side"><div class="chart-wrap h240"><canvas id="wtdChart"></canvas></div></div>
    <div class="table-side">
      <table>
        <thead><tr><th>Metric</th><th>This Week</th><th>Prev Week</th><th>Change</th></tr></thead>
        <tbody>
          <tr><td>New Leads</td><td>${d.wtd_new_leads}</td><td>${d.prev_new_leads}</td><td>${chg_h(d.wtd_new_leads,d.prev_new_leads)}</td></tr>
          <tr><td>Session Bookings</td><td>${d.wtd_bookings}</td><td>${d.prev_bookings}</td><td>${chg_h(d.wtd_bookings,d.prev_bookings)}</td></tr>
          <tr><td>FIRST_VISIT Sessions</td><td>${d.wtd_total}</td><td>${d.prev_total}</td><td>${chg_h(d.wtd_total,d.prev_total)}</td></tr>
          <tr><td>Converted</td><td>${d.wtd_conv}</td><td>${d.prev_conv}</td><td>${chg_h(d.wtd_conv,d.prev_conv)}</td></tr>
          <tr><td>No Shows</td><td>${d.wtd_nshow}</td><td>${d.prev_nshow}</td><td>${chg_h(d.wtd_nshow,d.prev_nshow)}</td></tr>
          <tr><td>Conversion Rate</td><td>${wtd_conv_rate.toFixed(1)}%</td><td>${prev_conv_rate.toFixed(1)}%</td><td>${pp_h(d.wtd_conv_pp)}</td></tr>
          <tr><td>No-Show Rate</td><td>${wtd_nshow_rate.toFixed(1)}%</td><td>${prev_nshow_rate.toFixed(1)}%</td><td>${pp_h(d.wtd_nshow_pp)}</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

</div>

<script>
Chart.defaults.font.family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
Chart.defaults.font.size=11;Chart.defaults.color="#64748b";

const fit=(id,type,data,opts={})=>{
  const el=document.getElementById(id);if(!el)return;
  return new Chart(el.getContext("2d"),{
    type,data,
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{position:"bottom",labels:{boxWidth:10,padding:10}}},
      ...opts}
  });
};

fit("s1Chart","doughnut",{
  labels:${j(s1_labels)},
  datasets:[{data:${j(s1_values)},backgroundColor:${j(s1_colors.slice(0,s1_values.length))},borderWidth:2,borderColor:"#fff"}]
},{cutout:"62%"});

fit("tempChart","doughnut",{
  labels:${j(temp_labels)},
  datasets:[{data:${j(temp_values)},backgroundColor:${j(temp_colors)},borderWidth:2,borderColor:"#fff"}]
},{cutout:"62%"});

fit("platChart","bar",{
  labels:${j(plat_names)},
  datasets:[
    {label:"Session Booked",data:${j(ps_sb)},backgroundColor:"#8b5cf6"},
    {label:"No Response",data:${j(ps_nr)},backgroundColor:"#f59e0b"},
    {label:"In Pipeline",data:${j(ps_ip)},backgroundColor:"#3b82f6"},
    {label:"Not Converted",data:${j(ps_nc)},backgroundColor:"#ef4444"},
    {label:"Converted",data:${j(ps_conv)},backgroundColor:"#22c55e"},
    {label:"Fresh",data:${j(ps_fresh)},backgroundColor:"#94a3b8"},
    {label:"No Show",data:${j(ps_nshow)},backgroundColor:"#f97316"},
  ]
},{scales:{x:{stacked:true,grid:{display:false}},y:{stacked:true}},plugins:{legend:{position:"bottom"}}});

fit("lagChart","bar",{
  labels:${j(timing_labels)},
  datasets:[{data:${j(timing_values)},backgroundColor:["#3b82f6","#8b5cf6","#94a3b8","#64748b"],borderRadius:5,borderSkipped:false}]
},{plugins:{legend:{display:false}},scales:{x:{grid:{display:false}},y:{ticks:{stepSize:1}}}});

fit("p01Chart","doughnut",{
  labels:["Before 5 PM","After 5 PM"],
  datasets:[{data:[${d.p0},${d.p1}],backgroundColor:["#3b82f6","#8b5cf6"],borderWidth:2,borderColor:"#fff"}]
},{cutout:"62%"});

fit("sessChart","doughnut",{
  labels:["Converted","No Show"],
  datasets:[{data:[${conv},${nshow}],backgroundColor:["#22c55e","#ef4444"],borderWidth:2,borderColor:"#fff"}]
},{cutout:"62%"});

const sbPlats={};
${j(d.bookings_detail||[])}.forEach(b=>{sbPlats[b.platform]=(sbPlats[b.platform]||0)+1});
fit("sbChart","doughnut",{
  labels:Object.keys(sbPlats),
  datasets:[{data:Object.values(sbPlats),backgroundColor:["#3b82f6","#8b5cf6","#f59e0b","#94a3b8"],borderWidth:2,borderColor:"#fff"}]
},{cutout:"55%"});

fit("ncPlatChart","doughnut",{
  labels:${j(nc_labels)},
  datasets:[{data:${j(nc_values)},backgroundColor:["#f59e0b","#3b82f6","#94a3b8","#8b5cf6","#22c55e"],borderWidth:2,borderColor:"#fff"}]
},{cutout:"55%"});

${fb_top5.length > 0 ? `fit("fbAdsChart","bar",{labels:${j(fb_ad_labels)},datasets:[{label:"Leads",data:${j(fb_ad_values)},backgroundColor:"#3b82f6",borderRadius:5,borderSkipped:false}]},{indexAxis:"y",plugins:{legend:{display:false}},scales:{x:{ticks:{stepSize:1}},y:{grid:{display:false}}}});` : ''}

fit("wtdChart","bar",{
  labels:${j(wtd_metrics)},
  datasets:[
    {label:"This Week",data:${j(wtd_current)},backgroundColor:"#3b82f6",borderRadius:4},
    {label:"Prev Week",data:${j(wtd_prev)},backgroundColor:"#cbd5e1",borderRadius:4},
  ]
},{scales:{x:{grid:{display:false}},y:{ticks:{stepSize:1}}},plugins:{legend:{position:"bottom"}}});

setTimeout(function(){window.chartsReady=true;document.title=document.title+' [ready]';},1500);
<\/script>
</body>
</html>`;

return [{ json: {
  html,
  date_label: d.date_label, iso_date: d.iso_date,
  new_leads: d.new_leads, older_leads: d.older_leads,
  fresh_new: d.fresh_new, nr_new: d.nr_new, ip_new: d.ip_new,
  sb_new: d.sb_new, sb_older: d.sb_older,
  conv_new_s1: d.conv_new_s1, conv_older: d.conv_older, conv_today: d.conv_today,
  nc_new: d.nc_new, nc_older: d.nc_older, nc_total: d.nc_total,
  nshow_new_s1: d.nshow_new_s1, nshow_older: d.nshow_older, nshow_today: d.nshow_today,
  total_sessions: d.total_sessions,
} }];
