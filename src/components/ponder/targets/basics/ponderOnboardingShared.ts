import { PONDER_ONBOARDING_GEOMETRY as O } from '../../surfaces/basics/onboarding.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSurfaceKind } from '../../../../types/ponder';

// src/components/ponder/targets/basics/ponderOnboardingShared.ts
// 入门那一族目标共用的锚点。
//
// 文件名不是 *.target.ts：注册表用 glob 收目标，共用件混进去会被当成一个缺 default export
// 的目标直接抛错。

/** startsHidden 给那些「按了键才出现」的面：一进场就摆着的话，字幕在讲一件已经发生的事。 */
export const onboardingSurface = (
    labelKey: string,
    surfaceKind: PonderSurfaceKind,
    startsHidden = false,
): Record<string, PonderAnchorSource> => ({
    page: {
        kind: 'synthetic',
        rect: { left: 0.5, top: 0.15, width: 0.56, height: 0.5, anchorX: 'center' },
        role: 'surface',
        surfaceKind,
        labelKey,
        startsHidden,
    },
});

const onIllustration = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'page', rect, role: 'region', labelKey }
);

/** 那张讲思索本身的示意图，加上图里三处可以被指到的东西。 */
export const ONBOARDING_ILLUSTRATION: Record<string, PonderAnchorSource> = {
    ...onboardingSurface('ponder.anchors.onboarding.page', 'ponder-onboarding'),
    component: onIllustration(O.cardC, 'ponder.anchors.onboarding.component'),
    capsule: onIllustration(O.capsule, 'ponder.anchors.onboarding.capsule'),
    touchBulb: onIllustration(O.touchBulb, 'ponder.anchors.onboarding.touchBulb'),
};
