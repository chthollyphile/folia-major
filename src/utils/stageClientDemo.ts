// Shared helpers keep the manual Stage API console and its tests aligned
// with the latest local-only HTTP contract.

export type StageLyricsFormat = 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc';

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
    format === 'lrc' || format === 'enhanced-lrc' || format === 'vtt' || format === 'yrc';

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
        endpoint: `${normalizeStageBaseUrl(input.baseUrl)}/stage/search`,
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
        endpoint: `${normalizeStageBaseUrl(input.baseUrl)}/stage/play`,
        transport: 'json',
        init: {
            method: 'POST',
            headers: buildStageBearerHeaders(input.token, {
                'Content-Type': 'application/json',
            }),
            body: JSON.stringify({
                songId: input.songId,
            }),
        },
    };
};
