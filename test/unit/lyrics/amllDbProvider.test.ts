import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAmllDbLyrics } from '@/utils/lyrics/providers/amllDbProvider';
import { parseLyricsByFormat } from '@/utils/lyrics/parserCore';

// test/unit/lyrics/amllDbProvider.test.ts

vi.mock('@/utils/lyrics/parserCore', () => ({
    parseLyricsByFormat: vi.fn()
}));

describe('amllDbProvider', () => {
    const fetchMock = vi.fn();
    const parseLyricsByFormatMock = vi.mocked(parseLyricsByFormat);

    beforeEach(() => {
        vi.resetAllMocks();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('fetches TTML by platform id and parses it', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            text: vi.fn().mockResolvedValue('<tt xmlns="http://www.w3.org/ns/ttml"><body /></tt>')
        });
        parseLyricsByFormatMock.mockReturnValue({
            lines: [{ fullText: 'Hello', startTime: 0, endTime: 1, words: [] }],
            isWordByWord: true
        });

        const result = await fetchAmllDbLyrics('ncm', 123);

        expect(fetchMock).toHaveBeenCalledWith('/api/lyric-proxy?url=https%3A%2F%2Famll-ttml-db.stevexmh.net%2Fncm%2F123%3Fformat%3Dttml');
        expect(parseLyricsByFormatMock).toHaveBeenCalledWith('ttml', '<tt xmlns="http://www.w3.org/ns/ttml"><body /></tt>');
        expect(result?.isWordByWord).toBe(true);
    });

    it('returns null for 404 responses', async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 404,
            text: vi.fn()
        });

        const result = await fetchAmllDbLyrics('qq', 'abc');

        expect(result).toBeNull();
        expect(parseLyricsByFormatMock).not.toHaveBeenCalled();
    });

    it('returns null for non-TTML content', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            text: vi.fn().mockResolvedValue('not found')
        });

        const result = await fetchAmllDbLyrics('qq', 456);

        expect(result).toBeNull();
        expect(parseLyricsByFormatMock).not.toHaveBeenCalled();
    });

    it('returns null when parsing fails', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            text: vi.fn().mockResolvedValue('<tt></tt>')
        });
        parseLyricsByFormatMock.mockImplementation(() => {
            throw new Error('bad ttml');
        });

        await expect(fetchAmllDbLyrics('ncm', 789)).resolves.toBeNull();
    });
});
