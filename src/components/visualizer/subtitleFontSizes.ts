// src/components/visualizer/subtitleFontSizes.ts
// 底部字幕（译文 / 下一句预览）那两组 clamp 字号的**唯一来源**，此前在每个模式里各抄一份
// （classic / cadenza / diorama / tilt / 模组宿主），改一次字号要动五个文件。
//
// 两组都是 `clamp(min, preferred, max)`：下限防止窄屏上字被压到读不出，上限防止宽屏上
// 顶到屏沿。`vw` 中间值让它在常见比例下跟着画面缩放——写死 rem 会在大屏上偏小、
// 在小窗口里偏大。

type SubtitleFontSizes = {
    translationFontSize: string;
    upcomingFontSize: string;
};

const clampSize = (min: number, preferred: number, max: number, scale: number): string => (
    `clamp(${(min * scale).toFixed(3)}rem, ${(preferred * scale).toFixed(3)}vw, ${(max * scale).toFixed(3)}rem)`
);

/**
 * 译文 / 下一句预览的字号。`lyricsFontScale` 是宿主的歌词字号倍率，缺省 1。
 * 各模式之间这两个数必须完全一致，否则字幕会在换模式的那一下跳一下大小。
 */
export const resolveSubtitleFontSizes = (lyricsFontScale = 1): SubtitleFontSizes => {
    const scale = Number.isFinite(lyricsFontScale) && lyricsFontScale > 0 ? lyricsFontScale : 1;
    return {
        translationFontSize: clampSize(1.125, 2.6, 1.25, scale),
        upcomingFontSize: clampSize(0.875, 2, 1, scale),
    };
};
