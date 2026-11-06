import type { ScratchpadTab } from '../../../stores/useScratchpadStore';

// src/components/app/scratchpad/scratchpadLook.ts
// 速记簿 Bravais 样式的共用定义（设计稿：Claude Design 画布「速记簿 · Bravais 重设计」的 F 定稿）：
// 平面构成主义的纸与墨、点缀色，以及三页各自的几何体——速记簿圆、播放历史三角（尖朝上）、播放队列书名号「》」那样的双箭头。
// 几何体在边缘标签、面板、展开页的信息条装饰、设置页的小图里都用，形状只在这里算一次。纯函数，不碰 DOM。

/** 构成主义的纸与墨：米白纸、黑墨，固定不随主题。 */
export const SCRATCHPAD_PAPER = '#f4f0e6';
export const SCRATCHPAD_INK = '#141414';

/**
 * 点缀色跟主题强调色走（用户定，2026-11-06：设计稿里的红只是示意）。强调色可能很亮（默认暗色主题接近白色）也可能很暗，
 * 所以按它画在什么上面钳住亮度（oklch 的 L），色相与彩度照旧：
 * - 画在米白纸上（信息条的红顶边、计数斜块、圆形记号）：L 不超过 0.52，纸色的字压在上面也读得清（约 4.5 : 1）；
 * - 画在暗色墙面上（常驻的小圆点、几何体）：L 不低于 0.62；
 * - 日光主题的浅色墙面上：L 不超过 0.5。
 * 强调色几乎没有彩度时（默认的近白），钳完是一块中性灰，仍看得见。没有主题变量的地方退回构成主义红。
 */
const ACCENT = 'var(--text-accent, #d93a26)';
export const SCRATCHPAD_MARK_ON_PAPER = `oklch(from ${ACCENT} min(l, 0.52) c h)`;
export const SCRATCHPAD_MARK_ON_DARK = `oklch(from ${ACCENT} max(l, 0.62) c h)`;
export const SCRATCHPAD_MARK_ON_LIGHT = `oklch(from ${ACCENT} min(l, 0.5) c h)`;

/** 速记簿根节点上写的变量：纸、墨、两种点缀色（纸上 / 墙上），以及常驻在墙上的小记号用的颜色（暗色墙用纸色，日光墙用墨色）。 */
export const scratchpadLookVars = (isDaylight: boolean): Record<string, string> => ({
    '--scratchpad-paper': SCRATCHPAD_PAPER,
    '--scratchpad-ink': SCRATCHPAD_INK,
    '--scratchpad-mark': SCRATCHPAD_MARK_ON_PAPER,
    '--scratchpad-mark-wall': isDaylight ? SCRATCHPAD_MARK_ON_LIGHT : SCRATCHPAD_MARK_ON_DARK,
    '--scratchpad-rest-ink': isDaylight ? SCRATCHPAD_INK : SCRATCHPAD_PAPER,
});

export type ScratchpadShapeKind = 'circle' | 'tri' | 'chev';

/** 每一页的几何体。 */
export const SCRATCHPAD_TAB_SHAPES: Record<ScratchpadTab, ScratchpadShapeKind> = {
    notes: 'circle',
    history: 'tri',
    queue: 'chev',
};

type Point = readonly [number, number];

/** 几何体在 size × size 的方框里的多边形（圆用 36 边形近似）；「》」是两个分开的粗尖角。 */
export const scratchpadShapePolygons = (kind: ScratchpadShapeKind, size: number): Point[][] => {
    if (kind === 'circle') {
        const r = size / 2;
        return [Array.from({ length: 36 }, (_, k): Point => {
            const angle = (k / 36) * Math.PI * 2;
            return [r + r * Math.cos(angle), r + r * Math.sin(angle)];
        })];
    }
    if (kind === 'tri') return [[[size / 2, 0], [size, size], [0, size]]];
    const thickness = size * 0.22;
    const width = size * 0.56;
    const chevron = (dx: number): Point[] => [
        [dx, 0], [dx + thickness, 0], [dx + width, size / 2], [dx + thickness, size], [dx, size], [dx + width - thickness, size / 2],
    ];
    return [chevron(0), chevron(size - width)];
};

const fixed = (value: number) => Number(value.toFixed(2));

/** 同一组多边形写成一条 SVG path（M … Z M … Z）。 */
export const scratchpadShapePath = (kind: ScratchpadShapeKind, size: number): string => (
    scratchpadShapePolygons(kind, size)
        .map(polygon => `M${polygon.map(([x, y]) => `${fixed(x)} ${fixed(y)}`).join(' L')} Z`)
        .join(' ')
);

/** 把一张封面裁成这个几何体的 CSS clip-path（size 是元素的边长，px）。 */
export const scratchpadShapeClipPath = (kind: ScratchpadShapeKind, size: number): string => (
    kind === 'circle' ? 'circle(50%)' : `path('${scratchpadShapePath(kind, size)}')`
);
