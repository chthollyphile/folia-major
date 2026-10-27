#!/usr/bin/env node
// control/mcp.mjs
// Standalone MCP stdio server for Folia Control: `node control/mcp.mjs --url ... --token-file ...`
// is equivalent to `folia mcp`. stdout is reserved for JSON-RPC messages.

import path from 'node:path';
import { CONTROL_SERVER_VERSION } from '../shared/controlCatalog.mjs';
import { UsageError, loadConfig, parseArgv } from './lib/config.mjs';
import { createTransport } from './lib/transport.mjs';
import { runStdioMcpServer } from './lib/mcpProtocol.mjs';

const USAGE = `folia-mcp ${CONTROL_SERVER_VERSION} — MCP stdio server for the Folia control API

Usage:
  folia-mcp [options]
  node control/mcp.mjs [options]

Options:
  --url <url>            Control server base URL (default http://127.0.0.1:4567)
  --token <token>        Bearer token (prefer --token-file)
  --token-file <path>    Read the token from a file (usually <userData>/control-token)
  --transport <auto|http|cdp>
  --cdp <url>            CDP endpoint for --transport cdp (default http://127.0.0.1:9222)
  --target <substring>   Pick a specific CDP page target
  --timeout <ms>         Per-request timeout (default 30000)
  --allow-eval           Expose the folia_eval tool to the MCP client
  --verbose              Diagnostics on stderr (never prints the token)
  --help | --version

Protocol: JSON-RPC 2.0 over stdio, one message per line. stdout carries protocol messages only.`;

async function main(argv = process.argv.slice(2)) {
    let parsed;
    try {
        parsed = parseArgv(argv);
    } catch (error) {
        process.stderr.write(`folia-mcp: usage error: ${error?.message ?? error}\n`);
        return 2;
    }
    if (parsed.options.version) {
        process.stdout.write(`folia-mcp ${CONTROL_SERVER_VERSION}\n`);
        return 0;
    }
    if (parsed.options.help) {
        process.stdout.write(`${USAGE}\n`);
        return 0;
    }
    // `folia mcp` may pass no command at all; a literal "mcp" is tolerated too.
    if (parsed.command !== null && parsed.command !== 'mcp') {
        process.stderr.write(`folia-mcp: usage error: unknown command "${parsed.command}"\n`);
        return 2;
    }

    let config;
    try {
        config = loadConfig(parsed);
    } catch (error) {
        if (error instanceof UsageError) {
            process.stderr.write(`folia-mcp: usage error: ${error?.message ?? error}\n`);
            if (error.hint) {
                process.stderr.write(`hint: ${error.hint}\n`);
            }
            return 2;
        }
        throw error;
    }

    const transport = createTransport(config);
    if (config.verbose) {
        process.stderr.write(`[MCP] stdio server ready (transport ${config.transport}, eval ${config.allowEval ? 'on' : 'off'})\n`);
    }
    try {
        await runStdioMcpServer({ transport, allowEval: config.allowEval });
    } finally {
        await transport.close();
    }
    return 0;
}

const entryName = process.argv[1] ? path.basename(process.argv[1]) : '';
const invokedDirectly = entryName === 'mcp.mjs' || entryName === 'folia-mcp';
if (invokedDirectly) {
    const exitCode = await main();
    process.exitCode = exitCode;
}
