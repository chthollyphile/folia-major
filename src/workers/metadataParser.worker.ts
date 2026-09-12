import { parseBlob } from 'music-metadata';

interface ParsedLyricLine {
    text?: string;
    timestamp?: number;
}

interface ParsedLyricTag {
    id?: string;
    value?: unknown;
    text?: string;
    language?: string;
    descriptor?: string;
    syncText?: ParsedLyricLine[];
    timeStampFormat?: number;
}

interface LyricCandidate {
    text: string;
    isTranslation: boolean;
    hasTimeline: boolean;
}

interface EmbeddedMetadataResult {
    title?: string;
    artist?: string;
    artists?: string[];
    album?: string;
    trackNumber?: number;
    discNumber?: number;
    isrc?: string;
    cover?: Blob;
    coverAssetId?: string;
    bitrate?: number;
    lyrics?: string;
    translationLyrics?: string;
    replayGain?: number;
    replayGainTrackGain?: number;
    replayGainTrackPeak?: number;
    replayGainAlbumGain?: number;
    replayGainAlbumPeak?: number;
    duration?: number;
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes)
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');

async function hashCoverBytes(bytes: BufferSource): Promise<string | undefined> {
    if (!crypto?.subtle) return undefined;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return `sha256:${toHex(new Uint8Array(digest))}`;
}

function formatLrcTimestamp(timestampMs: number): string {
    const safeTimestamp = Math.max(0, Math.floor(timestampMs));
    const minutes = Math.floor(safeTimestamp / 60000);
    const seconds = Math.floor((safeTimestamp % 60000) / 1000);
    const centiseconds = Math.floor((safeTimestamp % 1000) / 10);
    return `[${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}]`;
}

function syncTextToLrc(syncText: ParsedLyricLine[] | undefined, timeStampFormat?: number): string | undefined {
    if (!syncText || syncText.length === 0) {
        return undefined;
    }

    if (timeStampFormat && timeStampFormat !== 2) {
        return undefined;
    }

    const lines = syncText
        .filter(line => typeof line?.timestamp === 'number' && typeof line?.text === 'string' && line.text.trim())
        .map(line => `${formatLrcTimestamp(line.timestamp!)}${line.text!.trim()}`);

    return lines.length > 0 ? `${lines.join('\n')}\n` : undefined;
}

function hasTimelineMarkers(text: string): boolean {
    return /\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(text);
}

function normalizeLyricCandidateText(text: string): string {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

function hasEnhancedWordTimeline(text: string): boolean {
    return /<\d{2}:\d{2}[.:]\d{2,3}>/.test(text)
        || /(?:^|\n)\s*\[\d{2}:\d{2}[.:]\d{2,3}\][^\[\]\n]+(?:\[\d{2}:\d{2}[.:]\d{2,3}\][^\[\]\n]*)+/m.test(text);
}

function chooseBestLyricCandidate(candidates: LyricCandidate[]): LyricCandidate | undefined {
    if (candidates.length === 0) {
        return undefined;
    }

    return candidates.find(candidate => hasEnhancedWordTimeline(candidate.text)) || candidates[0];
}

function isTranslationLyricTag(tag: ParsedLyricTag): boolean {
    const language = tag.language?.toLowerCase();
    const descriptor = tag.descriptor?.toLowerCase() || '';
    const id = tag.id?.toLowerCase() || '';

    return language === 'chi' ||
        language === 'zho' ||
        descriptor.includes('translation') ||
        descriptor.includes('trans') ||
        descriptor.includes('译') ||
        id.includes('translation') ||
        id.includes('trans');
}

function extractLyricText(tag: ParsedLyricTag): { text?: string; hasTimeline: boolean } {
    const directSyncText = syncTextToLrc(tag.syncText, tag.timeStampFormat);
    if (directSyncText) {
        return { text: directSyncText, hasTimeline: true };
    }

    const value = tag.value as ParsedLyricTag | string | undefined;
    if (typeof value === 'string' && value.trim()) {
        return { text: value, hasTimeline: hasTimelineMarkers(value) };
    }

    if (value && typeof value === 'object') {
        const nestedSyncText = syncTextToLrc((value as ParsedLyricTag).syncText, (value as ParsedLyricTag).timeStampFormat);
        if (nestedSyncText) {
            return { text: nestedSyncText, hasTimeline: true };
        }

        if (typeof (value as ParsedLyricTag).text === 'string' && (value as ParsedLyricTag).text!.trim()) {
            return { text: (value as ParsedLyricTag).text, hasTimeline: hasTimelineMarkers((value as ParsedLyricTag).text!) };
        }
    }

    if (typeof tag.text === 'string' && tag.text.trim()) {
        return { text: tag.text, hasTimeline: hasTimelineMarkers(tag.text) };
    }

    return { text: undefined, hasTimeline: false };
}

function getDurationFromParsedMetadata(durationSeconds?: number): number {
    if (typeof durationSeconds !== 'number' || !isFinite(durationSeconds) || durationSeconds <= 0) {
        return 0;
    }

    return Math.round(durationSeconds * 1000);
}

async function extractEmbeddedMetadata(file: File, includeCover = false): Promise<EmbeddedMetadataResult> {
    const parsed = await parseBlob(file, includeCover ? undefined : { skipCovers: true });

    let originalLyric: string | undefined;
    let translationLyric: string | undefined;

    const collectLyricCandidates = (tags: ParsedLyricTag[]): LyricCandidate[] => {
        const lyricCandidates: LyricCandidate[] = [];

        const addLyricCandidate = (tag: ParsedLyricTag) => {
            const { text, hasTimeline } = extractLyricText(tag);
            if (typeof text === 'string' && text.trim()) {
                const normalizedText = normalizeLyricCandidateText(text);
                if (lyricCandidates.some(c => c.text === normalizedText)) return;
                lyricCandidates.push({
                    text: normalizedText,
                    isTranslation: isTranslationLyricTag(tag),
                    hasTimeline
                });
            }
        };

        tags.forEach(tag => addLyricCandidate(tag));
        return lyricCandidates;
    };

    const commonCandidates = collectLyricCandidates((parsed.common.lyrics || []) as ParsedLyricTag[]);

    let lyricCandidates = commonCandidates;
    if (lyricCandidates.length === 0) {
        const nativeLyricTags: ParsedLyricTag[] = [];
        for (const tags of Object.values(parsed.native || {})) {
            (tags as ParsedLyricTag[]).forEach(tag => {
                const id = tag.id?.toLowerCase() || '';
                if (id.includes('lyric') || id.includes('uslt') || id.includes('sylt')) {
                    nativeLyricTags.push(tag);
                }
            });
        }
        lyricCandidates = collectLyricCandidates(nativeLyricTags);
    }

    if (lyricCandidates.length > 0) {
        const withTimeline = lyricCandidates.filter(c => c.hasTimeline);
        const source = withTimeline.length > 0 ? withTimeline : lyricCandidates;
        const translationCandidates = source.filter(c => c.isTranslation);
        const originalCandidates = source.filter(c => !c.isTranslation);

        const bestOriginal = chooseBestLyricCandidate(originalCandidates) || chooseBestLyricCandidate(source);
        const bestTranslation = chooseBestLyricCandidate(
            translationCandidates.filter(candidate => candidate.text !== bestOriginal?.text)
        );

        originalLyric = bestOriginal?.text;
        translationLyric = bestTranslation?.text;
    }

    const replayGainTrackTag = parsed.common.replaygain_track_gain;
    const replayGainTrackPeakTag = parsed.common.replaygain_track_peak;
    const replayGainAlbumTag = parsed.common.replaygain_album_gain;
    const replayGainAlbumPeakTag = parsed.common.replaygain_album_peak;

    const replayGainTrackDb = typeof replayGainTrackTag?.dB === 'number'
        ? replayGainTrackTag.dB
        : parsed.format.trackGain;
    const replayGainTrackPeak = typeof replayGainTrackPeakTag?.ratio === 'number'
        ? replayGainTrackPeakTag.ratio
        : parsed.format.trackPeakLevel;
    const replayGainAlbumDb = typeof replayGainAlbumTag?.dB === 'number'
        ? replayGainAlbumTag.dB
        : parsed.format.albumGain;
    const replayGainAlbumPeak = typeof replayGainAlbumPeakTag?.ratio === 'number'
        ? replayGainAlbumPeakTag.ratio
        : undefined;

    const picture = includeCover ? parsed.common.picture?.[0] : undefined;
    const cover = picture
        ? new Blob([picture.data as any], { type: picture.format })
        : undefined;
    const coverAssetId = picture ? await hashCoverBytes(Uint8Array.from(picture.data)) : undefined;

    return {
        title: parsed.common.title,
        artist: parsed.common.artist,
        artists: parsed.common.artists,
        album: parsed.common.album,
        trackNumber: parsed.common.track.no ?? undefined,
        isrc: parsed.common.isrc?.[0],
        discNumber: parsed.common.disk.no ?? undefined,
        cover,
        coverAssetId,
        bitrate: parsed.format.bitrate,
        lyrics: originalLyric,
        translationLyrics: translationLyric,
        replayGain: replayGainTrackDb,
        replayGainTrackGain: replayGainTrackDb,
        replayGainTrackPeak,
        replayGainAlbumGain: replayGainAlbumDb,
        replayGainAlbumPeak,
        duration: getDurationFromParsedMetadata(parsed.format.duration)
    };
}

self.onmessage = async (e: MessageEvent) => {
    const { type, file, cover, includeCover, requestId } = e.data as {
        type: string;
        file?: File;
        cover?: Blob;
        includeCover?: boolean;
        requestId: string;
    };

    if (type !== 'parse-metadata' && type !== 'hash-cover') {
        self.postMessage({ type: 'error', message: 'Unknown message type', requestId });
        return;
    }

    try {
        if (type === 'hash-cover') {
            if (!(cover instanceof Blob) || cover.size === 0 || !cover.type.startsWith('image/')) {
                throw new Error('Invalid local cover payload');
            }
            const coverAssetId = await hashCoverBytes(await cover.arrayBuffer());
            if (!coverAssetId) throw new Error('Web Crypto SHA-256 is unavailable');
            self.postMessage({ type: 'result', data: { cover, coverAssetId }, requestId });
            return;
        }

        if (!(file instanceof File)) throw new Error('Missing metadata file');
        const data = await extractEmbeddedMetadata(file, Boolean(includeCover));
        self.postMessage({ type: 'result', data, requestId });
    } catch (err) {
        self.postMessage({ type: 'error', message: String(err), requestId });
    }
};
