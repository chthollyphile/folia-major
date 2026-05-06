export type StageLyricsFormat = 'lrc' | 'enhanced-lrc';

// Shared helpers for the manual Stage client demo and its unit tests.

export interface StageSessionRequestInput {
    baseUrl: string;
    token: string;
    title?: string;
    artist?: string;
    album?: string;
    coverUrl?: string;
    audioUrl?: string;
    lyricsText?: string;
    lyricsFormat: StageLyricsFormat;
    audioFile?: File | null;
    lyricsFile?: File | null;
    coverFile?: File | null;
}

export interface StageRequestBuildResult {
    endpoint: string;
    init: RequestInit;
    transport: 'json' | 'multipart';
}

const normalizeText = (value?: string) => value?.trim() ?? '';

const normalizeBaseUrl = (baseUrl: string) => {
    const normalized = normalizeText(baseUrl);
    return normalized.replace(/\/+$/, '');
};

export const isSupportedStageLyricsFormat = (format: string): format is StageLyricsFormat =>
    format === 'lrc' || format === 'enhanced-lrc';

export const validateStageSessionRequestInput = (input: StageSessionRequestInput): string | null => {
    if (!normalizeBaseUrl(input.baseUrl)) {
        return 'Stage address is required.';
    }

    if (!normalizeText(input.token)) {
        return 'Bearer token is required.';
    }

    if (!isSupportedStageLyricsFormat(input.lyricsFormat)) {
        return 'Lyrics format must be lrc or enhanced-lrc.';
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
    if (!hasLyricsText && !hasLyricsFile) {
        return 'Provide either lyrics text or a lyrics file.';
    }
    if (hasLyricsText && hasLyricsFile) {
        return 'Choose either lyrics text or a lyrics file, not both.';
    }

    return null;
};

export const shouldUseStageMultipart = (input: StageSessionRequestInput) =>
    Boolean(input.audioFile || input.lyricsFile || input.coverFile);

export const buildStageSessionRequest = (input: StageSessionRequestInput): StageRequestBuildResult => {
    const validationError = validateStageSessionRequestInput(input);
    if (validationError) {
        throw new Error(validationError);
    }

    const endpoint = `${normalizeBaseUrl(input.baseUrl)}/stage/session`;
    const token = normalizeText(input.token);
    const title = normalizeText(input.title);
    const artist = normalizeText(input.artist);
    const album = normalizeText(input.album);
    const coverUrl = normalizeText(input.coverUrl);
    const audioUrl = normalizeText(input.audioUrl);
    const lyricsText = normalizeText(input.lyricsText);

    if (shouldUseStageMultipart(input)) {
        const formData = new FormData();
        formData.set('lyricsFormat', input.lyricsFormat);
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
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                body: formData,
            },
        };
    }

    return {
        endpoint,
        transport: 'json',
        init: {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ...(title ? { title } : {}),
                ...(artist ? { artist } : {}),
                ...(album ? { album } : {}),
                ...(coverUrl ? { coverUrl } : {}),
                ...(audioUrl ? { audioUrl } : {}),
                ...(lyricsText ? { lyricsText } : {}),
                lyricsFormat: input.lyricsFormat,
            }),
        },
    };
};

export const buildStageClearRequest = (baseUrl: string, token: string): StageRequestBuildResult => {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const normalizedToken = normalizeText(token);

    if (!normalizedBaseUrl) {
        throw new Error('Stage address is required.');
    }

    if (!normalizedToken) {
        throw new Error('Bearer token is required.');
    }

    return {
        endpoint: `${normalizedBaseUrl}/stage/session`,
        transport: 'json',
        init: {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${normalizedToken}`,
            },
        },
    };
};
