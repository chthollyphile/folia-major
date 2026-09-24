import { describe, expect, it } from 'vitest';
import type { Line, SongResult, Theme } from '@/types';
import { toFoliumLines, toFoliumSong, toFoliumTheme } from '@/mods/folium/dto';
import { getLineRenderEndTime } from '@/utils/lyrics/renderHints';

// test/unit/mod-system/foliumDto.test.ts
// The DTO projections are the only place that knows host types and Folium
// types at once. These pin that host-only fields never leak, that line end
// times are the render end, and that projections are cached by identity.

const line = (overrides: Partial<Line> = {}): Line => ({
    words: [{ text: 'hi', startTime: 1, endTime: 2 }],
    startTime: 1,
    endTime: 2,
    fullText: 'hi',
    ...overrides,
});

describe('toFoliumLines', () => {
    it('projects only the public fields', () => {
        const [projected] = toFoliumLines([line({ translation: 'salut', agentId: 'v1', wordSegments: ['h', 'i'] })]);
        expect(Object.keys(projected).sort()).toEqual(['endTime', 'startTime', 'text', 'translation', 'words']);
        expect(projected.words).toEqual([{ text: 'hi', startTime: 1, endTime: 2 }]);
    });

    it('uses the render end time', () => {
        const source = line();
        expect(toFoliumLines([source])[0].endTime).toBe(getLineRenderEndTime(source));
    });

    it('caches by array identity and freezes the result', () => {
        const lines = [line()];
        const first = toFoliumLines(lines);
        expect(toFoliumLines(lines)).toBe(first);
        expect(Object.isFrozen(first)).toBe(true);
        expect(Object.isFrozen(first[0])).toBe(true);
    });

    it('falls back to joined words when fullText is missing', () => {
        const [projected] = toFoliumLines([line({ fullText: undefined as unknown as string })]);
        expect(projected.text).toBe('hi');
    });
});

describe('toFoliumTheme', () => {
    it('resolves font stack and weight and carries daylight', () => {
        const theme = {
            name: 't', backgroundColor: '#000', primaryColor: '#fff', accentColor: '#f0f', secondaryColor: '#888',
            fontStyle: 'serif', animationIntensity: 'normal', fontWeight: 700,
        } as Theme;
        const projected = toFoliumTheme(theme, true);
        expect(projected.fontWeight).toBe(700);
        expect(projected.fontFamily).toContain('serif');
        expect(projected.isDaylight).toBe(true);
        expect(Object.keys(projected).sort()).toEqual([
            'accentColor', 'backgroundColor', 'fontFamily', 'fontWeight', 'isDaylight', 'primaryColor', 'secondaryColor',
        ]);
    });

    it('has safe defaults without a theme', () => {
        expect(toFoliumTheme(null, false).backgroundColor).toBeTruthy();
    });
});

describe('toFoliumSong', () => {
    it('joins artists and reports the source kind', () => {
        const song = {
            id: 42,
            name: 'Song',
            artists: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
            album: { id: 3, name: 'Album' },
            durationMs: 1000,
        } as unknown as SongResult;
        expect(toFoliumSong(song)).toEqual({ id: '42', title: 'Song', artist: 'A / B', album: 'Album', source: 'netease' });
        expect(toFoliumSong(null)).toBeNull();
    });
});
