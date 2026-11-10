import type { PonderAnchorSource, PonderRelativeRect, PonderSurfaceKind } from '../../../../types/ponder';

// src/components/ponder/targets/settings/settingsSectionShared.ts
// 设置面板里一组的锚点写法。
//
// 文件名不是 *.target.ts：注册表用 glob 收目标，共用件混进去会被当成缺 default export
// 的目标直接抛错。

/** 一组设置：一块居中的合成面板。宽高各组自己给，因为它们行数差得远。 */
export const settingsPanel = (
    surfaceKind: PonderSurfaceKind,
    labelKey: string,
    rect: { top: number; width: number; height: number },
): PonderAnchorSource => ({
    kind: 'synthetic',
    rect: { left: 0.5, top: rect.top, width: rect.width, height: rect.height, anchorX: 'center' },
    role: 'surface',
    surfaceKind,
    labelKey,
});

/** 面板里的一块区域：只给几何和落点，框不画 —— 合成界面已经把它画出来了。 */
export const settingsRegion = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'panel', rect, role: 'region', labelKey }
);
