import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ENABLE_MEDIA_CACHE_KEY,
    LEGACY_ENABLE_MEDIA_CACHE_KEY,
    readStoredEnableMediaCache,
} from '@/stores/useSettingsUiStore';

// test/unit/stores/enableMediaCache.test.ts
// The toggle used to write a bare key while startup read the prefixed one, so it never survived a
// restart. Locks both halves of the repair: the canonical key, and the rescue of what the broken
// setter left behind.

describe('stored media cache preference', () => {
    let values: Map<string, string>;

    beforeEach(() => {
        values = new Map();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
        };
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('defaults to off when nothing has been stored', () => {
        expect(readStoredEnableMediaCache()).toBe(false);
    });

    it('reads the canonical key', () => {
        localStorage.setItem(ENABLE_MEDIA_CACHE_KEY, 'true');
        expect(readStoredEnableMediaCache()).toBe(true);
    });

    it('rescues a preference the old setter stranded under the legacy key', () => {
        localStorage.setItem(LEGACY_ENABLE_MEDIA_CACHE_KEY, 'true');

        expect(readStoredEnableMediaCache()).toBe(true);
        // Promoted, so the next start reads it without needing the fallback again.
        expect(values.get(ENABLE_MEDIA_CACHE_KEY)).toBe('true');
    });

    it('rescues a legacy off just as faithfully as a legacy on', () => {
        localStorage.setItem(LEGACY_ENABLE_MEDIA_CACHE_KEY, 'false');

        expect(readStoredEnableMediaCache()).toBe(false);
        expect(values.get(ENABLE_MEDIA_CACHE_KEY)).toBe('false');
    });

    it('prefers the canonical key over a stale legacy value', () => {
        localStorage.setItem(LEGACY_ENABLE_MEDIA_CACHE_KEY, 'true');
        localStorage.setItem(ENABLE_MEDIA_CACHE_KEY, 'false');

        expect(readStoredEnableMediaCache()).toBe(false);
    });

    it('survives a server-side render with no window at all', () => {
        vi.unstubAllGlobals();
        vi.stubGlobal('window', undefined);

        expect(readStoredEnableMediaCache()).toBe(false);
    });
});
