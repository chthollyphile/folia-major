import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// test/manual/hifiMpvSmoke.mjs

/**
 * 用真的 mpv 跑一遍 HiFi 主进程那几块（electron/hifi/mpvSession.cjs + sourceBridge.cjs），不起 Electron：
 * 渲染端换成进程内的假实现，按 sourceKey 直接从磁盘读字节回给来源桥；输出用 --ao=null，不出声。
 *
 * 走一遍：载入 → 等到在放 → 看时钟节流 → 跳转 → 暂停 / 继续 → stop（输出关掉）→ 无缝接下一首（第一首没有 ended，
 * 两首格式不同时输出按新格式重开，上一首的令牌撤掉）→ 新的载入（replace）丢掉预载项 → clearNext 撤掉预载项、第一首照常放到底
 * → clearNext 和换曲撞在一起（把 playlist-remove 压住 1.5 秒）→ 短文件放到底（ended，之后预载被拒）→ 暂停着载入到末尾再按播放（从头放）
 * → 设备表里没有的设备留在 auto → 源读不出时的错误码 → 源在播放途中断掉（报错而不是 ended）→ killSync 之后不再拉起；
 * 每步打印 HifiEngineState 里的 audioParams / audioOutParams / track。
 *
 * 用法：
 *   node test/manual/hifiMpvSmoke.mjs <第一首，如 44.1k/16 FLAC> <第二首，如 96k/24 FLAC 或 DSD64 .dsf> [--mpv /usr/bin/mpv] [--output]
 * 两首格式不同（采样率不同）时才看得出换曲时输出重开。
 * --output：不用 --ao=null，走系统的默认输出（会出声，配静音文件用），独占开着。Linux 上有 pactl 时核对 mpv 的流
 * 没被标成独占（node.exclusive）：PipeWire 上独占的流在声卡已经连着别的流时连不上，mpv 会丢帧快进到结尾。
 *
 * 退出码 0 表示每一步都符合预期；不符合的步骤打 FAIL 并以 1 退出。
 */

const require = createRequire(import.meta.url);
const { createMpvSession } = require('../../electron/hifi/mpvSession.cjs');
const { createMpvIpcClient } = require('../../electron/hifi/mpvIpcClient.cjs');
const { createSourceBridge } = require('../../electron/hifi/sourceBridge.cjs');
const { AUDIO_CLIENT_NAME } = require('../../electron/hifi/mpvArgs.cjs');

const parseArgs = () => {
    const args = process.argv.slice(2);
    const files = [];
    let mpvPath = '/usr/bin/mpv';
    let realOutput = false;
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--mpv') {
            mpvPath = args[index + 1];
            index += 1;
        } else if (args[index] === '--output') {
            realOutput = true;
        } else {
            files.push(args[index]);
        }
    }
    if (files.length < 2) {
        console.error('usage: node test/manual/hifiMpvSmoke.mjs <first audio file> <second audio file> [--mpv <path>] [--output]');
        process.exit(2);
    }
    return { files: files.map(file => path.resolve(file)), mpvPath, realOutput };
};

const { files, mpvPath, realOutput } = parseArgs();
const startedAt = Date.now();
const stamp = () => `${String(Date.now() - startedAt).padStart(6)} ms`;
let failures = 0;
const check = (ok, what) => {
    console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${what}`);
    if (!ok) failures += 1;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// 假渲染端：sourceKey → 磁盘上的文件。未登记的 key 回 unknown-source，标成坏的 key 回 failed，
// 设了断点的 key 读到那个字节以后回 failed（源在播放途中断掉）。
const registeredFiles = new Map();
const brokenKeys = new Set();
const failFromOffset = new Map();
const requestRead = async (_ownerId, { sourceKey, offset, length }) => {
    if (brokenKeys.has(sourceKey)) return { status: 'failed' };
    if (failFromOffset.has(sourceKey) && offset >= failFromOffset.get(sourceKey)) return { status: 'failed' };
    const file = registeredFiles.get(sourceKey);
    if (!file) return { status: 'unknown-source' };
    const handle = openSync(file, 'r');
    try {
        const buffer = Buffer.alloc(length);
        const read = readSync(handle, buffer, 0, length, offset);
        return { status: 'ok', data: new Uint8Array(buffer.buffer, buffer.byteOffset, read) };
    } finally {
        closeSync(handle);
    }
};
const quiet = () => {};
// 块小一点，源中途断掉那一步才断在文件中间。
const bridge = createSourceBridge({ requestRead, chunkSize: 64 * 1024, unknownSourceGiveUpMs: 600, logInfo: quiet });
// 每个 sourceKey 在桥上的地址：令牌撤掉以后这个地址回 404。
const bridgeUrls = new Map();
const registerLocal = bridge.registerLocal;
bridge.registerLocal = (source) => {
    const registered = registerLocal(source);
    bridgeUrls.set(source.sourceKey, registered.url);
    return registered;
};
const bridgeStatus = async (sourceKey) => {
    const url = bridgeUrls.get(sourceKey);
    if (!url) return null;
    const response = await fetch(url, { method: 'HEAD' });
    return response.status;
};

// 会话用的 IPC 客户端：留一份给脚本直接问 mpv（播放列表），playlist-remove 可以压住一会儿，让 clearNext 和换曲撞在一起。
let mpvClient = null;
let holdPlaylistRemoveMs = 0;
const createIpcClient = (options) => {
    const client = createMpvIpcClient(options);
    mpvClient = client;
    return {
        ...client,
        command: async (args) => {
            if (holdPlaylistRemoveMs > 0 && args[0] === 'playlist-remove') await sleep(holdPlaylistRemoveMs);
            return client.command(args);
        },
    };
};
const mpvPlaylist = async () => {
    const playlist = await mpvClient.command(['get_property', 'playlist']);
    return Array.isArray(playlist) ? playlist : [];
};

let lastState = null;
const stateWaiters = new Set();
const clockLog = [];
const errorLog = [];
const statusLog = [];
const children = [];
const session = createMpvSession({
    spawnFn: (...args) => {
        const child = spawn(...args);
        children.push(child);
        return child;
    },
    platform: process.platform,
    resolveRuntime: async () => ({ path: mpvPath, version: null }),
    bridge,
    createIpcClient,
    ...(realOutput ? {} : { ao: 'null' }),
    idleExitMs: 60000,
    onState: state => {
        if (lastState?.status !== state.status || lastState?.trackKey !== state.trackKey) {
            console.log(`${stamp()} state #${state.seq} ${state.status} track=${state.trackKey} pos=${state.positionSec.toFixed(2)} ao=${state.currentAo}`);
        }
        lastState = state;
        statusLog.push({ status: state.status, trackKey: state.trackKey });
        for (const waiter of [...stateWaiters]) waiter(state);
    },
    onClock: update => {
        clockLog.push({ at: Date.now(), ...update });
        if (update.reason !== 'tick') console.log(`${stamp()} clock ${update.reason} pos=${update.positionSec.toFixed(3)} paused=${update.paused}`);
    },
    onError: event => {
        errorLog.push(event);
        console.log(`${stamp()} error ${JSON.stringify(event)}`);
    },
    logInfo: (...args) => console.log(`${stamp()}`, ...args),
    logWarn: (...args) => console.log(`${stamp()}`, ...args),
});

const waitForState = (predicate, what, timeoutMs = 10000) => new Promise((resolve) => {
    if (lastState && predicate(lastState)) {
        resolve(lastState);
        return;
    }
    const timer = setTimeout(() => {
        stateWaiters.delete(waiter);
        check(false, `timed out waiting for ${what}`);
        resolve(lastState);
    }, timeoutMs);
    const waiter = state => {
        if (!predicate(state)) return;
        clearTimeout(timer);
        stateWaiters.delete(waiter);
        resolve(state);
    };
    stateWaiters.add(waiter);
});

const mimeFor = file => (file.endsWith('.flac') ? 'audio/flac' : file.endsWith('.dsf') ? 'audio/dsf' : 'application/octet-stream');
let trackCounter = 0;
const requestFor = (file, { startSec = 0, paused = false, sourceKey = randomBytes(16).toString('hex') } = {}) => {
    registeredFiles.set(sourceKey, file);
    trackCounter += 1;
    const songKey = `local:${path.basename(file)}`;
    return {
        trackKey: `${songKey}#${trackCounter}`,
        songKey,
        source: { kind: 'local', sourceKey, size: statSync(file).size, mimeType: mimeFor(file), fileName: path.basename(file) },
        startSec,
        paused,
        loopFile: false,
    };
};

const printFormat = (label, state) => {
    console.log(`${stamp()} ${label}`);
    console.log(`         audioParams    ${JSON.stringify(state.audioParams)}`);
    console.log(`         audioOutParams ${JSON.stringify(state.audioOutParams)}`);
    console.log(`         track          ${JSON.stringify(state.track)}`);
    console.log(`         durationSec ${state.durationSec} currentAo ${state.currentAo} device ${state.audioDevice} volume ${state.volume} exclusive ${state.exclusive} spdif ${state.spdif}`);
};

// PulseAudio 兼容层里 mpv 的流（Sink Input）各自的属性块；没有 pactl 时为 null。PipeWire 不总给 mpv 的流记进程号，
// 按应用名认：mpvSession 用 --audio-client-name 起 mpv（mpvArgs.cjs 的 AUDIO_CLIENT_NAME），pactl 把它列成 application.name。
const mpvSinkInputs = () => {
    const listed = spawnSync('pactl', ['list', 'sink-inputs'], { encoding: 'utf8', timeout: 5000 });
    if (listed.status !== 0 || typeof listed.stdout !== 'string') return null;
    return listed.stdout.split(/^Sink Input #/m).slice(1).filter(block => block.includes(`application.name = "${AUDIO_CLIENT_NAME}"`));
};

const [first, second] = files;
const baseConfig = { mpvPath: null, audioDevice: 'auto', exclusive: realOutput, dsdMode: 'pcm', softwareVolume: false, volume: 100, muted: false };
try {
    await session.configure(baseConfig);

    console.log(`${stamp()} --- load ${path.basename(first)}`);
    const firstRequest = requestFor(first);
    const loaded = await session.load(firstRequest, { ownerId: 1 });
    check(loaded.ok === true, `load resolves ok (${JSON.stringify(loaded.ok ? loaded.state.status : loaded)})`);
    const playing = await waitForState(state => state.status === 'playing' && state.trackKey === firstRequest.trackKey, 'playing');
    check(playing.audioOutParams !== null, 'audioOutParams is known once playing');
    await sleep(300);
    printFormat('first track format', lastState);
    if (realOutput && process.platform === 'linux') {
        check(lastState.exclusive === false, `Linux: mpv is not asked for exclusive output (state.exclusive ${lastState.exclusive})`);
        const streams = mpvSinkInputs();
        if (streams === null) {
            console.log(`${stamp()} pactl is not available, skipping the stream check`);
        } else {
            check(streams.length > 0, `pactl lists mpv's stream (${streams.length})`);
            check(streams.every(block => !/node\.exclusive = "true"/.test(block)), 'mpv\'s stream is not node.exclusive');
        }
    }

    clockLog.length = 0;
    await sleep(1000);
    const ticks = clockLog.filter(update => update.reason === 'tick');
    check(ticks.length >= 2 && ticks.length <= 5, `clock ticks in 1 s: ${ticks.length} (want 2..5, <= 4 Hz)`);
    const gaps = ticks.slice(1).map((update, index) => update.at - ticks[index].at);
    check(gaps.every(gap => gap >= 200), `tick gaps ${gaps.join(', ')} ms all >= 200`);

    console.log(`${stamp()} --- seek 2.0`);
    clockLog.length = 0;
    await session.seek(2);
    const seekPush = clockLog.find(update => update.reason === 'seek');
    check(Boolean(seekPush) && Math.abs(seekPush.positionSec - 2) < 0.01, 'seek pushes the clock at once with the target');
    check(seekPush?.paused === true, 'the seek push is paused until mpv has found the position');
    await sleep(400);
    const restartPush = clockLog.find(update => update.reason === 'resume');
    check(Boolean(restartPush) && !restartPush.paused && Math.abs(restartPush.positionSec - 2) < 0.1,
        `playback-restart pushes a running clock (${restartPush ? `pos=${restartPush.positionSec.toFixed(3)}` : 'none'})`);
    check(lastState.positionSec >= 2 && lastState.positionSec < 3, `position after seek ${lastState.positionSec.toFixed(3)}`);

    console.log(`${stamp()} --- pause / play`);
    clockLog.length = 0;
    await session.pause();
    await waitForState(state => state.status === 'paused', 'paused');
    check(clockLog.some(update => update.reason === 'pause' && update.paused), 'pause pushes a pause clock');
    const pausedAt = lastState.positionSec;
    await sleep(400);
    check(Math.abs(lastState.positionSec - pausedAt) < 0.05, 'position holds while paused');
    await session.play();
    await waitForState(state => state.status === 'playing', 'playing again');
    check(clockLog.some(update => update.reason === 'resume' && !update.paused), 'play pushes a resume clock');

    console.log(`${stamp()} --- stop`);
    await session.stop();
    const idle = await waitForState(state => state.status === 'idle', 'idle after stop');
    await sleep(200);
    check(idle.trackKey === null && lastState.currentAo === null && lastState.audioOutParams === null, `stop closes the output (ao=${lastState.currentAo})`);

    const firstDuration = playing.durationSec ?? 4;
    console.log(`${stamp()} --- gapless: ${path.basename(first)} near its end, then ${path.basename(second)}`);
    const nearEnd = requestFor(first, { startSec: Math.max(0, firstDuration - 1.5) });
    const nearEndLoad = await session.load(nearEnd, { ownerId: 1 });
    check(nearEndLoad.ok === true, 'near-end load resolves ok');
    const firstOut = (await waitForState(state => state.trackKey === nearEnd.trackKey && state.audioOutParams !== null, 'first output')).audioOutParams;
    const queued = requestFor(second);
    statusLog.length = 0;
    clockLog.length = 0;
    const preloadedAt = Date.now();
    const remainingSec = firstDuration - lastState.positionSec;
    const preloaded = await session.preloadNext(queued, { ownerId: 1 });
    check(preloaded === true, 'preloadNext appends the second track');
    check(lastState.next?.trackKey === queued.trackKey || lastState.trackKey === queued.trackKey, 'state shows the queued track');
    const queuedPlaylist = await mpvPlaylist();
    check(queuedPlaylist.length === 2 || lastState.trackKey === queued.trackKey, `mpv's playlist holds both entries (${queuedPlaylist.length})`);
    const switched = await waitForState(state => state.trackKey === queued.trackKey, 'gapless switch', 6000);
    check(switched.trackKey === queued.trackKey && switched.next === null, 'start-file of the queued entry makes it current');
    check(!statusLog.some(entry => entry.trackKey === nearEnd.trackKey && entry.status === 'ended'), 'the first track never reports ended at the switch');
    const firstQueuedClock = clockLog.find(update => update.trackKey === queued.trackKey);
    check(firstQueuedClock?.reason === 'load' && firstQueuedClock.positionSec < 0.1,
        `the first clock of the queued track is a load at 0 (${firstQueuedClock ? `${firstQueuedClock.reason} ${firstQueuedClock.positionSec.toFixed(3)}` : 'none'})`);
    // start-file 在上一首解码完时就到，那时输出里还缓冲着它最后几百毫秒（mpv 换格式前先把它放完）：换曲比听到的早这么多。
    const switchedAfterSec = (Date.now() - preloadedAt) / 1000;
    check(switchedAfterSec >= remainingSec - 0.6 && switchedAfterSec <= remainingSec + 0.6,
        `the switch comes at the first track's end, not at the preload (${remainingSec.toFixed(2)} s left, switched after ${switchedAfterSec.toFixed(2)} s)`);
    // 换格式（如 44.1k → 96k，或换到 DSD）时 mpv 要重开输出，track-list 的回复会晚几百毫秒。
    await waitForState(state => state.trackKey === queued.trackKey && state.track !== null
        && state.audioOutParams?.samplerate === state.audioParams?.samplerate, 'second format', 4000);
    printFormat('second track format (after gapless switch)', lastState);
    check(switched.durationSec === null || switched.durationSec === lastState.durationSec,
        `the first state of the queued track does not carry the previous track's duration (${switched.durationSec}, then ${lastState.durationSec})`);
    check(typeof lastState.durationSec === 'number' && lastState.durationSec > 0, `the queued track's duration is known (${lastState.durationSec})`);
    if (firstOut && lastState.audioParams && firstOut.samplerate !== lastState.audioParams.samplerate) {
        check(lastState.audioOutParams?.samplerate === lastState.audioParams.samplerate,
            `the output reopened at the new format (${firstOut.samplerate} Hz -> ${lastState.audioOutParams?.samplerate} Hz, no resampling)`);
    }
    check(await bridgeStatus(nearEnd.source.sourceKey) === 404, 'the first track\'s bridge token is revoked after the switch');
    check(await bridgeStatus(queued.source.sourceKey) === 200, 'the queued track\'s bridge token stays live');

    console.log(`${stamp()} --- a new load (replace) drops an appended entry`);
    const base = requestFor(first);
    check((await session.load(base, { ownerId: 1 })).ok === true, 'load resolves ok');
    const dropped = requestFor(second);
    check(await session.preloadNext(dropped, { ownerId: 1 }) === true, 'preloadNext appends');
    check((await mpvPlaylist()).length === 2, 'mpv\'s playlist holds both entries');
    const replacing = requestFor(first, { startSec: 1 });
    statusLog.length = 0;
    const replaced = await session.load(replacing, { ownerId: 1 });
    check(replaced.ok === true && replaced.state.next === null, 'the replacing load resolves with no next entry');
    const replacedPlaylist = await mpvPlaylist();
    check(replacedPlaylist.length === 1 && replacedPlaylist[0].filename === bridgeUrls.get(replacing.source.sourceKey),
        `mpv's playlist holds only the new entry (${replacedPlaylist.length})`);
    check(await bridgeStatus(dropped.source.sourceKey) === 404, 'the dropped entry\'s bridge token is revoked');
    await sleep(500);
    check(lastState.next === null && !statusLog.some(entry => entry.trackKey === dropped.trackKey), 'the session forgot the dropped entry');

    console.log(`${stamp()} --- clearNext drops the appended entry; the song then ends on its own`);
    const clearBase = requestFor(first, { startSec: Math.max(0, firstDuration - 1.2) });
    check((await session.load(clearBase, { ownerId: 1 })).ok === true, 'near-end load resolves ok');
    const cleared = requestFor(second);
    check(await session.preloadNext(cleared, { ownerId: 1 }) === true, 'preloadNext appends');
    statusLog.length = 0;
    await session.clearNext();
    check((await mpvPlaylist()).length === 1, 'mpv\'s playlist is back to one entry');
    check(await bridgeStatus(cleared.source.sourceKey) === 404, 'the cleared entry\'s bridge token is revoked');
    const clearedEnd = await waitForState(state => state.trackKey === clearBase.trackKey && state.status === 'ended', 'ended after clearNext', 4000);
    check(clearedEnd.status === 'ended' && !statusLog.some(entry => entry.trackKey === cleared.trackKey), 'the song ends without switching to the cleared entry');

    console.log(`${stamp()} --- clearNext racing the switch: playlist-remove held back 1.5 s`);
    const raceBase = requestFor(first, { startSec: Math.max(0, firstDuration - 0.6) });
    check((await session.load(raceBase, { ownerId: 1 })).ok === true, 'near-end load resolves ok');
    const raced = requestFor(second);
    check(await session.preloadNext(raced, { ownerId: 1 }) === true, 'preloadNext appends');
    statusLog.length = 0;
    clockLog.length = 0;
    holdPlaylistRemoveMs = 1500;
    const clearing = session.clearNext();
    const raceEnd = await waitForState(state => state.trackKey === raceBase.trackKey && state.status === 'ended', 'ended while the removal is held back', 3000);
    check(raceEnd.status === 'ended', `mpv moved past the song while its next entry was being removed: reported ${raceEnd.status}`);
    await clearing;
    holdPlaylistRemoveMs = 0;
    await sleep(300);
    check(!statusLog.some(entry => entry.trackKey === raced.trackKey), 'the entry being removed never becomes current');
    const rewound = clockLog.filter(update => update.trackKey === raceBase.trackKey && update.positionSec < raceBase.startSec - 0.05);
    check(rewound.length === 0, `the song's clock does not run on the removed entry's position (${rewound.length} pushes below ${raceBase.startSec.toFixed(2)})`);
    check(lastState.status === 'ended' && lastState.trackKey === raceBase.trackKey, `still ended after the removal (${lastState.status})`);

    console.log(`${stamp()} --- eof on a short file: ${path.basename(second)} from near its end`);
    const tail = requestFor(second, { startSec: Math.max(0, (lastState.durationSec ?? 4) - 0.8) });
    const tailLoad = await session.load(tail, { ownerId: 1 });
    check(tailLoad.ok === true, 'tail load resolves ok');
    const ended = await waitForState(state => state.status === 'ended' && state.trackKey === tail.trackKey, 'ended', 6000);
    check(ended.status === 'ended', 'eof-reached on the last entry reports ended');
    printFormat('state at the end', ended);
    const lateQueue = await session.preloadNext(requestFor(first), { ownerId: 1 });
    check(lateQueue === false, 'preloadNext after the end answers false (the renderer loads normally)');

    // 窗口重建或交接后恢复出来的位置等于时长：mpv 暂停着载入到末尾，放开后马上又停下，却不推 eof-reached。
    const endSec = ended.durationSec ?? 4;
    console.log(`${stamp()} --- play a song loaded paused at its end (${endSec.toFixed(3)} s)`);
    const atEnd = requestFor(second, { startSec: endSec, paused: true });
    const atEndLoad = await session.load(atEnd, { ownerId: 1 });
    check(atEndLoad.ok === true, `load paused at the end resolves ok (${atEndLoad.ok ? atEndLoad.state.status : atEndLoad.errorCode})`);
    await sleep(300);
    await session.play();
    // 会话认出停在了末尾就从头放；没认出来，mpv 放开后又停下时按放完报（渲染端换下一首）。不能停在“暂停”。
    const replayed = await waitForState(state => state.trackKey === atEnd.trackKey
        && ((state.status === 'playing' && state.positionSec < 1) || state.status === 'ended'), 'playing from the top or ended', 4000);
    check(replayed.status === 'playing' || replayed.status === 'ended',
        `play at the end does not get stuck paused (${replayed.status} at ${replayed.positionSec.toFixed(2)})`);
    if (replayed.status === 'playing') {
        await sleep(500);
        // 位置只随时钟推，状态里的不跟着走：看快照。
        const later = session.getSnapshot();
        check(later.status === 'playing' && later.positionSec > 0.1, `and keeps playing from the top (${later.status} at ${later.positionSec.toFixed(2)})`);
    }
    await session.stop();

    console.log(`${stamp()} --- a device mpv does not list stays on auto`);
    await session.configure({ ...baseConfig, audioDevice: 'alsa/plughw:CARD=FoliaNoSuchCard,DEV=0' });
    const unlisted = requestFor(first);
    check((await session.load(unlisted, { ownerId: 1 })).ok === true, 'load on an unlisted device resolves ok');
    const mpvDevice = await mpvClient.command(['get_property', 'audio-device']);
    check(mpvDevice === 'auto' && lastState.audioDevice === 'auto', `mpv stays on auto (${mpvDevice}, state ${lastState.audioDevice})`);
    await session.configure(baseConfig);
    await session.stop();

    console.log(`${stamp()} --- source that cannot be read`);
    const broken = requestFor(first);
    brokenKeys.add(broken.source.sourceKey);
    const brokenLoad = await session.load(broken, { ownerId: 1 });
    check(brokenLoad.ok === false && brokenLoad.errorCode === 'SOURCE_UNREACHABLE', `unreadable source fails with ${brokenLoad.ok ? 'ok' : brokenLoad.errorCode}`);

    console.log(`${stamp()} --- source the renderer does not know`);
    const unknown = requestFor(first);
    registeredFiles.delete(unknown.source.sourceKey);
    const unknownLoad = await session.load(unknown, { ownerId: 1 });
    check(unknownLoad.ok === false, `unknown source fails with ${unknownLoad.ok ? 'ok' : unknownLoad.errorCode}`);

    // 断在大的那个文件里：一个几十 KB 的短文件在第一块里就读完了，断不到中间。
    const midwayFile = statSync(first).size >= statSync(second).size ? first : second;
    const breakAt = Math.min(256 * 1024, Math.floor(statSync(midwayFile).size / 3));
    console.log(`${stamp()} --- source that breaks off mid-play: ${path.basename(midwayFile)} fails from byte ${breakAt}`);
    const midway = requestFor(midwayFile);
    failFromOffset.set(midway.source.sourceKey, breakAt);
    errorLog.length = 0;
    statusLog.length = 0;
    clockLog.length = 0;
    const midwayLoad = await session.load(midway, { ownerId: 1 });
    check(midwayLoad.ok === true, 'mid-play failure: the load itself resolves ok');
    // ffmpeg 会重连几次（约 1 s、3 s、7 s）才放弃。
    const brokeOff = await waitForState(state => state.trackKey === midway.trackKey && state.status === 'error', 'error after the source broke off', 25000);
    const midwayError = errorLog.find(event => event.trackKey === midway.trackKey);
    check(midwayError?.code === 'SOURCE_UNREACHABLE' && midwayError.fatal === true,
        `the break is a fatal ${midwayError?.code ?? 'nothing'} at ${brokeOff.positionSec.toFixed(2)} / ${brokeOff.durationSec} s`);
    check(!statusLog.some(entry => entry.trackKey === midway.trackKey && entry.status === 'ended'), 'the broken song never reports ended');
    check(clockLog.some(update => update.trackKey === midway.trackKey && update.reason === 'tick' && update.paused),
        'the clock stops while mpv waits for data that never comes');
    await sleep(300);
    check(lastState.audioOutParams === null && lastState.currentAo === null, `the output is closed after the failure (ao=${lastState.currentAo})`);

    console.log(`${stamp()} --- snapshot`);
    const snapshot = session.getSnapshot();
    console.log(`${stamp()} ${JSON.stringify({ status: snapshot.status, processRunning: snapshot.processRunning, errorCode: snapshot.errorCode, circuitOpen: snapshot.circuitOpen, seq: snapshot.seq })}`);

    console.log(`${stamp()} --- killSync`);
    session.killSync();
    await sleep(300);
    check(children.every(child => child.exitCode !== null || child.signalCode !== null), `every mpv is gone (${children.length} spawned)`);
    const afterKill = await session.load(requestFor(first), { ownerId: 1 });
    check(!afterKill.ok && afterKill.detail === 'stopped', `load after killSync answers ${afterKill.ok ? 'ok' : `${afterKill.errorCode} / ${afterKill.detail}`}`);
    const devicesAfterKill = await session.listDevices();
    check(devicesAfterKill.length === 0, 'listDevices after killSync spawns nothing');
    await sleep(300);
    check(children.every(child => child.exitCode !== null || child.signalCode !== null), `still no mpv running (${children.length} spawned)`);
} catch (error) {
    check(false, `threw: ${error?.stack ?? error}`);
} finally {
    await session.dispose();
    await bridge.stop();
    check(true, 'disposed');
    console.log(`${stamp()} ${failures === 0 ? 'all steps passed' : `${failures} step(s) failed`}`);
    process.exitCode = failures === 0 ? 0 : 1;
}
