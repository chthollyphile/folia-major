import { describe, expect, it, vi } from 'vitest';
import { createLyricFilterPatternSaver } from '@/components/app/home/createLyricFilterPatternSaver';
import type { LyricData } from '@/types';
import type { LyricLineRule } from '@/utils/lyrics/lyricLineRules';

// test/unit/lyrics/lyricFilterPatternSaver.test.ts
// Saving the lyric filter stores the rules and lays the current song out again. The rules are
// applied where lyrics are shown, so the current lyrics are only handed to the setter again, after
// the new rules are stored.

describe('lyric filter saver', () => {
    it('stores the rules, then lays the current lyrics out again', async () => {
        const setRules = vi.fn();
        const setLyrics = vi.fn();
        const current: LyricData = { lines: [] };
        const loadPreview = vi.fn(async () => current);
        const rules: LyricLineRule[] = [{ id: 'legacy', on: false, shape: 'written', text: '^赞助' }];
        const saver = createLyricFilterPatternSaver({
            handleSetLyricLineRules: setRules,
            handleSetLyricStaffPolicy: vi.fn(),
            handleSetLyricStaffMinDwellSeconds: vi.fn(),
            handleSetLyricStaffAbsorbMode: vi.fn(),
            handleSetLyricStaffPattern: vi.fn(),
            loadCurrentSongLyricPreview: loadPreview,
            setLyrics,
        });

        await saver({ rules, staffPolicy: 'keep', staffMinDwellSeconds: 2, staffAbsorbMode: 'off', staffPattern: '^作词' });

        expect(setRules).toHaveBeenCalledWith(rules);
        expect(setLyrics).toHaveBeenCalledTimes(1);
        expect(setLyrics).toHaveBeenCalledWith(current);
        expect(setRules.mock.invocationCallOrder[0]).toBeLessThan(loadPreview.mock.invocationCallOrder[0]);
    });
});
