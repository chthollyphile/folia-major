import { getPlaybackSongKey } from './appPlaybackGuards';
import { resolvePlaybackSongArtist, resolvePlaybackSongCoverUrl } from './playbackSongMeta';
import type { SongResult, StageLoopMode } from '../types';
// src/utils/playbackNeighbors.ts
// 队列里「上一首 / 下一首」的规则只写在这里。前半是下标规则，都是纯函数（不碰 React、store、时钟），
// 切歌的 handler、now playing 卡片、automix、预取都调它们；
// 后半的 resolvePlaybackNeighbors 把下标变成界面要的邻居信息，「上一首 / 下一首能不能按」只由它回答
// （主窗口的箭头、遥控窗口与任务栏、舞台快照）。
// 「这首歌在队列里的第几个」（queueIndexOf）和「队列现在能不能打乱」（canShuffleQueue）也只写在这里。

/**
 * 这首歌在队列里的下标，不在则 -1；没有歌（null）也是 -1。
 * 按 getPlaybackSongKey 比（平台加曲目 id），不按对象比：同一首歌从缓存恢复或换过来源之后是另一个对象。
 * 同一首歌在队列里排了两次时给的是前面那一个。
 */
export const queueIndexOf = (queue: SongResult[], song: SongResult | null | undefined): number => (
    song ? queueIndexOfKey(queue, getPlaybackSongKey(song)) : -1
);

/** 同 queueIndexOf，给手里只有 key 的地方用（队列面板的自动滚动只跟着 key 变，不跟着对象变）。 */
export const queueIndexOfKey = (queue: SongResult[], songKey: string | null): number => (
    songKey === null ? -1 : queue.findIndex(song => getPlaybackSongKey(song) === songKey)
);

/**
 * 「下一首」会播的下标，没有则 -1。
 * 当前曲目不在队列里（currentIndex 为 -1）时是队首；停在最后一首时只有列表循环才回到队首，
 * 队列只有一首时回到的就是它自己。单曲循环在这里和不循环一样。
 */
export const nextQueueIndex = (queueLength: number, currentIndex: number, loopMode: StageLoopMode): number => {
    if (queueLength <= 0) return -1;
    if (currentIndex < 0) return 0;
    if (currentIndex < queueLength - 1) return currentIndex + 1;
    return loopMode === 'all' ? 0 : -1;
};

/**
 * 「上一首」会播的下标，没有则 -1。
 * 已在队首、或当前曲目不在队列里时，只有列表循环才跳到队尾，队列只有一首时就是它自己。
 */
export const prevQueueIndex = (queueLength: number, currentIndex: number, loopMode: StageLoopMode): number => {
    if (currentIndex > 0) return currentIndex - 1;
    return loopMode === 'all' ? queueLength - 1 : -1;
};

/**
 * 切歌时下标规则按哪种循环模式算。私人 FM 的队列不绕回队首也不跳到队尾（到头是去拉新曲目），
 * 所以 FM 里一律按不循环算；切歌的两个 handler、「跳过不能播的歌」和 resolvePlaybackNeighbors 都先过这里。
 */
export const queueLoopMode = (loopMode: StageLoopMode, isFmMode: boolean): StageLoopMode => (
    isFmMode ? 'off' : loopMode
);

/**
 * 当前曲目之后还有没有另一首：后面还有歌，或者列表循环且队列不止一首。false 即队列在这里到头。
 * 和 nextQueueIndex 有两处不同：只有一首的列表循环不算（那是重播自己）；
 * 当前曲目不在队列里时不退回队首，只有列表循环且队列不止一首才算。
 */
export const hasTrackAfter = (queueLength: number, currentIndex: number, loopMode: StageLoopMode): boolean => (
    (currentIndex >= 0 && currentIndex < queueLength - 1) || (loopMode === 'all' && queueLength > 1)
);

/**
 * 当前曲目之后第一首通过 isPlayable 的歌，没有则 null。
 * 按 nextQueueIndex 一首一首往后找，列表循环时绕回队首接着找，其余的歌都问过一遍为止
 * （不会回到当前曲目）；当前曲目不在队列里时不找。
 */
export const nextPlayableQueueSong = <T>(
    queue: T[],
    currentIndex: number,
    loopMode: StageLoopMode,
    isPlayable: (song: T) => boolean,
): T | null => {
    if (currentIndex < 0) return null;

    let index = currentIndex;
    for (let step = 1; step < queue.length; step += 1) {
        index = nextQueueIndex(queue.length, index, loopMode);
        if (index < 0) return null;
        if (isPlayable(queue[index])) return queue[index];
    }
    return null;
};

/**
 * 私人 FM：从这个下标按「下一首」之前要先去拉新曲目 —— 走到队列最后两首时
 * （队列不足两首时，不在队列里的曲目也算）。
 */
export const fmNeedsTopUpAt = (queueLength: number, currentIndex: number): boolean => (
    currentIndex >= queueLength - 2
);

/** 私人 FM：这个下标的下一首此刻还不在队列里（要等拉回来）—— 只有队列最后一首。 */
export const fmNextIsUnfetchedAt = (queueLength: number, currentIndex: number): boolean => (
    currentIndex >= 0 && currentIndex >= queueLength - 1
);

/**
 * 播放失败之后有没有另一首可以跳过去：当前曲目在队列里，并且后面还有另一首（hasTrackAfter），
 * 或者它是私人 FM 的最后一首 —— 那时「下一首」会去拉新曲目。
 */
export const hasTrackToSkipTo = (
    queueLength: number,
    currentIndex: number,
    loopMode: StageLoopMode,
    isFmMode: boolean,
): boolean => (
    currentIndex >= 0 && (
        hasTrackAfter(queueLength, currentIndex, loopMode)
        || (isFmMode && fmNextIsUnfetchedAt(queueLength, currentIndex))
    )
);

/**
 * 下一段过渡会混进来的那一首，没有则 null。automix 混向它，预取把它放进分析范围。
 * 后面还有另一首（hasTrackAfter）时是 nextQueueIndex 那一首，列表循环时从最后一首绕回队首。
 * 私人 FM 的最后一首没有：下一首要现拉，还叫不出名字的曲目没法提前测量，FM 的队列也不绕回队首。
 * 这里不去拉。下一首和当前曲目是同一首歌（队列里排了两次）时也没有：那是重播，不是过渡。
 */
export const nextTransitionSong = (
    queue: SongResult[],
    currentSong: SongResult,
    loopMode: StageLoopMode,
    isFmMode: boolean,
): SongResult | null => {
    const currentKey = getPlaybackSongKey(currentSong);
    const index = queueIndexOfKey(queue, currentKey);
    if (isFmMode && fmNextIsUnfetchedAt(queue.length, index)) return null;

    const next = hasTrackAfter(queue.length, index, loopMode)
        ? queue[nextQueueIndex(queue.length, index, loopMode)]
        : null;
    return next && getPlaybackSongKey(next) !== currentKey ? next : null;
};

/**
 * 队列现在能不能打乱：不在私人 FM 里（FM 的队列由电台续上），舞台没有接管播放，队列不止一首。
 * shuffleQueue 自己先问它；播放条和 lattice 的打乱按钮、命令面板的「打乱队列」、Folium 的 shuffleQueue 问的也是它。
 * isStageActive 是调用方知道的那个「舞台在播」：handler、播放条和 lattice 给的是 now playing 舞台，
 * Folium 给的是任何舞台，命令面板的上下文里没有这一项，给的是 false。
 */
export const canShuffleQueue = (queueLength: number, isFmMode: boolean, isStageActive: boolean): boolean => (
    !isFmMode && !isStageActive && queueLength > 1
);

export type PlaybackNeighbor = {
    /** 该方向是否可以跳转 */
    canGo: boolean;
    /** 目标曲目标识；与快照里的 trackKey 同一套规则，便于遥控窗口把预读的面和切歌后的面认成同一个 */
    key: string | null;
    /** 目标曲目标题；可跳但目标未知时为 null */
    title: string | null;
    /** 目标曲目艺术家；用于遥控窗口提前渲染下一首 */
    artist: string | null;
    /** 目标曲目封面；用于遥控窗口提前预热图片与取色 */
    coverUrl: string | null;
};

export type PlaybackNeighbors = {
    prev: PlaybackNeighbor;
    next: PlaybackNeighbor;
};

// 每次现造，不共享实例：调用方拿到的是普通对象，写一下就会污染后续所有结果
const unknownNeighbor = (): PlaybackNeighbor => ({ canGo: true, key: null, title: null, artist: null, coverUrl: null });
const blockedNeighbor = (): PlaybackNeighbor => ({ canGo: false, key: null, title: null, artist: null, coverUrl: null });

type ResolvePlaybackNeighborsParams = {
    playQueue: SongResult[];
    currentSong: SongResult | null;
    loopMode: 'off' | 'all' | 'one';
    isFmMode: boolean;
    isStageActive: boolean;
    /**
     * 是否连艺术家与封面一起解析。这两项要走 provider 元数据（注册表查找 + 新建元数据对象），
     * 只有需要预读下一首的遥控窗口用得上；浮动播放条只读 canGo 与 title，默认不付这份开销。
     */
    withMetadata?: boolean;
};

/**
 * 按 usePlaybackQueueController 中 handlePrevTrack / handleNextTrack 的同一套下标规则，
 * 推导上一首/下一首能否跳转，以及目标曲目的标题、艺术家与封面。
 * FM 模式停在队列最后一首时，跳转会现拉新曲目，此时 canGo 为 true 但目标信息未知；
 * FM 的队列不绕回，所以 FM 第一首没有上一首。
 * canGo 为 true 即按下去 handler 会去试；主窗口的箭头、遥控窗口与任务栏
 * （playbackSyncBridge）、队列操作回给舞台的快照读的都是这里的 canGo。
 * 两处它答不准：FM 最后一首拉不到新曲目时，按了没有结果，这事先不知道；
 * 过渡进行中 handler 从画面上那首算起，这里按传进来的 currentSong 算，传的是 store 里那首时会差一首。
 */
export const resolvePlaybackNeighbors = ({
    playQueue,
    currentSong,
    loopMode,
    isFmMode,
    isStageActive,
    withMetadata = false,
}: ResolvePlaybackNeighborsParams): PlaybackNeighbors => {
    // 舞台播放时两个 handler 都会直接 return，这里必须同步禁用，否则箭头点了没反应
    if (isStageActive || !currentSong || playQueue.length === 0) {
        return { prev: blockedNeighbor(), next: blockedNeighbor() };
    }

    const currentIndex = queueIndexOf(playQueue, currentSong);

    const neighborAt = (index: number): PlaybackNeighbor => {
        const song = playQueue[index] ?? null;
        return {
            canGo: true,
            key: song ? getPlaybackSongKey(song) : null,
            title: song?.name ?? null,
            artist: withMetadata ? resolvePlaybackSongArtist(song) : null,
            coverUrl: withMetadata ? resolvePlaybackSongCoverUrl(song) : null,
        };
    };

    const indexLoopMode = queueLoopMode(loopMode, isFmMode);
    const prevIndex = prevQueueIndex(playQueue.length, currentIndex, indexLoopMode);
    const nextIndex = nextQueueIndex(playQueue.length, currentIndex, indexLoopMode);

    // FM 走到队列末尾时会追加新曲目再跳，标题此刻无法预知
    const fmWillFetch = isFmMode && fmNextIsUnfetchedAt(playQueue.length, currentIndex);

    return {
        prev: prevIndex >= 0 ? neighborAt(prevIndex) : blockedNeighbor(),
        next: fmWillFetch
            ? unknownNeighbor()
            : nextIndex >= 0
                ? neighborAt(nextIndex)
                : blockedNeighbor(),
    };
};
