import '../../../src/index.css';
import './style.css';
import {
    buildStageClearRequest,
    buildStageHealthRequest,
    buildStageLyricsRequest,
    buildStagePlayRequest,
    buildStageSearchRequest,
    buildStageSessionRequest,
    buildStageStatusRequest,
    type StageRequestBuildResult,
} from '../../../src/utils/stageClientDemo';
import type { StageSearchResult } from '../../../src/types';

// Manual Stage API console for the local-only desktop protocol.

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

const statusPreview = getElement<HTMLElement>('status-preview');
const statusStatus = getElement<HTMLElement>('status-status');
const statusResponse = getElement<HTMLElement>('status-response');

const clearPreview = getElement<HTMLElement>('clear-preview');
const clearStatus = getElement<HTMLElement>('clear-status');
const clearResponse = getElement<HTMLElement>('clear-response');

const lyricsTitleInput = getElement<HTMLInputElement>('lyrics-title');
const lyricsArtistInput = getElement<HTMLInputElement>('lyrics-artist');
const lyricsAlbumInput = getElement<HTMLInputElement>('lyrics-album');
const lyricsSourceJsonInput = getElement<HTMLTextAreaElement>('lyrics-source-json');
const lyricsPreview = getElement<HTMLElement>('lyrics-preview');
const lyricsStatus = getElement<HTMLElement>('lyrics-status');
const lyricsResponse = getElement<HTMLElement>('lyrics-response');

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

const searchQueryInput = getElement<HTMLInputElement>('search-query');
const searchLimitInput = getElement<HTMLInputElement>('search-limit');
const searchPreview = getElement<HTMLElement>('search-preview');
const searchStatus = getElement<HTMLElement>('search-status');
const searchResponse = getElement<HTMLElement>('search-response');
const searchResults = getElement<HTMLDivElement>('search-results');

const formatJson = (value: unknown) => JSON.stringify(value, null, 2);
const normalizeText = (value?: string | null) => value?.trim() ?? '';

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
    target.textContent = [
        `${request.init.method || 'GET'} ${request.endpoint}`,
        '',
        `Headers: ${formatJson(request.init.headers || {})}`,
        '',
        `Body: ${summarizeBody(request.init.body as BodyInit | null | undefined)}`,
    ].join('\n');
};

const updateRequestResult = async (
    statusTarget: HTMLElement,
    responseTarget: HTMLElement,
    request: StageRequestBuildResult,
) => {
    statusTarget.textContent = 'Sending...';
    try {
        const response = await fetch(request.endpoint, request.init);
        const text = await response.text();
        statusTarget.textContent = `${response.status} ${response.statusText}`;

        try {
            responseTarget.textContent = formatJson(JSON.parse(text));
        } catch {
            responseTarget.textContent = text || '(empty response)';
        }
    } catch (error) {
        statusTarget.textContent = 'Request failed.';
        responseTarget.textContent = error instanceof Error ? error.message : String(error);
    }
};

const renderSearchResults = (songs: StageSearchResult[]) => {
    if (songs.length === 0) {
        searchResults.innerHTML = '<div class="empty-state">No songs found.</div>';
        return;
    }

    searchResults.innerHTML = songs.map((song) => `
        <article class="stage-client-card" data-song-id="${song.songId}">
            <div class="doc-head">
                <div>
                    <strong>${song.title}</strong>
                    <p class="hint">${song.artists.join(' / ') || 'Unknown artist'}${song.album ? ` · ${song.album}` : ''}</p>
                </div>
                <div class="button-row">
                    <button type="button" class="secondary" data-play-song="${song.songId}">Play In Folia</button>
                    <button type="button" class="secondary" data-queue-song="${song.songId}">Add To Queue</button>
                </div>
            </div>
            <pre class="request-preview compact">${formatJson(song)}</pre>
        </article>
    `).join('');
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
    const request = buildStageLyricsRequest({
        baseUrl: baseUrlInput.value,
        token: tokenInput.value,
        title: lyricsTitleInput.value,
        artist: lyricsArtistInput.value,
        album: lyricsAlbumInput.value,
        lyricSourceJson: lyricsSourceJsonInput.value,
    });
    renderRequestPreview(lyricsPreview, request);
    await updateRequestResult(lyricsStatus, lyricsResponse, request);
};

const runSessionRequest = async () => {
    const request = buildStageSessionRequest({
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
    renderRequestPreview(sessionPreview, request);
    await updateRequestResult(sessionStatus, sessionResponse, request);
};

const runSearchRequest = async () => {
    const request = buildStageSearchRequest({
        baseUrl: baseUrlInput.value,
        token: tokenInput.value,
        query: searchQueryInput.value,
        limit: Number(searchLimitInput.value) || 10,
    });
    renderRequestPreview(searchPreview, request);
    searchStatus.textContent = 'Sending...';

    try {
        const response = await fetch(request.endpoint, request.init);
        const payload = await response.json();
        searchStatus.textContent = `${response.status} ${response.statusText}`;
        searchResponse.textContent = formatJson(payload);
        renderSearchResults(Array.isArray(payload?.songs) ? payload.songs : []);
    } catch (error) {
        searchStatus.textContent = 'Request failed.';
        searchResponse.textContent = error instanceof Error ? error.message : String(error);
        renderSearchResults([]);
    }
};

const runPlayRequest = async (songId: number, appendToQueue = false) => {
    const request = buildStagePlayRequest({
        baseUrl: baseUrlInput.value,
        token: tokenInput.value,
        songId,
        appendToQueue,
    });
    renderRequestPreview(searchPreview, request);
    await updateRequestResult(searchStatus, searchResponse, request);
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

searchResults.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    const songId = Number(target.dataset.playSong || target.dataset.queueSong);
    if (!Number.isInteger(songId) || songId <= 0) {
        return;
    }

    void runPlayRequest(songId, target.dataset.queueSong === String(songId));
});

healthPreview.textContent = 'Click Run to preview the health request.';
statusPreview.textContent = 'Click Run to preview the status request.';
clearPreview.textContent = 'Click Run to preview the clear request.';
lyricsPreview.textContent = 'Fill the lyrics fields, then click Push Lyrics.';
sessionPreview.textContent = 'Fill the session fields, then click Push Session.';
searchPreview.textContent = 'Search results can be played directly back into Folia.';
