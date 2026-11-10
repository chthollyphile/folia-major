import type { TFunction } from 'i18next';
import type {
    HifiSignalConversion,
    HifiSignalFormat,
    HifiSignalPath,
    HifiSignalStage,
    HifiSignalStageId,
    HifiSignalStageStatus,
    HifiSignalVerdict,
    HifiSystemCheck,
    HifiSystemCheckId,
} from '../../types/hifi';
import { isSystemDeviceUnknown } from '../../services/hifi/signalPathSystem';

// src/components/hifi/hifiSignalText.ts
// 信号链路的文字：徽标上那一行、面板里每一级的格式和改动。PipeWire 那一级的逐项检查和「为什么没切采样率」在 hifiSystemText.ts。
// 数字按界面语言写，单位和措辞都走 i18n（hifi.signal.* / hifi.player.*）。

/**
 * accent：采样原样到达 DAC（逐位直通或 DoP），或者 PipeWire 报告它没换采样率（采样率直通，图标和逐位直通不同；
 * 徽标在 PipeWire 那一级有一项没过时改用 muted，见 signalPathTone）；muted：别的情况。
 */
export type HifiVerdictTone = 'accent' | 'muted';

const VERDICT_KEY: Record<HifiSignalVerdict, string> = {
    'bit-perfect': 'bitPerfect',
    dop: 'dop',
    'rate-passthrough': 'ratePassthrough',
    converted: 'converted',
    'shared-mixer': 'sharedMixer',
    unknown: 'unknown',
};

const STAGE_KEY: Record<HifiSignalStageId, string> = {
    source: 'source',
    transport: 'transport',
    decode: 'decode',
    process: 'process',
    output: 'output',
    system: 'system',
};

const STATUS_KEY: Record<HifiSignalStageStatus, string> = {
    passthrough: 'passthrough',
    converted: 'converted',
    bypassed: 'bypassed',
    unknown: 'unknown',
};

const FLOAT_FORMAT = /^(float|double)p?$/i;
/** PipeWire 的浮点格式名：F32LE、F32P、F64… */
const PIPEWIRE_FLOAT_FORMAT = /^F(32|64)(LE|BE|P)?$/i;

/** 只换了采样格式、每个采样的数值不变的改动。 */
const VALUE_PRESERVING_CONVERSIONS: ReadonlySet<HifiSignalConversion> = new Set<HifiSignalConversion>(['float-to-int', 'to-float']);

/** mpv 一路（PipeWire 那一级之外）有改动，而且每一项都合 test。 */
const onlyMpvConversions = (path: HifiSignalPath, test: (conversion: HifiSignalConversion) => boolean) => {
    const conversions = path.stages.filter(stage => stage.id !== 'system').flatMap(stage => stage.conversions);
    return conversions.length > 0 && conversions.every(test);
};

/**
 * 「途中经过转换」里只有数值不变的格式转换：mpv 一路的改动都是 float 转 s32 或转成浮点，PipeWire 那一级（有的话）也没改动。
 * 结论仍是已转换（格式和文件不同，不算比特完美），但徽标和面板顶上用提示图标，不用警告图标。
 */
export const isValuePreservingPath = (path: HifiSignalPath) => {
    if (path.verdict !== 'converted') return false;
    const systemConversions = path.stages.find(stage => stage.id === 'system')?.conversions ?? [];
    return onlyMpvConversions(path, conversion => VALUE_PRESERVING_CONVERSIONS.has(conversion)) && systemConversions.length === 0;
};

export const verdictTone = (verdict: HifiSignalVerdict): HifiVerdictTone => (
    verdict === 'bit-perfect' || verdict === 'dop' || verdict === 'rate-passthrough' ? 'accent' : 'muted'
);

/**
 * 徽标的颜色：按结论（verdictTone）；只有数值不变的格式转换时和采样率直通一样用强调色（isValuePreservingPath）。
 * 这两种情况下 PipeWire 那一级还有一项没过（滤波器、音量、别的流、声道），就不用强调色：声音照样可能被 PipeWire 改了。
 */
export const signalPathTone = (path: HifiSignalPath): HifiVerdictTone => {
    const valuePreserving = isValuePreservingPath(path);
    if ((path.verdict === 'rate-passthrough' || valuePreserving) && path.system?.checks.some(check => !check.ok)) return 'muted';
    return valuePreserving ? 'accent' : verdictTone(path.verdict);
};

/** 徽标和格子用的短说法：原生直通、原生 DSD、已转换… */
export const verdictLabel = (verdict: HifiSignalVerdict, t: TFunction) => t(`hifi.signal.verdictShort.${VERDICT_KEY[verdict]}`);

/** 面板顶上那行大字。 */
export const verdictTitle = (verdict: HifiSignalVerdict, t: TFunction) => t(`hifi.signal.verdict.${VERDICT_KEY[verdict]}`);

/**
 * 大字下面那句说明。经过系统混音器时按平台给出办法：Linux 上独占开关不起作用，只有选标着“直连”的 ALSA hw: 设备才绕过
 * PipeWire / PulseAudio；Windows、macOS 上独占没开就让它打开，开着还在混音说明这个输出设备不认独占，得换一个。
 * platform 是 window.electron.platform（'win32'、'darwin'、'linux'），不知道时为 null。
 */
export const verdictDescription = (path: HifiSignalPath, t: TFunction, platform: string | null = null) => {
    if (path.verdict === 'shared-mixer') {
        // 链路停在虚拟设备（EasyEffects 这类）上：PipeWire 报不出最后接到哪块声卡，不说它重采样了。
        if (isSystemDeviceUnknown(path.system)) return t('hifi.signal.verdictDesc.sharedMixerVirtual');
        // 有 PipeWire 的探测时知道得更多：是 PipeWire 把这首重采样了，原因写在 PipeWire 那一级。
        // PipeWire 没报设备的采样率：不推断它重采样了。
        if (path.system && path.system.deviceRate === null) return t('hifi.signal.verdictDesc.sharedMixerUnknownRate');
        if (path.system) return t('hifi.signal.verdictDesc.sharedMixerPipewire');
        if (platform === 'linux') return t('hifi.signal.verdictDesc.sharedMixerLinux');
        if (path.output.exclusive) return t('hifi.signal.verdictDesc.sharedMixerExclusiveOn');
    }
    // mpv 一路只把 32 位浮点转成了 s32，或只是转成了浮点：仍是「已转换」，但说清楚数值没变。PipeWire 那一级的改动另由那一级说。
    if (path.verdict === 'converted') {
        if (onlyMpvConversions(path, conversion => conversion === 'float-to-int')) return t('hifi.signal.verdictDesc.convertedFloatToInt');
        if (onlyMpvConversions(path, conversion => conversion === 'to-float')) return t('hifi.signal.verdictDesc.convertedToFloat');
    }
    return t(`hifi.signal.verdictDesc.${VERDICT_KEY[path.verdict]}`);
};

export const stageLabel = (id: HifiSignalStageId, t: TFunction) => t(`hifi.signal.stage.${STAGE_KEY[id]}`);

export const stageStatusLabel = (status: HifiSignalStageStatus, t: TFunction) => t(`hifi.signal.status.${STATUS_KEY[status]}`);

const usableNumber = (value: number | null | undefined): value is number => (
    typeof value === 'number' && Number.isFinite(value) && value > 0
);

/** 按界面语言写数字（印尼语用逗号作小数点）；语言代码 Intl 不认时退回英文写法。 */
const formatNumber = (value: number, locale: string, maximumFractionDigits = 3) => {
    const options = { maximumFractionDigits, useGrouping: false };
    try {
        return new Intl.NumberFormat(locale || 'en', options).format(value);
    } catch {
        return new Intl.NumberFormat('en', options).format(value);
    }
};

/** 96000 → '96 kHz'，44100 → '44.1 kHz'。 */
export const formatSampleRate = (hz: number | null | undefined, t: TFunction, locale: string): string | null => (
    usableNumber(hz) ? t('hifi.signal.sampleRate', { value: formatNumber(hz / 1000, locale) }) : null
);

/** 位速率 → DSD64 / DSD128…（44.1k 和 48k 两族都按倍数叫）；不是整倍数时写成 MHz。 */
export const formatDsdRate = (rate: number | null | undefined, t: TFunction, locale: string): string | null => {
    if (!usableNumber(rate)) return null;
    if (rate % 44100 === 0) return t('hifi.signal.dsdRate', { multiple: rate / 44100 });
    if (rate % 48000 === 0) return t('hifi.signal.dsdRate', { multiple: rate / 48000 });
    return t('hifi.signal.dsdRateMhz', { value: formatNumber(rate / 1_000_000, locale) });
};

export const formatBitDepth = (bits: number | null | undefined, t: TFunction): string | null => (
    usableNumber(bits) ? t('hifi.signal.bitDepth', { bits }) : null
);

/** mpv 的采样格式写成位宽：s32 → '32 bit'，floatp → '32 bit float'；认不出的格式名原样给出。 */
export const formatSampleDepth = (format: HifiSignalFormat | null, t: TFunction): string | null => {
    if (!format) return null;
    const name = format.sampleFormat?.trim() ?? '';
    if (FLOAT_FORMAT.test(name)) {
        const bits = usableNumber(format.bitDepth) ? format.bitDepth : /^double/i.test(name) ? 64 : 32;
        return t('hifi.signal.floatDepth', { bits });
    }
    const pipewireFloat = PIPEWIRE_FLOAT_FORMAT.exec(name);
    if (pipewireFloat) return t('hifi.signal.floatDepth', { bits: Number(pipewireFloat[1]) });
    return formatBitDepth(format.bitDepth, t) ?? (name || null);
};

export const formatChannels = (count: number | null | undefined, t: TFunction): string | null => {
    if (!usableNumber(count)) return null;
    if (count === 1) return t('hifi.signal.channelsMono');
    if (count === 2) return t('hifi.signal.channelsStereo');
    return t('hifi.signal.channelsCount', { count });
};

/**
 * 一级的格式写成一行，如 '96 kHz · 24 bit · Stereo'。源文件这一级的位深来自文件本身（sampleFormat 是编码名），
 * DSD 源只写 DSD64；解码和输出两级按 mpv 的采样格式写位宽，DoP 时在前面加上 DSD 速率。
 */
export const formatStageFormat = (stage: HifiSignalStage, t: TFunction, locale: string): string | null => {
    const format = stage.format;
    if (!format) return null;
    const dsd = formatDsdRate(format.dsdRate, t, locale);
    const parts: (string | null)[] = stage.id === 'source'
        ? (dsd ? [dsd] : [formatSampleRate(format.sampleRate, t, locale), formatBitDepth(format.bitDepth, t)])
        : [dsd, formatSampleRate(format.sampleRate, t, locale), formatSampleDepth(format, t)];
    parts.push(formatChannels(format.channels, t));
    const text = parts.filter((part): part is string => Boolean(part)).join(' · ');
    return text || null;
};

const findStage = (path: HifiSignalPath, id: HifiSignalStageId) => path.stages.find(stage => stage.id === id) ?? null;

/**
 * 徽标里的格式：采样率取输出级。位深只在 mpv 改过数据（已转换）时取输出级的采样格式，那是 DAC 实际收到的；
 * 别的情况取源文件的位深，源文件的还不知道（没读完、读不出、服务器没给）就不写——mpv 解码用的容器位宽不是文件的位深，
 * 24 位 FLAC 会被解成 s32，写出来就成了“32 bit”。DoP 写 DSD64。什么都不知道时为 null。
 */
export const formatBadgeFormat = (path: HifiSignalPath, t: TFunction, locale: string): string | null => {
    const source = findStage(path, 'source')?.format ?? null;
    const output = findStage(path, 'output')?.format ?? null;
    if (path.verdict === 'dop') {
        const dsd = formatDsdRate(output?.dsdRate ?? source?.dsdRate, t, locale);
        if (dsd) return dsd;
    }
    if (!output) return null;
    const rate = formatSampleRate(output.sampleRate, t, locale);
    const sourceBits = source && !usableNumber(source.dsdRate) && usableNumber(source.bitDepth) && source.bitDepth > 1
        ? formatBitDepth(source.bitDepth, t)
        : null;
    const depth = path.verdict === 'converted' ? formatSampleDepth(output, t) : sourceBits;
    const text = [rate, depth].filter((part): part is string => Boolean(part)).join(' / ');
    return text || null;
};

export type HifiBadgeText = {
    /** 地方够时的全称：'HiFi · 原生直通 · 96 kHz / 24 bit'。 */
    text: string;
    /** 放不下格式时的 'HiFi · 原生直通'。 */
    shortText: string;
    /** 最窄时的小牌子：只写 'HiFi'，结论交给旁边的图标和颜色。 */
    chipText: string;
};

/**
 * 徽标的三种长短。deferred：恢复出来、还没交给 mpv 载入的曲目，结论要等载入后才知道，三种都只写 'HiFi'。
 */
export const formatHifiBadge = (
    path: HifiSignalPath,
    t: TFunction,
    locale: string,
    options: { deferred?: boolean } = {},
): HifiBadgeText => {
    const chipText = t('hifi.player.badgeChip');
    if (options.deferred) {
        return { text: chipText, shortText: chipText, chipText };
    }
    const verdict = verdictLabel(path.verdict, t);
    const format = formatBadgeFormat(path, t, locale);
    const shortText = t('hifi.player.badge', { verdict });
    return {
        text: format ? t('hifi.player.badgeWithFormat', { verdict, format }) : shortText,
        shortText,
        chipText,
    };
};

const findCheck = (path: HifiSignalPath, id: HifiSystemCheckId): HifiSystemCheck | null => (
    path.system?.checks.find(check => check.id === id) ?? null
);

/**
 * 把一处改动说成人话；有前后两端的数值就带上，如「重采样：44.1 kHz → 48 kHz」。
 * stageId 是这处改动所在的那一级：PipeWire 那一级（system）的两端是 mpv 交出的格式和设备的格式，别的级是解码和输出。
 */
export const describeConversion = (
    conversion: HifiSignalConversion,
    path: HifiSignalPath,
    t: TFunction,
    locale: string,
    stageId: HifiSignalStageId | null = null,
): string => {
    const inSystem = stageId === 'system';
    const decoded = findStage(path, inSystem ? 'output' : 'decode')?.format ?? null;
    const output = findStage(path, inSystem ? 'system' : 'output')?.format ?? null;
    const between = (key: string, from: string | null, to: string | null) => (
        from && to ? t(`hifi.signal.conversion.${key}`, { from, to }) : t(`hifi.signal.conversion.${key}Plain`)
    );
    switch (conversion) {
        case 'resample':
            return between('resample', formatSampleRate(decoded?.sampleRate, t, locale), formatSampleRate(output?.sampleRate, t, locale));
        case 'format':
            return between('format', formatSampleDepth(decoded, t), formatSampleDepth(output, t));
        case 'float-to-int':
            return t('hifi.signal.conversion.floatToInt');
        case 'to-float':
            return between('toFloat', formatSampleDepth(decoded, t), formatSampleDepth(output, t));
        case 'channels':
            return between('channels', formatChannels(decoded?.channels, t), formatChannels(output?.channels, t));
        case 'dsd-to-pcm':
            return t('hifi.signal.conversion.dsdToPcm');
        case 'dop':
            return t('hifi.signal.conversion.dop');
        case 'volume': {
            if (inSystem) {
                // PipeWire 那一级：流上和设备上没过的软件音量（'87%'、'93%'）。
                const volume = (['streamVolume', 'deviceVolume'] as const)
                    .map(id => findCheck(path, id))
                    .filter((check): check is HifiSystemCheck => Boolean(check && !check.ok && check.detail))
                    .map(check => check.detail)
                    .join(', ');
                return volume ? t('hifi.signal.conversion.volumePipewire', { volume }) : t('hifi.signal.conversion.volumePipewirePlain');
            }
            const volume = findStage(path, 'process')?.detail ?? null;
            return volume ? t('hifi.signal.conversion.volume', { volume }) : t('hifi.signal.conversion.volumePlain');
        }
        case 'shared-mixer':
            return t('hifi.signal.conversion.sharedMixer');
        case 'filter': {
            const names = findCheck(path, 'filters')?.detail ?? null;
            return names ? t('hifi.signal.conversion.filter', { names }) : t('hifi.signal.conversion.filterPlain');
        }
    }
};

/**
 * DoP 打包原样送达，32 位浮点转 s32（只截超过 0 dBFS 的）和转成浮点时数值不变，用不警示的颜色；别的改动都改了数据或交给了系统混音器。
 */
export const isConversionLossless = (conversion: HifiSignalConversion) => (
    conversion === 'dop' || VALUE_PRESERVING_CONVERSIONS.has(conversion)
);

/**
 * 每一级格式之外的一句说明：传输看来源（本机曲库还是 Navidrome 原文件），处理级说绕过了什么，输出级说独占还是共享。
 * 没什么可说时为 null。platform 同 verdictDescription。
 */
export const describeStage = (
    stage: HifiSignalStage,
    path: HifiSignalPath,
    origin: 'local' | 'navidrome' | null,
    t: TFunction,
    platform: string | null = null,
): string | null => {
    if (stage.id === 'transport' && origin) {
        return t(origin === 'navidrome' ? 'hifi.signal.transportNavidrome' : 'hifi.signal.transportLocal');
    }
    if (stage.id === 'process' && stage.status === 'bypassed') return t('hifi.signal.processBypassed');
    if (stage.id === 'output' && stage.status !== 'unknown') {
        // 只看这一级实际有没有经过系统混音器，不看独占开关：PipeWire、PulseAudio 开着独占也照样混音，
        // ALSA 的 hw: 直连关着独占也不经过混音器。Linux 上没有独占这回事，不经过混音器就是直连了设备。
        // 有 PipeWire 那一级时，混音器的事写在那一级里，这一级不再标改动，但输出照样是共享的。
        if (stage.conversions.includes('shared-mixer') || path.system) return t('hifi.signal.outputShared');
        return t(platform === 'linux' ? 'hifi.signal.outputDirect' : 'hifi.signal.outputExclusive');
    }
    if (stage.id === 'system') return t('hifi.signal.systemReported');
    return null;
};
