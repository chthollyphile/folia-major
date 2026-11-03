import type {
    HifiMpvAudioParams,
    HifiOutputProbe,
    HifiPipewireFormat,
    HifiPipewireVolume,
    HifiSignalConversion,
    HifiSignalFormat,
    HifiSignalStage,
    HifiSystemCheck,
    HifiSystemReport,
} from '../../types/hifi';

// src/services/hifi/signalPathSystem.ts
// 信号链路里 mpv 之后的 PipeWire 那一级（system）：拿 Linux 上 pw-dump 的探测结果（HifiOutputProbe）和 mpv 交出的格式比，
// 逐项列出设备采样率、滤波链、流和设备的软件音量、同设备上别的流、声道。只照 PipeWire 报的原样比，不推断；
// 链路停在虚拟设备（EasyEffects 这类）时只说到那里为止，不替看不见的声卡说什么。
// DAC 实际收到什么采样率，要在实机上由人看 DAC 的指示确认。结论怎么判在 signalPath.ts。

const positiveOrNull = (value: number | null | undefined): number | null => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
);

/** 音量算不算 100%：PipeWire 的音量是浮点，存取一次会有很小的误差。 */
const UNITY_TOLERANCE = 1e-4;

const isUnity = (value: number) => Number.isFinite(value) && Math.abs(value - 1) <= UNITY_TOLERANCE;

/** 几个线性音量写成百分比，相同的只写一次：[0.87, 0.87] → '87%'，[1, 0.5] → '100% / 50%'。 */
const percentText = (values: number[]): string => {
    const percents = [...new Set(values.filter(Number.isFinite).map(value => `${Math.round(value * 100)}%`))];
    return percents.join(' / ');
};

/**
 * rate 一项的 detail 为它时：链路停在没有 link-group 的虚拟 sink（EasyEffects 这类）或没接上声卡的滤波链，
 * PipeWire 报不出声音最后到了哪块声卡、以什么采样率运行。
 */
export const SYSTEM_DEVICE_UNKNOWN = 'unknown';

/** PipeWire 那一级是不是停在了虚拟设备上、不知道真正的声卡。 */
export const isSystemDeviceUnknown = (report: HifiSystemReport | null | undefined): boolean => Boolean(
    report?.checks.some(check => check.id === 'rate' && check.detail === SYSTEM_DEVICE_UNKNOWN),
);

/** 别的流里来自 Folia 自己进程的那几路，在说明里这样标出来（名字后面）。 */
export const OWN_STREAM_MARK = ' (Folia)';

/** 一条「同设备上别的流」的说明里有没有 Folia 自己的流（Web 引擎的；Linux 上系统媒体控制不再放静音保活）。 */
export const listsOwnStream = (detail: string | null) => Boolean(detail?.split(', ').some(name => name.endsWith(OWN_STREAM_MARK)));

/** PipeWire 的格式名 → 有效位宽：S16LE → 16、S24_32LE → 24、S32LE → 32、F32P → 32；认不出时为 null。 */
const pipewireFormatWidth = (format: string | null): number | null => {
    const match = /^[SUF](8|16|24|32|64)(?:_|LE|BE|P|$)/i.exec(format?.trim() ?? '');
    return match ? Number(match[1]) : null;
};

const formatOfPipewire = (format: HifiPipewireFormat): HifiSignalFormat => ({
    sampleRate: positiveOrNull(format.rate),
    bitDepth: pipewireFormatWidth(format.format),
    sampleFormat: format.format,
    channels: positiveOrNull(format.channels),
    dsdRate: null,
});

/**
 * 流上的音量：总音量、每声道音量、软件音量都要是 100%，也没静音，PipeWire 才没在这路流上缩放采样。
 * 流没有 Props（读不到音量）时不出这一项，不替它说没缩放。
 */
const streamVolumeCheck = (volume: HifiPipewireVolume | null): HifiSystemCheck | null => {
    if (!volume) return null;
    const values = [
        ...(volume.volume === null ? [] : [volume.volume]),
        ...volume.channelVolumes,
        ...(volume.softVolumes ?? []),
    ];
    const muted = volume.mute || volume.softMute === true;
    const ok = !muted && values.every(isUnity);
    // 说明里写听得出的那个数：每声道音量乘总音量；它是 100% 而软件音量不是时写软件音量。
    const effective = volume.channelVolumes.map(channel => channel * (volume.volume ?? 1));
    const shown = [effective, volume.softVolumes ?? [], values].find(list => list.some(value => !isUnity(value))) ?? values;
    return { id: 'streamVolume', ok, detail: ok ? null : muted ? '0%' : percentText(shown) };
};

/**
 * 设备上的软件音量：声卡的硬件音量调不到的那部分由 PipeWire 在软件里乘上去（softVolumes），那才改了采样值；
 * 硬件音量（channelVolumes）是声卡自己的事，不算。没有 softVolumes 时也不出这一项。
 */
const deviceVolumeCheck = (volume: HifiPipewireVolume | null): HifiSystemCheck | null => {
    if (!volume || volume.softVolumes === null) return null;
    const muted = volume.softMute === true;
    const ok = !muted && volume.softVolumes.every(isUnity);
    return { id: 'deviceVolume', ok, detail: ok ? null : muted ? '0%' : percentText(volume.softVolumes) };
};

const filterName = (filter: HifiOutputProbe['filters'][number]) => filter.description || filter.name;

const filtersCheck = (probe: HifiOutputProbe): HifiSystemCheck => ({
    id: 'filters',
    ok: probe.filters.length === 0,
    detail: probe.filters.length === 0 ? null : probe.filters.map(filterName).join(', '),
});

/**
 * 探测读到的 mpv 那路流的格式（PipeWire 报的采样率、声道）和 mpv 现在交出的对不上：那是 mpv 换格式之前的探测，
 * 拿它比会把旧的设备采样率说成一次重采样。PipeWire 没报的那一项不比。
 */
const isStaleProbe = (out: HifiMpvAudioParams, probe: HifiOutputProbe) => {
    const rate = positiveOrNull(probe.stream.format.rate);
    const channels = positiveOrNull(probe.stream.format.channels);
    return (rate !== null && rate !== out.samplerate) || (channels !== null && channels !== out.channelCount);
};

export type SystemFindings = {
    /** status 由 signalPath 按 conversions 定，和别的级同一条规则。 */
    stage: Omit<HifiSignalStage, 'status'>;
    report: HifiSystemReport;
    /** 设备的采样率和 mpv 交出的一样。 */
    ratePasses: boolean;
};

/**
 * 链路停在虚拟 sink 或没接上声卡的滤波链（device 为 null、filters 不空）：声音进了 EasyEffects 这类音效程序或虚拟设备，
 * 之后到了哪块声卡、以什么采样率运行，PipeWire 的连接里看不出来。采样率一项记成不知道（不通过，结论是经过系统混音器），
 * 不替看不见的设备说采样率、声道、设备音量和别的流；流上的音量照报。
 */
const buildUnknownDeviceFindings = (probe: HifiOutputProbe): SystemFindings => {
    const checks: HifiSystemCheck[] = [
        { id: 'rate', ok: false, detail: SYSTEM_DEVICE_UNKNOWN },
        filtersCheck(probe),
    ];
    const streamVolume = streamVolumeCheck(probe.stream.volume);
    if (streamVolume) checks.push(streamVolume);
    const conversions: HifiSignalConversion[] = ['filter'];
    if (streamVolume && !streamVolume.ok) conversions.push('volume');
    return {
        stage: {
            id: 'system',
            conversions,
            format: null,
            detail: filterName(probe.filters[probe.filters.length - 1]),
        },
        report: {
            backend: 'pipewire',
            checks,
            deviceName: null,
            deviceRate: null,
            deviceFormat: null,
            allowedRates: probe.graph.allowedRates,
            forceRate: positiveOrNull(probe.graph.forceRate),
        },
        ratePasses: false,
    };
};

/**
 * mpv 之后 PipeWire 那一段：设备的采样率、声道和 mpv 交出的对不对得上，途中有没有滤波链，流和设备上有没有软件音量，
 * 同一设备上还有没有别的流在放。只用在 mpv 走 pipewire / pulse 输出的时候。探测找到了设备时逐项比；链路停在虚拟设备时
 * 只说到那里（buildUnknownDeviceFindings）；没连上任何地方、或者探测读的是 mpv 换格式之前的流时为 null。
 */
export const buildSystemFindings = (out: HifiMpvAudioParams, probe: HifiOutputProbe): SystemFindings | null => {
    if (isStaleProbe(out, probe)) return null;
    const device = probe.device;
    if (!device) return probe.filters.length > 0 ? buildUnknownDeviceFindings(probe) : null;
    const deviceRate = positiveOrNull(device.format.rate);
    const deviceChannels = positiveOrNull(device.format.channels);
    const ratePasses = deviceRate !== null && deviceRate === out.samplerate;
    const checks: HifiSystemCheck[] = [
        { id: 'rate', ok: ratePasses, detail: ratePasses ? null : `${out.samplerate} → ${deviceRate ?? '?'}` },
        filtersCheck(probe),
    ];
    const streamVolume = streamVolumeCheck(probe.stream.volume);
    if (streamVolume) checks.push(streamVolume);
    const deviceVolume = deviceVolumeCheck(device.volume);
    if (deviceVolume) checks.push(deviceVolume);
    checks.push({
        id: 'otherStreams',
        ok: probe.otherStreams.length === 0,
        detail: probe.otherStreams.length === 0
            ? null
            : probe.otherStreams.map(stream => (stream.own ? `${stream.name}${OWN_STREAM_MARK}` : stream.name)).join(', '),
    });
    const channelsPass = deviceChannels === null || deviceChannels === out.channelCount;
    if (deviceChannels !== null) {
        checks.push({ id: 'channels', ok: channelsPass, detail: channelsPass ? null : `${out.channelCount} → ${deviceChannels}` });
    }

    const conversions: HifiSignalConversion[] = [];
    // PipeWire 没报设备的采样率时不说它重采样了：只说不知道（verdictDescription / systemRateHints 照这个判断）。
    if (!ratePasses && deviceRate !== null) conversions.push('resample');
    if (!channelsPass) conversions.push('channels');
    if (probe.filters.length > 0) conversions.push('filter');
    // PipeWire 在流或设备上乘了软件音量：每个采样都被缩放，这一级算改过。
    if (streamVolume?.ok === false || deviceVolume?.ok === false) conversions.push('volume');

    return {
        stage: {
            id: 'system',
            conversions,
            format: formatOfPipewire(device.format),
            detail: device.description || device.name,
        },
        report: {
            backend: 'pipewire',
            checks,
            deviceName: device.description || device.name,
            deviceRate,
            deviceFormat: device.format.format,
            allowedRates: probe.graph.allowedRates,
            forceRate: positiveOrNull(probe.graph.forceRate),
        },
        ratePasses,
    };
};
