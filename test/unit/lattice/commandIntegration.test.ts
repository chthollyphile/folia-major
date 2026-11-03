import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPlaybackCommandContext, type PlaybackCommandContextDeps } from '../../../src/components/app/command-palette-context/buildAppOwnedCommandContext';
import { useAppViewStore } from '../../../src/stores/useAppViewStore';
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
});
