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
 * - 画在米白纸上（信息条的红顶边、计数斜块、圆形记号）：L 不超过 0.52，纸色的字压在上面也读得清（约 4.5 : 1）——--scratchpad-mark；
 * - 画在暗色墙面上（常驻的小圆点、几何体）：L 不低于 0.62；日光主题的浅色墙面上：L 不超过 0.5——--scratchpad-mark-wall；
 *   面板随日光主题换成浅灰，所以「墙上」的点缀色也是面板上的点缀色；
 * - 播放队列那条胶片不随主题、一直是黑的：--scratchpad-mark-dark（同暗色墙）。
 * 强调色几乎没有彩度时（默认的近白），钳完是一块中性灰，仍看得见。
 * 这几个变量写在 scratchpad.css（.scratchpad-root 与 .scratchpad-look 上）：网页版可能跑在不认 oklch(from …) 的浏览器里，
 * 那里退回下面这两种固定的构成主义红（纸上 4.7 : 1、暗墙 4.9 : 1、日光墙 4.6 : 1）。
 */
export const SCRATCHPAD_MARK_FALLBACK = '#c43521';
export const SCRATCHPAD_MARK_WALL_FALLBACK = '#e45a43';

/** 速记簿根节点上写的变量：纸、墨，以及常驻在墙上的小记号用的颜色（暗色墙用纸色，日光墙用墨色）。点缀色在样式表里。 */
export const scratchpadLookVars = (isDaylight: boolean): Record<string, string> => ({
    '--scratchpad-paper': SCRATCHPAD_PAPER,
    '--scratchpad-ink': SCRATCHPAD_INK,
    '--scratchpad-rest-ink': isDaylight ? SCRATCHPAD_INK : SCRATCHPAD_PAPER,
});

/** 三页的先后：页签列从上到下、换页动画的方向、信息条上的编号（01 / 02 / 03）都按它。 */
export const SCRATCHPAD_TABS: readonly ScratchpadTab[] = ['notes', 'history', 'queue'];

export type ScratchpadShapeKind = 'circle' | 'tri' | 'chev';

/** 信息条上一颗装饰：实心（点缀色）、线框、墨色、镂空（面板底下的黑）、或一张裁成这一页几何体的队列封面。 */
export type ScratchpadDecoStyle = 'fill' | 'wire' | 'ink' | 'hollow' | 'image';

export type ScratchpadDeco = {
    /** 相对信息条左上角（px），可以探出条外，被条的边裁掉。 */
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
 * 条宽 404px（面板 368px，再探出 36px；原来左边有一列页签时是 340px，2026-11-07 去掉页签列后整组右移 64px）。
 */
/** 固定种子的伪随机数（mulberry32）：装饰每次生成都一样。 */
export const mulberry32 = (seed: number) => {
    let state = seed | 0;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
};

const DECO_SEEDS: Record<ScratchpadTab, number> = { notes: 11, history: 23, queue: 37 };
const SCATTER_STYLES: readonly ScratchpadDecoStyle[] = ['fill', 'wire', 'hollow', 'image', 'ink', 'wire', 'fill', 'image', 'hollow', 'fill', 'ink', 'wire'];
/** 信息条右端留给按钮的宽度（按钮宽度不同，装饰的右界跟着变；最右 220px 转出屏幕）。三行总览那一版右端只有短短一截。 */
const ACTION_ROOM: Record<'full' | 'row', Record<ScratchpadTab, number>> = {
    full: { notes: 538, history: 488, queue: 448 },
    row: { notes: 538, history: 492, queue: 448 },
};
/** 信息条高度（含上下边）：展开整页 120px，三行总览 72px。 */
export const BAND_HEIGHTS = { full: 120, row: 72 } as const;

/**
 * 展开整页（120px 高）与三行总览（72px 高）那条信息条（width 宽）上的装饰：同一种几何体随机撒在标题与按钮之间的空白里，按钮上方那一截再放几颗小的；
 * 大小、样式、角度随机，按页固定种子（设计稿 F 的 gen-f 同一套算法）。线框与镂空整个落在条内，填充与封面可以探出条的上下沿；
 * 互相之间留一点空，不压文字和按钮。
 */
export const scatterBandDecos = (tab: ScratchpadTab, width: number, variant: 'full' | 'row' = 'full'): ScratchpadDeco[] => {
    const full = variant === 'full';
    const random = mulberry32(DECO_SEEDS[tab] * (full ? 7 : 3));
    const inner = BAND_HEIGHTS[variant] - 7;
    const split = width - ACTION_ROOM[variant][tab];
    // 按钮上方那一截也不早于标题的右边（742px）：纸窄时（手机）按钮区的左沿会落到标题前面，装饰就压在标题与「‹ 三行总览」上。
    const zones: [number, number, number][] = full ? [[742, split, 99], [Math.max(split, 742), width - 220, 54]] : [[650, split, 99]];
    const placed: ScratchpadDeco[] = [];
    for (let tries = 0; placed.length < (full ? 15 : 11) && tries < 600; tries += 1) {
        const style = SCATTER_STYLES[Math.floor(random() * SCATTER_STYLES.length)];
        const [x0, x1, yMax] = zones[random() < 0.82 || zones.length === 1 ? 0 : 1];
        const bottom = Math.min(yMax === 99 ? inner : yMax, inner);
        const inside = style === 'wire' || style === 'hollow';
        const maxSize = inside ? bottom - 8 : (full ? 104 : 74);
        const minSize = style === 'image' ? 34 : 12;
        const size = Math.round(minSize + Math.pow(random(), 1.7) * Math.max(0, Math.min(maxSize, full ? 96 : 66) - minSize));
        if (size < minSize || x1 - x0 < size + 4) continue;
        const yLow = inside ? 4 : -Math.round(size * 0.45);
        const yHigh = inside ? bottom - 4 - size : (yMax === 99 ? Math.round(inner - size * 0.55) : bottom - size);
        if (yHigh < yLow) continue;
        const x = Math.round(x0 + random() * (x1 - x0 - size));
        const y = Math.round(yLow + random() * (yHigh - yLow));
        const hit = placed.some(other => x < other.x + other.size + 6 && x + size + 6 > other.x && y < other.y + other.size + 6 && y + size + 6 > other.y);
        if (hit) continue;
        const rotate = tab === 'notes' ? 0 : Math.round((random() - 0.5) * 56);
        // gen-f 在这里挑一张队列封面：照样取一个数，后面的位置才和设计稿一样。
        random();
        placed.push({ x, y, size, style, rotate });
    }
    return placed;
};

/** 收起的细纸带（36px 高）上的小装饰：随机撒几颗，大多在左半段（右半段转出屏幕、被播放胶囊挡住）。 */
export const scatterSlimDecos = (tab: ScratchpadTab): ScratchpadDeco[] => {
    const random = mulberry32(DECO_SEEDS[tab] * 13);
    const styles: ScratchpadDecoStyle[] = ['fill', 'wire', 'ink', 'hollow'];
    const decos: ScratchpadDeco[] = [];
    let x = 500;
    while (x < 1300) {
        x += 30 + Math.round(random() * 70);
        const size = 10 + Math.round(random() * 12);
        const style = styles[Math.floor(random() * styles.length)];
        const y = Math.round(4 + random() * (29 - 8 - size));
        const rotate = tab === 'notes' ? 0 : Math.round((random() - 0.5) * 40);
        decos.push({ x, y, size, style, rotate });
    }
    return decos;
};

export const SCRATCHPAD_PANEL_BAND_DECOS: Record<ScratchpadTab, readonly ScratchpadDeco[]> = {
    notes: [deco(240, -10, 26, 'fill'), deco(270, 14, 30, 'wire'), deco(308, -6, 40, 'image'), deco(356, 22, 20, 'hollow'), deco(376, -12, 30, 'fill'), deco(326, 38, 14, 'ink')],
    history: [deco(246, 8, 28, 'wire', -14), deco(280, -12, 36, 'image', 18), deco(322, 26, 18, 'fill', -22), deco(346, -8, 30, 'fill', 9), deco(382, 18, 22, 'hollow', -6), deco(240, 40, 12, 'ink', 25)],
    queue: [deco(242, 12, 28, 'fill', -8), deco(278, -10, 40, 'image', 12), deco(326, 18, 24, 'wire', -20), deco(356, -6, 22, 'ink', 16), deco(380, 26, 18, 'hollow'), deco(254, -12, 14, 'fill', 24)],
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
