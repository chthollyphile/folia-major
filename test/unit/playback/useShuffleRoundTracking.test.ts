// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type * as ShuffleRoundModule from '@/components/app/playback/shuffle/shuffleRound';

// test/unit/playback/useShuffleRoundTracking.test.ts
// 「一轮不重复」接到播放上之后不会自己转个不停：只有正在播的这首能播时打乱队列不重洗；整轮听完重洗一次就停；
// 只有两首能播时每一轮都照常重洗；万一同一队刚重洗完、还是同一首时又判「整轮听完」，hook 也不再洗第二次。

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const playable = new Set<string>();
const settings = { shuffleRoundNoRepeat: true, loopMode: 'all' as 'off' | 'all' | 'one' };
let forceReshuffle = false;

vi.mock('@/utils/appPlaybackGuards', () => ({
    getPlaybackSongKey: (song: SongResult) => String(song.id),
}));
vi.mock('@/components/app/playback/playableSong', () => ({
    isQueueSongPlayable: (song: SongResult) => playable.has(String(song.id)),
}));
vi.mock('@/stores/useAudioSettingsStore', () => ({
    useAudioSettingsStore: { getState: () => settings },
}));
vi.mock('@/components/app/playback/shuffle/shuffleRound', async importOriginal => {
    const original = await importOriginal<typeof ShuffleRoundModule>();
    return {
        ...original,
        decideRoundStep: (...args: Parameters<typeof original.decideRoundStep>) => (
            forceReshuffle ? { kind: 'reshuffle' as const } : original.decideRoundStep(...args)
        ),
    };
});

const { shuffleQueueInRounds, useShuffleRoundTracking } = await import('@/components/app/playback/shuffle/useShuffleRoundTracking');
const { readShuffleRoundState } = await import('@/components/app/playback/shuffle/shuffleRoundState');

const song = (id: string): SongResult => ({ id }) as unknown as SongResult;

let container: HTMLDivElement;
let root: Root;
let reshuffles: number;

let playSong: ((next: SongResult) => void) | null = null;

/** 像播放控制那样接上 hook：reshuffle 写回队列，队列变了 hook 再判一次；`playSong` 切到另一首。 */
const mount = async (queue: SongResult[], current: SongResult) => {
    const Probe = () => {
        const [playQueue, setPlayQueue] = useState(queue);
        const [currentSong, setCurrentSong] = useState(current);
        playSong = setCurrentSong;
        useShuffleRoundTracking({
            currentSong,
            playQueue,
            isFmMode: false,
            isStageActive: false,
            reshuffle: next => {
                reshuffles += 1;
                if (reshuffles > 20) throw new Error('reshuffling without end');
                setPlayQueue(next);
            },
        });
        return null;
    };
    await act(async () => root.render(createElement(Probe)));
};

beforeEach(() => {
    localStorage.clear();
    playable.clear();
    settings.shuffleRoundNoRepeat = true;
    settings.loopMode = 'all';
    forceReshuffle = false;
    reshuffles = 0;
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

describe('useShuffleRoundTracking', () => {
    it('does not reshuffle a shuffled queue where only the playing song can play', async () => {
        const songs = ['a', 'b', 'c'].map(song);
        playable.add('a');
        const shuffled = shuffleQueueInRounds(songs, songs[0]);
        await mount(shuffled, songs[0]);
        expect(reshuffles).toBe(0);
        expect(readShuffleRoundState()?.played).toEqual(['a']);
    });

    it('reshuffles a finished round once under list loop, then settles', async () => {
        const songs = ['a', 'b', 'c'].map(song);
        for (const id of ['a', 'b', 'c']) playable.add(id);
        const shuffled = shuffleQueueInRounds(songs, null);
        const last = shuffled[shuffled.length - 1];
        // Heard all but the last one: playing it finishes the round.
        const kept = readShuffleRoundState();
        if (!kept) throw new Error('no round kept');
        localStorage.setItem('folia_shuffle_round', JSON.stringify({
            ...kept, played: shuffled.slice(0, -1).map(item => String(item.id)),
        }));
        await mount(shuffled, last);
        expect(reshuffles).toBe(1);
        expect(readShuffleRoundState()?.played).toEqual([String(last.id)]);
    });

    it('reshuffles every round when just two songs can play (no note is written in between)', async () => {
        const songs = ['a', 'b'].map(song);
        playable.add('a');
        playable.add('b');
        const shuffled = shuffleQueueInRounds(songs, songs[0]);
        await mount(shuffled, shuffled[0]);
        expect(reshuffles).toBe(0);
        for (let round = 1; round <= 3; round += 1) {
            // Each switch to the other song finishes the round: [x] heard, now y.
            const next = readShuffleRoundState()?.played[0] === 'a' ? songs[1] : songs[0];
            act(() => playSong?.(next));
            expect(reshuffles).toBe(round);
            expect(readShuffleRoundState()?.played).toEqual([String(next.id)]);
        }
        expect(console.warn).not.toHaveBeenCalled();
    });

    it('does not reshuffle the queue it just reshuffled again before another song is heard', async () => {
        const songs = ['a', 'b', 'c'].map(song);
        for (const id of ['a', 'b', 'c']) playable.add(id);
        const shuffled = shuffleQueueInRounds(songs, songs[0]);
        forceReshuffle = true;
        await mount(shuffled, songs[0]);
        expect(reshuffles).toBe(1);
        expect(console.warn).toHaveBeenCalled();
    });
});
