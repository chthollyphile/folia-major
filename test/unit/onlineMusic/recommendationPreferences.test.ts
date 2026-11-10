import { afterEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import {
    checkRecommendationPreferenceChanges,
    normalizeRecommendationPreferences,
    readRecommendationPreferenceEntries,
} from '@/services/onlineMusic/recommendationPreferences';
import {
    listOnlineMusicProviders,
    providerSupports,
    registerOnlineMusicProvider,
    unregisterOnlineMusicProvider,
} from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import type {
    OnlineMusicProvider,
    OnlineRecommendationProvider,
    ProviderCapabilities,
    RecommendationPreferences,
} from '@/types/onlineMusic';

// test/unit/onlineMusic/recommendationPreferences.test.ts
// 推荐偏好的共用契约：偏好项的整理、入口声明、改动检查，以及 omni 只在平台声明了能力、两个成员都有时才转交。

const providerId = 'preferences-test';
const otherProviderId = 'preferences-other-test';

const capabilities = (preferences: boolean): ProviderCapabilities => ({
    search: false, playback: false, lyrics: false, auth: false, userLibrary: false,
    playlists: false, albums: false, artists: false, recommendations: true,
    mutations: false, wordByWordLyrics: false,
    ...(preferences ? { recommendationPreferences: true } : {}),
});

const provider = (id: string, preferences: boolean, recommendations: OnlineRecommendationProvider): OnlineMusicProvider => ({
    id,
    displayName: id,
    capabilities: capabilities(preferences),
    normalizeSong: () => { throw new Error('not used'); },
    recommendations,
});

const label = (labelFallback: string, labelKey?: string) => (labelKey ? { labelKey, labelFallback } : { labelFallback });

const answer: RecommendationPreferences = {
    items: [
        {
            kind: 'choice',
            key: 'familiar',
            label: label('Familiarity', 'test.familiar'),
            options: [
                { value: 'less', label: label('More new') },
                { value: 'same', label: label('As is') },
                { value: 'more', label: label('More known') },
            ],
            value: 'more',
            defaultValue: 'same',
        },
        { kind: 'ratio', key: 'live', label: label('Live'), min: 1, max: 99, defaultValue: 50, snapWithin: 4, value: 70 },
    ],
    note: label('Kept on the account'),
};

afterEach(() => {
    unregisterOnlineMusicProvider(providerId);
    unregisterOnlineMusicProvider(otherProviderId);
    useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
    omni.invalidateActiveRequests();
});

describe('normalizeRecommendationPreferences', () => {
    it('keeps well-formed choices and ratios with the note', () => {
        expect(normalizeRecommendationPreferences(answer)).toEqual(answer);
    });

    it('passes over kinds it does not know and items that are incomplete or repeated', () => {
        const normalized = normalizeRecommendationPreferences({
            items: [
                { kind: 'multi', key: 'artists', label: label('Artists'), options: [], value: [] },
                { kind: 'choice', key: '', label: label('No key'), options: [], value: '', defaultValue: '' },
                { kind: 'choice', key: 'single', label: label('One option'), options: [{ value: 'a', label: label('A') }], value: 'a', defaultValue: 'a' },
                { kind: 'choice', key: 'nodefault', label: label('No default'), options: [{ value: 'a', label: label('A') }, { value: 'b', label: label('B') }], value: 'a', defaultValue: 'c' },
                { kind: 'ratio', key: 'badrange', label: label('Bad range'), min: 10, max: 10, defaultValue: 10, value: 10 },
                { kind: 'ratio', key: 'outside', label: label('Default outside'), min: 0, max: 10, defaultValue: 20, value: 5 },
                { kind: 'ratio', key: 'nolabel', min: 0, max: 10, defaultValue: 5, value: 5 },
                answer.items[1],
                { ...answer.items[1], label: label('Repeated') },
                'not an item',
            ],
        });
        expect(normalized).toEqual({ items: [answer.items[1]] });
    });

    it('brings a value outside back to the range or the default', () => {
        const normalized = normalizeRecommendationPreferences({
            items: [
                { ...answer.items[0], value: 'unknown' },
                { ...answer.items[1], key: 'high', value: 500 },
                { ...answer.items[1], key: 'low', value: -3 },
                { ...answer.items[1], key: 'nan', value: Number.NaN, snapWithin: -1 },
            ],
        });
        expect(normalized.items.map(item => item.value)).toEqual(['same', 99, 1, 50]);
        expect(normalized.items[3]).not.toHaveProperty('snapWithin');
    });

    it('answers no items for an answer that is not one', () => {
        expect(normalizeRecommendationPreferences(null)).toEqual({ items: [] });
        expect(normalizeRecommendationPreferences({ items: 'x', note: 3 })).toEqual({ items: [] });
    });
});

describe('readRecommendationPreferenceEntries', () => {
    it('keeps the known entries once, in the fixed order', () => {
        expect(readRecommendationPreferenceEntries(['daily', 'search', 'explore', 'daily'])).toEqual(['explore', 'daily']);
        expect(readRecommendationPreferenceEntries(undefined)).toEqual([]);
    });
});

describe('checkRecommendationPreferenceChanges', () => {
    it('lets strings and finite numbers through', () => {
        expect(checkRecommendationPreferenceChanges({ familiar: 'more', live: 70 })).toEqual({ familiar: 'more', live: 70 });
    });

    it('refuses an empty key or a value that is neither', () => {
        expect(() => checkRecommendationPreferenceChanges({ '': 'x' })).toThrow(TypeError);
        expect(() => checkRecommendationPreferenceChanges({ live: Number.POSITIVE_INFINITY })).toThrow(TypeError);
        expect(() => checkRecommendationPreferenceChanges({ live: true } as never)).toThrow(TypeError);
    });
});

describe('omni recommendation preferences', () => {
    const activate = (id: string) => useOnlineProviderAccountStore.getState().setActiveProviderId(id);

    it('offers nothing for a registered provider that does not declare them', () => {
        const declared = listOnlineMusicProviders().filter(registered => !providerSupports(registered, 'recommendationPreferences'));
        expect(declared.length).toBeGreaterThan(0);
        for (const registered of declared) {
            activate(registered.id);
            expect(omni.supportsRecommendationPreferences()).toBe(false);
            expect(omni.getRecommendationPreferenceEntries()).toEqual([]);
        }
    });

    it('needs the capability and both members', async () => {
        const read = vi.fn(async () => answer);
        registerOnlineMusicProvider(provider(providerId, false, {
            preferenceEntries: ['explore'],
            getRecommendationPreferences: read,
            saveRecommendationPreferences: async () => ({ confirmed: true }),
        }));
        registerOnlineMusicProvider(provider(otherProviderId, true, {
            preferenceEntries: ['explore'],
            getRecommendationPreferences: read,
        }));
        for (const id of [providerId, otherProviderId]) {
            activate(id);
            expect(omni.supportsRecommendationPreferences()).toBe(false);
            expect(omni.getRecommendationPreferenceEntries()).toEqual([]);
            await expect(omni.getRecommendationPreferences()).rejects.toMatchObject({ code: 'unsupported' });
            await expect(omni.saveRecommendationPreferences({ live: 60 })).rejects.toMatchObject({ code: 'unsupported' });
        }
        expect(read).not.toHaveBeenCalled();
    });

    it('reads, tidies and saves through the active provider', async () => {
        const save = vi.fn(async () => ({ confirmed: true }));
        registerOnlineMusicProvider(provider(providerId, true, {
            preferenceEntries: ['daily', 'personal-fm', 'nowhere' as never],
            getRecommendationPreferences: async () => ({ ...answer, items: [...answer.items, { kind: 'multi' } as never] }),
            saveRecommendationPreferences: save,
        }));
        activate(providerId);

        expect(omni.supportsRecommendationPreferences()).toBe(true);
        expect(omni.getRecommendationPreferenceEntries()).toEqual(['personal-fm', 'daily']);
        await expect(omni.getRecommendationPreferences()).resolves.toEqual(answer);
        await expect(omni.saveRecommendationPreferences({ live: 60 })).resolves.toEqual({ confirmed: true });
        expect(save).toHaveBeenCalledWith({ live: 60 });
    });

    it('writes nothing when nothing changed, and reads only a true confirmation as one', async () => {
        const save = vi.fn(async () => ({ confirmed: 'yes' as never }));
        registerOnlineMusicProvider(provider(providerId, true, {
            getRecommendationPreferences: async () => answer,
            saveRecommendationPreferences: save,
        }));
        activate(providerId);

        await expect(omni.saveRecommendationPreferences({})).resolves.toEqual({ confirmed: true });
        expect(save).not.toHaveBeenCalled();
        await expect(omni.saveRecommendationPreferences({ familiar: 'less' })).resolves.toEqual({ confirmed: false });
        expect(omni.getRecommendationPreferenceEntries()).toEqual([]);
    });

    it('reads and saves an own preference named __proto__', async () => {
        const item = { ...answer.items[1], key: '__proto__' };
        const save = vi.fn<NonNullable<OnlineRecommendationProvider['saveRecommendationPreferences']>>(async () => ({ confirmed: true }));
        registerOnlineMusicProvider(provider(providerId, true, {
            getRecommendationPreferences: async () => ({ items: [item] }),
            saveRecommendationPreferences: save,
        }));
        activate(providerId);

        await expect(omni.getRecommendationPreferences()).resolves.toEqual({ items: [item] });
        const changes = { ['__proto__']: 60 };
        await expect(omni.saveRecommendationPreferences(changes)).resolves.toEqual({ confirmed: true });
        expect(save).toHaveBeenCalledWith(changes);
        expect(Object.keys(save.mock.calls[0][0])).toEqual(['__proto__']);
    });

    it('refuses bad changes before asking the provider', async () => {
        const save = vi.fn(async () => ({ confirmed: true }));
        registerOnlineMusicProvider(provider(providerId, true, {
            getRecommendationPreferences: async () => answer,
            saveRecommendationPreferences: save,
        }));
        activate(providerId);

        await expect(omni.saveRecommendationPreferences({ live: Number.NaN })).rejects.toThrow(TypeError);
        expect(save).not.toHaveBeenCalled();
    });

    it('tells the listeners which provider wrote, confirmed or not, and not when nothing was written', async () => {
        const told: string[] = [];
        const stop = omni.subscribeRecommendationPreferenceSaves(id => told.push(id));
        const save = vi.fn()
            .mockResolvedValueOnce({ confirmed: true })
            .mockResolvedValueOnce({ confirmed: false })
            .mockRejectedValueOnce(new Error('down'));
        registerOnlineMusicProvider(provider(providerId, true, {
            getRecommendationPreferences: async () => answer,
            saveRecommendationPreferences: save,
        }));
        activate(providerId);

        await omni.saveRecommendationPreferences({ live: 60 });
        await omni.saveRecommendationPreferences({ live: 61 });
        await expect(omni.saveRecommendationPreferences({ live: 62 })).rejects.toThrow('down');
        await omni.saveRecommendationPreferences({});
        expect(told).toEqual([providerId, providerId]);

        stop();
        save.mockResolvedValueOnce({ confirmed: true });
        await omni.saveRecommendationPreferences({ live: 63 });
        expect(told).toHaveLength(2);
    });

    it('tells of a write that lands after the active provider changed', async () => {
        const told: string[] = [];
        const stop = omni.subscribeRecommendationPreferenceSaves(id => told.push(id));
        let finish: (value: { confirmed: boolean }) => void = () => undefined;
        registerOnlineMusicProvider(provider(providerId, true, {
            getRecommendationPreferences: async () => answer,
            saveRecommendationPreferences: () => new Promise(resolve => { finish = resolve; }),
        }));
        registerOnlineMusicProvider(provider(otherProviderId, true, {
            getRecommendationPreferences: async () => answer,
            saveRecommendationPreferences: async () => ({ confirmed: true }),
        }));
        activate(providerId);

        const saving = omni.saveRecommendationPreferences({ live: 60 });
        omni.invalidateActiveRequests();
        activate(otherProviderId);
        finish({ confirmed: true });
        await expect(saving).rejects.toMatchObject({ name: 'AbortError' });
        expect(told).toEqual([providerId]);
        stop();
    });

    it('drops an answer that arrives after the active provider changed', async () => {
        let finish: (value: RecommendationPreferences) => void = () => undefined;
        registerOnlineMusicProvider(provider(providerId, true, {
            getRecommendationPreferences: () => new Promise(resolve => { finish = resolve; }),
            saveRecommendationPreferences: async () => ({ confirmed: true }),
        }));
        registerOnlineMusicProvider(provider(otherProviderId, true, {
            getRecommendationPreferences: async () => answer,
            saveRecommendationPreferences: async () => ({ confirmed: true }),
        }));
        activate(providerId);

        const reading = omni.getRecommendationPreferences();
        omni.invalidateActiveRequests();
        activate(otherProviderId);
        finish(answer);
        await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    });
});
