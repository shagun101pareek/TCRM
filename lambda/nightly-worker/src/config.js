'use strict';

const fs = require('fs');
const path = require('path');

const workerRoot = path.join(__dirname, '..');
const repoRoot = path.join(workerRoot, '..', '..');

function blank(value) {
  return value == null || String(value).trim() === '';
}

function setIfBlank(key, value) {
  if (blank(process.env[key]) && !blank(value)) process.env[key] = value;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let parsed;
  try {
    parsed = require('dotenv').parse(fs.readFileSync(filePath));
  } catch (_) {
    return;
  }
  for (const [key, value] of Object.entries(parsed)) setIfBlank(key, value);
}

function loadEnv() {
  loadEnvFile(path.join(workerRoot, '.env'));
  loadEnvFile(path.join(repoRoot, '.env'));
  setIfBlank('TELECRM_API_TOKEN', process.env.TELECRM_SYNC_API2);
  setIfBlank('TELECRM_AUTOUPDATE_TOKEN', process.env.TELECRM_ASYNC_API2 || process.env.TELECRM_ASYNC_API);
  setIfBlank('MONGODB_DB', 'stance-dashboard');
  setIfBlank('NIGHTLY_STATE_COLLECTION', 'nightly_worker_state');
  setIfBlank('TELECRM_TIMEOUT_MS', '20000');
}

function cappedInt(name, fallback, max) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

function loadConfig() {
  loadEnv();
  const missing = [];
  if (blank(process.env.MONGODB_URI)) missing.push('MONGODB_URI');
  if (blank(process.env.MONGODB_DB)) missing.push('MONGODB_DB');
  if (blank(process.env.TELECRM_ENTERPRISE_ID)) missing.push('TELECRM_ENTERPRISE_ID');
  if (blank(process.env.TELECRM_API_TOKEN)) missing.push('TELECRM_API_TOKEN');
  if (blank(process.env.TELECRM_AUTOUPDATE_TOKEN)) missing.push('TELECRM_AUTOUPDATE_TOKEN');
  if (missing.length) {
    const error = new Error('Missing env: ' + missing.join(', '));
    error.code = 'MISSING_ENV';
    throw error;
  }
  return {
    mongoUri: process.env.MONGODB_URI,
    mongoDb: process.env.MONGODB_DB,
    enterpriseId: process.env.TELECRM_ENTERPRISE_ID,
    searchToken: process.env.TELECRM_API_TOKEN,
    writeToken: process.env.TELECRM_AUTOUPDATE_TOKEN,
    temperaturePageSize: cappedInt('NIGHTLY_TEMPERATURE_PAGE_SIZE', 10, 15),
    sourcePageSize: cappedInt('NIGHTLY_SOURCE_PAGE_SIZE', 25, 50),
    stateCollection: process.env.NIGHTLY_STATE_COLLECTION || 'nightly_worker_state',
    timeoutMs: cappedInt('TELECRM_TIMEOUT_MS', 20000, 30000),
    dryRun: ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN || '').trim().toLowerCase()),
    maxLeadFailures: 5,
    watchdogQuietMs: 3 * 60 * 1000,
  };
}

function readEvent(event) {
  let source = event || {};
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch (_) { source = {}; }
  }
  if (source && typeof source.body === 'string') {
    try { source = Object.assign({}, source, JSON.parse(source.body)); } catch (_) { /* keep the envelope */ }
  }
  const action = (source && (source.action || (source.detail && source.detail.action))) || 'continue';
  return { action: String(action), watchdog: !!(source && source.watchdog === true) };
}

module.exports = { loadConfig, readEvent, blank };
