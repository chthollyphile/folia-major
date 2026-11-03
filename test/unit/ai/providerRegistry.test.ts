import { describe, expect, it } from 'vitest';
import {
    AI_ADAPTERS,
    AI_PROVIDER_PRESETS,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_OPENAI_MODEL,
    getAiAdapter,
    inferAiProviderFromUrl,
    modelAlwaysThinks,
    resolveAiConnection,
    resolveAiProviderPreset,
    retiredModelHint,
} from '../../../shared/ai/providerRegistry.mjs';
import en from '../../../src/i18n/locales/en';
import id from '../../../src/i18n/locales/in';
import zhCN from '../../../src/i18n/locales/zh-CN';

// test/unit/ai/providerRegistry.test.ts
// The provider registry: which adapter a URL's host belongs to, how stored settings (including
// ones saved long before there were presets) resolve into one connection, and what the settings
// form lists. Pure functions; no request is made.

const defaultModelOf = (adapterId: string) => getAiAdapter(adapterId)?.defaultModel ?? '';

describe('inferring the provider from the URL', () => {
    it.each([
        // Every host and suffix an adapter claims.
        ['https://api.openai.com/v1', 'openai'],
        ['https://eu.api.openai.com/v1', 'openai'],
        ['https://jp.api.openai.com/v1/chat/completions', 'openai'],
        ['https://api.anthropic.com/v1', 'anthropic'],
        ['https://api.deepseek.com', 'deepseek'],
        ['https://eu.deepseek.com/v1/', 'deepseek'],
        ['https://api.moonshot.cn/v1', 'kimi'],
        ['https://api.moonshot.ai/v1', 'kimi'],
        ['https://open.bigmodel.cn/api/paas/v4', 'glm'],
        ['https://open.bigmodel.cn/api/coding/paas/v4', 'glm'],
        ['https://api.z.ai/api/paas/v4', 'glm'],
        ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen'],
        ['https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'qwen'],
        ['https://dashscope-us.aliyuncs.com/compatible-mode/v1', 'qwen'],
        ['https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1', 'qwen'],
        ['https://ws-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', 'qwen'],
        ['https://tokenhub.tencentmaas.com/v1', 'tencentcloud'],
        ['https://tokenhub-intl.tencentmaas.com/v1', 'tencentcloud'],
        ['https://tokenhub.tencentmaas.cn/v1', 'tencentcloud'],
        ['https://tokenhub-intl.tencentmaas.cn/v1', 'tencentcloud'],
        ['https://tokenhub.tencentcloudmaas.com/v1', 'tencentcloud'],
        ['https://tokenhub-intl.tencentcloudmaas.com/v1', 'tencentcloud'],
        ['https://tokenhub-us.tencentcloudmaas.tech/v1', 'tencentcloud'],
        ['https://api.xiaomimimo.com/v1', 'mimo'],
        ['https://token-plan-cn.xiaomimimo.com/v1', 'mimo'],
        // Case, userinfo, port and a trailing dot do not change the host.
        ['HTTPS://API.DEEPSEEK.COM/V1', 'deepseek'],
        ['https://user:secret@api.moonshot.cn:443/v1', 'kimi'],
        ['https://api.openai.com./v1', 'openai'],
    ])('%s is %s', (url, expected) => {
        expect(inferAiProviderFromUrl(url)).toBe(expected);
    });

    it.each([
        // Hosts that only look like a provider's.
        'https://api.deepseek.com.evil.example/v1',
        'https://deepseek.com.evil.example/v1',
        'https://evil.example/api.openai.com/v1',
        'https://api.openai.com@evil.example/v1',
        'https://notmoonshot.cn/v1',
        'https://xiaomimimo.com.evil.example/v1',
        // Retired Tencent addresses and anything unclaimed.
        'https://api.lkeap.cloud.tencent.com/v1',
        'https://api.hunyuan.cloud.tencent.com/v1',
        'https://relay.example.com/v1',
        'http://localhost:11434/v1',
        // Gemini is chosen by AI_PROVIDER, never inferred: its OpenAI-compatible endpoint stays custom.
        'https://generativelanguage.googleapis.com/v1beta/openai/',
        // Not a URL.
        'relay.example.com/v1/',
        'not a url',
    ])('%s is custom', (url) => {
        expect(inferAiProviderFromUrl(url)).toBe('custom');
    });

    it.each(['', '   ', undefined, null])('an empty URL (%j) is OpenAI itself, as the request normaliser treats it', (url) => {
        expect(inferAiProviderFromUrl(url)).toBe('openai');
    });

    it('infers every site of every preset back to that preset', () => {
        const sites = AI_PROVIDER_PRESETS
            .filter(preset => preset.protocol !== 'gemini' && preset.id !== 'custom')
            .flatMap(preset => preset.endpoints.map(endpoint => [preset.id, endpoint.baseUrl]));
        expect(sites.length).toBeGreaterThan(AI_PROVIDER_PRESETS.length - 2);
        for (const [presetId, baseUrl] of sites) {
            expect(inferAiProviderFromUrl(baseUrl), baseUrl).toBe(presetId);
        }
    });
});

describe('resolving stored settings', () => {
    it.each([
        ['nothing saved', {}, { presetId: 'gemini', adapterId: 'gemini', protocol: 'gemini', model: DEFAULT_GEMINI_MODEL }],
        ['Gemini with a model', { AI_PROVIDER: 'gemini', GEMINI_API_MODEL: ' gemini-selected ' }, { adapterId: 'gemini', model: 'gemini-selected' }],
        ['an unknown AI_PROVIDER', { AI_PROVIDER: 'claude' }, { adapterId: 'gemini' }],
        ['OpenAI with nothing else', { AI_PROVIDER: 'openai' }, { presetId: 'openai', adapterId: 'openai', apiUrl: '', model: DEFAULT_OPENAI_MODEL }],
        ['a typed model', { AI_PROVIDER: 'openai', OPENAI_API_MODEL: '  my-model ' }, { adapterId: 'openai', model: 'my-model' }],
        ['DeepSeek\'s own address', { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.deepseek.com' }, { presetId: 'deepseek', adapterId: 'deepseek', model: defaultModelOf('deepseek') }],
        ['DeepSeek with /v1', { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.deepseek.com/v1' }, { adapterId: 'deepseek', model: defaultModelOf('deepseek') }],
        ['Kimi', { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.moonshot.cn/v1' }, { adapterId: 'kimi', model: defaultModelOf('kimi') }],
        ['GLM on Z.ai', { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.z.ai/api/paas/v4' }, { adapterId: 'glm', model: defaultModelOf('glm') }],
        ['Qwen in Singapore', { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' }, { adapterId: 'qwen', model: defaultModelOf('qwen') }],
        ['TokenHub', { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://tokenhub.tencentmaas.com/v1' }, { adapterId: 'tencentcloud', model: defaultModelOf('tencentcloud') }],
        ['MiMo', { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.xiaomimimo.com/v1' }, { adapterId: 'mimo', model: defaultModelOf('mimo') }],
        // Anthropic's OpenAI-compatible layer, saved before presets: now the native Messages API,
        // with the same key, model and base URL; no default model, so a blank one stays blank.
        ['Anthropic\'s compatible layer', { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.anthropic.com/v1' }, { presetId: 'anthropic', adapterId: 'anthropic', protocol: 'anthropic', model: '' }],
        ['Anthropic with a model', { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.anthropic.com/v1', OPENAI_API_MODEL: 'claude-haiku-5-5' }, { adapterId: 'anthropic', model: 'claude-haiku-5-5' }],
        ['the retired lkeap address', { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.lkeap.cloud.tencent.com/v1' }, { presetId: 'custom', adapterId: 'custom', model: DEFAULT_OPENAI_MODEL }],
        ['the frozen Hunyuan address', { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.hunyuan.cloud.tencent.com/v1' }, { adapterId: 'custom' }],
        ['another host', { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://relay.example.com/v1' }, { presetId: 'custom', adapterId: 'custom', model: DEFAULT_OPENAI_MODEL }],
    ])('%s', (_name, settings, expected) => {
        expect(resolveAiConnection(settings)).toMatchObject(expected);
    });

    it('lets the URL decide the adapter and shows a stored preset only while it agrees', () => {
        // Custom with a provider's address: shown as custom, sent with that provider's adapter.
        expect(resolveAiConnection({ AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'custom', OPENAI_API_URL: 'https://api.deepseek.com' }))
            .toMatchObject({ presetId: 'custom', adapterId: 'deepseek' });
        // A preset whose URL was changed to somewhere else: shown and sent as custom.
        expect(resolveAiConnection({ AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'deepseek', OPENAI_API_URL: 'https://relay.example.com/v1' }))
            .toMatchObject({ presetId: 'custom', adapterId: 'custom' });
        // The URL is never filled in from the preset: the saved key is bound to OPENAI_API_URL.
        expect(resolveAiConnection({ AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'kimi' }))
            .toMatchObject({ presetId: 'openai', adapterId: 'openai', apiUrl: '' });
        // A Gemini preset under AI_PROVIDER openai is ignored.
        expect(resolveAiConnection({ AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'gemini', OPENAI_API_URL: 'https://relay.example.com/v1' }))
            .toMatchObject({ presetId: 'custom', adapterId: 'custom' });
        // An unknown preset id is ignored.
        expect(resolveAiConnection({ AI_PROVIDER: 'openai', AI_PROVIDER_PRESET: 'nope', OPENAI_API_URL: 'https://api.moonshot.ai/v1' }))
            .toMatchObject({ presetId: 'kimi', adapterId: 'kimi' });
    });

    it('falls back to custom for a protocol the caller cannot speak (the web routes speak only OpenAI-compatible)', () => {
        const anthropic = { AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.anthropic.com/v1' };
        expect(resolveAiConnection(anthropic, { protocols: ['openai'] }))
            .toMatchObject({ adapterId: 'custom', protocol: 'openai', model: DEFAULT_OPENAI_MODEL });
        expect(resolveAiConnection({ AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.deepseek.com' }, { protocols: ['openai'] }))
            .toMatchObject({ adapterId: 'deepseek' });
    });

    it('resolves the preset the form shows', () => {
        expect(resolveAiProviderPreset({ AI_PROVIDER: 'openai', OPENAI_API_URL: 'https://api.anthropic.com/v1' })).toMatchObject({ id: 'anthropic', protocol: 'anthropic' });
        expect(resolveAiProviderPreset({}).id).toBe('gemini');
    });
});

describe('the presets the settings form lists', () => {
    it('has one preset per adapter, sorted by English name, custom last', () => {
        expect(AI_PROVIDER_PRESETS.map(preset => preset.id).sort()).toEqual(AI_ADAPTERS.map(adapter => adapter.id).sort());
        expect(AI_PROVIDER_PRESETS.at(-1)?.id).toBe('custom');
        const named = AI_PROVIDER_PRESETS.slice(0, -1).map(preset => preset.label);
        expect(named).toEqual([...named].sort((left, right) => left.localeCompare(right, 'en')));
    });

    it('gives every preset a default site whose base URL is its baseUrl', () => {
        for (const preset of AI_PROVIDER_PRESETS) {
            expect(preset.endpoints.length, preset.id).toBeGreaterThan(0);
            expect(preset.baseUrl).toBe(preset.endpoints[0].baseUrl);
            expect(new Set(preset.endpoints.map(endpoint => endpoint.id)).size).toBe(preset.endpoints.length);
        }
    });

    it.each([['en', en], ['zh-CN', zhCN], ['in', id]])('names every preset in %s', (_locale, messages) => {
        const options = (messages as { options: Record<string, string> }).options;
        for (const preset of AI_PROVIDER_PRESETS) {
            expect(options[`aiProvider_${preset.id}`], preset.id).toBeTruthy();
            // The site picker shows only for more than one site, and names each by its id.
            for (const endpoint of preset.endpoints.length > 1 ? preset.endpoints : []) {
                expect(options[`aiEndpoint_${endpoint.id}`], `${preset.id} ${endpoint.id}`).toBeTruthy();
            }
        }
    });

    it('registers each adapter under its own id, with hosts written in lower case', () => {
        for (const adapter of AI_ADAPTERS) {
            expect(getAiAdapter(adapter.id)).toBe(adapter);
            for (const host of [...adapter.hosts, ...(adapter.hostSuffixes ?? [])]) {
                expect(host).toBe(host.toLowerCase());
            }
            for (const suffix of adapter.hostSuffixes ?? []) {
                expect(suffix.startsWith('.'), suffix).toBe(true);
            }
        }
        expect(getAiAdapter('nope')).toBeUndefined();
    });

    it('claims each host for one adapter at most', () => {
        const hosts = AI_ADAPTERS.flatMap(adapter => adapter.hosts);
        expect(new Set(hosts).size).toBe(hosts.length);
    });
});

describe('model hints', () => {
    it('reports no retired or always-thinking model where the adapter says nothing', () => {
        expect(retiredModelHint('custom', 'gpt-4')).toBeNull();
        expect(retiredModelHint('nope', 'anything')).toBeNull();
        expect(retiredModelHint('openai', '')).toBeNull();
        expect(modelAlwaysThinks('custom', 'anything')).toBe(false);
        expect(modelAlwaysThinks('nope', 'anything')).toBe(false);
    });

    it('reads the adapter\'s retired list and always-thinks rule, case-insensitively', () => {
        const adapter = { retired: [{ pattern: /^old-/, replacement: 'new-model' }], alwaysThinks: (model: string) => model.startsWith('deep-') };
        const custom = getAiAdapter('custom')!;
        const saved = { retired: custom.retired, alwaysThinks: custom.alwaysThinks };
        Object.assign(custom, adapter);
        try {
            expect(retiredModelHint('custom', ' OLD-one ')).toEqual({ model: 'OLD-one', replacement: 'new-model' });
            expect(retiredModelHint('custom', 'new-model')).toBeNull();
            expect(modelAlwaysThinks('custom', 'Deep-1')).toBe(true);
            expect(modelAlwaysThinks('custom', 'shallow')).toBe(false);
        } finally {
            Object.assign(custom, saved);
        }
    });
});
