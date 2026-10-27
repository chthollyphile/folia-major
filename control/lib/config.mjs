// control/lib/config.mjs
// Argument and environment parsing shared by `folia` (cli.mjs) and `folia-mcp` (mcp.mjs).
// Nothing here talks to the network, so the CLI can fail on usage errors before connecting.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONTROL_PORT } from '../../shared/controlCatalog.mjs';

const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
const DEFAULT_TIMEOUT_MS = 30000;
const VALID_TRANSPORTS = ['auto', 'http', 'cdp'];

/** A command line, environment or configuration-file problem: exit code 2, no point retrying. */
export class UsageError extends Error {
    constructor(message, hint = '') {
        super(message);
        this.name = 'UsageError';
        this.code = 'usage';
        this.hint = hint;
    }
}

/** Options that consume the next argv entry (or the text after `=`). */
const VALUE_OPTIONS = new Map([
    ['--url', 'url'],
    ['--token', 'token'],
    ['--token-file', 'tokenFile'],
    ['--transport', 'transport'],
    ['--cdp', 'cdp'],
    ['--target', 'target'],
    ['--timeout', 'timeout'],
    ['--provider', 'provider'],
    ['--source', 'source'],
    ['--limit', 'limit'],
    ['--offset', 'offset'],
    ['--id', 'id'],
    ['--index', 'index'],
    ['--out', 'out'],
    ['--since', 'since'],
    ['--hours', 'hours'],
    ['--delta', 'delta'],
    ['--type', 'type'],
    ['--duration', 'duration'],
    ['--group', 'group'],
    ['--interval', 'interval'],
    ['--anchor', 'anchor'],
    ['--view', 'view'],
]);

/** Boolean switches; every one of them is optional and defaults to false. */
const BOOLEAN_OPTIONS = new Map([
    ['--json', 'json'],
    ['--allow-eval', 'allowEval'],
    ['--verbose', 'verbose'],
    ['--help', 'help'],
    ['--version', 'version'],
    ['--watch', 'watch'],
    ['--follow', 'watch'],
    ['--all', 'all'],
    ['--lines', 'lines'],
    ['--cancel', 'cancel'],
    ['--status', 'status'],
    ['--yes', 'yes'],
    ['--close', 'close'],
    ['--next', 'next'],
    ['--to-next', 'next'],
    ['--end', 'end'],
    ['--to-end', 'end'],
    ['--global', 'global'],
    ['--no-save', 'noSave'],
    ['--save', 'save'],
    ['--no-queue', 'noQueue'],
    ['--queue', 'queue'],
    ['--lyrics', 'lyrics'],
    ['--hidden', 'hidden'],
    ['--stdin', 'stdin'],
]);

/**
 * Split argv into a command, its positional arguments and the global options.
 * Options may appear before or after the command, `--flag=value` is accepted and `--`
 * stops option parsing (useful for queries that start with a dash).
 */
export function parseArgv(argv = []) {
    const positionals = [];
    const options = Object.create(null);
    let stopParsing = false;

    for (let index = 0; index < argv.length; index += 1) {
        const token = String(argv[index]);
        if (stopParsing) {
            positionals.push(token);
            continue;
        }
        if (token === '--') {
            stopParsing = true;
            continue;
        }
        if (token === '-h') {
            options.help = true;
            continue;
        }
        if (token === '-v') {
            options.version = true;
            continue;
        }
        if (!token.startsWith('--')) {
            positionals.push(token);
            continue;
        }

        const equalsAt = token.indexOf('=');
        const flag = equalsAt === -1 ? token : token.slice(0, equalsAt);
        const inlineValue = equalsAt === -1 ? null : token.slice(equalsAt + 1);

        if (VALUE_OPTIONS.has(flag)) {
            const key = VALUE_OPTIONS.get(flag);
            if (inlineValue !== null) {
                options[key] = inlineValue;
                continue;
            }
            const value = argv[index + 1];
            if (value === undefined || value === '--' || String(value).startsWith('--')) {
                throw new UsageError(`option ${flag} needs a value`, `example: folia status ${flag} <value>`);
            }
            options[key] = String(value);
            index += 1;
            continue;
        }
        if (BOOLEAN_OPTIONS.has(flag)) {
            if (inlineValue !== null) {
                throw new UsageError(`option ${flag} does not take a value`, 'drop the "=..." part');
            }
            options[BOOLEAN_OPTIONS.get(flag)] = true;
            continue;
        }
        throw new UsageError(`unknown option ${flag}`, 'run "folia --help" to list the supported options');
    }

    return {
        command: positionals.length > 0 ? positionals[0] : null,
        args: positionals.slice(1),
        options,
    };
}

function parseIntegerOption(value, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) {
        throw new UsageError(`${name} must be a positive integer (got "${value}")`);
    }
    return number;
}

function parseBooleanEnv(value) {
    return value === '1' || value === 'true' || value === 'yes';
}

function tokenFileError(error, filePath) {
    if (error && error.code === 'ENOENT') {
        return new UsageError(`token file not found: ${filePath}`, 'start the app with FOLIA_CONTROL=1, then pass --token-file <userData>/control-token');
    }
    return new UsageError(`cannot read token file: ${filePath} (${error?.code ?? error?.message ?? 'unknown error'})`);
}

/** Read a token file created by the control server (mode 0600, one hex token line). */
export function readTokenFile(filePath) {
    let text;
    try {
        text = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        throw tokenFileError(error, filePath);
    }
    const token = text.trim();
    if (!token) {
        throw new UsageError(`token file is empty: ${filePath}`, 'delete it and restart the app so the control server regenerates it');
    }
    return token;
}

function resolveToken(parsedOptions, env) {
    const tokenFile = parsedOptions.tokenFile ?? env.FOLIA_CONTROL_TOKEN_FILE ?? null;
    if (parsedOptions.token) {
        return { token: String(parsedOptions.token).trim(), tokenFile, tokenSource: 'flag' };
    }
    if (tokenFile) {
        return { token: readTokenFile(tokenFile), tokenFile, tokenSource: 'file' };
    }
    if (env.FOLIA_CONTROL_TOKEN) {
        return { token: String(env.FOLIA_CONTROL_TOKEN).trim(), tokenFile: null, tokenSource: 'env' };
    }
    return { token: null, tokenFile: null, tokenSource: 'none' };
}

function describeTokenSource(tokenSource, tokenFile) {
    switch (tokenSource) {
        case 'flag':
            return '--token (value hidden)';
        case 'file':
            return `--token-file ${tokenFile}`;
        case 'env':
            return 'FOLIA_CONTROL_TOKEN';
        default:
            return 'none';
    }
}

/** Turn parsed argv plus the environment into the effective CLI configuration. */
export function loadConfig(parsed, env = process.env) {
    const options = parsed.options ?? {};

    let port = DEFAULT_CONTROL_PORT;
    if (env.FOLIA_CONTROL_PORT !== undefined && env.FOLIA_CONTROL_PORT !== '') {
        port = parseIntegerOption(env.FOLIA_CONTROL_PORT, 'FOLIA_CONTROL_PORT');
    }

    const url = String(options.url ?? env.FOLIA_CONTROL_URL ?? `http://127.0.0.1:${port}`);
    try {
        new URL(url);
    } catch {
        throw new UsageError(`--url is not a valid URL: ${url}`, 'example: --url http://127.0.0.1:4567');
    }

    const transport = String(options.transport ?? env.FOLIA_CONTROL_TRANSPORT ?? 'auto');
    if (!VALID_TRANSPORTS.includes(transport)) {
        throw new UsageError(`--transport must be one of ${VALID_TRANSPORTS.join('|')} (got "${transport}")`);
    }

    const cdpUrl = String(options.cdp ?? env.FOLIA_CONTROL_CDP ?? DEFAULT_CDP_URL);
    try {
        new URL(cdpUrl);
    } catch {
        throw new UsageError(`--cdp is not a valid URL: ${cdpUrl}`, 'example: --cdp http://127.0.0.1:9222');
    }

    const timeoutRaw = options.timeout ?? env.FOLIA_CONTROL_TIMEOUT ?? DEFAULT_TIMEOUT_MS;
    const timeoutMs = parseIntegerOption(timeoutRaw, '--timeout');
    if (timeoutMs < 100) {
        throw new UsageError('--timeout must be at least 100 ms');
    }

    const { token, tokenFile, tokenSource } = resolveToken(options, env);
    const allowEval = options.allowEval === true || parseBooleanEnv(env.FOLIA_CONTROL_ALLOW_EVAL);

    return {
        command: parsed.command,
        args: parsed.args,
        options,
        url,
        cdpUrl,
        transport,
        target: options.target ?? null,
        timeoutMs,
        token,
        tokenFile,
        tokenSource,
        tokenSourceText: describeTokenSource(tokenSource, tokenFile),
        json: options.json === true,
        allowEval,
        verbose: options.verbose === true,
    };
}

/**
 * Look for a running app's control-server.json / control-token next to the usual Electron
 * userData directories. Used by `folia doctor`; never used to silently send a token anywhere.
 */
export function discoverLocalControl(env = process.env, { cwd = process.cwd(), home = os.homedir() } = {}) {
    const appNames = ['Folia', 'folia-major', 'folia'];
    const candidates = [];
    if (env.FOLIA_CONTROL_HOME) {
        candidates.push(env.FOLIA_CONTROL_HOME);
    }
    candidates.push(path.join(cwd, 'test-results', 'run-desktop', 'userdata'));

    const bases = [];
    if (process.platform === 'darwin') {
        bases.push(path.join(home, 'Library', 'Application Support'));
    } else if (process.platform === 'win32') {
        if (env.APPDATA) {
            bases.push(env.APPDATA);
        }
    } else {
        bases.push(env.XDG_CONFIG_HOME ?? path.join(home, '.config'));
    }
    for (const base of bases) {
        for (const appName of appNames) {
            candidates.push(path.join(base, appName));
        }
    }

    for (const directory of candidates) {
        const serverFile = path.join(directory, 'control-server.json');
        try {
            const parsed = JSON.parse(fs.readFileSync(serverFile, 'utf8'));
            if (parsed && typeof parsed === 'object') {
                return {
                    directory,
                    source: serverFile,
                    url: typeof parsed.url === 'string' ? parsed.url : null,
                    token: typeof parsed.token === 'string' ? parsed.token : null,
                    tokenFile: path.join(directory, 'control-token'),
                };
            }
        } catch {
            // Missing or half-written discovery file: try the next candidate.
        }
        const tokenFile = path.join(directory, 'control-token');
        try {
            const token = fs.readFileSync(tokenFile, 'utf8').trim();
            if (token) {
                return { directory, source: tokenFile, url: null, token, tokenFile };
            }
        } catch {
            // Not there either.
        }
    }
    return null;
}
