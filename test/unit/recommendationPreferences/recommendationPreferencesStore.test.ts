import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import {
    currentPreferencesOwner,
    isRecommendationPreferencesOffered,
    offersRecommendationPreferencesAt,
    useRecommendationPreferencesStore,
} from '@/components/recommendationPreferences/useRecommendationPreferencesStore';
import type {
    OnlineMusicProvider,
    OnlineRecommendationProvider,
    RecommendationPreferences,
    RecommendationPreferencesSaveResult,
} from '@/types/onlineMusic';

// test/unit/recommendationPreferences/recommendationPreferencesStore.test.ts
// 偏好面板的状态：只给已登录、平台支持的账号；读到的值做成草稿；保存和重置只交改动、同一时间只存一次；
// 换了账号、重新打开、答复晚到都不再写进面板。命令和入口按同样的条件出现。

const providerId = 'preferences-store-test';

const answer = (): RecommendationPreferences => ({
    items: [
        {
            kind: 'choice',
            key: 'mood',
            label: { labelFallback: 'Mood' },
            options: [{ value: 'sad', label: { labelFallback: 'Sad' } }, { value: 'same', label: { labelFallback: 'Same' } }],
            value: 'sad',
            defaultValue: 'same',
        },
        { kind: 'ratio', key: 'live', label: { labelFallback: 'Live' }, min: 1, max: 99, defaultValue: 50, value: 70 },
    ],
});

const register = (recommendations: OnlineRecommendationProvider, declares = true) => {
    const provider: OnlineMusicProvider = {
        id: providerId,
        displayName: providerId,
        capabilities: {
            search: false, playback: false, lyrics: false, auth: true, userLibrary: false,
            playlists: false, albums: false, artists: false, recommendations: true,
            mutations: false, wordByWordLyrics: false, ...(declares ? { recommendationPreferences: true } : {}),
        },
        normalizeSong: () => { throw new Error('not used'); },
        recommendations,
    };
    registerOnlineMusicProvider(provider);
};

const signIn = (userId = 'u1') => {
    const accounts = useOnlineProviderAccountStore.getState();
    accounts.setActiveProviderId(providerId);
    accounts.updateAccount(providerId, { status: 'authenticated', user: { id: userId, nickname: userId } as never });
};

const deferred = <T>() => {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
};

const store = () => useRecommendationPreferencesStore.getState();

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    unregisterOnlineMusicProvider(providerId);
    useOnlineProviderAccountStore.getState().clearAccount(providerId);
    useOnlineProviderAccountStore.getState().setActiveProviderId('netease');
    omni.invalidateActiveRequests();
    useRecommendationPreferencesStore.setState({ owner: null, phase: 'idle', preferences: null, draft: {}, saving: false });
});

describe('who the preferences are offered to', () => {
    it('needs a signed-in account on a provider that supports them', () => {
        register({ preferenceEntries: ['daily'], getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: async () => ({ confirmed: true }) });
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
        expect(isRecommendationPreferencesOffered()).toBe(false);

        signIn();
        expect(currentPreferencesOwner()).toBe(`${providerId}:u1`);
        expect(offersRecommendationPreferencesAt('daily')).toBe(true);
        expect(offersRecommendationPreferencesAt('explore')).toBe(false);
    });

    it('offers nothing on a provider that does not declare them, signed in or not', () => {
        register({ preferenceEntries: ['daily'], getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: async () => ({ confirmed: true }) }, false);
        signIn();
        expect(isRecommendationPreferencesOffered()).toBe(false);
        expect(offersRecommendationPreferencesAt('daily')).toBe(false);
    });
});

describe('the preferences panel state', () => {
    it('reads on open and starts the draft from what it read', async () => {
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: async () => ({ confirmed: true }) });
        signIn();
        await store().open();
        expect(store().phase).toBe('ready');
        expect(store().draft).toEqual({ mood: 'sad', live: 70 });
    });

    it('stays idle without an account, and says when the read failed', async () => {
        const read = vi.fn(async () => { throw new Error('down'); });
        register({ getRecommendationPreferences: read, saveRecommendationPreferences: async () => ({ confirmed: true }) });
        useOnlineProviderAccountStore.getState().setActiveProviderId(providerId);
        await store().open();
        expect(store().phase).toBe('idle');
        expect(read).not.toHaveBeenCalled();

        signIn();
        await store().open();
        expect(store().phase).toBe('failed');
    });

    it('drops a read that arrives after the account changed', async () => {
        const reading = deferred<RecommendationPreferences>();
        register({ getRecommendationPreferences: () => reading.promise, saveRecommendationPreferences: async () => ({ confirmed: true }) });
        signIn('u1');
        const opening = store().open();
        signIn('u2');
        reading.resolve(answer());
        await opening;
        expect(store().phase).toBe('loading');
        expect(store().preferences).toBeNull();
    });

    it('writes the defaults, and ignores keys it does not have', async () => {
        const save = vi.fn(async () => ({ confirmed: true }));
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: save });
        signIn();
        await store().open();
        store().setValue('unknown', 3);
        await expect(store().save('reset')).resolves.toBe('confirmed');
        expect(store().draft).toEqual({ mood: 'same', live: 50 });
        expect(save).toHaveBeenCalledWith({ mood: 'same', live: 50 });
    });

    it('saves only the changes and takes a confirmed save as the account value', async () => {
        const save = vi.fn(async (): Promise<RecommendationPreferencesSaveResult> => ({ confirmed: true }));
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: save });
        signIn();
        await store().open();
        await expect(store().save()).resolves.toBe('unchanged');
        expect(save).not.toHaveBeenCalled();

        store().setValue('live', 60);
        await expect(store().save()).resolves.toBe('confirmed');
        expect(save).toHaveBeenCalledWith({ live: 60 });
        expect(store().saving).toBe(false);
        await expect(store().save()).resolves.toBe('unchanged');
    });

    it('keeps the read value after a save that was not confirmed, so the change is still there', async () => {
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: async () => ({ confirmed: false }) });
        signIn();
        await store().open();
        store().setValue('mood', 'same');
        await expect(store().save()).resolves.toBe('unconfirmed');
        expect(store().draft.mood).toBe('same');
        expect(store().preferences?.items[0].value).toBe('sad');
    });

    it('keeps an unchanged __proto__ value and saves it when edited', async () => {
        const preferences = answer();
        preferences.items.push({ ...preferences.items[1], key: '__proto__' });
        const save = vi.fn(async () => ({ confirmed: true }));
        register({ getRecommendationPreferences: async () => preferences, saveRecommendationPreferences: save });
        signIn();
        await store().open();
        expect(store().draft.__proto__).toBe(70);

        store().setValue('live', 60);
        await expect(store().save()).resolves.toBe('confirmed');
        expect(store().preferences?.items[2].value).toBe(70);

        store().setValue('__proto__', 55);
        await expect(store().save()).resolves.toBe('confirmed');
        expect(save).toHaveBeenLastCalledWith({ ['__proto__']: 55 });
        expect(store().preferences?.items[2].value).toBe(55);
        await expect(store().save()).resolves.toBe('unchanged');
    });

    it('keeps the choices after a failed save and lets it be tried again', async () => {
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: async () => { throw new Error('down'); } });
        signIn();
        await store().open();
        store().setValue('live', 30);
        await expect(store().save()).resolves.toBe('failed');
        expect(store().saving).toBe(false);
        expect(store().draft.live).toBe(30);
    });

    it('saves once at a time and holds the controls while it saves', async () => {
        const saving = deferred<RecommendationPreferencesSaveResult>();
        const save = vi.fn(() => saving.promise);
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: save });
        signIn();
        await store().open();
        store().setValue('live', 30);
        const first = store().save();
        await expect(store().save()).resolves.toBe('busy');
        store().setValue('live', 90);
        await expect(store().save('reset')).resolves.toBe('busy');
        expect(store().draft.live).toBe(30);
        saving.resolve({ confirmed: true });
        await expect(first).resolves.toBe('confirmed');
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('no longer shows a write that lands after the account changed', async () => {
        const saving = deferred<RecommendationPreferencesSaveResult>();
        register({ getRecommendationPreferences: async () => answer(), saveRecommendationPreferences: () => saving.promise });
        signIn('u1');
        await store().open();
        store().setValue('live', 30);
        const pending = store().save();
        signIn('u2');
        saving.resolve({ confirmed: true });
        await expect(pending).resolves.toBe('stale');
        expect(store().saving).toBe(false);
        expect(store().preferences?.items[1].value).toBe(70);
    });

    it('waits for the account save before a reopened panel reads or saves again', async () => {
        const saving = deferred<RecommendationPreferencesSaveResult>();
        let persisted = 70;
        const read = vi.fn(async () => {
            const preferences = answer();
            preferences.items[1].value = persisted;
            return preferences;
        });
        const save = vi.fn(async () => {
            const result = await saving.promise;
            persisted = 30;
            return result;
        });
        register({ getRecommendationPreferences: read, saveRecommendationPreferences: save });
        signIn();
        await store().open();
        store().setValue('live', 30);
        const pending = store().save();
        const reopened = store().open();
        expect(store().phase).toBe('loading');
        expect(store().saving).toBe(true);
        expect(read).toHaveBeenCalledTimes(1);
        store().setValue('live', 90);
        await expect(store().save()).resolves.toBe('busy');
        expect(save).toHaveBeenCalledTimes(1);
        saving.resolve({ confirmed: true });
        await expect(pending).resolves.toBe('confirmed');
        await reopened;
        expect(read).toHaveBeenCalledTimes(2);
        expect(store().phase).toBe('ready');
        expect(store().draft.live).toBe(30);
        expect(store().saving).toBe(false);
    });
});
