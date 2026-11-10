import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

// test/manual/analysis_idle_release.mts
// The check behind STEMS_IDLE_MS in electron/analysis/worker.cjs: htdemucs is released STEMS_IDLE_MS
// after its LAST run ends - not after the first, and not before - and builds again when asked; beat_this
// is loaded for each request and released at its end.
//
// Manual rather than a unit test for two reasons that are the same reason: it needs the real weights
// and the real MNN library, which are gitignored, and it spends a minute and a half waiting for a timer.
// Neither belongs in a suite that runs on every change. Run it after touching the worker's model
// handling:
//
//   npm run manual:analysis-idle
//
// It needs beat_this-wgsl.bin and htdemucs-wgsl.bin in the repo's models/ (`npm run models:fetch`, or
// copied from an installed Folia's resources/models), and folia_mnn where electron/analysis/mnn.cjs
// looks for it (FOLIA_MNN_LIBRARY, or build/mnn/<win|mac|linux>-<arch>/ - an installed Folia's
// resources/mnn has one).
//
// utilityProcess is stubbed down to the two members the worker actually touches, which is the whole
// of its contract with the host: `parentPort.on('message')` and `parentPort.postMessage`.
//
// (Rewritten 2026-10-19, after PR #750: it was the check behind IDLE_RELEASE_MS - a 30 s budget and a
// 10 s sweep, gone long before - and counted a "weights loaded" line the worker no longer prints, with
// beat_this kept loaded, which it no longer is.)

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const WORKER = path.join(REPO, 'electron/analysis/worker.cjs');

// Read from the worker rather than repeated here, so this cannot go on waiting for a number the worker
// has stopped using - which is how the version before this one went stale.
const declared = /const STEMS_IDLE_MS = ([\d_]+);/.exec(fs.readFileSync(WORKER, 'utf8'));
assert.ok(declared, 'worker.cjs no longer declares STEMS_IDLE_MS - this check is out of date');
const STEMS_IDLE_MS = Number(declared[1].replaceAll('_', ''));

type Reply = { result: unknown; reason: string | null };
const port = new EventEmitter() as EventEmitter & { postMessage: (message: { id: number } & Reply) => void };
const replies = new Map<number, (reply: Reply) => void>();
port.postMessage = ({ id, result, reason }) => replies.get(id)?.({ result, reason: reason ?? null });
(process as unknown as { parentPort: unknown }).parentPort = port;
process.argv[2] = path.join(REPO, 'models');

// Every line the worker prints, and when: whether and when a model was built or released is answered by
// what the worker said rather than by reading RSS and guessing.
const lines: Array<{ at: number; text: string }> = [];
const log = console.log;
console.log = (...args: unknown[]) => {
    lines.push({ at: performance.now(), text: args.join(' ') });
    log(...args);
};
const HTDEMUCS_LOADED = /^\[htdemucs\] loaded on the CPU/;
const BEAT_THIS_LOADED = /^\[beat_this\] loaded on the CPU/;
const IDLE = /^\[htdemucs\] idle for (\d+)s since its last run/;
const RELEASED = /^\[htdemucs\] released, rss (\d+)MB -> (\d+)MB/;
const said = (pattern: RegExp) => lines.filter(line => pattern.test(line.text));

require(WORKER);

const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const sleepUntil = (at: number) => new Promise(resolve => setTimeout(resolve, Math.max(0, at - performance.now())));
let nextId = 0;
const ask = (kind: string, payload: unknown) => new Promise<Reply>((resolve) => {
    const id = nextId += 1;
    replies.set(id, resolve);
    port.emit('message', { data: { id, kind, payload } });
});

/** Two seconds of silence: a real pass through the real graph, short enough not to be the wait. */
const samples = 2 * 44100;
const separation = { left: new Float32Array(samples), right: new Float32Array(samples) };
/** One chunk at the size the renderer actually sends. Contents do not matter, only the shape. */
const grid = [{ frames: 1500, data: new Float32Array(1500 * 128) }];

const separate = async () => {
    const reply = await ask('htdemucs', separation);
    assert.ok(reply.result, `htdemucs answered nothing: ${reply.reason}`);
    // The worker arms its idle timer as the run ends, just before this reply.
    return performance.now();
};
const beats = async () => {
    const before = rss();
    const reply = await ask('beat-this', grid);
    assert.ok(reply.result, `beat_this answered nothing: ${reply.reason}`);
    return rss() - before;
};

// The first run builds htdemucs.
const firstEnded = await separate();
assert.equal(said(HTDEMUCS_LOADED).length, 1, 'htdemucs should have been built once');
log(`htdemucs loaded                       rss ${rss()}MB`);

// beat_this is built for the request and released at its end: the memory it needed comes back.
const kept = await beats();
assert.equal(said(BEAT_THIS_LOADED).length, 1, 'beat_this should have been built for its request');
log(`beat_this run and released            rss ${rss()}MB   (kept ${kept}MB)`);
assert.ok(kept < 100, `beat_this kept ${kept}MB after its request - it should be released at the end of it`);

// Asked again inside the idle time: still built, nothing reloads - and the idle time starts over.
log(`asking htdemucs again in ${STEMS_IDLE_MS / 2000}s, inside its ${STEMS_IDLE_MS / 1000}s idle time...`);
await sleepUntil(firstEnded + STEMS_IDLE_MS / 2);
const lastEnded = await separate();
assert.equal(said(HTDEMUCS_LOADED).length, 1, 'htdemucs was rebuilt inside its idle time');
assert.equal(said(RELEASED).length, 0, 'htdemucs was released inside its idle time');
const held = rss();
log(`htdemucs still loaded                 rss ${held}MB`);

// Released once, STEMS_IDLE_MS after the LAST run ended: a release armed by the first run would come
// half the idle time early.
log(`waiting ${STEMS_IDLE_MS / 1000}s for the release...`);
while (!said(RELEASED).length && performance.now() < lastEnded + STEMS_IDLE_MS + 10_000) {
    await sleepUntil(performance.now() + 200);
}
const [released] = said(RELEASED);
assert.ok(released, `htdemucs was not released within ${STEMS_IDLE_MS / 1000 + 10}s of its last run`);
const idle = said(IDLE);
assert.equal(idle.length, 1, `expected one idle release, saw ${idle.length}`);
assert.equal(Number(IDLE.exec(idle[0].text)?.[1]) * 1000, STEMS_IDLE_MS, 'the idle line does not say STEMS_IDLE_MS');
const after = Math.round(idle[0].at - lastEnded);
assert.ok(after > STEMS_IDLE_MS - 1000 && after < STEMS_IDLE_MS + 5000,
    `released ${after}ms after the last run, expected ${STEMS_IDLE_MS}ms`);
const [, from, to] = RELEASED.exec(released.text)!.map(Number);
log(`released ${(after / 1000).toFixed(1)}s after the last run   rss ${held}MB -> ${rss()}MB   (worker said ${from} -> ${to})`);
assert.ok(from - to > 200, `htdemucs gave back only ${from - to}MB`);

// The half that makes it safe rather than merely smaller: it comes back.
await separate();
assert.equal(said(HTDEMUCS_LOADED).length, 2, 'htdemucs should have been rebuilt exactly once');

// And beat_this, never kept, is built again for its next request.
await beats();
assert.equal(said(BEAT_THIS_LOADED).length, 2, 'beat_this should have been built for each request');

log(`\nOK - htdemucs released ${STEMS_IDLE_MS / 1000}s after its last run and rebuilt on request; beat_this built and released per request.`);
process.exit(0);
