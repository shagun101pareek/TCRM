'use strict';

if (process.argv.includes('--dry-run')) process.env.DRY_RUN = 'true';

const { loadConfig } = require('./config');
const { handle, safeMessage } = require('./worker');

async function main() {
  const action = process.argv.slice(2).find((arg) => !arg.startsWith('--')) || 'continue';
  const result = await handle(loadConfig(), { action, watchdog: false });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(safeMessage(error));
  process.exitCode = 1;
});
