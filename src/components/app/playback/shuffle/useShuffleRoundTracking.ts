import { useEffect, useRef } from 'react';
import type { SongResult } from '../../../../types';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { isQueueSongPlayable } from '../playableSong';
import { decideRoundStep, shuffleForRound } from './shuffleRound';
import { readShuffleRoundState, writeShuffleRoundState } from './shuffleRoundState';

// src/components/app/playback/shuffle/useShuffleRoundTracking.ts
// 「一轮不重复」接到播放上的两处：按轮洗一队歌（打乱队列、随机播放都经 shuffleQueueInRounds），以及切歌时记下
// 这一轮听过了哪首。只记按轮洗出来、还保持着洗出来顺序的那一队（用户选的：只限打乱过的队列）；列表循环时这一轮
// 能播的都听过了就自动重洗一次，不弹「队列已打乱」，正在播的这首钉在最前、不打断。

/**
 * 按轮洗一队歌并记下这一轮。`currentSong` 在队里时钉在最前（打乱队列、整轮重洗）；不给时整队都洗（合集的随机
 * 播放：从随机的一首开始）。同一批歌接着上一轮；播不了的歌不算进「整轮」。
 */
export const shuffleQueueInRounds = (queue: readonly SongResult[], currentSong: SongResult | null): SongResult[] => {
    const currentKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    const pinnedIndex = currentKey === null ? -1 : queue.findIndex(song => getPlaybackSongKey(song) === currentKey);
    const shuffled = shuffleForRound({
        songs: queue,
        keyOf: getPlaybackSongKey,
        pinnedIndex,
        state: readShuffleRoundState(),
        counts: isQueueSongPlayable,
    });
    writeShuffleRoundState(shuffled.state);
    return shuffled.queue;
};

/**
 * 切歌（或队列变了）时：开关开着、队列还是记着的那一轮，就把正在播的这首记成听过；列表循环下这一轮因此听完了，
 * 交给 `reshuffle` 静默重洗（它负责写队列、重新预取、记进上次播放）。FM 与外部舞台播放不算。开关和循环模式在
 * 执行时现读，不当依赖：按一下循环键不会当场改掉下一首，等到切歌时才算。
 */
export const useShuffleRoundTracking = ({
    currentSong,
    playQueue,
    isFmMode,
    isStageActive,
    reshuffle,
}: {
    currentSong: SongResult | null;
    playQueue: SongResult[];
    isFmMode: boolean;
    isStageActive: boolean;
    reshuffle: (nextQueue: SongResult[], currentSong: SongResult) => void;
}) => {
    const reshuffleRef = useRef(reshuffle);
    useEffect(() => {
        reshuffleRef.current = reshuffle;
    });

    useEffect(() => {
        const { shuffleRoundNoRepeat, loopMode } = useAudioSettingsStore.getState();
        if (!shuffleRoundNoRepeat || !currentSong || isFmMode || isStageActive) return;
        const step = decideRoundStep({
            state: readShuffleRoundState(),
            keys: playQueue.map(getPlaybackSongKey),
            currentKey: getPlaybackSongKey(currentSong),
            countedKeys: playQueue.filter(isQueueSongPlayable).map(getPlaybackSongKey),
            loopMode,
        });
        if (step.kind === 'write') {
            writeShuffleRoundState(step.state);
        } else if (step.kind === 'reshuffle') {
            const nextQueue = shuffleQueueInRounds(playQueue, currentSong);
            console.info('[ShuffleRound] Round finished under list loop; reshuffled', playQueue.length, 'songs');
            reshuffleRef.current(nextQueue, currentSong);
        }
    }, [currentSong, isFmMode, isStageActive, playQueue]);
};
