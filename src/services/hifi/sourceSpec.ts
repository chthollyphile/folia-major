import { parseBlob } from 'music-metadata';
import type { HifiSourceSpec } from '../../types/hifi';
import { withMetadataParserTypeHint } from '../../utils/metadataParserTypeHint';

// src/services/hifi/sourceSpec.ts
// 信号路径的第一级：源文件本身是什么格式。本地文件读文件头（music-metadata），Navidrome 用 Subsonic 返回的字段。

/** 按后缀判断是否无损；m4a/mp4 里可能是 ALAC 也可能是 AAC，判不出来就不在表里（null）。 */
const LOSSLESS_BY_SUFFIX: Record<string, boolean> = {
    flac: true,
    alac: true,
    wav: true,
    wave: true,
    aif: true,
    aiff: true,
    ape: true,
    wv: true,
    tta: true,
    dsf: true,
    dff: true,
    mp3: false,
    mpeg: false,
    aac: false,
    ogg: false,
    oga: false,
    opus: false,
    wma: false,
    mpc: false,
};

/** 后缀能确定编码时给出编码名，写法尽量和 music-metadata 的 format.codec 一致。 */
const CODEC_BY_SUFFIX: Record<string, string> = {
    flac: 'FLAC',
    alac: 'ALAC',
    wav: 'PCM',
    wave: 'PCM',
    aif: 'PCM',
    aiff: 'PCM',
    ape: 'Monkey\'s Audio',
    wv: 'WavPack',
    tta: 'TTA',
    dsf: 'DSD',
    dff: 'DSD',
    mp3: 'MPEG 1 Layer 3',
    mpeg: 'MPEG 1 Layer 3',
    aac: 'AAC',
    opus: 'Opus',
};

const DSD_SUFFIXES = new Set(['dsf', 'dff']);
/** DSD64 的位速率；比它小一个数量级的值是 ffmpeg 那种按字节计的写法（DSD64 记作 352800）。 */
const DSD64_RATE = 2822400;

const emptySpec = (origin: HifiSourceSpec['origin']): HifiSourceSpec => ({
    origin,
    codec: null,
    container: null,
    bitDepth: null,
    sampleRate: null,
    channels: null,
    lossless: null,
    isDsd: false,
    dsdRate: null,
    bitrate: null,
});

const positiveOrNull = (value: unknown): number | null => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
);

const nonEmptyOrNull = (value: unknown): string | null => (
    typeof value === 'string' && value.trim() ? value.trim() : null
);

/** 把 DSD 的采样率统一成位速率：2822400 原样返回，352800 这种按字节计的乘 8。 */
const normalizeDsdRate = (rate: number | null): number | null => {
    if (rate === null) return null;
    if (rate >= DSD64_RATE / 2) return rate;
    if (rate * 8 >= DSD64_RATE / 2) return rate * 8;
    return null;
};

export const readLocalSourceSpec = async (file: Blob, fileName: string): Promise<HifiSourceSpec> => {
    try {
        const parsed = await parseBlob(withMetadataParserTypeHint(file, fileName), { skipCovers: true, duration: false });
        const { format } = parsed;
        const container = nonEmptyOrNull(format.container);
        const bitDepth = positiveOrNull(format.bitsPerSample);
        const sampleRate = positiveOrNull(format.sampleRate);
        // DSF 和未压缩的 DSDIFF 报 1 bit；DST 压缩的 DSDIFF 不报位深，只能看容器名。
        const isDsd = bitDepth === 1 || /^(DSF|DSDIFF)\b/i.test(container ?? '');
        const bitrate = positiveOrNull(format.bitrate);
        return {
            origin: 'local',
            codec: nonEmptyOrNull(format.codec) ?? (isDsd ? 'DSD' : null),
            container,
            bitDepth,
            sampleRate,
            channels: positiveOrNull(format.numberOfChannels),
            lossless: typeof format.lossless === 'boolean' ? format.lossless : null,
            isDsd,
            dsdRate: isDsd ? normalizeDsdRate(sampleRate) : null,
            bitrate: bitrate === null ? null : Math.round(bitrate),
        };
    } catch (error) {
        console.warn('[HiFi] source spec: could not read the format of', fileName, error);
        return emptySpec('local');
    }
};

export type NavidromeSourceFields = {
    suffix: string | null | undefined;
    contentType?: string | null;
    /** Subsonic 的 bitRate，单位 kbps。 */
    bitRate?: number | null;
    /** OpenSubsonic 扩展字段；有损格式常为 0。 */
    bitDepth?: number | null;
    samplingRate?: number | null;
    channelCount?: number | null;
};

/** 'audio/x-flac' → 'flac'；后缀缺失时才拿 contentType 顶上。 */
const formatKeyOf = (suffix: string | null | undefined, contentType: string | null | undefined): string | null => {
    const fromSuffix = nonEmptyOrNull(suffix)?.toLowerCase().replace(/^\./, '');
    if (fromSuffix) return fromSuffix;
    const subtype = nonEmptyOrNull(contentType)?.toLowerCase().split(';')[0].split('/')[1]?.trim();
    if (!subtype) return null;
    const key = subtype.replace(/^x-/, '');
    return key === 'dsd' ? 'dsf' : key;
};

export const navidromeSourceSpec = (fields: NavidromeSourceFields): HifiSourceSpec => {
    try {
        const key = formatKeyOf(fields.suffix, fields.contentType);
        const isDsd = key !== null && DSD_SUFFIXES.has(key);
        const sampleRate = positiveOrNull(fields.samplingRate);
        const bitRateKbps = positiveOrNull(fields.bitRate);
        return {
            origin: 'navidrome',
            codec: key === null ? null : CODEC_BY_SUFFIX[key] ?? null,
            container: key,
            bitDepth: positiveOrNull(fields.bitDepth) ?? (isDsd ? 1 : null),
            sampleRate,
            channels: positiveOrNull(fields.channelCount),
            lossless: key === null ? null : LOSSLESS_BY_SUFFIX[key] ?? null,
            isDsd,
            dsdRate: isDsd ? normalizeDsdRate(sampleRate) : null,
            bitrate: bitRateKbps === null ? null : Math.round(bitRateKbps * 1000),
        };
    } catch (error) {
        console.warn('[HiFi] source spec: could not read the Navidrome fields', error);
        return emptySpec('navidrome');
    }
};
