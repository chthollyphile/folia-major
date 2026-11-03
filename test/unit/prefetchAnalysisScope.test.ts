import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { SongResult } from '@/types';
import { omni } from '@/services/onlineMusic/omni';
import { clearPrefetchRuntime, prefetchNearbySongs } from '@/services/prefetchService';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';

// test/unit/prefetchAnalysisScope.test.ts
// The analysis scope's next song is the track automix would blend into, and that track is among
// the songs prefetched. Pinned on the inputs where prefetch and automix used to answer differently:
// the last track in repeat-all and the last Personal FM track.

const { setAnalysisScope } = vi.hoisted(() => ({ setAnalysisScope: vi.fn() }));

vi.mock('@/services/automix/profileService', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/automix/profileService')>()),
    setAnalysisScope,
}));

const song = (id: string, name: string): SongResult => ({
    id,
    name,
    artists: [],
    album: { id: 'album', name: 'Album' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: id },
});

const [alpha, bravo, charlie] = [song('a', 'Alpha'), song('b', 'Bravo'), song('c', 'Charlie')];
const queue = [alpha, bravo, charlie];

describe('prefetchNearbySongs analysis scope', () => {
    // Every song is refused at the provider check, the first thing a prefetch asks, so the order
    // of those calls is the order of the songs to prefetch and nothing is requested.
    let canPlaySong: MockInstance<typeof omni.canPlaySong>;

    beforeEach(() => {
        setAnalysisScope.mockClear();
        canPlaySong = vi.spyOn(omni, 'canPlaySong').mockReturnValue(false);
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.stubGlobal('window', globalThis);
        vi.stubGlobal('requestIdleCallback', (run: () => void) => { run(); return 0; });
        useAudioSettingsStore.setState({ loopMode: 'off' });
        usePlaybackStore.setState({ isFmMode: false });
    });

    afterEach(() => {
        clearPrefetchRuntime();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        useAudioSettingsStore.setState({ loopMode: 'off' });
        usePlaybackStore.setState({ isFmMode: false });
    });

    const run = async (currentSong: SongResult, playQueue: SongResult[] = queue) => {
        await prefetchNearbySongs(currentSong, playQueue, 'high');
        await new Promise(resolve => setTimeout(resolve, 0));
        return {
            scope: (setAnalysisScope.mock.lastCall?.[0] as SongResult[]).map(item => item.name),
            prefetched: canPlaySong.mock.calls.map(([item]) => item.name),
        };
    };

    it('scopes the current and the following track inside the queue', async () => {
        expect(await run(bravo)).toEqual({ scope: ['Bravo', 'Charlie'], prefetched: ['Charlie', 'Alpha'] });
    });

    it('scopes only the last track when repeat is off', async () => {
        expect(await run(charlie)).toEqual({ scope: ['Charlie'], prefetched: ['Bravo'] });
    });

    it('goes round to the first track from the last one in repeat-all, and prefetches it first', async () => {
        useAudioSettingsStore.setState({ loopMode: 'all' });

        expect(await run(charlie)).toEqual({ scope: ['Charlie', 'Alpha'], prefetched: ['Alpha', 'Bravo'] });
    });

    it('prefetches the first track of a two-track queue once', async () => {
        useAudioSettingsStore.setState({ loopMode: 'all' });

        expect(await run(bravo, [alpha, bravo])).toEqual({ scope: ['Bravo', 'Alpha'], prefetched: ['Alpha'] });
    });

    it('prefetches a song queued twice once when its other entry is already in the window', async () => {
        useAudioSettingsStore.setState({ loopMode: 'all' });
        const alphaAgain = song('a', 'Alpha');

        expect(await run(charlie, [alpha, bravo, alphaAgain, charlie]))
            .toEqual({ scope: ['Charlie', 'Alpha'], prefetched: ['Alpha'] });
    });

    it('has no next track on the last Personal FM track, repeat-all or not', async () => {
        usePlaybackStore.setState({ isFmMode: true });
        expect(await run(charlie)).toEqual({ scope: ['Charlie'], prefetched: ['Bravo'] });

        canPlaySong.mockClear();
        useAudioSettingsStore.setState({ loopMode: 'all' });
        expect(await run(charlie)).toEqual({ scope: ['Charlie'], prefetched: ['Bravo'] });
    });
});
