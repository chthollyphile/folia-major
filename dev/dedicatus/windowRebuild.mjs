// dev/dedicatus/windowRebuild.mjs
// D610 的登记表：主进程重建主窗口（透明、壁纸、迁移显示器……）一律带上播放交接快照。
// 快照是 `await requestWindowPlaybackHandoff()` 得到的变量；它让新窗口接住正在放的歌、外部播放器（Apple Music companion、
// Spotify Soloist）和队列。少了它，新窗口没人接手，旧的外部播放器一直响（#1115 → #1122 → #1128 修了三次）。
// 由本地规则 dedicatus/window-rebuild-handoff 检查（dev/dedicatus/eslint/plugin.mjs）。

export const WINDOW_REBUILD = {
    file: 'electron/main.cjs',
    call: 'recreateMainWindowWithTransparencyMode',
    handoffFactory: 'requestWindowPlaybackHandoff',
    /** 把调用方取好的快照原样往下传的函数。 */
    passthrough: {
        setMainWindowTransparentMode: '调用方（设置项、遥控窗口）先取好快照再传进来',
    },
    /** 不带快照也可以的地方：窗口刚建好，还没开始放歌。 */
    withoutHandoff: {},
};
