import {
    BRAVAIS_CAMERA_JUMP_SCREENS,
    BRAVAIS_CAMERA_MAX_SPEED,
    BRAVAIS_CAMERA_MAX_TWEEN_S,
    BRAVAIS_CAMERA_TWEEN_S,
} from './bravaisConstants';

// src/library/suites/bravais/bravaisCameraTween.ts
// 相机补间的时长（纯规则）：近距离沿用固定的底时长；距离远到按底时长会飞得太快时按速度上限拉长，最长不超过上限。
// 从 Lattice 或播放页回来时，正在播放那首的聚焦卡会自动展开并让相机让位（useBravaisPlayingCard），那一首离相机很远
// （无限墙、长队列）时，固定的 0.42s 会让整面墙一次扫过大半个队列。

/** 补间时长（秒）：distance 是世界单位，base 是这段移动想要的底时长（秒；0 或负数表示不快进）。 */
export const resolveBravaisCameraTweenSeconds = (distance: number, base = BRAVAIS_CAMERA_TWEEN_S): number => {
    if (!Number.isFinite(base) || base <= 0) return base;
    if (Number.isNaN(distance) || distance <= 0) return base;
    if (!Number.isFinite(distance)) return BRAVAIS_CAMERA_MAX_TWEEN_S;
    return Math.min(BRAVAIS_CAMERA_MAX_TWEEN_S, Math.max(base, distance / BRAVAIS_CAMERA_MAX_SPEED));
};

/** 这段移动要不要直接到位（不补间）：超过 BRAVAIS_CAMERA_JUMP_SCREENS 屏对角线。视口还没量到时不跳。 */
export const shouldJumpBravaisCamera = (distance: number, view: { width: number; height: number; scale: number } | null): boolean => {
    if (!view || !(view.scale > 0) || !Number.isFinite(distance) || distance <= 0) return false;
    return distance > (Math.hypot(view.width, view.height) * BRAVAIS_CAMERA_JUMP_SCREENS) / view.scale;
};
