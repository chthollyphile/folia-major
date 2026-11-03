// Copyright (c) 2026 chthollyphile
import type { Line } from '../../../../types';
import { splitLyricGraphemes } from '../../../../utils/lyrics/graphemeTiming';
import { segmentLyricWords } from '../../../../utils/lyrics/wordSegmentation';
import type { Mood } from '../hanabiKernel';
import { createRng } from '../hanabiRandom';
import { clamp, mixColor } from '../mg/mgMath';
import type { BlockStyle, BurstKind, HanabiPalette } from '../types';

// src/components/visualizer/hanabi/collage/collagePlan.ts
// PV 拼贴的编排（纯数据，不碰 Pixi）：每个镜头按族、情绪与种子挑一种「拼贴配方」，算出每个拼贴件的位置、颜色与出入场时刻。
// 日系动漫 PV 的手帐感：斜跨画面的装饰带（电影胶片、剪刀剪出的剪切线、蕾丝花边，都不带字）、重复的空心字、带白边的贴纸、
// 胶带、格子纸片、小窗口、编号标签，加上烟花开花时蹦出来的主题图标贴纸（主题的 lucide 图标，没有时用花）与升空时跟着尾迹的小图标。
// 间奏镜头放一条胶片与一路往上飘的贴纸气球。
// 坐标都在镜头容器里（与文字视图的本地坐标一致）；件都摆在字组包围盒外面或字的后面，不挡字。

export type CollageRecipe = 'scrapbook' | 'strips' | 'echo' | 'window' | 'stickerbomb' | 'quiet' | 'bridge' | 'opening';

export type StickerShape = 'heart' | 'star' | 'sparkle' | 'flower' | 'cloud' | 'ribbon' | 'cat' | 'bubble';
export type TapePattern = 'stripe' | 'dot' | 'check';
export type PatchPattern = 'grid' | 'dots' | 'gingham' | 'plain';
/** 装饰带：电影胶片（齿孔 + 一格格粉彩画面）、剪切线（剪刀剪过去留下虚线）、蕾丝花边（波浪边 + 孔眼）。 */
export type StripStyle = 'film' | 'cut' | 'lace';

interface Timed {
    /** 出场（弹出 / 擦出）开始的时刻。 */
    at: number;
    /** 退场开始的时刻与时长。 */
    exitAt: number;
    exitDuration: number;
}

export interface StripItem extends Timed {
    kind: 'strip';
    style: StripStyle;
    x: number;
    y: number;
    length: number;
    thickness: number;
    rotation: number;
    /** 主色：胶片的画面格、剪切线的虚线、花边里穿的缎带。 */
    color: number;
    /** 图案沿带子走的速度（像素 / 秒，带方向）：胶片齿孔、虚线、花边都在走。 */
    speed: number;
    /** 从哪一端擦出（剪切线是剪刀从这一端剪过去）。 */
    from: -1 | 1;
}

export interface EchoItem extends Timed {
    kind: 'echo';
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    text: string;
    color: number;
    /** 字号（像素）。 */
    size: number;
    /** 重复方向：x 横排成一行、y 竖着摞成一列。 */
    axis: 'x' | 'y';
    speed: number;
    alpha: number;
}

export interface StickerItem extends Timed {
    kind: 'sticker';
    shape: StickerShape;
    x: number;
    y: number;
    size: number;
    rotation: number;
    color: number;
    /** 对话框贴纸里的字。 */
    label: string | null;
    layer: 'back' | 'front';
}

export interface TapeItem extends Timed {
    kind: 'tape';
    x: number;
    y: number;
    length: number;
    width: number;
    rotation: number;
    color: number;
    pattern: TapePattern;
}

export interface PatchItem extends Timed {
    kind: 'patch';
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    color: number;
    pattern: PatchPattern;
    /** 深色卡片（字没有色块时用，保证白字看得清）。 */
    dark: boolean;
}

export interface WindowItem extends Timed {
    kind: 'window';
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    bar: number;
    title: string;
}

export interface LabelItem extends Timed {
    kind: 'label';
    x: number;
    y: number;
    text: string;
    color: number;
    size: number;
    rotation: number;
}

/** 开场标题卡里的曲名大字：弹出后轻轻上下浮动。 */
export interface HeadlineItem extends Timed {
    kind: 'headline';
    x: number;
    y: number;
    text: string;
    color: number;
    size: number;
    rotation: number;
}

/** 图标贴纸：开花一瞬蹦出、停一会儿、往上飘着淡出。icon 是 lucide 的导出名（主题图标，默认 Flower）。 */
export interface PopItem {
    kind: 'pop';
    x: number;
    y: number;
    icon: string;
    color: number;
    size: number;
    rotation: number;
    at: number;
    duration: number;
}

/** 升空的小图标：跟着尾迹的头往上走、一路转着，到顶淡出。 */
export interface WhooshItem {
    kind: 'whoosh';
    icon: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    at: number;
    duration: number;
    color: number;
    size: number;
}

/** 间奏的贴纸气球：从画面下面一路飘上去。 */
export interface FloaterItem {
    kind: 'floater';
    shape: StickerShape;
    x: number;
    y: number;
    rise: number;
    size: number;
    color: number;
    at: number;
    duration: number;
    sway: number;
}

export type CollageItem = StripItem | EchoItem | StickerItem | TapeItem | PatchItem | WindowItem | LabelItem | HeadlineItem | PopItem | WhooshItem | FloaterItem;

export interface CollageRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CollageBurst {
    x: number;
    y: number;
    at: number;
    kind: BurstKind;
    /** 主烟花（文字入场时那一发、间奏的连发）；被唱到的小花与退场火花不算。 */
    main: boolean;
    radius: number;
}

export interface CollageLaunch {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    at: number;
    duration: number;
}

export interface CollagePlanInput {
    seed: string;
    family: string;
    mood: Mood;
    isBridge: boolean;
    block: BlockStyle;
    /** 镜头在单元里的序号（编号标签用）。 */
    shotNumber: number;
    /** 字组静止时的包围盒；间奏为文字区。 */
    bounds: CollageRect;
    /** 镜头定格时画面在镜头容器里的范围。 */
    screen: CollageRect;
    /** time 时刻画面在镜头容器里的范围（镜头边界前后世界在上升，开花时镜头可能还没落定）；不给按 screen。 */
    screenAt?: (time: number) => CollageRect;
    unit: number;
    palette: HanabiPalette;
    enterAt: number;
    exitAt: number;
    exitDuration: number;
    start: number;
    end: number;
    /** 这一句里最像关键词的词（重复字用）；没有为 null。 */
    keyword: string | null;
    /** 整首歌的字样（曲名、HANABI…）：没有关键词时重复字用它。 */
    motifs: readonly string[];
    bursts: readonly CollageBurst[];
    launches: readonly CollageLaunch[];
    /** tuning.collage（0..2）。 */
    amount: number;
    /** 开花时蹦出来的图标（主题的 lucide 图标名，已加载）；空时用 HANABI_FALLBACK_ICON。 */
    icons?: readonly string[];
    previous: CollageRecipe | null;
    /** 歌曲开头的间奏镜头：放「now playing」标题卡（曲名 + 艺人）。 */
    opening?: { title: string; artist: string | null } | null;
}

export interface CollagePlan {
    recipe: CollageRecipe | null;
    items: CollageItem[];
}

/** 每个族偏好的配方（前面的权重大）。 */
const FAMILY_RECIPES: Record<string, CollageRecipe[]> = {
    uchiage: ['strips', 'scrapbook', 'stickerbomb'],
    kiku: ['echo', 'strips', 'window'],
    botan: ['stickerbomb', 'scrapbook', 'window'],
    yanagi: ['quiet', 'echo'],
    senrin: ['stickerbomb', 'strips', 'scrapbook'],
    hoshikuzu: ['window', 'quiet', 'stickerbomb'],
    obi: ['strips', 'scrapbook', 'echo'],
    senko: ['window', 'echo', 'strips'],
    senkohanabi: ['quiet', 'scrapbook'],
    shakudama: ['echo', 'strips', 'stickerbomb'],
};

/** 日系可爱 PV 的糖果色：贴纸、胶带、色带都从这里和镜头调色板的粉彩版里取。 */
export const CANDY = [0xffb3d1, 0xb8f2e6, 0xfff1a8, 0xd7c4ff, 0xffc9a8, 0xa8dcff] as const;
/** 标签上的深色字、胶片片基与深色卡片。 */
export const CANDY_INK = 0x2b1f3d;
export const DEEP_CARD = 0x1d1838;

/** 没有主题图标时用的图标（lucide 的导出名）。 */
export const HANABI_FALLBACK_ICON = 'Flower';
/** 图标贴纸的描边色：比糖果色深一档，白边上看得清。 */
export const ICON_INKS = [0xff5fa2, 0x3fb2ff, 0xffa31a, 0x9b6bff, 0x2ec9a0] as const;
const BUBBLE_LABELS = ['♡', '!!', '♪', 'LOVE', 'yay!', '(≧▽≦)', '☆彡'];
const WINDOW_TITLES = ['♡ hanabi.exe', '♪ lyric.txt', '✦ night_sky.png', '☆ summer.mp3', '♡ kirakira.app'];
const SHAPES: StickerShape[] = ['heart', 'star', 'sparkle', 'flower', 'cloud', 'ribbon', 'cat'];
export const STRIP_STYLES: readonly StripStyle[] = ['film', 'cut', 'lace'];
/** 各样式带子的粗细（占画面短边）：胶片要放得下齿孔与画面格，剪切线细。 */
const STRIP_THICKNESS: Record<StripStyle, number> = { film: 0.075, cut: 0.045, lace: 0.06 };

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length) % list.length]!;

/** 调色板颜色的粉彩版：往白里混，保持色相。 */
export const pastel = (color: number, amount = 0.45) => mixColor(color, 0xffffff, amount);

const LATIN = /^[\p{Script=Latin}\p{N}'’\- ]+$/u;

/**
 * 一句里最像关键词的词（重复空心字、色带用）：很短的句子（≤ 5 个字）整句；否则取最长的词（2–10 个字），
 * 拉丁字母转大写（PV 里的英文装饰字都是大写）。没有合适的返回 null。
 */
export const pickCollageKeyword = (line: Line | null): string | null => {
    if (!line) return null;
    const text = line.fullText.trim();
    const graphemes = splitLyricGraphemes(text).filter(grapheme => grapheme.trim().length > 0);
    const shout = (word: string) => (LATIN.test(word) ? word.toLocaleUpperCase() : word);
    if (graphemes.length >= 2 && graphemes.length <= 5) return shout(text);
    let best: string | null = null;
    let bestLength = 0;
    segmentLyricWords(line).forEach(part => {
        const word = part.segment.trim();
        const length = splitLyricGraphemes(word).length;
        if (!part.isWordLike || length < 2 || length > 10) return;
        if (length > bestLength) {
            best = word;
            bestLength = length;
        }
    });
    return best ? shout(best) : null;
};

/** 挑配方：族偏好里避开上一个镜头的配方；间奏固定 bridge；数量为 0 时没有。 */
export const chooseCollageRecipe = (family: string, isBridge: boolean, previous: CollageRecipe | null, random: () => number): CollageRecipe => {
    if (isBridge) return 'bridge';
    const preferred = FAMILY_RECIPES[family] ?? ['scrapbook', 'strips', 'stickerbomb'];
    const choices = preferred.filter(recipe => recipe !== previous);
    const list = choices.length > 0 ? choices : preferred;
    // 越靠前权重越大：权重 n, n-1, …, 1。
    const total = (list.length * (list.length + 1)) / 2;
    let roll = random() * total;
    for (let index = 0; index < list.length; index += 1) {
        roll -= list.length - index;
        if (roll < 0) return list[index]!;
    }
    return list[0]!;
};

/** 数量倍率下的件数：0 时 0，其余至少 min。 */
const countOf = (base: number, amount: number, min = 1) => (amount <= 0 ? 0 : Math.max(min, Math.round(base * amount)));

/**
 * 一个镜头的拼贴。确定性：同样的输入（含 seed）永远同样的件。
 */
export const planShotCollage = (input: CollagePlanInput): CollagePlan => {
    if (input.amount <= 0) return { recipe: null, items: [] };
    const random = createRng(`${input.seed}:collage`);
    const recipe: CollageRecipe = input.isBridge && input.opening ? 'opening' : chooseCollageRecipe(input.family, input.isBridge, input.previous, random);
    const { bounds, screen, unit, amount } = input;
    const items: CollageItem[] = [];
    const exit = { exitAt: input.exitAt, exitDuration: input.exitDuration };
    const candy = [...CANDY, pastel(input.palette.accent), pastel(input.palette.sparks[1] ?? input.palette.accent)];
    const candyColor = () => pick(candy, random);
    /** 画面左缘留给竖排跑马灯（unitCollage）与画框朱印的宽度。 */
    const railGap = unit * 0.14;
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const sx = screen.x + screen.width / 2;
    const clampX = (x: number, pad: number) => clamp(x, screen.x + railGap * 0.5 + pad, screen.x + screen.width - pad);
    const clampY = (y: number, pad: number) => clamp(y, screen.y + pad, screen.y + screen.height - pad);
    const signed = () => (random() < 0.5 ? -1 : 1);

    const motifs = input.motifs.length > 0 ? input.motifs : ['HANABI', '花火'];
    const motif = () => pick(motifs, random);

    const sticker = (shape: StickerShape, x: number, y: number, size: number, delay: number, layer: 'back' | 'front' = 'front', label: string | null = null): StickerItem => ({
        kind: 'sticker',
        shape,
        x: clampX(x, size * 0.6),
        y: clampY(y, size * 0.6),
        size,
        rotation: (random() - 0.5) * 0.7,
        color: candyColor(),
        label,
        layer,
        at: input.enterAt + delay,
        ...exit,
    });

    /** 包围盒四角往外的落点（corner 0..3 = 左上、右上、右下、左下）。 */
    const corner = (index: number, out: number) => {
        const dx = index === 0 || index === 3 ? -1 : 1;
        const dy = index < 2 ? -1 : 1;
        return {
            x: (dx < 0 ? bounds.x : bounds.x + bounds.width) + dx * out,
            y: (dy < 0 ? bounds.y : bounds.y + bounds.height) + dy * out * 0.6,
        };
    };

    /** 一条斜跨画面的装饰带，摆在字组上方或下方（在字后面）。 */
    const strip = (style: StripStyle, side: -1 | 1, delay: number): StripItem => {
        const thickness = Math.max(style === 'cut' ? 14 : 18, unit * STRIP_THICKNESS[style]);
        const gap = unit * 0.05 + thickness / 2;
        let y = side < 0 ? bounds.y - gap : bounds.y + bounds.height + gap;
        // 放不下就压回画面里（带子在字后面，压到字也不挡）。
        y = clampY(y, thickness);
        return {
            kind: 'strip',
            style,
            x: sx,
            y,
            length: Math.hypot(screen.width, screen.height) * 1.25,
            thickness,
            rotation: side * (0.06 + random() * 0.1),
            color: candyColor(),
            speed: signed() * unit * (style === 'film' ? 0.12 : 0.05) * (0.8 + random() * 0.4),
            from: signed(),
            at: input.enterAt + delay,
            ...exit,
        };
    };

    const echo = (axis: 'x' | 'y', side: -1 | 1, alpha: number): EchoItem | null => {
        const text = input.keyword ?? motif();
        if (!text.trim()) return null;
        const size = unit * (axis === 'x' ? 0.13 : 0.11);
        if (axis === 'x') {
            const y = side < 0 ? bounds.y - size * 0.75 : bounds.y + bounds.height + size * 0.75;
            return {
                kind: 'echo', axis, text, size, alpha,
                x: sx, y: clampY(y, size * 0.5), width: screen.width * 1.3, height: size * 1.25,
                rotation: (random() - 0.5) * 0.08,
                color: random() < 0.5 ? input.palette.paper : candyColor(),
                speed: side * unit * 0.07,
                at: input.enterAt - 0.15,
                ...exit,
            };
        }
        const width = size * Math.max(1, Array.from(text).length) * 0.9 + size * 0.4;
        const free = (screen.width - bounds.width) / 2;
        const x = side < 0 ? bounds.x - width * 0.55 : bounds.x + bounds.width + width * 0.55;
        return {
            kind: 'echo', axis, text, size, alpha,
            // 两侧放不下就贴在画面边上（在字后面，淡）；左边让开竖排跑马灯与画框的朱印。
            x: clamp(free > width * 0.6 ? x : (side < 0 ? -Infinity : Infinity), screen.x + railGap + width * 0.5, screen.x + screen.width - unit * 0.06 - width * 0.5),
            y: cy,
            width,
            height: screen.height * 1.3,
            rotation: 0,
            color: random() < 0.5 ? input.palette.paper : candyColor(),
            speed: side * unit * 0.06,
            at: input.enterAt - 0.15,
            ...exit,
        };
    };

    const patch = (pad: number, offset: number, pattern: PatchPattern, delay: number): PatchItem => {
        const dark = input.block === 'none' || input.block === 'outline' || input.block === 'marker';
        return {
            kind: 'patch',
            x: cx + offset * signed(),
            y: cy + offset * signed() * 0.6,
            width: bounds.width + pad * 2,
            height: bounds.height + pad * 2,
            rotation: (random() - 0.5) * 0.09,
            color: dark ? DEEP_CARD : candyColor(),
            pattern,
            dark,
            at: input.enterAt + delay,
            ...exit,
        };
    };

    const tape = (index: number, delay: number, around: CollageRect): TapeItem => {
        const length = unit * (0.12 + random() * 0.04);
        const x = index === 0 || index === 3 ? around.x : around.x + around.width;
        const y = index < 2 ? around.y : around.y + around.height;
        const diagonal = index === 0 || index === 2 ? -1 : 1;
        return {
            kind: 'tape',
            x,
            y,
            length,
            width: length * 0.3,
            rotation: diagonal * (0.62 + random() * 0.2),
            color: candyColor(),
            pattern: pick(['stripe', 'dot', 'check'] as const, random),
            at: input.enterAt + delay,
            ...exit,
        };
    };

    const label = (delay: number): LabelItem => {
        const size = Math.max(12, unit * 0.026);
        const text = random() < 0.5 ? `No.${String(input.shotNumber + 1).padStart(2, '0')}` : `#${String(input.shotNumber + 1).padStart(2, '0')} ${pick(['♪', '♡', '✦'], random)}`;
        const at = corner(3, size * 0.4);
        return {
            kind: 'label',
            x: clampX(at.x + size * 2.2, size * 3),
            y: clampY(at.y + size * 0.9, size),
            text,
            color: candyColor(),
            size,
            rotation: (random() - 0.5) * 0.2,
            at: input.enterAt + delay,
            ...exit,
        };
    };

    const stickerSize = () => unit * (0.065 + random() * 0.04);

    switch (recipe) {
        case 'scrapbook': {
            const pad = unit * 0.045;
            const card = patch(pad, unit * 0.012, pick(['grid', 'dots', 'gingham'] as const, random), -0.12);
            items.push(patch(pad * 0.6, unit * 0.04, 'plain', -0.2), card);
            const around = { x: card.x - card.width / 2, y: card.y - card.height / 2, width: card.width, height: card.height };
            const first = Math.floor(random() * 2);
            items.push(tape(first, 0.05, around), tape(first + 2, 0.12, around));
            for (let k = 0; k < countOf(1.5, amount); k += 1) {
                const at = corner((first + 1 + k * 2) % 4, unit * 0.03);
                items.push(sticker(pick(SHAPES, random), at.x, at.y, stickerSize(), 0.25 + k * 0.1));
            }
            items.push(label(0.3));
            break;
        }
        case 'strips': {
            const side: -1 | 1 = random() < 0.5 ? -1 : 1;
            // 两条不同样式的带子：一条在字上方、一条在字下方。
            const first = pick(STRIP_STYLES, random);
            items.push(strip(first, side, -0.1));
            if (amount >= 0.75) items.push(strip(pick(STRIP_STYLES.filter(style => style !== first), random), side === -1 ? 1 : -1, 0.05));
            for (let k = 0; k < countOf(2, amount); k += 1) {
                const at = corner((k * 2 + (side < 0 ? 1 : 0)) % 4, unit * 0.04);
                items.push(sticker(k % 2 === 0 ? 'sparkle' : 'star', at.x, at.y, stickerSize() * 0.85, 0.2 + k * 0.12));
            }
            break;
        }
        case 'echo': {
            const vertical = screen.width - bounds.width > unit * 0.5;
            const first = echo(vertical ? 'y' : 'x', -1, 0.3);
            const second = echo(vertical ? 'y' : 'x', 1, 0.3);
            if (first) items.push(first);
            if (second && amount >= 0.75) items.push(second);
            const at = corner(1, unit * 0.04);
            items.push(sticker('bubble', at.x, at.y, stickerSize() * 1.6, 0.3, 'front', pick(BUBBLE_LABELS, random)));
            break;
        }
        case 'window': {
            const pad = unit * 0.05;
            const bar = Math.max(16, unit * 0.04);
            const width = bounds.width + pad * 2;
            const height = bounds.height + pad * 2 + bar;
            const win: WindowItem = {
                kind: 'window',
                x: cx,
                y: cy - bar / 2,
                width,
                height,
                rotation: (random() - 0.5) * 0.05,
                bar,
                title: pick(WINDOW_TITLES, random),
                at: input.enterAt - 0.18,
                ...exit,
            };
            items.push(win);
            for (let k = 0; k < countOf(2, amount); k += 1) {
                const at = corner(k === 0 ? 0 : 2, unit * 0.035);
                items.push(sticker(pick(SHAPES, random), at.x, at.y, stickerSize(), 0.25 + k * 0.12));
            }
            break;
        }
        case 'stickerbomb': {
            const count = countOf(4, amount, 2);
            for (let k = 0; k < count; k += 1) {
                const at = corner(k % 4, unit * (0.03 + 0.03 * Math.floor(k / 4)));
                const jitter = unit * 0.03;
                items.push(sticker(pick(SHAPES, random), at.x + (random() - 0.5) * jitter, at.y + (random() - 0.5) * jitter, stickerSize(), 0.15 + k * 0.08));
            }
            const at = corner(Math.floor(random() * 4), unit * 0.09);
            items.push(sticker('bubble', at.x, at.y, stickerSize() * 1.5, 0.4, 'front', pick(BUBBLE_LABELS, random)));
            break;
        }
        case 'quiet': {
            const row = echo('x', random() < 0.5 ? -1 : 1, 0.16);
            if (row) items.push(row);
            const at = corner(Math.floor(random() * 4), unit * 0.03);
            items.push(sticker('sparkle', at.x, at.y, stickerSize() * 0.7, 0.35));
            break;
        }
        case 'opening': {
            // 歌曲开头的标题卡：一个糖果色小窗口，里面是曲名大字，下面挂艺人标签，四周贴纸；镜头结束前收起。
            const opening = input.opening!;
            const leave = { exitAt: Math.max(input.start + 1.2, input.end - 0.7), exitDuration: 0.5 };
            const titleSize = Math.min(unit * 0.11, (screen.width * 0.5) / Math.max(4, Array.from(opening.title).length * 0.62));
            const width = Math.min(screen.width * 0.72, Math.max(unit * 0.6, titleSize * Array.from(opening.title).length * 0.7 + unit * 0.2));
            const bar = Math.max(16, unit * 0.045);
            const height = titleSize * 1.9 + bar + (opening.artist ? unit * 0.06 : 0);
            const y = screen.y + screen.height * 0.42;
            const at = input.start + 0.25;
            items.push({
                kind: 'window', x: sx, y, width, height, rotation: -0.02, bar,
                title: '♪ now playing', at, ...leave,
            }, {
                kind: 'headline', x: sx, y: y + bar / 2 - (opening.artist ? unit * 0.02 : 0), text: opening.title,
                color: candyColor(), size: titleSize, rotation: -0.03, at: at + 0.18, ...leave,
            });
            if (opening.artist) {
                items.push({
                    kind: 'label', x: sx, y: y + height / 2 - unit * 0.045, text: opening.artist,
                    color: candyColor(), size: Math.max(12, unit * 0.028), rotation: 0.02, at: at + 0.4, ...leave,
                });
            }
            const card = { x: sx - width / 2, y: y - height / 2, width, height };
            [0, 1, 2, 3].forEach(k => {
                const x = k === 0 || k === 3 ? card.x : card.x + card.width;
                const cornerY = k < 2 ? card.y : card.y + card.height;
                items.push({ ...sticker(pick(['heart', 'star', 'ribbon', 'sparkle'] as const, random), x, cornerY, unit * 0.075, 0), at: at + 0.3 + k * 0.08, ...leave });
            });
            const floaters = countOf(5, amount, 2);
            for (let k = 0; k < floaters; k += 1) {
                items.push({
                    kind: 'floater',
                    shape: pick(['heart', 'star', 'sparkle'] as const, random),
                    x: screen.x + screen.width * (0.1 + random() * 0.8),
                    y: screen.y + screen.height * 1.08,
                    rise: screen.height * (1.25 + random() * 0.3),
                    size: unit * (0.045 + random() * 0.04),
                    color: candyColor(),
                    at: input.start + 0.6 + (k / floaters) * Math.max(0.5, input.end - input.start - 1.5),
                    duration: 3.4 + random() * 1.4,
                    sway: unit * (0.02 + random() * 0.03),
                });
            }
            break;
        }
        case 'bridge': {
            const film = strip('film', 1, 0);
            film.y = screen.y + screen.height * (0.62 + random() * 0.12);
            film.at = input.start + 0.1;
            items.push(film);
            const floaters = countOf(7, amount, 3);
            const span = Math.max(0.5, input.end - input.start);
            for (let k = 0; k < floaters; k += 1) {
                const at = input.start + (k / floaters) * span * 0.8 + random() * 0.3;
                items.push({
                    kind: 'floater',
                    shape: pick(['heart', 'star', 'sparkle', 'flower'] as const, random),
                    x: screen.x + screen.width * (0.08 + random() * 0.84),
                    y: screen.y + screen.height * 1.08,
                    rise: screen.height * (1.25 + random() * 0.3),
                    size: unit * (0.05 + random() * 0.05),
                    color: candyColor(),
                    at,
                    duration: 3.2 + random() * 1.6,
                    sway: unit * (0.02 + random() * 0.03),
                });
            }
            break;
        }
    }

    // 图标贴纸：主烟花开花的一瞬（间奏的连发隔一发一个，最多 5 个）。几个主题图标按镜头轮着用。
    const icons = input.icons && input.icons.length > 0 ? input.icons : [HANABI_FALLBACK_ICON];
    let iconTurn = Math.floor(random() * icons.length);
    const nextIcon = () => icons[iconTurn++ % icons.length]!;
    const mains = input.bursts.filter(burst => burst.main);
    // 开场标题卡占着画面中间，那个镜头不放。
    const popped = recipe === 'opening' ? [] : input.isBridge ? mains.filter((_, index) => index % 2 === 0).slice(0, 5) : mains.slice(0, 1);
    popped.forEach(burst => {
        if (random() > Math.min(1, 0.55 + 0.35 * amount)) return;
        const size = unit * (input.isBridge ? 0.1 : 0.115) * (0.9 + random() * 0.25);
        // 按图标弹出之后那一刻的画面算：镜头还在落下时，按定格画面算的位置可能还在画面上方。
        const view = input.screenAt?.(burst.at + 0.35) ?? screen;
        const halfWidth = size * 0.6;
        const left = view.x + railGap * 0.5 + halfWidth;
        const right = view.x + view.width - halfWidth - size * 0.3;
        const top = view.y + size * 0.8;
        const bottom = view.y + view.height * 0.8;
        // 不压字：先试字组左右两侧（靠烟花那一边优先）、齐字组上缘，再试字组正上方；都放不下才夹回画面里。
        const preferRight = input.isBridge ? burst.x > sx : burst.x >= cx;
        const beside = (dir: number) => ({ x: dir > 0 ? bounds.x + bounds.width + halfWidth + size * 0.3 : bounds.x - halfWidth - size * 0.3, y: bounds.y + size * 0.2 });
        const candidates = input.isBridge
            ? [{ x: burst.x + (preferRight ? 1 : -1) * burst.radius * 0.45, y: burst.y - burst.radius * 0.35 }]
            : [beside(preferRight ? 1 : -1), beside(preferRight ? -1 : 1), { x: cx + (random() - 0.5) * bounds.width * 0.3, y: bounds.y - size * 0.75 }];
        const fits = (p: { x: number; y: number }) => p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
        const spot = candidates.find(fits) ?? candidates[0]!;
        items.push({
            kind: 'pop',
            icon: nextIcon(),
            x: clamp(spot.x, left, Math.max(left, right)),
            y: clamp(spot.y, top, Math.max(top, bottom)),
            color: pick(ICON_INKS, random),
            size,
            rotation: (preferRight ? 1 : -1) * (0.08 + random() * 0.18),
            at: burst.at + 0.04,
            duration: 1.3,
        });
    });

    // 升空的小图标：只跟主烟花的尾迹，最多两条。
    input.launches.slice(0, 2).forEach(launch => {
        if (random() > 0.45 + 0.25 * amount) return;
        items.push({
            kind: 'whoosh',
            icon: nextIcon(),
            fromX: launch.fromX,
            fromY: launch.fromY,
            toX: launch.toX,
            toY: launch.toY,
            at: launch.at,
            duration: launch.duration,
            color: pick(ICON_INKS, random),
            size: Math.max(18, unit * 0.055),
        });
    });

    return { recipe, items };
};
