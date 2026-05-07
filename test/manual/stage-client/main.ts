import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import '../../../src/index.css';
import {
    buildStageClearRequest,
    buildStageSessionRequest,
    type StageLyricsFormat,
    type StageSessionRequestInput,
} from '../../../src/utils/stageClientDemo';
import './style.css';

// Manual Stage API console that documents endpoints, previews assembled requests, and executes them with axios.

type ResponseView = {
    statusEl: HTMLDivElement;
    bodyEl: HTMLElement;
};

type EndpointDoc = {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    auth: 'required' | 'optional' | 'none';
    purpose: string;
    payloadMode?: 'json' | 'multipart' | 'none';
};

type PreviewDescriptor = {
    label: string;
    requestText: string;
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

const responseViews: Record<'health' | 'clear' | 'session', ResponseView> = {
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

const endpointDocs: Record<'health' | 'clear' | 'session', EndpointDoc> = {
    health: {
        method: 'GET',
        path: '/stage/health',
        auth: 'none',
        purpose: '检查 Stage 服务是否可访问，并返回 enabled / port。',
        payloadMode: 'none',
    },
    clear: {
        method: 'DELETE',
        path: '/stage/session',
        auth: 'required',
        purpose: '清空当前 Stage 会话。',
        payloadMode: 'none',
    },
    session: {
        method: 'POST',
        path: '/stage/session',
        auth: 'required',
        purpose: '推送或替换当前 Stage 会话。',
        payloadMode: 'json',
    },
};

const getSelectedFile = (input: HTMLInputElement) => input.files?.[0] ?? null;

const normalizeText = (value: string) => value.trim();

const normalizeBaseUrl = (value: string) => normalizeText(value).replace(/\/+$/, '');

const buildRequestInput = (): StageSessionRequestInput => ({
    baseUrl: baseUrlInput.value,
    token: tokenInput.value,
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

const describeFile = (file: File | null | undefined) => {
    if (!file) {
        return null;
    }

    return `${file.name} (${file.type || 'application/octet-stream'}, ${file.size} bytes)`;
};

const prettyJson = (value: unknown) => JSON.stringify(value, null, 2);

const buildHealthPreview = (): PreviewDescriptor => {
    const baseUrl = normalizeBaseUrl(baseUrlInput.value) || 'http://127.0.0.1:32107';
    const url = `${baseUrl}/stage/health`;

    return {
        label: 'health',
        requestText: [
            '# Endpoint',
            `${endpointDocs.health.method} ${endpointDocs.health.path}`,
            '',
            '# Purpose',
            endpointDocs.health.purpose,
            '',
            '# Assembled request',
            `curl ${JSON.stringify(url)}`,
        ].join('\n'),
    };
};

// Build a readable preview so manual debugging does not require opening DevTools
// to understand exactly which headers and payload Folia is receiving.
const buildSessionPreview = (): PreviewDescriptor => {
    const input = buildRequestInput();
    const request = buildStageSessionRequest(input);
    const headers = request.init.headers as Record<string, string> | undefined;
    const lines = [
        '# Endpoint',
        `${endpointDocs.session.method} ${endpointDocs.session.path}`,
        '',
        '# Purpose',
        endpointDocs.session.purpose,
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

    return {
        label: request.transport,
        requestText: lines.join('\n'),
    };
};

const buildClearPreview = (): PreviewDescriptor => {
    const request = buildStageClearRequest(baseUrlInput.value, tokenInput.value);
    const headers = request.init.headers as Record<string, string> | undefined;

    return {
        label: 'delete',
        requestText: [
            '# Endpoint',
            `${endpointDocs.clear.method} ${endpointDocs.clear.path}`,
            '',
            '# Purpose',
            endpointDocs.clear.purpose,
            '',
            '# Headers',
            prettyJson(headers || {}),
        ].join('\n'),
    };
};

const setResponseState = (target: keyof typeof responseViews, statusText: string, details: string) => {
    responseViews[target].statusEl.textContent = statusText;
    responseViews[target].bodyEl.textContent = details;
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

const createAxiosConfig = (request: ReturnType<typeof buildStageSessionRequest> | ReturnType<typeof buildStageClearRequest> | {
    endpoint: string;
    init: RequestInit;
}) => {
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

const updatePreviews = () => {
    const healthPreview = buildHealthPreview();
    healthRequestPreview.textContent = healthPreview.requestText;

    try {
        const clearPreview = buildClearPreview();
        clearRequestPreview.textContent = clearPreview.requestText;
    } catch (error) {
        clearRequestPreview.textContent = `# Validation error\n${describeAxiosError(error)}`;
    }

    try {
        const sessionPreview = buildSessionPreview();
        sessionRequestPreview.textContent = sessionPreview.requestText;
    } catch (error) {
        sessionRequestPreview.textContent = `# Validation error\n${describeAxiosError(error)}`;
    }
};

const executeRequest = async (
    target: keyof typeof responseViews,
    requestFactory: () => ReturnType<typeof buildStageClearRequest> | ReturnType<typeof buildStageSessionRequest> | {
        endpoint: string;
        init: RequestInit;
    },
) => {
    try {
        const request = requestFactory();
        setResponseState(target, `Sending ${request.init.method || 'GET'} ${request.endpoint}`, '');
        const response = await axios.request(createAxiosConfig(request));
        setResponseState(target, `${response.status} ${response.statusText}`, describeAxiosResponse(response));
    } catch (error) {
        setResponseState(target, 'Request failed.', describeAxiosError(error));
    }
};

const connectInputEvents = (elements: HTMLElement[]) => {
    for (const element of elements) {
        element.addEventListener('input', updatePreviews);
        element.addEventListener('change', updatePreviews);
    }
};

testHealthButton.addEventListener('click', async () => {
    const baseUrl = normalizeBaseUrl(baseUrlInput.value);
    await executeRequest('health', () => ({
        endpoint: `${baseUrl || 'http://127.0.0.1:32107'}/stage/health`,
        init: {
            method: 'GET',
        },
    }));
});

clearSessionButton.addEventListener('click', async () => {
    await executeRequest('clear', () => buildStageClearRequest(baseUrlInput.value, tokenInput.value));
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await executeRequest('session', () => buildStageSessionRequest(buildRequestInput()));
});

connectInputEvents([
    baseUrlInput,
    tokenInput,
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
]);

const initializeEmptyState = () => {
    setResponseState('health', 'No request sent yet.', 'Click Test Health to inspect the backend response.');
    setResponseState('clear', 'No request sent yet.', 'Click Clear Session to inspect the backend response.');
    setResponseState('session', 'No request sent yet.', 'Click Push Session to inspect the backend response.');
};

initializeEmptyState();
updatePreviews();
