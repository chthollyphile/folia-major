// Copyright (c) 2026 chthollyphile
import type { Texture } from 'pixi.js';
import { resolveHanabiBaseResolution } from '../hanabiTuning';
import type { PixiModule } from '../types';

// src/components/visualizer/hanabi/text/glyphs.ts
// 字形纹理：一行用到的字各画一格进同一张 Canvas 2D 图集（白字，着色靠 tint），可选描边胖字、光晕字、半字切片与乱码字表。
// 按 renderResolution 画，图集超过 GPU 纹理上限时整体降分辨率；测量函数可注入（单测在 node 里没有 canvas）。

/** 量一个字的宽度（字号的倍数）。 */
export type GlyphMeasure = (char: string) => number;

const UPRIGHT = /[ᄀ-ᇿ⺀-⿿　-〿぀-ヿ㄀-ㇿ㈀-鿿가-힯豈-﫿︰-﹏＀-￯]|[\u{20000}-\u{3134f}]/u;

/** 竖排时直立（中日韩字、全角符号）；否则侧转 90°（拉丁字母、数字）。 */
export const isUprightGlyph = (char: string) => UPRIGHT.test(char);

/** 是否含中日韩字（乱码字表选片假名还是拉丁字母）。 */
export const hasCjk = (text: string) => UPRIGHT.test(text);

export const glyphFont = (weight: number, px: number, family: string) => `${weight} ${px}px ${family}`;

/** 没有 canvas 时的估算：全角 1、空格 0.3、半角 0.6。 */
export const estimateAdvance: GlyphMeasure = char => {
    if (char.trim().length === 0) return 0.3;
    if (isUprightGlyph(char)) return 1;
    if (/[ilI.,:;'!|]/.test(char)) return 0.34;
    if (/[mwMW@]/.test(char)) return 0.85;
    return 0.6;
};

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const createContext = (): Context2D | null => {
    try {
        if (typeof OffscreenCanvas !== 'undefined') {
            const context = new OffscreenCanvas(8, 8).getContext('2d');
            if (context) return context as OffscreenCanvasRenderingContext2D;
        }
        if (typeof document !== 'undefined') return document.createElement('canvas').getContext('2d');
    } catch {
        // 没有 canvas 的环境走估算。
    }
    return null;
};

/** 按字体量字宽（带缓存）；环境里没有 canvas 时退回估算。 */
export const createGlyphMeasure = (font: string, weight: number): GlyphMeasure => {
    const context = createContext();
    const cache = new Map<string, number>();
    if (context) context.font = glyphFont(weight, 100, font);
    return char => {
        let width = cache.get(char);
        if (width === undefined) {
            width = context ? context.measureText(char).width / 100 : estimateAdvance(char);
            if (!Number.isFinite(width) || width <= 0) width = estimateAdvance(char);
            cache.set(char, width);
        }
        return width;
    };
};

export interface GlyphEntry {
    char: string;
    /** 纹理里画字用的字号（逻辑像素）：精灵缩放 = 显示字号 / px。 */
    px: number;
    fill: Texture;
    /** 描边胖字（描边 + 填充），描边层与描边字的硬阴影用。 */
    fat: Texture | null;
    /** 柔边光晕字（glow 强调）。 */
    glow: Texture | null;
    /** 两半字：lr = 左 / 右（锚点分别在右缘 / 左缘中点），tb = 上 / 下。 */
    halves: [Texture, Texture] | null;
}

export interface GlyphAtlasOptions {
    font: string;
    weight: number;
    resolution: number;
    /** 每个字与它要画的字号（逻辑像素，取这个字出现过的最大显示字号）。 */
    chars: ReadonlyMap<string, number>;
    /** 乱码字表（scramble）：这些字按 px 画。 */
    scramble?: { chars: readonly string[]; px: number } | null;
    /** 描边宽度（字号的倍数）；0 = 不画胖字。 */
    outline: number;
    glow: boolean;
    halves: 'lr' | 'tb' | null;
    /** 图集位图边长上限（物理像素）；不给时按 resolveGlyphAtlasLimit。 */
    maxCanvasPx?: number;
}

export interface GlyphAtlas {
    entry: (char: string) => GlyphEntry;
    scramble: GlyphEntry[];
    /**
     * 把字画进图集（描边、光晕的 shadowBlur 都在这里，是建字最贵的一步）；只画一次，这次真的画了返回 true。
     * 纹理与帧在建图集时就有了，画之前是透明的：镜头快出场时再画，建场景那一帧不用把整段的字都光栅化。
     */
    paint?: () => boolean;
    destroy: () => void;
}

export type BuildGlyphAtlas = (pixi: PixiModule, options: GlyphAtlasOptions) => GlyphAtlas;

type Variant = 'fill' | 'fat' | 'glow';

interface Cell {
    char: string;
    px: number;
    variant: Variant;
    side: number;
    x: number;
    y: number;
    scramble: boolean;
}

/**
 * 图集位图边长的基础上限（物理像素，和原来一样）：用户选的分辨率倍数大于 1（超采样）时按倍数放大，字才真的按那个密度画（#929）；
 * 屏幕本身的密度不放大它，倍数为 1 时和原来完全一样。
 */
const ATLAS_BASE_LIMIT_PX = 4096;
/** 图集位图边长的硬上限（物理像素）：8192² 的 RGBA 已是 256 MB，再大一张就吃掉太多内存与显存。 */
const ATLAS_HARD_LIMIT_PX = 8192;
/** GPU 单张纹理的边长上限：运行时建好上下文后报上来；报之前（以及单测里）按 WebGL 几乎都满足的 4096 算。 */
let gpuTextureLimitPx = 4096;

/** 运行时建好 WebGL 上下文后报 MAX_TEXTURE_SIZE（各运行时同一块 GPU，报的值一样）。 */
export const setHanabiGlyphTextureLimit = (px: number) => {
    if (Number.isFinite(px) && px >= 2048) gpuTextureLimitPx = Math.floor(px);
};

/**
 * 图集位图边长上限（物理像素）：基础上限 × 超采样倍数（渲染倍率 ÷ 花火自己的像素密度，不小于 1），再和 GPU 纹理上限、
 * 硬上限取小；给了 maxCanvasPx 就用它。
 */
export const resolveGlyphAtlasLimit = (resolution: number, maxCanvasPx?: number, devicePixelRatio = globalThis.devicePixelRatio ?? 1) => {
    if (maxCanvasPx !== undefined) return maxCanvasPx;
    const superscale = Math.max(1, resolution / resolveHanabiBaseResolution(devicePixelRatio));
    return Math.min(ATLAS_BASE_LIMIT_PX * superscale, Math.max(ATLAS_BASE_LIMIT_PX, gpuTextureLimitPx), ATLAS_HARD_LIMIT_PX);
};

/** 一格的边长（逻辑像素）：字框 1.3 倍 + 描边 / 光晕的外扩。 */
const cellSide = (px: number, outline: number, glow: boolean) =>
    Math.ceil(px * 1.3 + 2 * Math.max(outline * px, glow ? px * 0.32 : 0) + 4);

export const buildGlyphAtlas: BuildGlyphAtlas = (pixi, options) => {
    const variants: Variant[] = ['fill'];
    if (options.outline > 0) variants.push('fat');
    if (options.glow) variants.push('glow');
    const cells: Cell[] = [];
    const add = (char: string, px: number, scramble: boolean) => {
        const side = cellSide(px, options.outline, options.glow);
        const kinds: Variant[] = scramble ? variants.filter(v => v !== 'glow') : variants;
        kinds.forEach(variant => cells.push({ char, px, variant, side, x: 0, y: 0, scramble }));
    };
    options.chars.forEach((px, char) => {
        if (char.trim().length > 0) add(char, Math.max(4, px), false);
    });
    options.scramble?.chars.forEach(char => add(char, Math.max(4, options.scramble!.px), true));

    // 按行装箱（高的在前）。
    const gap = 2;
    const area = cells.reduce((sum, cell) => sum + (cell.side + gap) ** 2, 0);
    const maxSide = cells.reduce((max, cell) => Math.max(max, cell.side), 1);
    const shelfWidth = Math.max(maxSide + gap, Math.ceil(Math.sqrt(area) * 1.15));
    const order = cells.map((_, index) => index).sort((a, b) => cells[b]!.side - cells[a]!.side);
    let x = 0;
    let y = 0;
    let shelf = 0;
    let width = 1;
    order.forEach(index => {
        const cell = cells[index]!;
        if (x + cell.side > shelfWidth && x > 0) {
            x = 0;
            y += shelf + gap;
            shelf = 0;
        }
        cell.x = x;
        cell.y = y;
        x += cell.side + gap;
        shelf = Math.max(shelf, cell.side);
        width = Math.max(width, x);
    });
    const height = Math.max(1, y + shelf);
    // 上限按物理像素：位图边长 = 逻辑边长 × resolution，不超过它。
    const limit = resolveGlyphAtlasLimit(options.resolution, options.maxCanvasPx);
    const resolution = Math.max(0.1, Math.min(options.resolution, limit / width, limit / height));

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width * resolution));
    canvas.height = Math.max(1, Math.ceil(height * resolution));
    const source = new pixi.CanvasSource({ resource: canvas, resolution });
    let painted = false;
    const paint = () => {
        if (painted) return false;
        painted = true;
        const context = canvas.getContext('2d')!;
        context.setTransform(resolution, 0, 0, resolution, 0, 0);
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillStyle = '#ffffff';
        context.strokeStyle = '#ffffff';
        context.lineJoin = 'round';
        cells.forEach(cell => {
            context.font = glyphFont(options.weight, cell.px, options.font);
            const cx = cell.x + cell.side / 2;
            const cy = cell.y + cell.side / 2;
            if (cell.variant === 'fat') {
                context.lineWidth = options.outline * cell.px * 2;
                context.strokeText(cell.char, cx, cy);
                context.fillText(cell.char, cx, cy);
            } else if (cell.variant === 'glow') {
                context.save();
                context.shadowColor = '#ffffff';
                // shadowBlur 不受变换缩放，要自己乘分辨率。
                context.shadowBlur = cell.px * 0.22 * resolution;
                context.globalAlpha = 0.85;
                context.fillText(cell.char, cx, cy);
                context.fillText(cell.char, cx, cy);
                context.restore();
            } else {
                context.fillText(cell.char, cx, cy);
            }
        });
        // 画之前若已经上传过（透明的），这里让它下一帧重新上传。
        source.update();
        return true;
    };

    const textures: Texture[] = [];
    const sub = (fx: number, fy: number, fw: number, fh: number) => {
        const texture = new pixi.Texture({ source, frame: new pixi.Rectangle(fx, fy, fw, fh) });
        textures.push(texture);
        return texture;
    };
    const entries = new Map<string, GlyphEntry>();
    const scrambleEntries = new Map<string, GlyphEntry>();
    cells.forEach(cell => {
        const map = cell.scramble ? scrambleEntries : entries;
        let entry = map.get(cell.char);
        if (!entry) {
            entry = { char: cell.char, px: cell.px, fill: null as unknown as Texture, fat: null, glow: null, halves: null };
            map.set(cell.char, entry);
        }
        const texture = sub(cell.x, cell.y, cell.side, cell.side);
        if (cell.variant === 'fill') {
            entry.fill = texture;
            if (options.halves && !cell.scramble) {
                const half = cell.side / 2;
                entry.halves = options.halves === 'lr'
                    ? [sub(cell.x, cell.y, half, cell.side), sub(cell.x + half, cell.y, half, cell.side)]
                    : [sub(cell.x, cell.y, cell.side, half), sub(cell.x, cell.y + half, cell.side, half)];
            }
        } else if (cell.variant === 'fat') entry.fat = texture;
        else entry.glow = texture;
    });
    const blank: GlyphEntry = { char: ' ', px: 1, fill: pixi.Texture.EMPTY, fat: null, glow: null, halves: null };
    return {
        entry: char => entries.get(char) ?? blank,
        scramble: options.scramble?.chars.map(char => scrambleEntries.get(char)!).filter(Boolean) ?? [],
        paint,
        destroy: () => {
            textures.forEach(texture => texture.destroy(false));
            source.destroy();
        },
    };
};

const SCRAMBLE_KANA = Array.from('アイウエオカキクケコサシスセソタチツテトナニヌネハヒフヘホマミムメモヤユヨラリルレロワヲン＃％＆＊？！◆※');
const SCRAMBLE_LATIN = Array.from('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*?!<>/+=');

/** 乱码字表：中日文的行用片假名与符号，拉丁字母的行用字母数字与符号；按随机数取 count 个。 */
export const pickScrambleChars = (text: string, count: number, random: () => number): string[] => {
    const pool = [...(hasCjk(text) ? SCRAMBLE_KANA : SCRAMBLE_LATIN)];
    const picked: string[] = [];
    while (picked.length < count && pool.length > 0) {
        picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
    }
    return picked;
};
