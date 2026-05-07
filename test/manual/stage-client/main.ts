import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import type { PlayerState, StageControlRequest, StageLoopMode, StageRealtimeState, StageTrack } from '../../../src/types';
import '../../../src/index.css';
import {
    buildStageControlRequestPayload,
    buildStageClearRequest,
    buildStageControllerHelloMessage,
    buildStageRealtimeStateMessage,
    buildStageSessionRequest,
    buildStageWebSocketUrl,
    type StageLyricsFormat,
    type StageRealtimeEnvelope,
    type StageSessionRequestInput,
} from '../../../src/utils/stageClientDemo';
import {
    applyStageControlRequestWithClock,
    createStageControllerClock,
    cycleLoopMode,
    formatControllerClockStatus,
    getControllerClockTimeMs,
    syncControllerClockFromState,
} from './controllerClock';
import type { EventLogEntry, ManagedInstance, ResponseTarget } from './types';
import './style.css';

// Manual Stage controller console for testing the latest HTTP + WS protocol against one or many Electron Folia instances.

type ResponseView = {
    statusEl: HTMLDivElement;
    bodyEl: HTMLElement;
};

const getInput = <T extends HTMLElement>(id: string) => {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing required element: ${id}`);
    }
    return element as T;
};

const form = getInput<HTMLFormElement>('stage-client-form');
const baseUrlInput = getInput<HTMLInputElement>('base-url');
const tokenInput = getInput<HTMLInputElement>('token');
const controllerIdInput = getInput<HTMLInputElement>('controller-id');
const selectedInstanceSummaryInput = getInput<HTMLInputElement>('selected-instance-summary');
const upsertInstanceButton = getInput<HTMLButtonElement>('upsert-instance');
const connectSelectedButton = getInput<HTMLButtonElement>('connect-selected');
const disconnectSelectedButton = getInput<HTMLButtonElement>('disconnect-selected');
const instanceList = getInput<HTMLDivElement>('instance-list');

const titleInput = getInput<HTMLInputElement>('title');
const artistInput = getInput<HTMLInputElement>('artist');
const albumInput = getInput<HTMLInputElement>('album');
const coverUrlInput = getInput<HTMLInputElement>('cover-url');
const coverFileInput = getInput<HTMLInputElement>('cover-file');
const audioUrlInput = getInput<HTMLInputElement>('audio-url');
const audioFileInput = getInput<HTMLInputElement>('audio-file');
const lyricsFormatSelect = getInput<HTMLSelectElement>('lyrics-format');
const lyricsFileInput = getInput<HTMLInputElement>('lyrics-file');
const lyricsTextInput = getInput<HTMLTextAreaElement>('lyrics-text');
const testHealthButton = getInput<HTMLButtonElement>('test-health');
const clearSessionButton = getInput<HTMLButtonElement>('clear-session');
const sessionRequestPreview = getInput<HTMLElement>('session-request-preview');
const healthRequestPreview = getInput<HTMLElement>('health-request-preview');
const clearRequestPreview = getInput<HTMLElement>('clear-request-preview');
const wsConnectPreview = getInput<HTMLElement>('ws-connect-preview');
const wsStatePreview = getInput<HTMLElement>('ws-state-preview');
const wsStatus = getInput<HTMLDivElement>('ws-status');
const wsResponse = getInput<HTMLElement>('ws-response');
const wsEventLog = getInput<HTMLElement>('ws-event-log');

const realtimeSessionIdInput = getInput<HTMLInputElement>('realtime-session-id');
const realtimeCurrentTrackIdInput = getInput<HTMLInputElement>('realtime-current-track-id');
const realtimePlayerStateSelect = getInput<HTMLSelectElement>('realtime-player-state');
const realtimeCurrentTimeMsInput = getInput<HTMLInputElement>('realtime-current-time-ms');
const realtimeDurationMsInput = getInput<HTMLInputElement>('realtime-duration-ms');
const realtimeLoopModeSelect = getInput<HTMLSelectElement>('realtime-loop-mode');
const realtimeTrackTitleInput = getInput<HTMLInputElement>('realtime-track-title');
const realtimeTrackArtistInput = getInput<HTMLInputElement>('realtime-track-artist');
const realtimeTrackAlbumInput = getInput<HTMLInputElement>('realtime-track-album');
const realtimeTrackCoverUrlInput = getInput<HTMLInputElement>('realtime-track-cover-url');
const seekTargetMsInput = getInput<HTMLInputElement>('seek-target-ms');
const realtimeCanGoNextInput = getInput<HTMLInputElement>('realtime-can-go-next');
const realtimeCanGoPrevInput = getInput<HTMLInputElement>('realtime-can-go-prev');
const realtimeTracksJsonInput = getInput<HTMLTextAreaElement>('realtime-tracks-json');
const autoApplyControlRequestsInput = getInput<HTMLInputElement>('auto-apply-control-requests');
const mirrorToSelectedInput = getInput<HTMLInputElement>('mirror-to-selected');
const clockStatus = getInput<HTMLDivElement>('clock-status');
const syncTrackFromSessionButton = getInput<HTMLButtonElement>('sync-track-from-session');
const broadcastStateButton = getInput<HTMLButtonElement>('broadcast-state');
const controlPlayButton = getInput<HTMLButtonElement>('control-play');
const controlPauseButton = getInput<HTMLButtonElement>('control-pause');
const controlSeekButton = getInput<HTMLButtonElement>('control-seek');
const controlNextButton = getInput<HTMLButtonElement>('control-next');
const controlPrevButton = getInput<HTMLButtonElement>('control-prev');
const controlCycleLoopButton = getInput<HTMLButtonElement>('control-cycle-loop');

const responseViews: Record<ResponseTarget, ResponseView> = {
    health: {
        statusEl: getInput<HTMLDivElement>('health-status'),
        bodyEl: getInput<HTMLElement>('health-response'),
    },
    clear: {
        statusEl: getInput<HTMLDivElement>('clear-status'),
        bodyEl: getInput<HTMLElement>('clear-response'),
    },
    session: {
        statusEl: getInput<HTMLDivElement>('session-status'),
        bodyEl: getInput<HTMLElement>('session-response'),
    },
};

const instances = new Map<string, ManagedInstance>();
const mergedEventLog: EventLogEntry[] = [];
let lastKnownRealtimeState: StageRealtimeState | null = null;
let lastKnownRevision = 0;
let currentDraftInstanceId: string | null = null;
let controllerClock = createStageControllerClock();

const getSelectedFile = (input: HTMLInputElement) => input.files?.[0] ?? null;
const normalizeText = (value: string) => value.trim();
const normalizeBaseUrl = (value: string) => normalizeText(value).replace(/\/+$/, '');
const prettyJson = (value: unknown) => JSON.stringify(value, null, 2);
const nowStamp = () => new Date().toLocaleTimeString();

const escapeHtml = (value: string) =>
    value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

const maskToken = (token: string) => {
    const normalizedToken = normalizeText(token);
    if (!normalizedToken) {
        return '(missing)';
    }

    if (normalizedToken.length <= 8) {
        return `${normalizedToken.slice(0, 2)}***`;
    }

    return `${normalizedToken.slice(0, 4)}...${normalizedToken.slice(-4)}`;
};

const describeFile = (file: File | null | undefined) => {
    if (!file) {
        return null;
    }

    return `${file.name} (${file.type || 'application/octet-stream'}, ${file.size} bytes)`;
};

const describeAxiosResponse = (response: AxiosResponse) => {
    const contentType = String(response.headers['content-type'] || '');
    const bodyText =
        typeof response.data === 'string'
            ? response.data
            : contentType.includes('application/json')
                ? prettyJson(response.data)
                : prettyJson(response.data);

    return [
        `status: ${response.status} ${response.statusText}`,
        '',
        '# headers',
        prettyJson(response.headers),
        '',
        '# body',
        bodyText || '(empty response body)',
    ].join('\n');
};

const describeAxiosError = (error: unknown) => {
    if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
            return describeAxiosResponse(axiosError.response);
        }

        return [
            `axios error: ${axiosError.message}`,
            '',
            '# request',
            prettyJson({
                code: axiosError.code || null,
                method: axiosError.config?.method || null,
                url: axiosError.config?.url || null,
            }),
        ].join('\n');
    }

    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
};

const createAxiosConfig = (
    request:
        | ReturnType<typeof buildStageSessionRequest>
        | ReturnType<typeof buildStageClearRequest>
        | {
            endpoint: string;
            init: RequestInit;
        },
) => {
    const headers = { ...(request.init.headers as Record<string, string> | undefined) };
    const config: AxiosRequestConfig = {
        url: request.endpoint,
        method: (request.init.method || 'GET') as AxiosRequestConfig['method'],
        headers,
        data: request.init.body,
        validateStatus: () => true,
    };

    if (request.init.body instanceof FormData) {
        delete headers['Content-Type'];
    }

    return config;
};

const getDraftInstance = () => ({
    baseUrl: normalizeBaseUrl(baseUrlInput.value) || 'http://127.0.0.1:32107',
    token: normalizeText(tokenInput.value),
    controllerId: normalizeText(controllerIdInput.value) || 'stage-controller-demo',
});

const buildRequestInput = (): StageSessionRequestInput => ({
    ...getDraftInstance(),
    title: titleInput.value,
    artist: artistInput.value,
    album: albumInput.value,
    coverUrl: coverUrlInput.value,
    audioUrl: audioUrlInput.value,
    lyricsText: lyricsTextInput.value,
    lyricsFormat: lyricsFormatSelect.value as StageLyricsFormat | '',
    audioFile: getSelectedFile(audioFileInput),
    lyricsFile: getSelectedFile(lyricsFileInput),
    coverFile: getSelectedFile(coverFileInput),
});

const setResponseState = (target: ResponseTarget, statusText: string, details: string) => {
    responseViews[target].statusEl.textContent = statusText;
    responseViews[target].bodyEl.textContent = details;
};

const setWsState = (statusText: string, details: string) => {
    wsStatus.textContent = statusText;
    wsResponse.textContent = details;
};

const renderControllerClockStatus = () => {
    clockStatus.textContent = `Controller clock: ${formatControllerClockStatus(controllerClock)}`;
};

const refreshRealtimeTimeFromClock = () => {
    if (!lastKnownRealtimeState || controllerClock.playerState !== 'PLAYING') {
        renderControllerClockStatus();
        return;
    }

    const isEditingTimeField = document.activeElement === realtimeCurrentTimeMsInput || document.activeElement === seekTargetMsInput;
    const nextTimeMs = getControllerClockTimeMs(controllerClock);
    if (!isEditingTimeField) {
        realtimeCurrentTimeMsInput.value = String(nextTimeMs);
    }
    renderControllerClockStatus();
    updatePreviews();
};

const addEventLogEntry = (entry: Omit<EventLogEntry, 'id' | 'at'>) => {
    mergedEventLog.unshift({
        ...entry,
        id: crypto.randomUUID(),
        at: Date.now(),
    });

    if (mergedEventLog.length > 120) {
        mergedEventLog.length = 120;
    }

    renderMergedEventLog();
};

const renderMergedEventLog = () => {
    if (mergedEventLog.length === 0) {
        wsEventLog.textContent = 'No WS events yet.';
        return;
    }

    wsEventLog.textContent = mergedEventLog
        .map((entry) => [
            `[${new Date(entry.at).toLocaleTimeString()}] ${entry.direction.toUpperCase()} ${entry.label} ${entry.title}`,
            entry.body,
        ].join('\n'))
        .join('\n\n');
};

const getInstanceLabel = (instance: ManagedInstance) => `${instance.baseUrl} (${instance.controllerId})`;

const buildSingleTrackFromInputs = (): StageTrack => ({
    trackId: normalizeText(realtimeCurrentTrackIdInput.value) || normalizeText(realtimeSessionIdInput.value) || 'stage-track-1',
    title: normalizeText(realtimeTrackTitleInput.value) || 'Stage Track',
    artist: normalizeText(realtimeTrackArtistInput.value),
    album: normalizeText(realtimeTrackAlbumInput.value),
    coverUrl: normalizeText(realtimeTrackCoverUrlInput.value) || null,
    durationMs: Number.isFinite(Number(realtimeDurationMsInput.value))
        ? Math.max(0, Math.floor(Number(realtimeDurationMsInput.value)))
        : null,
});

const syncTrackFieldsFromTrack = (track: StageTrack | null | undefined) => {
    realtimeTrackTitleInput.value = track?.title || '';
    realtimeTrackArtistInput.value = track?.artist || '';
    realtimeTrackAlbumInput.value = track?.album || '';
    realtimeTrackCoverUrlInput.value = track?.coverUrl || '';
    if (track?.durationMs != null && !Number.isNaN(track.durationMs)) {
        realtimeDurationMsInput.value = String(track.durationMs);
    }
};

const syncSessionFieldsFromPayload = (session: {
    id?: string;
    title?: string;
    artist?: string;
    album?: string;
    coverUrl?: string | null;
    coverArtUrl?: string | null;
    durationMs?: number | null;
} | null | undefined) => {
    if (!session) {
        return;
    }

    if (typeof session.title === 'string') {
        titleInput.value = session.title;
        realtimeTrackTitleInput.value = session.title;
    }
    if (typeof session.artist === 'string') {
        artistInput.value = session.artist;
        realtimeTrackArtistInput.value = session.artist;
    }
    if (typeof session.album === 'string') {
        albumInput.value = session.album;
        realtimeTrackAlbumInput.value = session.album;
    }

    const nextCoverUrl =
        typeof session.coverArtUrl === 'string'
            ? session.coverArtUrl
            : typeof session.coverUrl === 'string'
                ? session.coverUrl
                : null;
    if (nextCoverUrl) {
        coverUrlInput.value = nextCoverUrl;
        realtimeTrackCoverUrlInput.value = nextCoverUrl;
    }

    if (typeof session.id === 'string' && session.id.trim()) {
        realtimeSessionIdInput.value = session.id;
        realtimeCurrentTrackIdInput.value = session.id;
    }

    if (Number.isFinite(session.durationMs) && Number(session.durationMs) > 0) {
        realtimeDurationMsInput.value = String(Math.floor(Number(session.durationMs)));
    }

    const nextTrackId =
        typeof session.id === 'string' && session.id.trim()
            ? session.id
            : normalizeText(realtimeCurrentTrackIdInput.value) || 'stage-track-1';
    realtimeTracksJsonInput.value = prettyJson([
        {
            trackId: nextTrackId,
            title: normalizeText(realtimeTrackTitleInput.value) || 'Stage Track',
            artist: normalizeText(realtimeTrackArtistInput.value),
            album: normalizeText(realtimeTrackAlbumInput.value),
            coverUrl: normalizeText(realtimeTrackCoverUrlInput.value) || null,
            durationMs: Number.isFinite(Number(realtimeDurationMsInput.value))
                ? Math.max(0, Math.floor(Number(realtimeDurationMsInput.value)))
                : null,
        },
    ]);
};

const parseTracksJson = (): StageTrack[] => {
    const raw = normalizeText(realtimeTracksJsonInput.value);
    if (!raw) {
        return [buildSingleTrackFromInputs()];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Tracks JSON must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!Array.isArray(parsed)) {
        throw new Error('Tracks JSON must be an array.');
    }

    return parsed.map((track, index) => {
        if (!track || typeof track !== 'object') {
            throw new Error(`Track at index ${index} must be an object.`);
        }

        const candidate = track as Partial<StageTrack>;
        return {
            trackId:
                typeof candidate.trackId === 'string' && candidate.trackId.trim()
                    ? candidate.trackId.trim()
                    : `stage-track-${index + 1}`,
            title:
                typeof candidate.title === 'string' && candidate.title.trim()
                    ? candidate.title.trim()
                    : `Stage Track ${index + 1}`,
            artist: typeof candidate.artist === 'string' ? candidate.artist : '',
            album: typeof candidate.album === 'string' ? candidate.album : '',
            coverUrl: typeof candidate.coverUrl === 'string' && candidate.coverUrl.trim() ? candidate.coverUrl.trim() : null,
            durationMs: Number.isFinite(candidate.durationMs as number)
                ? Math.max(0, Math.floor(candidate.durationMs as number))
                : null,
        };
    });
};

const buildRealtimeStateDraft = (revisionOverride?: number): StageRealtimeState => {
    const tracks = parseTracksJson();
    const sessionId = normalizeText(realtimeSessionIdInput.value) || tracks[0]?.trackId || 'stage-session-1';
    const requestedTrackId =
        normalizeText(realtimeCurrentTrackIdInput.value) ||
        tracks[0]?.trackId ||
        `${sessionId}-track-1`;
    const currentTrackId = tracks.some((track) => track.trackId === requestedTrackId)
        ? requestedTrackId
        : (tracks[0]?.trackId || requestedTrackId);
    const durationMs = Math.max(0, Math.floor(Number(realtimeDurationMsInput.value) || 0));
    const nextRevision = revisionOverride ?? Math.max(lastKnownRevision + 1, 1);
    const selectedPlayerState = realtimePlayerStateSelect.value as PlayerState;
    const currentTimeMs =
        controllerClock.sessionId === sessionId &&
        controllerClock.currentTrackId === currentTrackId &&
        selectedPlayerState === 'PLAYING'
            ? getControllerClockTimeMs({
                ...controllerClock,
                durationMs: durationMs > 0 ? durationMs : controllerClock.durationMs,
            })
            : Math.max(0, Math.floor(Number(realtimeCurrentTimeMsInput.value) || 0));

    return buildStageRealtimeStateMessage({
        revision: nextRevision,
        sessionId,
        tracks,
        currentTrackId,
        playerState: selectedPlayerState,
        currentTimeMs,
        durationMs,
        loopMode: realtimeLoopModeSelect.value as StageLoopMode,
        canGoNext: realtimeCanGoNextInput.checked,
        canGoPrev: realtimeCanGoPrevInput.checked,
        updatedAt: Date.now(),
    }).payload;
};

const buildManualControlRequest = (
    type: StageControlRequest['type'],
    payload?: StageControlRequest['payload'],
): StageControlRequest => buildStageControlRequestPayload({
    requestId: crypto.randomUUID(),
    originPlayerId: 'stage-client-demo',
    requestedAt: Date.now(),
    baseRevision: Math.max(0, lastKnownRevision),
    type,
    payload,
});

const buildCurrentRealtimeStateSnapshot = (): StageRealtimeState =>
    buildRealtimeStateDraft(Math.max(lastKnownRevision, 1));

const syncRealtimeInputsFromState = (state: StageRealtimeState | null) => {
    if (!state) {
        return;
    }

    lastKnownRealtimeState = state;
    lastKnownRevision = Math.max(lastKnownRevision, state.revision);
    controllerClock = syncControllerClockFromState(controllerClock, state);
    realtimeSessionIdInput.value = state.sessionId || '';
    realtimeCurrentTrackIdInput.value = state.currentTrackId || '';
    realtimePlayerStateSelect.value = state.playerState;
    realtimeCurrentTimeMsInput.value = String(state.currentTimeMs);
    realtimeDurationMsInput.value = String(state.durationMs);
    realtimeLoopModeSelect.value = state.loopMode;
    realtimeCanGoNextInput.checked = state.canGoNext;
    realtimeCanGoPrevInput.checked = state.canGoPrev;
    realtimeTracksJsonInput.value = prettyJson(state.tracks);

    const currentTrack =
        state.tracks.find((track) => track.trackId === state.currentTrackId) ||
        state.tracks[0] ||
        null;
    syncTrackFieldsFromTrack(currentTrack);
    seekTargetMsInput.value = String(state.currentTimeMs);
    renderControllerClockStatus();
};

const buildHealthPreview = () => {
    const targets = getPreviewTargets();
    return [
        '# Endpoint',
        'GET /stage/health',
        '',
        '# Targets',
        prettyJson(targets.map((target) => target.baseUrl)),
        '',
        '# Request',
        targets.map((target) => `curl ${JSON.stringify(`${target.baseUrl}/stage/health`)}`).join('\n'),
    ].join('\n');
};

const buildClearPreview = () => {
    const targets = getPreviewTargets();
    return targets
        .map((target) => {
            const request = buildStageClearRequest(target.baseUrl, target.token);
            return [
                `# ${target.baseUrl}`,
                'DELETE /stage/session',
                prettyJson(request.init.headers || {}),
            ].join('\n');
        })
        .join('\n\n');
};

const buildSessionPreview = () => {
    const request = buildStageSessionRequest(buildRequestInput());
    const headers = request.init.headers as Record<string, string> | undefined;
    const lines = [
        '# Endpoint',
        'POST /stage/session',
        '',
        '# Transport',
        request.transport,
        '',
        '# Headers',
        prettyJson(headers || {}),
    ];

    if (request.transport === 'json') {
        lines.push('', '# JSON body', String(request.init.body));
    } else {
        const formData = request.init.body as FormData;
        const fields = Object.fromEntries(
            Array.from(formData.entries()).map(([key, value]) => [
                key,
                value instanceof File
                    ? {
                        fileName: value.name,
                        type: value.type || 'application/octet-stream',
                        size: value.size,
                    }
                    : value,
            ]),
        );
        lines.push('', '# Multipart fields', prettyJson(fields));
    }

    return lines.join('\n');
};

const buildWsConnectPreviewText = () => {
    const targets = getPreviewTargets();
    return targets
        .map((target) => {
            const wsUrl = buildStageWebSocketUrl(target.baseUrl, target.token);
            return [
                `# ${target.baseUrl}`,
                wsUrl,
                '',
                '# hello',
                prettyJson(buildStageControllerHelloMessage(target.controllerId)),
            ].join('\n');
        })
        .join('\n\n');
};

const buildWsStatePreviewText = () => prettyJson(buildStageRealtimeStateMessage(buildRealtimeStateDraft()));

const getPreviewTargets = () => {
    const selected = Array.from(instances.values()).filter((instance) => instance.selected);
    if (selected.length > 0) {
        return selected;
    }

    const draft = getDraftInstance();
    return [
        {
            baseUrl: draft.baseUrl,
            token: draft.token,
            controllerId: draft.controllerId,
        },
    ];
};

const updateSelectedInstanceSummary = () => {
    const selectedCount = Array.from(instances.values()).filter((instance) => instance.selected).length;
    selectedInstanceSummaryInput.value = `${selectedCount} selected`;
};

const buildInstanceCard = (instance: ManagedInstance) => {
    const isDraft = currentDraftInstanceId === instance.id;
    const statusClass = `status-pill status-${instance.socketStatus}`;
    const metaLines = [
        `token: ${maskToken(instance.token)}`,
        `playerId: ${instance.playerId || '-'}`,
        `last message: ${instance.lastMessageType || '-'}`,
    ];

    return `
        <article class="instance-card ${instance.selected ? 'instance-card-selected' : ''}">
            <div class="instance-card-head">
                <label class="instance-toggle">
                    <input type="checkbox" data-action="toggle-select" data-instance-id="${escapeHtml(instance.id)}" ${instance.selected ? 'checked' : ''} />
                    <span>${escapeHtml(instance.baseUrl)}</span>
                </label>
                <span class="${statusClass}">${escapeHtml(instance.socketStatus)}</span>
            </div>
            <p class="instance-meta">${escapeHtml(instance.controllerId)}${isDraft ? ' · editing' : ''}</p>
            <p class="instance-meta">${escapeHtml(metaLines.join(' · '))}</p>
            <p class="instance-last">${escapeHtml(instance.lastEvent || 'No events yet.')}</p>
            <div class="button-row button-row-wrap compact-row">
                <button type="button" class="mini-button secondary" data-action="use-instance" data-instance-id="${escapeHtml(instance.id)}">Use Draft</button>
                <button type="button" class="mini-button secondary" data-action="test-instance-health" data-instance-id="${escapeHtml(instance.id)}">Health</button>
                <button type="button" class="mini-button secondary" data-action="connect-instance" data-instance-id="${escapeHtml(instance.id)}">Connect</button>
                <button type="button" class="mini-button secondary" data-action="disconnect-instance" data-instance-id="${escapeHtml(instance.id)}">Disconnect</button>
                <button type="button" class="mini-button danger" data-action="remove-instance" data-instance-id="${escapeHtml(instance.id)}">Remove</button>
            </div>
            <pre class="instance-response">${escapeHtml(instance.lastResponse || 'No HTTP or WS payload yet.')}</pre>
        </article>
    `;
};

const renderInstances = () => {
    updateSelectedInstanceSummary();
    const cards = Array.from(instances.values())
        .sort((left, right) => left.baseUrl.localeCompare(right.baseUrl))
        .map((instance) => buildInstanceCard(instance))
        .join('');

    instanceList.innerHTML = cards || '<div class="instance-empty">No instances yet. Add the current draft to start broadcasting.</div>';
};

const updatePreviews = () => {
    try {
        healthRequestPreview.textContent = buildHealthPreview();
    } catch (error) {
        healthRequestPreview.textContent = `# Validation error\n${describeAxiosError(error)}`;
    }

    try {
        clearRequestPreview.textContent = buildClearPreview();
    } catch (error) {
        clearRequestPreview.textContent = `# Validation error\n${describeAxiosError(error)}`;
    }

    try {
        sessionRequestPreview.textContent = buildSessionPreview();
    } catch (error) {
        sessionRequestPreview.textContent = `# Validation error\n${describeAxiosError(error)}`;
    }

    try {
        wsConnectPreview.textContent = buildWsConnectPreviewText();
    } catch (error) {
        wsConnectPreview.textContent = `# Validation error\n${describeAxiosError(error)}`;
    }

    try {
        wsStatePreview.textContent = buildWsStatePreviewText();
    } catch (error) {
        wsStatePreview.textContent = `# Validation error\n${describeAxiosError(error)}`;
    }
};

const createManagedInstance = (baseUrl: string, token: string, controllerId: string): ManagedInstance => ({
    id: crypto.randomUUID(),
    baseUrl,
    token,
    controllerId,
    selected: true,
    socket: null,
    socketStatus: 'disconnected',
    playerId: null,
    lastEvent: 'Added to instance list.',
    lastMessageType: null,
    lastResponse: '',
    lastServerHello: null,
    lastHelloAck: null,
});

const findInstanceByBaseUrl = (baseUrl: string) =>
    Array.from(instances.values()).find((instance) => instance.baseUrl === baseUrl) || null;

const upsertDraftInstance = () => {
    const draft = getDraftInstance();
    const existingInstance = findInstanceByBaseUrl(draft.baseUrl);

    if (existingInstance) {
        existingInstance.baseUrl = draft.baseUrl;
        existingInstance.token = draft.token;
        existingInstance.controllerId = draft.controllerId;
        existingInstance.selected = true;
        existingInstance.lastEvent = 'Updated from connection draft.';
        currentDraftInstanceId = existingInstance.id;
        addEventLogEntry({
            instanceId: existingInstance.id,
            label: getInstanceLabel(existingInstance),
            direction: 'system',
            title: 'draft updated',
            body: prettyJson({
                baseUrl: existingInstance.baseUrl,
                controllerId: existingInstance.controllerId,
                token: maskToken(existingInstance.token),
            }),
        });
        renderInstances();
        updatePreviews();
        return existingInstance;
    }

    const instance = createManagedInstance(draft.baseUrl, draft.token, draft.controllerId);
    instances.set(instance.id, instance);
    currentDraftInstanceId = instance.id;
    addEventLogEntry({
        instanceId: instance.id,
        label: getInstanceLabel(instance),
        direction: 'system',
        title: 'instance added',
        body: prettyJson({
            baseUrl: instance.baseUrl,
            controllerId: instance.controllerId,
            token: maskToken(instance.token),
        }),
    });
    renderInstances();
    updatePreviews();
    return instance;
};

const loadInstanceIntoDraft = (instance: ManagedInstance) => {
    currentDraftInstanceId = instance.id;
    baseUrlInput.value = instance.baseUrl;
    tokenInput.value = instance.token;
    controllerIdInput.value = instance.controllerId;
    renderInstances();
    updatePreviews();
};

const getSelectedInstances = (createDraftIfMissing = false) => {
    const selected = Array.from(instances.values()).filter((instance) => instance.selected);
    if (selected.length > 0 || !createDraftIfMissing) {
        return selected;
    }

    const instance = upsertDraftInstance();
    instance.selected = true;
    renderInstances();
    return [instance];
};

const updateInstanceResponse = (instance: ManagedInstance, summary: string, details: string) => {
    instance.lastEvent = summary;
    instance.lastResponse = details;
    renderInstances();
};

const executeRequestForInstances = async (
    target: ResponseTarget,
    targetInstances: ManagedInstance[],
    requestFactory: (instance: ManagedInstance) => ReturnType<typeof buildStageSessionRequest> | ReturnType<typeof buildStageClearRequest> | {
        endpoint: string;
        init: RequestInit;
    },
) => {
    if (targetInstances.length === 0) {
        setResponseState(target, 'No target instance selected.', 'Add or select at least one instance.');
        return;
    }

    setResponseState(target, `Sending to ${targetInstances.length} instance(s)...`, '');
    const results: string[] = [];

    for (const instance of targetInstances) {
        try {
            const request = requestFactory(instance);
            const response = await axios.request(createAxiosConfig(request));
            const responseText = describeAxiosResponse(response);
            const label = `## ${instance.baseUrl}\n${responseText}`;
            results.push(label);
            updateInstanceResponse(instance, `${response.status} ${response.statusText}`, responseText);
            addEventLogEntry({
                instanceId: instance.id,
                label: getInstanceLabel(instance),
                direction: 'http',
                title: `${request.init.method || 'GET'} ${request.endpoint}`,
                body: responseText,
            });
        } catch (error) {
            const responseText = describeAxiosError(error);
            results.push(`## ${instance.baseUrl}\n${responseText}`);
            updateInstanceResponse(instance, 'Request failed.', responseText);
            addEventLogEntry({
                instanceId: instance.id,
                label: getInstanceLabel(instance),
                direction: 'http',
                title: 'request failed',
                body: responseText,
            });
        }
    }

    setResponseState(target, `Finished ${targetInstances.length} request(s).`, results.join('\n\n'));
};

const connectInstanceSocket = (instance: ManagedInstance) => {
    if (instance.socket && (instance.socket.readyState === WebSocket.OPEN || instance.socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    let wsUrl: string;
    try {
        wsUrl = buildStageWebSocketUrl(instance.baseUrl, instance.token);
    } catch (error) {
        instance.socketStatus = 'error';
        updateInstanceResponse(instance, 'WS URL validation failed.', describeAxiosError(error));
        setWsState('WS validation failed.', describeAxiosError(error));
        return;
    }

    instance.socketStatus = 'connecting';
    updateInstanceResponse(instance, 'Connecting WS...', wsUrl);
    renderInstances();

    const socket = new WebSocket(wsUrl);
    instance.socket = socket;

    socket.addEventListener('open', () => {
        instance.socketStatus = 'connected';
        const helloMessage = buildStageControllerHelloMessage(instance.controllerId);
        socket.send(JSON.stringify(helloMessage));
        updateInstanceResponse(instance, 'WS connected.', prettyJson(helloMessage));
        addEventLogEntry({
            instanceId: instance.id,
            label: getInstanceLabel(instance),
            direction: 'out',
            title: 'hello',
            body: prettyJson(helloMessage),
        });
        renderInstances();
        refreshWsSummary();
    });

    socket.addEventListener('message', (event) => {
        handleInstanceSocketMessage(instance, event.data);
    });

    socket.addEventListener('close', (event) => {
        instance.socketStatus = 'disconnected';
        instance.socket = null;
        instance.lastEvent = `WS closed (${event.code}${event.reason ? `, ${event.reason}` : ''}).`;
        renderInstances();
        refreshWsSummary();
    });

    socket.addEventListener('error', () => {
        instance.socketStatus = 'error';
        instance.lastEvent = 'WS error.';
        renderInstances();
        refreshWsSummary();
    });
};

const disconnectInstanceSocket = (instance: ManagedInstance) => {
    if (!instance.socket) {
        return;
    }

    instance.socket.close(1000, 'manual disconnect');
    instance.socket = null;
    instance.socketStatus = 'disconnected';
    instance.lastEvent = 'WS disconnected manually.';
    renderInstances();
    refreshWsSummary();
};

const broadcastEnvelopeToInstances = (
    targetInstances: ManagedInstance[],
    envelope: StageRealtimeEnvelope,
    summaryLabel: string,
) => {
    if (targetInstances.length === 0) {
        setWsState('No connected target.', 'Select and connect at least one instance first.');
        return;
    }

    const payloadText = prettyJson(envelope);
    const disconnectedTargets: string[] = [];

    for (const instance of targetInstances) {
        if (!instance.socket || instance.socket.readyState !== WebSocket.OPEN) {
            disconnectedTargets.push(instance.baseUrl);
            continue;
        }

        instance.socket.send(JSON.stringify(envelope));
        instance.lastEvent = `${summaryLabel} sent.`;
        instance.lastResponse = payloadText;
        addEventLogEntry({
            instanceId: instance.id,
            label: getInstanceLabel(instance),
            direction: 'out',
            title: envelope.type,
            body: payloadText,
        });
    }

    renderInstances();
    if (disconnectedTargets.length > 0) {
        setWsState(
            `Sent to ${targetInstances.length - disconnectedTargets.length} instance(s).`,
            [
                payloadText,
                '',
                '# skipped (not connected)',
                prettyJson(disconnectedTargets),
            ].join('\n'),
        );
        return;
    }

    setWsState(`Sent ${envelope.type} to ${targetInstances.length} instance(s).`, payloadText);
};

const refreshWsSummary = () => {
    const values = Array.from(instances.values());
    const connected = values.filter((instance) => instance.socketStatus === 'connected').length;
    const connecting = values.filter((instance) => instance.socketStatus === 'connecting').length;
    wsStatus.textContent = `Connected: ${connected} · Connecting: ${connecting} · Total instances: ${values.length}`;
};

const getBroadcastTargets = () => {
    const selectedInstances = getSelectedInstances();
    if (mirrorToSelectedInput.checked && selectedInstances.length > 0) {
        return selectedInstances;
    }

    return selectedInstances;
};

const sendRealtimeState = (state: StageRealtimeState, reason: string) => {
    syncRealtimeInputsFromState(state);
    const envelope = buildStageRealtimeStateMessage(state);
    const targets = getBroadcastTargets();
    broadcastEnvelopeToInstances(targets, envelope, reason);
    updatePreviews();
};

const syncTrackInputsFromSessionForm = () => {
    const trackId = normalizeText(realtimeCurrentTrackIdInput.value) || normalizeText(realtimeSessionIdInput.value) || 'stage-track-1';
    realtimeTrackTitleInput.value = normalizeText(titleInput.value);
    realtimeTrackArtistInput.value = normalizeText(artistInput.value);
    realtimeTrackAlbumInput.value = normalizeText(albumInput.value);
    realtimeTrackCoverUrlInput.value = normalizeText(coverUrlInput.value);
    realtimeCurrentTrackIdInput.value = trackId;
    if (!normalizeText(realtimeSessionIdInput.value)) {
        realtimeSessionIdInput.value = trackId;
    }
    realtimeTracksJsonInput.value = prettyJson([buildSingleTrackFromInputs()]);
    updatePreviews();
};

const performRealtimeControl = (request: StageControlRequest, reason: string) => {
    try {
        const state = buildCurrentRealtimeStateSnapshot();
        const { nextState, nextClock } = applyStageControlRequestWithClock(state, request, controllerClock);
        controllerClock = nextClock;
        sendRealtimeState(nextState, reason);
    } catch (error) {
        setWsState(`Failed to ${reason}.`, describeAxiosError(error));
    }
};

const handleInstanceSocketMessage = (instance: ManagedInstance, rawData: unknown) => {
    const text = typeof rawData === 'string' ? rawData : String(rawData);
    let parsed: StageRealtimeEnvelope | null = null;
    try {
        parsed = JSON.parse(text) as StageRealtimeEnvelope;
    } catch {
        parsed = null;
    }

    instance.lastResponse = parsed ? prettyJson(parsed) : text;
    instance.lastMessageType = parsed?.type || 'raw';
    instance.lastEvent = `Inbound ${parsed?.type || 'raw'} @ ${nowStamp()}`;
    addEventLogEntry({
        instanceId: instance.id,
        label: getInstanceLabel(instance),
        direction: 'in',
        title: parsed?.type || 'raw',
        body: parsed ? prettyJson(parsed) : text,
    });

    if (!parsed) {
        renderInstances();
        setWsState(`Received raw WS payload from ${instance.baseUrl}.`, text);
        return;
    }

    if (parsed.type === 'server_hello') {
        instance.lastServerHello = parsed.payload;
        const payload = parsed.payload as {
            session?: {
                id?: string;
                title?: string;
                artist?: string;
                album?: string;
                coverUrl?: string | null;
                coverArtUrl?: string | null;
                durationMs?: number | null;
            } | null;
            playerId?: string | null;
            realtimeState?: StageRealtimeState | null;
        };
        instance.playerId = typeof payload.playerId === 'string' ? payload.playerId : instance.playerId;
        syncSessionFieldsFromPayload(payload.session);
        if (payload.realtimeState) {
            syncRealtimeInputsFromState(payload.realtimeState);
        }
    }

    if (parsed.type === 'hello_ack') {
        instance.lastHelloAck = parsed.payload;
        const payload = parsed.payload as {
            session?: {
                id?: string;
                title?: string;
                artist?: string;
                album?: string;
                coverUrl?: string | null;
                coverArtUrl?: string | null;
                durationMs?: number | null;
            } | null;
            playerId?: string | null;
            realtimeState?: StageRealtimeState | null;
        };
        instance.playerId = typeof payload.playerId === 'string' ? payload.playerId : instance.playerId;
        syncSessionFieldsFromPayload(payload.session);
        if (payload.realtimeState) {
            syncRealtimeInputsFromState(payload.realtimeState);
        }
    }

    if (parsed.type === 'stage_state') {
        const payload = parsed.payload as StageRealtimeState;
        syncRealtimeInputsFromState(payload);
    }

    if (parsed.type === 'stage_session') {
        const payload = parsed.payload as {
            session?: {
                id?: string;
                title?: string;
                artist?: string;
                album?: string;
                coverUrl?: string | null;
                coverArtUrl?: string | null;
                durationMs?: number | null;
            } | null;
        };
        syncSessionFieldsFromPayload(payload.session);
    }

    if (parsed.type === 'control_request' && autoApplyControlRequestsInput.checked) {
        try {
            applyInboundControlRequest(instance, parsed.payload as StageControlRequest);
        } catch (error) {
            setWsState('Failed to auto-apply control_request.', describeAxiosError(error));
        }
    }

    renderInstances();
    setWsState(`Received ${parsed.type} from ${instance.baseUrl}.`, prettyJson(parsed));
    updatePreviews();
};

const connectInputEvents = (elements: HTMLElement[]) => {
    for (const element of elements) {
        element.addEventListener('input', updatePreviews);
        element.addEventListener('change', updatePreviews);
    }
};

const initializeEmptyState = () => {
    setResponseState('health', 'No request sent yet.', 'Click Test Selected to inspect the backend response.');
    setResponseState('clear', 'No request sent yet.', 'Click Clear Selected to inspect the backend response.');
    setResponseState('session', 'No request sent yet.', 'Click Push To Selected to inspect the backend response.');
    setWsState('No instance connected yet.', 'Connect at least one instance to start exchanging Stage realtime messages.');
    renderControllerClockStatus();
    renderMergedEventLog();
};

instanceList.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    const actionElement = target.closest<HTMLElement>('[data-action]');
    if (!actionElement) {
        return;
    }

    const action = actionElement.dataset.action;
    const instanceId = actionElement.dataset.instanceId;
    if (!instanceId) {
        return;
    }

    const instance = instances.get(instanceId);
    if (!instance) {
        return;
    }

    switch (action) {
        case 'use-instance':
            loadInstanceIntoDraft(instance);
            break;
        case 'test-instance-health':
            await executeRequestForInstances('health', [instance], (targetInstance) => ({
                endpoint: `${targetInstance.baseUrl}/stage/health`,
                init: { method: 'GET' },
            }));
            break;
        case 'connect-instance':
            connectInstanceSocket(instance);
            break;
        case 'disconnect-instance':
            disconnectInstanceSocket(instance);
            break;
        case 'remove-instance':
            disconnectInstanceSocket(instance);
            instances.delete(instance.id);
            if (currentDraftInstanceId === instance.id) {
                currentDraftInstanceId = null;
            }
            renderInstances();
            updatePreviews();
            refreshWsSummary();
            break;
        default:
            break;
    }
});

instanceList.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }

    if (target.dataset.action !== 'toggle-select' || !target.dataset.instanceId) {
        return;
    }

    const instance = instances.get(target.dataset.instanceId);
    if (!instance) {
        return;
    }

    instance.selected = target.checked;
    renderInstances();
    updatePreviews();
});

upsertInstanceButton.addEventListener('click', () => {
    upsertDraftInstance();
});

connectSelectedButton.addEventListener('click', () => {
    const selected = getSelectedInstances(true);
    for (const instance of selected) {
        connectInstanceSocket(instance);
    }
    refreshWsSummary();
});

disconnectSelectedButton.addEventListener('click', () => {
    const selected = getSelectedInstances();
    for (const instance of selected) {
        disconnectInstanceSocket(instance);
    }
    refreshWsSummary();
});

testHealthButton.addEventListener('click', async () => {
    const targets = getSelectedInstances();
    if (targets.length === 0) {
        const draft = getDraftInstance();
        const ephemeral = createManagedInstance(draft.baseUrl, draft.token, draft.controllerId);
        await executeRequestForInstances('health', [ephemeral], (instance) => ({
            endpoint: `${instance.baseUrl}/stage/health`,
            init: { method: 'GET' },
        }));
        return;
    }

    await executeRequestForInstances('health', targets, (instance) => ({
        endpoint: `${instance.baseUrl}/stage/health`,
        init: { method: 'GET' },
    }));
});

clearSessionButton.addEventListener('click', async () => {
    const targets = getSelectedInstances();
    if (targets.length === 0) {
        const draft = getDraftInstance();
        const ephemeral = createManagedInstance(draft.baseUrl, draft.token, draft.controllerId);
        await executeRequestForInstances('clear', [ephemeral], (instance) => buildStageClearRequest(instance.baseUrl, instance.token));
        return;
    }

    await executeRequestForInstances('clear', targets, (instance) => buildStageClearRequest(instance.baseUrl, instance.token));
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const targets = getSelectedInstances();
    if (targets.length === 0) {
        const draft = getDraftInstance();
        const ephemeral = createManagedInstance(draft.baseUrl, draft.token, draft.controllerId);
        await executeRequestForInstances('session', [ephemeral], () => buildStageSessionRequest(buildRequestInput()));
        return;
    }

    await executeRequestForInstances('session', targets, (instance) =>
        buildStageSessionRequest({
            ...buildRequestInput(),
            baseUrl: instance.baseUrl,
            token: instance.token,
        }),
    );
});

syncTrackFromSessionButton.addEventListener('click', () => {
    syncTrackInputsFromSessionForm();
});

broadcastStateButton.addEventListener('click', () => {
    try {
        sendRealtimeState(buildRealtimeStateDraft(), 'manual stage_state');
    } catch (error) {
        setWsState('Failed to build stage_state.', describeAxiosError(error));
    }
});

controlPlayButton.addEventListener('click', () => {
    performRealtimeControl(buildManualControlRequest('play'), 'play');
});

controlPauseButton.addEventListener('click', () => {
    performRealtimeControl(buildManualControlRequest('pause'), 'pause');
});

controlSeekButton.addEventListener('click', () => {
    performRealtimeControl(buildManualControlRequest('seek', {
        timeMs: Math.max(0, Math.floor(Number(seekTargetMsInput.value) || 0)),
    }), 'seek');
});

controlNextButton.addEventListener('click', () => {
    performRealtimeControl(buildManualControlRequest('next'), 'next');
});

controlPrevButton.addEventListener('click', () => {
    performRealtimeControl(buildManualControlRequest('prev'), 'prev');
});

controlCycleLoopButton.addEventListener('click', () => {
    performRealtimeControl(buildManualControlRequest('set_loop_mode', {
        loopMode: cycleLoopMode(buildCurrentRealtimeStateSnapshot().loopMode),
    }), 'cycle loop');
});

const appendStaleRequestLog = (instance: ManagedInstance, request: StageControlRequest, currentRevision: number) => {
    addEventLogEntry({
        instanceId: instance.id,
        label: getInstanceLabel(instance),
        direction: 'system',
        title: 'stale_request',
        body: prettyJson({
            requestId: request.requestId,
            type: request.type,
            receivedBaseRevision: request.baseRevision,
            expectedRevision: currentRevision,
        }),
    });
};

const isStaleControlRequest = (request: StageControlRequest, currentRevision: number) => (
    request.baseRevision !== currentRevision
);

const applyInboundControlRequest = (instance: ManagedInstance, request: StageControlRequest) => {
    const currentState = buildCurrentRealtimeStateSnapshot();
    if (isStaleControlRequest(request, currentState.revision)) {
        appendStaleRequestLog(instance, request, currentState.revision);
        setWsState(
            'Rejected stale control_request.',
            prettyJson({
                code: 'STALE_CONTROL_REQUEST',
                requestId: request.requestId,
                expectedRevision: currentState.revision,
                receivedBaseRevision: request.baseRevision,
            }),
        );
        return;
    }

    const { nextState, nextClock } = applyStageControlRequestWithClock(
        currentState,
        request,
        controllerClock,
    );
    controllerClock = nextClock;
    const targets = mirrorToSelectedInput.checked ? getBroadcastTargets() : [instance];
    syncRealtimeInputsFromState(nextState);
    broadcastEnvelopeToInstances(targets, buildStageRealtimeStateMessage(nextState), 'auto-applied control_request');
};

connectInputEvents([
    baseUrlInput,
    tokenInput,
    controllerIdInput,
    titleInput,
    artistInput,
    albumInput,
    coverUrlInput,
    coverFileInput,
    audioUrlInput,
    audioFileInput,
    lyricsFormatSelect,
    lyricsFileInput,
    lyricsTextInput,
    realtimeSessionIdInput,
    realtimeCurrentTrackIdInput,
    realtimePlayerStateSelect,
    realtimeCurrentTimeMsInput,
    realtimeDurationMsInput,
    realtimeLoopModeSelect,
    realtimeTrackTitleInput,
    realtimeTrackArtistInput,
    realtimeTrackAlbumInput,
    realtimeTrackCoverUrlInput,
    realtimeCanGoNextInput,
    realtimeCanGoPrevInput,
    realtimeTracksJsonInput,
    autoApplyControlRequestsInput,
    mirrorToSelectedInput,
    seekTargetMsInput,
]);

initializeEmptyState();
const initialInstance = upsertDraftInstance();
loadInstanceIntoDraft(initialInstance);
syncTrackInputsFromSessionForm();
renderInstances();
updatePreviews();
refreshWsSummary();
window.setInterval(refreshRealtimeTimeFromClock, 250);
