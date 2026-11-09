import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { HifiMpvAudioParams, HifiSignalVerdict, HifiSourceSpec } from '@/types/hifi';
import { buildSignalPath, type SignalPathEngineState, type SignalPathSettings } from '@/services/hifi/signalPath';
import {
    describeConversion,
    describeStage,
    formatBadgeFormat,
    formatDsdRate,
    formatHifiBadge,
    formatSampleRate,
    formatStageFormat,
    isConversionLossless,
    isValuePreservingPath,
    stageLabel,
    stageStatusLabel,
    verdictDescription,
    verdictLabel,
    verdictTitle,
    signalPathTone,
    verdictTone,
} from '@/components/hifi/hifiSignalText';
import { PIPEWIRE_UNFORCE_RATE_COMMAND, describeSystemCheck, pipewireAllowedRatesSnippet, systemRateHints } from '@/components/hifi/hifiSystemText';
import type { HifiOutputProbe } from '@/types/hifi';
import { cleanProbe, easyEffectsProbe, fixtureProbe } from './pipewireProbeFixture';

// test/unit/hifi/hifiSignalText.test.ts
// The words of the HiFi badge and signal-path sheet: the verdict labels and tones, the badge line
// (output rate, source bit depth when bit-perfect, DSD64 for DoP), the stage format lines and the
// conversions said in plain words, and the advice for a shared output by system. On Linux with a PipeWire
// probe: the PipeWire step's check lines, why PipeWire did not switch the rate (allowed-rates, a busy
// device, Folia's own keep-alive, a forced clock rate) with the #835 config line or the command to undo it,
// the rate-passthrough wording and badge tone, and a walk that ends at a virtual device (EasyEffects). Paths
// come from the real buildSignalPath; the translator is a stand-in with the English texts these keys get.

const EN: Record<string, string> = {
    'hifi.player.badgeChip': 'HiFi',
    'hifi.player.badge': 'HiFi · {{verdict}}',
    'hifi.player.badgeWithFormat': 'HiFi · {{verdict}} · {{format}}',
    'hifi.signal.verdictShort.bitPerfect': 'Bit-perfect',
    'hifi.signal.verdictShort.dop': 'Native DSD',
    'hifi.signal.verdictShort.ratePassthrough': 'Rate passthrough',
    'hifi.signal.verdictShort.converted': 'Converted',
    'hifi.signal.verdictShort.sharedMixer': 'System mixer',
    'hifi.signal.verdictShort.unknown': 'Unverified',
    'hifi.signal.verdict.bitPerfect': 'Bit-perfect',
    'hifi.signal.verdict.dop': 'Native DSD via DoP',
    'hifi.signal.verdict.ratePassthrough': 'Sample rate passthrough (via PipeWire)',
    'hifi.signal.verdict.converted': 'Converted on the way',
    'hifi.signal.verdict.sharedMixer': 'Through the system mixer',
    'hifi.signal.verdict.unknown': 'Not verified yet',
    'hifi.signal.verdictDesc.bitPerfect': 'Every sample reaches your DAC exactly as it is in the file.',
    'hifi.signal.verdictDesc.converted': 'mpv changes the signal before it reaches the output.',
    'hifi.signal.verdictDesc.convertedFloatToInt': 'mpv only converts 32-bit float to 32-bit integer. Not bit-perfect.',
    'hifi.signal.verdictDesc.convertedToFloat': 'mpv only converts the samples to floating point. Not bit-perfect.',
    'hifi.signal.verdictDesc.sharedMixer': 'The output device is shared with other apps. Turn on exclusive mode in the HiFi settings.',
    'hifi.signal.verdictDesc.sharedMixerExclusiveOn': 'Exclusive mode is on, but this output device does not take it. Choose another output device.',
    'hifi.signal.verdictDesc.sharedMixerLinux': 'PipeWire or PulseAudio mixes this output. Choose a device marked direct.',
    'hifi.signal.verdictDesc.sharedMixerPipewire': 'PipeWire resamples this song. The PipeWire step says why.',
    'hifi.signal.verdictDesc.sharedMixerVirtual': 'The sound goes into a virtual device. The card behind it is unknown.',
    'hifi.signal.verdictDesc.sharedMixerUnknownRate': 'PipeWire does not report the device rate. Whether it resamples is unknown.',
    'hifi.signal.verdictDesc.ratePassthrough': 'PipeWire reports the rate mpv sends. Not a bit-perfect check.',
    'hifi.signal.stage.output': 'Output',
    'hifi.signal.stage.system': 'PipeWire',
    'hifi.signal.status.passthrough': 'Passthrough',
    'hifi.signal.status.converted': 'Converted',
    'hifi.signal.status.bypassed': 'Bypassed',
    'hifi.signal.status.unknown': 'Unknown',
    'hifi.signal.sampleRate': '{{value}} kHz',
    'hifi.signal.dsdRate': 'DSD{{multiple}}',
    'hifi.signal.dsdRateMhz': 'DSD {{value}} MHz',
    'hifi.signal.bitDepth': '{{bits}} bit',
    'hifi.signal.floatDepth': '{{bits}} bit float',
    'hifi.signal.channelsMono': 'Mono',
    'hifi.signal.channelsStereo': 'Stereo',
    'hifi.signal.channelsCount': '{{count}} channels',
    'hifi.signal.conversion.resample': 'Resampled from {{from}} to {{to}}',
    'hifi.signal.conversion.resamplePlain': 'Resampled',
    'hifi.signal.conversion.format': 'Sample format changed from {{from}} to {{to}}',
    'hifi.signal.conversion.toFloat': 'Converted from {{from}} to {{to}}: values kept',
    'hifi.signal.conversion.formatPlain': 'Sample format changed',
    'hifi.signal.conversion.floatToInt': '32-bit float converted to 32-bit integer: values kept, only samples above 0 dBFS clipped',
    'hifi.signal.conversion.channels': 'Channels changed from {{from}} to {{to}}',
    'hifi.signal.conversion.channelsPlain': 'Channels changed',
    'hifi.signal.conversion.dsdToPcm': 'DSD converted to PCM',
    'hifi.signal.conversion.dop': 'DSD packed into PCM frames (DoP), unchanged',
    'hifi.signal.conversion.volume': 'Software volume scales every sample ({{volume}})',
    'hifi.signal.conversion.volumePlain': 'Software volume scales every sample',
    'hifi.signal.conversion.volumePipewire': "PipeWire's software volume scales every sample ({{volume}})",
    'hifi.signal.conversion.volumePipewirePlain': "PipeWire's software volume scales every sample",
    'hifi.signal.conversion.sharedMixer': 'Mixed by the system mixer, which may resample it',
    'hifi.signal.conversion.filter': 'Changed by filters in PipeWire: {{names}}',
    'hifi.signal.conversion.filterPlain': 'Changed by filters in PipeWire',
    'hifi.signal.systemReported': 'As PipeWire reports it (pw-dump)',
    'hifi.signal.system.rateOk': 'The device runs at {{rate}}, the rate mpv sends',
    'hifi.signal.system.rateWarn': 'The device runs at {{to}}, but mpv sends {{from}}: PipeWire resamples',
    'hifi.signal.system.rateUnknown': "PipeWire does not report the device's sample rate",
    'hifi.signal.system.rateVirtual': "The sound goes into the virtual device {{name}}. PipeWire's report ends here",
    'hifi.signal.system.filtersOk': 'No filters (equalizer, remap) between mpv and the device',
    'hifi.signal.system.filtersWarn': 'Filters change the sound on the way: {{names}}',
    'hifi.signal.system.streamVolumeOk': "Folia's stream is at 100% in PipeWire",
    'hifi.signal.system.streamVolumeWarn': "Folia's stream is at {{volume}} in PipeWire, which scales every sample",
    'hifi.signal.system.deviceVolumeOk': 'No software volume on the device',
    'hifi.signal.system.deviceVolumeWarn': 'PipeWire applies part of the device volume in software ({{volume}}), which scales every sample',
    'hifi.signal.system.otherStreamsOk': 'Nothing else is playing on this device',
    'hifi.signal.system.otherStreamsWarn': 'Also playing on this device: {{names}}',
    'hifi.signal.system.ownStream': '{{name}} (from Folia itself)',
    'hifi.signal.system.channelsOk': 'The device takes the channels mpv sends',
    'hifi.signal.system.channelsWarn': 'mpv sends {{from}}, the device takes {{to}}: PipeWire remixes the channels',
    'hifi.signal.system.channelsWarnPlain': 'The device takes other channels than mpv sends: PipeWire remixes them',
    'hifi.signal.system.hintForced': "PipeWire's clock.force-rate holds the sample rate at {{forced}}, so the device does not switch to {{rate}}.",
    'hifi.signal.system.hintNotAllowed': 'PipeWire is not allowed to switch to {{rate}}: add it to default.clock.allowed-rates.',
    'hifi.signal.system.hintBusy': 'PipeWire only switches rates while the device is idle; other streams are playing on it: {{names}}.',
    'hifi.signal.system.hintBusyOwn': 'A stream from Folia itself is among them.',
    'hifi.signal.system.hintJoin': '{{first}} {{second}}',
    'hifi.signal.system.hintNoSwitch': 'PipeWire did not switch the device to {{rate}}.',
    'hifi.signal.transportLocal': "Read byte for byte from your library through Folia's local bridge",
    'hifi.signal.transportNavidrome': 'The original file from Navidrome, not transcoded',
    'hifi.signal.processBypassed': 'No equalizer, effects, ReplayGain or volume change',
    'hifi.signal.outputExclusive': 'Exclusive mode',
    'hifi.signal.outputDirect': 'Direct to the device',
    'hifi.signal.outputShared': 'Shared mode',
};

const t = ((key: string, options?: Record<string, unknown>) => {
    const template = EN[key];
    if (template === undefined) throw new Error(`no text for ${key}`);
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name]));
}) as unknown as TFunction;

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

const bitPerfect96 = () => buildSignalPath(
    pcmSpec(24, 96000),
    engine({ audioParams: params('s32', 96000), audioOutParams: params('s32', 96000) }),
    settings,
);

const dop64 = () => buildSignalPath(
    dsdSpec,
    engine({ spdif: 'dsd', audioParams: params('s32', 176400), audioOutParams: params('s32', 176400) }),
    { ...settings, dsdMode: 'dop' },
);

const resampledToFloat = () => buildSignalPath(
    pcmSpec(16, 44100),
    engine({ audioParams: params('s16', 44100), audioOutParams: params('float', 48000) }),
    settings,
);

const sharedPulse = () => buildSignalPath(
    pcmSpec(16, 44100),
    engine({ currentAo: 'pulse', audioDevice: 'pulse/alsa_output.usb', audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }),
    settings,
);

const sharedPipewire = () => buildSignalPath(
    pcmSpec(16, 44100),
    engine({ currentAo: 'pipewire', audioDevice: 'auto', exclusive: true, audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }),
    settings,
);

/** A direct ALSA hw: device with the exclusive switch off: nothing mixes it all the same. */
const alsaHwSwitchOff = () => buildSignalPath(
    pcmSpec(16, 44100),
    engine({ currentAo: 'alsa', audioDevice: 'alsa/hw:CARD=D10,DEV=0', exclusive: false, audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }),
    { ...settings, exclusive: false },
);

/** WASAPI with the exclusive switch off: the Windows mixer has it. */
const sharedWasapi = () => buildSignalPath(
    pcmSpec(16, 44100),
    engine({ exclusive: false, audioParams: params('s16', 44100), audioOutParams: params('s16', 44100) }),
    { ...settings, exclusive: false },
);

const stageOf = (path: ReturnType<typeof bitPerfect96>, id: string) => path.stages.find(stage => stage.id === id)!;

describe('verdict labels', () => {
    const VERDICTS: HifiSignalVerdict[] = ['bit-perfect', 'dop', 'rate-passthrough', 'converted', 'shared-mixer', 'unknown'];

    it('names every verdict short for the badge and in full for the sheet', () => {
        expect(VERDICTS.map(verdict => verdictLabel(verdict, t))).toEqual([
            'Bit-perfect', 'Native DSD', 'Rate passthrough', 'Converted', 'System mixer', 'Unverified',
        ]);
        expect(VERDICTS.map(verdict => verdictTitle(verdict, t))).toEqual([
            'Bit-perfect', 'Native DSD via DoP', 'Sample rate passthrough (via PipeWire)', 'Converted on the way', 'Through the system mixer', 'Not verified yet',
        ]);
    });

    it('draws an untouched path, and one PipeWire reports at mpv\'s rate, in the accent colour', () => {
        // The badge and the sheet tell rate passthrough from bit-perfect by their icon.
        expect(VERDICTS.map(verdictTone)).toEqual(['accent', 'accent', 'accent', 'muted', 'muted', 'muted']);
    });

    it('takes the accent colour away from rate passthrough on the badge when any PipeWire check fails', () => {
        expect(signalPathTone(onPipewire(96000, cleanProbe(96000)))).toBe('accent');
        const failing: Array<[string, HifiOutputProbe]> = [
            ['filters', cleanProbe(96000, { filters: [{ nodeId: 38, name: 'effect_input.eq6', description: 'Equalizer Sink' }] })],
            ['streamVolume', cleanProbe(96000, { streamVolume: { volume: 1, mute: false, channelVolumes: [0.8, 0.8], softVolumes: [0.8, 0.8], softMute: false } })],
            ['deviceVolume', cleanProbe(96000, { deviceVolume: { volume: 1, mute: false, channelVolumes: [1, 1], softVolumes: [0.9, 0.9], softMute: false } })],
            ['otherStreams', cleanProbe(96000, { otherStreams: [{ nodeId: 140, name: 'Firefox', own: false }] })],
            ['channels', cleanProbe(96000, { deviceChannels: 6 })],
        ];
        for (const [check, probe] of failing) {
            const path = onPipewire(96000, probe);
            expect(path.verdict, check).toBe('rate-passthrough');
            expect(path.system!.checks.find(item => item.id === check)?.ok, check).toBe(false);
            expect(signalPathTone(path), check).toBe('muted');
        }
        // The other verdicts keep their tone.
        expect(signalPathTone(bitPerfect96())).toBe('accent');
        expect(signalPathTone(dop64())).toBe('accent');
        expect(signalPathTone(onPipewire(96000, fixtureProbe()))).toBe('muted');
    });

    it('names the PipeWire step', () => {
        expect(stageLabel('system', t)).toBe('PipeWire');
    });

    it('names the stage states', () => {
        expect(stageStatusLabel('passthrough', t)).toBe('Passthrough');
        expect(stageStatusLabel('bypassed', t)).toBe('Bypassed');
    });
});

describe('the badge line', () => {
    it('takes the rate from the output and the bit depth from the source when bit-perfect', () => {
        // mpv decodes 24-bit FLAC as s32: the badge still says what the file holds.
        expect(formatHifiBadge(bitPerfect96(), t, 'en')).toEqual({
            text: 'HiFi · Bit-perfect · 96 kHz / 24 bit',
            shortText: 'HiFi · Bit-perfect',
            chipText: 'HiFi',
        });
    });

    it('leaves the bit depth out while the source format is unknown, rather than calling the s32 container 32 bit', () => {
        // A 24-bit FLAC that music-metadata has not read yet (or a Navidrome answer without bitDepth): mpv decodes it as s32.
        const path = buildSignalPath(null, engine({ audioParams: params('s32', 96000), audioOutParams: params('s32', 96000) }), settings);
        expect(path.verdict).toBe('bit-perfect');
        expect(formatBadgeFormat(path, t, 'en')).toBe('96 kHz');
        expect(formatHifiBadge(path, t, 'en').text).toBe('HiFi · Bit-perfect · 96 kHz');

        const shared = buildSignalPath({ ...pcmSpec(24, 96000), bitDepth: null }, engine({
            currentAo: 'pipewire', audioDevice: 'auto', audioParams: params('s32', 96000), audioOutParams: params('s32', 96000),
        }), settings);
        expect(shared.verdict).toBe('shared-mixer');
        expect(formatBadgeFormat(shared, t, 'en')).toBe('96 kHz');
    });

    it('says only HiFi for a restored track that mpv has not loaded yet', () => {
        const path = buildSignalPath(pcmSpec(24, 96000), null, settings);
        expect(formatHifiBadge(path, t, 'en', { deferred: true })).toEqual({ text: 'HiFi', shortText: 'HiFi', chipText: 'HiFi' });
    });

    it('says DSD64 for DoP', () => {
        const path = dop64();
        expect(path.verdict).toBe('dop');
        expect(formatHifiBadge(path, t, 'en').text).toBe('HiFi · Native DSD · DSD64');
    });

    it('shows what reaches the output once mpv converted it', () => {
        const path = resampledToFloat();
        expect(path.verdict).toBe('converted');
        expect(formatHifiBadge(path, t, 'en').text).toBe('HiFi · Converted · 48 kHz / 32 bit float');
    });

    it('keeps the source bit depth when only the system mixer is in the way', () => {
        const path = sharedPulse();
        expect(path.verdict).toBe('shared-mixer');
        expect(formatHifiBadge(path, t, 'en').text).toBe('HiFi · System mixer · 44.1 kHz / 16 bit');
    });

    it('has no format while mpv has not reported one', () => {
        const path = buildSignalPath(pcmSpec(24, 96000), null, settings);
        expect(path.verdict).toBe('unknown');
        expect(formatHifiBadge(path, t, 'en')).toEqual({ text: 'HiFi · Unverified', shortText: 'HiFi · Unverified', chipText: 'HiFi' });
    });

    it('writes the numbers the way the interface language does', () => {
        expect(formatBadgeFormat(sharedPulse(), t, 'in')).toBe('44,1 kHz / 16 bit');
        expect(formatSampleRate(44100, t, 'zh-CN')).toBe('44.1 kHz');
        // A language code Intl does not take falls back to the English way.
        expect(formatSampleRate(88200, t, 'not a locale!')).toBe('88.2 kHz');
    });
});

describe('formats', () => {
    it('names DSD rates by their multiple, for both families', () => {
        expect(formatDsdRate(2822400, t, 'en')).toBe('DSD64');
        expect(formatDsdRate(5644800, t, 'en')).toBe('DSD128');
        expect(formatDsdRate(3072000, t, 'en')).toBe('DSD64');
        expect(formatDsdRate(2000000, t, 'en')).toBe('DSD 2 MHz');
        expect(formatDsdRate(null, t, 'en')).toBeNull();
    });

    it('writes each stage as rate, depth and channels', () => {
        const path = bitPerfect96();
        expect(formatStageFormat(stageOf(path, 'source'), t, 'en')).toBe('96 kHz · 24 bit · Stereo');
        expect(formatStageFormat(stageOf(path, 'decode'), t, 'en')).toBe('96 kHz · 32 bit · Stereo');
        expect(formatStageFormat(stageOf(path, 'transport'), t, 'en')).toBeNull();
    });

    it('writes a DSD source as its rate and the DoP output with its carrier', () => {
        const path = dop64();
        expect(formatStageFormat(stageOf(path, 'source'), t, 'en')).toBe('DSD64 · Stereo');
        expect(formatStageFormat(stageOf(path, 'output'), t, 'en')).toBe('DSD64 · 176.4 kHz · 32 bit · Stereo');
    });
});

describe('conversions and stage notes', () => {
    it('says each conversion in plain words, with the values on both ends', () => {
        const path = resampledToFloat();
        expect(stageOf(path, 'output').conversions).toEqual(['resample', 'to-float']);
        expect(describeConversion('resample', path, t, 'en')).toBe('Resampled from 44.1 kHz to 48 kHz');
        expect(describeConversion('to-float', path, t, 'en')).toBe('Converted from 16 bit to 32 bit float: values kept');
        expect(describeConversion('format', path, t, 'en')).toBe('Sample format changed from 16 bit to 32 bit float');
        expect(describeConversion('dsd-to-pcm', path, t, 'en')).toBe('DSD converted to PCM');
    });

    it('marks 32-bit float sent as s32 apart: values kept, still converted, its own verdict note', () => {
        const floatFile = { ...pcmSpec(32, 96000), codec: 'WAV', container: 'WAV' };
        const path = buildSignalPath(floatFile, engine({ audioParams: params('float', 96000), audioOutParams: params('s32', 96000) }), settings);
        expect(path.verdict).toBe('converted');
        expect(stageOf(path, 'output').conversions).toEqual(['float-to-int']);
        expect(describeConversion('float-to-int', path, t, 'en')).toBe('32-bit float converted to 32-bit integer: values kept, only samples above 0 dBFS clipped');
        expect(isConversionLossless('float-to-int')).toBe(true);
        expect(isConversionLossless('format')).toBe(false);
        expect(verdictDescription(path, t, 'win32')).toBe('mpv only converts 32-bit float to 32-bit integer. Not bit-perfect.');
        // Resampled on top of it: the generic note, the float step still listed on its own.
        const resampled = buildSignalPath(floatFile, engine({ audioParams: params('float', 96000), audioOutParams: params('s32', 48000) }), settings);
        expect(stageOf(resampled, 'output').conversions).toEqual(['resample', 'float-to-int']);
        expect(verdictDescription(resampled, t, 'win32')).toBe('mpv changes the signal before it reaches the output.');
    });

    it('treats a path whose only changes keep every value as a note, not a warning', () => {
        const floatFile = { ...pcmSpec(32, 96000), codec: 'WAV', container: 'WAV' };
        const floatToS32 = buildSignalPath(floatFile, engine({ audioParams: params('float', 96000), audioOutParams: params('s32', 96000) }), settings);
        expect(isValuePreservingPath(floatToS32)).toBe(true);
        expect(signalPathTone(floatToS32)).toBe('accent');
        // Still not bit-perfect: the verdict and its words stay "converted".
        expect(floatToS32.verdict).toBe('converted');
        expect(verdictLabel(floatToS32.verdict, t)).toBe('Converted');

        const s16ToFloat = buildSignalPath(pcmSpec(16, 44100), engine({ audioParams: params('s16', 44100), audioOutParams: params('float', 44100) }), settings);
        expect(isValuePreservingPath(s16ToFloat)).toBe(true);
        expect(isConversionLossless('to-float')).toBe(true);
        expect(verdictDescription(s16ToFloat, t, 'win32')).toBe('mpv only converts the samples to floating point. Not bit-perfect.');

        // Anything else on the way keeps the warning: resampling, DSD to PCM, a system mixer, a narrowing.
        const resampled = buildSignalPath(floatFile, engine({ audioParams: params('float', 96000), audioOutParams: params('s32', 48000) }), settings);
        const dsd = buildSignalPath(
            dsdSpec,
            engine({ audioParams: params('float', 352800), audioOutParams: params('s32', 352800) }),
            settings,
        );
        const shared = buildSignalPath(
            pcmSpec(16, 44100),
            engine({ exclusive: false, audioParams: params('s16', 44100), audioOutParams: params('float', 44100) }),
            { ...settings, exclusive: false },
        );
        const narrowed = buildSignalPath(floatFile, engine({ audioParams: params('float', 96000), audioOutParams: params('s24', 96000) }), settings);
        for (const [name, path] of [['resampled', resampled], ['dsd', dsd], ['shared', shared], ['narrowed', narrowed]] as const) {
            expect(isValuePreservingPath(path), name).toBe(false);
            expect(signalPathTone(path), name).toBe('muted');
        }
        expect(isValuePreservingPath(bitPerfect96())).toBe(false);
    });

    it('on PipeWire, needs the PipeWire step untouched too, and loses the accent when a check fails', () => {
        const floatOnPipewire = (probe: HifiOutputProbe) => buildSignalPath(
            { ...pcmSpec(32, 96000), codec: 'WAV', container: 'WAV' },
            engine({ currentAo: 'pipewire', audioDevice: 'auto', exclusive: false, audioParams: params('float', 96000), audioOutParams: params('s32', 96000) }),
            { ...settings, exclusive: false },
            probe,
        );
        const clean = floatOnPipewire(cleanProbe(96000));
        expect(isValuePreservingPath(clean)).toBe(true);
        expect(signalPathTone(clean)).toBe('accent');
        // PipeWire runs the device at 48 kHz: resampled after all.
        expect(isValuePreservingPath(floatOnPipewire(cleanProbe(48000)))).toBe(false);
        const busy = floatOnPipewire(cleanProbe(96000, { otherStreams: [{ nodeId: 140, name: 'Firefox', own: false }] }));
        expect(isValuePreservingPath(busy)).toBe(true);
        expect(signalPathTone(busy)).toBe('muted');
    });

    it('names the software volume and the channel remix', () => {
        const path = buildSignalPath(
            pcmSpec(24, 48000),
            // 应用音量 72% 时 mpv 的 volume 是它的立方根乘 100；链路上写的是应用音量。
            engine({ volume: Math.cbrt(0.72) * 100, audioParams: params('float', 48000, 6), audioOutParams: params('float', 48000, 2) }),
            { ...settings, softwareVolume: true, volume: 72 },
        );
        expect(describeConversion('volume', path, t, 'en')).toBe('Software volume scales every sample (72%)');
        expect(describeConversion('channels', path, t, 'en')).toBe('Channels changed from 6 channels to Stereo');
    });

    it('falls back to the plain words when an end is unknown', () => {
        const path = buildSignalPath(pcmSpec(24, 96000), null, settings);
        expect(describeConversion('resample', path, t, 'en')).toBe('Resampled');
        expect(describeConversion('volume', path, t, 'en')).toBe('Software volume scales every sample');
    });

    it('explains transport, a bypassed process stage and the output mode', () => {
        const path = bitPerfect96();
        expect(describeStage(stageOf(path, 'transport'), path, 'navidrome', t)).toBe('The original file from Navidrome, not transcoded');
        expect(describeStage(stageOf(path, 'transport'), path, 'local', t)).toBe("Read byte for byte from your library through Folia's local bridge");
        expect(describeStage(stageOf(path, 'process'), path, 'local', t)).toBe('No equalizer, effects, ReplayGain or volume change');
        expect(describeStage(stageOf(path, 'output'), path, 'local', t)).toBe('Exclusive mode');
        // PulseAudio mixes whatever the exclusive setting says.
        expect(describeStage(stageOf(sharedPulse(), 'output'), sharedPulse(), 'local', t)).toBe('Shared mode');
        expect(describeStage(stageOf(path, 'source'), path, 'local', t)).toBeNull();
    });

    it('names the output mode after what the output does, not after the exclusive switch', () => {
        // A direct hw: device with the switch off is not mixed: the verdict and the note must agree.
        const direct = alsaHwSwitchOff();
        expect(direct.verdict).toBe('bit-perfect');
        expect(describeStage(stageOf(direct, 'output'), direct, 'local', t, 'linux')).toBe('Direct to the device');
        // PipeWire with the switch on is mixed all the same.
        const pipewire = sharedPipewire();
        expect(pipewire.verdict).toBe('shared-mixer');
        expect(describeStage(stageOf(pipewire, 'output'), pipewire, 'local', t, 'linux')).toBe('Shared mode');
        // WASAPI follows the switch; Windows has an exclusive mode to name.
        expect(describeStage(stageOf(sharedWasapi(), 'output'), sharedWasapi(), 'local', t, 'win32')).toBe('Shared mode');
        expect(describeStage(stageOf(bitPerfect96(), 'output'), bitPerfect96(), 'local', t, 'win32')).toBe('Exclusive mode');
    });
});

describe('the advice for a shared output', () => {
    it('points Linux at a direct device, whatever the exclusive switch says', () => {
        expect(verdictDescription(sharedPipewire(), t, 'linux')).toBe('PipeWire or PulseAudio mixes this output. Choose a device marked direct.');
        expect(verdictDescription(sharedPulse(), t, 'linux')).toBe('PipeWire or PulseAudio mixes this output. Choose a device marked direct.');
    });

    it('asks Windows and macOS to turn exclusive mode on only while it is off', () => {
        expect(verdictDescription(sharedWasapi(), t, 'win32')).toBe('The output device is shared with other apps. Turn on exclusive mode in the HiFi settings.');
        // Exclusive is on and the output still mixes: this device does not take exclusive mode.
        expect(verdictDescription(sharedPulse(), t, 'darwin')).toBe('Exclusive mode is on, but this output device does not take it. Choose another output device.');
    });

    it('leaves the other verdicts as they are', () => {
        expect(verdictDescription(bitPerfect96(), t, 'linux')).toBe('Every sample reaches your DAC exactly as it is in the file.');
    });
});

/** mpv on PipeWire with a probe: 24-bit FLAC decoded as s32 and handed over unchanged. */
const onPipewire = (rate: number, probe: HifiOutputProbe) => buildSignalPath(
    pcmSpec(24, rate),
    engine({ currentAo: 'pipewire', audioDevice: 'auto', exclusive: false, audioParams: params('s32', rate), audioOutParams: params('s32', rate) }),
    { ...settings, exclusive: false },
    probe,
);

const linesOf = (path: ReturnType<typeof bitPerfect96>) => path.system!.checks.map(check => describeSystemCheck(check, path, t, 'en'));

describe('the PipeWire step', () => {
    it('says each check of the dumped machine in plain words', () => {
        const path = onPipewire(96000, fixtureProbe());
        expect(linesOf(path)).toEqual([
            'The device runs at 48 kHz, but mpv sends 96 kHz: PipeWire resamples',
            'Filters change the sound on the way: Equalizer Sink, remap-FL-FR-to-FR-FL',
            "Folia's stream is at 100% in PipeWire",
            'PipeWire applies part of the device volume in software (93%), which scales every sample',
            'Nothing else is playing on this device',
            'The device takes the channels mpv sends',
        ]);
        expect(formatStageFormat(stageOf(path, 'system'), t, 'en')).toBe('48 kHz · 32 bit · Stereo');
        expect(describeStage(stageOf(path, 'system'), path, 'local', t, 'linux')).toBe('As PipeWire reports it (pw-dump)');
        expect(describeConversion('resample', path, t, 'en', 'system')).toBe('Resampled from 96 kHz to 48 kHz');
        expect(describeConversion('filter', path, t, 'en', 'system')).toBe('Changed by filters in PipeWire: Equalizer Sink, remap-FL-FR-to-FR-FL');
    });

    it('says what passes when PipeWire follows the song, and names a remix and Folia\'s own stream', () => {
        const clean = onPipewire(96000, cleanProbe(96000));
        expect(linesOf(clean)).toEqual([
            'The device runs at 96 kHz, the rate mpv sends',
            'No filters (equalizer, remap) between mpv and the device',
            "Folia's stream is at 100% in PipeWire",
            'No software volume on the device',
            'Nothing else is playing on this device',
            'The device takes the channels mpv sends',
        ]);

        const busy = onPipewire(48000, cleanProbe(48000, {
            deviceChannels: 6,
            otherStreams: [{ nodeId: 131, name: 'Chromium', own: true }, { nodeId: 140, name: 'Firefox', own: false }],
        }));
        expect(linesOf(busy)).toContain('Also playing on this device: Chromium (from Folia itself), Firefox');
        expect(linesOf(busy)).toContain('mpv sends Stereo, the device takes 6 channels: PipeWire remixes the channels');
        expect(describeConversion('channels', busy, t, 'en', 'system')).toBe('Channels changed from Stereo to 6 channels');
    });

    it('says the volume PipeWire applies in its own words on its step, apart from mpv\'s software volume', () => {
        const path = onPipewire(96000, fixtureProbe());
        expect(describeConversion('volume', path, t, 'en', 'system')).toBe("PipeWire's software volume scales every sample (93%)");
        const both = onPipewire(96000, cleanProbe(96000, {
            streamVolume: { volume: 1, mute: false, channelVolumes: [0.87, 0.87], softVolumes: [0.87, 0.87], softMute: false },
            deviceVolume: { volume: 1, mute: false, channelVolumes: [1, 1], softVolumes: [0.5, 0.5], softMute: false },
        }));
        expect(stageOf(both, 'system').conversions).toEqual(['volume']);
        expect(describeConversion('volume', both, t, 'en', 'system')).toBe("PipeWire's software volume scales every sample (87%, 50%)");
        // No volume checks failed (asked anyway): the plain line.
        expect(describeConversion('volume', onPipewire(96000, cleanProbe(96000)), t, 'en', 'system')).toBe("PipeWire's software volume scales every sample");
    });

    it('says a stream into a virtual device ends there, without a rate for the card behind it', () => {
        const path = onPipewire(96000, easyEffectsProbe(96000));
        expect(linesOf(path)).toEqual([
            "The sound goes into the virtual device Easy Effects Sink. PipeWire's report ends here",
            'Filters change the sound on the way: Easy Effects Sink',
            "Folia's stream is at 100% in PipeWire",
        ]);
        expect(formatStageFormat(stageOf(path, 'system'), t, 'en')).toBeNull();
        expect(verdictDescription(path, t, 'linux')).toBe('The sound goes into a virtual device. The card behind it is unknown.');
        // Nothing to infer about a card PipeWire does not show.
        expect(systemRateHints(path, t, 'en')).toEqual([]);
    });

    it('does not make up a rate PipeWire did not report', () => {
        const path = onPipewire(96000, cleanProbe(96000, { deviceRate: null }));
        expect(linesOf(path)[0]).toBe("PipeWire does not report the device's sample rate");
        // Nor a resample, a reason or a fix built on that missing rate.
        expect(stageOf(path, 'system').conversions).not.toContain('resample');
        expect(verdictDescription(path, t, 'linux')).toBe('PipeWire does not report the device rate. Whether it resamples is unknown.');
        expect(systemRateHints(path, t, 'en')).toEqual([]);
    });

    it('writes a float device format as float', () => {
        const path = onPipewire(96000, cleanProbe(96000, { deviceFormat: 'F32LE' }));
        expect(formatStageFormat(stageOf(path, 'system'), t, 'en')).toBe('96 kHz · 32 bit float · Stereo');
    });

    it('keeps the output step shared, now that PipeWire\'s step tells what the mixer did', () => {
        const path = onPipewire(96000, cleanProbe(96000));
        expect(stageOf(path, 'output').conversions).toEqual([]);
        expect(describeStage(stageOf(path, 'output'), path, 'local', t, 'linux')).toBe('Shared mode');
    });
});

describe('the verdict with PipeWire', () => {
    it('never calls rate passthrough bit-perfect, and points a resampled song at the PipeWire step', () => {
        const passing = onPipewire(96000, cleanProbe(96000));
        expect(passing.verdict).toBe('rate-passthrough');
        expect(verdictDescription(passing, t, 'linux')).toBe('PipeWire reports the rate mpv sends. Not a bit-perfect check.');
        expect(formatHifiBadge(passing, t, 'en').text).toBe('HiFi · Rate passthrough · 96 kHz / 24 bit');

        const resampled = onPipewire(96000, fixtureProbe());
        expect(resampled.verdict).toBe('shared-mixer');
        expect(verdictDescription(resampled, t, 'linux')).toBe('PipeWire resamples this song. The PipeWire step says why.');
    });
});

describe('why PipeWire did not switch the rate', () => {
    it('asks for allowed-rates when it lacks mpv\'s rate, with the #835 line to paste', () => {
        const hints = systemRateHints(onPipewire(96000, fixtureProbe()), t, 'en');
        expect(hints).toEqual([{
            id: 'notAllowed',
            text: 'PipeWire is not allowed to switch to 96 kHz: add it to default.clock.allowed-rates.',
            snippet: 'context.properties = { default.clock.allowed-rates = [ 44100 48000 88200 96000 176400 192000 ] }',
            command: null,
        }]);
    });

    it('names the streams that keep the device busy, and says when one is Folia\'s own', () => {
        const busy = (otherStreams: HifiOutputProbe['otherStreams']) => systemRateHints(
            onPipewire(96000, cleanProbe(96000, { deviceRate: 48000, otherStreams })),
            t,
            'en',
        );
        expect(busy([{ nodeId: 140, name: 'Firefox', own: false }])).toEqual([{
            id: 'busy',
            text: 'PipeWire only switches rates while the device is idle; other streams are playing on it: Firefox.',
            snippet: null,
            command: null,
        }]);
        // Chromium reports the app's name for the keep-alive: it already says Folia.
        expect(busy([{ nodeId: 131, name: 'Folia', own: true }])[0].text).toBe(
            'PipeWire only switches rates while the device is idle; other streams are playing on it: Folia. A stream from Folia itself is among them.',
        );
        expect(busy([{ nodeId: 131, name: 'Chromium', own: true }])[0].text).toBe(
            'PipeWire only switches rates while the device is idle; other streams are playing on it: Chromium (from Folia itself). A stream from Folia itself is among them.',
        );
    });

    it('says it did not switch when nothing explains it, with the config line only when allowed-rates could not be read', () => {
        const idle = systemRateHints(onPipewire(96000, cleanProbe(96000, { deviceRate: 48000 })), t, 'en');
        expect(idle).toEqual([{ id: 'noSwitch', text: 'PipeWire did not switch the device to 96 kHz.', snippet: null, command: null }]);

        const unread = systemRateHints(onPipewire(96000, cleanProbe(96000, { deviceRate: 48000, allowedRates: [] })), t, 'en');
        expect(unread[0]).toMatchObject({ id: 'noSwitch', snippet: pipewireAllowedRatesSnippet(96000) });
    });

    it('names a forced clock rate first, with the command that undoes it', () => {
        const forcedAt = (forceRate: number, probe: HifiOutputProbe) => ({ ...probe, graph: { ...probe.graph, forceRate } });
        // allowed-rates lacks 96 kHz too, but nothing switches while the rate is forced.
        const hints = systemRateHints(onPipewire(96000, forcedAt(48000, fixtureProbe())), t, 'en');
        expect(hints).toEqual([{
            id: 'forced',
            text: "PipeWire's clock.force-rate holds the sample rate at 48 kHz, so the device does not switch to 96 kHz.",
            snippet: null,
            command: 'pw-metadata -n settings 0 clock.force-rate 0',
        }]);
        expect(PIPEWIRE_UNFORCE_RATE_COMMAND).toBe('pw-metadata -n settings 0 clock.force-rate 0');
        // Behind a virtual device too: the forced rate is the graph's.
        expect(systemRateHints(onPipewire(96000, forcedAt(48000, easyEffectsProbe(96000))), t, 'en')[0]?.id).toBe('forced');
        // Forced to mpv's own rate, or not forced (0): the other reasons as before.
        expect(systemRateHints(onPipewire(96000, forcedAt(96000, fixtureProbe())), t, 'en')[0]?.id).toBe('notAllowed');
        expect(systemRateHints(onPipewire(96000, forcedAt(0, fixtureProbe())), t, 'en')[0]?.id).toBe('notAllowed');
    });

    it('has nothing to explain once the rate matches, or without a probe', () => {
        expect(systemRateHints(onPipewire(48000, fixtureProbe({ streamRate: 48000 })), t, 'en')).toEqual([]);
        expect(systemRateHints(sharedPipewire(), t, 'en')).toEqual([]);
    });

    it('adds a rate the usual list lacks to the config line', () => {
        expect(pipewireAllowedRatesSnippet()).toBe('context.properties = { default.clock.allowed-rates = [ 44100 48000 88200 96000 176400 192000 ] }');
        expect(pipewireAllowedRatesSnippet(352800)).toBe('context.properties = { default.clock.allowed-rates = [ 44100 48000 88200 96000 176400 192000 352800 ] }');
        expect(pipewireAllowedRatesSnippet(32000)).toBe('context.properties = { default.clock.allowed-rates = [ 32000 44100 48000 88200 96000 176400 192000 ] }');
        expect(pipewireAllowedRatesSnippet(96000)).toBe(pipewireAllowedRatesSnippet());
    });
});
