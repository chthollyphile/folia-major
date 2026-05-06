import '../../../src/index.css';
import {
    buildStageClearRequest,
    buildStageSessionRequest,
    type StageLyricsFormat,
    type StageSessionRequestInput,
} from '../../../src/utils/stageClientDemo';
import './style.css';
import standardLyricsFixture from './fixtures/stage-demo.lrc?raw';
import enhancedLyricsFixture from './fixtures/stage-demo-enhanced.lrc?raw';
import demoAudioFixtureUrl from './fixtures/stage-demo-tone.wav?url';

// Manual Stage client page logic for local Folia Stage API testing.

type ExampleAssets = {
    audioFile: File | null;
    standardLyricsText: string;
    enhancedLyricsText: string;
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
const loadExampleButton = getInput<HTMLButtonElement>('load-example');
const clearSessionButton = getInput<HTMLButtonElement>('clear-session');
const statusLine = getInput<HTMLDivElement>('status-line');
const responseOutput = getInput<HTMLElement>('response-output');
const transportBadge = getInput<HTMLSpanElement>('transport-badge');
const exampleStatus = getInput<HTMLDivElement>('example-status');

let exampleAssets: ExampleAssets = {
    audioFile: null,
    standardLyricsText: '',
    enhancedLyricsText: '',
};

const setResponseState = (statusText: string, details: string, badge: string) => {
    statusLine.textContent = statusText;
    responseOutput.textContent = details;
    transportBadge.textContent = badge;
};

const updateExampleStatus = () => {
    const parts: string[] = [];
    if (exampleAssets.audioFile) {
        parts.push(`audio=${exampleAssets.audioFile.name}`);
    }
    if (exampleAssets.standardLyricsText) {
        parts.push('standard-lrc ready');
    }
    if (exampleAssets.enhancedLyricsText) {
        parts.push('enhanced-lrc ready');
    }
    exampleStatus.textContent = parts.length > 0
        ? `Example loaded: ${parts.join(', ')}`
        : 'No example assets loaded.';
};

const fetchFixtureFile = async (fixturePath: string, fileName: string, mimeType: string) => {
    const response = await fetch(fixturePath);
    if (!response.ok) {
        throw new Error(`Failed to load fixture: ${fixturePath} (${response.status})`);
    }
    const blob = await response.blob();
    return new File([blob], fileName, { type: mimeType });
};

const applyExampleLyrics = (format: StageLyricsFormat) => {
    lyricsTextInput.value = format === 'enhanced-lrc'
        ? exampleAssets.enhancedLyricsText
        : exampleAssets.standardLyricsText;
    lyricsFileInput.value = '';
};

const getSelectedFile = (input: HTMLInputElement) => input.files?.[0] ?? null;

const buildRequestInput = (): StageSessionRequestInput => {
    const selectedAudioFile = getSelectedFile(audioFileInput);
    const selectedLyricsFile = getSelectedFile(lyricsFileInput);

    const useExampleAudioFile = !audioUrlInput.value.trim() && !selectedAudioFile
        ? exampleAssets.audioFile
        : null;

    return {
        baseUrl: baseUrlInput.value,
        token: tokenInput.value,
        title: titleInput.value,
        artist: artistInput.value,
        album: albumInput.value,
        coverUrl: coverUrlInput.value,
        audioUrl: audioUrlInput.value,
        lyricsText: lyricsTextInput.value,
        lyricsFormat: lyricsFormatSelect.value as StageLyricsFormat,
        audioFile: selectedAudioFile ?? useExampleAudioFile,
        lyricsFile: selectedLyricsFile,
        coverFile: getSelectedFile(coverFileInput),
    };
};

const describeResponseBody = async (response: Response) => {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        return JSON.stringify(await response.json(), null, 2);
    }
    return await response.text();
};

const executeRequest = async (endpoint: string, init: RequestInit, badge: string) => {
    setResponseState(`Sending ${init.method || 'POST'} request to ${endpoint}`, '', badge);
    const response = await fetch(endpoint, init);
    const bodyText = await describeResponseBody(response);
    setResponseState(
        `${response.status} ${response.statusText}`,
        bodyText || '(empty response body)',
        badge,
    );
};

loadExampleButton.addEventListener('click', async () => {
    loadExampleButton.disabled = true;
    setResponseState('Loading example assets...', '', 'example');

    try {
        const [audioFile, standardLyricsText, enhancedLyricsText] = await Promise.all([
            fetchFixtureFile(demoAudioFixtureUrl, 'stage-demo-tone.wav', 'audio/wav'),
            Promise.resolve(standardLyricsFixture),
            Promise.resolve(enhancedLyricsFixture),
        ]);

        exampleAssets = {
            audioFile,
            standardLyricsText,
            enhancedLyricsText,
        };

        titleInput.value = 'Stage Demo Tone';
        artistInput.value = 'Folia Manual Client';
        albumInput.value = 'Stage Fixtures';
        audioUrlInput.value = '';
        applyExampleLyrics(lyricsFormatSelect.value as StageLyricsFormat);
        updateExampleStatus();
        setResponseState(
            'Example assets loaded.',
            'Bundled demo audio is now attached automatically unless you choose your own audio URL or file.',
            'example',
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setResponseState('Failed to load example assets.', message, 'error');
    } finally {
        loadExampleButton.disabled = false;
    }
});

lyricsFormatSelect.addEventListener('change', () => {
    if (exampleAssets.standardLyricsText || exampleAssets.enhancedLyricsText) {
        applyExampleLyrics(lyricsFormatSelect.value as StageLyricsFormat);
        updateExampleStatus();
    }
});

form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = buildRequestInput();

    try {
        const request = buildStageSessionRequest(input);
        await executeRequest(request.endpoint, request.init, request.transport);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setResponseState('Request blocked before sending.', message, 'validation');
    }
});

clearSessionButton.addEventListener('click', async () => {
    try {
        const request = buildStageClearRequest(baseUrlInput.value, tokenInput.value);
        await executeRequest(request.endpoint, request.init, 'delete');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setResponseState('Clear request blocked before sending.', message, 'validation');
    }
});

updateExampleStatus();
setResponseState(
    'Ready.',
    'Fill the token, choose audio and lyrics, then push a Stage session into Folia.',
    'idle',
);
