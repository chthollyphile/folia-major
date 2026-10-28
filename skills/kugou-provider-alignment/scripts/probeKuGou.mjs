import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// skills/kugou-provider-alignment/scripts/probeKuGou.mjs
// Node version of probe-ku-gou.ps1 for machines without PowerShell (Linux, macOS, cloud sessions).
// Same contract: reads only .env.local and .dev-credentials/kugou.json, never takes credentials as arguments.
//   node skills/kugou-provider-alignment/scripts/probeKuGou.mjs --path /search \
//     --query '{"keywords":"周杰伦","page":1,"pagesize":5}' --output test-results/kugou-search.raw.json
// Options: --path (required), --method GET|POST, --query <json>, --body <json>, --output <file>,
//   --timeout <sec, 1-300>, --no-timestamp, --dry-run

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const envPath = join(repoRoot, '.env.local');
const credentialsPath = join(repoRoot, '.dev-credentials', 'kugou.json');

const fail = message => {
    console.error(message);
    process.exit(1);
};

const { values: args } = parseArgs({
    options: {
        path: { type: 'string' },
        method: { type: 'string', default: 'GET' },
        query: { type: 'string', default: '{}' },
        body: { type: 'string' },
        output: { type: 'string' },
        timeout: { type: 'string', default: '30' },
        'no-timestamp': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
    },
});

if (!args.path) fail('Missing --path');
const method = args.method.toUpperCase();
if (method !== 'GET' && method !== 'POST') fail('--method must be GET or POST');
const timeoutSec = Number(args.timeout);
if (!Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > 300) fail('--timeout must be 1-300');

// Read one named variable from the repository's dotenv file.
function readEnvValue(name) {
    if (!existsSync(envPath)) fail('Missing environment file: .env.local');
    const pattern = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(.*)\\s*$`);
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(pattern);
        if (!match) continue;
        const value = match[1].trim();
        const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
        return quoted ? value.slice(1, -1) : value;
    }
    fail(`Missing ${name} in .env.local`);
}

// Read the ignored credential file without exposing its contents in errors.
function readCredentials() {
    if (!existsSync(credentialsPath)) fail('Missing development credentials: .dev-credentials/kugou.json');
    const text = readFileSync(credentialsPath, 'utf8').trim();
    if (!text) fail('Development credentials file is empty: .dev-credentials/kugou.json');
    try {
        return JSON.parse(text);
    } catch {
        fail('Development credentials must contain valid JSON: .dev-credentials/kugou.json');
    }
}

const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Read a case-insensitive key from a JSON object.
function mapValue(map, name) {
    if (!isMap(map)) return undefined;
    const key = Object.keys(map).find(k => k.toLowerCase() === name.toLowerCase());
    return key === undefined ? undefined : map[key];
}

// Find the first non-empty value across the supported JSON blocks.
function firstMapValue(maps, names) {
    for (const map of maps) {
        for (const name of names) {
            const value = mapValue(map, name);
            if (value !== undefined && value !== null && String(value) !== '') return value;
        }
    }
    return undefined;
}

// Convert cookie strings, arrays, or name/value maps to one Cookie header value.
function toCookieString(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.map(String).join('; ');
    if (isMap(value)) return Object.entries(value).map(([k, v]) => `${k}=${v}`).join('; ');
    return String(value);
}

// Copy the non-null entries of a JSON object, optionally turning values into strings.
function toMap(value, stringify) {
    const result = {};
    if (!isMap(value)) return result;
    for (const [key, entry] of Object.entries(value)) {
        if (entry !== null && entry !== undefined) result[key] = stringify ? String(entry) : entry;
    }
    return result;
}

const redact = (name, value) => (/cookie|token|authorization|password|secret|userid|user_id|dfid/i.test(name) ? '<redacted>' : value);

// Combine the configured base URL, endpoint path, and encoded query parameters.
function requestUrl(baseUrl, endpoint, query) {
    const url = new URL(endpoint.replace(/^\/+/, ''), `${baseUrl.replace(/\/+$/, '')}/`);
    for (const [key, value] of Object.entries(query)) {
        if (value !== null && value !== undefined) url.searchParams.append(key, String(value));
    }
    return url.toString();
}

const baseUrl = readEnvValue('VITE_KUGOU_API_BASE');
if (!baseUrl.trim()) fail('VITE_KUGOU_API_BASE is empty in .env.local');

const credentials = readCredentials();
const requestBlock = mapValue(credentials, 'request');
const sessionBlock = mapValue(credentials, 'session');
const headerBlock = firstMapValue([credentials, requestBlock], ['headers']);
const headers = toMap(headerBlock, true);
const query = toMap(firstMapValue([credentials, requestBlock], ['params', 'query']), false);

const cookie = toCookieString(firstMapValue([credentials, sessionBlock, requestBlock, headerBlock], ['cookie', 'cookies', 'Cookie']));
if (cookie && !('cookie' in query)) query.cookie = cookie;
if (cookie && !Object.keys(headers).some(k => k.toLowerCase() === 'cookie')) headers.Cookie = cookie;

let inputQuery;
try {
    inputQuery = JSON.parse(args.query);
} catch {
    fail('--query must be valid JSON');
}
Object.assign(query, inputQuery);
if (!args['no-timestamp'] && !('timestamp' in query)) query.timestamp = Date.now();

let body;
if (args.body !== undefined) {
    try {
        JSON.parse(args.body);
    } catch {
        fail('--body must be valid JSON');
    }
    body = args.body;
}

if (args['dry-run']) {
    const safeHeaders = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, redact(k, v)]));
    const safeQuery = Object.fromEntries(Object.entries(query).map(([k, v]) => [k, redact(k, v)]));
    console.log(JSON.stringify({ method, url: requestUrl(baseUrl, args.path, safeQuery), headers: safeHeaders, body: body ?? null }, null, 2));
    process.exit(0);
}

// Send one documented KuGou request and keep the raw response for inspection or fixtures.
const response = await fetch(requestUrl(baseUrl, args.path, query), {
    method,
    headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(timeoutSec * 1000),
});
const responseText = await response.text();
if (args.output) {
    const outputPath = isAbsolute(args.output) ? args.output : resolve(process.cwd(), args.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, responseText, 'utf8');
}
if (!response.ok) fail(`KuGou API returned HTTP ${response.status}. Inspect the saved response body for the application error.`);
console.log(responseText);
