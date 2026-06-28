// Shared helpers keep the manual Stage API console and its tests aligned
// with the latest local-only HTTP contract.

export type StageLyricsFormat = 'lrc' | 'enhanced-lrc' | 'vtt' | 'ttml' | 'yrc' | 'qrc';

export type StageLyricsSourceType = 'embedded' | 'local' | 'navidrome' | 'netease';

export interface StageSessionRequestInput {
    baseUrl: string;
    token: string;
    title?: string;
    artist?: string;
    album?: string;
    coverUrl?: string;
    audioUrl?: string;
    lyricsText?: string;
    lyricsFormat?: StageLyricsFormat | '';
    audioFile?: File | null;
    lyricsFile?: File | null;
    coverFile?: File | null;
}

export interface StageLyricsRequestInput {
    baseUrl: string;
    token: string;
    title?: string;
    artist?: string;
    album?: string;
    lyricSourceJson: string;
}

export interface StageSearchRequestInput {
    baseUrl: string;
    token: string;
    query: string;
    limit?: number;
}

export interface StagePlayRequestInput {
    baseUrl: string;
    token: string;
    songId: number;
    appendToQueue?: boolean;
}

export interface StagePlayerControlRequestInput {
    baseUrl: string;
    token: string;
    action: 'next' | 'prev' | 'pause' | 'resume' | 'seek';
    positionMs?: number;
}

export interface StagePlayerQueueRequestInput {
    baseUrl: string;
    token: string;
    action: 'append' | 'insert-next' | 'remove' | 'move' | 'select' | 'clear';
    songId?: number;
    songIds?: number[];
    queueItemId?: string;
    fromQueueItemId?: string;
    fromIndex?: number;
    toIndex?: number;
    index?: number;
}

export interface StagePlayerQueueGetOptions {
    offset?: number;
    limit?: number;
    around?: 'current';
}

export interface StageRequestBuildResult {
    endpoint: string;
    init: RequestInit;
    transport: 'json' | 'multipart';
}

const normalizeText = (value?: string) => value?.trim() ?? '';

export const normalizeStageBaseUrl = (baseUrl: string) => {
    const normalized = normalizeText(baseUrl);
    return normalized.replace(/\/+$/, '');
};

export const isSupportedStageLyricsFormat = (format: string): format is StageLyricsFormat =>
    format === 'lrc' || format === 'enhanced-lrc' || format === 'vtt' || format === 'ttml' || format === 'yrc' || format === 'qrc';

const buildStageBearerHeaders = (token: string, extraHeaders?: Record<string, string>) => ({
    Authorization: `Bearer ${normalizeText(token)}`,
    ...(extraHeaders || {}),
});

const validateStageBaseAuth = (baseUrl: string, token: string): string | null => {
    if (!normalizeStageBaseUrl(baseUrl)) {
        return 'Stage address is required.';
    }

    if (!normalizeText(token)) {
        return 'Bearer token is required.';
    }

    return null;
};

export const validateStageSessionRequestInput = (input: StageSessionRequestInput): string | null => {
    const baseAuthError = validateStageBaseAuth(input.baseUrl, input.token);
    if (baseAuthError) {
        return baseAuthError;
    }

    const normalizedLyricsFormat = normalizeText(input.lyricsFormat);
    if (normalizedLyricsFormat && !isSupportedStageLyricsFormat(normalizedLyricsFormat)) {
        return 'Lyrics format must be lrc, enhanced-lrc, vtt, or yrc.';
    }

    const hasAudioUrl = Boolean(normalizeText(input.audioUrl));
    const hasAudioFile = Boolean(input.audioFile);
    if (!hasAudioUrl && !hasAudioFile) {
        return 'Provide either an audio URL or an audio file.';
    }
    if (hasAudioUrl && hasAudioFile) {
        return 'Choose either an audio URL or an audio file, not both.';
    }

    const hasLyricsText = Boolean(normalizeText(input.lyricsText));
    const hasLyricsFile = Boolean(input.lyricsFile);
    if (hasLyricsText && hasLyricsFile) {
        return 'Choose either lyrics text or a lyrics file, not both.';
    }

    return null;
};

export const validateStageLyricsRequestInput = (input: StageLyricsRequestInput): string | null => {
    const baseAuthError = validateStageBaseAuth(input.baseUrl, input.token);
    if (baseAuthError) {
        return baseAuthError;
    }

    const rawSource = normalizeText(input.lyricSourceJson);
    if (!rawSource) {
        return 'Lyric source JSON is required.';
    }

    try {
        const parsed = JSON.parse(rawSource) as { type?: string; };
        if (!parsed || typeof parsed !== 'object') {
            return 'Lyric source JSON must describe an object.';
        }
        if (!parsed.type || !['embedded', 'local', 'navidrome', 'netease'].includes(parsed.type)) {
            return 'Lyric source type must be embedded, local, navidrome, or netease.';
        }
    } catch {
        return 'Lyric source JSON must be valid JSON.';
    }

    return null;
};

export const validateStageSearchRequestInput = (input: StageSearchRequestInput): string | null => {
    const baseAuthError = validateStageBaseAuth(input.baseUrl, input.token);
    if (baseAuthError) {
        return baseAuthError;
    }

    if (!normalizeText(input.query)) {
        return 'Search query is required.';
    }

    return null;
};

export const validateStagePlayRequestInput = (input: StagePlayRequestInput): string | null => {
    const baseAuthError = validateStageBaseAuth(input.baseUrl, input.token);
    if (baseAuthError) {
        return baseAuthError;
    }

    if (!Number.isInteger(input.songId) || input.songId <= 0) {
        return 'songId must be a positive integer.';
    }

    return null;
};

export const validateStagePlayerControlRequestInput = (input: StagePlayerControlRequestInput): string | null => {
    const baseAuthError = validateStageBaseAuth(input.baseUrl, input.token);
    if (baseAuthError) {
        return baseAuthError;
    }

    if (!['next', 'prev', 'pause', 'resume', 'seek'].includes(input.action)) {
        return 'Control action must be next, prev, pause, resume, or seek.';
    }

    if (input.action === 'seek' && (!Number.isFinite(input.positionMs) || Number(input.positionMs) < 0)) {
        return 'Seek requires a non-negative positionMs.';
    }

    return null;
};

export const validateStagePlayerQueueRequestInput = (input: StagePlayerQueueRequestInput): string | null => {
    const baseAuthError = validateStageBaseAuth(input.baseUrl, input.token);
    if (baseAuthError) {
        return baseAuthError;
    }

    if (!['append', 'insert-next', 'remove', 'move', 'select', 'clear'].includes(input.action)) {
        return 'Queue action must be append, insert-next, remove, move, select, or clear.';
    }

    if ((input.action === 'append' || input.action === 'insert-next') && !input.songId && (!input.songIds || input.songIds.length === 0)) {
        return 'Queue append actions require songId or songIds.';
    }

    if (input.action === 'move' && !input.fromQueueItemId && !Number.isInteger(input.fromIndex)) {
        return 'Queue move requires fromQueueItemId or fromIndex.';
    }

    if (input.action === 'move' && !Number.isInteger(input.toIndex)) {
        return 'Queue move requires toIndex.';
    }

    if (input.action === 'remove' && !input.queueItemId && !Number.isInteger(input.index)) {
        return 'Queue remove requires queueItemId or index.';
    }

    if (input.action === 'select' && !input.queueItemId && !Number.isInteger(input.index)) {
        return 'Queue select requires queueItemId or index.';
    }

    return null;
};

export const shouldUseStageMultipart = (input: StageSessionRequestInput) =>
    Boolean(input.audioFile || input.lyricsFile || input.coverFile);

export const buildStageHealthRequest = (baseUrl: string): StageRequestBuildResult => {
    const normalizedBaseUrl = normalizeStageBaseUrl(baseUrl);
    if (!normalizedBaseUrl) {
        throw new Error('Stage address is required.');
    }

    return {
        endpoint: `${normalizedBaseUrl}/stage/health`,
        transport: 'json',
        init: {
            method: 'GET',
        },
    };
};

export const buildStageStatusRequest = (baseUrl: string, token: string): StageRequestBuildResult => {
    const baseAuthError = validateStageBaseAuth(baseUrl, token);
    if (baseAuthError) {
        throw new Error(baseAuthError);
    }

    return {
        endpoint: `${normalizeStageBaseUrl(baseUrl)}/stage/status`,
        transport: 'json',
        init: {
            method: 'GET',
            headers: buildStageBearerHeaders(token),
        },
    };
};

export const buildStageLyricsRequest = (input: StageLyricsRequestInput): StageRequestBuildResult => {
    const validationError = validateStageLyricsRequestInput(input);
    if (validationError) {
        throw new Error(validationError);
    }

    const lyricSource = JSON.parse(normalizeText(input.lyricSourceJson));

    return {
        endpoint: `${normalizeStageBaseUrl(input.baseUrl)}/stage/lyrics`,
        transport: 'json',
        init: {
            method: 'POST',
            headers: buildStageBearerHeaders(input.token, {
                'Content-Type': 'application/json',
            }),
            body: JSON.stringify({
                ...(normalizeText(input.title) ? { title: normalizeText(input.title) } : {}),
                ...(normalizeText(input.artist) ? { artist: normalizeText(input.artist) } : {}),
                ...(normalizeText(input.album) ? { album: normalizeText(input.album) } : {}),
                lyricSource,
            }),
        },
    };
};

export const buildStageSessionRequest = (input: StageSessionRequestInput): StageRequestBuildResult => {
    const validationError = validateStageSessionRequestInput(input);
    if (validationError) {
        throw new Error(validationError);
    }

    const endpoint = `${normalizeStageBaseUrl(input.baseUrl)}/stage/session`;
    const token = normalizeText(input.token);
    const title = normalizeText(input.title);
    const artist = normalizeText(input.artist);
    const album = normalizeText(input.album);
    const coverUrl = normalizeText(input.coverUrl);
    const audioUrl = normalizeText(input.audioUrl);
    const lyricsText = normalizeText(input.lyricsText);
    const normalizedLyricsFormat = normalizeText(input.lyricsFormat);

    if (shouldUseStageMultipart(input)) {
        const formData = new FormData();
        if (normalizedLyricsFormat) formData.set('lyricsFormat', normalizedLyricsFormat);
        if (title) formData.set('title', title);
        if (artist) formData.set('artist', artist);
        if (album) formData.set('album', album);
        if (coverUrl) formData.set('coverUrl', coverUrl);
        if (audioUrl) formData.set('audioUrl', audioUrl);
        if (lyricsText) formData.set('lyricsText', lyricsText);
        if (input.audioFile) formData.set('audioFile', input.audioFile, input.audioFile.name);
        if (input.lyricsFile) formData.set('lyricsFile', input.lyricsFile, input.lyricsFile.name);
        if (input.coverFile) formData.set('coverFile', input.coverFile, input.coverFile.name);

        return {
            endpoint,
            transport: 'multipart',
            init: {
                method: 'POST',
                headers: buildStageBearerHeaders(token),
                body: formData,
            },
        };
    }

    return {
        endpoint,
        transport: 'json',
        init: {
            method: 'POST',
            headers: buildStageBearerHeaders(token, {
                'Content-Type': 'application/json',
            }),
            body: JSON.stringify({
                ...(title ? { title } : {}),
                ...(artist ? { artist } : {}),
                ...(album ? { album } : {}),
                ...(coverUrl ? { coverUrl } : {}),
                ...(audioUrl ? { audioUrl } : {}),
                ...(lyricsText ? { lyricsText } : {}),
                ...(normalizedLyricsFormat ? { lyricsFormat: normalizedLyricsFormat } : {}),
            }),
        },
    };
};

export const buildStageClearRequest = (baseUrl: string, token: string): StageRequestBuildResult => {
    const baseAuthError = validateStageBaseAuth(baseUrl, token);
    if (baseAuthError) {
        throw new Error(baseAuthError);
    }

    return {
        endpoint: `${normalizeStageBaseUrl(baseUrl)}/stage/state`,
        transport: 'json',
        init: {
            method: 'DELETE',
            headers: buildStageBearerHeaders(token),
        },
    };
};

export const buildStageSearchRequest = (input: StageSearchRequestInput): StageRequestBuildResult => {
    const validationError = validateStageSearchRequestInput(input);
    if (validationError) {
        throw new Error(validationError);
    }

    return {
        endpoint: `${normalizeStageBaseUrl(input.baseUrl)}/stage/player/search`,
        transport: 'json',
        init: {
            method: 'POST',
            headers: buildStageBearerHeaders(input.token, {
                'Content-Type': 'application/json',
            }),
            body: JSON.stringify({
                query: normalizeText(input.query),
                ...(Number.isInteger(input.limit) ? { limit: input.limit } : {}),
            }),
        },
    };
};

export const buildStagePlayRequest = (input: StagePlayRequestInput): StageRequestBuildResult => {
    const validationError = validateStagePlayRequestInput(input);
    if (validationError) {
        throw new Error(validationError);
    }

    return {
        endpoint: `${normalizeStageBaseUrl(input.baseUrl)}/stage/player/play`,
        transport: 'json',
        init: {
            method: 'POST',
            headers: buildStageBearerHeaders(input.token, {
                'Content-Type': 'application/json',
            }),
            body: JSON.stringify({
                songId: input.songId,
                ...(input.appendToQueue ? { appendToQueue: true } : {}),
            }),
        },
    };
};

export const buildStagePlayerStatusRequest = (baseUrl: string, token: string): StageRequestBuildResult => {
    const baseAuthError = validateStageBaseAuth(baseUrl, token);
    if (baseAuthError) {
        throw new Error(baseAuthError);
    }

    return {
        endpoint: `${normalizeStageBaseUrl(baseUrl)}/stage/player/status`,
        transport: 'json',
        init: {
            method: 'GET',
            headers: buildStageBearerHeaders(token),
        },
    };
};

export const buildStagePlayerTimeRequest = (baseUrl: string, token: string): StageRequestBuildResult => {
    const baseAuthError = validateStageBaseAuth(baseUrl, token);
    if (baseAuthError) {
        throw new Error(baseAuthError);
    }

    return {
        endpoint: `${normalizeStageBaseUrl(baseUrl)}/stage/player/time`,
        transport: 'json',
        init: {
            method: 'GET',
            headers: buildStageBearerHeaders(token),
        },
    };
};

export const buildStagePlayerControlRequest = (input: StagePlayerControlRequestInput): StageRequestBuildResult => {
    const validationError = validateStagePlayerControlRequestInput(input);
    if (validationError) {
        throw new Error(validationError);
    }

    return {
        endpoint: `${normalizeStageBaseUrl(input.baseUrl)}/stage/player/control`,
        transport: 'json',
        init: {
            method: 'POST',
            headers: buildStageBearerHeaders(input.token, {
                'Content-Type': 'application/json',
            }),
            body: JSON.stringify({
                action: input.action,
                ...(input.action === 'seek' ? { positionMs: Math.floor(Number(input.positionMs)) } : {}),
            }),
        },
    };
};

export const buildStagePlayerQueueGetRequest = (baseUrl: string, token: string, options: StagePlayerQueueGetOptions = {}): StageRequestBuildResult => {
    const baseAuthError = validateStageBaseAuth(baseUrl, token);
    if (baseAuthError) {
        throw new Error(baseAuthError);
    }

    const endpoint = new URL(`${normalizeStageBaseUrl(baseUrl)}/stage/player/queue`);
    if (Number.isInteger(options.offset) && Number(options.offset) >= 0) {
        endpoint.searchParams.set('offset', String(Math.floor(Number(options.offset))));
    }
    if (Number.isInteger(options.limit) && Number(options.limit) > 0) {
        endpoint.searchParams.set('limit', String(Math.floor(Number(options.limit))));
    }
    if (options.around === 'current') {
        endpoint.searchParams.set('around', 'current');
    }

    return {
        endpoint: endpoint.toString(),
        transport: 'json',
        init: {
            method: 'GET',
            headers: buildStageBearerHeaders(token),
        },
    };
};

export const buildStagePlayerQueueRequest = (input: StagePlayerQueueRequestInput): StageRequestBuildResult => {
    const validationError = validateStagePlayerQueueRequestInput(input);
    if (validationError) {
        throw new Error(validationError);
    }

    return {
        endpoint: `${normalizeStageBaseUrl(input.baseUrl)}/stage/player/queue`,
        transport: 'json',
        init: {
            method: 'POST',
            headers: buildStageBearerHeaders(input.token, {
                'Content-Type': 'application/json',
            }),
            body: JSON.stringify({
                action: input.action,
                ...(input.songId ? { songId: input.songId } : {}),
                ...(input.songIds?.length ? { songIds: input.songIds } : {}),
                ...(normalizeText(input.queueItemId) ? { queueItemId: normalizeText(input.queueItemId) } : {}),
                ...(normalizeText(input.fromQueueItemId) ? { fromQueueItemId: normalizeText(input.fromQueueItemId) } : {}),
                ...(Number.isInteger(input.fromIndex) ? { fromIndex: input.fromIndex } : {}),
                ...(Number.isInteger(input.toIndex) ? { toIndex: input.toIndex } : {}),
                ...(Number.isInteger(input.index) ? { index: input.index } : {}),
            }),
        },
    };
};

export const buildStagePlayerWebSocketUrl = (baseUrl: string, token: string) => {
    const baseAuthError = validateStageBaseAuth(baseUrl, token);
    if (baseAuthError) {
        throw new Error(baseAuthError);
    }

    const normalizedBaseUrl = normalizeStageBaseUrl(baseUrl);
    const wsBaseUrl = normalizedBaseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    return `${wsBaseUrl}/stage/player/ws?token=${encodeURIComponent(normalizeText(token))}`;
};
