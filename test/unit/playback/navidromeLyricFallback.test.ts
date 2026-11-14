import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/playback/navidromeLyricFallback.test.ts
// A Navidrome song's last try for lyrics (plan §7.1): it asks the first source ready to match, in the metadata
// order, instead of one named in the code; with none ready it searches nothing and fails nothing.

const state = vi.hoisted(() => ({ ready: [] as string[] }));
const omni = vi.hoisted(() => ({
    searchProviderSongs: vi.fn(),
    getLyrics: vi.fn(),
}));

vi.mock('@/services/onlineMusic/crossSource', () => ({
    participants: () => ({ ready: state.ready, skipped: [] }),
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni }));

import { findNavidromeLyricFallback } from '@/components/app/playback/start/navidromeLyricFallback';

afterEach(() => {
    vi.restoreAllMocks();
    omni.searchProviderSongs.mockReset();
    omni.getLyrics.mockReset();
});

describe('findNavidromeLyricFallback', () => {
    const hit = { id: 'm1', name: 'T', artists: [], album: { id: '', name: '' }, durationMs: 1 };
    const lyrics = { lyrics: { lines: [] }, isPureMusic: false };

    it('searches the first source ready to match, whichever it is', async () => {
        state.ready = ['qq', 'kugou'];
        omni.searchProviderSongs.mockResolvedValue({ items: [hit] });
        omni.getLyrics.mockResolvedValue(lyrics);
        await expect(findNavidromeLyricFallback('T A')).resolves.toEqual({ source: 'qq', song: hit, lyrics });
        expect(omni.searchProviderSongs).toHaveBeenCalledWith('qq', 'T A', { limit: 1, offset: 0 });
        expect(omni.getLyrics).toHaveBeenCalledWith(hit);
    });

    it('searches nothing when no source is ready, and is no failure', async () => {
        vi.spyOn(console, 'info').mockImplementation(() => {});
        state.ready = [];
        await expect(findNavidromeLyricFallback('T A')).resolves.toBeNull();
        expect(omni.searchProviderSongs).not.toHaveBeenCalled();
    });

    it('fetches no lyrics when the search finds nothing', async () => {
        state.ready = ['kugou'];
        omni.searchProviderSongs.mockResolvedValue({ items: [] });
        await expect(findNavidromeLyricFallback('T A')).resolves.toBeNull();
        expect(omni.getLyrics).not.toHaveBeenCalled();
    });
});
