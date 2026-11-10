// src/components/shared/overlayEntranceMotion.ts
// 全屏覆盖层的进出场：底衬淡入淡出，内容从略低、略小的位置托上来。
//
// 抽成一份是因为它决定的是「一层东西盖到应用上」这件事本身该有的节奏，而不是某个弹窗自己的
// 性格。设置面板、歌词偏移、Lab 这几处各自抄了一份几乎一样的数值，新的覆盖层一律用这里的，
// 免得同一个动作在不同入口有不同的手感。
//
// @note 覆盖层的退场必须有东西撑着它多留这 280ms —— 条件为假就直接 return null 的写法
// 拿不到 exit，要把 AnimatePresence 包在那个条件外面。

export const OVERLAY_TRANSITION = {
    // 和 GlobalLyricOffsetModal 用的是同一组数：这套曲线已经是仓库里覆盖层的既有手感。
    duration: 0.28,
    ease: [0.22, 1, 0.36, 1] as const,
};

/** 关了微动效时留的那一份：只淡入淡出，不做位移和缩放。 */
export const OVERLAY_CALM_TRANSITION = {
    duration: 0.12,
    ease: 'linear' as const,
};

export const overlayBackdropMotion = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
};

export const overlayPanelMotion = {
    initial: { opacity: 0, y: 18, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 12, scale: 0.99 },
};

/** 微动效关掉时，内容层退化成纯淡入淡出。 */
export const overlayPanelCalmMotion = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
};

/** 按当前微动效设置挑一组内容层动画。 */
export const overlayPanelMotionFor = (calm: boolean) => (
    calm
        ? { ...overlayPanelCalmMotion, transition: OVERLAY_CALM_TRANSITION }
        : { ...overlayPanelMotion, transition: OVERLAY_TRANSITION }
);
