// src/utils/uiZoom.ts
// 界面缩放（#1264）的挡位：主窗口整页按固定的几个百分比缩放，关掉就是 100%。

/** 可选的挡位（百分比）。100% 不在里面：关掉开关就是 100%。 */
export const UI_ZOOM_STEPS = [50, 67, 75, 80, 90, 110, 125, 150] as const;

export type UiZoomStep = typeof UI_ZOOM_STEPS[number];

/** 第一次打开开关时用的挡位：系统缩放调得大、界面显得挤，多半是想缩小一点。 */
export const DEFAULT_UI_ZOOM_STEP: UiZoomStep = 80;

/** 存着的值读成一个挡位；不是挡位（旧值、手改的值）时为 null。 */
export const readUiZoomStep = (value: unknown): UiZoomStep | null => {
    const percent = typeof value === 'number' ? value : Number(value);
    return (UI_ZOOM_STEPS as readonly number[]).includes(percent) ? percent as UiZoomStep : null;
};

/** 开关和挡位合成页面的缩放倍数。 */
export const resolveUiZoomFactor = (enabled: boolean, step: UiZoomStep): number => (enabled ? step / 100 : 1);

/**
 * 放大或缩小一挡后的开关和挡位。100% 夹在 90% 和 110% 之间，走到它就是关掉开关（挡位留着，
 * 下次打开还是它）；已经在最大或最小一挡时为 null。
 */
export const stepUiZoom = (
    enabled: boolean,
    step: UiZoomStep,
    direction: 1 | -1,
): { enabled: boolean; step: UiZoomStep } | null => {
    const ladder = [...UI_ZOOM_STEPS, 100].sort((a, b) => a - b);
    const index = ladder.indexOf(enabled ? step : 100) + direction;
    if (index < 0 || index >= ladder.length) return null;
    const next = ladder[index];
    return next === 100 ? { enabled: false, step } : { enabled: true, step: next as UiZoomStep };
};
