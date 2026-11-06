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

/**
 * 速记簿根节点上写的变量：纸、墨、两种点缀色（纸上 / 墙上），以及常驻在墙上的小记号用的颜色（暗色墙用纸色，日光墙用墨色）。
 * 面板随日光主题换成浅灰，所以「墙上」的点缀色也是面板上的点缀色；播放队列那条胶片不随主题、一直是黑的，用 --scratchpad-mark-dark。
 */
export const scratchpadLookVars = (isDaylight: boolean): Record<string, string> => ({
    '--scratchpad-paper': SCRATCHPAD_PAPER,
    '--scratchpad-ink': SCRATCHPAD_INK,
    '--scratchpad-mark': SCRATCHPAD_MARK_ON_PAPER,
    '--scratchpad-mark-wall': isDaylight ? SCRATCHPAD_MARK_ON_LIGHT : SCRATCHPAD_MARK_ON_DARK,
    '--scratchpad-mark-dark': SCRATCHPAD_MARK_ON_DARK,
    '--scratchpad-rest-ink': isDaylight ? SCRATCHPAD_INK : SCRATCHPAD_PAPER,
});

/** 三页的先后：页签列从上到下、换页动画的方向、信息条上的编号（01 / 02 / 03）都按它。 */
export const SCRATCHPAD_TABS: readonly ScratchpadTab[] = ['notes', 'history', 'queue'];

export type ScratchpadShapeKind = 'circle' | 'tri' | 'chev';

/** 信息条上一颗装饰：实心（点缀色）、线框、墨色、镂空（面板底下的黑）、或一张裁成这一页几何体的队列封面。 */
export type ScratchpadDecoStyle = 'fill' | 'wire' | 'ink' | 'hollow' | 'image';

export type ScratchpadDeco = {
    /** 相对信息条左上角（px），可以探出条外，被条的斜切裁掉。 */
    x: number;
    y: number;
    size: number;
    style: ScratchpadDecoStyle;
    /** 转多少度。 */
    rotate: number;
};

const deco = (x: number, y: number, size: number, style: ScratchpadDecoStyle, rotate = 0): ScratchpadDeco => ({ x, y, size, style, rotate });

/**
 * 左缘面板顶上那条米白信息条的装饰：每页一组固定的「随机」位置，撒在标题右边那段空白里（设计稿 A 按 F 适配的那一版，原样搬过来）。
 * 条宽 340px（面板内容区 304px，再探出 36px）。
 */
export const SCRATCHPAD_PANEL_BAND_DECOS: Record<ScratchpadTab, readonly ScratchpadDeco[]> = {
    notes: [deco(176, -10, 26, 'fill'), deco(206, 14, 30, 'wire'), deco(244, -6, 40, 'image'), deco(292, 22, 20, 'hollow'), deco(312, -12, 30, 'fill'), deco(262, 38, 14, 'ink')],
    history: [deco(182, 8, 28, 'wire', -14), deco(216, -12, 36, 'image', 18), deco(258, 26, 18, 'fill', -22), deco(282, -8, 30, 'fill', 9), deco(318, 18, 22, 'hollow', -6), deco(176, 40, 12, 'ink', 25)],
    queue: [deco(178, 12, 28, 'fill', -8), deco(214, -10, 40, 'image', 12), deco(262, 18, 24, 'wire', -20), deco(292, -6, 22, 'ink', 16), deco(316, 26, 18, 'hollow'), deco(190, -12, 14, 'fill', 24)],
};

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
