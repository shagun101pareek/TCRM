import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const worker = require('./src/index.js');

export const handler = worker.handler;
