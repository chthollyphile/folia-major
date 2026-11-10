import '../../../src/index.css';
import './style.css';
import {
    buildStageClearRequest,
    buildStageHealthRequest,
    buildStageLyricsRequest,
    buildStagePlayRequest,
    buildStagePlayerControlRequest,
    buildStagePlayerQueueGetRequest,
    buildStagePlayerQueueRequest,
    buildStagePlayerStatusRequest,
    buildStagePlayerTimeRequest,
    buildStagePlayerWebSocketUrl,
    buildStageSearchRequest,
    buildStageSessionRequest,
    buildStageStatusRequest,
    type StageRequestBuildResult,
    type StageSongRefInput,
} from '../../../src/utils/stageClientDemo';
import type { StageSearchResult } from '../../../src/types';

// Manual Stage API docs keep example snippets and live requests aligned
// with the current local-only desktop protocol.

const getElement = <T extends HTMLElement>(id: string) => {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing required element: ${id}`);
    }
    return element as T;
};

const baseUrlInput = getElement<HTMLInputElement>('base-url');
const tokenInput = getElement<HTMLInputElement>('token');

const healthPreview = getElement<HTMLElement>('health-preview');
const healthStatus = getElement<HTMLElement>('health-status');
const healthResponse = getElement<HTMLElement>('health-response');
const healthExample = getElement<HTMLElement>('health-example');

const statusPreview = getElement<HTMLElement>('status-preview');
const statusStatus = getElement<HTMLElement>('status-status');
const statusResponse = getElement<HTMLElement>('status-response');
const statusExample = getElement<HTMLElement>('status-example');

const clearPreview = getElement<HTMLElement>('clear-preview');
const clearStatus = getElement<HTMLElement>('clear-status');
const clearResponse = getElement<HTMLElement>('clear-response');
const clearExample = getElement<HTMLElement>('clear-example');

const lyricsTitleInput = getElement<HTMLInputElement>('lyrics-title');
const lyricsArtistInput = getElement<HTMLInputElement>('lyrics-artist');
const lyricsAlbumInput = getElement<HTMLInputElement>('lyrics-album');
const lyricsSourceJsonInput = getElement<HTMLTextAreaElement>('lyrics-source-json');
const lyricsPreview = getElement<HTMLElement>('lyrics-preview');
const lyricsStatus = getElement<HTMLElement>('lyrics-status');
const lyricsResponse = getElement<HTMLElement>('lyrics-response');
const lyricsExample = getElement<HTMLElement>('lyrics-example');

const titleInput = getElement<HTMLInputElement>('title');
const artistInput = getElement<HTMLInputElement>('artist');
const albumInput = getElement<HTMLInputElement>('album');
const coverUrlInput = getElement<HTMLInputElement>('cover-url');
const audioUrlInput = getElement<HTMLInputElement>('audio-url');
const lyricsTextInput = getElement<HTMLTextAreaElement>('lyrics-text');
const lyricsFormatInput = getElement<HTMLSelectElement>('lyrics-format');
const audioFileInput = getElement<HTMLInputElement>('audio-file');
const lyricsFileInput = getElement<HTMLInputElement>('lyrics-file');
const coverFileInput = getElement<HTMLInputElement>('cover-file');
const sessionPreview = getElement<HTMLElement>('session-preview');
const sessionStatus = getElement<HTMLElement>('session-status');
const sessionResponse = getElement<HTMLElement>('session-response');
const sessionExampleJson = getElement<HTMLElement>('session-example-json');
const sessionExampleMultipart = getElement<HTMLElement>('session-example-multipart');

const searchQueryInput = getElement<HTMLInputElement>('search-query');
const searchLimitInput = getElement<HTMLInputElement>('search-limit');
const searchProviderInput = getElement<HTMLInputElement>('search-provider');
const searchPreview = getElement<HTMLElement>('search-preview');
const searchStatus = getElement<HTMLElement>('search-status');
const searchResponse = getElement<HTMLElement>('search-response');
const searchResults = getElement<HTMLDivElement>('search-results');
const searchExample = getElement<HTMLElement>('search-example');

const playPreview = getElement<HTMLElement>('play-preview');
const playStatus = getElement<HTMLElement>('play-status');
const playResponse = getElement<HTMLElement>('play-response');
const playExample = getElement<HTMLElement>('play-example');

const playerStatusPreview = getElement<HTMLElement>('player-status-preview');
const playerStatusStatus = getElement<HTMLElement>('player-status-status');
const playerStatusResponse = getElement<HTMLElement>('player-status-response');
const playerStatusExample = getElement<HTMLElement>('player-status-example');

const playerTimePreview = getElement<HTMLElement>('player-time-preview');
const playerTimeStatus = getElement<HTMLElement>('player-time-status');
const playerTimeResponse = getElement<HTMLElement>('player-time-response');
const playerTimeExample = getElement<HTMLElement>('player-time-example');

const playerControlActionInput = getElement<HTMLSelectElement>('player-control-action');
const playerControlPositionInput = getElement<HTMLInputElement>('player-control-position');
const playerControlPreview = getElement<HTMLElement>('player-control-preview');
const playerControlStatus = getElement<HTMLElement>('player-control-status');
const playerControlResponse = getElement<HTMLElement>('player-control-response');
const playerControlExample = getElement<HTMLElement>('player-control-example');

const playerQueueActionInput = getElement<HTMLSelectElement>('player-queue-action');
const playerQueueSongIdInput = getElement<HTMLInputElement>('player-queue-song-id');
const playerQueueItemIdInput = getElement<HTMLInputElement>('player-queue-item-id');
const playerQueueFromItemIdInput = getElement<HTMLInputElement>('player-queue-from-item-id');
const playerQueueIndexInput = getElement<HTMLInputElement>('player-queue-index');
const playerQueueToIndexInput = getElement<HTMLInputElement>('player-queue-to-index');
const playerQueueOffsetInput = getElement<HTMLInputElement>('player-queue-offset');
const playerQueueLimitInput = getElement<HTMLInputElement>('player-queue-limit');
const playerQueueAroundCurrentInput = getElement<HTMLInputElement>('player-queue-around-current');
const playerQueuePreview = getElement<HTMLElement>('player-queue-preview');
const playerQueueStatus = getElement<HTMLElement>('player-queue-status');
const playerQueueResponse = getElement<HTMLElement>('player-queue-response');
const playerQueueExample = getElement<HTMLElement>('player-queue-example');

const playerWsPreview = getElement<HTMLElement>('player-ws-preview');
const playerWsStatus = getElement<HTMLElement>('player-ws-status');
const playerWsLog = getElement<HTMLElement>('player-ws-log');

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);
const syntaxHighlightJson = (json: string) => {
    let formatted = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return formatted.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'json-key';
            } else {
                cls = 'json-string';
            }
        } else if (/true|false/.test(match)) {
            cls = 'json-boolean';
        } else if (/null/.test(match)) {
            cls = 'json-null';
        }
        return `<span class="${cls}">${match}</span>`;
    });
};
const normalizeText = (value?: string | null) => value?.trim() ?? '';
let playerSocket: WebSocket | null = null;

const summarizeBody = (body: BodyInit | null | undefined) => {
    if (!body) {
        return '(empty)';
    }

    if (typeof body === 'string') {
        return body;
    }

    if (body instanceof FormData) {
        const summary: Record<string, unknown> = {};
        body.forEach((value, key) => {
            if (value instanceof File) {
                summary[key] = {
                    fileName: value.name,
                    size: value.size,
                    type: value.type,
                };
                return;
            }

            summary[key] = value;
        });
        return formatJson(summary);
    }

    return String(body);
};

const renderRequestPreview = (target: HTMLElement, request: StageRequestBuildResult) => {
    const formattedHeaders = formatJson(request.init.headers || {});
    const bodyStr = summarizeBody(request.init.body as BodyInit | null | undefined);
    target.innerHTML = [
        `<span class="req-method">${request.init.method || 'GET'}</span> <span class="req-url">${request.endpoint}</span>`,
        '',
        `<span class="req-label">Transport:</span> ${request.transport}`,
        '',
        `<span class="req-label">Headers:</span>\n${syntaxHighlightJson(formattedHeaders)}`,
        '',
        `<span class="req-label">Body:</span>\n${
            bodyStr.startsWith('{') || bodyStr.startsWith('[') ? syntaxHighlightJson(bodyStr) : bodyStr.replace(/</g, '&lt;').replace(/>/g, '&gt;')
        }`,
    ].join('\n');
};

const renderExampleError = (target: HTMLElement, error: unknown) => {
    target.textContent = error instanceof Error ? `# Invalid input\n${error.message}` : String(error);
};

const toCurl = (request: StageRequestBuildResult) => {
    const parts = [`curl -X ${request.init.method || 'GET'}`, `"${request.endpoint}"`];
    const headers = request.init.headers;

    if (headers && typeof headers === 'object') {
        for (const [key, value] of Object.entries(headers)) {
            parts.push(`-H "${key}: ${String(value)}"`);
        }
    }

    if (typeof request.init.body === 'string') {
        parts.push(`-d '${request.init.body}'`);
    } else if (request.init.body instanceof FormData) {
        request.init.body.forEach((value, key) => {
            if (value instanceof File) {
                parts.push(`-F "${key}=@${value.name}"`);
            } else {
                parts.push(`-F "${key}=${String(value)}"`);
            }
        });
    }

    return parts.join(' \\\n  ');
};

const renderExample = (target: HTMLElement, builder: () => StageRequestBuildResult) => {
    try {
        const curlStr = toCurl(builder());
        const highlighted = curlStr
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/^(curl\b.*)/, '<span class="curl-command">$1</span>')
            .replace(/(-X\s+\w+|-H|-d|-F)/g, '<span class="curl-flag">$1</span>')
            .replace(/('.*?'|".*?")/g, '<span class="curl-string">$1</span>');
        target.innerHTML = highlighted;
    } catch (error) {
        renderExampleError(target, error);
    }
};

const updateRequestResult = async (
    statusTarget: HTMLElement,
    responseTarget: HTMLElement,
    request: StageRequestBuildResult,
) => {
    statusTarget.innerHTML = '<span class="status-sending">Sending...</span>';
    try {
        const response = await fetch(request.endpoint, request.init);
        const text = await response.text();
        const statusClass = response.ok ? 'status-ok' : 'status-error';
        statusTarget.innerHTML = `<span class="${statusClass}">${response.status} ${response.statusText}</span>`;

        try {
            responseTarget.innerHTML = syntaxHighlightJson(formatJson(JSON.parse(text)));
        } catch {
            responseTarget.textContent = text || '(empty response)';
        }
    } catch (error) {
        statusTarget.innerHTML = '<span class="status-error">Request failed.</span>';
        responseTarget.textContent = error instanceof Error ? error.message : String(error);
    }
};

const renderSearchResults = (songs: StageSearchResult[]) => {
    if (songs.length === 0) {
        searchResults.innerHTML = '<div class="empty-state">No songs found.</div>';
        return;
    }

    searchResults.innerHTML = songs.map((song) => `
        <article class="stage-result-card" data-song-ref="${song.songRef}">
            <div class="doc-head">
                <div>
                    <strong>${song.title}</strong>
                    <p class="hint">${song.artists.join(' / ') || 'Unknown artist'}${song.album ? ` · ${song.album}` : ''}</p>
                </div>
                <div class="button-row">
                    <button type="button" class="secondary" data-play-song="${song.songRef}">Play In Folia</button>
                    <button type="button" class="secondary" data-queue-song="${song.songRef}">Add To Queue</button>
                </div>
            </div>
            <pre class="request-preview compact">${syntaxHighlightJson(formatJson(song))}</pre>
        </article>
    `).join('');
};

const buildLyricsRequestFromInputs = () => buildStageLyricsRequest({
    baseUrl: baseUrlInput.value,
    token: tokenInput.value,
    title: lyricsTitleInput.value,
    artist: lyricsArtistInput.value,
    album: lyricsAlbumInput.value,
    lyricSourceJson: lyricsSourceJsonInput.value,
});

const buildSessionRequestFromInputs = () => buildStageSessionRequest({
    baseUrl: baseUrlInput.value,
    token: tokenInput.value,
    title: titleInput.value,
    artist: artistInput.value,
    album: albumInput.value,
    coverUrl: coverUrlInput.value,
    audioUrl: audioUrlInput.value,
    lyricsText: lyricsTextInput.value,
    lyricsFormat: lyricsFormatInput.value as '' | 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc',
    audioFile: audioFileInput.files?.[0] || null,
    lyricsFile: lyricsFileInput.files?.[0] || null,
    coverFile: coverFileInput.files?.[0] || null,
});

const buildSearchRequestFromInputs = () => buildStageSearchRequest({
    baseUrl: baseUrlInput.value,
    token: tokenInput.value,
    query: searchQueryInput.value,
    limit: Number(searchLimitInput.value) || 10,
    provider: searchProviderInput.value,
});

const buildPlayerStatusRequestFromInputs = () => buildStagePlayerStatusRequest(baseUrlInput.value, tokenInput.value);

const buildPlayerTimeRequestFromInputs = () => buildStagePlayerTimeRequest(baseUrlInput.value, tokenInput.value);

const buildPlayerControlRequestFromInputs = () => buildStagePlayerControlRequest({
    baseUrl: baseUrlInput.value,
    token: tokenInput.value,
    action: playerControlActionInput.value as 'next' | 'prev' | 'pause' | 'resume' | 'seek',
    positionMs: Number(playerControlPositionInput.value),
});

const buildPlayerQueueRequestFromInputs = () => buildStagePlayerQueueRequest({
    baseUrl: baseUrlInput.value,
    token: tokenInput.value,
    action: playerQueueActionInput.value as 'append' | 'insert-next' | 'remove' | 'move' | 'select' | 'clear',
    songId: playerQueueSongIdInput.value.trim() || undefined,
    queueItemId: playerQueueItemIdInput.value,
    fromQueueItemId: playerQueueFromItemIdInput.value,
    index: (playerQueueActionInput.value === 'remove' || playerQueueActionInput.value === 'select') && playerQueueIndexInput.value !== '' ? Number(playerQueueIndexInput.value) : undefined,
    fromIndex: playerQueueActionInput.value === 'move' && playerQueueIndexInput.value !== '' ? Number(playerQueueIndexInput.value) : undefined,
    toIndex: playerQueueToIndexInput.value === '' ? undefined : Number(playerQueueToIndexInput.value),
});

const buildPlayerQueueGetRequestFromInputs = () => buildStagePlayerQueueGetRequest(baseUrlInput.value, tokenInput.value, {
    offset: playerQueueOffsetInput.value === '' ? undefined : Number(playerQueueOffsetInput.value),
    limit: playerQueueLimitInput.value === '' ? undefined : Number(playerQueueLimitInput.value),
    around: playerQueueAroundCurrentInput.checked ? 'current' : undefined,
});

const renderPlayerWebSocketPreview = () => {
    try {
        playerWsPreview.textContent = buildStagePlayerWebSocketUrl(baseUrlInput.value, tokenInput.value);
    } catch (error) {
        renderExampleError(playerWsPreview, error);
    }
};

const renderLiveExamples = () => {
    renderExample(healthExample, () => buildStageHealthRequest(baseUrlInput.value));
    renderExample(statusExample, () => buildStageStatusRequest(baseUrlInput.value, tokenInput.value));
    renderExample(clearExample, () => buildStageClearRequest(baseUrlInput.value, tokenInput.value));
    renderExample(lyricsExample, buildLyricsRequestFromInputs);
    renderExample(sessionExampleJson, () => buildStageSessionRequest({
        baseUrl: baseUrlInput.value,
        token: tokenInput.value,
        title: titleInput.value,
        artist: artistInput.value,
        album: albumInput.value,
        coverUrl: coverUrlInput.value,
        audioUrl: audioUrlInput.value || 'https://example.com/demo.mp3',
        lyricsText: lyricsTextInput.value,
        lyricsFormat: lyricsFormatInput.value as '' | 'lrc' | 'enhanced-lrc' | 'vtt' | 'yrc',
    }));
    renderExample(sessionExampleMultipart, () => {
        const formData = new FormData();
        formData.set('title', normalizeText(titleInput.value) || 'Folia Demo Tone');
        formData.set('artist', normalizeText(artistInput.value) || 'Folia');
        formData.set('lyricsFormat', normalizeText(lyricsFormatInput.value) || 'lrc');
        formData.set('audioFile', new File(['binary'], 'stage-demo-tone.wav', { type: 'audio/wav' }));
        formData.set('lyricsFile', new File(['lyrics'], 'stage-demo.lrc', { type: 'text/plain' }));

        return {
            endpoint: `${normalizeText(baseUrlInput.value).replace(/\/+$/, '')}/stage/session`,
            transport: 'multipart',
            init: {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${normalizeText(tokenInput.value)}`,
                },
                body: formData,
            },
        };
    });
    renderExample(searchExample, buildSearchRequestFromInputs);
    renderExample(playExample, () => buildStagePlayRequest({
        baseUrl: baseUrlInput.value,
        token: tokenInput.value,
        songId: 123456,
        appendToQueue: false,
    }));
    renderExample(playerStatusExample, buildPlayerStatusRequestFromInputs);
    renderExample(playerTimeExample, buildPlayerTimeRequestFromInputs);
    renderExample(playerControlExample, buildPlayerControlRequestFromInputs);
    renderExample(playerQueueExample, buildPlayerQueueGetRequestFromInputs);
};

const renderStaticPreviews = () => {
    try {
        renderRequestPreview(healthPreview, buildStageHealthRequest(baseUrlInput.value));
    } catch (error) {
        renderExampleError(healthPreview, error);
    }

    try {
        renderRequestPreview(statusPreview, buildStageStatusRequest(baseUrlInput.value, tokenInput.value));
    } catch (error) {
        renderExampleError(statusPreview, error);
    }

    try {
        renderRequestPreview(clearPreview, buildStageClearRequest(baseUrlInput.value, tokenInput.value));
    } catch (error) {
        renderExampleError(clearPreview, error);
    }

    try {
        renderRequestPreview(lyricsPreview, buildLyricsRequestFromInputs());
    } catch (error) {
        renderExampleError(lyricsPreview, error);
    }

    try {
        renderRequestPreview(sessionPreview, buildSessionRequestFromInputs());
    } catch (error) {
        renderExampleError(sessionPreview, error);
    }

    try {
        renderRequestPreview(searchPreview, buildSearchRequestFromInputs());
    } catch (error) {
        renderExampleError(searchPreview, error);
    }

    try {
        renderRequestPreview(playerStatusPreview, buildPlayerStatusRequestFromInputs());
    } catch (error) {
        renderExampleError(playerStatusPreview, error);
    }

    try {
        renderRequestPreview(playerTimePreview, buildPlayerTimeRequestFromInputs());
    } catch (error) {
        renderExampleError(playerTimePreview, error);
    }

    try {
        renderRequestPreview(playerControlPreview, buildPlayerControlRequestFromInputs());
    } catch (error) {
        renderExampleError(playerControlPreview, error);
    }

    try {
        renderRequestPreview(playerQueuePreview, buildPlayerQueueRequestFromInputs());
    } catch (error) {
        renderExampleError(playerQueuePreview, error);
    }

    renderPlayerWebSocketPreview();
};

const rerenderDocs = () => {
    renderStaticPreviews();
    renderLiveExamples();
};

const runHealthRequest = async () => {
    const request = buildStageHealthRequest(baseUrlInput.value);
    renderRequestPreview(healthPreview, request);
    await updateRequestResult(healthStatus, healthResponse, request);
};

const runStatusRequest = async () => {
    const request = buildStageStatusRequest(baseUrlInput.value, tokenInput.value);
    renderRequestPreview(statusPreview, request);
    await updateRequestResult(statusStatus, statusResponse, request);
};

const runClearRequest = async () => {
    const request = buildStageClearRequest(baseUrlInput.value, tokenInput.value);
    renderRequestPreview(clearPreview, request);
    await updateRequestResult(clearStatus, clearResponse, request);
};

const runLyricsRequest = async () => {
    const request = buildLyricsRequestFromInputs();
    renderRequestPreview(lyricsPreview, request);
    await updateRequestResult(lyricsStatus, lyricsResponse, request);
};

const runSessionRequest = async () => {
    const request = buildSessionRequestFromInputs();
    renderRequestPreview(sessionPreview, request);
    await updateRequestResult(sessionStatus, sessionResponse, request);
};

const runSearchRequest = async () => {
    const request = buildSearchRequestFromInputs();
    renderRequestPreview(searchPreview, request);
    searchStatus.innerHTML = '<span class="status-sending">Sending...</span>';

    try {
        const response = await fetch(request.endpoint, request.init);
        const payload = await response.json();
        const statusClass = response.ok ? 'status-ok' : 'status-error';
        searchStatus.innerHTML = `<span class="${statusClass}">${response.status} ${response.statusText}</span>`;
        searchResponse.innerHTML = syntaxHighlightJson(formatJson(payload));
        renderSearchResults(Array.isArray(payload?.songs) ? payload.songs : []);
    } catch (error) {
        searchStatus.innerHTML = '<span class="status-error">Request failed.</span>';
        searchResponse.textContent = error instanceof Error ? error.message : String(error);
        renderSearchResults([]);
    }
};

const runPlayRequest = async (songId: StageSongRefInput, appendToQueue = false) => {
    const request = buildStagePlayRequest({
        baseUrl: baseUrlInput.value,
        token: tokenInput.value,
        songId,
        appendToQueue,
    });
    renderRequestPreview(playPreview, request);
    await updateRequestResult(playStatus, playResponse, request);
};

const runPlayerStatusRequest = async () => {
    const request = buildPlayerStatusRequestFromInputs();
    renderRequestPreview(playerStatusPreview, request);
    await updateRequestResult(playerStatusStatus, playerStatusResponse, request);
};

const runPlayerTimeRequest = async () => {
    const request = buildPlayerTimeRequestFromInputs();
    renderRequestPreview(playerTimePreview, request);
    await updateRequestResult(playerTimeStatus, playerTimeResponse, request);
};

const runPlayerControlRequest = async (action?: 'next' | 'prev' | 'pause' | 'resume' | 'seek') => {
    if (action) {
        playerControlActionInput.value = action;
    }
    const request = buildPlayerControlRequestFromInputs();
    renderRequestPreview(playerControlPreview, request);
    await updateRequestResult(playerControlStatus, playerControlResponse, request);
};

const runPlayerQueueGetRequest = async () => {
    const request = buildPlayerQueueGetRequestFromInputs();
    renderRequestPreview(playerQueuePreview, request);
    await updateRequestResult(playerQueueStatus, playerQueueResponse, request);
};

const runPlayerQueuePostRequest = async () => {
    const request = buildPlayerQueueRequestFromInputs();
    renderRequestPreview(playerQueuePreview, request);
    await updateRequestResult(playerQueueStatus, playerQueueResponse, request);
};

const appendPlayerWebSocketLog = (entry: unknown) => {
    if (playerWsLog.textContent === 'No events yet.') {
        playerWsLog.innerHTML = '';
    }
    const formatted = typeof entry === 'string' ? entry.replace(/</g, '&lt;').replace(/>/g, '&gt;') : syntaxHighlightJson(formatJson(entry));
    const logEntry = document.createElement('div');
    logEntry.className = 'ws-log-entry';
    logEntry.innerHTML = `<span class="req-label">[${new Date().toLocaleTimeString()}]</span>\n${formatted}`;
    playerWsLog.appendChild(logEntry);
    playerWsLog.scrollTop = playerWsLog.scrollHeight;
};

const connectPlayerWebSocket = () => {
    if (playerSocket && playerSocket.readyState === WebSocket.OPEN) {
        playerWsStatus.textContent = 'Already connected.';
        return;
    }

    let url: string;
    try {
        url = buildStagePlayerWebSocketUrl(baseUrlInput.value, tokenInput.value);
        playerWsPreview.textContent = url;
    } catch (error) {
        playerWsStatus.textContent = 'Connection build failed.';
        appendPlayerWebSocketLog(error instanceof Error ? error.message : String(error));
        return;
    }

    playerWsStatus.textContent = 'Connecting...';
    playerSocket = new WebSocket(url);
    playerSocket.addEventListener('open', () => {
        playerWsStatus.textContent = 'Connected.';
        appendPlayerWebSocketLog('Socket opened.');
    });
    playerSocket.addEventListener('message', (event) => {
        try {
            appendPlayerWebSocketLog(JSON.parse(String(event.data)));
        } catch {
            appendPlayerWebSocketLog(String(event.data));
        }
    });
    playerSocket.addEventListener('close', (event) => {
        playerWsStatus.textContent = `Disconnected (${event.code || 'no code'}).`;
        appendPlayerWebSocketLog(`Socket closed: ${event.reason || 'no reason'}`);
        playerSocket = null;
    });
    playerSocket.addEventListener('error', () => {
        playerWsStatus.textContent = 'Socket error.';
        appendPlayerWebSocketLog('Socket error.');
    });
};

const disconnectPlayerWebSocket = () => {
    if (!playerSocket) {
        playerWsStatus.textContent = 'Disconnected.';
        return;
    }

    playerSocket.close(1000, 'Manual disconnect');
    playerSocket = null;
    playerWsStatus.textContent = 'Disconnecting...';
};

getElement<HTMLButtonElement>('run-health').addEventListener('click', () => {
    void runHealthRequest();
});

getElement<HTMLButtonElement>('run-status').addEventListener('click', () => {
    void runStatusRequest();
});

getElement<HTMLButtonElement>('run-clear').addEventListener('click', () => {
    void runClearRequest();
});

getElement<HTMLButtonElement>('push-lyrics').addEventListener('click', () => {
    void runLyricsRequest().catch((error) => {
        lyricsStatus.textContent = 'Request build failed.';
        lyricsResponse.textContent = error instanceof Error ? error.message : String(error);
    });
});

getElement<HTMLButtonElement>('push-session').addEventListener('click', () => {
    void runSessionRequest().catch((error) => {
        sessionStatus.textContent = 'Request build failed.';
        sessionResponse.textContent = error instanceof Error ? error.message : String(error);
    });
});

getElement<HTMLButtonElement>('run-search').addEventListener('click', () => {
    void runSearchRequest().catch((error) => {
        searchStatus.textContent = 'Request build failed.';
        searchResponse.textContent = error instanceof Error ? error.message : String(error);
        renderSearchResults([]);
    });
});

getElement<HTMLButtonElement>('run-player-status').addEventListener('click', () => {
    void runPlayerStatusRequest().catch((error) => {
        playerStatusStatus.textContent = 'Request build failed.';
        playerStatusResponse.textContent = error instanceof Error ? error.message : String(error);
    });
});

getElement<HTMLButtonElement>('run-player-time').addEventListener('click', () => {
    void runPlayerTimeRequest().catch((error) => {
        playerTimeStatus.textContent = 'Request build failed.';
        playerTimeResponse.textContent = error instanceof Error ? error.message : String(error);
    });
});

getElement<HTMLButtonElement>('run-player-control').addEventListener('click', () => {
    void runPlayerControlRequest().catch((error) => {
        playerControlStatus.textContent = 'Request build failed.';
        playerControlResponse.textContent = error instanceof Error ? error.message : String(error);
    });
});

document.querySelectorAll<HTMLElement>('[data-control-action]').forEach((button) => {
    button.addEventListener('click', () => {
        const action = button.dataset.controlAction as 'next' | 'prev' | 'pause' | 'resume' | undefined;
        if (!action) {
            return;
        }
        void runPlayerControlRequest(action).catch((error) => {
            playerControlStatus.textContent = 'Request build failed.';
            playerControlResponse.textContent = error instanceof Error ? error.message : String(error);
        });
    });
});

getElement<HTMLButtonElement>('run-player-queue-get').addEventListener('click', () => {
    void runPlayerQueueGetRequest().catch((error) => {
        playerQueueStatus.textContent = 'Request build failed.';
        playerQueueResponse.textContent = error instanceof Error ? error.message : String(error);
    });
});

getElement<HTMLButtonElement>('run-player-queue-post').addEventListener('click', () => {
    void runPlayerQueuePostRequest().catch((error) => {
        playerQueueStatus.textContent = 'Request build failed.';
        playerQueueResponse.textContent = error instanceof Error ? error.message : String(error);
    });
});

getElement<HTMLButtonElement>('connect-player-ws').addEventListener('click', connectPlayerWebSocket);
getElement<HTMLButtonElement>('disconnect-player-ws').addEventListener('click', disconnectPlayerWebSocket);
getElement<HTMLButtonElement>('clear-player-ws-log').addEventListener('click', () => {
    playerWsLog.textContent = 'No events yet.';
});

searchResults.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    const songRef = target.dataset.playSong || target.dataset.queueSong;
    if (!songRef) {
        return;
    }

    void runPlayRequest(songRef, target.dataset.queueSong === songRef);
});

[
    baseUrlInput,
    tokenInput,
    lyricsTitleInput,
    lyricsArtistInput,
    lyricsAlbumInput,
    lyricsSourceJsonInput,
    titleInput,
    artistInput,
    albumInput,
    coverUrlInput,
    audioUrlInput,
    lyricsTextInput,
    lyricsFormatInput,
    searchQueryInput,
    searchLimitInput,
    searchProviderInput,
    playerControlActionInput,
    playerControlPositionInput,
    playerQueueActionInput,
    playerQueueSongIdInput,
    playerQueueItemIdInput,
    playerQueueFromItemIdInput,
    playerQueueIndexInput,
    playerQueueToIndexInput,
].forEach((element) => {
    element.addEventListener('input', rerenderDocs);
});

[audioFileInput, lyricsFileInput, coverFileInput].forEach((element) => {
    element.addEventListener('change', rerenderDocs);
});

[playerControlActionInput, playerQueueActionInput].forEach((element) => {
    element.addEventListener('change', rerenderDocs);
});

rerenderDocs();
renderSearchResults([]);
