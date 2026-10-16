'use strict';

const { loadConfig, readEvent } = require('./config');
const { handle, safeMessage } = require('./worker');

exports.handler = async (event) => {
  const parsed = readEvent(event);
  try {
    const result = await handle(loadConfig(), parsed);
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    const message = safeMessage(error);
    console.log(JSON.stringify({ ok: false, action: parsed.action, error: message }));
    return { ok: false, action: parsed.action, error: message };
  }
};
