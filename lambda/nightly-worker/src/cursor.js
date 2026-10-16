'use strict';

function stateId(config) {
  return config.dryRun ? 'nightly-dry-run' : 'nightly';
}

function collection(db, config) {
  return db.collection(config.stateCollection);
}

async function readState(db, config) {
  return collection(db, config).findOne({ _id: stateId(config) });
}

async function writeState(db, config, state) {
  state._id = state._id || stateId(config);
  state.updatedAt = new Date();
  await collection(db, config).replaceOne({ _id: state._id }, state, { upsert: true });
  return state;
}

async function startNight(db, config) {
  const current = await readState(db, config);
  if (current && current.status === 'running') {
    return { started: false, reason: 'already-running', job: current.job, status: current.status };
  }
  const state = {
    _id: stateId(config),
    status: 'running',
    job: 'temperature',
    lastId: null,
    failId: null,
    failCount: 0,
    startedAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    pages: 0,
    processed: 0,
    written: 0,
    pushed: 0,
    skippedLeads: [],
    lastError: null,
  };
  await collection(db, config).replaceOne({ _id: state._id }, state, { upsert: true });
  return { started: true, job: 'temperature', status: 'running' };
}

function publicState(state) {
  if (!state) return { status: 'idle' };
  return {
    status: state.status,
    job: state.job || null,
    lastId: state.lastId || null,
    startedAt: state.startedAt || null,
    updatedAt: state.updatedAt || null,
    completedAt: state.completedAt || null,
    pages: state.pages || 0,
    processed: state.processed || 0,
    written: state.written || 0,
    pushed: state.pushed || 0,
    failCount: state.failCount || 0,
    skippedLeads: state.skippedLeads || [],
    lastError: state.lastError || null,
  };
}

module.exports = { readState, writeState, startNight, publicState };
