import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { PlayerState, type StageControlRequest, type StageRealtimeState, type StageTrack } from '../src/types';
import '../src/index.css';
import {
    buildStageControllerHelloMessage,
    buildStageControlRequestPayload,
    buildStageRealtimeStateMessage,
    buildStageSessionRequest,
    buildStageWebSocketUrl,
    type StageRealtimeEnvelope,
} from '../src/utils/stageClientDemo';
import {
    applyStageControlRequestWithClock,
    createStageControllerClock,
    formatControllerClockStatus,
    getControllerClockTimeMs,
    syncControllerClockFromState,
} from '../test/manual/stage-client/controllerClock';
import type { ConductorEvent, ConductorInstance, ConductorTrack } from './types';
import './style.css';

// Minimal Folia Conductor UI keeps controller tasks in one place: client status, transport controls, progress, and uploaded playlist tracks.

const getInput = <T extends HTMLElement>(id: string) => {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing required element: ${id}`);
    }
    return element as T;
};

const baseUrlInput = getInput<HTMLInputElement>('base-url');
const tokenInput = getInput<HTMLInputElement>('token');
const controllerIdInput = getInput<HTMLInputElement>('controller-id');
const selectionSummaryInput = getInput<HTMLInputElement>('selection-summary');
const upsertInstanceButton = getInput<HTMLButtonElement>('upsert-instance');
const connectSelectedButton = getInput<HTMLButtonElement>('connect-selected');
const disconnectSelectedButton = getInput<HTMLButtonElement>('disconnect-selected');
const controllerStatus = getInput<HTMLDivElement>('controller-status');
const statusPill = getInput<HTMLDivElement>('status-pill');
const clientsTotal = getInput<HTMLSpanElement>('clients-total');
const clientsConnected = getInput<HTMLSpanElement>('clients-connected');
const clientsConnecting = getInput<HTMLSpanElement>('clients-connecting');
const instanceList = getInput<HTMLDivElement>('instance-list');

const currentTrackTitle = getInput<HTMLHeadingElement>('current-track-title');
const currentTrackMeta = getInput<HTMLParagraphElement>('current-track-meta');
const currentTrackSource = getInput<HTMLParagraphElement>('current-track-source');
const playerCover = getInput<HTMLDivElement>('player-cover');
const playbackStatePill = getInput<HTMLSpanElement>('playback-state-pill');
const clockPill = getInput<HTMLSpanElement>('clock-pill');
const revisionPill = getInput<HTMLSpanElement>('revision-pill');
const playerProgress = getInput<HTMLInputElement>('player-progress');
const playerProgressFill = getInput<HTMLDivElement>('player-progress-fill');
const progressCurrent = getInput<HTMLSpanElement>('progress-current');
const progressDuration = getInput<HTMLSpanElement>('progress-duration');
const pushActiveTrackButton = getInput<HTMLButtonElement>('push-active-track');
const syncFoliaStateButton = getInput<HTMLButtonElement>('sync-folia-state');
const prevTrackButton = getInput<HTMLButtonElement>('prev-track');
const playTrackButton = getInput<HTMLButtonElement>('play-track');
const pauseTrackButton = getInput<HTMLButtonElement>('pause-track');
const nextTrackButton = getInput<HTMLButtonElement>('next-track');

const playlistFilesInput = getInput<HTMLInputElement>('playlist-files');
const clearPlaylistButton = getInput<HTMLButtonElement>('clear-playlist');
const playlistList = getInput<HTMLDivElement>('playlist-list');

const feedbackStatus = getInput<HTMLDivElement>('feedback-status');
const feedbackBody = getInput<HTMLElement>('feedback-body');
const eventList = getInput<HTMLDivElement>('event-list');

const instances = new Map<string, ConductorInstance>();
const events: ConductorEvent[] = [];
let playlist: ConductorTrack[] = [];
let activeTrackId: string | null = null;
let lastKnownRealtimeState: StageRealtimeState | null = null;
let controllerClock = createStageControllerClock();
let currentDraftInstanceId: string | null = null;
let isProgressDragging = false;
let lastFoliaSourceLabel = '';

const normalizeText = (value?: string | null) => value?.trim() ?? '';
const normalizeBaseUrl = (value: string) => normalizeText(value).replace(/\/+$/, '');
const prettyJson = (value: unknown) => JSON.stringify(value, null, 2);
const formatDurationLabel = (timeMs: number) => {
    const totalSeconds = Math.max(0, Math.floor((timeMs || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};
const nowStamp = () => new Date().toLocaleTimeString();

const addEvent = (title: string, body: string) => {
    events.unshift({
        id: crypto.randomUUID(),
        title,
        body,
        at: Date.now(),
    });
    if (events.length > 18) {
        events.length = 18;
    }
    renderEvents();
};

const setFeedback = (summary: string, details: string) => {
    feedbackStatus.textContent = summary;
    feedbackBody.textContent = details;
};

const createAxiosConfig = (
    request: ReturnType<typeof buildStageSessionRequest>,
): AxiosRequestConfig => {
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
    controllerId: normalizeText(controllerIdInput.value) || 'folia-conductor-demo',
});

const getSelectedInstances = () => Array.from(instances.values()).filter((instance) => instance.selected);
const getConnectedInstances = () => Array.from(instances.values()).filter((instance) => instance.socketStatus === 'connected' && instance.socket?.readyState === WebSocket.OPEN);
const resolveTargetInstances = () => {
    const selected = getSelectedInstances();
    return selected.length > 0 ? selected : Array.from(instances.values());
};
const resolveConnectedTargets = () => resolveTargetInstances().filter((instance) => instance.socketStatus === 'connected' && instance.socket?.readyState === WebSocket.OPEN);

const getCurrentRealtimeState = () => lastKnownRealtimeState;

const resolveActiveTrack = () =>
    playlist.find((track) => track.id === activeTrackId)
    || playlist.find((track) => track.foliaSessionId && track.foliaSessionId === lastKnownRealtimeState?.sessionId)
    || playlist[0]
    || null;

const buildRealtimeTracksFromPlaylist = (): StageTrack[] => playlist.map((track) => ({
    trackId: track.id,
    title: track.title || 'Stage Track',
    artist: track.artist,
    album: track.album,
    coverUrl: track.coverUrl,
    durationMs: track.foliaDurationMs ?? track.durationMs,
}));

const buildRealtimeStateSnapshot = (): StageRealtimeState => {
    const activeTrack = resolveActiveTrack();
    const tracks = buildRealtimeTracksFromPlaylist();
    const fallbackTrackId = activeTrack?.id || tracks[0]?.trackId || null;
    const existing = lastKnownRealtimeState;
    return {
        revision: existing?.revision || 0,
        sessionId: activeTrack?.foliaSessionId || activeTrack?.id || existing?.sessionId || null,
        tracks,
        currentTrackId: fallbackTrackId || existing?.currentTrackId || null,
        playerState: existing?.playerState || PlayerState.IDLE,
        currentTimeMs: existing?.currentTimeMs || 0,
        durationMs: activeTrack?.foliaDurationMs || activeTrack?.durationMs || existing?.durationMs || 0,
        loopMode: existing?.loopMode || 'off',
        canGoNext: playlist.length > 1,
        canGoPrev: playlist.length > 1,
        updatedAt: Date.now(),
    };
};

const renderEvents = () => {
    if (events.length === 0) {
        eventList.innerHTML = '<div class="empty-state">No controller events yet.</div>';
        return;
    }

    eventList.innerHTML = events.map((entry) => `
        <article class="event-item">
            <div class="event-head">
                <strong>${entry.title}</strong>
                <span>${new Date(entry.at).toLocaleTimeString()}</span>
            </div>
            <div class="event-body">${entry.body.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</div>
        </article>
    `).join('');
};

const updateSelectionSummary = () => {
    const selected = getSelectedInstances();
    selectionSummaryInput.value = `${selected.length} selected`;
};

const renderStatusSummary = () => {
    const all = Array.from(instances.values());
    const connected = all.filter((instance) => instance.socketStatus === 'connected').length;
    const connecting = all.filter((instance) => instance.socketStatus === 'connecting').length;
    clientsTotal.textContent = `${all.length} total`;
    clientsConnected.textContent = `${connected} connected`;
    clientsConnecting.textContent = `${connecting} connecting`;
    statusPill.textContent = `${connected}/${all.length} clients connected`;
};

const renderInstances = () => {
    updateSelectionSummary();
    renderStatusSummary();

    const all = Array.from(instances.values());
    if (all.length === 0) {
        instanceList.innerHTML = '<div class="empty-state">Add one or more Folia Stage endpoints to start controlling clients.</div>';
        return;
    }

    instanceList.innerHTML = all.map((instance) => `
        <article class="instance-card" data-instance-id="${instance.id}">
            <input class="instance-select" type="checkbox" data-action="toggle-select" ${instance.selected ? 'checked' : ''} />
            <div>
                <div class="instance-title-row">
                    <strong>${instance.baseUrl}</strong>
                    <span class="status-dot ${instance.socketStatus}"></span>
                </div>
                <div class="instance-meta">
                    <div>${instance.controllerId}</div>
                    <div>player ${instance.playerId || 'pending'} · ${instance.socketStatus}</div>
                    <div>${instance.lastEvent || 'No events yet.'}</div>
                </div>
            </div>
            <div class="button-row">
                <button type="button" class="secondary" data-action="connect">Connect</button>
                <button type="button" class="secondary" data-action="disconnect">Disconnect</button>
            </div>
        </article>
    `).join('');
};

const renderPlaylist = () => {
    if (playlist.length === 0) {
        playlistList.innerHTML = '<div class="empty-state">Import audio files to build the controller playlist.</div>';
        return;
    }

    playlistList.innerHTML = playlist.map((track, index) => `
        <article class="playlist-item ${track.id === activeTrackId ? 'active' : ''}" data-track-id="${track.id}">
            <div class="playlist-item-copy">
                <div class="playlist-title-row">
                    <strong>${track.title}</strong>
                    <span>#${index + 1}</span>
                </div>
                <div class="playlist-item-meta">
                    ${(track.artist || 'Unknown artist')}${track.album ? ` · ${track.album}` : ''}
                    ${track.foliaDurationMs ? ` · ${formatDurationLabel(track.foliaDurationMs)}` : ''}
                </div>
            </div>
            <div class="playlist-item-actions">
                <button type="button" class="secondary" data-action="activate">Select</button>
                <button type="button" class="secondary" data-action="remove">Remove</button>
            </div>
        </article>
    `).join('');
};

const renderPlayer = () => {
    const activeTrack = resolveActiveTrack();
    const realtimeState = getCurrentRealtimeState();
    const stateTrack = realtimeState?.tracks.find((track) => track.trackId === realtimeState.currentTrackId) || null;
    const title = stateTrack?.title || activeTrack?.title || 'No track selected';
    const meta = [stateTrack?.artist || activeTrack?.artist || '', stateTrack?.album || activeTrack?.album || ''].filter(Boolean).join(' · ');
    const currentTimeMs = realtimeState ? getControllerClockTimeMs(controllerClock) : 0;
    const durationMs = realtimeState?.durationMs || activeTrack?.foliaDurationMs || activeTrack?.durationMs || 0;
    const coverUrl = activeTrack?.coverUrl || stateTrack?.coverUrl || null;

    currentTrackTitle.textContent = title;
    currentTrackMeta.textContent = meta || '等待 Folia 返回歌曲 metadata';
    currentTrackSource.textContent = lastFoliaSourceLabel || '还没有收到 Folia 的 stage_state';
    playbackStatePill.textContent = realtimeState?.playerState || 'IDLE';
    clockPill.textContent = formatControllerClockStatus(controllerClock);
    revisionPill.textContent = `Revision ${realtimeState?.revision || 0}`;
    playerProgress.max = String(Math.max(durationMs, 0));
    if (!isProgressDragging) {
        playerProgress.value = String(Math.min(currentTimeMs, Math.max(durationMs, 0)));
        progressCurrent.textContent = formatDurationLabel(currentTimeMs);
    }
    progressDuration.textContent = formatDurationLabel(durationMs);
    const percent = durationMs > 0 ? (Math.min(currentTimeMs, durationMs) / durationMs) * 100 : 0;
    playerProgressFill.style.width = `${percent}%`;

    if (coverUrl) {
        playerCover.style.backgroundImage = `url("${coverUrl.replaceAll('"', '%22')}")`;
        playerCover.textContent = '';
    } else {
        playerCover.style.backgroundImage = '';
        playerCover.textContent = 'No Cover';
    }
};

const syncTrackFromSession = (session: {
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

    const targetTrack = resolveActiveTrack()
        || playlist.find((track) => track.foliaSessionId === session.id)
        || null;
    if (!targetTrack) {
        return;
    }

    if (typeof session.id === 'string' && session.id.trim()) {
        targetTrack.foliaSessionId = session.id;
    }
    if (typeof session.title === 'string' && session.title.trim()) {
        targetTrack.title = session.title;
    }
    if (typeof session.artist === 'string') {
        targetTrack.artist = session.artist;
    }
    if (typeof session.album === 'string') {
        targetTrack.album = session.album;
    }
    if (typeof session.coverArtUrl === 'string' && session.coverArtUrl.trim()) {
        targetTrack.coverUrl = session.coverArtUrl;
    } else if (typeof session.coverUrl === 'string' && session.coverUrl.trim()) {
        targetTrack.coverUrl = session.coverUrl;
    }
    if (Number.isFinite(session.durationMs)) {
        targetTrack.foliaDurationMs = Math.max(0, Math.floor(Number(session.durationMs)));
    }
};

const syncRealtimeState = (state: StageRealtimeState, sourceLabel: string) => {
    if (lastKnownRealtimeState && state.revision < lastKnownRealtimeState.revision) {
        addEvent('stale stage_state', prettyJson({
            receivedRevision: state.revision,
            currentRevision: lastKnownRealtimeState.revision,
        }));
        return;
    }

    lastKnownRealtimeState = state;
    controllerClock = syncControllerClockFromState(controllerClock, state);
    lastFoliaSourceLabel = sourceLabel;
    const matchingTrack = playlist.find((track) => track.id === state.currentTrackId || track.foliaSessionId === state.sessionId);
    if (matchingTrack) {
        activeTrackId = matchingTrack.id;
        if (Number.isFinite(state.durationMs)) {
            matchingTrack.foliaDurationMs = Math.max(0, Math.floor(Number(state.durationMs)));
        }
    }
    renderPlaylist();
    renderPlayer();
};

const describeAxiosResponse = (response: AxiosResponse) => [
    `status: ${response.status} ${response.statusText}`,
    '',
    '# headers',
    prettyJson(response.headers),
    '',
    '# body',
    typeof response.data === 'string' ? response.data : prettyJson(response.data),
].join('\n');

const describeError = (error: unknown) => {
    if (axios.isAxiosError(error)) {
        if (error.response) {
            return describeAxiosResponse(error.response);
        }
        return `${error.message}\n\n${prettyJson({
            code: error.code || null,
            url: error.config?.url || null,
            method: error.config?.method || null,
        })}`;
    }
    return error instanceof Error ? error.message : String(error);
};

const sendEnvelopeToInstances = (targets: ConductorInstance[], envelope: StageRealtimeEnvelope, reason: string) => {
    if (targets.length === 0) {
        setFeedback('No connected clients selected.', 'Connect at least one Folia instance before sending controller state.');
        return;
    }

    for (const instance of targets) {
        if (!instance.socket || instance.socket.readyState !== WebSocket.OPEN) {
            continue;
        }
        instance.socket.send(JSON.stringify(envelope));
        instance.lastEvent = `${reason} at ${nowStamp()}`;
        instance.lastMessageType = envelope.type;
    }

    addEvent(reason, prettyJson(envelope));
    renderInstances();
};

const buildControlRequest = (type: StageControlRequest['type'], payload?: StageControlRequest['payload']): StageControlRequest => ({
    ...buildStageControlRequestPayload({
        type,
        payload,
        baseRevision: lastKnownRealtimeState?.revision || 0,
    }),
});

const buildSessionRequestInputFromTrack = (track: ConductorTrack, instance: ConductorInstance) => ({
    baseUrl: instance.baseUrl,
    token: instance.token,
    title: track.title,
    artist: track.artist,
    album: track.album,
    coverUrl: track.audioFile ? '' : (track.coverUrl || ''),
    audioUrl: track.audioUrl || '',
    audioFile: track.audioFile,
    lyricsText: track.lyricsText || '',
    lyricsFormat: track.lyricsFormat || undefined,
});

// Push the active controller track as the new single-song Stage session for each selected Folia terminal.
const pushTrackToInstances = async (track: ConductorTrack, targets: ConductorInstance[]) => {
    if (targets.length === 0) {
        setFeedback('No target clients selected.', 'Add and select at least one Folia client before pushing a track.');
        return;
    }

    activeTrackId = track.id;
    const responseSnippets: string[] = [];
    for (const instance of targets) {
        try {
            const request = buildStageSessionRequest(buildSessionRequestInputFromTrack(track, instance));
            const response = await axios.request(createAxiosConfig(request));
            const responseText = describeAxiosResponse(response);
            responseSnippets.push(`## ${instance.baseUrl}\n${responseText}`);
            instance.lastResponse = responseText;
            instance.lastEvent = `session pushed at ${nowStamp()}`;
            const payload = response.data as {
                session?: {
                    id?: string;
                    title?: string;
                    artist?: string;
                    album?: string;
                    coverUrl?: string | null;
                    coverArtUrl?: string | null;
                    durationMs?: number | null;
                } | null;
                realtimeState?: StageRealtimeState | null;
            };
            syncTrackFromSession(payload.session);
            if (payload.realtimeState) {
                syncRealtimeState(payload.realtimeState, `from ${instance.baseUrl}`);
            }
        } catch (error) {
            responseSnippets.push(`## ${instance.baseUrl}\n${describeError(error)}`);
        }
    }

    renderPlaylist();
    renderPlayer();
    setFeedback(`Pushed ${track.title} to ${targets.length} client(s).`, responseSnippets.join('\n\n'));
};

const moveActiveTrack = async (direction: 'next' | 'prev') => {
    if (playlist.length === 0) {
        setFeedback('Playlist is empty.', 'Import audio files first.');
        return;
    }

    const active = resolveActiveTrack() || playlist[0];
    const currentIndex = Math.max(0, playlist.findIndex((track) => track.id === active.id));
    let targetIndex = currentIndex;
    if (direction === 'next') {
        targetIndex = currentIndex < playlist.length - 1 ? currentIndex + 1 : 0;
    } else {
        targetIndex = currentIndex > 0 ? currentIndex - 1 : playlist.length - 1;
    }

    const targetTrack = playlist[targetIndex];
    if (!targetTrack) {
        return;
    }

    activeTrackId = targetTrack.id;
    renderPlaylist();
    renderPlayer();
    await pushTrackToInstances(targetTrack, resolveTargetInstances());
};

const performLocalTransportControl = (type: StageControlRequest['type'], payload?: StageControlRequest['payload']) => {
    const currentState = getCurrentRealtimeState();
    if (!currentState) {
        setFeedback('No Folia state yet.', 'Wait for stage_state before sending transport controls.');
        return;
    }

    const request = buildControlRequest(type, payload);
    const { nextState, nextClock } = applyStageControlRequestWithClock(currentState, request, controllerClock);
    controllerClock = nextClock;
    syncRealtimeState(nextState, 'from controller');
    sendEnvelopeToInstances(resolveConnectedTargets(), buildStageRealtimeStateMessage(nextState), `controller ${type}`);
};

const handleInboundControlRequest = async (instance: ConductorInstance, request: StageControlRequest) => {
    if (request.baseRevision !== (lastKnownRealtimeState?.revision || 0)) {
        addEvent('stale_request', prettyJson({
            requestId: request.requestId,
            expectedRevision: lastKnownRealtimeState?.revision || 0,
            receivedBaseRevision: request.baseRevision,
        }));
        return;
    }

    if (request.type === 'next' || request.type === 'prev') {
        await moveActiveTrack(request.type);
        return;
    }

    const currentState = getCurrentRealtimeState();
    if (!currentState) {
        return;
    }

    const { nextState, nextClock } = applyStageControlRequestWithClock(currentState, request, controllerClock);
    controllerClock = nextClock;
    syncRealtimeState(nextState, `from ${instance.baseUrl}`);
    sendEnvelopeToInstances(resolveConnectedTargets(), buildStageRealtimeStateMessage(nextState), `auto-applied ${request.type}`);
};

const connectInstanceSocket = (instance: ConductorInstance) => {
    if (instance.socket && (instance.socket.readyState === WebSocket.OPEN || instance.socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    let wsUrl = '';
    try {
        wsUrl = buildStageWebSocketUrl(instance.baseUrl, instance.token);
    } catch (error) {
        instance.socketStatus = 'error';
        instance.lastEvent = describeError(error);
        renderInstances();
        return;
    }

    const socket = new WebSocket(wsUrl);
    instance.socket = socket;
    instance.socketStatus = 'connecting';
    instance.lastEvent = 'Connecting...';
    renderInstances();

    socket.addEventListener('open', () => {
        instance.socketStatus = 'connected';
        instance.lastEvent = `WS open at ${nowStamp()}`;
        socket.send(JSON.stringify(buildStageControllerHelloMessage(instance.controllerId)));
        addEvent(`ws open ${instance.baseUrl}`, buildStageControllerHelloMessage(instance.controllerId).type);
        renderInstances();
    });

    socket.addEventListener('close', () => {
        instance.socketStatus = 'disconnected';
        instance.socket = null;
        instance.lastEvent = `WS closed at ${nowStamp()}`;
        renderInstances();
    });

    socket.addEventListener('error', () => {
        instance.socketStatus = 'error';
        instance.lastEvent = `WS error at ${nowStamp()}`;
        renderInstances();
    });

    socket.addEventListener('message', (event) => {
        try {
            const parsed = JSON.parse(String(event.data)) as StageRealtimeEnvelope;
            instance.lastMessageType = parsed.type;
            instance.lastEvent = `${parsed.type} at ${nowStamp()}`;

            if (parsed.type === 'server_hello' || parsed.type === 'hello_ack') {
                const payload = parsed.payload as {
                    playerId?: string | null;
                    session?: {
                        id?: string;
                        title?: string;
                        artist?: string;
                        album?: string;
                        coverUrl?: string | null;
                        coverArtUrl?: string | null;
                        durationMs?: number | null;
                    } | null;
                    realtimeState?: StageRealtimeState | null;
                };
                instance.playerId = typeof payload.playerId === 'string' ? payload.playerId : instance.playerId;
                syncTrackFromSession(payload.session);
                if (payload.realtimeState) {
                    syncRealtimeState(payload.realtimeState, `from ${instance.baseUrl}`);
                }
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
                    realtimeState?: StageRealtimeState | null;
                };
                syncTrackFromSession(payload.session);
                if (payload.realtimeState) {
                    syncRealtimeState(payload.realtimeState, `from ${instance.baseUrl}`);
                }
            }

            if (parsed.type === 'stage_state') {
                const payload = parsed.payload as StageRealtimeState;
                instance.lastRealtimeState = payload;
                syncRealtimeState(payload, `from ${instance.baseUrl}`);
            }

            if (parsed.type === 'control_request') {
                void handleInboundControlRequest(instance, parsed.payload as StageControlRequest);
            }

            addEvent(`${instance.baseUrl} · ${parsed.type}`, prettyJson(parsed));
            setFeedback(`Received ${parsed.type} from ${instance.baseUrl}.`, prettyJson(parsed));
            renderInstances();
            renderPlaylist();
            renderPlayer();
        } catch (error) {
            setFeedback('Failed to parse Stage WS payload.', describeError(error));
        }
    });
};

const disconnectInstanceSocket = (instance: ConductorInstance) => {
    if (instance.socket) {
        instance.socket.close();
    }
    instance.socket = null;
    instance.socketStatus = 'disconnected';
    instance.lastEvent = `Disconnected at ${nowStamp()}`;
    renderInstances();
};

const upsertDraftInstance = () => {
    const draft = getDraftInstance();
    if (!draft.baseUrl || !draft.token) {
        setFeedback('Missing connection draft fields.', 'Stage address and bearer token are both required.');
        return;
    }

    const existing = currentDraftInstanceId ? instances.get(currentDraftInstanceId) : null;
    if (existing) {
        existing.baseUrl = draft.baseUrl;
        existing.token = draft.token;
        existing.controllerId = draft.controllerId;
        existing.lastEvent = `Updated at ${nowStamp()}`;
    } else {
        const id = crypto.randomUUID();
        instances.set(id, {
            id,
            baseUrl: draft.baseUrl,
            token: draft.token,
            controllerId: draft.controllerId,
            selected: true,
            socket: null,
            socketStatus: 'disconnected',
            playerId: null,
            lastEvent: `Added at ${nowStamp()}`,
            lastMessageType: null,
            lastResponse: '',
            lastRealtimeState: null,
        });
        currentDraftInstanceId = id;
    }

    controllerStatus.textContent = `Draft saved for ${draft.baseUrl}.`;
    renderInstances();
};

const createPlaylistTracksFromAudioFiles = (files: File[]) => files.map<ConductorTrack>((file) => ({
    id: crypto.randomUUID(),
    title: file.name.replace(/\.[^.]+$/, ''),
    artist: '',
    album: '',
    coverUrl: null,
    audioFile: file,
    audioUrl: null,
    lyricsText: null,
    lyricsFormat: null,
    durationMs: null,
    foliaSessionId: null,
    foliaDurationMs: null,
}));

const activateTrack = (trackId: string) => {
    activeTrackId = trackId;
    renderPlaylist();
    renderPlayer();
};

instanceList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>('[data-instance-id]');
    if (!card) {
        return;
    }

    const instance = instances.get(card.dataset.instanceId || '');
    if (!instance) {
        return;
    }

    const action = target.getAttribute('data-action');
    if (action === 'connect') {
        connectInstanceSocket(instance);
    } else if (action === 'disconnect') {
        disconnectInstanceSocket(instance);
    }
});

instanceList.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    const card = target.closest<HTMLElement>('[data-instance-id]');
    if (!card) {
        return;
    }

    const instance = instances.get(card.dataset.instanceId || '');
    if (!instance) {
        return;
    }

    if (target.getAttribute('data-action') === 'toggle-select') {
        instance.selected = target.checked;
        currentDraftInstanceId = instance.id;
        baseUrlInput.value = instance.baseUrl;
        tokenInput.value = instance.token;
        controllerIdInput.value = instance.controllerId;
        renderInstances();
    }
});

playlistList.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>('[data-track-id]');
    if (!card) {
        return;
    }

    const track = playlist.find((candidate) => candidate.id === card.dataset.trackId);
    if (!track) {
        return;
    }

    const action = target.getAttribute('data-action');
    if (action === 'activate') {
        activateTrack(track.id);
        await pushTrackToInstances(track, resolveTargetInstances());
    }
    if (action === 'remove') {
        playlist = playlist.filter((candidate) => candidate.id !== track.id);
        if (activeTrackId === track.id) {
            activeTrackId = playlist[0]?.id || null;
        }
        renderPlaylist();
        renderPlayer();
    }
});

upsertInstanceButton.addEventListener('click', upsertDraftInstance);
connectSelectedButton.addEventListener('click', () => {
    const selected = getSelectedInstances();
    for (const instance of selected) {
        connectInstanceSocket(instance);
    }
});
disconnectSelectedButton.addEventListener('click', () => {
    const selected = getSelectedInstances();
    for (const instance of selected) {
        disconnectInstanceSocket(instance);
    }
});
playlistFilesInput.addEventListener('change', () => {
    const files = Array.from(playlistFilesInput.files || []);
    if (files.length === 0) {
        return;
    }

    playlist = [...playlist, ...createPlaylistTracksFromAudioFiles(files)];
    activeTrackId = activeTrackId || playlist[0]?.id || null;
    playlistFilesInput.value = '';
    renderPlaylist();
    renderPlayer();
});
clearPlaylistButton.addEventListener('click', () => {
    playlist = [];
    activeTrackId = null;
    renderPlaylist();
    renderPlayer();
});
pushActiveTrackButton.addEventListener('click', async () => {
    const activeTrack = resolveActiveTrack();
    if (!activeTrack) {
        setFeedback('No active track.', 'Select a playlist item first.');
        return;
    }
    await pushTrackToInstances(activeTrack, resolveTargetInstances());
});
syncFoliaStateButton.addEventListener('click', () => {
    const bestSource = Array.from(instances.values()).find((instance) => instance.lastRealtimeState);
    if (!bestSource?.lastRealtimeState) {
        setFeedback('No Folia state available.', 'Connect to a Folia client and wait for server_hello or stage_state.');
        return;
    }
    syncRealtimeState(bestSource.lastRealtimeState, `from ${bestSource.baseUrl}`);
    setFeedback(`Synced from ${bestSource.baseUrl}.`, prettyJson(bestSource.lastRealtimeState));
});
prevTrackButton.addEventListener('click', async () => {
    await moveActiveTrack('prev');
});
nextTrackButton.addEventListener('click', async () => {
    await moveActiveTrack('next');
});
playTrackButton.addEventListener('click', () => {
    performLocalTransportControl('play');
});
pauseTrackButton.addEventListener('click', () => {
    performLocalTransportControl('pause', { timeMs: Number(playerProgress.value) || 0 });
});

playerProgress.addEventListener('pointerdown', () => {
    isProgressDragging = true;
});
playerProgress.addEventListener('input', () => {
    isProgressDragging = true;
    progressCurrent.textContent = formatDurationLabel(Number(playerProgress.value) || 0);
    const durationMs = Number(playerProgress.max) || 0;
    const current = Number(playerProgress.value) || 0;
    const percent = durationMs > 0 ? (current / durationMs) * 100 : 0;
    playerProgressFill.style.width = `${percent}%`;
});
playerProgress.addEventListener('pointerup', () => {
    isProgressDragging = false;
});
playerProgress.addEventListener('blur', () => {
    isProgressDragging = false;
});
playerProgress.addEventListener('change', () => {
    isProgressDragging = false;
    const timeMs = Number(playerProgress.value) || 0;
    performLocalTransportControl('seek', { timeMs });
});

window.setInterval(() => {
    if (!lastKnownRealtimeState) {
        return;
    }
    renderPlayer();
}, 250);

renderInstances();
renderPlaylist();
renderPlayer();
renderEvents();
