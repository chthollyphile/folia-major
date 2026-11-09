'use strict';

const { execFile } = require('child_process');
const { AUDIO_CLIENT_NAME } = require('./mpvArgs.cjs');

// Linux：用 pw-dump 读 mpv 那路流在 PipeWire 里的去向（经过的滤波链、设备的采样率和格式、音量、同一设备上别的流），
// 结果是 HifiOutputProbe。这只是 PipeWire 自己报的状态：DAC 实际收到什么采样率，要在实机上由人看 DAC 的采样率指示
// 或听来确认，这里不下「位精确」的结论，也不推断 PipeWire 没报的东西。

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
/** 渲染端会轮询：这么久之内的调用共用上一次 pw-dump 的结果。 */
const DEFAULT_CACHE_MS = 750;
/** 从 mpv 的流走到设备最多跨这么多条连接。真实的滤波链远没有这么长；这是图出了怪样子时的保险。 */
const MAX_HOPS = 10;

const NODE_TYPE = 'PipeWire:Interface:Node';
const LINK_TYPE = 'PipeWire:Interface:Link';
const CLIENT_TYPE = 'PipeWire:Interface:Client';
const METADATA_TYPE = 'PipeWire:Interface:Metadata';
const STREAM_OUTPUT_CLASS = 'Stream/Output/Audio';
const SINK_CLASSES = new Set(['Audio/Sink', 'Audio/Duplex']);
/** 这两种状态的连接没在传声音，不算链路的一段。 */
const DEAD_LINK_STATES = new Set(['error', 'unlinked']);
/** factory.name（api.alsa.pcm.sink）和 api.* 属性名（api.bluez5.address）里的接口名。 */
const API_PATTERN = /^api\.([A-Za-z0-9_-]+)\./;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const textOrNull = value => (typeof value === 'string' && value !== '' ? value : null);

// PipeWire 的数值有时是数，有时是数字字符串（老版本的 metadata、pulse 那边转过来的属性）。
const toNumber = value => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
    return null;
};

const toRate = value => {
    const number = toNumber(value);
    return number !== null && number > 0 ? number : null;
};

const toInteger = value => {
    const number = toNumber(value);
    return number !== null && Number.isSafeInteger(number) ? number : null;
};

/** clock.allowed-rates：'[ 44100 48000 ]' 这样的字符串，也接受数组和单个数。 */
const parseRateList = value => {
    if (Array.isArray(value)) return value.map(toRate).filter(rate => rate !== null);
    if (typeof value === 'string') return (value.match(/\d+(\.\d+)?/g) ?? []).map(toRate).filter(rate => rate !== null);
    const single = toRate(value);
    return single === null ? [] : [single];
};

const propsOf = object => (isPlainObject(object?.info?.props) ? object.info.props : {});

const firstParam = (node, key) => {
    const values = node?.info?.params?.[key];
    return Array.isArray(values) && isPlainObject(values[0]) ? values[0] : null;
};

const stateOf = node => textOrNull(node?.info?.state);

/** Format 参数里的格式名、采样率、声道数；滤波链里的 DSP 格式（F32P）不带采样率，那一项为 null。 */
const readFormat = node => {
    const format = firstParam(node, 'Format');
    if (!format) return { format: null, rate: null, channels: null };
    const channels = toInteger(format.channels);
    return {
        format: textOrNull(format.format),
        rate: toRate(format.rate),
        channels: channels !== null && channels > 0 ? channels : null,
    };
};

const numberList = value => (Array.isArray(value) ? value.map(toNumber).filter(item => item !== null) : []);

/** Props 参数的第一项：总音量、静音、各声道音量，以及 PipeWire 在软件里乘上去的那部分。没有 Props 时为 null。 */
const readVolume = node => {
    const props = firstParam(node, 'Props');
    if (!props) return null;
    return {
        volume: toNumber(props.volume),
        mute: props.mute === true,
        channelVolumes: numberList(props.channelVolumes),
        softVolumes: Array.isArray(props.softVolumes) ? numberList(props.softVolumes) : null,
        softMute: typeof props.softMute === 'boolean' ? props.softMute : null,
    };
};

/** 设备用的音频接口：device.api，其次 factory.name（api.alsa.pcm.sink → alsa），再其次 api.* 属性。 */
const readApi = props => {
    const declared = textOrNull(props['device.api']);
    if (declared) return declared;
    const factory = typeof props['factory.name'] === 'string' ? API_PATTERN.exec(props['factory.name']) : null;
    if (factory) return factory[1];
    if ('api.alsa.path' in props) return 'alsa';
    for (const key of Object.keys(props)) {
        const match = API_PATTERN.exec(key);
        if (match) return match[1];
    }
    return null;
};

const hasApiProp = props => Object.keys(props).some(key => API_PATTERN.test(key));

/** factory.name 是 api.* 的（api.alsa.pcm.sink、api.bluez5.a2dp.sink）：这个节点开着一个硬件接口。 */
const hasApiFactory = props => typeof props['factory.name'] === 'string' && API_PATTERN.test(props['factory.name']);

/**
 * 一个被连到的节点是什么：
 * - 'device'：声卡的输出节点：带 device.id，或带 api.* 属性、factory.name 是 api.*；
 * - 'filter'：滤波链、remap、loopback 的虚拟 sink：没有 device.id，有 node.link-group，同组里有接着往下走的输出那一半；
 * - 'virtual'：别的 sink，如 EasyEffects 的 easyeffects_sink（factory.name 为 support.null-audio-sink 的空 sink）：
 *   声音由另一个程序从它的 monitor 取走再放出去，PipeWire 的连接看不出最后到了哪块声卡；
 * - null：不是 sink（录音程序之类），不在去设备的路上。
 * node.driver 不算硬件的凭据：空 sink 自己也当驱动。
 */
const classifySink = node => {
    const props = propsOf(node);
    if (!SINK_CLASSES.has(props['media.class'])) return null;
    if (props['device.id'] !== undefined && props['device.id'] !== null) return 'device';
    if (textOrNull(props['node.link-group'])) return 'filter';
    if (hasApiProp(props) || hasApiFactory(props)) return 'device';
    return 'virtual';
};

const linkEnds = link => {
    const info = isPlainObject(link?.info) ? link.info : {};
    const props = isPlainObject(info.props) ? info.props : {};
    return {
        from: toInteger(info['output-node-id'] ?? props['link.output.node']),
        to: toInteger(info['input-node-id'] ?? props['link.input.node']),
        state: textOrNull(info.state),
    };
};

/** 把 pw-dump 的对象表按节点、客户端、连接、link-group 编好索引。 */
const indexDump = dump => {
    const nodes = new Map();
    const clients = new Map();
    const targets = new Map();
    const groupOutputs = new Map();
    let settings = null;
    for (const object of Array.isArray(dump) ? dump : []) {
        if (!isPlainObject(object)) continue;
        const id = toInteger(object.id);
        if (object.type === NODE_TYPE && id !== null) nodes.set(id, object);
        else if (object.type === CLIENT_TYPE && id !== null) clients.set(id, object);
        else if (object.type === METADATA_TYPE && settings === null && object.props?.['metadata.name'] === 'settings') settings = object;
    }
    for (const object of Array.isArray(dump) ? dump : []) {
        if (!isPlainObject(object) || object.type !== LINK_TYPE) continue;
        const { from, to, state } = linkEnds(object);
        if (from === null || to === null || DEAD_LINK_STATES.has(state)) continue;
        if (!targets.has(from)) targets.set(from, new Set());
        // 每个声道一条连接：同一对节点之间的几条只算一次。
        targets.get(from).add(to);
    }
    for (const [id, node] of nodes) {
        const props = propsOf(node);
        const group = textOrNull(props['node.link-group']);
        if (!group || props['media.class'] !== STREAM_OUTPUT_CLASS) continue;
        if (!groupOutputs.has(group)) groupOutputs.set(group, []);
        groupOutputs.get(group).push(id);
    }
    for (const ids of groupOutputs.values()) ids.sort((a, b) => a - b);
    return { nodes, clients, targets, groupOutputs, settings };
};

const targetNodesOf = (index, nodeId) => [...(index.targets.get(nodeId) ?? [])]
    .sort((a, b) => a - b)
    .map(id => index.nodes.get(id))
    .filter(Boolean);

/**
 * 从一个输出流顺着连接走到设备：连到滤波链的 sink 时记下它，跳到同一 link-group 的输出那一半接着走；连到设备节点为止。
 * 连到没有 link-group 的虚拟 sink（EasyEffects 这类）时也记进 filters，走到那里为止：之后去了哪块声卡看不出来。
 * 走不到设备（没连上、连到别处、进了虚拟 sink、成环、超过 MAX_HOPS）时 device 为 null。
 */
const walkToDevice = (index, startId) => {
    const filters = [];
    const visited = new Set([startId]);
    let current = startId;
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
        const targets = targetNodesOf(index, current);
        const device = targets.find(node => classifySink(node) === 'device');
        if (device) return { filters, device };
        const filter = targets.find(node => classifySink(node) === 'filter' && !visited.has(toInteger(node.id)));
        if (!filter) {
            const virtualSink = targets.find(node => classifySink(node) === 'virtual' && !visited.has(toInteger(node.id)));
            if (virtualSink) filters.push(virtualSink);
            return { filters, device: null };
        }
        const filterId = toInteger(filter.id);
        visited.add(filterId);
        filters.push(filter);
        const group = textOrNull(propsOf(filter)['node.link-group']);
        const output = (index.groupOutputs.get(group) ?? []).find(id => !visited.has(id));
        if (output === undefined) return { filters, device: null };
        visited.add(output);
        current = output;
    }
    return { filters, device: null };
};

const nodeName = (node, id) => textOrNull(propsOf(node)['node.name']) ?? `#${id}`;

/** 流的进程号：节点自己带的 application.process.id，没有时看它的客户端（mpv 直连 PipeWire 时只在客户端上）。 */
const processIdOf = (index, node) => {
    const props = propsOf(node);
    const fromNode = toInteger(props['application.process.id']);
    if (fromNode !== null) return fromNode;
    const clientId = toInteger(props['client.id']);
    const client = clientId === null ? null : index.clients.get(clientId);
    return client ? toInteger(propsOf(client)['application.process.id']) : null;
};

const streamLabel = node => {
    const props = propsOf(node);
    return textOrNull(props['application.name'])
        ?? textOrNull(props['node.description'])
        ?? textOrNull(props['node.name'])
        ?? textOrNull(props['media.name'])
        ?? `#${toInteger(node.id)}`;
};

/** mpv 的那路流：node.name 或 application.name 等于 streamName 的输出流，正在放的优先，同样时取新建的（id 大的）。 */
const findStream = (index, streamName) => {
    const candidates = [];
    for (const [id, node] of index.nodes) {
        const props = propsOf(node);
        if (props['media.class'] !== STREAM_OUTPUT_CLASS) continue;
        if (props['node.name'] !== streamName && props['application.name'] !== streamName) continue;
        candidates.push({ id, node, running: stateOf(node) === 'running' });
    }
    candidates.sort((a, b) => (a.running === b.running ? b.id - a.id : a.running ? -1 : 1));
    return candidates[0] ?? null;
};

/** metadata「settings」里的时钟设置；clock.force-rate 为 0 表示没强制。 */
const readGraph = settings => {
    const entries = Array.isArray(settings?.metadata) ? settings.metadata : [];
    const valueOf = key => {
        const entry = entries.find(item => isPlainObject(item) && item.key === key && (item.subject === undefined || toInteger(item.subject) === 0));
        return entry ? entry.value : undefined;
    };
    return {
        clockRate: toRate(valueOf('clock.rate')),
        allowedRates: parseRateList(valueOf('clock.allowed-rates')),
        forceRate: toRate(valueOf('clock.force-rate')),
    };
};

/**
 * pw-dump 的输出 → HifiOutputProbe；找不到名为 streamName 的输出流时为 null。纯函数：ownPids 是 Folia 自己的进程号，
 * now 是读到这份 pw-dump 的时刻。
 */
const buildOutputProbe = (dump, { streamName = AUDIO_CLIENT_NAME, ownPids = [], now = Date.now() } = {}) => {
    const index = indexDump(dump);
    const stream = findStream(index, streamName);
    if (!stream) return null;
    const { filters, device } = walkToDevice(index, stream.id);
    const deviceId = device ? toInteger(device.id) : null;
    const deviceProps = device ? propsOf(device) : {};

    // 滤波链的输出那一半是链路的中段，不是别的程序的流。
    const filterGroups = new Set();
    for (const node of index.nodes.values()) {
        if (classifySink(node) === 'filter') filterGroups.add(propsOf(node)['node.link-group']);
    }
    const pids = new Set((Array.isArray(ownPids) ? ownPids : []).map(toInteger).filter(pid => pid !== null));
    const otherStreams = [];
    if (deviceId !== null) {
        for (const [id, node] of [...index.nodes].sort((a, b) => a[0] - b[0])) {
            const props = propsOf(node);
            if (id === stream.id || props['media.class'] !== STREAM_OUTPUT_CLASS || stateOf(node) !== 'running') continue;
            if (filterGroups.has(props['node.link-group'])) continue;
            const reached = walkToDevice(index, id).device;
            if (!reached || toInteger(reached.id) !== deviceId) continue;
            const pid = processIdOf(index, node);
            otherStreams.push({ nodeId: id, name: streamLabel(node), own: pid !== null && pids.has(pid) });
        }
    }

    return {
        backend: 'pipewire',
        at: now,
        stream: {
            nodeId: stream.id,
            state: stateOf(stream.node),
            format: readFormat(stream.node),
            volume: readVolume(stream.node),
        },
        filters: filters.map(node => {
            const id = toInteger(node.id);
            return { nodeId: id, name: nodeName(node, id), description: textOrNull(propsOf(node)['node.description']) };
        }),
        device: device
            ? {
                nodeId: deviceId,
                name: nodeName(device, deviceId),
                description: textOrNull(deviceProps['node.description']),
                api: readApi(deviceProps),
                path: textOrNull(deviceProps['api.alsa.path']),
                state: stateOf(device),
                format: readFormat(device),
                volume: readVolume(device),
            }
            : null,
        graph: readGraph(index.settings),
        otherStreams,
    };
};

/** Folia 自己的进程号：主进程加上 app.getAppMetrics() 列出的（渲染、GPU、Web 引擎出声的音频服务进程）。 */
const collectOwnPids = (mainPid, appMetrics) => {
    const pids = new Set();
    const add = value => {
        const pid = toInteger(value);
        if (pid !== null && pid > 0) pids.add(pid);
    };
    add(mainPid);
    for (const metric of Array.isArray(appMetrics) ? appMetrics : []) add(metric?.pid);
    return [...pids];
};

// pw-dump 的失败按种类记一次：没装、超时、输出太大、不是 JSON、别的（PipeWire 没在跑时它非零退出）。
const failureKindOf = error => {
    if (error?.code === 'ENOENT') return 'missing';
    if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'too-large';
    if (error?.killed === true || error?.code === 'ETIMEDOUT') return 'timeout';
    return 'failed';
};

/** 一行摘要，只在变了的时候记日志：同一首歌放着时轮询不会刷屏。 */
const summarize = (probe, streamName) => {
    if (!probe) return `no PipeWire stream named ${JSON.stringify(streamName)}`;
    const filters = probe.filters.map(filter => filter.name).join(', ');
    const device = probe.device ? `${probe.device.name} ${probe.device.format.rate ?? '?'} Hz` : 'no device';
    const others = probe.otherStreams.map(item => `${item.name}${item.own ? ' (own)' : ''}`).join(', ');
    return `stream ${probe.stream.format.rate ?? '?'} Hz -> ${filters ? `filters [${filters}] -> ` : ''}${device}`
        + `; clock.allowed-rates [${probe.graph.allowedRates.join(' ')}]${others ? `; also on the device: ${others}` : ''}`;
};

/**
 * pw-dump 的读取器。不是 Linux 时 probe() 直接为 null，不起进程；pw-dump 没装、超时、输出不是 JSON 时为 null，
 * 每种失败只记一次。同时到的几次调用共用一次 pw-dump，结果缓存 cacheMs。
 */
const createPipewireProbe = ({
    platform = process.platform,
    execFileFn = execFile,
    getOwnPids = () => [],
    now = () => Date.now(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
    cacheMs = DEFAULT_CACHE_MS,
    logInfo = (...args) => console.info(...args),
    logWarn = (...args) => console.warn(...args),
} = {}) => {
    /** 记过的 pw-dump 失败种类：读成功一次就清掉，好了之后再坏要再记一次。 */
    const dumpWarned = new Set();
    /** 记过的别的失败（列不出自家进程、解析时抛错）：只记一次。 */
    const otherWarned = new Set();
    /** { at, dump }：dump 为 null 表示那次失败了，同样缓存，免得 pw-dump 不在时每次轮询都起一个进程。 */
    let cached = null;
    let reading = null;
    let lastSummary = null;

    const warnOnce = (warned, kind, ...args) => {
        if (warned.has(kind)) return;
        warned.add(kind);
        logWarn(...args);
    };

    const runPwDump = () => new Promise(resolve => {
        const fail = (kind, ...args) => {
            warnOnce(dumpWarned, kind, ...args);
            resolve(null);
        };
        try {
            execFileFn('pw-dump', [], {
                timeout: timeoutMs,
                maxBuffer: maxBufferBytes,
                encoding: 'utf8',
                windowsHide: true,
            }, (error, stdout) => {
                if (error) {
                    const kind = failureKindOf(error);
                    if (kind === 'missing') fail(kind, '[HiFi] pw-dump is not installed, so the PipeWire part of the signal path is not shown', error);
                    else if (kind === 'timeout') fail(kind, `[HiFi] pw-dump did not finish within ${timeoutMs} ms`, error);
                    else if (kind === 'too-large') fail(kind, `[HiFi] pw-dump printed more than ${maxBufferBytes} bytes`, error);
                    else fail(kind, '[HiFi] pw-dump failed', error);
                    return;
                }
                let dump;
                try {
                    dump = JSON.parse(String(stdout));
                } catch (parseError) {
                    fail('json', '[HiFi] pw-dump printed something that is not JSON', parseError);
                    return;
                }
                if (!Array.isArray(dump)) {
                    fail('json', '[HiFi] pw-dump printed JSON that is not an object list');
                    return;
                }
                dumpWarned.clear();
                resolve(dump);
            });
        } catch (error) {
            fail('spawn', '[HiFi] could not start pw-dump', error);
        }
    });

    const readDump = () => {
        const at = now();
        if (cached && at - cached.at < cacheMs) return Promise.resolve(cached);
        if (reading) return reading;
        reading = runPwDump().then(dump => {
            cached = { at: now(), dump };
            reading = null;
            return cached;
        });
        return reading;
    };

    const readOwnPids = () => {
        try {
            return getOwnPids();
        } catch (error) {
            warnOnce(otherWarned, 'pids', '[HiFi] could not list Folia\'s own processes', error);
            return [];
        }
    };

    /** mpv 那路流在 PipeWire 里的去向；拿不到时为 null。 */
    const probe = async ({ streamName = AUDIO_CLIENT_NAME } = {}) => {
        if (platform !== 'linux') return null;
        const { at, dump } = await readDump();
        if (!dump) return null;
        let result;
        try {
            result = buildOutputProbe(dump, { streamName, ownPids: readOwnPids(), now: at });
        } catch (error) {
            warnOnce(otherWarned, 'parse', '[HiFi] could not read the pw-dump output', error);
            return null;
        }
        const summary = summarize(result, streamName);
        if (summary !== lastSummary) {
            lastSummary = summary;
            logInfo(`[HiFi] PipeWire reports: ${summary}`);
        }
        return result;
    };

    return { probe };
};

module.exports = {
    DEFAULT_TIMEOUT_MS,
    DEFAULT_MAX_BUFFER_BYTES,
    DEFAULT_CACHE_MS,
    MAX_HOPS,
    buildOutputProbe,
    parseRateList,
    collectOwnPids,
    createPipewireProbe,
};
