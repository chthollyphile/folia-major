import { describe, expect, it } from 'vitest';
import { PlayerState } from '@/types';
import { isPausedByListener } from '@/services/automix/useAutomixDecks';

// test/unit/automix/pauseSignal.test.ts
// Pins the one distinction that decides whether automix works at all.

describe('isPausedByListener', () => {
    it('treats an explicit pause as the listener stopping playback', () => {
        expect(isPausedByListener(PlayerState.PAUSED)).toBe(true);
    });

    it('does not treat IDLE as a pause', () => {
        // playSong passes through IDLE partway through every ordinary track change, which is
        // exactly what an armed transition is waiting on. Aborting there would cancel every
        // blend a fraction of a second after arming it.
        expect(isPausedByListener(PlayerState.IDLE)).toBe(false);
    });

    it('does not treat playing as a pause', () => {
        expect(isPausedByListener(PlayerState.PLAYING)).toBe(false);
    });
});
