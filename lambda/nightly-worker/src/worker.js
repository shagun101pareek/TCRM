'use strict';

const { attributeLead } = require('./attribute-lead');
const { scoreSearchBody } = require('./score-temperature');
const { getDb, closeDb } = require('./mongo');
const { readState, writeState, startNight, publicState } = require('./cursor');
const { phone10, searchLead, pushTemperature } = require('./telecrm');
const {
  idToString,
  sourceLoadPipeline,
  sourceWritePipeline,
  temperatureLoadPipeline,
  temperatureWritePipeline,
} = require('./pipelines');

function safeMessage(error) {
  const message = error && error.message ? error.message : String(error);
  return message.replace(/mongodb(\+srv)?:\/\/\S+/gi, '[redacted-mongo-uri]');
}

async function chainNext() {
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
  const client = new LambdaClient({});
  await client.send(new InvokeCommand({
    FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({ action: 'continue' })),
  }));
  return true;
}

async function writeSource(db, result, dryRun) {
  const col = db.collection('new-telecrm');
  const existing = await col.findOne({ phone: result.phone }, { projection: { _id: 1 } });
  if (dryRun) return { written: false, created: !existing };
  if (!existing) {
    await col.insertOne({
      phone: result.phone,
      source: result.source,
      stage: result.stage,
    });
  }
  await col.aggregate(sourceWritePipeline(result.phone, result.source, result.stage)).toArray();
  return { written: true, created: !existing };
}

async function processTemperature(db, config, doc) {
  const phone = phone10(doc.phone);
  if (phone.length !== 10) return { processed: 1, written: 0, pushed: 0, candidates: 0 };
  const scored = scoreSearchBody(await searchLead(config, phone));
  scored.phone = phone;
  scored.telecrm_phone = '91' + phone;
  const candidate = scored.should_write_temperature && scored.current_status ? 1 : 0;
  let written = 0;
  let pushed = 0;
  if (!config.dryRun) {
    await db.collection('new-telecrm').aggregate(temperatureWritePipeline(scored)).toArray();
    written = 1;
  }
  if (candidate) {
    if (!config.dryRun) await pushTemperature(config, scored);
    pushed = config.dryRun ? 0 : 1;
  }
  return { processed: 1, written, pushed, candidates: candidate };
}

async function processSource(db, config, doc) {
  const result = attributeLead(doc);
  if (!result || !result.should_write_source) return { processed: 1, written: 0, pushed: 0, candidates: 0 };
  const write = await writeSource(db, result, config.dryRun);
  return { processed: 1, written: write.written ? 1 : 0, pushed: 0, candidates: 1 };
}

function noteSkip(state, id) {
  const skips = Array.isArray(state.skippedLeads) ? state.skippedLeads.slice() : [];
  skips.push(id);
  state.skippedLeads = skips.slice(-50);
}

async function runPage(db, config, state) {
  const temperature = state.job === 'temperature';
  const limit = temperature ? config.temperaturePageSize : config.sourcePageSize;
  const pipeline = temperature
    ? temperatureLoadPipeline(state.lastId, limit)
    : sourceLoadPipeline(state.lastId, limit);
  const docs = await db.collection(temperature ? 'new-telecrm' : 'telecrm').aggregate(pipeline).toArray();

  state.pages = (state.pages || 0) + 1;
  let processed = 0;
  let written = 0;
  let pushed = 0;
  let candidates = 0;

  for (const doc of docs) {
    const id = idToString(doc._id);
    try {
      const outcome = temperature
        ? await processTemperature(db, config, doc)
        : await processSource(db, config, doc);
      processed += outcome.processed;
      written += outcome.written;
      pushed += outcome.pushed;
      candidates += outcome.candidates || 0;
      state.lastId = id;
      state.failId = null;
      state.failCount = 0;
      state.lastError = null;
    } catch (error) {
      state.lastError = safeMessage(error);
      if (state.failId === id) state.failCount = (state.failCount || 0) + 1;
      else {
        state.failId = id;
        state.failCount = 1;
      }
      if (state.failCount >= config.maxLeadFailures) {
        noteSkip(state, id);
        state.lastId = id;
        state.failId = null;
        state.failCount = 0;
        processed += 1;
        continue;
      }
      state.processed = (state.processed || 0) + processed;
      state.written = (state.written || 0) + written;
      state.pushed = (state.pushed || 0) + pushed;
      await writeState(db, config, state);
      return { loaded: docs.length, processed, written, pushed, candidates, failed: true, retry: true, finishedJob: false };
    }
  }

  state.processed = (state.processed || 0) + processed;
  state.written = (state.written || 0) + written;
  state.pushed = (state.pushed || 0) + pushed;

  const short = docs.length < limit;
  let finishedJob = false;
  if (short && temperature) {
    state.job = 'source';
    state.lastId = null;
    state.failId = null;
    state.failCount = 0;
  } else if (short) {
    state.status = 'completed';
    state.job = null;
    state.completedAt = new Date();
    finishedJob = true;
  }
  await writeState(db, config, state);
  return { loaded: docs.length, processed, written, pushed, candidates, failed: false, retry: false, finishedJob };
}

async function handle(config, event) {
  const db = await getDb(config);
  try {
    if (event.action === 'status') {
      return { ok: true, dryRun: config.dryRun, state: publicState(await readState(db, config)) };
    }

    if (event.action === 'start') {
      const started = await startNight(db, config);
      if (!started.started) {
        return { ok: true, dryRun: config.dryRun, ...started, state: publicState(await readState(db, config)) };
      }
    } else if (event.action !== 'continue') {
      return { ok: false, error: 'Unknown action: ' + event.action };
    }

    let state = await readState(db, config);
    if (!state || state.status !== 'running') {
      return { ok: true, skipped: 'idle', dryRun: config.dryRun, state: publicState(state) };
    }
    if (event.watchdog && state.updatedAt) {
      const age = Date.now() - new Date(state.updatedAt).getTime();
      if (age < config.watchdogQuietMs) {
        return { ok: true, skipped: 'chain-healthy', dryRun: config.dryRun, state: publicState(state) };
      }
    }

    await writeState(db, config, state);
    const page = await runPage(db, config, state);
    state = await readState(db, config);
    let chained = false;
    let chainError = null;
    if (state && state.status === 'running' && !page.retry) {
      try {
        chained = await chainNext();
      } catch (error) {
        chainError = safeMessage(error);
      }
    }
    return {
      ok: true,
      dryRun: config.dryRun,
      job: state ? state.job : null,
      chained,
      chainError,
      ...page,
      state: publicState(state),
    };
  } finally {
    if (!process.env.AWS_LAMBDA_FUNCTION_NAME) await closeDb();
  }
}

module.exports = { handle, safeMessage };
