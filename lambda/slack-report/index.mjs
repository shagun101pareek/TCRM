import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const root = dirname(fileURLToPath(import.meta.url));
const parts = join(root, 'parts');

function readPart(name) {
  return readFileSync(join(parts, name), 'utf8');
}

function blank(value) {
  return value == null || String(value).trim() === '';
}

function loadConfig() {
  if (blank(process.env.MONGODB_DB)) process.env.MONGODB_DB = 'stance-dashboard';
  const missing = ['MONGODB_URI'].filter((key) => blank(process.env[key]));
  const dryRun = ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN || '').trim().toLowerCase());
  if (!dryRun && blank(process.env.SLACK_BOT_TOKEN)) missing.push('SLACK_BOT_TOKEN');
  if (missing.length) throw new Error('Missing env: ' + missing.join(', '));
  return {
    mongoUri: process.env.MONGODB_URI,
    mongoDb: process.env.MONGODB_DB,
    slackToken: process.env.SLACK_BOT_TOKEN || '',
    slackChannel: process.env.SLACK_CHANNEL || '#daily-leads-new-telecrm',
    gotenbergUrl: String(process.env.GOTENBERG_URL || '').trim(),
    dryRun,
  };
}

function safeMessage(error) {
  const message = error && error.message ? error.message : String(error);
  return message.replace(/mongodb(\+srv)?:\/\/\S+/gi, '[redacted-mongo-uri]');
}

function runCode(code, inputItems, nodes) {
  const $input = {
    all() { return inputItems; },
    first() { return inputItems[0]; },
    get item() { return inputItems[0]; },
  };
  const $json = inputItems[0] ? inputItems[0].json : {};
  const $ = (name) => {
    const node = nodes[name];
    if (!node) throw new Error('Report node is missing: ' + name);
    return node;
  };
  return new Function('$input', '$json', '$', 'console', code)($input, $json, $, console);
}

function asNode(items) {
  return {
    all: () => items,
    first: () => items[0],
    get item() { return items[0]; },
  };
}

function compileQuery(template, windows) {
  let query = template.startsWith('=') ? template.slice(1) : template;
  const expr = String.raw`\$\('Calculate Windows1'\)\.item\.json\.([A-Za-z0-9_]+)`;
  const pattern = new RegExp('"' + '\\{\\{\\s*' + expr + '\\s*\\}\\}' + '"' + '|' + '\\{\\{\\s*' + expr + '\\s*\\}\\}', 'g');
  query = query.replace(pattern, (full, quotedKey, rawKey) => {
    const key = quotedKey || rawKey;
    if (!Object.prototype.hasOwnProperty.call(windows, key)) throw new Error('Missing report window: ' + key);
    return JSON.stringify(windows[key]);
  });
  return JSON.parse(query);
}

const FACET_BUCKETS = ['new_leads', 'older_leads', 'older_stage', 'status_counts', 'plat_stats', 'sessions', 'temperature', 'wtd_new_leads_count', 'prev_new_leads_count', 'wtd_bookings_count', 'prev_bookings_count', 'fv_bookings'];

function emptyFacet() {
  const doc = {};
  for (const key of FACET_BUCKETS) doc[key] = [];
  return doc;
}

let client = null;
async function getDb(config) {
  if (!client) {
    client = new MongoClient(config.mongoUri, { maxPoolSize: 2 });
    await client.connect();
  }
  return client.db(config.mongoDb);
}

async function aggregate(db, collection, pipeline) {
  return db.collection(collection).aggregate(pipeline, { allowDiskUse: true }).toArray();
}

async function slackApi(token, method, body) {
  const response = await fetch('https://slack.com/api/' + method, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!json.ok) throw new Error('Slack ' + method + ' failed: ' + (json.error || response.status));
  return json;
}

async function channelId(token, channel) {
  const name = channel.replace(/^#/, '');
  if (/^[CG][A-Z0-9]+$/.test(name)) return name;
  let cursor = '';
  do {
    const json = await slackApi(token, 'conversations.list', {
      types: 'public_channel,private_channel',
      limit: 200,
      exclude_archived: true,
      cursor,
    });
    const found = (json.channels || []).find((item) => item.name === name);
    if (found) return found.id;
    cursor = json.response_metadata && json.response_metadata.next_cursor;
  } while (cursor);
  throw new Error('Slack channel not found: ' + channel);
}

async function postSummary(token, channel, text) {
  await slackApi(token, 'chat.postMessage', { channel, text });
}

async function uploadFile(token, channel, filename, bytes, title) {
  const id = await channelId(token, channel);
  const form = new URLSearchParams({ filename, length: String(bytes.length) });
  const response = await fetch('https://slack.com/api/files.getUploadURLExternal', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  });
  const meta = await response.json();
  if (!meta.ok) throw new Error('Slack files.getUploadURLExternal failed: ' + (meta.error || response.status));
  const put = await fetch(meta.upload_url, { method: 'POST', body: bytes });
  if (!put.ok) throw new Error('Slack file upload failed: ' + put.status);
  await slackApi(token, 'files.completeUploadExternal', {
    files: [{ id: meta.file_id, title: title || filename }],
    channel_id: id,
  });
}

async function renderPdf(gotenbergUrl, html) {
  const form = new FormData();
  form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
  for (const [key, value] of Object.entries({
    paperWidth: '11.7',
    paperHeight: '8.27',
    landscape: 'true',
    marginTop: '0.25',
    marginBottom: '0.25',
    marginLeft: '0.25',
    marginRight: '0.25',
    printBackground: 'true',
    preferCssPageSize: 'true',
    waitDelay: '3s',
    scale: '1',
  })) form.append(key, value);
  const response = await fetch(gotenbergUrl.replace(/\/$/, '') + '/forms/chromium/convert/html', {
    method: 'POST',
    body: form,
  });
  if (!response.ok) throw new Error('Gotenberg failed: ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}

async function buildReport(db, testDate) {
  const windowsOut = runCode(readPart('calculate-windows.js'), [{ json: { test_date: testDate || '' } }], {});
  const windows = windowsOut[0].json;
  const nodes = { 'Calculate Windows1': asNode([{ json: windows }]) };
  const facetDocs = await aggregate(db, 'new-telecrm', compileQuery(readPart('facet-query.txt'), windows));
  const wtdDocs = await aggregate(db, 'new-telecrm', compileQuery(readPart('wtd-query.txt'), windows));
  const prevDocs = await aggregate(db, 'new-telecrm', compileQuery(readPart('prev-query.txt'), windows));
  const apptDocs = await aggregate(db, 'crm-sync', compileQuery(readPart('appointments-query.txt'), windows));
  const merged = [{ json: facetDocs[0] || emptyFacet() }]
    .concat(wtdDocs.map((doc) => ({ json: doc })))
    .concat(prevDocs.map((doc) => ({ json: doc })))
    .concat(apptDocs.map((doc) => ({ json: doc })));
  const flat = runCode(readPart('flatten.js'), merged, nodes);
  nodes['Flatten to Tagged Items'] = asNode(flat);
  const built = runCode(readPart('build-report.js'), flat, nodes);
  const enriched = runCode(readPart('enrich.js'), built, nodes);
  const htmlOut = runCode(readPart('generate-html.js'), enriched, nodes);
  return { windows, report: htmlOut[0].json };
}

export const handler = async (event) => {
  const source = event || {};
  const testDate = source.test_date || source.testDate || '';
  try {
    const config = loadConfig();
    const db = await getDb(config);
    const { windows, report } = await buildReport(db, testDate);
    const html = Buffer.from(report.html || '', 'utf8');
    const result = {
      ok: true,
      dryRun: config.dryRun,
      date_label: windows.date_label,
      iso_date: windows.iso_date,
      slack_summary: report.slack_summary,
      html_bytes: html.length,
      pdf: false,
    };
    if (config.dryRun) return result;
    await postSummary(config.slackToken, config.slackChannel, report.slack_summary);
    await uploadFile(
      config.slackToken,
      config.slackChannel,
      'new_telecrm_report_' + windows.iso_date + '.html',
      html,
      'HTML report for ' + windows.date_label,
    );
    if (config.gotenbergUrl) {
      const pdf = await renderPdf(config.gotenbergUrl, report.html);
      await uploadFile(
        config.slackToken,
        config.slackChannel,
        'new_telecrm_report_' + windows.iso_date + '.pdf',
        pdf,
        'PDF report for ' + windows.date_label,
      );
      result.pdf = true;
    }
    return result;
  } catch (error) {
    const message = safeMessage(error);
    console.log(JSON.stringify({ ok: false, error: message }));
    return { ok: false, error: message };
  }
};
