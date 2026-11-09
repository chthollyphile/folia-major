'use strict';

const { spawn: childSpawn } = require('child_process');
const { randomBytes: cryptoRandomBytes } = require('crypto');
const { promises: fsPromises } = require('fs');
const { createHifiError, isHifiErrorCode, toHifiErrorCode, sanitizeDetail, classifyEndFile, isOutputStreamLost } = require('./hifiErrors.cjs');
const { buildMpvArgs, buildPipeName, buildLoadfileCommand, sanitizeAudioDevice, effectiveExclusive } = require('./mpvArgs.cjs');
const { createMpvIpcClient, connectNamedPipe } = require('./mpvIpcClient.cjs');

// mpv 会话的状态机：按需拉起 mpv，经 JSON IPC 下发载入和走带，把事件和属性变化归成 HifiEngineState 和节流后的时钟。

const OBSERVED_PROPERTIES = Object.freeze([
    'time-pos',
    'pause',
    'paused-for-cache',
    'duration',
    'eof-reached',
    'audio-params',
    'audio-out-params',
    'current-ao',
    'audio-device',
    'playlist-pos',
    'playlist-count',
    'volume',
    'loop-file',
]);
const RECENT_LOG_LIMIT = 20;
const QUIT_GRACE_MS = 2000;
const STDERR_TAIL_CHARS = 2000;
const FAILURE_LOG_LEVELS = new Set(['fatal', 'error', 'warn']);
// Linux 上绕过混音器直连声卡的 ALSA 设备名；plughw 会在 mpv 背后转采样率和格式，不算直连。
const DIRECT_ALSA_DEVICE = /^alsa\/hw:/i;
// 设置里的设备不在表里、退回 auto 之后，至少隔这么久才在载入前重读设备表。
const DEVICE_RECHECK_MS = 5000;
// 内核列声卡和 PCM 的地方：mpv 的 audio-device-list 把 hw: 设备都滤掉了，直连设备从这里补。
const ALSA_CARDS_PATH = '/proc/asound/cards';
const ALSA_PCM_PATH = '/proc/asound/pcm';
// ` 0 [NVidia         ]: HDA-Intel - HDA NVidia`：编号、id、驱动 - 名字。
const ALSA_CARD_LINE = /^\s*(\d+)\s+\[([^\]]+)\]:\s*(.*)$/;
// `00-03: HDMI 0 : HDMI 0 : playback 1`：声卡-设备号，后面是 id : 名字 : 各方向的子设备数。
const ALSA_PCM_LINE = /^(\d+)-(\d+):\s?(.*)$/;
// ALSA 的声卡 id 只有这些字符；别的不拿来拼设备名。
const ALSA_CARD_ID = /^[A-Za-z0-9_-]{1,32}$/;
// 桥记着源的错时，停在离时长这么远之外的“放完”算源中途断了，不算正常放到底。
const END_TOLERANCE_SEC = 2;
// 按播放时位置离时长不到这么多就算停在了末尾（暂停着载入到末尾时 mpv 不推 eof-reached）。
const AT_END_TOLERANCE_SEC = 0.05;

// 渲染端还没推设置时的取值：不独占，免得没人要求就把设备锁住。
const DEFAULT_CONFIG = Object.freeze({
    mpvPath: null,
    audioDevice: 'auto',
    exclusive: false,
    dsdMode: 'pcm',
    softwareVolume: false,
    volume: 100,
    muted: false,
});

const numberOrNull = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const stringOrNull = value => (typeof value === 'string' && value !== '' ? value : null);

/** mpv 的 audio-params / audio-out-params 换成驼峰键；属性不可用（undefined）或不像样时为 null。 */
const toAudioParams = value => {
    if (!value || typeof value !== 'object') return null;
    const samplerate = numberOrNull(value.samplerate);
    if (samplerate === null) return null;
    return {
        samplerate,
        channelCount: numberOrNull(value['channel-count']) ?? 0,
        channels: typeof value.channels === 'string' ? value.channels : '',
        format: typeof value.format === 'string' ? value.format : '',
    };
};

/** track-list 里选中的音轨；没有音轨时为 null。 */
const toTrackInfo = trackList => {
    if (!Array.isArray(trackList)) return null;
    const audioTracks = trackList.filter(item => item && item.type === 'audio');
    const track = audioTracks.find(item => item.selected) ?? audioTracks[0];
    if (!track) return null;
    return {
        codec: stringOrNull(track.codec),
        codecDesc: stringOrNull(track['codec-desc']),
        decoder: stringOrNull(track.decoder),
        demuxSamplerate: numberOrNull(track['demux-samplerate']),
        demuxChannelCount: numberOrNull(track['demux-channel-count']),
        demuxBitrate: numberOrNull(track['demux-bitrate']),
        formatName: stringOrNull(track['format-name']),
    };
};

/** audio-device-list 的一项换成 HifiDevice；没有名字的项丢掉。 */
const toDevice = (platform, item) => {
    if (!item || typeof item.name !== 'string' || item.name === '') return null;
    const slash = item.name.indexOf('/');
    return {
        name: item.name,
        description: typeof item.description === 'string' ? item.description : item.name,
        driver: slash === -1 ? item.name : item.name.slice(0, slash),
        direct: platform === 'linux' && DIRECT_ALSA_DEVICE.test(item.name),
    };
};

/** /proc/asound/cards 换成 编号 → { id, name }；认不出的行跳过（每块卡的第二行是长名字）。 */
const parseAlsaCards = text => {
    const cards = new Map();
    for (const line of String(text).split('\n')) {
        const match = ALSA_CARD_LINE.exec(line);
        if (!match) continue;
        const id = match[2].trim();
        if (!ALSA_CARD_ID.test(id)) continue;
        const rest = match[3].trim();
        const dash = rest.indexOf(' - ');
        const name = (dash === -1 ? rest : rest.slice(dash + 3)).trim();
        cards.set(Number(match[1]), { id, name: name || id });
    }
    return cards;
};

/** /proc/asound/pcm 里能放音的 PCM：[{ card, device, label }]；只能录音的跳过。 */
const parseAlsaPlaybackPcms = text => {
    const pcms = [];
    for (const line of String(text).split('\n')) {
        const match = ALSA_PCM_LINE.exec(line.trimEnd());
        if (!match) continue;
        const [id = '', name = '', ...streams] = match[3].split(' : ');
        if (!streams.some(stream => /^playback\s+\d+$/.test(stream.trim()))) continue;
        // SOF 的 PCM 名后面带个 (*)，不是名字的一部分。
        const label = (name.trim() || id.trim()).replace(/\s*\(\*\)$/, '').trim();
        pcms.push({ card: Number(match[1]), device: Number(match[2]), label });
    }
    return pcms;
};

/** 两份 /proc 文本拼出 alsa/hw:CARD=<id>,DEV=<n> 设备（直连，不过混音器也不转换）。 */
const listAlsaHwDevices = (cardsText, pcmText) => {
    const cards = parseAlsaCards(cardsText);
    const devices = [];
    for (const pcm of parseAlsaPlaybackPcms(pcmText)) {
        const card = cards.get(pcm.card);
        if (!card) continue;
        devices.push({
            name: `alsa/hw:CARD=${card.id},DEV=${pcm.device}`,
            description: pcm.label ? `${card.name}, ${pcm.label}` : card.name,
            driver: 'alsa',
            direct: true,
        });
    }
    return devices;
};

/**
 * mpv 的设备列表里补上 hw: 直连设备，排在 'auto' 后面，mpv 自己列了的不重复。mpv 一个 alsa/ 设备都没列时
 * 不补（它没编进 ALSA 输出，或连不上 ALSA，选了也开不了）。
 */
const mergeAlsaHwDevices = (devices, hwDevices) => {
    if (hwDevices.length === 0 || !devices.some(device => device.driver === 'alsa')) return devices;
    const known = new Set(devices.map(device => device.name.toLowerCase()));
    const added = hwDevices.filter(device => !known.has(device.name.toLowerCase()));
    if (added.length === 0) return devices;
    const autoIndex = devices.findIndex(device => device.name === 'auto');
    const at = autoIndex === -1 ? 0 : autoIndex + 1;
    return [...devices.slice(0, at), ...added, ...devices.slice(at)];
};

const normalizeConfig = (config, previous) => {
    const source = config && typeof config === 'object' ? config : {};
    const volume = typeof source.volume === 'number' && Number.isFinite(source.volume)
        ? Math.min(100, Math.max(0, source.volume))
        : previous.volume;
    return {
        mpvPath: typeof source.mpvPath === 'string' && source.mpvPath.trim() !== '' ? source.mpvPath : null,
        audioDevice: sanitizeAudioDevice(source.audioDevice),
        exclusive: typeof source.exclusive === 'boolean' ? source.exclusive : previous.exclusive,
        dsdMode: source.dsdMode === 'dop' ? 'dop' : 'pcm',
        softwareVolume: source.softwareVolume === true,
        volume,
        muted: source.muted === true,
    };
};

// 关掉软件音量时 mpv 固定 100：音量交给 DAC / 功放，数据不过乘法。
const volumeFor = config => (config.softwareVolume ? config.volume : 100);
const spdifFor = config => (config.dsdMode === 'dop' ? 'dsd' : '');
const isLoopFileOn = value => value !== undefined && value !== false && value !== 'no' && value !== 0;
// 带码的错只留它的说明（码已经单独报了），别的错原样留着给说明。
const detailOf = error => (error && isHifiErrorCode(error.code) ? error.hifiDetail ?? null : error);

const createFileProps = () => ({
    timePos: null,
    // 读到 timePos 时的 now()，随时钟推送带给渲染进程。
    timePosAt: null,
    duration: null,
    eofReached: false,
    audioParams: null,
    audioOutParams: null,
});

const createMpvProps = () => ({
    ...createFileProps(),
    paused: false,
    /** mpv 的缓存见底、在等数据（paused-for-cache）。 */
    pausedForCache: false,
    currentAo: null,
    audioDevice: null,
    volume: null,
    loopFile: null,
    playlistPos: -1,
    playlistCount: 0,
});

const createMpvSession = ({
    spawnFn = childSpawn,
    platform = process.platform,
    resolveRuntime,
    bridge,
    createIpcClient = createMpvIpcClient,
    connectPipe = connectNamedPipe,
    randomBytes = cryptoRandomBytes,
    now = () => Date.now(),
    setTimeoutFn = (callback, ms) => setTimeout(callback, ms),
    clearTimeoutFn = timer => clearTimeout(timer),
    onState = () => {},
    onClock = () => {},
    onError = () => {},
    logInfo = (...args) => console.info(...args),
    logWarn = (...args) => console.warn(...args),
    idleExitMs = 300000,
    crashWindowMs = 60000,
    crashLimit = 3,
    loadTimeoutMs = 20000,
    clockIntervalMs = 250,
    readFileFn = file => fsPromises.readFile(file, 'utf8'),
    ao,
} = {}) => {
    if (typeof resolveRuntime !== 'function') throw new TypeError('HiFi mpv session needs resolveRuntime');
    if (!bridge) throw new TypeError('HiFi mpv session needs a source bridge');

    const isWindows = platform === 'win32';
    let config = { ...DEFAULT_CONFIG };
    /** 已连上、在用的进程：{ child, client, exited, intentional, ... }。 */
    let proc = null;
    /** 正在拉起、还没连好 IPC 的进程；它的事件也要收（订阅后 mpv 马上推一遍初值）。 */
    let launching = null;
    let starting = null;
    /** 已发 quit、等它退出的进程。 */
    const dying = new Set();
    let disposed = false;

    /** 状态里报告的那一项；载入中就是正在载入的那一项。 */
    let current = null;
    /** loadfile append 预载的下一项。 */
    let next = null;
    /** 还没落定的载入：{ entry, settle, timer, done }。 */
    let pending = null;
    /** 被替换下来、等 mpv 放手后撤销令牌的项。 */
    const retired = new Set();
    let startedEntryId = null;
    let recentLogs = [];

    let mpv = createMpvProps();
    let track = null;
    /**
     * mpv 眼下的设置。audioDevice 是真交给 mpv 的设备（'auto'，或核对过设备表的名字），requestedDevice 是那时设置里要的那个：
     * 两者不同说明设置里的设备不在表里。
     */
    let applied = {
        requestedDevice: 'auto',
        audioDevice: 'auto',
        exclusive: effectiveExclusive(platform, config.exclusive),
        spdif: spdifFor(config),
        volume: 100,
        mute: false,
    };
    let loopFile = false;
    let errorCode = null;
    let circuitOpen = false;
    const crashTimes = [];
    let idleTimer = null;

    let stateSeq = 0;
    let stateScheduled = false;
    let clockSeq = 0;
    let lastClockAt = Number.NEGATIVE_INFINITY;
    let clockTimer = null;
    let forcedClockReason = null;
    /** 发了 seek、还没等到它的 playback-restart：这段时间 mpv 在找位置，时钟不走。 */
    let seekPending = false;
    /** pause() 被调过几次；预载和 EOF 撞车时据此分辨暂停是用户按的还是 keep-open 加的。 */
    let pauseRequests = 0;
    /** 发过几次跳转；问 mpv 途中又跳转过的，问来的结果作废。 */
    let seekRequests = 0;

    const owns = record => record !== null && (record === proc || record === launching);
    const isPlayingEntry = () => Boolean(current && !current.failed);
    // 当前项放到了头：keep-open 停在末尾（eof-reached），或 mpv 放完它以后接上了一个正在撤下的预载项（见 handleEndFile）。
    const isAtEnd = () => mpv.eofReached || current?.movedPast === true;
    // mpv 眼下放的是不是当前项：clearNext 和换曲撞上时，它可能已经在放一个正被撤下的预载项，那一项的位置和时长不归当前项。
    const isOnCurrentEntry = () => Boolean(current?.started && current.mpvId === startedEntryId);
    // 时钟只在真出声时走：暂停、缓存见底、跳转途中都按停着报，渲染端不往前外推。
    const isClockPaused = () => !isPlayingEntry() || mpv.paused || mpv.pausedForCache || seekPending;

    const callListener = (listener, value, what) => {
        try {
            listener(value);
        } catch (error) {
            logWarn(`[HiFi] ${what} listener threw`, error);
        }
    };

    const position = () => {
        if (!current) return 0;
        if (current.started && mpv.timePos !== null) return Math.max(0, mpv.timePos);
        return current.startSec;
    };

    const deriveStatus = () => {
        if (errorCode) return 'error';
        if (!proc) return starting ? 'starting' : 'stopped';
        if (pending) return 'loading';
        if (!current || !current.loaded) return 'idle';
        if (isAtEnd() && !next) return 'ended';
        return mpv.paused ? 'paused' : 'playing';
    };

    const buildState = () => ({
        status: deriveStatus(),
        processRunning: proc !== null,
        trackKey: current?.trackKey ?? null,
        songKey: current?.songKey ?? null,
        sourceKind: current?.sourceKind ?? null,
        localSourceKey: current?.localSourceKey ?? null,
        durationSec: mpv.duration,
        positionSec: position(),
        paused: isPlayingEntry() ? mpv.paused : true,
        loopFile: proc && mpv.loopFile !== null ? mpv.loopFile : loopFile,
        audioParams: mpv.audioParams,
        audioOutParams: mpv.audioOutParams,
        currentAo: mpv.currentAo,
        audioDevice: mpv.audioDevice ?? applied.audioDevice,
        exclusive: applied.exclusive,
        spdif: applied.spdif || null,
        volume: mpv.volume ?? applied.volume,
        track,
        next: next ? { trackKey: next.trackKey, songKey: next.songKey } : null,
        errorCode,
        circuitOpen,
        seq: stateSeq,
    });

    const emitState = () => {
        stateScheduled = false;
        if (disposed) return;
        stateSeq += 1;
        callListener(onState, buildState(), 'state');
    };

    // 同一批 IPC 行里的多处变化合成一次推送。
    const scheduleState = () => {
        if (stateScheduled || disposed) return;
        stateScheduled = true;
        queueMicrotask(emitState);
    };

    const clearClockTimer = () => {
        if (clockTimer === null) return;
        clearTimeoutFn(clockTimer);
        clockTimer = null;
    };

    const pushClock = reason => {
        clearClockTimer();
        if (disposed) return;
        lastClockAt = now();
        clockSeq += 1;
        const fromTimePos = Boolean(current?.started) && mpv.timePos !== null && mpv.timePosAt !== null;
        callListener(onClock, {
            trackKey: current?.trackKey ?? null,
            positionSec: position(),
            paused: isClockPaused(),
            reason,
            seq: clockSeq,
            // 尾随定时器推的是窗口里最后一个 time-pos，读到它的时刻比推送早；渲染进程按这个补。
            sampledAtMs: fromTimePos ? mpv.timePosAt : lastClockAt,
        }, 'clock');
    };

    // time-pos 每帧都变：最多每 clockIntervalMs 推一次，窗口内最后一个值用尾随定时器补上；跳转后的第一个值立刻推。
    const noteTimePos = value => {
        // 当前项已经失败时 mpv 可能还在报别的项的位置（停下之前接上了预载项），不收；mpv 在放别的项时也不收。
        if (typeof value !== 'number' || !Number.isFinite(value) || !isOnCurrentEntry() || current.failed) return;
        mpv.timePos = value;
        mpv.timePosAt = now();
        if (forcedClockReason) {
            const reason = forcedClockReason;
            forcedClockReason = null;
            pushClock(reason);
            return;
        }
        const waitMs = lastClockAt + clockIntervalMs - now();
        if (waitMs <= 0) {
            pushClock('tick');
            return;
        }
        if (clockTimer === null) {
            clockTimer = setTimeoutFn(() => {
                clockTimer = null;
                pushClock('tick');
            }, waitMs);
        }
    };

    const clearIdleTimer = () => {
        if (idleTimer === null) return;
        clearTimeoutFn(idleTimer);
        idleTimer = null;
    };

    const hasActiveEntry = () => Boolean(pending || next || (current && current.loaded));

    // 进程开着却什么都没放：过 idleExitMs 让它退出，不在后台一直挂着。
    const armIdleTimer = () => {
        clearIdleTimer();
        if (!proc || disposed || hasActiveEntry()) return;
        idleTimer = setTimeoutFn(() => {
            idleTimer = null;
            if (!proc || hasActiveEntry()) return;
            logInfo(`[HiFi] mpv idle for ${Math.round(idleExitMs / 1000)} s, asking it to quit`);
            errorCode = null;
            void retireProcess(proc, { graceful: true });
            scheduleState();
        }, idleExitMs);
        idleTimer?.unref?.();
    };

    const revokeEntry = entry => {
        if (!entry?.token) return;
        try {
            bridge.revoke(entry.token);
        } catch (error) {
            logWarn('[HiFi] bridge revoke failed', error);
        }
        entry.token = null;
    };

    const retire = entry => {
        if (entry?.token) retired.add(entry);
    };

    const flushRetired = () => {
        for (const entry of retired) revokeEntry(entry);
        retired.clear();
    };

    const revokeAllEntries = () => {
        flushRetired();
        revokeEntry(pending?.entry);
        revokeEntry(current);
        revokeEntry(next);
    };

    const entryById = id => {
        if (typeof id !== 'number') return null;
        for (const entry of [pending?.entry, current, next]) {
            if (entry && entry.mpvId === id) return entry;
        }
        return null;
    };

    const retiredById = id => {
        for (const entry of retired) {
            if (entry.mpvId === id) return entry;
        }
        return null;
    };

    const send = (record, args) => {
        if (!record?.client) return Promise.reject(createHifiError('MPV_CRASHED', 'mpv is not running'));
        return record.client.command(args).catch(error => {
            // mpv 不回话就是卡死了：杀掉，按崩溃记一次。
            if (error?.code === 'IPC_TIMEOUT' && record === proc) {
                logWarn(`[HiFi] mpv did not answer ${args[0]}, killing it`, error);
                handleCrash(record, 'IPC_TIMEOUT', String(args[0]));
            }
            throw error;
        });
    };

    // 走带这类命令失败了只记一行：调用方是 void 接口，崩溃另有通道报。
    const runCommand = async (record, args) => {
        try {
            await send(record, args);
        } catch (error) {
            logWarn(`[HiFi] mpv ${args[0]} ${args[1] ?? ''} failed`.trimEnd(), error);
        }
    };

    const getProperty = (record, name) => send(record, ['get_property', name]).catch(() => null);

    const settleQuietly = attempt => {
        if (!attempt || attempt.done) return;
        attempt.done = true;
        clearTimeoutFn(attempt.timer);
        if (pending === attempt) pending = null;
        attempt.settle({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' });
    };

    const failAttempt = (attempt, code, detail, { stopPlayback = false } = {}) => {
        if (!attempt || attempt.done) return;
        attempt.done = true;
        clearTimeoutFn(attempt.timer);
        if (pending === attempt) pending = null;
        const { entry } = attempt;
        const cleanDetail = sanitizeDetail(detail);
        if (current === entry) {
            errorCode = code;
            entry.failed = true;
            if (stopPlayback && proc && entry.mpvId !== null) void runCommand(proc, ['stop']);
        }
        revokeEntry(entry);
        if (cleanDetail === 'superseded') logInfo(`[HiFi] load of ${entry.trackKey} superseded`);
        else logWarn(`[HiFi] load of ${entry.trackKey} failed (${code})${cleanDetail ? `: ${cleanDetail}` : ''}`);
        attempt.settle({ ok: false, errorCode: code, ...(cleanDetail ? { detail: cleanDetail } : {}) });
        armIdleTimer();
        scheduleState();
    };

    /**
     * 载入成功记一行，带上输出驱动。输出刚开时 current-ao 的变化常常晚于 audio-out-params 才推到，
     * 这时当场问 mpv 一次（输出已经开着，它答得上来），这一行就总是同一个样子。
     */
    const logLoaded = (record, entry, out) => {
        const write = currentAo => logInfo(`[HiFi] loaded ${entry.sourceKind} ${entry.trackKey}`
            + (out ? ` -> ${currentAo ? `${currentAo} ` : ''}${out.samplerate} Hz ${out.format} ${out.channels}` : ''));
        if (!out || mpv.currentAo || !record) {
            write(mpv.currentAo);
            return;
        }
        void getProperty(record, 'current-ao').then(value => write(stringOrNull(value) ?? (owns(record) ? mpv.currentAo : null)));
    };

    const resolveAttempt = attempt => {
        if (!attempt || attempt.done) return;
        attempt.done = true;
        clearTimeoutFn(attempt.timer);
        if (pending === attempt) pending = null;
        const { entry } = attempt;
        entry.loaded = true;
        flushRetired();
        logLoaded(proc, entry, mpv.audioOutParams);
        if (entry.seekAfterLoad !== null && proc) {
            const target = entry.seekAfterLoad;
            entry.seekAfterLoad = null;
            void seekTo(proc, target);
        }
        attempt.settle({ ok: true, state: buildState() });
        scheduleState();
    };

    const noteCrash = () => {
        const at = now();
        crashTimes.push(at);
        while (crashTimes.length > 0 && at - crashTimes[0] > crashWindowMs) crashTimes.shift();
        if (!circuitOpen && crashTimes.length >= crashLimit) {
            circuitOpen = true;
            logWarn(`[HiFi] mpv failed ${crashTimes.length} times within ${Math.round(crashWindowMs / 1000)} s, HiFi stays off for this session`);
        }
    };

    const killChild = record => {
        if (record.exited || record.killSent) return;
        record.killSent = true;
        try {
            record.child.kill();
        } catch (error) {
            logWarn('[HiFi] mpv kill failed', error);
        }
    };

    const closeClient = record => {
        try {
            record.client?.close();
        } catch (error) {
            logWarn('[HiFi] mpv ipc close failed', error);
        }
    };

    // 不再用这个进程：先摘掉引用（它迟到的事件就进不来），再请它退出或直接杀掉。
    const retireProcess = (record, { graceful }) => {
        if (proc === record) {
            proc = null;
            mpv = createMpvProps();
            track = null;
            startedEntryId = null;
            forcedClockReason = null;
            seekPending = false;
            clearClockTimer();
        }
        if (launching === record) launching = null;
        record.intentional = true;
        clearIdleTimer();
        if (record.exited) {
            closeClient(record);
            return Promise.resolve();
        }
        dying.add(record);
        const exited = new Promise(resolve => record.exitWaiters.push(resolve));
        if (graceful && record.client && !record.client.isClosed()) {
            record.client.command(['quit']).catch(() => {});
            record.killTimer = setTimeoutFn(() => {
                record.killTimer = null;
                if (record.exited) return;
                logWarn('[HiFi] mpv did not quit in time, killing it');
                closeClient(record);
                killChild(record);
            }, QUIT_GRACE_MS);
        } else {
            closeClient(record);
            killChild(record);
        }
        return exited;
    };

    // mpv 不是我们让它走的却没了（进程退出、IPC 断开、命令超时）：这一曲停了，下次载入重新拉起。
    const handleCrash = (record, code, detail) => {
        if (record !== proc) return;
        const trackKey = pending?.entry.trackKey ?? current?.trackKey ?? null;
        const stderrTail = record.stderrTail.trim();
        void retireProcess(record, { graceful: false });
        const attempt = pending;
        revokeAllEntries();
        next = null;
        if (current) {
            current.loaded = false;
            current.failed = true;
        }
        errorCode = code;
        noteCrash();
        logWarn(`[HiFi] mpv went away (${code}): ${sanitizeDetail(detail)}${stderrTail ? ` | stderr: ${sanitizeDetail(stderrTail)}` : ''}`);
        if (attempt) failAttempt(attempt, code, detail);
        callListener(onError, { code, trackKey, detail: sanitizeDetail(detail), fatal: true }, 'error');
        scheduleState();
    };

    const noteLog = message => {
        if (!FAILURE_LOG_LEVELS.has(message.level)) return;
        const line = {
            prefix: typeof message.prefix === 'string' ? message.prefix : '',
            level: message.level,
            text: typeof message.text === 'string' ? message.text.trim() : '',
        };
        recentLogs.push(line);
        if (recentLogs.length > RECENT_LOG_LIMIT) recentLogs.shift();
        if (line.level !== 'warn') logWarn(`[HiFi] mpv ${line.prefix}: ${sanitizeDetail(line.text)}`);
        if (isOutputStreamLost(line)) noteOutputStreamLost(line);
    };

    /**
     * PipeWire / PulseAudio 的流连不上输出（别的流独占着节点、节点没了）：mpv 不报错，丢着帧快进到结尾再报放完。
     * 不等那个假的“放完”，这一首当场按 DEVICE_BUSY 失败：还在载入的让载入失败，已经在放的按中途出错报给渲染端回落。
     */
    const noteOutputStreamLost = line => {
        const detail = `${line.prefix}: ${line.text}`;
        if (pending && pending.entry === current && current.started) {
            failAttempt(pending, 'DEVICE_BUSY', detail, { stopPlayback: true });
            return;
        }
        if (current?.loaded && !current.failed && isOnCurrentEntry()) failPlayingEntry(current, 'DEVICE_BUSY', detail);
    };

    const startEntry = entry => {
        if (entry === next) {
            // 无缝接上了预载的那一首：它成为当前项，上一首的令牌等会儿撤销。
            if (current && current !== entry) retire(current);
            current = entry;
            next = null;
            entry.loaded = true;
            errorCode = null;
            // 时长还是上一首的：这一首的随 file-loaded 推来，没推（两首一样长时 mpv 可能不推）就由 refreshFormat 读。
            mpv.duration = null;
            logInfo(`[HiFi] gapless switch to ${entry.trackKey}`);
        }
        entry.started = true;
        mpv.timePos = null;
        mpv.timePosAt = null;
        mpv.eofReached = false;
        seekPending = false;
        track = null;
        flushRetired();
        if (entry.loaded) pushClock('load');
        scheduleState();
    };

    const refreshTrack = (record, entry) => {
        void getProperty(record, 'track-list').then(list => {
            if (!owns(record) || current !== entry) return;
            track = toTrackInfo(list);
            scheduleState();
        });
    };

    // 同格式换曲时 mpv 不重开输出，audio-out-params 不会再推一次：开始播放时主动读一遍，读到非空就算载入成功。
    // 时长一起读：无缝换曲时两首一样长，duration 不会再推。
    const refreshFormat = (record, entry) => {
        void Promise.all([getProperty(record, 'audio-params'), getProperty(record, 'audio-out-params'), getProperty(record, 'duration')])
            .then(([params, outParams, duration]) => {
                if (!owns(record) || current !== entry) return;
                mpv.audioParams = toAudioParams(params);
                mpv.audioOutParams = toAudioParams(outParams);
                if (numberOrNull(duration) !== null) mpv.duration = numberOrNull(duration);
                scheduleState();
                if (mpv.audioOutParams && pending?.entry === entry && entry.started) resolveAttempt(pending);
            });
    };

    // 已经在放的那一首中途出错（源断了、输出设备没了）：报给渲染端回落。预载的下一首也不接着放，
    // 渲染端会把这一首换到 Web 重放；mpv 停下，keep-open 留着的输出（独占的设备）随之放开。
    const failPlayingEntry = (entry, code, detail) => {
        entry.loaded = false;
        entry.failed = true;
        errorCode = code;
        seekPending = false;
        revokeEntry(entry);
        if (next) {
            retire(next);
            next = null;
        }
        if (proc) void runCommand(proc, ['stop']);
        logWarn(`[HiFi] ${entry.trackKey} stopped with an error (${code}): ${sanitizeDetail(detail)}`);
        callListener(onError, { code, trackKey: entry.trackKey, detail: sanitizeDetail(detail), fatal: true }, 'error');
        armIdleTimer();
        scheduleState();
    };

    // mpv 读到截断的流（来源桥断了连接，ffmpeg 重连几次后放弃）只会报放完：桥记着这个源的错，
    // 位置又明显没到时长（或时长不知道），就是源中途断了。返回桥记的码，正常放完时为 null。
    const sourceBrokeEarly = entry => {
        const code = entry.token ? bridge.getSourceError(entry.token) : null;
        if (!code) return null;
        if (mpv.duration !== null && position() >= mpv.duration - END_TOLERANCE_SEC) return null;
        return code;
    };

    const handleEndFile = message => {
        const id = message.playlist_entry_id;
        const retiredEntry = retiredById(id);
        if (retiredEntry) {
            retired.delete(retiredEntry);
            revokeEntry(retiredEntry);
            return;
        }
        const entry = entryById(id);
        if (!entry) return;
        if (message.reason === 'redirect' && pending?.entry === entry) {
            failAttempt(pending, 'FORMAT_UNSUPPORTED', 'redirect', { stopPlayback: true });
            return;
        }
        if (message.reason === 'eof') {
            // 后面排着预载项时 keep-open 不起作用，放完的那一首报 end-file eof 而不是 eof-reached。
            if (entry !== current || !entry.loaded || entry.failed) return;
            const code = sourceBrokeEarly(entry);
            if (code) {
                failPlayingEntry(entry, code, 'source ended early');
                return;
            }
            // 没有预载项却报了 eof：clearNext 正在撤的那一项没来得及删掉，mpv 已经接上了它（随后被删掉，mpv 停下）。
            // 当前这首就是放完了，按 ended 报，渲染端照常换下一首；不然状态会一直停在“在放”。
            if (!next) {
                entry.movedPast = true;
                logInfo(`[HiFi] ${entry.trackKey} reached the end while its queued song was being removed`);
                scheduleState();
            }
            return;
        }
        if (message.reason !== 'error') return;
        const sourceError = entry.token ? bridge.getSourceError(entry.token) : null;
        const code = classifyEndFile({ reason: message.reason, fileError: message.file_error }, recentLogs, sourceError);
        const detail = typeof message.file_error === 'string' ? message.file_error : 'error';
        if (pending?.entry === entry) {
            failAttempt(pending, code, detail);
            return;
        }
        if (entry === next) {
            logWarn(`[HiFi] queued ${entry.trackKey} failed before it started (${code})`);
            revokeEntry(entry);
            next = null;
            scheduleState();
            return;
        }
        if (entry.failed) return;
        failPlayingEntry(entry, code, detail);
    };

    const handleEvent = (record, message) => {
        if (!owns(record)) return;
        switch (message.event) {
        case 'log-message':
            noteLog(message);
            break;
        case 'start-file': {
            startedEntryId = typeof message.playlist_entry_id === 'number' ? message.playlist_entry_id : null;
            const entry = entryById(startedEntryId);
            if (entry) startEntry(entry);
            break;
        }
        case 'end-file':
            handleEndFile(message);
            break;
        case 'file-loaded':
            if (current?.started && current.mpvId === startedEntryId) refreshTrack(record, current);
            break;
        case 'playback-restart':
            if (current?.started && current.mpvId === startedEntryId) {
                forcedClockReason = current.restarted ? 'seek' : 'load';
                current.restarted = true;
                if (seekPending) {
                    // 我们发的跳转落定了：立刻推一次让时钟接着走（跳转时推的那次是停着的）。
                    seekPending = false;
                    forcedClockReason = null;
                    pushClock(isClockPaused() ? 'seek' : 'resume');
                }
                refreshFormat(record, current);
            }
            break;
        case 'idle':
            scheduleState();
            break;
        default:
            break;
        }
    };

    // keep-open 停在了当前项的末尾（mpv.eofReached 已经置上）。
    const noteEofReached = () => {
        seekPending = false;
        // 排着预载项时 keep-open 本不会停在末尾：说明 append 晚于 EOF 才到 mpv，它接上时会停在暂停里。
        if (next && !next.started) next.queuedAfterEof = true;
        if (!current?.loaded || current.failed) return;
        const code = sourceBrokeEarly(current);
        if (code) {
            failPlayingEntry(current, code, 'source ended early');
            return;
        }
        if (!next) logInfo(`[HiFi] ${current.trackKey} reached the end`);
    };

    /**
     * mpv 停回了暂停：可能是 keep-open 停在了末尾。暂停着载入到末尾再放开时 mpv 马上又停下，却不推 eof-reached，
     * 状态会一直是“暂停”。问它一次，真到了头就按放完报，渲染端照常换下一首或停下。
     */
    const checkPausedAtEnd = record => {
        const entry = current;
        if (!entry?.loaded || entry.failed || next || mpv.eofReached || !isOnCurrentEntry()) return;
        const seeksBefore = seekRequests;
        void getProperty(record, 'eof-reached').then(value => {
            if (value !== true || proc !== record || current !== entry || entry.failed || next) return;
            if (mpv.eofReached || !mpv.paused || seekRequests !== seeksBefore) return;
            mpv.eofReached = true;
            noteEofReached();
            scheduleState();
        });
    };

    const handlePropertyChange = (record, name, value) => {
        if (!owns(record)) return;
        switch (name) {
        case 'time-pos':
            noteTimePos(value);
            return;
        case 'pause': {
            const paused = value === true;
            if (paused === mpv.paused) return;
            mpv.paused = paused;
            if (current?.started) pushClock(paused ? 'pause' : 'resume');
            if (paused) checkPausedAtEnd(record);
            break;
        }
        case 'paused-for-cache': {
            // 缓存见底只停时钟，不算暂停（像 <audio> 的 waiting，paused 不变），状态里也不体现。
            const buffering = value === true;
            if (buffering === mpv.pausedForCache) return;
            mpv.pausedForCache = buffering;
            if (current?.started) pushClock('tick');
            return;
        }
        case 'duration':
            // 正被撤下的预载项（mpv 已经接上了它）的时长不归当前项。
            if (current?.movedPast && !isOnCurrentEntry()) return;
            mpv.duration = numberOrNull(value);
            break;
        case 'eof-reached':
            mpv.eofReached = value === true;
            if (mpv.eofReached) noteEofReached();
            break;
        case 'audio-params':
            mpv.audioParams = toAudioParams(value);
            break;
        case 'audio-out-params':
            mpv.audioOutParams = toAudioParams(value);
            // 开了新的输出（换了格式或设备），说明这一项的声音出来了。
            if (mpv.audioOutParams && pending?.entry.started && pending.entry === current) resolveAttempt(pending);
            break;
        case 'current-ao':
            mpv.currentAo = stringOrNull(value);
            break;
        case 'audio-device':
            mpv.audioDevice = stringOrNull(value);
            break;
        case 'volume':
            mpv.volume = numberOrNull(value);
            break;
        case 'loop-file':
            mpv.loopFile = isLoopFileOn(value);
            break;
        case 'playlist-pos':
            mpv.playlistPos = numberOrNull(value) ?? -1;
            return;
        case 'playlist-count':
            mpv.playlistCount = numberOrNull(value) ?? 0;
            return;
        default:
            return;
        }
        scheduleState();
    };

    const handleExit = (record, code, signal) => {
        record.exited = true;
        if (record.killTimer !== null) {
            clearTimeoutFn(record.killTimer);
            record.killTimer = null;
        }
        dying.delete(record);
        for (const resolve of record.exitWaiters.splice(0)) resolve();
        if (record === launching) {
            record.failStartup(createHifiError('MPV_SPAWN_FAILED', `exited during startup (code ${code}, signal ${signal})`));
            return;
        }
        if (record !== proc || record.intentional) {
            closeClient(record);
            return;
        }
        handleCrash(record, 'MPV_CRASHED', `exit code ${code}, signal ${signal}`);
    };

    // 拉起一个 mpv 并连好 IPC：Unix 走 spawn 出的 socketpair（fd 3，父进程没了 mpv 也跟着退），Windows 走随机命名管道。
    const spawnProcess = async () => {
        const runtime = await resolveRuntime();
        // 检测途中会话被收掉了（退出时的 killSync）：不再拉起。
        if (disposed) throw createHifiError('LOAD_FAILED', 'stopped');
        if (!runtime || typeof runtime.path !== 'string' || runtime.path === '') throw createHifiError('MPV_NOT_FOUND');
        const spawnConfig = { ...config };
        const pipePath = isWindows ? buildPipeName(randomBytes(16).toString('hex')) : null;
        const args = buildMpvArgs({
            platform,
            ipc: isWindows ? { kind: 'pipe', path: pipePath } : { kind: 'fd' },
            exclusive: spawnConfig.exclusive,
            dsdMode: spawnConfig.dsdMode,
            ao,
        });
        let child;
        try {
            child = spawnFn(runtime.path, args, {
                stdio: isWindows ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });
        } catch (error) {
            logWarn('[HiFi] mpv spawn threw', error);
            throw createHifiError('MPV_SPAWN_FAILED', error);
        }
        const record = {
            child,
            client: null,
            exited: false,
            killSent: false,
            intentional: false,
            stderrTail: '',
            killTimer: null,
            exitWaiters: [],
            nextEntryId: 1,
            /** 这个 mpv 列出的设备名（加上主进程补的 hw:）；还没读过时为 null。 */
            deviceNames: null,
            abort: new AbortController(),
            failStartup: () => {},
        };
        const startupFailed = new Promise((_resolve, reject) => {
            record.failStartup = error => {
                record.abort.abort();
                reject(error);
            };
        });
        startupFailed.catch(() => {});
        launching = record;
        child.on('error', error => {
            logWarn('[HiFi] mpv process error', error);
            if (record === launching) record.failStartup(createHifiError('MPV_SPAWN_FAILED', error));
        });
        child.on('exit', (code, signal) => handleExit(record, code, signal));
        child.stdout?.on('data', () => {});
        child.stderr?.on('data', chunk => {
            record.stderrTail = `${record.stderrTail}${chunk}`.slice(-STDERR_TAIL_CHARS);
        });

        try {
            const socket = isWindows
                ? await Promise.race([connectPipe(pipePath, { signal: record.abort.signal }), startupFailed])
                : child.stdio?.[3];
            if (!socket) throw createHifiError('MPV_SPAWN_FAILED', 'mpv has no ipc socket');
            const client = createIpcClient({ socket, setTimeoutFn, clearTimeoutFn, logWarn });
            record.client = client;
            client.onEvent(message => handleEvent(record, message));
            for (const name of OBSERVED_PROPERTIES) {
                client.onPropertyChange(name, value => handlePropertyChange(record, name, value));
            }
            client.onClose(info => {
                if (info?.intentional || record.intentional) return;
                if (record === launching) {
                    record.failStartup(createHifiError('MPV_SPAWN_FAILED', info?.error || 'ipc closed during startup'));
                    return;
                }
                handleCrash(record, 'MPV_CRASHED', info?.error || 'ipc closed');
            });
            await Promise.race([
                Promise.all([
                    client.command(['request_log_messages', 'warn']),
                    ...OBSERVED_PROPERTIES.map(name => client.observeProperty(name)),
                ]),
                startupFailed,
            ]);
        } catch (error) {
            if (launching === record) launching = null;
            void retireProcess(record, { graceful: false });
            // 是 dispose / killSync 在启动途中把它收掉的：不算 mpv 起不来，也不计进熔断。
            if (disposed) throw createHifiError('LOAD_FAILED', 'stopped');
            logWarn('[HiFi] mpv did not start', error);
            throw createHifiError('MPV_SPAWN_FAILED', detailOf(error) ?? error?.code);
        }
        // 启动期间被 dispose / killSync 收掉了：不算 mpv 的错。
        if (disposed || launching !== record) {
            if (launching === record) launching = null;
            void retireProcess(record, { graceful: false });
            throw createHifiError('LOAD_FAILED', 'stopped');
        }
        launching = null;
        proc = record;
        applied = {
            // 启动参数里的设备总是 auto，设置里的设备核对过设备表才换过去。
            requestedDevice: 'auto',
            audioDevice: 'auto',
            exclusive: effectiveExclusive(platform, spawnConfig.exclusive),
            spdif: spdifFor(spawnConfig),
            volume: 100,
            // 启动参数里没有 --mute：mpv 起来时不静音。
            mute: false,
        };
        logInfo(`[HiFi] ${runtime.version ? `mpv ${runtime.version}` : 'mpv'} started (pid ${child.pid ?? '?'})`);
        // 设置里的设备、启动期间又变了的设置、软件音量和静音：补发和启动参数不同的那几项。等它们发完才交出进程，
        // 这些都在任何 loadfile 之前到 mpv（设备要先读一遍设备表）。
        await applyConfig(record);
        return record;
    };

    const ensureProcess = () => {
        // 拉起中先等它：proc 在补发设置（设备要读设备表）之前就有了，这时直接拿 proc 的 loadfile 会赶在设备之前到 mpv。
        if (starting) return starting;
        if (proc) return Promise.resolve(proc);
        starting = spawnProcess().then(
            record => {
                starting = null;
                // 拉起期间载入被 stop 收掉了：没人用它，照常计空闲。
                armIdleTimer();
                scheduleState();
                return record;
            },
            error => {
                starting = null;
                if (toHifiErrorCode(error) === 'MPV_SPAWN_FAILED') noteCrash();
                scheduleState();
                throw error;
            },
        );
        scheduleState();
        return starting;
    };

    const createEntry = (request, ownerId) => ({
        trackKey: request.trackKey,
        songKey: request.songKey,
        sourceKind: request.source.kind,
        localSourceKey: request.source.kind === 'local' ? request.source.sourceKey : null,
        startSec: typeof request.startSec === 'number' && request.startSec > 0 ? request.startSec : 0,
        ownerId,
        token: null,
        mpvId: null,
        started: false,
        restarted: false,
        loaded: false,
        failed: false,
        seekAfterLoad: null,
        /** 预载项的 append 晚于上一首的 EOF 才到 mpv。 */
        queuedAfterEof: false,
        /** 放完以后 mpv 接上了正被撤下的预载项：这一项算放完了（ended）。 */
        movedPast: false,
    });

    // 在来源桥上登记，拿到给 mpv 的 127.0.0.1 地址；Navidrome 带凭据的地址只留在桥里。
    const registerSource = (entry, source) => {
        const registered = source.kind === 'local'
            ? bridge.registerLocal({
                sourceKey: source.sourceKey,
                size: source.size,
                mimeType: source.mimeType,
                fileName: source.fileName,
                ownerId: entry.ownerId,
            })
            : bridge.registerRemote({ url: source.url, fileName: source.fileName });
        entry.token = registered.token;
        return registered.url;
    };

    // mpv 的 playlist_entry_id 从 1 起逐个分配；发 loadfile 时就记下预计的 id，start-file 可能比回复先到。
    const sendLoadfile = async (record, entry, url, mode, startSec) => {
        entry.mpvId = record.nextEntryId;
        record.nextEntryId += 1;
        const reply = await send(record, buildLoadfileCommand(url, mode, { startSec }));
        const actualId = reply && typeof reply.playlist_entry_id === 'number' ? reply.playlist_entry_id : null;
        if (actualId !== null && actualId !== entry.mpvId) {
            logWarn(`[HiFi] mpv gave entry id ${actualId}, expected ${entry.mpvId}`);
            entry.mpvId = actualId;
            record.nextEntryId = actualId + 1;
        }
    };

    const runLoad = async (attempt, request) => {
        const record = await ensureProcess();
        await recheckFallenBackDevice(record);
        if (pending !== attempt) return;
        await bridge.start();
        if (pending !== attempt || proc !== record) return;
        const url = registerSource(attempt.entry, request.source);
        await send(record, ['set_property', 'pause', request.paused === true]);
        // 用会话眼下的值，不用请求里的：load() 已经当场记下请求的值，拉起 mpv 期间 setLoopFile 改过的以后者为准。
        await send(record, ['set_property', 'loop-file', loopFile ? 'inf' : 'no']);
        if (pending !== attempt || proc !== record) return;
        await sendLoadfile(record, attempt.entry, url, 'replace', attempt.entry.startSec);
    };

    /** 用 loadfile replace 载入一首；声音输出真的开起来（audio-out-params 非空）才算成功。 */
    const load = (request, { ownerId = null } = {}) => {
        // 会话已收掉（dispose，或退出时的 killSync）：和被 stop 收掉的载入同样回 'stopped'，渲染端不当成失败。
        if (disposed) return Promise.resolve({ ok: false, errorCode: 'LOAD_FAILED', detail: 'stopped' });
        if (circuitOpen) return Promise.resolve({ ok: false, errorCode: 'CIRCUIT_OPEN' });
        if (!request || !request.source || (request.source.kind !== 'local' && request.source.kind !== 'navidrome')) {
            return Promise.resolve({ ok: false, errorCode: 'INVALID_REQUEST' });
        }
        const entry = createEntry(request, ownerId);
        const previousAttempt = pending;
        const attempt = { entry, settle: null, timer: null, done: false };
        const result = new Promise(resolve => {
            attempt.settle = resolve;
        });
        clearIdleTimer();
        // replace 会清掉整个播放列表：当前项和预载项都退下。
        if (current && current !== previousAttempt?.entry) retire(current);
        if (next) {
            retire(next);
            next = null;
        }
        pending = attempt;
        current = entry;
        // 当场记下：之后（mpv 还在拉起时）的 setLoopFile 能盖过它，runLoad 发的是那时的值。
        loopFile = request.loopFile === true;
        errorCode = null;
        recentLogs = [];
        track = null;
        mpv = { ...mpv, ...createFileProps(), paused: request.paused === true };
        forcedClockReason = null;
        seekPending = false;
        if (previousAttempt) failAttempt(previousAttempt, 'LOAD_FAILED', 'superseded');
        attempt.timer = setTimeoutFn(() => {
            failAttempt(attempt, 'LOAD_FAILED', 'timeout', { stopPlayback: true });
        }, loadTimeoutMs);
        pushClock('load');
        scheduleState();
        runLoad(attempt, request).catch(error => {
            failAttempt(attempt, toHifiErrorCode(error, 'LOAD_FAILED'), detailOf(error));
        });
        return result;
    };

    // 先按目标位置推一次停着的时钟（mpv 还在找位置、没出声），跳完的 playback-restart 时再推一次让它接着走。
    // seek 命令失败就等不到 playback-restart：当场放开时钟。
    const seekTo = async (record, target) => {
        seekRequests += 1;
        mpv.timePos = target;
        mpv.timePosAt = now();
        mpv.eofReached = false;
        seekPending = true;
        // 上一次 playback-restart 留下的“下一个 time-pos 立刻推”作废：这次跳转自己会推。
        forcedClockReason = null;
        pushClock('seek');
        try {
            await send(record, ['seek', target, 'absolute']);
        } catch (error) {
            logWarn(`[HiFi] mpv seek ${target} failed`, error);
            if (seekPending && proc === record) {
                seekPending = false;
                pushClock('seek');
            }
        }
    };

    /**
     * 当前项是不是停在了末尾。缓存的 eof-reached 靠不住：暂停着载入到末尾（恢复出来的位置等于时长）时 mpv 不推它，
     * 所以先看位置有没有到时长，再当场问 mpv。
     */
    const isStoppedAtEnd = async record => {
        if (mpv.eofReached) return true;
        if (mpv.timePos !== null && mpv.duration !== null && mpv.timePos >= mpv.duration - AT_END_TOLERANCE_SEC) return true;
        return (await getProperty(record, 'eof-reached')) === true;
    };

    const play = async () => {
        const record = proc;
        const entry = current;
        if (!record || !entry || entry.failed) return;
        const pausesBefore = pauseRequests;
        const seeksBefore = seekRequests;
        // 问 mpv 的途中按了暂停、换了曲或换了进程：这次播放作废，不把后来的暂停盖掉。
        const stale = () => proc !== record || current !== entry || pauseRequests !== pausesBefore;
        // keep-open 停在了末尾：像 <audio> 那样从头再放。问 mpv 的途中跳转过的，就按那次跳转的位置放。
        if (entry.loaded && !next && isOnCurrentEntry() && await isStoppedAtEnd(record)) {
            if (stale()) return;
            if (!next && seekRequests === seeksBefore) await seekTo(record, 0);
        }
        if (stale()) return;
        await runCommand(record, ['set_property', 'pause', false]);
    };

    const pause = async () => {
        const record = proc;
        if (!record || !current || current.failed) return;
        pauseRequests += 1;
        await runCommand(record, ['set_property', 'pause', true]);
    };

    const seek = async positionSec => {
        if (typeof positionSec !== 'number' || !Number.isFinite(positionSec)) return;
        const target = Math.max(0, positionSec);
        const record = proc;
        if (!record || !current || current.failed) return;
        if (!current.loaded) {
            current.seekAfterLoad = target;
            return;
        }
        await seekTo(record, target);
    };

    const setLoopFile = async loop => {
        loopFile = loop === true;
        if (proc) await runCommand(proc, ['set_property', 'loop-file', loopFile ? 'inf' : 'no']);
        scheduleState();
    };

    // 按 id 在 mpv 的播放列表里找到预载项再删；它要是已经开始播了就不动。
    const removeQueuedEntry = async (record, entry) => {
        if (entry.mpvId === null) return;
        const playlist = await getProperty(record, 'playlist');
        if (!Array.isArray(playlist) || proc !== record || current === entry || pending) return;
        const index = playlist.findIndex(item => item && item.id === entry.mpvId);
        if (index === -1 || playlist[index].current || playlist[index].playing) return;
        await runCommand(record, ['playlist-remove', index]);
    };

    /**
     * 用 loadfile append 预载下一首，接在当前这首后面无缝播放。当前没在放、或已经放到末尾时返回 false：
     * keep-open 停在末尾时已经把 pause 置上，这时再 append，mpv 会接上下一首却停在暂停里，渲染端该走普通载入。
     */
    const preloadNext = async (request, { ownerId = null } = {}) => {
        if (disposed || circuitOpen || !proc || pending || !current?.loaded || isAtEnd()) return false;
        if (!request || !request.source || (request.source.kind !== 'local' && request.source.kind !== 'navidrome')) return false;
        const record = proc;
        const base = current;
        const pausesBefore = pauseRequests;
        const entry = createEntry({ ...request, startSec: 0 }, ownerId);
        try {
            await bridge.start();
        } catch (error) {
            logWarn('[HiFi] bridge did not start for the queued song', error);
            return false;
        }
        if (proc !== record || current !== base || pending || !current.loaded || isAtEnd()) return false;
        let url;
        try {
            url = registerSource(entry, request.source);
        } catch (error) {
            logWarn('[HiFi] could not register the queued song', error);
            return false;
        }
        clearIdleTimer();
        const previousNext = next;
        next = entry;
        if (previousNext) {
            retire(previousNext);
            void removeQueuedEntry(record, previousNext);
        }
        scheduleState();
        try {
            await sendLoadfile(record, entry, url, 'append', 0);
        } catch (error) {
            logWarn(`[HiFi] could not queue ${entry.trackKey}`, error);
            if (next === entry) next = null;
            revokeEntry(entry);
            scheduleState();
            return false;
        }
        // append 在途时当前这首放到了头：keep-open 加的暂停会带到接上的这一首，没人按过暂停就放开。
        if (entry.queuedAfterEof && pauseRequests === pausesBefore && proc === record && (next === entry || current === entry)) {
            logInfo(`[HiFi] ${entry.trackKey} was queued after the end of the previous song, resuming`);
            await runCommand(record, ['set_property', 'pause', false]);
        }
        return next === entry || current === entry;
    };

    const clearNext = async () => {
        const entry = next;
        if (!entry) return;
        next = null;
        retire(entry);
        scheduleState();
        if (proc) await removeQueuedEntry(proc, entry);
        if (retired.has(entry)) {
            retired.delete(entry);
            revokeEntry(entry);
        }
    };

    /** 停下并让 mpv 关掉音频输出（独占的设备立刻还给系统），进程留着，空闲一段时间后再退出。 */
    const stop = async () => {
        settleQuietly(pending);
        const record = proc;
        const stopped = record ? runCommand(record, ['stop']) : Promise.resolve();
        revokeAllEntries();
        current = null;
        next = null;
        errorCode = null;
        track = null;
        mpv = { ...mpv, ...createFileProps() };
        forcedClockReason = null;
        seekPending = false;
        clearClockTimer();
        scheduleState();
        await stopped;
        armIdleTimer();
    };

    // mpv 的设备表，Linux 上补上 hw: 直连设备；名字记在这个进程上，配置设备时只认表里有的。
    const fetchDevices = async record => {
        const list = await send(record, ['get_property', 'audio-device-list']);
        const devices = Array.isArray(list) ? list.map(item => toDevice(platform, item)).filter(Boolean) : [];
        // mpv 的 ALSA 设备表把 hw: 都滤掉了（只留 plughw、dmix 这些），可 --audio-device=alsa/hw:... 照样开得了。
        const merged = platform === 'linux' ? mergeAlsaHwDevices(devices, await readAlsaHwDevices()) : devices;
        record.deviceNames = new Set(merged.map(device => device.name));
        record.deviceListReadAt = now();
        return merged;
    };

    /**
     * 设置里的设备交不交给 mpv：只认 'auto' 和这个 mpv 自己列出的（加上主进程补的 hw:）设备，表里没有先重读一次，
     * 还没有就留在 auto。渲染端给的别的名字一律不发：ALSA 会把 file:|… 这样的设备名当成命令执行。
     */
    const resolveDevice = async (record, name) => {
        if (name === 'auto') return 'auto';
        if (record.deviceNames?.has(name)) return name;
        try {
            await fetchDevices(record);
        } catch (error) {
            logWarn('[HiFi] could not read the device list', error);
        }
        if (record.deviceNames?.has(name)) return name;
        logWarn(`[HiFi] ignoring an audio device that is not in the device list: ${JSON.stringify(name)}`);
        return 'auto';
    };

    // 运行中的 mpv 和设置对不上的项逐个 set_property；只发变了的，audio-device / audio-exclusive / audio-spdif 一改 mpv 就重开输出。
    // 设置里的设备换了才核对设备表（之后的音量、静音不再重读）；核对期间又换了设备或换了进程，交给后来的那次。
    // 静音不看软件音量开没开（应用里静音了就得没声）；没静音时 mute 关着，样本照旧原样出去。
    const applyConfig = async record => {
        const requestedDevice = config.audioDevice;
        let audioDevice = applied.audioDevice;
        if (requestedDevice !== applied.requestedDevice) {
            applied.requestedDevice = requestedDevice;
            audioDevice = await resolveDevice(record, requestedDevice);
            if (proc !== record || applied.requestedDevice !== requestedDevice) return;
        }
        const target = {
            requestedDevice,
            audioDevice,
            exclusive: effectiveExclusive(platform, config.exclusive),
            spdif: spdifFor(config),
            volume: volumeFor(config),
            mute: config.muted,
        };
        const commands = [];
        if (target.audioDevice !== applied.audioDevice) commands.push(['set_property', 'audio-device', target.audioDevice]);
        if (target.exclusive !== applied.exclusive) commands.push(['set_property', 'audio-exclusive', target.exclusive]);
        if (target.spdif !== applied.spdif) commands.push(['set_property', 'audio-spdif', target.spdif]);
        if (target.volume !== applied.volume) commands.push(['set_property', 'volume', target.volume]);
        if (target.mute !== applied.mute) commands.push(['set_property', 'mute', target.mute]);
        applied = target;
        await Promise.all(commands.map(command => runCommand(record, command)));
    };

    // 设置里的设备当时不在设备表里（比如 DAC 还没插上）、留在了 auto：载入前再核对一次，插上了就换过去。
    // 刚读过设备表（拉起时、设置刚改过）就不再读。
    const recheckFallenBackDevice = async record => {
        if (proc !== record || applied.requestedDevice === 'auto' || applied.audioDevice !== 'auto') return;
        if (record.deviceListReadAt !== undefined && now() - record.deviceListReadAt < DEVICE_RECHECK_MS) return;
        applied = { ...applied, requestedDevice: 'auto' };
        await applyConfig(record);
    };

    const configure = async nextConfig => {
        config = normalizeConfig(nextConfig, config);
        scheduleState();
        if (proc) await applyConfig(proc);
    };

    // Linux：从 /proc/asound 读出能放音的 hw: 设备；读不到（没有声卡、容器里）就没有，只用 mpv 自己列的。
    const readAlsaHwDevices = async () => {
        try {
            const [cardsText, pcmText] = await Promise.all([readFileFn(ALSA_CARDS_PATH), readFileFn(ALSA_PCM_PATH)]);
            return listAlsaHwDevices(cardsText, pcmText);
        } catch (error) {
            logWarn('[HiFi] could not read the ALSA devices, listing only what mpv lists', error);
            return [];
        }
    };

    const listDevices = async () => {
        if (disposed || circuitOpen) return [];
        const record = await ensureProcess();
        try {
            return await fetchDevices(record);
        } finally {
            armIdleTimer();
        }
    };

    const getSnapshot = () => buildState();

    /** 慢慢退：请 mpv 自己 quit，2 秒不走再杀。 */
    const dispose = async () => {
        if (disposed) return;
        disposed = true;
        clearIdleTimer();
        clearClockTimer();
        settleQuietly(pending);
        revokeAllEntries();
        current = null;
        next = null;
        const records = [proc, launching].filter(Boolean);
        await Promise.all(records.map(record => retireProcess(record, { graceful: true })));
    };

    /**
     * app.exit 之类马上就走的路径：同步杀掉所有 mpv，不等也不推状态。会话从此收掉：之后的 load / listDevices /
     * preloadNext 不再拉起 mpv，正在检测或连 IPC 的那次拉起一落地就被杀掉。
     */
    const killSync = () => {
        disposed = true;
        clearIdleTimer();
        clearClockTimer();
        // 还在连 IPC 的那个：让它的启动立刻失败（Windows 上不再等管道），catch 里按 'stopped' 收尾。
        launching?.failStartup(createHifiError('LOAD_FAILED', 'stopped'));
        for (const record of [proc, launching, ...dying]) {
            if (!record) continue;
            record.intentional = true;
            if (record.killTimer !== null) {
                clearTimeoutFn(record.killTimer);
                record.killTimer = null;
            }
            killChild(record);
            closeClient(record);
        }
        proc = null;
        launching = null;
        dying.clear();
        settleQuietly(pending);
    };

    return {
        configure,
        listDevices,
        load,
        play,
        pause,
        seek,
        stop,
        setLoopFile,
        preloadNext,
        clearNext,
        getSnapshot,
        dispose,
        killSync,
    };
};

module.exports = {
    OBSERVED_PROPERTIES,
    toAudioParams,
    toTrackInfo,
    toDevice,
    parseAlsaCards,
    parseAlsaPlaybackPcms,
    listAlsaHwDevices,
    mergeAlsaHwDevices,
    createMpvSession,
};
