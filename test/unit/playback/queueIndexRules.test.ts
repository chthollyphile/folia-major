import { describe, it, expect } from 'vitest';
import {
    canShuffleQueue,
    fmNeedsTopUpAt,
    fmNextIsUnfetchedAt,
    hasTrackAfter,
    hasTrackToSkipTo,
    nextPlayableQueueSong,
    nextQueueIndex,
    nextTransitionSong,
    prevQueueIndex,
    queueIndexOf,
    queueIndexOfKey,
    queueLoopMode,
} from '../../../src/utils/playbackNeighbors';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';
import { getSongResourceCacheKey } from '../../../src/services/onlineMusic/resourceKeys';
import type { SongResult } from '../../../src/types';

// test/unit/playback/queueIndexRules.test.ts
// 队列的下标规则：一首歌在队列里的位置、下一首、上一首、后面还有没有另一首、跳过不能播的、
// 私人 FM 的队尾、播放失败后能不能跳、下一段过渡混向哪一首；最后是「队列现在能不能打乱」。
// 切歌的 handler、now playing 卡片、automix、预取调的是同一份，
// 这里把每种循环模式、队列两端、只有一首、空队列、不在队列里的曲目都钉住。

const MODES = ['off', 'all', 'one'] as const;

describe('queueIndexOf', () => {
    const online = (providerId: string, id: number): SongResult => ({
        id,
        name: `${providerId} ${id}`,
        artists: [],
        album: {} as SongResult['album'],
        durationMs: 1000,
        sourceRef: { kind: 'online', providerId, mediaId: String(id) },
    } as SongResult);
    const netease1 = online('netease', 1);
    const netease2 = online('netease', 2);
    // 同一个 id，另一个平台：是另一首歌。
    const qq1 = online('qq', 1);
    // 同一首歌的另一个对象（队列里排了两次，或者从缓存恢复出来的那份）。
    const netease2Again = online('netease', 2);
    // 旧版本存下来的歌没有来源，按网易云算：和 netease1 是同一首。
    const legacy1 = { id: 1, name: 'legacy 1', artists: [], album: {}, durationMs: 1000 } as unknown as SongResult;
    const local1 = { id: 1, name: 'local 1', isLocal: true, localRef: { songId: '1' } } as unknown as SongResult;
    const navidrome1 = { id: 1, name: 'navidrome 1', isNavidrome: true, navidromeData: { id: 'nd-1' } } as unknown as SongResult;
    const outsider = online('netease', 99);

    const pool = [netease1, netease2, qq1, netease2Again, legacy1, local1, navidrome1];
    // 用 pool 里的歌排出的所有队列，0 到 3 首，同一首可以重复。
    const queues: SongResult[][] = [[]];
    for (let length = 1, previous: SongResult[][] = [[]]; length <= 3; length += 1) {
        previous = previous.flatMap(queue => pool.map(song => [...queue, song]));
        queues.push(...previous);
    }

    // 换成这一个函数之前各处自己写的找法，原样再写一遍。
    // 绝大多数地方（切歌的 handler、遥控窗口与任务栏、lattice、队列面板、加歌和挪歌）：
    const byKey = (queue: SongResult[], song: SongResult | null) => {
        const songKey = song ? getPlaybackSongKey(song) : null;
        return songKey ? queue.findIndex(candidate => getPlaybackSongKey(candidate) === songKey) : -1;
    };
    // 预取：比的是音频缓存的 key。
    const byAudioCacheKey = (queue: SongResult[], song: SongResult) => {
        const songKey = getSongResourceCacheKey('audio', song);
        return queue.findIndex(candidate => getSongResourceCacheKey('audio', candidate) === songKey);
    };
    // 命令面板的批量操作：先找同一个对象，找不到再按 key。
    const byObjectThenKey = (queue: SongResult[], song: SongResult | null) => {
        if (!song) return -1;
        const exactIndex = queue.findIndex(candidate => candidate === song);
        return exactIndex >= 0 ? exactIndex : byKey(queue, song);
    };

    it('answers as the by-key lookups did, for every queue and song', () => {
        for (const queue of queues) {
            for (const song of [...pool, outsider, null]) {
                expect(queueIndexOf(queue, song)).toBe(byKey(queue, song));
            }
        }
    });

    it('answers as the prefetch lookup did, which compared audio cache keys', () => {
        for (const queue of queues) {
            for (const song of [...pool, outsider]) {
                expect(queueIndexOf(queue, song)).toBe(byAudioCacheKey(queue, song));
            }
        }
    });

    it('answers the same from the key alone', () => {
        for (const queue of queues) {
            for (const song of [...pool, outsider]) {
                expect(queueIndexOfKey(queue, getPlaybackSongKey(song))).toBe(queueIndexOf(queue, song));
            }
            expect(queueIndexOfKey(queue, null)).toBe(-1);
        }
    });

    // 批量操作那一种只在一种情况下答得不一样：要找的就是队列里的某个对象，而它前面还排着同一首歌的另一个对象。
    it('differs from object-first lookup only when the same song is queued ahead of the very object asked for', () => {
        let differing = 0;
        for (const queue of queues) {
            for (const song of [...pool, outsider, null]) {
                const byKeyIndex = queueIndexOf(queue, song);
                const objectFirstIndex = byObjectThenKey(queue, song);
                if (byKeyIndex === objectFirstIndex) continue;

                differing += 1;
                expect(queue[objectFirstIndex]).toBe(song);
                expect(byKeyIndex).toBeGreaterThanOrEqual(0);
                expect(byKeyIndex).toBeLessThan(objectFirstIndex);
                expect(queue[byKeyIndex]).not.toBe(song);
                expect(getPlaybackSongKey(queue[byKeyIndex])).toBe(getPlaybackSongKey(song!));
            }
        }
        expect(differing).toBeGreaterThan(0);
        expect(queueIndexOf([netease2, qq1, netease2Again], netease2Again)).toBe(0);
        expect(byObjectThenKey([netease2, qq1, netease2Again], netease2Again)).toBe(2);
    });

    it('finds a song by platform and id, not by the object', () => {
        const queue = [netease1, netease2, qq1];
        expect(queueIndexOf(queue, netease2Again)).toBe(1);
        expect(queueIndexOf(queue, legacy1)).toBe(0);
        expect(queueIndexOf(queue, online('qq', 1))).toBe(2);
    });

    it('keeps the same id on another platform, in the local library and on Navidrome apart', () => {
        const queue = [qq1, local1, navidrome1, netease1];
        expect(queueIndexOf(queue, netease1)).toBe(3);
        expect(queueIndexOf(queue, local1)).toBe(1);
        expect(queueIndexOf(queue, navidrome1)).toBe(2);
        expect(queueIndexOf([qq1, local1, navidrome1], netease1)).toBe(-1);
    });

    it('gives the first place of a song that is queued twice', () => {
        expect(queueIndexOf([netease1, netease2, netease2Again], netease2Again)).toBe(1);
    });

    it('is -1 without a song, for a song that is not queued and for an empty queue', () => {
        expect(queueIndexOf([netease1, netease2], null)).toBe(-1);
        expect(queueIndexOf([netease1, netease2], undefined)).toBe(-1);
        expect(queueIndexOf([netease1, netease2], outsider)).toBe(-1);
        expect(queueIndexOf([], netease1)).toBe(-1);
    });
});

describe('nextQueueIndex', () => {
    it('steps to the following track in every repeat mode', () => {
        for (const mode of MODES) {
            expect(nextQueueIndex(3, 0, mode)).toBe(1);
            expect(nextQueueIndex(3, 1, mode)).toBe(2);
        }
    });

    it('wraps from the last track to the head only in repeat-all', () => {
        expect(nextQueueIndex(3, 2, 'all')).toBe(0);
        expect(nextQueueIndex(3, 2, 'off')).toBe(-1);
        expect(nextQueueIndex(3, 2, 'one')).toBe(-1);
    });

    it('lands on the track itself for a one-track queue in repeat-all', () => {
        expect(nextQueueIndex(1, 0, 'all')).toBe(0);
        expect(nextQueueIndex(1, 0, 'off')).toBe(-1);
        expect(nextQueueIndex(1, 0, 'one')).toBe(-1);
    });

    it('goes to the head when the current song is not in the queue', () => {
        for (const mode of MODES) {
            expect(nextQueueIndex(3, -1, mode)).toBe(0);
            expect(nextQueueIndex(1, -1, mode)).toBe(0);
        }
    });

    it('has nothing in an empty queue', () => {
        for (const mode of MODES) {
            expect(nextQueueIndex(0, -1, mode)).toBe(-1);
        }
    });
});

describe('prevQueueIndex', () => {
    it('steps to the preceding track in every repeat mode', () => {
        for (const mode of MODES) {
            expect(prevQueueIndex(3, 2, mode)).toBe(1);
            expect(prevQueueIndex(3, 1, mode)).toBe(0);
        }
    });

    it('wraps from the head to the last track only in repeat-all', () => {
        expect(prevQueueIndex(3, 0, 'all')).toBe(2);
        expect(prevQueueIndex(3, 0, 'off')).toBe(-1);
        expect(prevQueueIndex(3, 0, 'one')).toBe(-1);
    });

    it('lands on the track itself for a one-track queue in repeat-all', () => {
        expect(prevQueueIndex(1, 0, 'all')).toBe(0);
        expect(prevQueueIndex(1, 0, 'off')).toBe(-1);
        expect(prevQueueIndex(1, 0, 'one')).toBe(-1);
    });

    it('goes to the last track only in repeat-all when the current song is not in the queue', () => {
        expect(prevQueueIndex(3, -1, 'all')).toBe(2);
        expect(prevQueueIndex(3, -1, 'off')).toBe(-1);
        expect(prevQueueIndex(3, -1, 'one')).toBe(-1);
    });

    it('has nothing in an empty queue', () => {
        for (const mode of MODES) {
            expect(prevQueueIndex(0, -1, mode)).toBe(-1);
        }
    });
});

describe('hasTrackAfter', () => {
    it('is true before the last track in every repeat mode', () => {
        for (const mode of MODES) {
            expect(hasTrackAfter(3, 0, mode)).toBe(true);
            expect(hasTrackAfter(3, 1, mode)).toBe(true);
        }
    });

    it('is true on the last track only in repeat-all', () => {
        expect(hasTrackAfter(3, 2, 'all')).toBe(true);
        expect(hasTrackAfter(3, 2, 'off')).toBe(false);
        expect(hasTrackAfter(3, 2, 'one')).toBe(false);
    });

    // nextQueueIndex 在这里给 0（重播自己），这条规则不把它算作另一首。
    it('is false for a one-track queue in every repeat mode', () => {
        for (const mode of MODES) {
            expect(hasTrackAfter(1, 0, mode)).toBe(false);
        }
    });

    // nextQueueIndex 在这里一律给队首，这条规则只在列表循环且队列不止一首时才算。
    it('follows only repeat-all when the current song is not in the queue', () => {
        expect(hasTrackAfter(3, -1, 'all')).toBe(true);
        expect(hasTrackAfter(3, -1, 'off')).toBe(false);
        expect(hasTrackAfter(3, -1, 'one')).toBe(false);
        expect(hasTrackAfter(1, -1, 'all')).toBe(false);
    });

    it('is false for an empty queue', () => {
        for (const mode of MODES) {
            expect(hasTrackAfter(0, -1, mode)).toBe(false);
        }
    });
});

describe('nextPlayableQueueSong', () => {
    const queue = ['a', 'b', 'c', 'd'];
    const only = (...playable: string[]) => (song: string) => playable.includes(song);

    it('returns the following track when it can play', () => {
        for (const mode of MODES) {
            expect(nextPlayableQueueSong(queue, 0, mode, only('a', 'b', 'c', 'd'))).toBe('b');
        }
    });

    it('steps over tracks that cannot play', () => {
        for (const mode of MODES) {
            expect(nextPlayableQueueSong(queue, 0, mode, only('a', 'd'))).toBe('d');
        }
    });

    it('stops at the end of the queue outside repeat-all', () => {
        expect(nextPlayableQueueSong(queue, 2, 'off', only('a', 'b', 'c'))).toBeNull();
        expect(nextPlayableQueueSong(queue, 2, 'one', only('a', 'b', 'c'))).toBeNull();
        expect(nextPlayableQueueSong(queue, 3, 'off', only('a', 'b', 'c', 'd'))).toBeNull();
    });

    it('carries on from the head in repeat-all', () => {
        expect(nextPlayableQueueSong(queue, 2, 'all', only('b', 'c'))).toBe('b');
        expect(nextPlayableQueueSong(queue, 3, 'all', only('a', 'b', 'c', 'd'))).toBe('a');
    });

    it('never returns the current track, even when it is the only one that can play', () => {
        expect(nextPlayableQueueSong(queue, 1, 'all', only('b'))).toBeNull();
        expect(nextPlayableQueueSong(['a'], 0, 'all', only('a'))).toBeNull();
    });

    it('asks about the tracks in the order next would step through them', () => {
        const asked: string[] = [];
        nextPlayableQueueSong(queue, 1, 'all', song => { asked.push(song); return false; });
        expect(asked).toEqual(['c', 'd', 'a']);
    });

    it('returns null when the current song is not in the queue', () => {
        for (const mode of MODES) {
            expect(nextPlayableQueueSong(queue, -1, mode, only('a', 'b', 'c', 'd'))).toBeNull();
        }
    });

    it('returns null for an empty queue', () => {
        expect(nextPlayableQueueSong([], -1, 'all', () => true)).toBeNull();
    });
});

describe('Personal FM queue end', () => {
    it('tops up from the last two tracks of the queue', () => {
        expect(fmNeedsTopUpAt(5, 2)).toBe(false);
        expect(fmNeedsTopUpAt(5, 3)).toBe(true);
        expect(fmNeedsTopUpAt(5, 4)).toBe(true);
        expect(fmNeedsTopUpAt(1, 0)).toBe(true);
    });

    it('tops up for a song that is not in the queue only when the queue has fewer than two tracks', () => {
        expect(fmNeedsTopUpAt(2, -1)).toBe(false);
        expect(fmNeedsTopUpAt(1, -1)).toBe(true);
        expect(fmNeedsTopUpAt(0, -1)).toBe(true);
    });

    it('has no fetched successor only on the last track', () => {
        expect(fmNextIsUnfetchedAt(5, 3)).toBe(false);
        expect(fmNextIsUnfetchedAt(5, 4)).toBe(true);
        expect(fmNextIsUnfetchedAt(1, 0)).toBe(true);
        expect(fmNextIsUnfetchedAt(1, -1)).toBe(false);
        expect(fmNextIsUnfetchedAt(0, -1)).toBe(false);
    });

    it('counts every repeat mode as off for the index rules, and leaves it alone outside Personal FM', () => {
        for (const mode of MODES) {
            expect(queueLoopMode(mode, true)).toBe('off');
            expect(queueLoopMode(mode, false)).toBe(mode);
        }
    });

    // 拉歌失败或拉回空的之后，handler 用的就是这三个下标：FM 里列表循环开着也没有地方可绕。
    it('never goes round in Personal FM with repeat-all: no next after the last, no previous before the first', () => {
        const fmMode = queueLoopMode('all', true);
        expect(nextQueueIndex(4, 3, fmMode)).toBe(-1);
        expect(prevQueueIndex(4, 0, fmMode)).toBe(-1);
        expect(nextQueueIndex(1, 0, fmMode)).toBe(-1);
    });

    it('does not skip from an unplayable last Personal FM track back to the first', () => {
        const songs = ['a', 'b', 'c'];
        expect(nextPlayableQueueSong(songs, 2, queueLoopMode('all', true), () => true)).toBeNull();
        expect(nextPlayableQueueSong(songs, 2, queueLoopMode('all', false), () => true)).toBe('a');
    });
});

describe('hasTrackToSkipTo', () => {
    // 私人 FM 关着时就是「当前曲目在队列里，并且后面还有另一首」。
    it('is hasTrackAfter for a song in the queue when Personal FM is off', () => {
        for (const mode of MODES) {
            for (let length = 0; length <= 4; length += 1) {
                for (let index = 0; index < length; index += 1) {
                    expect(hasTrackToSkipTo(length, index, mode, false)).toBe(hasTrackAfter(length, index, mode));
                }
            }
        }
    });

    it('is false for a song that is not in the queue, Personal FM or not', () => {
        for (const mode of MODES) {
            for (const isFmMode of [false, true]) {
                expect(hasTrackToSkipTo(3, -1, mode, isFmMode)).toBe(false);
                expect(hasTrackToSkipTo(1, -1, mode, isFmMode)).toBe(false);
                expect(hasTrackToSkipTo(0, -1, mode, isFmMode)).toBe(false);
            }
        }
    });

    // 原来这里停下；「下一首」在 FM 的最后一首上会去拉新曲目，所以失败之后接着走。
    it('is true on the last Personal FM track in every repeat mode', () => {
        for (const mode of MODES) {
            expect(hasTrackToSkipTo(3, 2, mode, true)).toBe(true);
            expect(hasTrackToSkipTo(1, 0, mode, true)).toBe(true);
        }
    });

    it('still stops on the last track outside Personal FM unless repeat-all has another track', () => {
        expect(hasTrackToSkipTo(3, 2, 'off', false)).toBe(false);
        expect(hasTrackToSkipTo(3, 2, 'one', false)).toBe(false);
        expect(hasTrackToSkipTo(3, 2, 'all', false)).toBe(true);
        expect(hasTrackToSkipTo(1, 0, 'all', false)).toBe(false);
    });
});

describe('nextTransitionSong', () => {
    const song = (id: string): SongResult => ({
        id,
        name: id,
        artists: [],
        album: {} as SongResult['album'],
        durationMs: 1000,
    } as SongResult);
    const [a, b, c] = [song('a'), song('b'), song('c')];
    const queue = [a, b, c];

    it('is the following track before the last one, in every repeat mode and in Personal FM', () => {
        for (const mode of MODES) {
            for (const isFmMode of [false, true]) {
                expect(nextTransitionSong(queue, a, mode, isFmMode)).toBe(b);
                expect(nextTransitionSong(queue, b, mode, isFmMode)).toBe(c);
            }
        }
    });

    it('goes round to the first track from the last one only in repeat-all', () => {
        expect(nextTransitionSong(queue, c, 'all', false)).toBe(a);
        expect(nextTransitionSong(queue, c, 'off', false)).toBeNull();
        expect(nextTransitionSong(queue, c, 'one', false)).toBeNull();
    });

    // 「下一首」在这里会去拉新曲目再播，FM 的队列不绕回队首。
    it('has none on the last Personal FM track in every repeat mode', () => {
        for (const mode of MODES) {
            expect(nextTransitionSong(queue, c, mode, true)).toBeNull();
            expect(nextTransitionSong([a], a, mode, true)).toBeNull();
        }
    });

    it('has none for a one-track or an empty queue', () => {
        for (const mode of MODES) {
            expect(nextTransitionSong([a], a, mode, false)).toBeNull();
            expect(nextTransitionSong([], a, mode, false)).toBeNull();
        }
    });

    it('follows only repeat-all for a song that is not in the queue', () => {
        const outsider = song('zzz');
        expect(nextTransitionSong(queue, outsider, 'all', false)).toBe(a);
        expect(nextTransitionSong(queue, outsider, 'off', false)).toBeNull();
        expect(nextTransitionSong(queue, outsider, 'one', false)).toBeNull();
        expect(nextTransitionSong([a], outsider, 'all', false)).toBeNull();
    });

    // 队列里同一首歌排了两次：下一首还是它自己，那是重播不是过渡。
    it('has none when the following track is the same song', () => {
        expect(nextTransitionSong([a, song('a'), b], a, 'off', false)).toBeNull();
        expect(nextTransitionSong([a, song('a')], a, 'all', false)).toBeNull();
    });
});

describe('canShuffleQueue', () => {
    it('needs more than one track, no Personal FM and no stage playback', () => {
        expect(canShuffleQueue(2, false, false)).toBe(true);
        expect(canShuffleQueue(50, false, false)).toBe(true);
        expect(canShuffleQueue(1, false, false)).toBe(false);
        expect(canShuffleQueue(0, false, false)).toBe(false);
        expect(canShuffleQueue(2, true, false)).toBe(false);
        expect(canShuffleQueue(2, false, true)).toBe(false);
    });

    // 换成这一条规则之前各处自己的写法，原样再写一遍：播放条的槽位、lattice 的控制、Folium 的 shuffleQueue、
    // 命令面板的「打乱队列」，还有 shuffleQueue 这个 handler 自己的两个判断。
    it('answers as each earlier rule did, wherever that rule looked at all three conditions', () => {
        for (let queueLength = 0; queueLength <= 3; queueLength += 1) {
            for (const isFmMode of [false, true]) {
                for (const isStageActive of [false, true]) {
                    const answer = canShuffleQueue(queueLength, isFmMode, isStageActive);
                    const barSlot = !isFmMode && queueLength > 1;
                    const lattice = queueLength > 1 && !isFmMode && !isStageActive;
                    const folium = !isFmMode && queueLength > 1 && !isStageActive;
                    const palette = !isFmMode;
                    const handler = !isStageActive && queueLength > 1;

                    expect(answer).toBe(lattice);
                    expect(answer).toBe(folium);
                    // 播放条原来不看舞台，命令面板原来不看舞台也不看队列有几首，handler 原来不看私人 FM。
                    if (!isStageActive) expect(answer).toBe(barSlot);
                    if (!isStageActive && queueLength > 1) expect(answer).toBe(palette);
                    if (!isFmMode) expect(answer).toBe(handler);
                    // 规则说能打乱的，原来每一处也都说能：没有哪个按钮比原来多亮。
                    if (answer) expect(barSlot && palette && handler).toBe(true);
                }
            }
        }
    });
});
