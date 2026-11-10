import { createRequire } from 'node:module';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  SEGMENTATION_GEMINI_GENERATION_CONFIG,
  SEGMENTATION_GEMINI_SCHEMA,
  SEGMENTATION_JSON_SCHEMA,
  SEGMENTATION_MAX_OUTPUT_TOKENS,
  SEGMENTATION_SCHEMA_NAME,
  buildSegmentationSourcePrompt,
  buildSegmentationSystemPrompt,
} from '../../shared/lyricSegmentationPrompt.mjs';

// test/manual/ai_probe.mjs
// Answers one question: when an AI call takes 40 seconds, is it the network or the model?
//
// The app's own logging cannot tell those apart — it only sees "fetch resolved after N ms". This
// times DNS, TCP, TLS and time-to-first-byte separately, then sends a near-empty prompt and the
// real segmentation prompt back to back. If the tiny prompt is also slow, generation is not the
// problem and no amount of prompt tuning will help.
//
//   node test/manual/ai_probe.mjs                 # uses the provider configured in the app
//   node test/manual/ai_probe.mjs --provider openai
//   node test/manual/ai_probe.mjs --lines 12
//   node test/manual/ai_probe.mjs --repeat 3      # variance matters more than one sample
//   node test/manual/ai_probe.mjs --app-client    # go through electron/aiTextClient.cjs itself,
//                                                 # which is what the app actually runs
//
// Run it while the app is being slow, ideally with the same things playing/analysing. A raw fetch
// that is fast while the app is slow points at the app's environment, not the provider.
//
// Reads the desktop app's own settings so it exercises the exact key, URL and model the app uses.
// It never prints a key.

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const CONFIG_CANDIDATES = [
  path.join(os.homedir(), '.config', 'Folia', 'config.json'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Folia', 'config.json'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Folia', 'config.json'),
];

const readConfig = () => {
  for (const candidate of CONFIG_CANDIDATES) {
    try {
      return { path: candidate, values: JSON.parse(fs.readFileSync(candidate, 'utf8')) };
    } catch {
      // Try the next platform's location.
    }
  }
  return { path: null, values: {} };
};

const ms = (start) => `${Math.round(performance.now() - start)}ms`;

const summarise = (label, samples) => {
  if (samples.length === 0) return;
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  console.log(`  ${label}: min ${sorted[0]}ms · median ${sorted[Math.floor(sorted.length / 2)]}ms`
    + ` · max ${sorted[sorted.length - 1]}ms · mean ${Math.round(total / samples.length)}ms`);
};

/**
 * Runs the request through electron/aiTextClient.cjs — the same function the IPC handler calls,
 * with the same timeout, body and logging. If this is slow while the raw fetch above is fast, the
 * difference is in the app's code rather than the network.
 */
const runThroughAppClient = async (config, systemPrompt, sourcePrompt) => {
  const require = createRequire(import.meta.url);
  const client = require('../../electron/aiTextClient.cjs');
  const store = { get: (key) => config[key] };

  const start = performance.now();
  try {
    const content = await client.runAiJsonCompletion({
      store,
      task: 'segmentation',
      systemPrompt,
      sourcePrompt,
      schema: SEGMENTATION_JSON_SCHEMA,
      schemaName: SEGMENTATION_SCHEMA_NAME,
      geminiSchema: SEGMENTATION_GEMINI_SCHEMA,
      customFetch: (url, options) => fetch(url, options),
      answerTokens: SEGMENTATION_MAX_OUTPUT_TOKENS,
    });
    console.log(`  app client: ok in ${ms(start)} · ${content.length} bytes`);
    return Math.round(performance.now() - start);
  } catch (error) {
    console.log(`  app client: FAILED after ${ms(start)} — ${error.message}`);
    return null;
  }
};

/** DNS, TCP and TLS timed on their own, before any HTTP is involved. */
const probeConnection = async (hostname, port = 443) => {
  let start = performance.now();
  let address;
  try {
    address = (await dns.lookup(hostname)).address;
    console.log(`  DNS   ${hostname} -> ${address}  ${ms(start)}`);
  } catch (error) {
    console.log(`  DNS   FAILED: ${error.message}`);
    return false;
  }

  start = performance.now();
  const connected = await new Promise((resolve) => {
    const socket = net.connect({ host: address, port }, () => { socket.end(); resolve(true); });
    socket.setTimeout(20_000, () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
  console.log(`  TCP   ${connected ? 'connected' : 'FAILED / timed out'}  ${ms(start)}`);
  if (!connected) return false;

  start = performance.now();
  const handshook = await new Promise((resolve) => {
    const socket = tls.connect({ host: address, port, servername: hostname }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(20_000, () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
  console.log(`  TLS   ${handshook ? 'handshake ok' : 'FAILED / timed out'}  ${ms(start)}`);
  return handshook;
};

/** One request, with time-to-headers and body read reported separately. */
const timedRequest = async (label, url, init) => {
  const start = performance.now();
  let response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000) });
  } catch (error) {
    console.log(`  ${label}: FAILED after ${ms(start)} — ${error.message}`);
    return null;
  }
  const headersAt = Math.round(performance.now() - start);

  let body;
  try {
    body = await response.text();
  } catch (error) {
    console.log(`  ${label}: headers ${response.status} in ${headersAt}ms, body FAILED — ${error.message}`);
    return null;
  }
  const totalAt = Math.round(performance.now() - start);

  console.log(
    `  ${label}: ${response.status} · headers ${headersAt}ms · body +${totalAt - headersAt}ms · total ${totalAt}ms · ${body.length} bytes`,
  );
  if (!response.ok) {
    console.log(`    body: ${body.slice(0, 400)}`);
  }
  return { response, body, totalAt };
};

const SAMPLE_LINE = '把回忆拼好给你';

const main = async () => {
  const { path: configPath, values: config } = readConfig();
  console.log(`config: ${configPath ?? 'NOT FOUND — falling back to env vars'}`);

  const provider = argValue('provider', config.AI_PROVIDER || process.env.AI_PROVIDER || 'gemini');
  const lineCount = Number(argValue('lines', '12'));
  const repeat = Math.max(1, Number(argValue('repeat', '1')));
  const useAppClient = args.includes('--app-client');
  const lines = Array.from({ length: lineCount }, (_, i) => `${SAMPLE_LINE}${i}`);

  console.log(`provider: ${provider}`);
  console.log(`system proxy for AI: ${config.USE_SYSTEM_PROXY_FOR_AI === true ? 'ON' : 'OFF'}`
    + '  (this script always goes direct; Electron uses its own session when ON)');
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    if (process.env[name]) console.log(`env ${name}=${process.env[name]}`);
  }
  console.log(`lines: ${lineCount}\n`);

  const systemPrompt = buildSegmentationSystemPrompt();
  const sourcePrompt = buildSegmentationSourcePrompt(lines);

  if (provider === 'openai') {
    const apiKey = config.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) return console.log('No OPENAI_API_KEY configured.');
    const base = (config.OPENAI_API_URL || 'https://api.openai.com').replace(/\/+$/, '');
    const url = /\/chat\/completions$/.test(base)
      ? base
      : `${base}${/\/v\d+$/.test(base) ? '' : '/v1'}/chat/completions`;
    const model = config.OPENAI_API_MODEL || 'gpt-5.6-luna';
    console.log(`url: ${url}\nmodel: ${model}\n`);

    console.log('connection:');
    await probeConnection(new URL(url).hostname);

    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    console.log('\nrequests:');
    const tiny = [];
    const full = [];
    const app = [];
    for (let run = 0; run < repeat; run += 1) {
      // A near-empty prompt isolates connection + provider overhead from generation cost.
      const t = await timedRequest('tiny prompt      ', url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], max_tokens: 5 }),
      });
      if (t) tiny.push(t.totalAt);

      const f = await timedRequest(`segmentation (${lineCount})`, url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: sourcePrompt }],
          temperature: 1,
          max_tokens: 4096,
          response_format: { type: 'json_object' },
        }),
      });
      if (f) full.push(f.totalAt);

      if (useAppClient) {
        const a = await runThroughAppClient(config, systemPrompt, sourcePrompt);
        if (a !== null) app.push(a);
      }
    }
    if (repeat > 1) {
      console.log('\nsummary:');
      summarise('tiny        ', tiny);
      summarise(`segmentation`, full);
      summarise('app client  ', app);
    }
    return;
  }

  const apiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return console.log('No GEMINI_API_KEY configured.');
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';
  console.log(`url: ${url}\n`);

  console.log('connection:');
  await probeConnection(new URL(url).hostname);

  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
  console.log('\nrequests:');
  const tiny = [];
  const full = [];
  const schemaed = [];
  const app = [];
  for (let run = 0; run < repeat; run += 1) {
    const t = await timedRequest('tiny prompt      ', url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the single word: ok' }] }] }),
    });
    if (t) tiny.push(t.totalAt);

    // Deliberately schema-less, to keep the "before" measurement available for comparison.
    const f = await timedRequest(`no schema   (${lineCount})`, url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: sourcePrompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    if (f) full.push(f.totalAt);

    // Exactly what the app sends today: schema, output cap and a zero thinking budget.
    const g = await timedRequest(`production  (${lineCount})`, url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: sourcePrompt }] }],
        generationConfig: SEGMENTATION_GEMINI_GENERATION_CONFIG,
      }),
    });
    if (g) schemaed.push(g.totalAt);

    if (useAppClient) {
      const a = await runThroughAppClient(config, systemPrompt, sourcePrompt);
      if (a !== null) app.push(a);
    }
  }

  if (repeat > 1) {
    console.log('\nsummary:');
    summarise('tiny        ', tiny);
    summarise('unconstrained', full);
    summarise('production  ', schemaed);
    summarise('app client  ', app);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
