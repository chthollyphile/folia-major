import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

// test/manual/analysis_idle_release.mts
// The check behind IDLE_RELEASE_MS in electron/analysis/worker.cjs: htdemucs is handed back when it
// goes idle, beat_this is not, and a model that was released still answers afterwards.
//
// Manual rather than a unit test for two reasons that are the same reason: it needs the real 250MB
// of weights, which are gitignored, and it spends most of a minute waiting for a timer. Neither
// belongs in a suite that runs on every change. Run it after touching the worker's session handling:
//
//   npm run manual:analysis-idle
//
// utilityProcess is stubbed down to the two members the worker actually touches, which is the whole
// of its contract with the host: `parentPort.on('message')` and `parentPort.postMessage`.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));

const port = new EventEmitter() as EventEmitter & { postMessage: (message: never) => void };
const replies = new Map<number, (value: unknown) => void>();
port.postMessage = ({ id, result }) => replies.get(id)?.(result);
(process as unknown as { parentPort: unknown }).parentPort = port;
process.argv[2] = path.join(REPO, 'models');

// Every "weights loaded" line, so "did it reload?" is answered by what the worker said rather than
// by reading RSS and guessing.
const loads: string[] = [];
const log = console.log;
console.log = (...args: unknown[]) => {
    const line = args.join(' ');
    if (line.includes('weights loaded')) loads.push(line);
    log(...args);
};

require(path.join(REPO, 'electron/analysis/worker.cjs'));

const rss = () => Math.round(process.memoryUsage().rss / 1048576);
let nextId = 0;
const ask = (kind: string, payload: unknown) => new Promise<unknown>((resolve) => {
    const id = nextId += 1;
    replies.set(id, resolve);
    port.emit('message', { data: { id, kind, payload } });
});

/** Two seconds of silence: a real pass through the real graph, short enough not to be the wait. */
const samples = 2 * 44100;
const separation = { left: new Float32Array(samples), right: new Float32Array(samples) };
/** One chunk at the size the renderer actually sends. Contents do not matter, only the shape. */
const grid = [{ frames: 1500, data: new Float32Array(1500 * 128) }];

assert.ok(await ask('htdemucs', separation), 'htdemucs answered nothing');
assert.ok(await ask('beat-this', grid), 'beat_this answered nothing');
const loaded = rss();
log(`both models resident                 rss ${loaded}MB`);
assert.equal(loads.length, 2, `expected two loads, saw ${loads.length}`);

// The budget is 30s and the sweep runs every 10s, so 45 covers the worst alignment of the two.
log('waiting 45s for the idle sweep...');
await new Promise(resolve => setTimeout(resolve, 45_000));
const freed = loaded - rss();
log(`after the idle window                rss ${rss()}MB   (freed ${freed}MB)`);
assert.ok(freed > 200, `expected htdemucs to be released, rss only moved ${freed}MB`);

// The half that makes it safe rather than merely smaller: it comes back.
assert.ok(await ask('htdemucs', separation), 'htdemucs did not reload after being released');
assert.equal(loads.length, 3, 'htdemucs should have reloaded exactly once');

// And the half that makes it free: the model with a deadline was never touched. A profile arriving
// late is the same as no profile, so beat_this is not allowed to pay a reload for 96MB.
assert.ok(await ask('beat-this', grid), 'beat_this stopped answering');
assert.equal(loads.length, 3, `beat_this was reloaded and must not have been: ${loads.at(-1)}`);

log('\nOK - htdemucs released and reloaded, beat_this untouched.');
process.exit(0);
