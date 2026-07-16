import { describe, expect, it, vi } from 'vitest';
import { dispatchSearchTrackAction } from '@/components/app/search/searchTrackActions';
import type { LocalSong, UnifiedSong } from '@/types';

// Verifies search playback and queue actions dispatch to the matching source.

const localSong: LocalSong = {
    id: 'local-1',
    fileName: 'local.mp3',
    filePath: '/local.mp3',
    duration: 1000,
    fileSize: 1,
    mimeType: 'audio/mpeg',
    addedAt: 1,
    title: 'Local',
    titleOrigin: 'import',
    importedMetadata: { title: 'Local', titleSource: 'filename', artistNames: [], albumName: '' },
};

const track = (patch: Partial<UnifiedSong> = {}): UnifiedSong => ({
    id: 1,
    name: 'Track',
    artists: [],
    album: { id: 1, name: 'Album' },
    duration: 1000,
    ...patch,
});

describe('dispatchSearchTrackAction', () => {
    it.each([
        ['local', track({ isLocal: true, localRef: { songId: localSong.id } })],
        ['netease', track()],
    ])('dispatches %s tracks to the matching action', (source, song) => {
        const onLocal = vi.fn();
        const onNavidrome = vi.fn();
        const onNetease = vi.fn();

        expect(dispatchSearchTrackAction(song, {
            localSongs: [localSong],
            onLocal,
            onNavidrome,
            onNetease,
        })).toBe(true);

        expect(onLocal).toHaveBeenCalledTimes(source === 'local' ? 1 : 0);
        expect(onNetease).toHaveBeenCalledTimes(source === 'netease' ? 1 : 0);
    });

    it('dispatches Navidrome tracks through their playback carrier', () => {
        const onNavidrome = vi.fn();
        const navidromeData = {
            ...track(),
            id: 'navi-1',
            isNavidrome: true,
        } as any;

        dispatchSearchTrackAction(track({ isNavidrome: true, navidromeData }), {
            localSongs: [],
            onLocal: vi.fn(),
            onNavidrome,
            onNetease: vi.fn(),
        });

        expect(onNavidrome).toHaveBeenCalledWith(navidromeData);
    });

    it('blocks unavailable songs for both play and queue callers', () => {
        const actions = {
            localSongs: [],
            onLocal: vi.fn(),
            onNavidrome: vi.fn(),
            onNetease: vi.fn(),
        };
        const didDispatch = dispatchSearchTrackAction(track({
            privilege: { st: -200 },
        }), actions);

        expect(didDispatch).toBe(false);
        expect(actions.onNetease).not.toHaveBeenCalled();
    });
});
