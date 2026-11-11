// src/components/scenes/engine/queueEnd.ts
// 「歌单放完了」这一下：最后一首放到结尾、队列停下时调 announceQueueEnd（usePlaybackQueueController 的 stopAtQueueEnd，
// 只在 playedToEnd 时；放不了而跳过、出错停下的都不算）。场景宿主听它，交给场景的 queueEnd 事件。

const listeners = new Set<() => void>();

export const announceQueueEnd = () => {
    listeners.forEach(listener => listener());
};

export const onQueueEnd = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
