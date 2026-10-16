'use strict';

function phone10(raw) {
  let value = String(raw ?? '').replace(/[^0-9]/g, '');
  if (value.length === 11 && value.startsWith('0')) value = value.slice(1);
  if (value.length === 12 && value.startsWith('91')) value = value.slice(2);
  return value;
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch (_) { return { raw: text.slice(0, 300) }; }
}

async function searchLead(config, phone) {
  const url = `https://next.telecrm.in/autoupdate/v2/enterprise/${config.enterpriseId}/lead/search`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.searchToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: { phone: '91' + phone } }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const body = await readBody(response);
  if (!response.ok) {
    const code = body && body.error && body.error.code ? body.error.code : response.status;
    throw new Error(`TeleCRM search failed: ${response.status} ${code}`);
  }
  return body;
}

async function pushTemperature(config, scored) {
  const url = `https://next-api.telecrm.in/enterprise/${config.enterpriseId}/autoupdatelead`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.writeToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        phone: scored.telecrm_phone,
        status: scored.current_status,
        temperature: scored.telecrm_temperature,
      },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const body = await readBody(response);
  if (!response.ok) {
    const code = body && body.error && body.error.code ? body.error.code : response.status;
    throw new Error(`TeleCRM temperature push failed: ${response.status} ${code}`);
  }
  return body;
}

module.exports = { phone10, searchLead, pushTemperature };
