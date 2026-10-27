#!/usr/bin/env node
// control/cli.mjs
// The `folia` command line client: maps the PROTOCOL.md §5 commands onto catalog tools over the
// HTTP or CDP transport, starts the MCP stdio server, and runs the environment doctor.

import fs from 'node:fs';
import path from 'node:path';
import {
    CONTROL_MCP_PROTOCOL_VERSION,
    CONTROL_SERVER_VERSION,
    CONTROL_TOOLS,
} from '../shared/controlCatalog.mjs';
import { UsageError, discoverLocalControl, loadConfig, parseArgv } from './lib/config.mjs';
import { createTransport, TransportError } from './lib/transport.mjs';
import { resolveCommand, validateCommandUsage } from './lib/commands.mjs';
import {
    describeEnvelopeError,
    describeTransportError,
    formatDoctorReport,
    formatEventLines,
    formatToolResult,
} from './lib/format.mjs';
import { runStdioMcpServer } from './lib/mcpProtocol.mjs';

const HELP_TEXT = `folia-control ${CONTROL_SERVER_VERSION} — control a running Folia from the command line

Usage:
  folia <command> [args] [options]
  folia mcp [options]                  MCP stdio server (same as folia-mcp)
  folia --help | --version

Connection:
  --url <url>                Control server base URL (default http://127.0.0.1:4567)
  --token <token>            Bearer token (prefer --token-file so it stays out of shell history)
  --token-file <path>        Read the token from a file (usually <userData>/control-token)
  --transport <auto|http|cdp> Default auto: HTTP first, CDP only when nothing listens on HTTP
  --cdp <url>                CDP endpoint used by --transport cdp (default http://127.0.0.1:9222)
  --target <substring>       Pick a specific CDP page target by URL substring
  --timeout <ms>             Per-request timeout (default 30000)
  --json                     Print the raw tool data as JSON (success) / error JSON (failure)
  --allow-eval               Expose folia_eval and enable the eval command
  --verbose                  Extra diagnostics on stderr (never prints the token)

Commands:
  status                     What is playing now (version, view, volume)
  state                      Full state snapshot (add --lyrics for timed lines)
  tools [--group <g>]        List the control catalog tools
  search <query>             Search songs (--provider, --source, --limit, --offset)
  play <query>               Search and play (--provider, --index, --view player|lattice|stay)
  play --provider <provider> --id <id>
                             Play an online song ID; --provider is required
                             Local IDs: library play <id>
  pause | resume | toggle | next | prev | stop
  seek <seconds|percent|mm:ss>
  volume [level] | volume --delta <n> | mute [on|off]
  loop [off|all|one] | shuffle | like [on|off] | replaygain [off|track|album]
  sleep [minutes] [--hours h] [--cancel] [--status]
  queue [list] | queue play <i> | queue add <query> | queue remove <i...>
  queue move <from> <to|next|end> | queue clear
  lyrics [--lines] | lyrics offset <ms> [--delta] [--global] | lyrics seek <line>
  visual list | visual set <mode> | visual bg <mode> | visual video [on|off]
  visual tune <monet|latent> '<json>' | smartbeat [on|off] | video [on|off]
  theme [day|night|system|cover|static|ai]
  settings [store] [key] | settings set <key> <value> | settings open [subview]
  nav <home|player|lattice> | panel [tab] [--close]
  palette | palette list [--all] [--hidden] | palette run <id> [input]
  library [list] | library search <query> | library play <id> | providers
  screenshot [--out <file>] [--no-save]
  window [status|minimize|maximize|fullscreen|close]
  window on-top [on|off] | window click-through [on|off]
  events [--since <n>] [--limit <n>] [--watch]
  toast <text> [--type info|success|error] [--duration <ms>]
  call <tool> '<json>'       Call any catalog tool; pass "-" to read the JSON from stdin
  eval '<expression>'        High privilege escape hatch (needs --allow-eval)
  quit --yes                 Quit the app (needs explicit confirmation)
  mcp                        Run the MCP stdio server
  doctor                     Check connectivity, token and catalog compatibility

Environment:
  FOLIA_CONTROL_URL, FOLIA_CONTROL_TOKEN, FOLIA_CONTROL_TOKEN_FILE, FOLIA_CONTROL_PORT,
  FOLIA_CONTROL_CDP, FOLIA_CONTROL_TRANSPORT, FOLIA_CONTROL_TIMEOUT, FOLIA_CONTROL_ALLOW_EVAL

Exit codes:
  0  success
  1  the control call failed (the app answered with an error envelope)
  2  connection or usage error (app not running, bad token, bad arguments)

Start the app with FOLIA_CONTROL=1 (dev: ELECTRON_DEV=true) to enable the control server,
then pass --token-file <userData>/control-token.`;

/** Full `--help` text (also shown for bare `folia`). */
export function helpText() {
    return HELP_TEXT;
}

function writeError(stderr, text) {
    stderr.write(`${text}\n`);
}

function reportUsageError(error, { stderr }) {
    writeError(stderr, `usage error: ${error?.message ?? String(error)}`);
    if (error?.hint) {
        writeError(stderr, `hint: ${error.hint}`);
    }
    return 2;
}

function reportTransportError(error, config, { stderr }) {
    writeError(stderr, describeTransportError(error, { verbose: config?.verbose }));
    return 2;
}

async function readStdin() {
    if (process.stdin.isTTY) {
        throw new UsageError('no data on stdin', 'pipe it: echo \'{"level":30}\' | folia call <tool> -');
    }
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

/** Write a screenshot returned as base64 when --out was given (CDP cannot save it itself). */
function materializeScreenshot(data, args) {
    if (!data || typeof data !== 'object' || typeof data.base64 !== 'string') {
        return data;
    }
    const target = typeof args?.path === 'string' ? args.path : null;
    if (!target || data.path) {
        return data;
    }
    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(data.base64, 'base64'));
        return { ...data, path: target };
    } catch (error) {
        throw new TransportError({
            code: 'write_failed',
            message: `cannot write the screenshot to ${target}: ${error.message}`,
        });
    }
}

async function handleEnvelope(tool, envelope, config, args, { stdout, stderr }) {
    if (!envelope || typeof envelope.ok !== 'boolean') {
        writeError(stderr, `protocol error: ${tool} returned no control envelope`);
        return 2;
    }
    if (!envelope.ok) {
        writeError(stderr, describeEnvelopeError(envelope, { verbose: config.verbose }));
        return 1;
    }
    let data = envelope.data ?? {};
    if (tool === 'folia_screenshot') {
        data = materializeScreenshot(data, args);
    }
    if (config.json) {
        stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    } else {
        stdout.write(`${formatToolResult(tool, data)}\n`);
    }
    return 0;
}

async function runTool(transport, config, tool, args, io) {
    const envelope = await transport.invoke(tool, args ?? {});
    return handleEnvelope(tool, envelope, config, args, io);
}

async function runMuteToggle(transport, config, io) {
    const status = await transport.invoke('folia_volume', { status: true });
    if (!status || status.ok !== true) {
        return handleEnvelope('folia_volume', status, config, {}, io);
    }
    const muted = Boolean(status.data?.muted);
    return runTool(transport, config, 'folia_volume', { mute: !muted }, io);
}

/** `folia events --watch`: long-poll the bridge event stream until ctrl-c. */
async function runEventsWatch(transport, config, baseArgs, { stdout, stderr }) {
    let since = baseArgs.since;
    let stopping = false;
    const stop = () => {
        stopping = true;
        void transport.close();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    if (config.verbose) {
        writeError(stderr, '[events] watching; press ctrl-c to stop');
    }
    try {
        while (!stopping) {
            let envelope;
            try {
                envelope = await transport.invoke('folia_events', { ...baseArgs, since, waitMs: 10000 });
            } catch (error) {
                if (stopping) {
                    break;
                }
                throw error;
            }
            if (!envelope || envelope.ok !== true) {
                writeError(stderr, describeEnvelopeError(envelope ?? {}, { verbose: config.verbose }));
                return 1;
            }
            const data = envelope.data ?? {};
            if (since === undefined) {
                since = data.cursor;
            }
            const events = Array.isArray(data.events) ? data.events : [];
            if (events.length > 0) {
                stdout.write(`${formatEventLines(data)}\n`);
            } else if (config.verbose) {
                stdout.write(`cursor ${data.cursor ?? since ?? '?'} · waiting for events\n`);
            }
            if (typeof data.cursor === 'number') {
                since = data.cursor;
            }
        }
        return 0;
    } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
    }
}

/**
 * `folia doctor` convenience: when neither --url nor a token was passed explicitly, adopt the
 * control-server.json / control-token the app wrote to its userData directory. Never used by
 * normal commands, so a stray discovery file cannot silently redirect an invocation.
 */
function applyDiscoveredConfig(config, parsed, env = process.env) {
    const discovered = discoverLocalControl(env);
    if (!discovered) {
        return null;
    }
    config.discovered = discovered;
    const explicitUrl = Boolean(parsed.options.url || env.FOLIA_CONTROL_URL);
    const explicitToken = Boolean(config.token);
    if (!explicitUrl && discovered.url) {
        config.url = discovered.url;
    }
    if (!explicitToken && discovered.token) {
        config.token = discovered.token;
        config.tokenFile = discovered.tokenFile;
        config.tokenSource = 'discovered';
        config.tokenSourceText = `discovered ${discovered.source}`;
    }
    return discovered;
}

/** `folia doctor`: environment + /health + /tools + catalog compatibility. */
async function runDoctor(config, transport, { stdout, stderr }) {
    const checks = [];
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    checks.push({
        name: 'node',
        ok: nodeMajor >= 22,
        detail: `${process.version}${nodeMajor >= 22 ? '' : ' (Node 22+ is required)'}`,
        hint: nodeMajor >= 22 ? undefined : 'install Node 24 (the repository .nvmrc has the expected version)',
    });
    checks.push({ name: 'platform', ok: true, detail: `${process.platform} ${process.arch}` });
    checks.push({ name: 'url', ok: true, detail: config.url });
    checks.push({ name: 'transport', ok: true, detail: config.transport });
    const hasToken = Boolean(config.token);
    checks.push({
        name: 'token',
        ok: hasToken,
        detail: hasToken ? config.tokenSourceText : 'not configured',
        hint: hasToken ? undefined : 'pass --token-file <userData>/control-token (the app prints the path on startup)',
    });
    let discovered = config.discovered ?? null;
    if (!discovered) {
        try {
            discovered = discoverLocalControl();
        } catch {
            discovered = null;
        }
    }
    checks.push({
        name: 'discovered',
        ok: true,
        detail: discovered ? `${discovered.source}${discovered.url ? ` (${discovered.url})` : ''}` : 'no control-server.json found (fine when --url/--token are passed)',
    });

    let healthOk = false;
    try {
        const health = await transport.health();
        healthOk = true;
        checks.push({
            name: 'health',
            ok: true,
            detail: `${health.app ?? 'folia'} ${health.version ?? ''} · pid ${health.pid ?? '?'} · port ${health.port ?? '?'} · control API v${health.controlApiVersion ?? '?'}`,
        });
    } catch (error) {
        checks.push({
            name: 'health',
            ok: false,
            detail: `${error?.code ?? 'error'}: ${error?.message ?? error}`,
            hint: error?.hint ?? 'start the app with FOLIA_CONTROL=1 (dev: ELECTRON_DEV=true)',
        });
    }

    let toolsOk = false;
    let remoteTools = [];
    try {
        remoteTools = await transport.list();
        toolsOk = Array.isArray(remoteTools) && remoteTools.length > 0;
        checks.push({
            name: 'tools',
            ok: toolsOk,
            detail: toolsOk ? `${remoteTools.length} tools` : 'the app returned no tools',
            hint: toolsOk ? undefined : 'the control server/bridge may still be starting; retry in a moment',
        });
    } catch (error) {
        checks.push({
            name: 'tools',
            ok: false,
            detail: `${error?.code ?? 'error'}: ${error?.message ?? error}`,
            hint: error?.hint,
        });
    }

    if (toolsOk) {
        const remoteNames = new Set(remoteTools.map(tool => tool?.name).filter(Boolean));
        const missing = CONTROL_TOOLS.map(tool => tool.name).filter(name => !remoteNames.has(name));
        checks.push({
            name: 'catalog',
            ok: missing.length === 0,
            detail: missing.length === 0
                ? `${CONTROL_TOOLS.length} catalog tools match the app`
                : `missing in the app: ${missing.join(', ')}`,
            hint: missing.length === 0 ? undefined : 'the CLI and the running app come from different builds; use both from the same checkout',
        });
    } else {
        checks.push({ name: 'catalog', ok: false, detail: 'skipped: no tool list', hint: undefined });
    }

    const failures = checks.filter(check => !check.ok).length;
    const exitCode = !healthOk ? 2 : (failures > 0 ? 1 : 0);
    if (config.json) {
        const report = {
            ok: exitCode === 0,
            checks: checks.map(check => ({
                name: check.name,
                ok: check.ok,
                detail: check.detail,
                ...(check.hint ? { hint: check.hint } : {}),
            })),
            config: {
                url: config.url,
                cdp: config.cdpUrl,
                transport: config.transport,
                resolvedTransport: transport.resolvedKind ?? transport.kind,
                tokenSource: config.tokenSourceText,
                protocolVersion: CONTROL_MCP_PROTOCOL_VERSION,
            },
        };
        stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
        stdout.write(`${formatDoctorReport(checks, { exitCode })}\n`);
    }
    if (config.verbose) {
        writeError(stderr, `[doctor] ${failures} failed check(s), exit ${exitCode}`);
    }
    return exitCode;
}

async function runMcp(config, { stderr }) {
    const transport = createTransport(config);
    if (config.verbose) {
        writeError(stderr, `[MCP] stdio server ready (transport ${config.transport}, eval ${config.allowEval ? 'on' : 'off'})`);
    }
    try {
        await runStdioMcpServer({ transport, allowEval: config.allowEval });
    } finally {
        await transport.close();
    }
    return 0;
}

/** Entry point: returns the process exit code (0 success, 1 control failure, 2 connection/usage). */
export async function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr } = {}) {
    let parsed;
    try {
        parsed = parseArgv(argv);
    } catch (error) {
        return reportUsageError(error, { stderr });
    }

    if (parsed.options.version) {
        stdout.write(`folia-control ${CONTROL_SERVER_VERSION}\n`);
        return 0;
    }
    if (parsed.options.help || parsed.command === 'help') {
        stdout.write(`${helpText()}\n`);
        return 0;
    }

    let config;
    try {
        validateCommandUsage(parsed);
        config = loadConfig(parsed);
    } catch (error) {
        return reportUsageError(error, { stderr });
    }

    let plan;
    try {
        plan = resolveCommand(parsed, config);
    } catch (error) {
        if (error instanceof UsageError) {
            return reportUsageError(error, { stderr });
        }
        throw error;
    }

    if (plan.special === 'help') {
        stdout.write(`${helpText()}\n`);
        return 0;
    }
    if (plan.special === 'version') {
        stdout.write(`folia-control ${CONTROL_SERVER_VERSION}\n`);
        return 0;
    }
    if (plan.special === 'mcp') {
        return runMcp(config, { stderr });
    }
    if (plan.special === 'doctor') {
        applyDiscoveredConfig(config, parsed);
    }

    const transport = createTransport(config);
    try {
        if (plan.special === 'doctor') {
            return await runDoctor(config, transport, { stdout, stderr });
        }
        if (plan.special === 'events-watch') {
            return await runEventsWatch(transport, config, plan.args ?? {}, { stdout, stderr });
        }
        if (plan.special === 'mute-toggle') {
            return await runMuteToggle(transport, config, { stdout, stderr });
        }
        if (plan.special === 'call-stdin') {
            const raw = (await readStdin()).trim();
            let callArgs;
            try {
                callArgs = JSON.parse(raw || '{}');
            } catch (error) {
                return reportUsageError(new UsageError(`stdin is not valid JSON: ${error.message}`, 'echo \'{"key":"value"}\' | folia call <tool> -'), { stderr });
            }
            if (callArgs === null || typeof callArgs !== 'object' || Array.isArray(callArgs)) {
                return reportUsageError(new UsageError('tool arguments must be a JSON object'), { stderr });
            }
            return await runTool(transport, config, plan.tool, callArgs, { stdout, stderr });
        }
        if (plan.special === 'eval-stdin') {
            const expression = (await readStdin()).trim();
            if (!expression) {
                return reportUsageError(new UsageError('no expression on stdin', 'echo \'1 + 1\' | folia eval --stdin --allow-eval'), { stderr });
            }
            return await runTool(transport, config, 'folia_eval', { expression }, { stdout, stderr });
        }
        return await runTool(transport, config, plan.tool, plan.args, { stdout, stderr });
    } catch (error) {
        if (error instanceof TransportError) {
            return reportTransportError(error, config, { stderr });
        }
        if (error instanceof UsageError) {
            return reportUsageError(error, { stderr });
        }
        const detail = config.verbose && error?.stack ? `\n${error.stack}` : '';
        writeError(stderr, `[folia] internal error: ${error?.message ?? error}${detail}`);
        return 2;
    } finally {
        await transport.close();
    }
}

const entryName = process.argv[1] ? path.basename(process.argv[1]) : '';
const invokedDirectly = entryName === 'cli.mjs' || entryName === 'folia';
if (invokedDirectly) {
    const exitCode = await main();
    process.exitCode = exitCode;
}
