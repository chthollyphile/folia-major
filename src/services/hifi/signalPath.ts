import type {
    HifiDsdMode,
    HifiEngineState,
    HifiMpvAudioParams,
    HifiOutputProbe,
    HifiSignalConversion,
    HifiSignalFormat,
    HifiSignalPath,
    HifiSignalStage,
    HifiSignalStageStatus,
    HifiSignalVerdict,
    HifiSourceSpec,
} from '../../types/hifi';
import { isPipewireOutputDriver } from './hifiEngineRules';
import { buildSystemFindings } from './signalPathSystem';

// src/services/hifi/signalPath.ts
// 把源格式、mpv 解码后的格式和实际送进声卡的格式逐级比对，判断这一路是不是逐位直通（bit-perfect）。
// Linux 上经 PipeWire 输出、有 pw-dump 的探测结果时，再比 mpv 交出的格式和 PipeWire 报的设备格式（system 一级，
// 在 signalPathSystem.ts）。那一级只是 PipeWire 自己报的状态：DAC 实际收到什么要在实机上由人确认，这里从不据此判逐位直通。

export type SignalPathEngineState = Pick<
    HifiEngineState,
    'sourceKind' | 'audioParams' | 'audioOutParams' | 'currentAo' | 'audioDevice' | 'exclusive' | 'spdif' | 'volume' | 'track'
>;

export type SignalPathSettings = {
    exclusive: boolean;
    dsdMode: HifiDsdMode;
    softwareVolume: boolean;
    volume: number;
};

type SampleFormatKind = 'int' | 'float' | 'spdif' | 'other';

type SampleFormatInfo = {
    kind: SampleFormatKind;
    /** 去掉平面（planar）后缀后的名字：'s16p' → 's16'。 */
    base: string;
    /** 每个采样的容器位宽。 */
    width: number | null;
};

const INTEGER_FORMAT = /^[su](8|16|24|32|64)$/;
const FLOAT_WIDTH: Record<string, number> = { float: 32, double: 64 };
/** DSD64/128/256/512 打成 DoP 后的 PCM 采样率（44.1k 和 48k 两族），位速率未知时用来认 DoP。 */
const DOP_SAMPLE_RATES = new Set([176400, 352800, 705600, 1411200, 192000, 384000, 768000, 1536000]);

/** 解析 mpv 的采样格式名：s16 / s32 / float / double / u8，加 p 是平面版，spdif-* 是透传码流。 */
const parseSampleFormat = (format: string): SampleFormatInfo => {
    const name = format.trim().toLowerCase();
    if (name.startsWith('spdif')) return { kind: 'spdif', base: name, width: null };
    const base = name.endsWith('p') && (INTEGER_FORMAT.test(name.slice(0, -1)) || name.slice(0, -1) in FLOAT_WIDTH)
        ? name.slice(0, -1)
        : name;
    const integer = INTEGER_FORMAT.exec(base);
    if (integer) return { kind: 'int', base, width: Number(integer[1]) };
    if (base in FLOAT_WIDTH) return { kind: 'float', base, width: FLOAT_WIDTH[base] };
    return { kind: 'other', base, width: null };
};

const positiveOrNull = (value: number | null | undefined): number | null => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
);

const formatOfParams = (params: HifiMpvAudioParams, dsdRate: number | null = null): HifiSignalFormat => ({
    sampleRate: positiveOrNull(params.samplerate),
    bitDepth: parseSampleFormat(params.format).width,
    sampleFormat: params.format,
    channels: positiveOrNull(params.channelCount),
    dsdRate,
});

const stageStatus = (conversions: HifiSignalConversion[]): HifiSignalStageStatus => (
    conversions.some(conversion => conversion !== 'dop') ? 'converted' : 'passthrough'
);

const isDsdSource = (spec: HifiSourceSpec | null, state: SignalPathEngineState) => (
    Boolean(spec?.isDsd) || /^dsd/i.test(state.track?.codec ?? '')
);

/** 位速率：源格式里有就用；否则 mpv 的 demux-samplerate 是按字节计的（DSD64 为 352800），乘 8。 */
const dsdRateOf = (spec: HifiSourceSpec | null, state: SignalPathEngineState): number | null => {
    const fromSpec = positiveOrNull(spec?.dsdRate);
    if (fromSpec !== null) return fromSpec;
    const demuxRate = positiveOrNull(state.track?.demuxSamplerate);
    return demuxRate === null ? null : demuxRate * 8;
};

/**
 * DSD 以 DoP 送出：输出格式名本身带 dsd/dop/spdif；或者 audio-spdif=dsd 时，mpv 把 DSD 打进 24/32 位整数 PCM，
 * 采样率是位速率的 1/16（DSD64 → 176400）。
 * 只看整数输出会误认：解码端出浮点（floatp）说明 DSD 已经被转成了 PCM；DoP 帧也不会再被重采样，
 * 所以还要求解码端和输出端的采样率相同。
 */
const isDopOutput = (
    input: HifiMpvAudioParams | null,
    out: HifiMpvAudioParams,
    spdif: string | null,
    dsdRate: number | null,
) => {
    if (/dsd|dop|spdif/i.test(out.format)) return true;
    if (spdif !== 'dsd') return false;
    if (!input || parseSampleFormat(input.format).kind === 'float') return false;
    if (input.samplerate !== out.samplerate) return false;
    const format = parseSampleFormat(out.format);
    if (format.kind !== 'int' || format.width === null || format.width < 24) return false;
    return dsdRate === null ? DOP_SAMPLE_RATES.has(out.samplerate) : out.samplerate * 16 === dsdRate;
};

/**
 * 整数格式只是在低位补零（s16→s24/s32、s24→s32）不改变任何一个采样值，算直通。
 * 输入的有效位宽取源文件的位深：24 位 FLAC 被 mpv 解成 s32，送出 s24 也没丢东西。
 */
const isLosslessFormatChange = (input: HifiMpvAudioParams, out: HifiMpvAudioParams, spec: HifiSourceSpec | null) => {
    const from = parseSampleFormat(input.format);
    const to = parseSampleFormat(out.format);
    if (from.base === to.base) return true;
    if (from.kind !== 'int' || to.kind !== 'int' || from.width === null || to.width === null) return false;
    const sourceBits = spec && !spec.isDsd ? positiveOrNull(spec.bitDepth) : null;
    const effectiveWidth = sourceBits !== null && sourceBits <= from.width ? sourceBits : from.width;
    return to.width >= effectiveWidth;
};

/**
 * 32 位浮点转 s32：float32 只有 24 位有效数字，±1.0 以内乘 2³¹ 都落在整数上，数值不变；超过 0 dBFS 的截顶，
 * 低于约 -186 dBFS 的舍入。很多 USB DAC 独占时只收整数 PCM，mpv 只能这样转。转 s24 / s16 会丢精度，不算这一种。
 */
const isFloatToS32 = (input: HifiMpvAudioParams, out: HifiMpvAudioParams) => (
    parseSampleFormat(input.format).base === 'float' && parseSampleFormat(out.format).base === 's32'
);

/** 浮点格式能原样装下的整数位数：float32 的尾数连隐含位 24 位，double 53 位。 */
const FLOAT_EXACT_BITS: Record<number, number> = { 32: 24, 64: 53 };

/**
 * 转成浮点而每个采样的数值不变：整数（源的有效位数不超过浮点的尾数，16 / 24 bit 转 float、32 bit 转 double）
 * 除以 2 的幂、float 转 double，都落在浮点上，不舍入。数据格式变了，仍不算比特完美。
 */
const isExactToFloat = (input: HifiMpvAudioParams, out: HifiMpvAudioParams, spec: HifiSourceSpec | null) => {
    const from = parseSampleFormat(input.format);
    const to = parseSampleFormat(out.format);
    const exactBits = to.kind === 'float' && to.width !== null ? FLOAT_EXACT_BITS[to.width] : undefined;
    if (exactBits === undefined || from.width === null) return false;
    if (from.kind === 'float') return to.width! > from.width;
    if (from.kind !== 'int') return false;
    const sourceBits = spec && !spec.isDsd ? positiveOrNull(spec.bitDepth) : null;
    const effectiveWidth = sourceBits !== null && sourceBits <= from.width ? sourceBits : from.width;
    return effectiveWidth <= exactBits;
};

/** 认 --audio-exclusive 的驱动：开了独占就绕过系统混音器。Core Audio 开独占时 mpv 会改用 coreaudio_exclusive。 */
const EXCLUSIVE_CAPABLE_DRIVERS = new Set(['wasapi', 'coreaudio']);

/**
 * 输出会不会经过系统混音器。Linux 上只有 ALSA 的 hw: 直连不经过：PulseAudio、PipeWire、JACK 不管独占与否都混音
 * （mpv 的 pipewire 输出没有独占，--audio-exclusive 对它不起作用，PipeWire 照样重采样到自己的工作采样率再混音）。
 * 只有 WASAPI 和 Core Audio 看是否独占；别的有名字的驱动都算经过混音器；驱动还没回报时先按是否独占推断。
 */
const isSharedOutput = (ao: string | null, device: string | null, exclusive: boolean) => {
    const driver = (ao ?? '').trim().toLowerCase();
    if (driver === 'alsa') return !/^(alsa\/)?hw:/i.test(device ?? '');
    if (driver === 'coreaudio_exclusive') return false;
    if (!driver || EXCLUSIVE_CAPABLE_DRIVERS.has(driver)) return !exclusive;
    return true;
};

/**
 * mpv 的 volume 按三次方曲线换成增益，下发的是应用音量的立方根乘 100（selectHifiEngineConfig）：应用 50% 时 mpv 是 79.37。
 * 链路上显示的是听的人调的应用音量，即 (v/100)³·100，取整。
 */
const appVolumePercent = (mpvVolume: number) => Math.round(((mpvVolume / 100) ** 3) * 100);

const outputDetail = (ao: string | null, device: string | null): string | null => {
    if (!ao) return device;
    if (!device || device === 'auto') return ao;
    return device.startsWith(`${ao}/`) ? device : `${ao} ${device}`;
};

/**
 * 按 source → transport → decode → process → output 五级给出每一级的格式和改动，并给出整体结论。
 * probe 是 Linux 上 PipeWire 的探测结果：mpv 走 pipewire / pulse 输出、探测找到了设备（或链路停在虚拟设备上）时，
 * output 之后再加一级 system，结论按 PipeWire 报的设备采样率判采样率直通（rate-passthrough）或经过系统混音器；
 * 停在虚拟设备上时不知道设备的采样率，判经过系统混音器。没有 probe、或者 probe 读的是 mpv 换格式之前的流时和以前完全一样。
 */
export const buildSignalPath = (
    sourceSpec: HifiSourceSpec | null,
    mpvState: SignalPathEngineState | null,
    settings: SignalPathSettings,
    probe: HifiOutputProbe | null = null,
): HifiSignalPath => {
    const sourceStage: HifiSignalStage = {
        id: 'source',
        status: sourceSpec ? 'passthrough' : 'unknown',
        conversions: [],
        format: sourceSpec
            ? {
                sampleRate: sourceSpec.sampleRate,
                bitDepth: sourceSpec.bitDepth,
                sampleFormat: sourceSpec.codec,
                channels: sourceSpec.channels,
                dsdRate: sourceSpec.dsdRate,
            }
            : null,
        detail: sourceSpec?.codec ?? sourceSpec?.container ?? null,
    };

    if (!mpvState) {
        return {
            verdict: 'unknown',
            stages: [
                sourceStage,
                { id: 'transport', status: 'unknown', conversions: [], format: null, detail: null },
                { id: 'decode', status: 'unknown', conversions: [], format: null, detail: null },
                { id: 'process', status: 'unknown', conversions: [], format: null, detail: null },
                { id: 'output', status: 'unknown', conversions: [], format: null, detail: null },
            ],
            conversions: [],
            output: { ao: null, device: null, exclusive: settings.exclusive },
            system: null,
        };
    }

    const input = mpvState.audioParams;
    const out = mpvState.audioOutParams;
    const dsd = isDsdSource(sourceSpec, mpvState);
    const dsdRate = dsd ? dsdRateOf(sourceSpec, mpvState) : null;
    // audio-spdif 还没回报时按设置推断。
    const spdif = mpvState.spdif ?? (settings.dsdMode === 'dop' ? 'dsd' : null);
    const dop = dsd && out !== null && isDopOutput(input, out, spdif, dsdRate);

    const transportStage: HifiSignalStage = {
        id: 'transport',
        status: mpvState.sourceKind ? 'passthrough' : 'unknown',
        conversions: [],
        format: null,
        detail: mpvState.sourceKind === 'navidrome' ? 'format=raw' : null,
    };

    const decodeConversions: HifiSignalConversion[] = dsd && !dop && input ? ['dsd-to-pcm'] : [];
    const decodeStage: HifiSignalStage = {
        id: 'decode',
        status: input ? stageStatus(decodeConversions) : 'unknown',
        conversions: decodeConversions,
        format: input ? formatOfParams(input, dop ? dsdRate : null) : null,
        detail: mpvState.track?.decoder ?? mpvState.track?.codec ?? null,
    };

    // DoP 是透传码流，mpv 不对它做软件音量；别的情况下 mpv 音量不是 100 也一样改了采样值。
    const volumeApplied = !dop && (settings.softwareVolume || (Number.isFinite(mpvState.volume) && mpvState.volume !== 100));
    const processConversions: HifiSignalConversion[] = volumeApplied ? ['volume'] : [];
    const processStage: HifiSignalStage = {
        id: 'process',
        status: volumeApplied ? 'converted' : 'bypassed',
        conversions: processConversions,
        format: null,
        detail: volumeApplied ? `${appVolumePercent(mpvState.volume)}%` : null,
    };

    const outputConversions: HifiSignalConversion[] = [];
    const shared = out !== null && isSharedOutput(mpvState.currentAo, mpvState.audioDevice, mpvState.exclusive);
    if (out && dop) {
        outputConversions.push('dop');
    } else if (out && input) {
        if (input.samplerate !== out.samplerate) outputConversions.push('resample');
        if (input.channelCount !== out.channelCount) outputConversions.push('channels');
        if (!isLosslessFormatChange(input, out, sourceSpec)) {
            outputConversions.push(isFloatToS32(input, out) ? 'float-to-int' : isExactToFloat(input, out, sourceSpec) ? 'to-float' : 'format');
        }
    }
    // 有 PipeWire 的探测时，「可能被系统混音器改动」换成 system 一级里 PipeWire 报的实情。
    const system = out && input && !dop && probe && isPipewireOutputDriver(mpvState.currentAo)
        ? buildSystemFindings(out, probe)
        : null;
    if (shared && !dop && !system) outputConversions.push('shared-mixer');
    const outputStage: HifiSignalStage = {
        id: 'output',
        status: out && (input || dop) ? stageStatus(outputConversions) : 'unknown',
        conversions: outputConversions,
        format: out ? formatOfParams(out, dop ? dsdRate : null) : null,
        detail: outputDetail(mpvState.currentAo, mpvState.audioDevice),
    };

    const mpvConversions = [...decodeConversions, ...processConversions, ...outputConversions];
    const conversions = [...mpvConversions, ...(system?.stage.conversions ?? [])];
    const resolveVerdict = (): HifiSignalVerdict => {
        // 没有实际输出格式，或者没有解码格式可比，就判断不了。
        if (!out || (!input && !dop)) return 'unknown';
        if (dop) return 'dop';
        if (mpvConversions.some(conversion => conversion !== 'shared-mixer')) return 'converted';
        // PipeWire 报的设备采样率和 mpv 交出的一样：只说采样率没被 PipeWire 换掉。滤波链、音量、别的流只作提醒，不改结论
        // （徽标在它们没过时不用强调色，见 signalPathTone）。
        if (system) return system.ratePasses ? 'rate-passthrough' : 'shared-mixer';
        if (shared) return 'shared-mixer';
        return 'bit-perfect';
    };

    const stages = [sourceStage, transportStage, decodeStage, processStage, outputStage];
    if (system) stages.push({ ...system.stage, status: stageStatus(system.stage.conversions) });

    return {
        verdict: resolveVerdict(),
        stages,
        conversions,
        output: { ao: mpvState.currentAo, device: mpvState.audioDevice, exclusive: mpvState.exclusive },
        system: system?.report ?? null,
    };
};
