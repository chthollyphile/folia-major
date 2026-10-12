# NetEase Heartbeat mode / 网易云心动模式

Sign in to NetEase, open the **Radio** tab and choose **Heartbeat**, or use **Start Heartbeat** in the command palette. Heartbeat starts with a playable song from your liked playlist and adds recommendations as playback approaches the end of its queue. It keeps the usual queue and song-like controls; Personal FM's trash action is not used.

The queue panel shows **Heartbeat is on** and a **Stop Heartbeat** button. Explicitly stopping restores the queue and position from before Heartbeat. The current track keeps playing, temporarily placed before the interrupted ordinary track; when playback returns, the exact original ordering is restored. If there was no prior queue, the current track finishes and playback stops. A pending return runs sequentially even with a saved single-repeat preference; that preference resumes when the original queue takes over. Starting other music, Personal FM, changing the account/provider, clearing the queue, entering Stage playback or changing loop mode cancels the session without restoring over the new selection.

Heartbeat sessions are kept in memory. Restarting or transferring playback to another window restores an ordinary queue; start Heartbeat again to resume recommendations. Empty liked playlists and failed/empty recommendation responses show a message instead of replacing the current queue.

登录网易云后，在「电台」页点击「心动模式」，或在命令面板执行「开启心动模式」。播放器会从「我喜欢的音乐」选取可播放歌曲，接着添加网易云推荐；临近队列末尾时继续获取推荐。点击「退出心动模式」会清除心动推荐队列，恢复进入前的普通队列；当前歌曲保留至播完，再从之前中断的歌曲接回。当前歌曲作为临时队列行显示，接回后移除；如果进入前没有队列，则播完当前歌曲后停止。原先的单曲循环不会阻止这一次衔接。重新启动软件或切换播放窗口后，需要再次开启心动模式。

## Integration

- UI and account capability checks call `heartbeatPlayback` through the application ports. Provider requests use Omni's `getHeartbeatSongs`; only the NetEase provider and transport know `/playmode/intelligence/list`.
- Heartbeat has its own transient store and request generation. It does not set `isFmMode`, call FM dislike, or introduce separate listening-report behavior.
- Requests that finish after stop, account switch, playback replacement or queue edits cannot take over playback or append to an unrelated queue.
- Automated tests use mocked provider responses. They verify routing, account ownership, cancellation, queue preservation and rendered interactions; a successful real-account recommendation response depends on the configured NetEase backend.
