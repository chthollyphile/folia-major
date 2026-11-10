// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricData, SongResult, VisualizerMode } from '@/types';
import type { LyricSegmentationActions } from '@/components/app/playback/createLyricSegmentationActions';

// test/unit/hooks/useAutoLyricSegmentation.test.ts
// 自动 AI 分词的时序 (issue #960)：each run is a paid request, so these pin when one starts, when
// it is called off, and what happens to its answer — once per song, kept across a skip, never
// over a split the user saved, retried only when the lyrics really changed.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ai = vi.hoisted(() => ({
    calls: [] as Array<{ lines: string[]; resolve: (rows: (string[] | null)[]) => void; reject: (error: Error) => void }>,
}));
vi.mock('@/services/lyricSegmentationAi', () => ({
    segmentLyricsWithAi: vi.fn((lines: string[]) => new Promise((resolve, reject) => {
        ai.calls.push({
            lines,
            resolve: rows => resolve({ boundaries: rows, appliedCount: rows.filter(Boolean).length, failures: [] }),
            reject,
        });
    })),
}));
vi.mock('@/services/aiText', () => ({ isLyricSegmentationAiAvailable: () => true }));
const disk = vi.hoisted(() => ({ saveSongSegmentation: vi.fn(async (_song: unknown, _record: unknown) => undefined) }));
vi.mock('@/services/lyricSegmentation', () => disk);
vi.mock('@/components/visualizer/registry', () => ({
    getVisualizerRegistryEntry: (mode: string) => ({ usesWordSegmentation: mode === 'hanabi' }),
}));
const status = vi.hoisted(() => ({ setStatusMessage: vi.fn() }));
vi.mock('@/stores/useStatusMessageStore', () => status);

const { useAutoLyricSegmentation } = await import('@/hooks/useAutoLyricSegmentation');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { useLyricSegmentationStore } = await import('@/stores/useLyricSegmentationStore');
const { useLyricSettingsStore } = await import('@/stores/useLyricSettingsStore');
const { getPlaybackSongKey } = await import('@/utils/appPlaybackGuards');
const { createLyricSegmentationRecord } = await import('@/utils/lyrics/lyricSegmentationRecord');

const SETTLE_MS = 2500;

const song = (id: string) => ({ id, name: id, sourceRef: { kind: 'local', mediaId: id } } as unknown as SongResult);
const lyricsOf = (...texts: string[]): LyricData => ({
    lines: texts.map((fullText, index) => ({ fullText, startTime: index, endTime: index + 1, words: [] })),
} as unknown as LyricData);
const JAPANESE = lyricsOf('君の名前', '夜明けまで');
/** A usable answer for JAPANESE: each row joins back to its line. */
const ROWS = [['君', 'の', '名前'], ['夜明け', 'まで']];

let container: HTMLDivElement;
let root: Root;
let save: ReturnType<typeof vi.fn<LyricSegmentationActions['save']>>;

const Probe = ({ visualizerMode }: { visualizerMode: VisualizerMode }) => {
    useAutoLyricSegmentation({ visualizerMode, isLyricsLoading: false, save });
    return null;
};
const render = (visualizerMode: VisualizerMode = 'hanabi' as VisualizerMode) => {
    act(() => root.render(createElement(Probe, { visualizerMode })));
};
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const flush = () => act(async () => {
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
});
/** Puts `next` on as the playing song, with its saved-record load finished and empty. */
const play = (next: SongResult, lyrics: LyricData | null = JAPANESE) => act(() => {
    usePlaybackStore.setState({ currentSong: next, lyrics });
    useLyricSegmentationStore.getState().setRecord(getPlaybackSongKey(next), null);
});

beforeEach(() => {
    vi.useFakeTimers();
    ai.calls = [];
    disk.saveSongSegmentation.mockClear();
    status.setStatusMessage.mockClear();
    save = vi.fn<LyricSegmentationActions['save']>(async () => undefined);
    useLyricSettingsStore.setState({ autoAiLyricSegmentation: true });
    usePlaybackStore.setState({ currentSong: null, lyrics: null });
    useLyricSegmentationStore.getState().clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
});

describe('useAutoLyricSegmentation', () => {
    it('starts once the lyrics have settled, and saves the answer for the playing song', async () => {
        play(song('a'));
        render();
        advance(SETTLE_MS - 1);
        expect(ai.calls).toHaveLength(0);
        advance(1);
        expect(ai.calls).toHaveLength(1);

        ai.calls[0]!.resolve(ROWS);
        await flush();
        expect(save).toHaveBeenCalledWith(
            { '0|君の名前': ROWS[0], '1000|夜明けまで': ROWS[1] },
            'ai',
            { songKey: 'local:a', auto: true },
        );
    });

    it('does not start while the setting is off, or in a mode that does not draw words', () => {
        useLyricSettingsStore.setState({ autoAiLyricSegmentation: false });
        play(song('a'));
        render();
        advance(SETTLE_MS * 2);
        useLyricSettingsStore.setState({ autoAiLyricSegmentation: true });
        render('classic-not-words' as VisualizerMode);
        advance(SETTLE_MS * 2);
        expect(ai.calls).toHaveLength(0);
    });

    it('tries a song once: a failure is not retried, and is said only once', async () => {
        play(song('a'));
        render();
        advance(SETTLE_MS);
        ai.calls[0]!.reject(new Error('no model'));
        await flush();
        act(() => usePlaybackStore.setState({ lyrics: lyricsOf('君の名前', '夜明けまで') }));
        advance(SETTLE_MS * 2);
        expect(ai.calls).toHaveLength(1);

        play(song('b'));
        advance(SETTLE_MS);
        ai.calls[1]!.reject(new Error('no model'));
        await flush();
        expect(status.setStatusMessage).toHaveBeenCalledTimes(1);
    });

    it('keeps running across a mode switch, since the split belongs to the song', async () => {
        play(song('a'));
        render();
        advance(SETTLE_MS);
        render('classic-not-words' as VisualizerMode);
        ai.calls[0]!.resolve(ROWS);
        await flush();
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('keeps a paid answer for a song that ended meanwhile, on disk only', async () => {
        const first = song('a');
        play(first);
        render();
        advance(SETTLE_MS);
        play(song('b'), lyricsOf('hello', 'world'));
        ai.calls[0]!.resolve(ROWS);
        await flush();

        expect(save).not.toHaveBeenCalled();
        expect(disk.saveSongSegmentation).toHaveBeenCalledTimes(1);
        expect(disk.saveSongSegmentation.mock.calls[0]![0]).toBe(first);
    });

    it('drops the answer when the user saved a split meanwhile', async () => {
        play(song('a'));
        render();
        advance(SETTLE_MS);
        act(() => useLyricSegmentationStore.getState().setRecord(
            'local:a',
            createLyricSegmentationRecord('local:a', 'manual', { '0|君の名前': ['君の', '名前'] }),
        ));
        ai.calls[0]!.resolve(ROWS);
        await flush();
        expect(save).not.toHaveBeenCalled();
        expect(disk.saveSongSegmentation).not.toHaveBeenCalled();
    });

    it('runs again when the lyrics were swapped for others meanwhile', async () => {
        play(song('a'));
        render();
        advance(SETTLE_MS);
        act(() => usePlaybackStore.setState({ lyrics: lyricsOf('别的歌词', '另一版本') }));
        ai.calls[0]!.resolve(ROWS);
        await flush();
        expect(save).not.toHaveBeenCalled();

        advance(SETTLE_MS);
        expect(ai.calls).toHaveLength(2);
        expect(ai.calls[1]!.lines).toEqual(['别的歌词', '另一版本']);
    });

    it('does not ask again when the lines are still shown but no row fits them', async () => {
        play(song('a'));
        render();
        advance(SETTLE_MS);
        ai.calls[0]!.resolve([['wrong'], ['rows']]);
        await flush();
        advance(SETTLE_MS * 2);
        expect(save).not.toHaveBeenCalled();
        expect(ai.calls).toHaveLength(1);
    });
});
