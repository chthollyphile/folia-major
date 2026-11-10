import type { PonderRect } from '../../types/ponder';

// src/utils/ponder/fitRectsToStage.ts
// 把整幅骨架等比缩放并平移到教程可用的那块区域里。
//
// 两个现实问题逼出来的：被教的组件常常正好在屏幕底部（底部控制条就是），而教程的
// 标题栏和进度条也占着上下两端；而且一幅从真实界面量来的图，常常比让开外框之后
// 剩下的高度还高 —— 这时只平移，必然有一端被压住。
//
// 整体变换而不是逐个避让：骨架的全部价值在于相对位置和真实界面一致，逐个挪会把它毁掉。
// 等比缩放同样保住了这一点，它还是同一幅图，只是小了一圈、挪了个地方 ——
// 原版 Ponder 的场景本来也是屏幕中央的一块小景，不是 1:1 的实物。

type FitInput = {
    rects: Record<string, PonderRect>;
    viewport: { width: number; height: number };
    /**
     * 外框占掉的边。上下是标题栏和进度条；right 给「本页可单独思索的组件」那张浮层卡 ——
     * 它压在骨架右上角时，页面右侧的控件就被盖住了。
     */
    chrome: { top: number; bottom: number; left?: number; right?: number };
    /** 骨架与外框之间至少留的空隙。 */
    gap?: number;
};

const DEFAULT_GAP_PX = 24;

const boundsOf = (rects: Record<string, PonderRect>) => {
    const list = Object.values(rects);
    if (list.length === 0) {
        return null;
    }
    return {
        top: Math.min(...list.map(r => r.top)),
        bottom: Math.max(...list.map(r => r.top + r.height)),
        left: Math.min(...list.map(r => r.left)),
        right: Math.max(...list.map(r => r.left + r.width)),
    };
};

/**
 * 等比缩放 + 纵向居中到可用区域。横向以视口中线为缩放中心，保持左右关系。
 *
 * 装得下就只平移，不缩放 —— 能 1:1 的时候就 1:1，空间记忆迁移得最准。
 */
export const fitRectsToStage = ({
    rects,
    viewport,
    chrome,
    gap = DEFAULT_GAP_PX,
}: FitInput): Record<string, PonderRect> => {
    const bounds = boundsOf(rects);
    if (!bounds) {
        return rects;
    }

    const availableTop = chrome.top + gap;
    const availableHeight = viewport.height - chrome.bottom - gap - availableTop;
    const contentHeight = bounds.bottom - bounds.top;
    if (availableHeight <= 0 || contentHeight <= 0) {
        return rects;
    }

    const availableLeft = (chrome.left ?? 0) + gap;
    const availableRight = viewport.width - (chrome.right ?? 0) - gap;
    const availableWidth = availableRight - availableLeft;
    const contentWidth = bounds.right - bounds.left;
    const widthScale = availableWidth > 0 && contentWidth > 0 ? availableWidth / contentWidth : 1;

    // 缩多少没有下限：可用区域是画面那块屏，屏外面就是播放控制和说明文字，图不能伸出去。
    const scale = Math.min(1, availableHeight / contentHeight, widthScale);
    const availableBottom = availableTop + availableHeight;
    const centerX = (availableLeft + availableRight) / 2;

    // 不用缩的时候尽量别动：位置和真实界面一一对应是骨架最值钱的地方，
    // 居中会平白把这份对应关系推掉。所以只做把它推进可用带所需的最小平移。
    // 需要缩放时就没有 1:1 可言了，这时居中最好看。
    const scaledHeight = contentHeight * scale;
    const targetTop = scale < 1
        ? availableTop + Math.max(0, (availableHeight - scaledHeight) / 2)
        : Math.min(Math.max(bounds.top, availableTop), Math.max(availableTop, availableBottom - contentHeight));

    // 横向同样只做「推进可用带」所需的最小平移：右侧让开浮层卡之后，
    // 整幅图该往左挪多少就挪多少，不额外居中，免得推掉和真实界面的左右对应。
    const scaledLeft = centerX + (bounds.left - centerX) * scale;
    const scaledRight = scaledLeft + contentWidth * scale;
    const shiftX = scaledLeft < availableLeft ? availableLeft - scaledLeft
        : scaledRight > availableRight ? availableRight - scaledRight
        : 0;

    if (scale === 1 && Math.abs(targetTop - bounds.top) < 0.5 && Math.abs(shiftX) < 0.5) {
        return rects;
    }

    return Object.fromEntries(Object.entries(rects).map(([name, rect]) => [name, {
        ...rect,
        left: centerX + (rect.left - centerX) * scale + shiftX,
        top: targetTop + (rect.top - bounds.top) * scale,
        width: rect.width * scale,
        height: rect.height * scale,
    }]));
};
