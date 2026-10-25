// src/components/scenes/engine/queueEnd.ts
// 「歌单放完了」这一下：播放队列停在最后一首结尾时调 announceQueueEnd（usePlaybackQueueController 的 stopAtQueueEnd），
// 场景宿主听它，交给场景的 queueEnd 事件。

const listeners = new Set<() => void>();

export const announceQueueEnd = () => {
    listeners.forEach(listener => listener());
};

export const onQueueEnd = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
