// dev/dedicatus/playbackTokens.mjs
// D311 / D312 的登记表：播放路径（起播、会话恢复、窗口交接、FM、Stage）里，每次等待之后、写播放状态之前，
// 必须先问一次本次起播的令牌，不新鲜就不写（currentSong.ts、wholeQueueWrites.ts 的文件头；#619、#796、#1016、#760）。
// 由本地规则 dedicatus/stale-after-await（D311）和 restricted-apis（D312）检查。

/** 适用的文件。 */
export const PLAYBACK_PATH_FILES = [
    'src/components/app/playback/start/**',
    'src/components/app/playback/restore/**',
    'src/components/app/playback/useStagePlaybackController.ts',
    'src/hooks/usePersonalFmModeController.ts',
];

export const PLAYBACK_TOKENS = {
    files: PLAYBACK_PATH_FILES,
    /** 发令牌的函数：调用它们本身也算“问了一次”（wholeQueueWritesSoFar() !== 起播时的值）。 */
    factories: ['startPlay', 'startRestore', 'wholeQueueWritesSoFar', 'queueStartsSoFar'],
    /**
     * 约定俗成的令牌变量名（作为参数传进来时认不出出处，按名字认）。`stage…LoadIdRef`、`nowPlaying…RequestIdRef` 是
     * Stage / Now Playing 推送内容的加载序号（useStagePlaybackController），作用和起播令牌一样。
     */
    namePattern: '^(stillWanted|isLatest\\w*|queueWritesAt\\w*|writesAt\\w*|startsAt\\w*|stage\\w*LoadIdRef|nowPlaying\\w*RequestIdRef)$',
    /** 别的复核写法：问“还是不是刚才要的那首”（askedSongKeyRef、startOfAskedSong()）。算复核，不算拿了令牌。 */
    readers: ['askedSongKeyRef', 'startOfAskedSong'],
    /** 写播放状态的函数：等待之后、调用它们之前要先问令牌。 */
    writers: [
        'setPlayQueue', 'setCurrentSong', 'makeSongCurrent', 'showSong', 'askForSong', 'replaceShownSong',
        'setIsFmMode', 'setAudioSrc', 'setLyrics', 'setPlayerState', 'setActivePlaybackContext',
        'presentOnlineFailure', 'presentPlaybackFailure', 'applyPlaybackSnapshot', 'setCachedCoverUrl',
    ],
};
