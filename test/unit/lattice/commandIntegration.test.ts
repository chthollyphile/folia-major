import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPlaybackCommandContext, type PlaybackCommandContextDeps } from '../../../src/components/app/command-palette-context/buildAppOwnedCommandContext';
import { useAppViewStore } from '../../../src/stores/useAppViewStore';
import { focusLatticeCurrentSong, useLatticeControlsStore } from '../../../src/stores/useLatticeControlsStore';
import { getQueueSongMatches } from '../../../src/components/command-palette/queueSongMatches';
import type { CommandPaletteContext } from '../../../src/components/command-palette/types';
import type { SongResult } from '../../../src/types';

// test/unit/lattice/commandIntegration.test.ts
// Queue result execution must preserve the live surface even if it changed after palette creation.
const song: SongResult = {
    id: '1', name: 'Example', artists: [{ id: 1, name: 'Artist' }],
    album: { id: 1, name: 'Album' }, durationMs: 180000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' },
};
afterEach(() => {
    useAppViewStore.getState().setView('home');
    useLatticeControlsStore.setState({ focusCurrentSong: null });
});

describe('lattice command integration', () => {
    it('selects queue songs without navigating out of lattice, and preserves normal player navigation', async () => {
        const playSong = vi.fn();
        const playback = buildPlaybackCommandContext({ playSong, queue: [song] } as unknown as PlaybackCommandContextDeps);
        const context = { playback, shared: { t: (_key: string, fallback: string) => fallback, currentSong: null } } as unknown as CommandPaletteContext;
        const match = getQueueSongMatches('', context)[0];
        expect(match).toBeDefined();
        for (const view of ['lattice', 'home', 'player'] as const) {
            useAppViewStore.getState().setView(view);
            await match.command.execute('', context);
            expect(playSong).toHaveBeenLastCalledWith(song, [song], false, { shouldNavigateToPlayer: view !== 'lattice' });
        }
    });
    it('unregisters the wall capability without erasing a newer wall registration', () => {
        const first = vi.fn();
        const second = vi.fn();
        const removeFirst = useLatticeControlsStore.getState().registerFocus(first);
        expect(focusLatticeCurrentSong()).toBe(true);
        const removeSecond = useLatticeControlsStore.getState().registerFocus(second);
        removeFirst();
        expect(focusLatticeCurrentSong()).toBe(true);
        expect(second).toHaveBeenCalledOnce();
        removeSecond();
        expect(focusLatticeCurrentSong()).toBe(false);
    });
});
