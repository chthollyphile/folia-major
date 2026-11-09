import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HifiOutputProbe } from '../../../src/types/hifi';

// 钉住 pw-dump 的解读：找 mpv 那路流、顺着连接穿过滤波链走到设备、读格式和音量、时钟设置、同一设备上别的流；
// 以及读取器：只在 Linux 上起 pw-dump、不走 shell、每种失败只记一次、同时到的调用共用一次、结果缓存。
// fixtures/pipewireDump.json 是一台真机的 pw-dump（mpv 放 96 kHz 静音文件，经 eq6 和 remap 两个滤波链到内置扬声器），
// 只留了测试用到的对象和属性。EasyEffects 那种没有 link-group 的虚拟 sink 是按它常见的属性手造的（没在装着 EasyEffects 的
// 机器上取过 pw-dump）。这些只是 PipeWire 报的状态，DAC 实际收到什么要人在实机上确认，这里测不到。

type PwObject = Record<string, unknown> & { id: number; type: string };
type ExecCallback = (error: (Error & Record<string, unknown>) | null, stdout: string, stderr: string) => void;
type ExecFn = (file: string, args: string[], options: Record<string, unknown>, callback: ExecCallback) => void;

const require = createRequire(import.meta.url);
const {
    buildOutputProbe,
    parseRateList,
    collectOwnPids,
    createPipewireProbe,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_MAX_BUFFER_BYTES,
    DEFAULT_CACHE_MS,
    MAX_HOPS,
} = require('../../../electron/hifi/pipewireProbe.cjs') as {
    buildOutputProbe: (dump: unknown, options?: { streamName?: string; ownPids?: unknown; now?: number }) => HifiOutputProbe | null;
    parseRateList: (value: unknown) => number[];
    collectOwnPids: (mainPid: unknown, appMetrics: unknown) => number[];
    createPipewireProbe: (options: Record<string, unknown>) => { probe: (options?: { streamName?: string }) => Promise<HifiOutputProbe | null> };
    DEFAULT_TIMEOUT_MS: number;
    DEFAULT_MAX_BUFFER_BYTES: number;
    DEFAULT_CACHE_MS: number;
    MAX_HOPS: number;
};

const fixturePath = path.join(__dirname, 'fixtures/pipewireDump.json');
const fixtureText = readFileSync(fixturePath, 'utf8');
const loadDump = (): PwObject[] => JSON.parse(fixtureText) as PwObject[];

const DEVICE_NAME = 'alsa_output.pci-0000_00_1f.3-platform-skl_hda_dsp_generic.HiFi__Speaker__sink';
const MPV_PID = 879130;

// 下面几个造对象的函数照 pw-dump 的形状写，只填解读会看的字段。
let nextId = 500;
const node = (props: Record<string, unknown>, {
    state = 'running',
    format,
    volume,
    id = nextId++,
}: { state?: string; format?: Record<string, unknown> | null; volume?: Record<string, unknown> | null; id?: number } = {}): PwObject => ({
    id,
    type: 'PipeWire:Interface:Node',
    info: {
        state,
        props: { 'object.id': id, ...props },
        params: {
            ...(format === null ? {} : { Format: [format ?? { mediaType: 'audio', mediaSubtype: 'raw', format: 'F32LE', rate: 48000, channels: 2 }] }),
            ...(volume === null ? {} : { Props: [volume ?? { volume: 1, mute: false, channelVolumes: [1, 1], softMute: false, softVolumes: [1, 1] }] }),
        },
    },
});

const link = (from: number, to: number, state = 'active', id = nextId++): PwObject => ({
    id,
    type: 'PipeWire:Interface:Link',
    info: { 'output-node-id': from, 'output-port-id': 1, 'input-node-id': to, 'input-port-id': 2, state },
});

const client = (pid: number, id = nextId++): PwObject => ({
    id,
    type: 'PipeWire:Interface:Client',
    info: { props: { 'application.process.id': pid } },
});

const streamNode = (props: Record<string, unknown>, options: Parameters<typeof node>[1] = {}) => node({ 'media.class': 'Stream/Output/Audio', ...props }, options);

/** 把 dump 里某个节点的 info 换掉一部分。 */
const patchNode = (dump: PwObject[], id: number, patch: (info: Record<string, any>) => void) => {
    const target = dump.find(object => object.id === id && object.type === 'PipeWire:Interface:Node');
    if (!target) throw new Error(`no node ${id}`);
    patch(target.info as Record<string, any>);
    return dump;
};

const withoutLinksFrom = (dump: PwObject[], from: number) => dump.filter(object => !(
    object.type === 'PipeWire:Interface:Link' && (object.info as Record<string, unknown>)['output-node-id'] === from
));

describe('buildOutputProbe on a real pw-dump', () => {
    it('follows mpv\'s 96 kHz stream through the eq6 and remap filter chains to the 48 kHz speaker, as PipeWire reports it', () => {
        expect(buildOutputProbe(loadDump(), { streamName: 'Folia HiFi', ownPids: [1], now: 1234 })).toEqual({
            backend: 'pipewire',
            at: 1234,
            stream: {
                nodeId: 126,
                state: 'running',
                format: { format: 'S32LE', rate: 96000, channels: 2 },
                volume: { volume: 1, mute: false, channelVolumes: [1, 1], softVolumes: [1, 1], softMute: false },
            },
            filters: [
                { nodeId: 38, name: 'effect_input.eq6', description: 'Equalizer Sink' },
                { nodeId: 40, name: 'remap_input.remap-FL-FR-to-FR-FL', description: 'remap-FL-FR-to-FR-FL' },
            ],
            device: {
                nodeId: 70,
                name: DEVICE_NAME,
                description: 'Alder Lake PCH-P High Definition Audio Controller Speaker',
                api: 'alsa',
                path: 'hw:sofhdadsp',
                state: 'running',
                format: { format: 'S32LE', rate: 48000, channels: 2 },
                volume: { volume: 1, mute: false, channelVolumes: [0.026997, 0.026997], softVolumes: [0.930755, 0.930755], softMute: false },
            },
            graph: { clockRate: 48000, allowedRates: [48000], forceRate: null },
            // 滤波链的输出那一半（39、41）也是正在放的输出流，但它们是链路的中段，不算别的流。
            otherStreams: [],
        } satisfies HifiOutputProbe);
    });

    it('counts a node reached over several port links once (one link per channel)', () => {
        const dump = loadDump();
        const linksFromStream = dump.filter(object => object.type === 'PipeWire:Interface:Link'
            && (object.info as Record<string, unknown>)['output-node-id'] === 126);
        expect(linksFromStream).toHaveLength(2);
        expect(buildOutputProbe(dump)?.filters.map(filter => filter.nodeId)).toEqual([38, 40]);
    });

    it('defaults to the stream name mpv is started with and to Date.now()', () => {
        const before = Date.now();
        const probe = buildOutputProbe(loadDump());
        expect(probe?.stream.nodeId).toBe(126);
        expect(probe?.at).toBeGreaterThanOrEqual(before);
    });

    it('is null when PipeWire has no stream by that name, or the dump is not an object list', () => {
        expect(buildOutputProbe(loadDump(), { streamName: 'Other Player' })).toBeNull();
        expect(buildOutputProbe(loadDump().filter(object => object.id !== 126))).toBeNull();
        for (const dump of [null, undefined, {}, 'pw-dump', [null, 3, 'x']]) expect(buildOutputProbe(dump)).toBeNull();
    });

    it('only an output stream counts as mpv\'s, not a sink or capture node of the same name', () => {
        const dump = [
            node({ 'media.class': 'Audio/Sink', 'node.name': 'Folia HiFi', 'device.id': 1 }),
            node({ 'media.class': 'Stream/Input/Audio', 'node.name': 'Folia HiFi' }),
        ];
        expect(buildOutputProbe(dump)).toBeNull();
    });
});

describe('buildOutputProbe: finding mpv\'s stream', () => {
    const device = () => node({ 'media.class': 'Audio/Sink', 'node.name': 'dac', 'device.id': 9, 'device.api': 'alsa' }, { id: 10 });

    it('matches application.name too (mpv\'s PulseAudio output names the client, not the node)', () => {
        const stream = streamNode({ 'node.name': 'mpv', 'application.name': 'Folia HiFi' }, { id: 20 });
        expect(buildOutputProbe([device(), stream, link(20, 10)])?.stream.nodeId).toBe(20);
    });

    it('prefers the running stream, then the newest one', () => {
        const idle = streamNode({ 'node.name': 'Folia HiFi' }, { id: 30, state: 'idle' });
        const running = streamNode({ 'node.name': 'Folia HiFi' }, { id: 21 });
        const older = streamNode({ 'node.name': 'Folia HiFi' }, { id: 20 });
        expect(buildOutputProbe([device(), idle, running, older])?.stream).toMatchObject({ nodeId: 21, state: 'running' });
        const paused = streamNode({ 'node.name': 'Folia HiFi' }, { id: 31, state: 'idle' });
        expect(buildOutputProbe([device(), idle, paused])?.stream).toMatchObject({ nodeId: 31, state: 'idle' });
    });

    it('a stream PipeWire has not linked anywhere yet has no filters and no device', () => {
        const probe = buildOutputProbe([device(), streamNode({ 'node.name': 'Folia HiFi' }, { id: 20 })]);
        expect(probe).toMatchObject({ filters: [], device: null, otherStreams: [] });
    });
});

describe('buildOutputProbe: walking to the device', () => {
    it('a stream linked straight to the device has no filters', () => {
        const dump = withoutLinksFrom(loadDump(), 126).concat([link(126, 70), link(126, 70)]);
        const probe = buildOutputProbe(dump);
        expect(probe?.filters).toEqual([]);
        expect(probe?.device).toMatchObject({ nodeId: 70, format: { rate: 48000 } });
    });

    it('ignores links in the error or unlinked state', () => {
        for (const state of ['error', 'unlinked']) {
            const dump = withoutLinksFrom(loadDump(), 126).concat([link(126, 70, state)]);
            expect(buildOutputProbe(dump)?.device, state).toBeNull();
        }
        // 暂停时的连接还在：paused 照走。
        const paused = withoutLinksFrom(loadDump(), 126).concat([link(126, 70, 'paused')]);
        expect(buildOutputProbe(paused)?.device?.nodeId).toBe(70);
    });

    it('skips targets that are not on the way to a device (a recorder tapping the stream)', () => {
        const recorder = node({ 'media.class': 'Stream/Input/Audio', 'node.name': 'recorder' }, { id: 300 });
        const dump = loadDump().concat([recorder, link(126, 300)]);
        expect(buildOutputProbe(dump)?.device?.nodeId).toBe(70);
        const onlyRecorder = withoutLinksFrom(loadDump(), 126).concat([recorder, link(126, 300)]);
        expect(buildOutputProbe(onlyRecorder)).toMatchObject({ filters: [], device: null });
    });

    it('a device among the targets wins over a filter', () => {
        const dump = withoutLinksFrom(loadDump(), 126).concat([link(126, 38), link(126, 70)]);
        expect(buildOutputProbe(dump)).toMatchObject({ filters: [], device: { nodeId: 70 } });
    });

    it('a virtual sink with no output half ends the walk with the filter recorded and no device', () => {
        const dump = loadDump().filter(object => object.id !== 39);
        expect(buildOutputProbe(dump)).toMatchObject({ filters: [{ nodeId: 38 }], device: null });
    });

    it('a sink without device.id, link-group or api.* is a virtual device: recorded as the last filter, no device, even with node.driver', () => {
        const stream = streamNode({ 'node.name': 'Folia HiFi' }, { id: 20 });
        const loose = node({ 'media.class': 'Audio/Sink', 'node.name': 'loose', 'node.virtual': true }, { id: 40 });
        expect(buildOutputProbe([stream, loose, link(20, 40)])).toMatchObject({
            filters: [{ nodeId: 40, name: 'loose', description: null }],
            device: null,
        });
        // 空 sink 自己也当驱动：node.driver 不说明它是声卡。
        const nullSink = node({ 'media.class': 'Audio/Sink', 'node.name': 'null-sink', 'node.driver': true, 'factory.name': 'support.null-audio-sink' }, { id: 41 });
        expect(buildOutputProbe([stream, nullSink, link(20, 41)])).toMatchObject({
            filters: [{ nodeId: 41, name: 'null-sink', description: null }],
            device: null,
        });
        // 声卡和虚拟设备都连着时算声卡。
        const card = node({ 'media.class': 'Audio/Sink', 'node.name': 'card', 'device.id': 3 }, { id: 42 });
        expect(buildOutputProbe([stream, nullSink, card, link(20, 41), link(20, 42)])).toMatchObject({ filters: [], device: { nodeId: 42 } });
    });

    it('a sink whose factory.name is api.* is a device without device.id', () => {
        const stream = streamNode({ 'node.name': 'Folia HiFi' }, { id: 20 });
        const sink = node({ 'media.class': 'Audio/Sink', 'node.name': 'manual-alsa', 'factory.name': 'api.alsa.pcm.sink' }, { id: 21 });
        expect(buildOutputProbe([stream, sink, link(20, 21)])).toMatchObject({ filters: [], device: { nodeId: 21, api: 'alsa' } });
    });

    // 按 EasyEffects 常见的属性手造（没有在装着 EasyEffects 的机器上取过 pw-dump）：mpv 的流连进 easyeffects_sink
    // （support.null-audio-sink，没有 device.id、node.link-group），EasyEffects 从它的 monitor 录、处理完再用自己的输出流放到扬声器。
    const withEasyEffects = () => withoutLinksFrom(loadDump(), 126).concat([
        node({
            'media.class': 'Audio/Sink',
            'factory.name': 'support.null-audio-sink',
            'node.name': 'easyeffects_sink',
            'node.description': 'Easy Effects Sink',
            'node.virtual': true,
            'node.driver': true,
            'audio.position': 'FL,FR',
            'monitor.channel-volumes': true,
        }, { id: 300 }),
        node({ 'media.class': 'Stream/Input/Audio', 'node.name': 'ee_sie_input_level', 'application.name': 'easyeffects', 'application.id': 'com.github.wwmm.easyeffects' }, { id: 301 }),
        streamNode({ 'node.name': 'ee_soe_output_level', 'application.name': 'easyeffects', 'application.id': 'com.github.wwmm.easyeffects' }, { id: 302 }),
        link(126, 300), link(126, 300),
        link(300, 301), link(300, 301),
        link(302, 70), link(302, 70),
    ]);

    it('a stream into EasyEffects ends at its virtual sink: the sink is the filter, the speaker behind EasyEffects is not claimed', () => {
        const probe = buildOutputProbe(withEasyEffects(), { now: 1 });
        expect(probe).toMatchObject({
            stream: { nodeId: 126, format: { rate: 96000 } },
            filters: [{ nodeId: 300, name: 'easyeffects_sink', description: 'Easy Effects Sink' }],
            device: null,
            otherStreams: [],
        });
    });

    it('stops on a loop and after MAX_HOPS filters', () => {
        // 环：remap 的输出那一半连回 eq6 的输入。
        const looped = withoutLinksFrom(loadDump(), 41).concat([link(41, 38)]);
        expect(buildOutputProbe(looped)).toMatchObject({ filters: [{ nodeId: 38 }, { nodeId: 40 }], device: null });

        const chain = (length: number) => {
            const objects: PwObject[] = [streamNode({ 'node.name': 'Folia HiFi' }, { id: 1000 })];
            let previous = 1000;
            for (let index = 0; index < length; index += 1) {
                const input = 1001 + index * 2;
                const group = `filter-chain-${index}`;
                objects.push(node({ 'media.class': 'Audio/Sink', 'node.name': `in.${index}`, 'node.link-group': group }, { id: input }));
                objects.push(streamNode({ 'node.name': `out.${index}`, 'node.link-group': group }, { id: input + 1 }));
                objects.push(link(previous, input));
                previous = input + 1;
            }
            objects.push(node({ 'media.class': 'Audio/Sink', 'node.name': 'dac', 'device.id': 7 }, { id: 2000 }), link(previous, 2000));
            return objects;
        };
        expect(buildOutputProbe(chain(MAX_HOPS - 1))?.device?.nodeId).toBe(2000);
        expect(buildOutputProbe(chain(MAX_HOPS - 1))?.filters).toHaveLength(MAX_HOPS - 1);
        expect(buildOutputProbe(chain(MAX_HOPS))?.device).toBeNull();
    });
});

describe('buildOutputProbe: what each node reports', () => {
    it('a device format without a rate is null rather than guessed, and a node without Format or Props reports nulls', () => {
        const noRate = patchNode(loadDump(), 70, info => {
            info.params.Format = [{ mediaType: 'audio', mediaSubtype: 'raw', format: 'S24_32LE', channels: 2 }];
        });
        expect(buildOutputProbe(noRate)?.device?.format).toEqual({ format: 'S24_32LE', rate: null, channels: 2 });
        const bare = patchNode(loadDump(), 70, info => {
            info.params = {};
        });
        expect(buildOutputProbe(bare)?.device).toMatchObject({ format: { format: null, rate: null, channels: null }, volume: null });
        const noParams = patchNode(loadDump(), 126, info => {
            delete info.params;
        });
        expect(buildOutputProbe(noParams)?.stream).toEqual({ nodeId: 126, state: 'running', format: { format: null, rate: null, channels: null }, volume: null });
    });

    it('reads mute and the software part of the volume, and leaves out what PipeWire did not report', () => {
        const muted = patchNode(loadDump(), 126, info => {
            info.params.Props = [{ volume: 0.5, mute: true, channelVolumes: [0.5, 'x', 0.4], softMute: true, softVolumes: [0.5, 0.4] }];
        });
        expect(buildOutputProbe(muted)?.stream.volume).toEqual({ volume: 0.5, mute: true, channelVolumes: [0.5, 0.4], softVolumes: [0.5, 0.4], softMute: true });
        const partial = patchNode(loadDump(), 126, info => {
            info.params.Props = [{ channelVolumes: [1, 1] }];
        });
        expect(buildOutputProbe(partial)?.stream.volume).toEqual({ volume: null, mute: false, channelVolumes: [1, 1], softVolumes: null, softMute: null });
    });

    it('names the device api from device.api, then factory.name, then api.* properties', () => {
        const apiOf = (props: Record<string, unknown>) => {
            const dump = patchNode(loadDump(), 70, info => {
                info.props = { 'media.class': 'Audio/Sink', 'node.name': 'dac', 'device.id': 56, ...props };
            });
            return buildOutputProbe(dump)?.device;
        };
        expect(apiOf({ 'device.api': 'bluez5', 'factory.name': 'api.alsa.pcm.sink' })?.api).toBe('bluez5');
        expect(apiOf({ 'factory.name': 'api.bluez5.a2dp.sink' })?.api).toBe('bluez5');
        expect(apiOf({ 'api.alsa.path': 'hw:D10' })).toMatchObject({ api: 'alsa', path: 'hw:D10' });
        expect(apiOf({ 'api.bluez5.address': '00:11:22:33:44:55' })).toMatchObject({ api: 'bluez5', path: null });
        expect(apiOf({})).toMatchObject({ api: null, path: null, description: null });
    });

    it('a sink with api.* properties but no device.id still counts as the device', () => {
        const stream = streamNode({ 'node.name': 'Folia HiFi' }, { id: 20 });
        const sink = node({ 'media.class': 'Audio/Sink', 'node.name': 'jack-ish', 'api.jack.client': 'x' }, { id: 21 });
        expect(buildOutputProbe([stream, sink, link(20, 21)])?.device).toMatchObject({ nodeId: 21, api: 'jack' });
        // PipeWire 也有标成 Audio/Duplex 的设备节点（同一个节点既收又发），一样算设备；声卡的输入节点不算。
        const duplex = node({ 'media.class': 'Audio/Duplex', 'node.name': 'pro', 'device.id': 3 }, { id: 22 });
        expect(buildOutputProbe([stream, duplex, link(20, 22)])?.device).toMatchObject({ nodeId: 22 });
        const source = node({ 'media.class': 'Audio/Source', 'node.name': 'mic', 'device.id': 3 }, { id: 23 });
        expect(buildOutputProbe([stream, source, link(20, 23)])?.device).toBeNull();
    });
});

describe('buildOutputProbe: the clock settings', () => {
    const withSettings = (metadata: unknown) => loadDump()
        .filter(object => !(object.type === 'PipeWire:Interface:Metadata' && (object.props as Record<string, unknown>)['metadata.name'] === 'settings'))
        .concat(metadata === undefined ? [] : [{ id: 900, type: 'PipeWire:Interface:Metadata', props: { 'metadata.name': 'settings' }, metadata }]);

    it('reads clock.rate, the allowed rates and a forced rate; 0 means not forced', () => {
        const graph = buildOutputProbe(withSettings([
            { subject: 0, key: 'clock.rate', type: '', value: '44100' },
            { subject: 0, key: 'clock.allowed-rates', type: '', value: '[ 44100 48000 88200 96000 192000 ]' },
            { subject: 0, key: 'clock.force-rate', type: '', value: 96000 },
        ]))?.graph;
        expect(graph).toEqual({ clockRate: 44100, allowedRates: [44100, 48000, 88200, 96000, 192000], forceRate: 96000 });
        expect(buildOutputProbe(withSettings([{ subject: 0, key: 'clock.force-rate', value: 0 }]))?.graph.forceRate).toBeNull();
    });

    it('ignores entries for other subjects and other metadata objects; no settings means nothing known', () => {
        expect(buildOutputProbe(withSettings([{ subject: 70, key: 'clock.rate', value: 96000 }]))?.graph.clockRate).toBeNull();
        expect(buildOutputProbe(withSettings(undefined))?.graph).toEqual({ clockRate: null, allowedRates: [], forceRate: null });
        expect(buildOutputProbe(withSettings('broken'))?.graph).toEqual({ clockRate: null, allowedRates: [], forceRate: null });
    });

    it('parseRateList takes the string form, arrays and a single number', () => {
        expect(parseRateList('[ 44100 48000 ]')).toEqual([44100, 48000]);
        expect(parseRateList('[ 48000 ]')).toEqual([48000]);
        expect(parseRateList('[]')).toEqual([]);
        expect(parseRateList([44100, '96000', 'x', -1, 0])).toEqual([44100, 96000]);
        expect(parseRateList(48000)).toEqual([48000]);
        for (const value of [null, undefined, {}, true, Number.NaN]) expect(parseRateList(value)).toEqual([]);
    });
});

describe('buildOutputProbe: other streams on the same device', () => {
    const OWN_AUDIO_PID = 4242;

    // Folia 自己的静音保活：Chromium 经 pipewire-pulse 出声，进程号写在节点上；跟 mpv 一样连进 eq6。
    const keepAlive = () => streamNode({ 'node.name': 'Folia', 'application.name': 'Folia', 'media.name': 'Playback', 'application.process.id': OWN_AUDIO_PID }, { id: 200 });
    // 别的程序直连 PipeWire：进程号只在客户端上。
    const otherApp = () => [client(777, 210), streamNode({ 'node.name': 'Firefox', 'application.name': 'Firefox', 'client.id': 210 }, { id: 211 })];

    it('lists running streams that reach the same device, through the same filters or not, and marks Folia\'s own', () => {
        const dump = loadDump().concat([
            keepAlive(), link(200, 38), link(200, 38),
            ...otherApp(), link(211, 70),
        ]);
        expect(buildOutputProbe(dump, { ownPids: [1, OWN_AUDIO_PID] })?.otherStreams).toEqual([
            { nodeId: 200, name: 'Folia', own: true },
            { nodeId: 211, name: 'Firefox', own: false },
        ]);
    });

    it('takes the process id from the client when the node has none', () => {
        const dump = loadDump().concat([...otherApp(), link(211, 70)]);
        expect(buildOutputProbe(dump, { ownPids: [777] })?.otherStreams).toEqual([{ nodeId: 211, name: 'Firefox', own: true }]);
        expect(buildOutputProbe(dump, { ownPids: 'nope' })?.otherStreams).toEqual([{ nodeId: 211, name: 'Firefox', own: false }]);
    });

    it('leaves out streams that are not running, go to another device, or are the output half of a filter chain', () => {
        const hdmi = 69;
        const dump = loadDump().concat([
            streamNode({ 'node.name': 'paused' }, { id: 220, state: 'idle' }), link(220, 70),
            streamNode({ 'node.name': 'hdmi' }, { id: 221 }), link(221, hdmi),
            streamNode({ 'node.name': 'nowhere' }, { id: 222 }),
        ]);
        expect(buildOutputProbe(dump)?.otherStreams).toEqual([]);
    });

    it('a loopback\'s playback half (its capture half is not a sink) is another stream on the device', () => {
        const dump = loadDump().concat([
            node({ 'media.class': 'Stream/Input/Audio', 'node.name': 'input.loopback', 'node.link-group': 'loopback-1' }, { id: 230 }),
            streamNode({ 'node.name': 'output.loopback', 'node.description': 'Mic monitor', 'node.link-group': 'loopback-1' }, { id: 231 }),
            link(231, 70),
        ]);
        expect(buildOutputProbe(dump)?.otherStreams).toEqual([{ nodeId: 231, name: 'Mic monitor', own: false }]);
    });

    it('names a stream by application.name, then node.description, node.name, media.name, then its id', () => {
        const names = [
            { 'application.name': 'App', 'node.description': 'Desc', 'node.name': 'node' },
            { 'node.description': 'Desc', 'node.name': 'node' },
            { 'node.name': 'node', 'media.name': 'media' },
            { 'media.name': 'media' },
            {},
        ].map((props, index) => {
            const id = 240 + index;
            return buildOutputProbe(loadDump().concat([streamNode(props, { id }), link(id, 70)]))?.otherStreams[0]?.name;
        });
        expect(names).toEqual(['App', 'Desc', 'node', 'media', '#244']);
    });

    it('no device reached means no other streams to compare with', () => {
        const dump = withoutLinksFrom(loadDump(), 126).concat([keepAlive(), link(200, 38)]);
        expect(buildOutputProbe(dump, { ownPids: [OWN_AUDIO_PID] })).toMatchObject({ device: null, otherStreams: [] });
    });
});

describe('collectOwnPids', () => {
    it('takes the main pid and every Electron process from app.getAppMetrics(), once each', () => {
        expect(collectOwnPids(100, [{ pid: 100, type: 'Browser' }, { pid: 101, type: 'Tab' }, { pid: 102, type: 'Utility' }, { pid: 101 }]))
            .toEqual([100, 101, 102]);
        expect(collectOwnPids(100, null)).toEqual([100]);
        expect(collectOwnPids(undefined, [{ pid: 0 }, { pid: -3 }, { pid: 'x' }, null, { pid: 5 }])).toEqual([5]);
    });
});

const createExec = () => {
    const calls: Array<{ file: string; args: string[]; options: Record<string, unknown>; callback: ExecCallback }> = [];
    const execFileFn = vi.fn<ExecFn>((file, args, options, callback) => {
        calls.push({ file, args, options, callback });
    });
    return {
        execFileFn,
        calls,
        succeed: (index: number, stdout: string = fixtureText) => calls[index].callback(null, stdout, ''),
        fail: (index: number, error: Error & Record<string, unknown>) => calls[index].callback(error, '', ''),
    };
};

const execError = (message: string, fields: Record<string, unknown>) => Object.assign(new Error(message), fields);

const createReader = (overrides: Record<string, unknown> = {}) => {
    const exec = createExec();
    const clock = { now: 10_000 };
    const logWarn = vi.fn();
    const logInfo = vi.fn();
    const getOwnPids = vi.fn(() => [MPV_PID]);
    const reader = createPipewireProbe({
        platform: 'linux',
        execFileFn: exec.execFileFn,
        getOwnPids,
        now: () => clock.now,
        logWarn,
        logInfo,
        ...overrides,
    });
    return { reader, exec, clock, logWarn, logInfo, getOwnPids };
};

describe('createPipewireProbe', () => {
    it('is null off Linux and never starts pw-dump there', async () => {
        for (const platform of ['win32', 'darwin', 'freebsd']) {
            const { reader, exec } = createReader({ platform });
            await expect(reader.probe()).resolves.toBeNull();
            expect(exec.execFileFn, platform).not.toHaveBeenCalled();
        }
    });

    it('runs pw-dump with no arguments and no shell, under a timeout and an output cap', async () => {
        const { reader, exec } = createReader();
        const pending = reader.probe();
        expect(exec.calls).toHaveLength(1);
        expect(exec.calls[0].file).toBe('pw-dump');
        expect(exec.calls[0].args).toEqual([]);
        expect(exec.calls[0].options).toMatchObject({ timeout: DEFAULT_TIMEOUT_MS, maxBuffer: DEFAULT_MAX_BUFFER_BYTES });
        expect(exec.calls[0].options.shell).toBeUndefined();
        expect(DEFAULT_TIMEOUT_MS).toBe(3000);
        expect(DEFAULT_MAX_BUFFER_BYTES).toBe(64 * 1024 * 1024);
        expect(DEFAULT_CACHE_MS).toBe(750);
        exec.succeed(0);
        await expect(pending).resolves.toMatchObject({ at: 10_000, stream: { nodeId: 126 }, device: { nodeId: 70 } });

        const custom = createReader({ timeoutMs: 500, maxBufferBytes: 1024 });
        void custom.reader.probe();
        expect(custom.exec.calls[0].options).toMatchObject({ timeout: 500, maxBuffer: 1024 });
    });

    it('passes the stream name through and marks streams from Folia\'s own processes', async () => {
        const { reader, exec, getOwnPids } = createReader();
        const dump = loadDump().concat([
            client(MPV_PID, 600),
            streamNode({ 'node.name': 'other mpv', 'client.id': 600 }, { id: 601 }),
            link(601, 70),
        ]);
        const pending = reader.probe({ streamName: 'Folia HiFi' });
        exec.succeed(0, JSON.stringify(dump));
        await expect(pending).resolves.toMatchObject({ otherStreams: [{ nodeId: 601, own: true }] });
        expect(getOwnPids).toHaveBeenCalledTimes(1);
        await expect(reader.probe({ streamName: 'Nobody' })).resolves.toBeNull();
    });

    it('calls that arrive together share one pw-dump; the result is reused for cacheMs, then read again', async () => {
        const { reader, exec, clock } = createReader();
        const first = reader.probe();
        const second = reader.probe();
        expect(exec.calls).toHaveLength(1);
        clock.now = 10_050;
        exec.succeed(0);
        const [a, b] = await Promise.all([first, second]);
        expect(a).toEqual(b);
        // 缓存从读到的那一刻算，at 也是那一刻。
        expect(a?.at).toBe(10_050);

        clock.now = 10_050 + DEFAULT_CACHE_MS - 1;
        await expect(reader.probe()).resolves.toMatchObject({ at: 10_050 });
        expect(exec.calls).toHaveLength(1);

        clock.now = 10_050 + DEFAULT_CACHE_MS;
        const third = reader.probe();
        expect(exec.calls).toHaveLength(2);
        exec.succeed(1);
        await expect(third).resolves.toMatchObject({ at: 10_050 + DEFAULT_CACHE_MS });
    });

    it('pw-dump missing, timing out, printing too much, failing or printing non-JSON is null, logged once per kind', async () => {
        const { reader, exec, clock, logWarn } = createReader();
        const failures: Array<[string, (index: number) => void, RegExp]> = [
            ['missing', index => exec.fail(index, execError('spawn pw-dump ENOENT', { code: 'ENOENT' })), /^\[HiFi\] pw-dump is not installed/],
            ['timeout', index => exec.fail(index, execError('Command failed', { killed: true, signal: 'SIGTERM', code: null })), /^\[HiFi\] pw-dump did not finish within 3000 ms/],
            ['too large', index => exec.fail(index, execError('stdout maxBuffer length exceeded', { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true })), /^\[HiFi\] pw-dump printed more than/],
            ['not JSON', index => exec.succeed(index, '[{"id": 1,'), /^\[HiFi\] pw-dump printed something that is not JSON/],
            ['exit code', index => exec.fail(index, execError('Command failed: pw-dump', { code: 1 })), /^\[HiFi\] pw-dump failed/],
        ];
        for (const [label, fail, line] of failures) {
            for (let round = 0; round < 3; round += 1) {
                clock.now += DEFAULT_CACHE_MS;
                const pending = reader.probe();
                fail(exec.calls.length - 1);
                await expect(pending, `${label} #${round}`).resolves.toBeNull();
            }
            const matching = logWarn.mock.calls.filter(([text]) => line.test(String(text)));
            expect(matching, label).toHaveLength(1);
        }
        // 交出去的是错本身（带调用栈），不只是 message。
        expect(logWarn.mock.calls[0][1]).toBeInstanceOf(Error);
        expect(logWarn).toHaveBeenCalledTimes(5);

        // JSON 但不是对象表和解析不了算同一种：先来的那条记下，后来的不再记。
        const shape = createReader();
        const pending = shape.reader.probe();
        shape.exec.succeed(0, '{"id": 1}');
        await expect(pending).resolves.toBeNull();
        shape.clock.now += DEFAULT_CACHE_MS;
        const again = shape.reader.probe();
        shape.exec.succeed(1, 'not json');
        await expect(again).resolves.toBeNull();
        expect(shape.logWarn).toHaveBeenCalledTimes(1);
        expect(shape.logWarn).toHaveBeenCalledWith('[HiFi] pw-dump printed JSON that is not an object list');
    });

    it('a failure is cached too, so polling without pw-dump does not start a process every time', async () => {
        const { reader, exec, clock } = createReader();
        const pending = reader.probe();
        exec.fail(0, execError('spawn pw-dump ENOENT', { code: 'ENOENT' }));
        await expect(pending).resolves.toBeNull();
        clock.now += DEFAULT_CACHE_MS - 1;
        await expect(reader.probe()).resolves.toBeNull();
        expect(exec.calls).toHaveLength(1);
    });

    it('logs a failure kind again after pw-dump has worked in between', async () => {
        const { reader, exec, clock, logWarn } = createReader();
        const steps: Array<(index: number) => void> = [
            index => exec.fail(index, execError('Command failed: pw-dump', { code: 1 })),
            index => exec.succeed(index),
            index => exec.fail(index, execError('Command failed: pw-dump', { code: 1 })),
        ];
        for (const step of steps) {
            clock.now += DEFAULT_CACHE_MS;
            const pending = reader.probe();
            step(exec.calls.length - 1);
            await pending;
        }
        expect(logWarn.mock.calls.filter(([text]) => /pw-dump failed/.test(String(text)))).toHaveLength(2);
    });

    it('execFile throwing on the spot is null and logged', async () => {
        const logWarn = vi.fn();
        const reader = createPipewireProbe({
            platform: 'linux',
            execFileFn: () => {
                throw new Error('EAGAIN');
            },
            logWarn,
            logInfo: () => {},
        });
        await expect(reader.probe()).resolves.toBeNull();
        expect(logWarn).toHaveBeenCalledWith('[HiFi] could not start pw-dump', expect.any(Error));
    });

    it('getOwnPids throwing still gives a probe, with nothing marked own, and is logged once', async () => {
        const { reader, exec, clock, logWarn } = createReader({
            getOwnPids: () => {
                throw new Error('app not ready');
            },
        });
        const dump = JSON.stringify(loadDump().concat([client(MPV_PID, 600), streamNode({ 'node.name': 'x', 'client.id': 600 }, { id: 601 }), link(601, 70)]));
        for (let round = 0; round < 3; round += 1) {
            clock.now += DEFAULT_CACHE_MS;
            const pending = reader.probe();
            exec.succeed(exec.calls.length - 1, dump);
            await expect(pending).resolves.toMatchObject({ otherStreams: [{ nodeId: 601, own: false }] });
        }
        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(logWarn).toHaveBeenCalledWith('[HiFi] could not list Folia\'s own processes', expect.any(Error));
    });

    it('logs what PipeWire reports once per change, not on every poll', async () => {
        const { reader, exec, clock, logInfo } = createReader();
        const read = async (stdout: string = fixtureText) => {
            clock.now += DEFAULT_CACHE_MS;
            const pending = reader.probe();
            exec.succeed(exec.calls.length - 1, stdout);
            return pending;
        };
        await read();
        await read();
        expect(logInfo).toHaveBeenCalledTimes(1);
        expect(logInfo).toHaveBeenLastCalledWith(
            `[HiFi] PipeWire reports: stream 96000 Hz -> filters [effect_input.eq6, remap_input.remap-FL-FR-to-FR-FL] -> ${DEVICE_NAME} 48000 Hz; clock.allowed-rates [48000]`,
        );
        const switched = patchNode(loadDump(), 70, info => {
            info.params.Format[0].rate = 96000;
        });
        await read(JSON.stringify(switched));
        expect(logInfo).toHaveBeenCalledTimes(2);
        expect(String(logInfo.mock.calls[1][0])).toContain(`${DEVICE_NAME} 96000 Hz`);
        await read(JSON.stringify(loadDump().filter(object => object.id !== 126)));
        expect(logInfo).toHaveBeenLastCalledWith('[HiFi] PipeWire reports: no PipeWire stream named "Folia HiFi"');
    });
});
