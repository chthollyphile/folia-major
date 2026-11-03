import { describe, expect, it } from 'vitest';
import type {
    HifiMpvAudioParams,
    HifiOutputProbe,
    HifiSignalConversion,
    HifiSignalVerdict,
    HifiSourceSpec,
    HifiSystemCheck,
} from '@/types/hifi';
import { buildSignalPath, type SignalPathEngineState, type SignalPathSettings } from '@/services/hifi/signalPath';
import { SYSTEM_DEVICE_UNKNOWN, isSystemDeviceUnknown, listsOwnStream } from '@/services/hifi/signalPathSystem';
import { FIXTURE_DEVICE_DESCRIPTION, EASY_EFFECTS_SINK, cleanProbe, easyEffectsProbe, fixtureProbe, unityVolume } from './pipewireProbeFixture';

// test/unit/hifi/signalPath.test.ts
// The bit-perfect verdict: source format against mpv's decoded and output formats, the output driver,
// exclusive mode, DSD (as PCM or as DoP) and software volume. On Linux with a PipeWire probe, the system
// step after the output: the device rate against mpv's, filters, stream and device software volume,
// other streams and channels, and the rate-passthrough verdict that only says PipeWire did not resample;
// a walk that ends at a virtual device (EasyEffects) says the card is unknown, and a probe of an older
// format than mpv now sends is not used.

const params = (format: string, samplerate: number, channelCount = 2): HifiMpvAudioParams => ({
    format,
    samplerate,
    channelCount,
    channels: channelCount === 2 ? 'stereo' : `${channelCount}ch`,
});

const pcmSpec = (bitDepth: number, sampleRate: number): HifiSourceSpec => ({
    origin: 'local',
    codec: 'FLAC',
    container: 'FLAC',
    bitDepth,
    sampleRate,
    channels: 2,
    lossless: true,
    isDsd: false,
    dsdRate: null,
    bitrate: null,
});

const dsdSpec: HifiSourceSpec = {
    origin: 'local',
    codec: 'DSD',
    container: 'DSF',
    bitDepth: 1,
    sampleRate: 2822400,
    channels: 2,
    lossless: true,
    isDsd: true,
    dsdRate: 2822400,
    bitrate: 5644800,
};

/** Navidrome without the OpenSubsonic fields: the suffix says DSD, the rates are unknown. */
const dsdSpecWithoutRates: HifiSourceSpec = { ...dsdSpec, origin: 'navidrome', bitDepth: null, sampleRate: null, dsdRate: null, bitrate: null };

const engine = (fields: Partial<SignalPathEngineState>): SignalPathEngineState => ({
    sourceKind: 'local',
    audioParams: null,
    audioOutParams: null,
    currentAo: 'wasapi',
    audioDevice: 'wasapi/{0.0.0.00000000}.{d10}',
    exclusive: true,
    spdif: null,
    volume: 100,
    track: null,
    ...fields,
});

const settings: SignalPathSettings = { exclusive: true, dsdMode: 'pcm', softwareVolume: false, volume: 100 };

type Case = {
    name: string;
    spec: HifiSourceSpec | null;
    state: SignalPathEngineState;
    settings?: Partial<SignalPathSettings>;
    verdict: HifiSignalVerdict;
    conversions: HifiSignalConversion[];
};

const cases: Case[] = [
    {
        name: '24-bit FLAC decoded as s32 and sent as s32 to WASAPI exclusive',
        spec: pcmSpec(24, 96000),
        state: engine({ audioParams: params('s32', 96000), audioOutParams: params('s32', 96000) }),
        verdict: 'bit-perfect',
        conversions: [],
    },
    {
        name: '16-bit source padded into s32',
        spec: pcmSpec(16, 44100),
        state: engine({ audioParams: params('s16', 44100), audioOutParams: params('s32', 44100) }),
        verdict: 'bit-perfect',
        conversions: [],
    },
    {
        name: '24-bit source in s32 trimmed back to s24',
        spec: pcmSpec(24, 96000),
        state: engine({ audioParams: params('s32', 96000), audioOutParams: params('s24', 96000) }),
        verdict: 'bit-perfect',
        conversions: [],
    },
    {
        name: 'planar to packed of the same width',
        spec: pcmSpec(16, 44100),
        state: engine({ audioParams: params('s16p', 44100), audioOutParams: params('s16', 44100) }),
        verdict: 'bit-perfect',
        conversions: [],
    },
    {
        name: 'float output from s16 input keeps every value',
        spec: pcmSpec(16, 44100),
        state: engine({ audioParams: params('s16', 44100), audioOutParams: params('float', 44100) }),
        verdict: 'converted',
        conversions: ['to-float'],
    },
    {
        name: 'a 24-bit source in s32 sent as float keeps every value',
        spec: pcmSpec(24, 96000),
        state: engine({ audioParams: params('s32', 96000), audioOutParams: params('float', 96000) }),
        verdict: 'converted',
        conversions: ['to-float'],
    },
    {
        name: 'a full 32-bit integer source sent as float loses precision',
        spec: pcmSpec(32, 96000),
        state: engine({ audioParams: params('s32', 96000), audioOutParams: params('float', 96000) }),
        verdict: 'converted',
        conversions: ['format'],
    },
    {
        name: 'a full 32-bit integer source sent as double keeps every value',
        spec: pcmSpec(32, 96000),
        state: engine({ audioParams: params('s32', 96000), audioOutParams: params('double', 96000) }),
        verdict: 'converted',
        conversions: ['to-float'],
    },
    {
        name: 'float widened to double keeps every value',
        spec: pcmSpec(32, 44100),
        state: engine({ audioParams: params('floatp', 44100), audioOutParams: params('double', 44100) }),
        verdict: 'converted',
        conversions: ['to-float'],
    },
    {
        name: 'double narrowed to float loses precision',
        spec: pcmSpec(64, 44100),
        state: engine({ audioParams: params('double', 44100), audioOutParams: params('float', 44100) }),
        verdict: 'converted',
        conversions: ['format'],
    },
    {
        name: 'float source sent as s32 keeps its values but is still converted',
        spec: pcmSpec(32, 44100),
        state: engine({ audioParams: params('float', 44100), audioOutParams: params('s32', 44100) }),
        verdict: 'converted',
        conversions: ['float-to-int'],
    },
    {
        name: 'planar float decode sent as s32',
        spec: pcmSpec(32, 44100),
        state: engine({ audioParams: params('floatp', 44100), audioOutParams: params('s32', 44100) }),
        verdict: 'converted',
        conversions: ['float-to-int'],
    },
    {
        name: 'float narrowed to s24 loses precision',
        spec: pcmSpec(32, 44100),
        state: engine({ audioParams: params('float', 44100), audioOutParams: params('s24', 44100) }),
        verdict: 'converted',
        conversions: ['format'],
    },
    {
        name: 'double sent as s32 loses precision',
        spec: pcmSpec(32, 44100),
        state: engine({ audioParams: params('double', 44100), audioOutParams: params('s32', 44100) }),
        verdict: 'converted',
        conversions: ['format'],
    },
    {
        name: '32-bit source narrowed to s16',
        spec: pcmSpec(32, 44100),
        state: engine({ audioParams: params('s32', 44100), audioOutParams: params('s16', 44100) }),
        verdict: 'converted',
        conversions: ['format'],
    },
    {
        name: '44.1 kHz resampled to 48 kHz',
        spec: pcmSpec(16, 44100),
        state: engine({ audioParams: params('s16', 44100), audioOutParams: params('s16', 48000) }),
        verdict: 'converted',
        conversions: ['resample'],
    },
    {
        name: 'channel count changed',
        spec: pcmSpec(16, 44100),
        state: engine({ audioParams: params('s16', 44100, 6), audioOutParams: params('s16', 44100, 2) }),
        verdict: 'converted',
        conversions: ['channels'],
    },
    {
        name: 'PipeWire without exclusive, identical params',
        spec: pcmSpec(16, 44100),
        state: engine({
            currentAo: 'pipewire',
            audioDevice: 'pipewire',
            exclusive: false,
            audioParams: params('s16', 44100),
            audioOutParams: params('s16', 44100),
        }),
        settings: { exclusive: false },
        verdict: 'shared-mixer',
        conversions: ['shared-mixer'],
    },
    {
        // mpv's pipewire AO has no exclusive mode: PipeWire still resamples to the graph rate and mixes.
        name: 'PipeWire with exclusive asked for still goes through the mixer',
        spec: pcmSpec(24, 96000),
        state: engine({
            currentAo: 'pipewire',
            audioDevice: 'pipewire',
            exclusive: true,
            audioParams: params('s32', 96000),
            audioOutParams: params('s32', 96000),
        }),
        verdict: 'shared-mixer',
        conversions: ['shared-mixer'],
    },
    {
        name: 'a PipeWire sink picked by name with exclusive asked for',
        spec: pcmSpec(16, 44100),
        state: engine({
            currentAo: 'pipewire',
            audioDevice: 'pipewire/alsa_output.usb-Topping_D10-00.analog-stereo',
            exclusive: true,
            audioParams: params('s16', 44100),
            audioOutParams: params('s16', 44100),
        }),
        verdict: 'shared-mixer',
        conversions: ['shared-mixer'],
    },
    {
        name: 'JACK with exclusive asked for',
        spec: pcmSpec(16, 44100),
        state: engine({ currentAo: 'jack', audioDevice: 'auto', audioParams: params('float', 44100), audioOutParams: params('float', 44100) }),
        verdict: 'shared-mixer',
        conversions: ['shared-mixer'],
    },
    {
        name: 'a driver without exclusive support, such as SDL',
        spec: pcmSpec(16, 44100),
        state: engine({ currentAo: 'sdl', audioDevice: 'auto', audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }),
        verdict: 'shared-mixer',
        conversions: ['shared-mixer'],
    },
    {
        name: 'Core Audio in hog mode (coreaudio_exclusive)',
        spec: pcmSpec(24, 96000),
        state: engine({ currentAo: 'coreaudio_exclusive', audioDevice: 'auto', audioParams: params('s32', 96000), audioOutParams: params('s32', 96000) }),
        verdict: 'bit-perfect',
        conversions: [],
    },
    {
        name: 'Core Audio without exclusive',
        spec: pcmSpec(24, 96000),
        state: engine({ currentAo: 'coreaudio', audioDevice: 'auto', exclusive: false, audioParams: params('s32', 96000), audioOutParams: params('s32', 96000) }),
        settings: { exclusive: false },
        verdict: 'shared-mixer',
        conversions: ['shared-mixer'],
    },
    {
        name: 'driver not reported yet: inferred from exclusive',
        spec: pcmSpec(16, 44100),
        state: engine({ currentAo: null, audioDevice: 'auto', audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }),
        verdict: 'bit-perfect',
        conversions: [],
    },
    {
        name: 'WASAPI shared mode',
        spec: pcmSpec(16, 44100),
        state: engine({ exclusive: false, audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }),
        verdict: 'shared-mixer',
        conversions: ['shared-mixer'],
    },
    {
        name: 'PulseAudio even with exclusive asked for',
        spec: pcmSpec(16, 44100),
        state: engine({ currentAo: 'pulse', audioDevice: 'auto', audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }),
        verdict: 'shared-mixer',
        conversions: ['shared-mixer'],
    },
    {
        name: 'ALSA hw: device without exclusive goes direct',
        spec: pcmSpec(24, 96000),
        state: engine({
            currentAo: 'alsa',
            audioDevice: 'alsa/hw:CARD=D10,DEV=0',
            exclusive: false,
            audioParams: params('s32', 96000),
            audioOutParams: params('s32', 96000),
        }),
        settings: { exclusive: false },
        verdict: 'bit-perfect',
        conversions: [],
    },
    {
        name: 'ALSA default device goes through the mixer',
        spec: pcmSpec(16, 44100),
        state: engine({ currentAo: 'alsa', audioDevice: 'alsa/default', audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }),
        verdict: 'shared-mixer',
        conversions: ['shared-mixer'],
    },
    {
        name: 'resampled and shared: converted wins',
        spec: pcmSpec(16, 44100),
        state: engine({ exclusive: false, audioParams: params('s16', 44100), audioOutParams: params('float', 48000) }),
        verdict: 'converted',
        conversions: ['resample', 'to-float', 'shared-mixer'],
    },
    {
        name: 'DSD decoded to floatp 352.8 kHz PCM',
        spec: dsdSpec,
        state: engine({ audioParams: params('floatp', 352800), audioOutParams: params('floatp', 352800) }),
        verdict: 'converted',
        conversions: ['dsd-to-pcm'],
    },
    {
        name: 'DSD with audio-spdif=dsd and s32 at a 16th of the DSD rate (DoP)',
        spec: dsdSpec,
        state: engine({ spdif: 'dsd', audioParams: params('s32', 176400), audioOutParams: params('s32', 176400) }),
        settings: { dsdMode: 'dop' },
        verdict: 'dop',
        conversions: ['dop'],
    },
    {
        name: 'DSD whose output format names DoP',
        spec: dsdSpec,
        state: engine({ spdif: 'dsd', audioParams: params('spdif-dsd', 176400), audioOutParams: params('spdif-dsd', 176400) }),
        settings: { dsdMode: 'dop' },
        verdict: 'dop',
        conversions: ['dop'],
    },
    {
        name: 'DSD with audio-spdif=dsd but PCM at the wrong rate is not DoP',
        spec: dsdSpec,
        state: engine({ spdif: 'dsd', audioParams: params('floatp', 352800), audioOutParams: params('s32', 352800) }),
        settings: { dsdMode: 'dop' },
        verdict: 'converted',
        conversions: ['dsd-to-pcm', 'float-to-int'],
    },
    {
        // A float decode proves mpv converted DSD to PCM, even though 352.8 kHz is a DoP rate for DSD128.
        name: 'DSD decoded to floatp and sent as s32 at a DoP rate, DSD rate unknown, is not DoP',
        spec: dsdSpecWithoutRates,
        state: engine({ spdif: 'dsd', audioParams: params('floatp', 352800), audioOutParams: params('s32', 352800) }),
        settings: { dsdMode: 'dop' },
        verdict: 'converted',
        conversions: ['dsd-to-pcm', 'float-to-int'],
    },
    {
        name: 'DSD decoded to floatp and resampled to s32 at a 16th of the DSD rate is not DoP',
        spec: dsdSpec,
        state: engine({ spdif: 'dsd', audioParams: params('floatp', 352800), audioOutParams: params('s32', 176400) }),
        settings: { dsdMode: 'dop' },
        verdict: 'converted',
        conversions: ['dsd-to-pcm', 'resample', 'float-to-int'],
    },
    {
        name: 'DSD with integer output at a 16th of the DSD rate but resampled on the way is not DoP',
        spec: dsdSpec,
        state: engine({ spdif: 'dsd', audioParams: params('s32', 352800), audioOutParams: params('s32', 176400) }),
        settings: { dsdMode: 'dop' },
        verdict: 'converted',
        conversions: ['dsd-to-pcm', 'resample'],
    },
    {
        name: 'DSD recognised from the mpv codec when the spec is missing',
        spec: null,
        state: engine({
            spdif: 'dsd',
            track: {
                codec: 'dsd_lsbf_planar',
                codecDesc: 'DSD (Direct Stream Digital), least significant bit first, planar',
                decoder: 'dsd_lsbf_planar',
                demuxSamplerate: 352800,
                demuxChannelCount: 2,
                demuxBitrate: 5644800,
                formatName: null,
            },
            audioParams: params('s32', 176400),
            audioOutParams: params('s32', 176400),
        }),
        verdict: 'dop',
        conversions: ['dop'],
    },
    {
        name: 'software volume',
        spec: pcmSpec(16, 44100),
        state: engine({ volume: 80, audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }),
        settings: { softwareVolume: true, volume: 80 },
        verdict: 'converted',
        conversions: ['volume'],
    },
    {
        name: 'no output params yet',
        spec: pcmSpec(16, 44100),
        state: engine({ audioParams: params('s16', 44100), audioOutParams: null }),
        verdict: 'unknown',
        conversions: [],
    },
];

describe('buildSignalPath', () => {
    it.each(cases)('$name → $verdict', ({ spec, state, settings: overrides, verdict, conversions }) => {
        const path = buildSignalPath(spec, state, { ...settings, ...overrides });
        expect(path.verdict).toBe(verdict);
        expect(path.conversions).toEqual(conversions);
    });

    it('lays out five stages and bypasses processing on a clean path', () => {
        const path = buildSignalPath(
            pcmSpec(24, 96000),
            engine({ sourceKind: 'navidrome', audioParams: params('s32', 96000), audioOutParams: params('s32', 96000) }),
            settings,
        );
        expect(path.stages.map(stage => stage.id)).toEqual(['source', 'transport', 'decode', 'process', 'output']);
        expect(path.stages.map(stage => stage.status)).toEqual(['passthrough', 'passthrough', 'passthrough', 'bypassed', 'passthrough']);
        expect(path.stages[0].format).toEqual({ sampleRate: 96000, bitDepth: 24, sampleFormat: 'FLAC', channels: 2, dsdRate: null });
        expect(path.stages[1].detail).toBe('format=raw');
        expect(path.stages[4].format).toEqual({ sampleRate: 96000, bitDepth: 32, sampleFormat: 's32', channels: 2, dsdRate: null });
        expect(path.output).toEqual({ ao: 'wasapi', device: 'wasapi/{0.0.0.00000000}.{d10}', exclusive: true });
    });

    it('marks the stage that converts', () => {
        const dsd = buildSignalPath(dsdSpec, engine({ audioParams: params('floatp', 352800), audioOutParams: params('floatp', 352800) }), settings);
        expect(dsd.stages[2]).toMatchObject({ id: 'decode', status: 'converted', conversions: ['dsd-to-pcm'] });
        expect(dsd.stages[4]).toMatchObject({ id: 'output', status: 'passthrough', conversions: [] });

        // 应用音量 65% 时 mpv 的 volume 是它的立方根乘 100（selectHifiEngineConfig）。
        const volume = buildSignalPath(
            pcmSpec(16, 44100),
            engine({ volume: Math.cbrt(0.65) * 100, audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }),
            { ...settings, softwareVolume: true, volume: 65 },
        );
        expect(volume.stages[3]).toMatchObject({ id: 'process', status: 'converted', conversions: ['volume'], detail: '65%' });

        const dop = buildSignalPath(dsdSpec, engine({ spdif: 'dsd', audioParams: params('s32', 176400), audioOutParams: params('s32', 176400) }), settings);
        expect(dop.stages[4]).toMatchObject({ status: 'passthrough', conversions: ['dop'] });
        expect(dop.stages[4].format?.dsdRate).toBe(2822400);
    });

    it('shows the app volume, not the cube-root value mpv holds', () => {
        const at = (mpvVolume: number) => buildSignalPath(
            pcmSpec(16, 44100),
            engine({ volume: mpvVolume, audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }),
            { ...settings, softwareVolume: true, volume: 50 },
        ).stages[3];
        // 应用 50% → mpv 79.37；mpv 自己的数字是 79%。
        expect(at(79.37)).toMatchObject({ status: 'converted', conversions: ['volume'], detail: '50%' });
        expect(at(Math.cbrt(0.2) * 100).detail).toBe('20%');
        expect(at(0).detail).toBe('0%');
        // 软件音量开着时，满音量也算改了采样值（规则没变）。
        expect(at(100)).toMatchObject({ status: 'converted', conversions: ['volume'], detail: '100%' });
    });

    it('does not apply software volume to DoP', () => {
        const path = buildSignalPath(
            dsdSpec,
            engine({ spdif: 'dsd', audioParams: params('s32', 176400), audioOutParams: params('s32', 176400) }),
            { ...settings, dsdMode: 'dop', softwareVolume: true, volume: 50 },
        );
        expect(path.verdict).toBe('dop');
        expect(path.stages[3].status).toBe('bypassed');
    });

    it('treats an mpv volume below 100 as a conversion even with software volume off', () => {
        const path = buildSignalPath(pcmSpec(16, 44100), engine({ volume: 90, audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }), settings);
        expect(path.verdict).toBe('converted');
        expect(path.conversions).toEqual(['volume']);
    });

    it('is unknown without an engine state or without decoded params', () => {
        const noEngine = buildSignalPath(pcmSpec(16, 44100), null, settings);
        expect(noEngine.verdict).toBe('unknown');
        expect(noEngine.stages).toHaveLength(5);
        expect(noEngine.stages[0].status).toBe('passthrough');
        expect(noEngine.stages.slice(1).every(stage => stage.status === 'unknown')).toBe(true);

        const noInput = buildSignalPath(pcmSpec(16, 44100), engine({ audioOutParams: params('s16', 44100) }), settings);
        expect(noInput.verdict).toBe('unknown');
    });

    it('names the output by its driver and device', () => {
        const alsa = buildSignalPath(null, engine({ currentAo: 'alsa', audioDevice: 'alsa/hw:CARD=D10,DEV=0' }), settings);
        expect(alsa.stages[4].detail).toBe('alsa/hw:CARD=D10,DEV=0');
        const auto = buildSignalPath(null, engine({ currentAo: 'coreaudio', audioDevice: 'auto' }), settings);
        expect(auto.stages[4].detail).toBe('coreaudio');
        const other = buildSignalPath(null, engine({ currentAo: 'wasapi', audioDevice: '{guid}' }), settings);
        expect(other.stages[4].detail).toBe('wasapi {guid}');
    });
});

/** mpv on PipeWire, sending what it decoded unchanged. */
const pipewire = (rate: number, fields: Partial<SignalPathEngineState> = {}) => engine({
    currentAo: 'pipewire',
    audioDevice: 'auto',
    exclusive: false,
    audioParams: params('s32', rate),
    audioOutParams: params('s32', rate),
    ...fields,
});

const pipewireSettings: SignalPathSettings = { ...settings, exclusive: false };

const checksOf = (checks: HifiSystemCheck[]) => Object.fromEntries(checks.map(check => [check.id, check.ok ? 'ok' : check.detail]));

type ProbeCase = {
    name: string;
    sourceRate: number;
    state?: Partial<SignalPathEngineState>;
    settings?: Partial<SignalPathSettings>;
    probe: HifiOutputProbe;
    verdict: HifiSignalVerdict;
    systemConversions: HifiSignalConversion[];
    checks: Record<string, string | null>;
};

const probeCases: ProbeCase[] = [
    {
        // pw-dump on this laptop: allowed-rates [ 48000 ] keeps the speaker at 48 kHz.
        name: 'the dumped machine: 96 kHz from mpv, the speaker at 48 kHz, EQ and remap on the way',
        sourceRate: 96000,
        probe: fixtureProbe(),
        verdict: 'shared-mixer',
        // The soft volume on the speaker scales every sample: a change on this step too.
        systemConversions: ['resample', 'filter', 'volume'],
        checks: {
            rate: '96000 → 48000',
            filters: 'Equalizer Sink, remap-FL-FR-to-FR-FL',
            streamVolume: 'ok',
            deviceVolume: '93%',
            otherStreams: 'ok',
            channels: 'ok',
        },
    },
    {
        name: 'the same machine playing a 48 kHz song: the rate passes, the filters and soft volume are warnings',
        sourceRate: 48000,
        probe: fixtureProbe({ streamRate: 48000 }),
        verdict: 'rate-passthrough',
        systemConversions: ['filter', 'volume'],
        checks: {
            rate: 'ok',
            filters: 'Equalizer Sink, remap-FL-FR-to-FR-FL',
            streamVolume: 'ok',
            deviceVolume: '93%',
            otherStreams: 'ok',
            channels: 'ok',
        },
    },
    {
        name: 'allowed-rates set as in #835: PipeWire switched the device to 96 kHz, nothing in the way',
        sourceRate: 96000,
        probe: cleanProbe(96000),
        verdict: 'rate-passthrough',
        systemConversions: [],
        checks: { rate: 'ok', filters: 'ok', streamVolume: 'ok', deviceVolume: 'ok', otherStreams: 'ok', channels: 'ok' },
    },
    {
        // PipeWire only switches an idle device: Folia's own keep-alive held it at 48 kHz.
        name: '96 kHz allowed, but the keep-alive and a browser keep the device at 48 kHz',
        sourceRate: 96000,
        probe: cleanProbe(96000, {
            deviceRate: 48000,
            otherStreams: [{ nodeId: 131, name: 'Folia', own: true }, { nodeId: 140, name: 'Firefox', own: false }],
        }),
        verdict: 'shared-mixer',
        systemConversions: ['resample'],
        checks: {
            rate: '96000 → 48000',
            filters: 'ok',
            streamVolume: 'ok',
            deviceVolume: 'ok',
            otherStreams: 'Folia (Folia), Firefox',
            channels: 'ok',
        },
    },
    {
        name: 'the stream turned down to 87% in the mixer: a warning, the rate still passes',
        sourceRate: 44100,
        probe: cleanProbe(44100, { streamVolume: { volume: 1, mute: false, channelVolumes: [0.87, 0.87], softVolumes: [0.87, 0.87], softMute: false } }),
        verdict: 'rate-passthrough',
        systemConversions: ['volume'],
        checks: { rate: 'ok', filters: 'ok', streamVolume: '87%', deviceVolume: 'ok', otherStreams: 'ok', channels: 'ok' },
    },
    {
        name: 'the stream muted in the mixer',
        sourceRate: 44100,
        probe: cleanProbe(44100, { streamVolume: { ...unityVolume(), mute: true } }),
        verdict: 'rate-passthrough',
        systemConversions: ['volume'],
        checks: { rate: 'ok', filters: 'ok', streamVolume: '0%', deviceVolume: 'ok', otherStreams: 'ok', channels: 'ok' },
    },
    {
        name: 'PipeWire scales the samples with the device\'s soft volume: a change on this step, the rate still passes',
        sourceRate: 96000,
        probe: cleanProbe(96000, { deviceVolume: { volume: 1, mute: false, channelVolumes: [0.3, 0.3], softVolumes: [0.5, 0.5], softMute: false } }),
        verdict: 'rate-passthrough',
        systemConversions: ['volume'],
        checks: { rate: 'ok', filters: 'ok', streamVolume: 'ok', deviceVolume: '50%', otherStreams: 'ok', channels: 'ok' },
    },
    {
        name: 'a 5.1 device fed stereo: PipeWire remixes the channels',
        sourceRate: 48000,
        probe: cleanProbe(48000, { deviceChannels: 6 }),
        verdict: 'rate-passthrough',
        systemConversions: ['channels'],
        checks: { rate: 'ok', filters: 'ok', streamVolume: 'ok', deviceVolume: 'ok', otherStreams: 'ok', channels: '2 → 6' },
    },
    {
        name: 'a device without a reported rate is not taken as passing, and no resample is made up',
        sourceRate: 96000,
        probe: cleanProbe(96000, { deviceRate: null, deviceChannels: null, streamVolume: null, deviceVolume: null }),
        verdict: 'shared-mixer',
        // PipeWire did not report the device's rate: whether it resamples is unknown, so it is not claimed.
        systemConversions: [],
        // No volumes and no channel count reported: those checks are left out rather than called fine.
        checks: { rate: '96000 → ?', filters: 'ok', otherStreams: 'ok' },
    },
    {
        // EasyEffects' null sink has no link-group: the walk ends there and the card behind it is unknown.
        name: 'into EasyEffects: the virtual sink is the last filter, the device and its rate are unknown',
        sourceRate: 96000,
        probe: easyEffectsProbe(96000),
        verdict: 'shared-mixer',
        // No resample: PipeWire did not report a rate to differ. Only what is known is checked.
        systemConversions: ['filter'],
        checks: { rate: SYSTEM_DEVICE_UNKNOWN, filters: 'Easy Effects Sink', streamVolume: 'ok' },
    },
    {
        name: 'a filter chain whose output half is not linked: the device is unknown just the same',
        sourceRate: 48000,
        probe: fixtureProbe({ streamRate: 48000, device: null, streamVolume: { ...unityVolume(), channelVolumes: [0.5, 0.5] } }),
        verdict: 'shared-mixer',
        systemConversions: ['filter', 'volume'],
        checks: { rate: SYSTEM_DEVICE_UNKNOWN, filters: 'Equalizer Sink, remap-FL-FR-to-FR-FL', streamVolume: '50%' },
    },
    {
        name: 'pulse goes through pipewire-pulse and gets the same step',
        sourceRate: 96000,
        state: { currentAo: 'pulse', audioDevice: 'pulse/alsa_output.usb' },
        probe: cleanProbe(96000),
        verdict: 'rate-passthrough',
        systemConversions: [],
        checks: { rate: 'ok', filters: 'ok', streamVolume: 'ok', deviceVolume: 'ok', otherStreams: 'ok', channels: 'ok' },
    },
    {
        name: 'mpv itself scales with software volume: converted, whatever PipeWire says',
        sourceRate: 96000,
        state: { volume: Math.cbrt(0.5) * 100 },
        settings: { softwareVolume: true, volume: 50 },
        probe: cleanProbe(96000),
        verdict: 'converted',
        systemConversions: [],
        checks: { rate: 'ok', filters: 'ok', streamVolume: 'ok', deviceVolume: 'ok', otherStreams: 'ok', channels: 'ok' },
    },
    {
        name: 'mpv itself resampled: converted, and PipeWire matching its output does not change that',
        sourceRate: 96000,
        state: { audioParams: params('s32', 96000), audioOutParams: params('s32', 48000) },
        probe: fixtureProbe({ streamRate: 48000, filters: [], deviceVolume: unityVolume() }),
        verdict: 'converted',
        systemConversions: [],
        checks: { rate: 'ok', filters: 'ok', streamVolume: 'ok', deviceVolume: 'ok', otherStreams: 'ok', channels: 'ok' },
    },
];

describe('buildSignalPath with a PipeWire probe', () => {
    it.each(probeCases)('$name → $verdict', ({ sourceRate, state, settings: overrides, probe, verdict, systemConversions, checks }) => {
        const path = buildSignalPath(pcmSpec(24, sourceRate), pipewire(sourceRate, state), { ...pipewireSettings, ...overrides }, probe);
        expect(path.verdict).toBe(verdict);
        expect(path.stages.map(stage => stage.id)).toEqual(['source', 'transport', 'decode', 'process', 'output', 'system']);
        const system = path.stages[5];
        expect(system.conversions).toEqual(systemConversions);
        expect(system.status).toBe(systemConversions.length > 0 ? 'converted' : 'passthrough');
        expect(checksOf(path.system!.checks)).toEqual(checks);
        // The shared mixer is now what PipeWire reports, not a guess on the output step.
        expect(path.stages[4].conversions).not.toContain('shared-mixer');
        expect(path.conversions).not.toContain('shared-mixer');
        // The path's list is every step's, PipeWire's last.
        expect(path.conversions).toEqual(path.stages.flatMap(stage => stage.conversions));
    });

    it('describes the device as PipeWire reports it', () => {
        const path = buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, fixtureProbe());
        expect(path.stages[5]).toMatchObject({
            id: 'system',
            format: { sampleRate: 48000, bitDepth: 32, sampleFormat: 'S32LE', channels: 2, dsdRate: null },
            detail: FIXTURE_DEVICE_DESCRIPTION,
        });
        expect(path.system).toMatchObject({
            backend: 'pipewire',
            deviceName: FIXTURE_DEVICE_DESCRIPTION,
            deviceRate: 48000,
            deviceFormat: 'S32LE',
            allowedRates: [48000],
        });
        // The output step stays what mpv handed over, untouched by mpv.
        expect(path.stages[4]).toMatchObject({ status: 'passthrough', conversions: [] });
    });

    it('reads the bit depth out of the PipeWire format names, and names the device by its node name without a description', () => {
        const at = (deviceFormat: string) => buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, cleanProbe(96000, { deviceFormat })).stages[5].format?.bitDepth;
        expect(['S16LE', 'S24LE', 'S24_32LE', 'S32LE', 'F32LE', 'F32P', 'DSD_U32_BE'].map(at)).toEqual([16, 24, 24, 32, 32, 32, null]);

        const probe = cleanProbe(96000);
        const unnamed = buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, { ...probe, device: { ...probe.device!, description: null } });
        expect(unnamed.stages[5].detail).toBe(probe.device!.name);
        expect(unnamed.system?.deviceName).toBe(probe.device!.name);
    });

    it('marks Folia\'s own streams among the others', () => {
        const path = buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, cleanProbe(96000, {
            otherStreams: [{ nodeId: 131, name: 'Chromium', own: true }],
        }));
        const others = path.system!.checks.find(check => check.id === 'otherStreams')!;
        expect(others.detail).toBe('Chromium (Folia)');
        expect(listsOwnStream(others.detail)).toBe(true);
        expect(listsOwnStream('Firefox, mpv')).toBe(false);
        expect(listsOwnStream(null)).toBe(false);
    });

    it('takes a volume within 1e-4 of 100% as 100%', () => {
        const near = (value: number) => buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, cleanProbe(96000, {
            streamVolume: { volume: 1, mute: false, channelVolumes: [value, value], softVolumes: [value, value], softMute: false },
            deviceVolume: { volume: 1, mute: false, channelVolumes: [0.4, 0.4], softVolumes: [value, value], softMute: false },
        })).system!.checks;
        expect(checksOf(near(0.99995))).toMatchObject({ streamVolume: 'ok', deviceVolume: 'ok' });
        expect(checksOf(near(0.9998))).toMatchObject({ streamVolume: '100%', deviceVolume: '100%' });
        // The device's hardware volume (0.4 here) is the card's own: not a check.
        expect(checksOf(near(1)).deviceVolume).toBe('ok');
    });

    it('shows the soft volume when that is the part of the stream volume that is off', () => {
        const path = buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, cleanProbe(96000, {
            streamVolume: { volume: 1, mute: false, channelVolumes: [1, 1], softVolumes: [0.5, 0.5], softMute: false },
        }));
        expect(checksOf(path.system!.checks).streamVolume).toBe('50%');
    });

    it('is the old path without a probe, off PipeWire, without a device or before mpv reports its output', () => {
        const without = buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings);
        expect(without.verdict).toBe('shared-mixer');
        expect(without.conversions).toEqual(['shared-mixer']);
        expect(without.stages).toHaveLength(5);
        expect(without.system).toBeNull();
        expect(buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, null)).toEqual(without);

        // Linked nowhere at all: no filters and no device.
        const noDevice = buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, fixtureProbe({ device: null, filters: [] }));
        expect(noDevice).toEqual(without);

        const alsa = engine({ currentAo: 'alsa', audioDevice: 'alsa/hw:CARD=D10,DEV=0', exclusive: false, audioParams: params('s32', 96000), audioOutParams: params('s32', 96000) });
        expect(buildSignalPath(pcmSpec(24, 96000), alsa, pipewireSettings, cleanProbe(96000))).toEqual(buildSignalPath(pcmSpec(24, 96000), alsa, pipewireSettings));

        const notYet = buildSignalPath(pcmSpec(24, 96000), pipewire(96000, { audioOutParams: null }), pipewireSettings, cleanProbe(96000));
        expect(notYet.verdict).toBe('unknown');
        expect(notYet.system).toBeNull();
        expect(buildSignalPath(pcmSpec(24, 96000), null, pipewireSettings, cleanProbe(96000)).system).toBeNull();
    });
});

describe('buildSignalPath with a probe that ends at a virtual device', () => {
    it('reports no device, no rate and no format, names the virtual sink, and never says rate passthrough', () => {
        const path = buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, easyEffectsProbe(96000));
        expect(path.verdict).toBe('shared-mixer');
        expect(path.stages[5]).toEqual({ id: 'system', status: 'converted', conversions: ['filter'], format: null, detail: 'Easy Effects Sink' });
        expect(path.system).toEqual({
            backend: 'pipewire',
            checks: [
                { id: 'rate', ok: false, detail: 'unknown' },
                { id: 'filters', ok: false, detail: 'Easy Effects Sink' },
                { id: 'streamVolume', ok: true, detail: null },
            ],
            deviceName: null,
            deviceRate: null,
            deviceFormat: null,
            allowedRates: [48000],
            forceRate: null,
        });
        expect(isSystemDeviceUnknown(path.system)).toBe(true);
        // Even when every other rate would match, an unknown card is not taken as passing.
        const matching = buildSignalPath(pcmSpec(24, 48000), pipewire(48000), pipewireSettings, easyEffectsProbe(48000, { allowedRates: [48000] }));
        expect(matching.verdict).toBe('shared-mixer');
        // A sink without a description goes by its node name.
        const unnamed = buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, easyEffectsProbe(96000, {
            filters: [{ ...EASY_EFFECTS_SINK, description: null }],
        }));
        expect(unnamed.stages[5].detail).toBe('easyeffects_sink');
    });

    it('is known when PipeWire reports the device', () => {
        expect(isSystemDeviceUnknown(buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, fixtureProbe()).system)).toBe(false);
        expect(isSystemDeviceUnknown(buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, cleanProbe(96000, { deviceRate: null })).system)).toBe(false);
        expect(isSystemDeviceUnknown(null)).toBe(false);
    });
});

describe('buildSignalPath with a stale probe', () => {
    it('ignores a probe whose stream rate or channels differ from what mpv now sends, instead of calling it a resample', () => {
        const without = buildSignalPath(pcmSpec(24, 44100), pipewire(44100), pipewireSettings);
        // The probe was taken while mpv still sent the 96 kHz song: the 48 kHz device is that song's.
        expect(buildSignalPath(pcmSpec(24, 44100), pipewire(44100), pipewireSettings, fixtureProbe())).toEqual(without);
        const stereoProbe = cleanProbe(48000);
        const surround = pipewire(48000, { audioParams: params('s32', 48000, 6), audioOutParams: params('s32', 48000, 6) });
        expect(buildSignalPath(pcmSpec(24, 48000), surround, pipewireSettings, stereoProbe)).toEqual(buildSignalPath(pcmSpec(24, 48000), surround, pipewireSettings));
        // Also for a probe that ends at a virtual device.
        expect(buildSignalPath(pcmSpec(24, 44100), pipewire(44100), pipewireSettings, easyEffectsProbe(96000))).toEqual(without);
    });

    it('still compares when PipeWire did not report the stream format', () => {
        const probe = cleanProbe(96000);
        const unreported = { ...probe, stream: { ...probe.stream, format: { format: null, rate: null, channels: null } } };
        const path = buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, unreported);
        expect(path.verdict).toBe('rate-passthrough');
        expect(path.system).not.toBeNull();
    });
});

describe('the forced clock rate', () => {
    it('carries clock.force-rate into the report, and 0 as not forced', () => {
        const probe = fixtureProbe();
        expect(buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, probe).system?.forceRate).toBeNull();
        const forced = { ...probe, graph: { ...probe.graph, forceRate: 48000 } };
        expect(buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, forced).system?.forceRate).toBe(48000);
        const virtualForced = easyEffectsProbe(96000);
        virtualForced.graph.forceRate = 44100;
        expect(buildSignalPath(pcmSpec(24, 96000), pipewire(96000), pipewireSettings, virtualForced).system?.forceRate).toBe(44100);
    });
});
