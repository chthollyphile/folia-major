import type { HifiOutputProbe, HifiPipewireVolume } from '@/types/hifi';

// test/unit/hifi/pipewireProbeFixture.ts
// HifiOutputProbe objects written by hand from a real pw-dump of a Linux laptop: mpv played a silent
// 96 kHz file with --audio-client-name="Folia HiFi". Its stream (node 126, S32LE 96000, volume 1)
// went through an equalizer filter chain (38 effect_input.eq6) and a channel remap
// (40 remap_input.remap-FL-FR-to-FR-FL) to the laptop speaker (node 70, S32LE 48000, ALSA
// hw:sofhdadsp, soft volume 0.930755), with the clock settings rate 48000, allowed-rates [ 48000 ],
// force-rate 0. Each case starts from that and changes what it is about.

export const unityVolume = (): HifiPipewireVolume => ({
    volume: 1,
    mute: false,
    channelVolumes: [1, 1],
    softVolumes: [1, 1],
    softMute: false,
});

export const FIXTURE_DEVICE_DESCRIPTION = 'Alder Lake PCH-P High Definition Audio Controller Speaker';

export type ProbeOverrides = {
    streamRate?: number;
    deviceRate?: number | null;
    deviceFormat?: string;
    deviceChannels?: number | null;
    allowedRates?: number[];
    filters?: HifiOutputProbe['filters'];
    streamVolume?: HifiPipewireVolume | null;
    deviceVolume?: HifiPipewireVolume | null;
    otherStreams?: HifiOutputProbe['otherStreams'];
    device?: null;
    at?: number;
};

/** The machine as it was dumped: 96 kHz from mpv, 48 kHz on the speaker, EQ and remap on the way. */
export const fixtureProbe = (overrides: ProbeOverrides = {}): HifiOutputProbe => ({
    backend: 'pipewire',
    at: overrides.at ?? 1_760_000_000_000,
    stream: {
        nodeId: 126,
        state: 'running',
        format: { format: 'S32LE', rate: overrides.streamRate ?? 96000, channels: 2 },
        volume: overrides.streamVolume === undefined ? unityVolume() : overrides.streamVolume,
    },
    filters: overrides.filters ?? [
        { nodeId: 38, name: 'effect_input.eq6', description: 'Equalizer Sink' },
        { nodeId: 40, name: 'remap_input.remap-FL-FR-to-FR-FL', description: 'remap-FL-FR-to-FR-FL' },
    ],
    device: overrides.device === null
        ? null
        : {
            nodeId: 70,
            name: 'alsa_output.pci-0000_00_1f.3-platform-skl_hda_dsp_generic.HiFi__Speaker__sink',
            description: FIXTURE_DEVICE_DESCRIPTION,
            api: 'alsa',
            path: 'hw:sofhdadsp',
            state: 'running',
            format: {
                format: overrides.deviceFormat ?? 'S32LE',
                rate: overrides.deviceRate === undefined ? 48000 : overrides.deviceRate,
                channels: overrides.deviceChannels === undefined ? 2 : overrides.deviceChannels,
            },
            volume: overrides.deviceVolume === undefined
                ? { volume: 1, mute: false, channelVolumes: [0.026997, 0.026997], softVolumes: [0.930755, 0.930755], softMute: false }
                : overrides.deviceVolume,
        },
    graph: { clockRate: 48000, allowedRates: overrides.allowedRates ?? [48000], forceRate: 0 },
    otherStreams: overrides.otherStreams ?? [],
});

/** The same chain with nothing in the way: allowed-rates lets PipeWire follow the song, no filters, no soft volume. */
export const cleanProbe = (rate: number, overrides: ProbeOverrides = {}): HifiOutputProbe => fixtureProbe({
    streamRate: rate,
    deviceRate: rate,
    allowedRates: [44100, 48000, 88200, 96000, 176400, 192000],
    filters: [],
    deviceVolume: unityVolume(),
    ...overrides,
});

/**
 * mpv's stream into EasyEffects, written by hand after EasyEffects' usual node properties (no pw-dump of a
 * machine running EasyEffects was taken): the walk ends at its easyeffects_sink, a null sink with no
 * link-group, so PipeWire's links do not show the sound card behind it.
 */
export const EASY_EFFECTS_SINK: HifiOutputProbe['filters'][number] = { nodeId: 300, name: 'easyeffects_sink', description: 'Easy Effects Sink' };

export const easyEffectsProbe = (rate: number, overrides: ProbeOverrides = {}): HifiOutputProbe => fixtureProbe({
    streamRate: rate,
    filters: [EASY_EFFECTS_SINK],
    device: null,
    ...overrides,
});
