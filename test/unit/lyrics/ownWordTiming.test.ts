import { beforeEach, describe, expect, it } from 'vitest';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { asksBeforeOwnWordTiming, firstLyricSourceAsked, settlesOnOwnWordTiming } from '@/utils/lyrics/ownWordTiming';

// test/unit/lyrics/ownWordTiming.test.ts
// When the automatic lyric pick settles on a song's own word timing without asking another source (issue #1127).

const wordLevel = { lines: [], isWordByWord: true };
const lineLevel = { lines: [], isWordByWord: false };
const appleCheck = { ownSource: 'appleMusic' as const, prefersOwn: true, lyrics: wordLevel, keepOwn: true };

describe('own word timing', () => {
    beforeEach(() => useOnlineProviderAccountStore.setState({ accounts: {} }));

    it('asks a preferred source that is not the song\'s own platform first', () => {
        expect(settlesOnOwnWordTiming(appleCheck, 'kugou')).toBe(false);
        expect(settlesOnOwnWordTiming(appleCheck, 'qq')).toBe(false);
    });

    it('settles at once when the preferred source is the song\'s own platform, account read or not', () => {
        // At startup the platform's account may not be read yet: the song's own lyrics are in hand anyway.
        expect(firstLyricSourceAsked('appleMusic', 'appleMusic')).toBe('appleMusic');
        expect(settlesOnOwnWordTiming(appleCheck, 'appleMusic')).toBe(true);
    });

    it('falls back to the default source for a preferred source not on offer', () => {
        expect(firstLyricSourceAsked('spotify', 'appleMusic')).toBe('qq');
        expect(settlesOnOwnWordTiming(appleCheck, 'spotify')).toBe(false);
    });

    it('does not ask a preferred source that has lines only', () => {
        useOnlineProviderAccountStore.getState().updateAccount('spotify', { user: { id: 'me', nickname: 'me' } });
        expect(asksBeforeOwnWordTiming('appleMusic', 'spotify')).toBe(false);
        expect(settlesOnOwnWordTiming(appleCheck, 'spotify')).toBe(true);
    });

    it('keeps nothing when the listener turned it off, the lyrics have no words, or the platform does not ask for it', () => {
        expect(settlesOnOwnWordTiming({ ...appleCheck, keepOwn: false }, 'appleMusic')).toBe(false);
        expect(settlesOnOwnWordTiming({ ...appleCheck, lyrics: lineLevel }, 'appleMusic')).toBe(false);
        expect(settlesOnOwnWordTiming({ ...appleCheck, prefersOwn: false }, 'appleMusic')).toBe(false);
    });
});
