import type { PlayerState, StageLoopMode, StageRealtimeState, StageTrack } from '../types';

// Shared helpers keep the manual Stage controller page and its tests aligned with the latest HTTP and WS protocol.

export type StageLyricsFormat = 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc';
export type StageRealtimeMessageType =
    | 'hello'
    | 'hello_ack'
    | 'server_hello'
    | 'stage_state'
    | 'stage_session'
    | 'stage_session_cleared'
    | 'control_request'
    | 'error';

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

export interface StageRequestBuildResult {
    endpoint: string;
    init: RequestInit;
    transport: 'json' | 'multipart';
}

export interface StageRealtimeEnvelope<TPayload = unknown> {
    type: StageRealtimeMessageType;
    payload: TPayload;
}

export interface StageControllerHelloPayload {
    role: 'controller';
    controllerId: string;
}

export interface StageRealtimeStateDraft {
    revision?: number;
    sessionId?: string | null;
    tracks?: StageTrack[];
    currentTrackId?: string | null;
    playerState?: PlayerState | string;
    currentTimeMs?: number;
    durationMs?: number;
    loopMode?: StageLoopMode | string;
    canGoNext?: boolean;
    canGoPrev?: boolean;
    updatedAt?: number;
}

const normalizeText = (value?: string) => value?.trim() ?? '';

export const normalizeStageBaseUrl = (baseUrl: string) => {
    const normalized = normalizeText(baseUrl);
    return normalized.replace(/\/+$/, '');
};

export const isSupportedStageLyricsFormat = (format: string): format is StageLyricsFormat =>
    format === 'lrc' || format === 'enhanced-lrc' || format === 'vtt' || format === 'yrc';

export const isSupportedStagePlayerState = (value: string): value is PlayerState =>
    value === 'IDLE' || value === 'PLAYING' || value === 'PAUSED';

export const isSupportedStageLoopMode = (value: string): value is StageLoopMode =>
    value === 'off' || value === 'all' || value === 'one';

export const validateStageSessionRequestInput = (input: StageSessionRequestInput): string | null => {
    if (!normalizeStageBaseUrl(input.baseUrl)) {
        return 'Stage address is required.';
    }

    if (!normalizeText(input.token)) {
        return 'Bearer token is required.';
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

export const shouldUseStageMultipart = (input: StageSessionRequestInput) =>
    Boolean(input.audioFile || input.lyricsFile || input.coverFile);

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
                ...(normalizedLyricsFormat ? { lyricsFormat: normalizedLyricsFormat } : {}),
            }),
        },
    };
};

export const buildStageClearRequest = (baseUrl: string, token: string): StageRequestBuildResult => {
    const normalizedBaseUrl = normalizeStageBaseUrl(baseUrl);
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

export const buildStageWebSocketUrl = (baseUrl: string, token: string) => {
    const normalizedBaseUrl = normalizeStageBaseUrl(baseUrl);
    const normalizedToken = normalizeText(token);

    if (!normalizedBaseUrl) {
        throw new Error('Stage address is required.');
    }

    if (!normalizedToken) {
        throw new Error('Bearer token is required.');
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(normalizedBaseUrl);
    } catch (error) {
        throw new Error(`Invalid Stage address: ${normalizedBaseUrl}`);
    }

    parsedUrl.protocol = parsedUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    parsedUrl.pathname = '/stage/ws';
    parsedUrl.searchParams.set('token', normalizedToken);
    return parsedUrl.toString();
};

export const normalizeStageControllerId = (controllerId?: string) =>
    normalizeText(controllerId) || `stage-controller-${Date.now()}`;

export const buildStageControllerHelloMessage = (controllerId?: string): StageRealtimeEnvelope<StageControllerHelloPayload> => ({
    type: 'hello',
    payload: {
        role: 'controller',
        controllerId: normalizeStageControllerId(controllerId),
    },
});

const normalizeStageTrack = (track: Partial<StageTrack> | null | undefined, index: number, sessionId: string | null) => ({
    trackId:
        typeof track?.trackId === 'string' && track.trackId.trim()
            ? track.trackId.trim()
            : `${sessionId || 'stage-session'}-track-${index}`,
    title:
        typeof track?.title === 'string' && track.title.trim()
            ? track.title.trim()
            : `Stage Track ${index + 1}`,
    artist: typeof track?.artist === 'string' ? track.artist : '',
    album: typeof track?.album === 'string' ? track.album : '',
    coverUrl: typeof track?.coverUrl === 'string' && track.coverUrl.trim() ? track.coverUrl.trim() : null,
    durationMs: Number.isFinite(track?.durationMs) ? Math.max(0, Math.floor(track.durationMs as number)) : null,
});

export const buildStageRealtimeStatePayload = (draft: StageRealtimeStateDraft): StageRealtimeState => {
    const nextSessionId = typeof draft.sessionId === 'string' && draft.sessionId.trim() ? draft.sessionId.trim() : null;
    const tracks = (draft.tracks || []).map((track, index) => normalizeStageTrack(track, index, nextSessionId));
    const fallbackCurrentTrackId = tracks[0]?.trackId ?? null;
    const currentTrackId =
        typeof draft.currentTrackId === 'string' && draft.currentTrackId.trim()
            ? draft.currentTrackId.trim()
            : fallbackCurrentTrackId;
    const rawPlayerState = typeof draft.playerState === 'string' ? draft.playerState : 'IDLE';
    const rawLoopMode = typeof draft.loopMode === 'string' ? draft.loopMode : 'off';

    return {
        revision: Math.max(1, Math.floor(Number(draft.revision) || 1)),
        sessionId: nextSessionId,
        tracks,
        currentTrackId,
        playerState: isSupportedStagePlayerState(rawPlayerState) ? rawPlayerState : 'IDLE',
        currentTimeMs: Math.max(0, Math.floor(Number(draft.currentTimeMs) || 0)),
        durationMs: Math.max(0, Math.floor(Number(draft.durationMs) || 0)),
        loopMode: isSupportedStageLoopMode(rawLoopMode) ? rawLoopMode : 'off',
        canGoNext: Boolean(draft.canGoNext),
        canGoPrev: Boolean(draft.canGoPrev),
        updatedAt: Math.max(1, Math.floor(Number(draft.updatedAt) || Date.now())),
    };
};

export const buildStageRealtimeStateMessage = (
    draft: StageRealtimeStateDraft,
): StageRealtimeEnvelope<StageRealtimeState> => ({
    type: 'stage_state',
    payload: buildStageRealtimeStatePayload(draft),
});
