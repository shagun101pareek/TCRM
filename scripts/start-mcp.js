#!/usr/bin/env node
'use strict';

/**
 * Start the repository MCP server on stdio.
 * MCP clients should usually point at mcp/server/index.js directly.
 */

const { startStdio } = require('../mcp/server/index.js');
startStdio();
