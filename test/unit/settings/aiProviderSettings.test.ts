// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AiProviderSettings from '../../../src/components/modal/settings/pages/ai/AiProviderSettings';
import { SettingsPageContext, type ElectronSettingsState, type SettingsPageContextValue } from '../../../src/components/modal/settings/pages/settingsPageContext';

// Exercises the actual form guards so custom credentials cannot reach a default endpoint.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root | null = null;
let host: HTMLDivElement;
const save = vi.fn().mockResolvedValue(undefined);
const testAiConnection = vi.fn().mockResolvedValue({ ok: true, durationMs: 1, text: 'hello' });
const base: ElectronSettingsState = {
    AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'custom', OPENAI_API_URL: '', OPENAI_API_MODEL: 'selected-model',
    OPENAI_API_KEY: 'draft-key', OPENAI_API_TEMPERATURE: '0.7', OPENAI_API_STREAM: false,
    GEMINI_API_KEY: '', GEMINI_API_MODEL: 'gemini-selected', USE_SYSTEM_PROXY_FOR_AI: false,
    ENABLE_UPDATE_CHECK: true, ENABLE_AUTO_UPDATE: false, UPDATE_CHANNEL: 'realeco',
    STAGE_MODE_SOURCE: '', DISCORD_RICH_PRESENCE_ENABLED: false,
};
const setElectronSettings = vi.fn();
/** The settings after the form's last change (setElectronSettings takes an updater). */
const changed = (patch: Partial<ElectronSettingsState>) => {
    const update = setElectronSettings.mock.calls.at(-1)![0] as (previous: ElectronSettingsState) => ElectronSettingsState;
    return update({ ...base, ...patch });
};
const render = async (patch: Partial<ElectronSettingsState>, savedOpenAIKeyEndpoint: string | null = null) => {
    const value = { viewProps: { desktop: { model: {
        electronSettings: { ...base, ...patch }, setElectronSettings, onSaveElectronSettings: save,
        electronSaveStatus: 'idle', savedAiApiKeys: { GEMINI_API_KEY: false, OPENAI_API_KEY: savedOpenAIKeyEndpoint !== null },
        savedOpenAIKeyEndpoint, onClearAiApiKey: vi.fn(),
    } } } } as unknown as SettingsPageContextValue;
    if (!root) {
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    }
    await act(async () => {
        root!.render(React.createElement(SettingsPageContext.Provider, { value }, React.createElement(AiProviderSettings)));
    });
};
const button = (key: string) => [...host.querySelectorAll('button')].find(item => item.textContent === key)!;
/** The pick list of the row labelled `labelKey`. */
const combobox = (labelKey: string) => {
    const label = [...host.querySelectorAll('span[id]')].find(item => item.textContent === labelKey)!;
    return [...host.querySelectorAll<HTMLButtonElement>('[role="combobox"]')]
        .find(item => (item.getAttribute('aria-labelledby') ?? '').split(' ').includes(label.id))!;
};
/** Opens that pick list with a pointer click and reads its options. */
const optionsOf = async (labelKey: string) => {
    await act(async () => { combobox(labelKey).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); });
    return [...document.querySelectorAll('[role="option"]')].map(item => item.textContent);
};
beforeAll(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => {
    await act(async () => { root?.unmount(); });
    host?.remove();
    root = null;
    vi.clearAllMocks();
    delete (window as any).electron;
});
describe('AI provider form connection guards', () => {
    it.each(['', '   '])('disables test and save for an empty custom URL %j even with a key and model', async apiUrl => {
        (window as any).electron = { testAiConnection };
        await render({ OPENAI_API_URL: apiUrl });
        expect(button('options.aiTestConnection').disabled).toBe(true);
        expect(button('options.save').disabled).toBe(true);
        await act(async () => { button('options.aiTestConnection').click(); button('options.save').click(); });
        expect(testAiConnection).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });
    it('enables both actions for a filled custom URL and passes its URL requirement to IPC', async () => {
        (window as any).electron = { testAiConnection };
        await render({ OPENAI_API_URL: 'https://custom.example/v1' });
        expect(button('options.aiTestConnection').disabled).toBe(false);
        expect(button('options.save').disabled).toBe(false);
        await act(async () => { button('options.aiTestConnection').click(); button('options.save').click(); });
        expect(testAiConnection).toHaveBeenCalledWith(expect.objectContaining({ presetId: 'custom', apiUrl: 'https://custom.example/v1' }));
        expect(testAiConnection.mock.calls[0][0]).not.toHaveProperty('apiProtocol');
        expect(testAiConnection.mock.calls[0][0]).not.toHaveProperty('requireApiUrl');
        expect(save).toHaveBeenCalledTimes(1);
    });
    it('keeps built-in provider defaults usable without a custom URL', async () => {
        (window as any).electron = { testAiConnection };
        await render({ AI_PROVIDER_PRESET: 'openai' });
        expect(button('options.aiTestConnection').disabled).toBe(false);
        await act(async () => { button('options.aiTestConnection').click(); });
        expect(testAiConnection).toHaveBeenCalledWith(expect.objectContaining({ presetId: 'openai', apiUrl: 'https://api.openai.com/v1' }));
    });
    it('keeps test and save usable for a blank model where the provider has a default, and shows that default', async () => {
        (window as any).electron = { testAiConnection };
        // An old OpenAI setting: no preset, no address, no model; requests use DEFAULT_OPENAI_MODEL.
        await render({ AI_PROVIDER_PRESET: '', OPENAI_API_MODEL: '' });
        expect(button('options.aiTestConnection').disabled).toBe(false);
        expect(button('options.save').disabled).toBe(false);
        expect(combobox('options.aiModel').textContent).toBe('options.aiModelDefault');
        await act(async () => { button('options.aiTestConnection').click(); });
        expect(testAiConnection).toHaveBeenCalledWith(expect.objectContaining({ presetId: 'openai', model: '' }));
    });
    it('leaves a blank Gemini model blank, standing for the default, instead of filling the default in', async () => {
        (window as any).electron = { testAiConnection };
        await render({ AI_PROVIDER: 'gemini', AI_PROVIDER_PRESET: 'gemini', GEMINI_API_MODEL: '' });
        expect(combobox('options.aiModel').textContent).toBe('options.aiModelDefault');
        expect(button('options.save').disabled).toBe(false);
        await act(async () => { button('options.aiTestConnection').click(); });
        expect(testAiConnection).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini', presetId: 'gemini', model: '' }));
    });
    it('still needs a model where the provider has no default', async () => {
        (window as any).electron = { testAiConnection };
        await render({ AI_PROVIDER_PRESET: 'anthropic', OPENAI_API_URL: 'https://api.anthropic.com/v1', OPENAI_API_MODEL: '' });
        expect(button('options.aiTestConnection').disabled).toBe(true);
        expect(button('options.save').disabled).toBe(true);
        expect(combobox('options.aiModel').textContent).toBe('options.aiModelChoose');
    });
});
describe('AI provider form per provider', () => {
    const temperatureInput = () => host.querySelector<HTMLInputElement>('input[aria-valuemax]');
    const pick = async (index: number) => {
        await act(async () => {
            [...document.querySelectorAll<HTMLElement>('[role="option"]')][index]
                .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
        });
    };
    it.each([
        ['openai', 'https://api.openai.com/v1', null],
        ['anthropic', 'https://api.anthropic.com/v1', null],
        ['kimi', 'https://api.moonshot.cn/v1', null],
        ['glm', 'https://open.bigmodel.cn/api/paas/v4', ['1', 'options.aiTemperatureRangeDesc']],
        ['mimo', 'https://api.xiaomimimo.com/v1', ['1.5', 'options.aiTemperatureRangeDesc']],
        ['tencentcloud', 'https://tokenhub.tencentmaas.com/v1', ['2', 'options.aiTemperaturePerModelDesc']],
        ['custom', 'https://custom.example/v1', ['2', 'options.aiTemperatureRangeDesc']],
    ] as const)('shows the temperature for %s only when it is sent, with its range', async (presetId, apiUrl, expected) => {
        await render({ AI_PROVIDER_PRESET: presetId, OPENAI_API_URL: apiUrl });
        if (!expected) {
            expect(temperatureInput()).toBeNull();
            expect(host.textContent).not.toContain('options.openaiApiTemperature');
            return;
        }
        expect(temperatureInput()!.getAttribute('aria-valuemax')).toBe(expected[0]);
        expect(host.textContent).toContain(expected[1]);
    });
    it('offers the sites of a provider that has more than one, and writes the picked site’s address', async () => {
        (window as any).electron = { testAiConnection };
        await render({ AI_PROVIDER_PRESET: 'kimi', OPENAI_API_URL: 'https://api.moonshot.cn/v1', OPENAI_API_MODEL: 'kimi-k2.6' });
        expect(combobox('options.aiEndpoint').textContent).toBe('options.aiEndpoint_cn');
        expect(await optionsOf('options.aiEndpoint')).toEqual(['options.aiEndpoint_cn', 'options.aiEndpoint_global']);
        await pick(1);
        expect(changed({}).OPENAI_API_URL).toBe('https://api.moonshot.ai/v1');
    });
    it('tests the stored site rather than the default one, and shows an unlisted host as it is', async () => {
        (window as any).electron = { testAiConnection };
        await render({ AI_PROVIDER_PRESET: 'kimi', OPENAI_API_URL: 'https://api.moonshot.ai/v1', OPENAI_API_MODEL: 'kimi-k2.6' });
        expect(combobox('options.aiEndpoint').textContent).toBe('options.aiEndpoint_global');
        await act(async () => { button('options.aiTestConnection').click(); });
        expect(testAiConnection).toHaveBeenCalledWith(expect.objectContaining({ presetId: 'kimi', apiUrl: 'https://api.moonshot.ai/v1' }));
        await render({ AI_PROVIDER_PRESET: 'qwen', OPENAI_API_URL: 'https://ws-1.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', OPENAI_API_MODEL: 'qwen3.8-flash' });
        expect(combobox('options.aiEndpoint').textContent).toBe('ws-1.cn-beijing.maas.aliyuncs.com');
    });
    it('shows in full an address that is on none of the sites, even on a listed host, and keeps it when switching to custom', async () => {
        const codingPlan = 'https://open.bigmodel.cn/api/coding/paas/v4';
        await render({ AI_PROVIDER_PRESET: 'glm', OPENAI_API_URL: codingPlan, OPENAI_API_MODEL: 'glm-5.2' });
        // The China site has the same host, but not this path: it is not shown as the China site.
        expect(combobox('options.aiEndpoint').textContent).toBe('open.bigmodel.cn');
        expect(host.textContent).toContain(codingPlan);
        expect(host.textContent).toContain('options.aiApiUrlUnlistedDesc');
        const options = await optionsOf('options.aiProvider');
        await pick(options.indexOf('options.aiProvider_custom'));
        expect(changed({}).OPENAI_API_URL).toBe(codingPlan);

        // A provider with one site has no picker, and shows such an address all the same.
        await render({ AI_PROVIDER_PRESET: 'deepseek', OPENAI_API_URL: 'https://api.deepseek.com/beta' });
        expect(host.textContent).toContain('https://api.deepseek.com/beta');
        expect(host.textContent).toContain('options.aiApiUrlUnlistedDesc');
    });
    it.each([
        ['deepseek', 'https://api.deepseek.com/v1'],
        ['kimi', 'https://api.moonshot.cn/v1/chat/completions'],
        ['anthropic', 'https://api.anthropic.com/v1/messages'],
        ['openai', ''],
    ])('reads %s %j as its listed site', async (presetId, apiUrl) => {
        await render({ AI_PROVIDER_PRESET: presetId, OPENAI_API_URL: apiUrl, OPENAI_API_MODEL: 'some-model' });
        expect(host.textContent).not.toContain('options.aiApiUrlUnlistedDesc');
    });
    it('has no site picker for a provider with one site, nor for a custom address', async () => {
        await render({ AI_PROVIDER_PRESET: 'deepseek', OPENAI_API_URL: 'https://api.deepseek.com' });
        expect(host.textContent).not.toContain('options.aiEndpoint');
        await render({ OPENAI_API_URL: 'https://api.moonshot.cn/v1' });
        expect(host.textContent).not.toContain('options.aiEndpoint');
    });
    it('names the provider a saved key belongs to once another provider is picked, else its address', async () => {
        await render({ AI_PROVIDER_PRESET: 'anthropic', OPENAI_API_URL: 'https://api.anthropic.com/v1', OPENAI_API_KEY: '' }, 'https://api.deepseek.com');
        expect(host.textContent).toContain('options.aiApiKeyOtherProviderDesc');
        await render({ AI_PROVIDER_PRESET: 'custom', OPENAI_API_URL: 'https://custom.example/v1', OPENAI_API_KEY: '' }, 'https://other.example');
        expect(host.textContent).toContain('options.aiApiKeyEndpointMismatchDesc');
        await render({ AI_PROVIDER_PRESET: 'anthropic', OPENAI_API_URL: 'https://api.anthropic.com/v1', OPENAI_API_KEY: 'typed' }, 'https://api.deepseek.com');
        expect(host.textContent).not.toContain('options.aiApiKeyOtherProviderDesc');
    });
    it('prefills the recommended model and the default site when switching provider', async () => {
        await render({ AI_PROVIDER_PRESET: 'openai', OPENAI_API_MODEL: 'gpt-5.6-luna' });
        const options = await optionsOf('options.aiProvider');
        await pick(options.indexOf('options.aiProvider_deepseek'));
        expect(changed({ OPENAI_API_KEY: 'typed' })).toMatchObject({
            AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'deepseek', OPENAI_API_URL: 'https://api.deepseek.com',
            OPENAI_API_MODEL: 'deepseek-flash', OPENAI_API_KEY: '',
        });
    });
    it('warns about a retired model and about one that cannot stop thinking', async () => {
        await render({ AI_PROVIDER_PRESET: 'deepseek', OPENAI_API_URL: 'https://api.deepseek.com', OPENAI_API_MODEL: 'deepseek-chat' });
        expect(host.textContent).toContain('options.aiModelRetired');
        expect(host.textContent).not.toContain('options.aiModelAlwaysThinks');
        await render({ AI_PROVIDER_PRESET: 'glm', OPENAI_API_URL: 'https://open.bigmodel.cn/api/paas/v4', OPENAI_API_MODEL: 'glm-5.3-flash' });
        expect(host.textContent).toContain('options.aiModelAlwaysThinks');
        expect(host.textContent).not.toContain('options.aiModelRetired');
    });
});
describe('AI model picker', () => {
    it('offers a provider without a listing its suggested models and manual entry, and never fetches', async () => {
        const listAiModels = vi.fn();
        (window as any).electron = { testAiConnection, listAiModels };
        await render({ AI_PROVIDER_PRESET: 'glm', OPENAI_API_URL: 'https://open.bigmodel.cn/api/paas/v4', OPENAI_API_MODEL: 'glm-5.2' });
        expect(button('options.aiModelsFetch')).toBeUndefined();
        expect(await optionsOf('options.aiModel')).toEqual(['glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'glm-4.7-flash', 'options.aiModelManual']);
        expect(listAiModels).not.toHaveBeenCalled();
    });
    it('falls back to the suggestions the main process sends with a failed listing', async () => {
        const listAiModels = vi.fn().mockResolvedValue({ ok: false, status: 401, errorKind: 'auth', suggestedModels: ['qwen3.8-flash', 'qwen3.7-plus'] });
        (window as any).electron = { testAiConnection, listAiModels };
        await render({ AI_PROVIDER_PRESET: 'qwen', OPENAI_API_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', OPENAI_API_MODEL: 'qwen3.8-flash' });
        await act(async () => { button('options.aiModelsFetch').click(); });
        expect(listAiModels).toHaveBeenCalledTimes(1);
        expect(await optionsOf('options.aiModel')).toEqual(['qwen3.8-flash', 'qwen3.7-plus', 'options.aiModelManual']);
        expect(host.textContent).toContain('options.aiModelsAuthError');
    });
});
