import type { SongResult } from '../types';
import { isStagePlaybackSong } from './appPlaybackGuards';

// src/utils/queueReorder.ts
// 播放队列的纯变换与判定：单项移动（墙面工具的队列浮岛拖拽、Electron 舞台的 move 请求共用）、「下一首播放」的挪动，
// 以及「当前队列能不能存成本地歌单」（播放页面板的队列页与墙面工具的队列浮岛共用同一个判定）。

/**
 * 把 from 位置的一项移到 to 位置（to 是移动完成后它所在的下标）。
 * from === to 或任一下标越界时原样返回同一个数组（调用方可以据此判断「没变」）。
 */
export const moveQueueItem = <T>(queue: readonly T[], from: number, to: number): T[] => {
    const length = queue.length;
    const inRange = (index: number) => Number.isInteger(index) && index >= 0 && index < length;
    if (from === to || !inRange(from) || !inRange(to)) return queue as T[];
    const next = [...queue];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
};

/**
 * 「下一首播放」：把 index 那一项挪到 currentIndex 的下一位（currentIndex 是正在播放那首的下标，不在队列里时为 -1，
 * 这时挪到队首）。插入位置按「移除前」算成 currentIndex + 1，移除后再插入自然落在当前那首后面——当前那首在队尾时也一样
 * （不能把目标夹到 length − 1，否则会插到当前那首前面）。index 越界、本来就在那里、或就是当前那一项时原样返回同一个数组。
 */
export const moveQueueItemToNext = <T>(queue: readonly T[], index: number, currentIndex: number): T[] => {
    const target = currentIndex + 1;
    if (!Number.isInteger(index) || index < 0 || index >= queue.length || index === currentIndex || index === target) {
        return queue as T[];
    }
    return moveQueueItem(queue, index, index < target ? target - 1 : target);
};

/**
 * 当前队列能不能存成一张 Folia 歌单：有正在播放的歌，队列里至少有一首有来源的歌（本地、Navidrome、任何在线音源，
 * 混着也行）。舞台歌没有来源，进不了歌单；整个队列都是它时不能存。
 */
export const canSaveQueueAsPlaylist = (currentSong: SongResult | null | undefined, queue: readonly SongResult[]): boolean => (
    Boolean(currentSong) && queue.some(song => !isStagePlaybackSong(song))
);
