// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong, SongResult } from '@/types';
import type { NavidromeSong } from '@/types/navidrome';

// test/unit/lyrics/lyricMatchPieces.test.ts
// What the three kinds of lyric match window (a local file, a Navidrome song, an online song) do
// between the window and the functions that store a match: what they hand to the save, and what
// follows its answer. None of it shows in the window: a wrong value shows later, as lyrics taken
// from the wrong place, or as a window that closed although nothing was stored.
// The window itself and the search are stand-ins; the save functions are spies.

const env = vi.hoisted(() => ({
    /** What the piece gave the window the last time it drew. */
    window: null as null | { onSave: (result: unknown) => Promise<void>; noMatch?: { run: () => Promise<void> } },
    search: { source: 'qq', selectedResult: null as unknown },
    storedMatch: null as unknown,
    saveOnline: vi.fn(),
    saveNavidrome: vi.fn(),
    saveNavidromeNoMatch: vi.fn(),
    saveLocal: vi.fn(),
    saveLocalNoMatch: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/modal/lyric-match/LyricMatchWindow', () => ({
    LyricMatchWindow: (props: never) => {
        env.window = props;
        return null;
    },
}));
vi.mock('@/components/modal/lyric-match/useLyricMatchSearch', () => ({ useLyricMatchSearch: () => env.search }));
vi.mock('@/components/shared/useConfirmDialog', () => ({ useConfirmDialog: () => ({ ask: async () => true, dialog: null }) }));
vi.mock('@/services/onlineMusic/songMetadata', () => ({
    getProviderSongMetadata: () => ({ artists: [], album: null, durationMs: 1000, coverUrl: null, aliases: [], translatedNames: [] }),
}));
vi.mock('@/services/localCoverAssetUrl', () => ({ getLocalCoverAssetUrl: () => null }));
vi.mock('@/services/db', () => ({ getFromCacheWithMigration: async () => env.storedMatch, saveToCache: async () => {} }));
vi.mock('@/components/modal/lyric-match/onlineSongMatch', () => ({ pickOnlineResult: () => null, saveOnlineLyricMatch: env.saveOnline }));
vi.mock('@/components/modal/lyric-match/navidromeSongMatch', () => ({
    pickNavidromeResult: () => null,
    saveNavidromeLyricMatch: env.saveNavidrome,
    saveNavidromeNoMatch: env.saveNavidromeNoMatch,
}));
vi.mock('@/components/modal/lyric-match/localSongMatch', () => ({
    getLocalSongMatchFailureKey: (applied: { failed?: string }) => applied.failed ?? null,
    saveLocalSongMatch: env.saveLocal,
    saveLocalSongNoMatch: env.saveLocalNoMatch,
}));

const { default: OnlineSongLyricMatch } = await import('@/components/modal/lyric-match/OnlineSongLyricMatch');
const { default: NavidromeSongLyricMatch } = await import('@/components/modal/lyric-match/NavidromeSongLyricMatch');
const { default: LocalSongLyricMatch } = await import('@/components/modal/lyric-match/LocalSongLyricMatch');
const { useStatusMessageStore } = await import('@/stores/useStatusMessageStore');

const chosen = { id: 'r1', name: 'Result', artists: [], album: { id: '', name: '' }, durationMs: 1 } as unknown as SongResult;
const onlineSong = { id: 'x1', name: 'X', artists: [], album: { id: '', name: '' }, durationMs: 1 } as unknown as SongResult;
const navidromeSong = { id: 'n1', name: 'N', isNavidrome: true, navidromeData: { id: 'n1' } } as unknown as NavidromeSong;
const localSong = {
    id: 'l1', fileName: 'L.mp3', title: 'L', titleOrigin: 'import', duration: 100,
    importedMetadata: { title: 'L', artistNames: [] }, localCoverAssetId: 'cover-1', lyricsSource: 'local',
} as unknown as LocalSong;

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('the three kinds of lyric match window, between the window and the save', () => {
    let root: Root;
    const onMatch = vi.fn();

    beforeEach(() => {
        root = createRoot(document.createElement('div'));
        env.window = null;
        env.search = { source: 'qq', selectedResult: null };
        env.storedMatch = null;
        for (const spy of [env.saveOnline, env.saveNavidrome, env.saveNavidromeNoMatch, env.saveLocal, env.saveLocalNoMatch, onMatch]) spy.mockReset();
        useStatusMessageStore.setState({ message: null });
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        vi.restoreAllMocks();
    });

    const draw = (piece: unknown, song: unknown) => act(async () => {
        root.render(React.createElement(piece as React.FC<Record<string, unknown>>, { song, onMatch, onClose: () => {}, isDaylight: false }));
    });
    const save = () => act(async () => {
        await env.window!.onSave(chosen);
    });
    const message = () => useStatusMessageStore.getState().message?.text ?? null;

    it('an online song: saves with the source the window is on, and hands over only when something was stored', async () => {
        await draw(OnlineSongLyricMatch, onlineSong);
        env.saveOnline.mockResolvedValueOnce(false);
        await save();
        expect(env.saveOnline.mock.calls).toEqual([[onlineSong, 'qq', chosen]]);
        expect(onMatch).not.toHaveBeenCalled();
        expect(message()).toBe('localMusic.noLyricsAvailable');

        env.saveOnline.mockResolvedValueOnce(true);
        await save();
        expect(onMatch).toHaveBeenCalledTimes(1);

        // A save that throws hands nothing over either.
        env.saveOnline.mockRejectedValueOnce(new Error('offline'));
        await save();
        expect(onMatch).toHaveBeenCalledTimes(1);
    });

    it('a Navidrome song: a chosen result is saved as "use the match", whatever an earlier match had stored', async () => {
        env.storedMatch = { lyricsSource: 'navi' };
        await draw(NavidromeSongLyricMatch, navidromeSong);
        // No result chosen: the stored choice stands.
        env.saveNavidrome.mockResolvedValue(true);
        await save();
        expect(env.saveNavidrome.mock.calls.at(-1)).toEqual([navidromeSong, 'qq', chosen, 'navi']);

        env.search = { source: 'netease', selectedResult: chosen };
        await draw(NavidromeSongLyricMatch, navidromeSong);
        await save();
        expect(env.saveNavidrome.mock.calls.at(-1)).toEqual([navidromeSong, 'netease', chosen, 'online']);
        expect(onMatch).toHaveBeenCalledTimes(2);
    });

    it('a Navidrome song: nothing stored means no hand-over, and "no match" stores that and hands over', async () => {
        await draw(NavidromeSongLyricMatch, navidromeSong);
        env.saveNavidrome.mockResolvedValueOnce(false);
        await save();
        expect(onMatch).not.toHaveBeenCalled();
        expect(message()).toBe('localMusic.noLyricsAvailable');

        env.saveNavidrome.mockRejectedValueOnce(new Error('offline'));
        await save();
        expect(onMatch).not.toHaveBeenCalled();
        expect(message()).toBe('localMusic.matchFailed');

        await act(async () => {
            await env.window!.noMatch!.run();
        });
        expect(env.saveNavidromeNoMatch.mock.calls).toEqual([[navidromeSong]]);
        expect(onMatch).toHaveBeenCalledTimes(1);
    });

    it('a local file: saves the three switches as they stand, and a chosen result turns the lyrics switch to the match', async () => {
        env.saveLocal.mockResolvedValue({});
        await draw(LocalSongLyricMatch, localSong);
        await save();
        // The file's own state: its lyrics, its cover (it has one), its metadata (it was imported).
        expect(env.saveLocal.mock.calls.at(-1)?.[0]).toMatchObject({
            song: localSong, source: 'qq', selectedResult: chosen,
            choice: { lyricsSource: 'local', useOnlineCover: false, useOnlineMetadata: false },
        });

        env.search = { source: 'netease', selectedResult: chosen };
        await draw(LocalSongLyricMatch, localSong);
        await save();
        expect(env.saveLocal.mock.calls.at(-1)?.[0]).toMatchObject({
            source: 'netease', choice: { lyricsSource: 'online', useOnlineCover: false, useOnlineMetadata: false },
        });
        expect(onMatch.mock.calls).toEqual([[undefined], [undefined]]);
    });

    it('a local file: no hand-over after a "no" to the question, and what could not be applied goes with the hand-over', async () => {
        await draw(LocalSongLyricMatch, localSong);
        // The save answers nothing when the person said no to replacing.
        env.saveLocal.mockResolvedValueOnce(null);
        await save();
        expect(onMatch).not.toHaveBeenCalled();

        env.saveLocal.mockResolvedValueOnce({ failed: 'localMusic.coverNotApplied' });
        await save();
        expect(onMatch.mock.calls).toEqual([['localMusic.coverNotApplied']]);

        env.saveLocal.mockRejectedValueOnce(new Error('disk'));
        await save();
        expect(onMatch).toHaveBeenCalledTimes(1);
        expect(message()).toBe('localMusic.matchFailed');

        await act(async () => {
            await env.window!.noMatch!.run();
        });
        expect(env.saveLocalNoMatch.mock.calls).toEqual([['l1']]);
        expect(onMatch).toHaveBeenCalledTimes(2);
    });
});
