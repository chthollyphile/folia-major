import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { externalBlocksAutomix } from '@/components/app/playback/externalPlaybackGate';

// A persisted blend setting must never schedule a deck transition into or out of Soloist's silent timeline.
const song = (providerId: 'spotify' | 'netease', id: string): SongResult => ({
    id, name: id, artists: [], album: { id: 'album', name: 'Album' }, durationMs: 200000,
    sourceRef: { kind: 'online', providerId, mediaId: id },
});
const gate = (queue: SongResult[], currentSong: SongResult, loopMode: 'off' | 'all' = 'off') => externalBlocksAutomix({
    playbackRoute: 'web', playQueue: queue, currentSong, loopMode, isFmMode: false,
});
describe('Soloist Automix exclusion', () => {
    it('blocks a blend from a currently playing Soloist track', () => {
        const current = song('spotify', 's'), next = song('netease', 'n');
        expect(gate([current, next], current)).toBe(true);
    });
    it('blocks a blend into a Soloist track, including loop-all wrap', () => {
        const current = song('netease', 'n'), next = song('spotify', 's');
        expect(gate([current, next], current)).toBe(true);
        expect(gate([next, current], current, 'all')).toBe(true);
        expect(gate([next, current], current)).toBe(false);
    });
    it('preserves ordinary deck transitions', () => {
        const current = song('netease', 'a'), next = song('netease', 'b');
        expect(gate([current, next], current)).toBe(false);
    });
});
