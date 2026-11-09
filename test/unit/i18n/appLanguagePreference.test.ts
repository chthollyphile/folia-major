import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';

// Starts the real i18n config against a fake system language and storage, across simulated restarts.
const storage = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => storage.set(key, value));
const setAppLocale = vi.fn(async () => {});

function systemLanguage(language: string) {
    vi.stubGlobal('navigator', { language, languages: [language] });
}

async function start() {
    vi.resetModules();
    // Each launch needs a fresh instance; the externalized package otherwise keeps its singleton.
    vi.doMock('i18next', () => ({ default: createInstance() }));
    const config = await import('../../../src/i18n/config');
    if (!config.default.isInitialized) {
        await new Promise<void>(resolve => config.default.on('initialized', () => resolve()));
    }
    return config;
}

beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    const localStorage = {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem,
        removeItem: (key: string) => storage.delete(key),
    };
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('window', { localStorage, electron: { setAppLocale } });
    vi.stubGlobal('document', { documentElement: { lang: 'en' } });
    systemLanguage('zh-CN');
});

afterEach(() => {
    vi.doUnmock('i18next');
    vi.unstubAllGlobals();
});

describe('app language preference', () => {
    it.each([undefined, 'system'])('ignores and drops a stale i18nextLng=en at startup with preference %s', async preference => {
        storage.set('i18nextLng', 'en');
        if (preference) storage.set('folia_app_language', preference);
        const { default: i18n, readStoredAppLanguagePreference } = await start();
        expect(readStoredAppLanguagePreference()).toBe('system');
        expect(i18n.resolvedLanguage).toBe('zh-CN');
        expect(document.documentElement.lang).toBe('zh-CN');
        expect(setAppLocale).toHaveBeenCalledWith('zh-CN');
        expect(storage.has('i18nextLng')).toBe(false);
        expect(setItem).not.toHaveBeenCalled();
    });

    it.each(['en', 'zh-CN', 'zh-TW', 'in', 'vi'] as const)('keeps an explicit %s over the system language', async preference => {
        storage.set('folia_app_language', preference);
        storage.set('i18nextLng', 'zh-TW');
        const { default: i18n, readStoredAppLanguagePreference } = await start();
        expect(readStoredAppLanguagePreference()).toBe(preference);
        expect(i18n.resolvedLanguage).toBe(preference);
        expect(setItem).not.toHaveBeenCalled();
    });

    it.each([
        ['zh-HK', 'zh-TW'],
        ['zh-Hant-TW', 'zh-TW'],
        ['id-ID', 'in'],
        ['vi-VN', 'vi'],
        ['fr-FR', 'en'],
    ])('starts a %s system in %s, the same bundle the follow-system switch picks', async (system, expected) => {
        systemLanguage(system);
        const { default: i18n, applyAppLanguagePreference } = await start();
        expect(i18n.resolvedLanguage).toBe(expected);
        expect(document.documentElement.lang).toBe(expected);
        await expect(applyAppLanguagePreference('system')).resolves.toBe(expected);
    });

    it('returns to the system language after a manual switch without saving the detected result', async () => {
        const { default: i18n, applyAppLanguagePreference } = await start();
        await applyAppLanguagePreference('en');
        expect(i18n.resolvedLanguage).toBe('en');
        expect(storage.get('folia_app_language')).toBe('en');
        systemLanguage('zh-TW');
        await expect(applyAppLanguagePreference('system')).resolves.toBe('zh-TW');
        expect(i18n.resolvedLanguage).toBe('zh-TW');
        expect(storage.get('folia_app_language')).toBe('system');
        expect(setAppLocale).toHaveBeenLastCalledWith('zh-TW');
        expect(setItem.mock.calls.map(([key]) => key)).toEqual(['folia_app_language', 'folia_app_language']);
    });

    it('follows a changed system language on the next launch', async () => {
        storage.set('folia_app_language', 'system');
        expect((await start()).default.resolvedLanguage).toBe('zh-CN');
        systemLanguage('zh-TW');
        expect((await start()).default.resolvedLanguage).toBe('zh-TW');
        expect(setItem).not.toHaveBeenCalled();
    });
});
