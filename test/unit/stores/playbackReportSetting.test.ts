// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stores/playbackReportSetting.test.ts
// Folium 2.0 plan §7 (the row of folia_netease_scrobble): the listening report setting is the host's own,
// stored per source id. NetEase, whose setting was stored before, keeps reading and writing its old key, so
// the choice made in an older build stands; any other source has a key of its own.

const createStorage = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial));
    return {
        values,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
        clear: () => values.clear(),
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() { return values.size; },
    };
};

describe('the listening report setting, per source', () => {
    beforeEach(() => vi.resetModules());
    afterEach(() => vi.unstubAllGlobals());

    it('reads NetEase\'s choice from its old key and writes it back there', async () => {
        const storage = createStorage({ folia_netease_scrobble: 'true' });
        vi.stubGlobal('localStorage', storage);
        const { useAudioSettingsStore, isPlaybackReportEnabled, playbackReportStorageKey } = await import('@/stores/useAudioSettingsStore');

        expect(playbackReportStorageKey('netease')).toBe('folia_netease_scrobble');
        expect(isPlaybackReportEnabled(useAudioSettingsStore.getState(), 'netease')).toBe(true);
        useAudioSettingsStore.getState().handleSetPlaybackReport('netease', false);
        expect(storage.values.get('folia_netease_scrobble')).toBe('false');
        expect(isPlaybackReportEnabled(useAudioSettingsStore.getState(), 'netease')).toBe(false);
    });

    it('keeps any other source\'s choice under a key of its own, off until set, apart from NetEase\'s', async () => {
        const storage = createStorage({ folia_netease_scrobble: 'true', 'folia_playback_report:folium.mod.radio': 'true' });
        vi.stubGlobal('localStorage', storage);
        const { useAudioSettingsStore, isPlaybackReportEnabled } = await import('@/stores/useAudioSettingsStore');
        const state = () => useAudioSettingsStore.getState();

        // Read from storage the first time it is asked for.
        expect(isPlaybackReportEnabled(state(), 'folium.mod.radio')).toBe(true);
        expect(isPlaybackReportEnabled(state(), 'kugou')).toBe(false);
        expect(isPlaybackReportEnabled(state(), null)).toBe(false);

        state().handleSetPlaybackReport('kugou', true);
        expect(storage.values.get('folia_playback_report:kugou')).toBe('true');
        expect(isPlaybackReportEnabled(state(), 'kugou')).toBe(true);
        expect(isPlaybackReportEnabled(state(), 'netease')).toBe(true);
        expect(storage.values.get('folia_netease_scrobble')).toBe('true');
    });
});
