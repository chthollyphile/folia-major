// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useAiConnectionTest } from '../../../src/components/modal/settings/pages/AiConnectionTest';

// test/unit/settings/aiConnectionTestBridge.test.ts
// The connection test of the AI settings, on the window's side: what the form hands to the desktop
// bridge for each service, and what it shows when the bridge answers, fails, or is not there. The
// request the main process then sends is in test/unit/electron/aiTextClientRequests.test.ts.

type ConnectionTest = ReturnType<typeof useAiConnectionTest>;
type TestWindow = { electron?: { testAiConnection?: (payload: AiConnectionTestPayload) => Promise<AiConnectionTestResult> } };

let root: Root | null = null;
let latest: ConnectionTest | null = null;

const Probe = ({ payload }: { payload: AiConnectionTestPayload }) => {
    latest = useAiConnectionTest(payload);
    return null;
};

const mount = async (payload: AiConnectionTestPayload) => {
    root = createRoot(document.createElement('div'));
    await act(async () => {
        root!.render(React.createElement(Probe, { payload }));
    });
};

const pressTest = () => act(async () => {
    await latest!.run();
});

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    root = null;
    latest = null;
    delete (window as unknown as TestWindow).electron;
});

describe('the connection test of the AI settings', () => {
    it.each<[string, AiConnectionTestPayload]>([
        ['gemini', { provider: 'gemini', apiKey: 'test-key', useSystemProxy: false }],
        ['openai', {
            provider: 'openai',
            apiKey: 'test-key',
            apiUrl: 'https://relay.example.com/v1',
            model: 'my-model',
            stream: true,
            useSystemProxy: true,
        }],
    ])('hands the %s form values to the desktop bridge as they are, and shows the answer', async (_service, payload) => {
        const answer: AiConnectionTestResult = { ok: true, status: 200, durationMs: 12, model: 'some-model', text: 'Hello!' };
        const testAiConnection = vi.fn().mockResolvedValue(answer);
        (window as unknown as TestWindow).electron = { testAiConnection };
        await mount(payload);

        await pressTest();

        expect(testAiConnection).toHaveBeenCalledTimes(1);
        expect(testAiConnection).toHaveBeenCalledWith(payload);
        expect(latest).toMatchObject({ running: false, result: answer });
    });

    it('shows a failed bridge call as a network failure with its message', async () => {
        (window as unknown as TestWindow).electron = { testAiConnection: vi.fn().mockRejectedValue(new Error('bridge down')) };
        await mount({ provider: 'gemini', apiKey: 'test-key' });

        await pressTest();

        expect(latest).toMatchObject({
            running: false,
            result: { ok: false, durationMs: 0, errorKind: 'network', error: 'bridge down' },
        });
    });

    it('does nothing where there is no desktop bridge', async () => {
        await mount({ provider: 'gemini', apiKey: 'test-key' });
        await pressTest();
        expect(latest).toMatchObject({ running: false, result: null });

        (window as unknown as TestWindow).electron = {};
        await pressTest();
        expect(latest).toMatchObject({ running: false, result: null });
    });
});
