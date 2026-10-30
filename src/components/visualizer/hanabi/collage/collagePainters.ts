// Copyright (c) 2026 chthollyphile
import type { Texture } from 'pixi.js';
import { resolveLucideIconNode } from '../../../../services/lucideIconResolver';
import { lucideIconPath2d } from '../../lucidePath2d';
import type { PixiModule } from '../types';
import { CANDY, CANDY_INK, HANABI_FALLBACK_ICON, type PatchPattern, type StickerShape, type StripStyle, type TapePattern } from './collagePlan';

// src/components/visualizer/hanabi/collage/collagePainters.ts
// 拼贴件的纹理：在 Canvas 2D 上画好（带白边、硬阴影、花纹），按渲染倍率画，按 key 缓存在一个场景单元里，单元销毁时一起释放。
// 贴纸是「模切贴纸」的样子：形状 + 一圈粗白边 + 偏移的浅阴影；胶带半透明、两端锯齿；拟声字用圆体粗字。
// 装饰带是可以平铺的一节：胶片（齿孔挖空、一格格粉彩画面）、剪切线（一段虚线）、蕾丝花边（一个波浪 + 孔眼），
// 沿带子方向重复；剪切线另有一把剪刀。
// 图标贴纸：主题的 lucide 图标按 SVG 节点画进画布（Path2D 直接吃 path 的 d），一圈粗白边 + 浅阴影 + 彩色描线。
// 颜色直接画进纹理（白边、深色字不能跟着 tint 变），所以 key 里带颜色；同一首歌里重复的组合不多。

/** 装饰字用的圆体：系统里有就用，没有回落到主题字体。 */
export const POP_FONT_FAMILIES = '"M PLUS Rounded 1c", "Zen Maru Gothic", "Kosugi Maru", "Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Yu Gothic UI", "Meiryo UI", "Microsoft YaHei UI"';

type Context2D = CanvasRenderingContext2D;

const css = (color: number, alpha = 1) => `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${alpha})`;

export interface CollageTextureCache {
    sticker: (shape: StickerShape, color: number, label: string | null) => Texture;
    tape: (color: number, pattern: TapePattern) => Texture;
    /** 纸片 / 窗口的花纹小格（白色，靠 tint 上色；平铺用）。 */
    pattern: (pattern: Exclude<PatchPattern, 'plain'>) => Texture;
    /** 装饰带沿长度方向平铺的一节（纹理的高 = 带子的粗细）。 */
    strip: (style: StripStyle, color: number, thickness: number) => Texture;
    /** 剪切线的剪刀（尖朝 +x），边长约是线粗的 2.3 倍。 */
    scissors: (thickness: number) => Texture;
    /** 重复字的一个单元：空心描边字（或淡的实心字）+ 间隔。 */
    echo: (text: string, color: number, size: number, axis: 'x' | 'y') => Texture;
    /** 粗字贴纸（开场标题卡的曲名）：彩色粗字 + 粗白边 + 深色硬阴影。 */
    sound: (text: string, color: number, size: number) => Texture;
    /** 图标贴纸：lucide 图标（导出名，须已加载）+ 粗白边；边长 size。图标取不到时退回花。 */
    icon: (name: string, color: number, size: number) => Texture;
    /** 标签：圆角胶囊里一行小字。 */
    label: (text: string, color: number, size: number) => Texture;
    destroy: () => void;
}

/** 贴纸纹理的基准边长（逻辑像素）；精灵按需要的尺寸缩放。 */
export const STICKER_PX = 112;

const pathHeart = (context: Context2D, c: number, r: number) => {
    context.moveTo(c, c + r * 0.85);
    context.bezierCurveTo(c - r * 1.25, c + r * 0.05, c - r * 0.95, c - r * 0.95, c, c - r * 0.42);
    context.bezierCurveTo(c + r * 0.95, c - r * 0.95, c + r * 1.25, c + r * 0.05, c, c + r * 0.85);
};

const pathStar = (context: Context2D, c: number, r: number, points: number, inner: number, rotation = -Math.PI / 2) => {
    for (let i = 0; i < points * 2; i += 1) {
        const radius = i % 2 === 0 ? r : r * inner;
        const angle = rotation + (i * Math.PI) / points;
        const x = c + Math.cos(angle) * radius;
        const y = c + Math.sin(angle) * radius;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    }
    context.closePath();
};

const pathSparkle = (context: Context2D, c: number, r: number) => {
    const pinch = r * 0.16;
    context.moveTo(c, c - r);
    context.quadraticCurveTo(c + pinch, c - pinch, c + r, c);
    context.quadraticCurveTo(c + pinch, c + pinch, c, c + r);
    context.quadraticCurveTo(c - pinch, c + pinch, c - r, c);
    context.quadraticCurveTo(c - pinch, c - pinch, c, c - r);
    context.closePath();
};

const pathFlower = (context: Context2D, c: number, r: number) => {
    for (let i = 0; i < 5; i += 1) {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        context.moveTo(c + Math.cos(angle) * r * 0.55 + r * 0.42, c + Math.sin(angle) * r * 0.55);
        context.arc(c + Math.cos(angle) * r * 0.55, c + Math.sin(angle) * r * 0.55, r * 0.42, 0, Math.PI * 2);
    }
};

const pathCloud = (context: Context2D, c: number, r: number) => {
    const bumps: Array<[number, number, number]> = [[-0.5, 0.15, 0.38], [-0.12, -0.18, 0.48], [0.38, -0.02, 0.42], [0.62, 0.25, 0.28], [0.05, 0.3, 0.4]];
    bumps.forEach(([dx, dy, k]) => {
        context.moveTo(c + dx * r + k * r, c + dy * r);
        context.arc(c + dx * r, c + dy * r, k * r, 0, Math.PI * 2);
    });
};

const pathRibbon = (context: Context2D, c: number, r: number) => {
    // 蝴蝶结：两片圆角三角 + 中间的结。
    context.moveTo(c, c);
    context.bezierCurveTo(c - r * 0.5, c - r * 0.75, c - r * 1.05, c - r * 0.55, c - r * 0.95, c);
    context.bezierCurveTo(c - r * 1.05, c + r * 0.55, c - r * 0.5, c + r * 0.75, c, c);
    context.bezierCurveTo(c + r * 0.5, c - r * 0.75, c + r * 1.05, c - r * 0.55, c + r * 0.95, c);
    context.bezierCurveTo(c + r * 1.05, c + r * 0.55, c + r * 0.5, c + r * 0.75, c, c);
    context.moveTo(c + r * 0.24, c);
    context.arc(c, c, r * 0.24, 0, Math.PI * 2);
};

const pathCat = (context: Context2D, c: number, r: number) => {
    // 猫脸：圆脸 + 两只三角耳。
    context.moveTo(c + r * 0.78, c + r * 0.12);
    context.arc(c, c + r * 0.12, r * 0.78, 0, Math.PI * 2);
    context.moveTo(c - r * 0.72, c - r * 0.2);
    context.lineTo(c - r * 0.62, c - r * 0.95);
    context.lineTo(c - r * 0.12, c - r * 0.6);
    context.closePath();
    context.moveTo(c + r * 0.72, c - r * 0.2);
    context.lineTo(c + r * 0.62, c - r * 0.95);
    context.lineTo(c + r * 0.12, c - r * 0.6);
    context.closePath();
};

const pathBubble = (context: Context2D, c: number, r: number) => {
    const w = r * 1.0;
    const h = r * 0.72;
    const top = c - h * 0.95;
    const radius = h * 0.55;
    context.roundRect(c - w, top, w * 2, h * 1.6, radius);
    context.moveTo(c - w * 0.35, top + h * 1.55);
    context.lineTo(c - w * 0.62, top + h * 2.15);
    context.lineTo(c - w * 0.02, top + h * 1.55);
    context.closePath();
};

const SHAPE_PATHS: Record<StickerShape, (context: Context2D, c: number, r: number) => void> = {
    heart: pathHeart,
    star: (context, c, r) => pathStar(context, c, r, 5, 0.48),
    sparkle: pathSparkle,
    flower: pathFlower,
    cloud: pathCloud,
    ribbon: pathRibbon,
    cat: pathCat,
    bubble: pathBubble,
};

/** 圆体粗字的 font 串。 */
const popFont = (px: number, fallback: string) => `800 ${px}px ${POP_FONT_FAMILIES}, ${fallback}`;

export const createCollageTextureCache = (pixi: PixiModule, resolution: number, fallbackFont: string): CollageTextureCache => {
    const scale = Math.max(1, Math.min(2, resolution || 1));
    const cache = new Map<string, Texture>();
    const measureContext = document.createElement('canvas').getContext('2d')!;

    /** 按逻辑尺寸开一张画布，返回已经按倍率缩放好的 context。 */
    const canvasOf = (width: number, height: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.ceil(width * scale));
        canvas.height = Math.max(1, Math.ceil(height * scale));
        const context = canvas.getContext('2d')!;
        context.setTransform(scale, 0, 0, scale, 0, 0);
        return { canvas, context };
    };

    const finish = (key: string, canvas: HTMLCanvasElement) => {
        const source = new pixi.CanvasSource({ resource: canvas, resolution: scale });
        const texture = new pixi.Texture({ source });
        cache.set(key, texture);
        return texture;
    };

    const cached = (key: string, paint: () => HTMLCanvasElement) => cache.get(key) ?? finish(key, paint());

    const measure = (text: string, font: string) => {
        measureContext.font = font;
        return measureContext.measureText(text).width;
    };

    const sticker = (shape: StickerShape, color: number, label: string | null) => cached(`sticker:${shape}:${color}:${label ?? ''}`, () => {
        const side = STICKER_PX;
        const { canvas, context } = canvasOf(side, side);
        const c = side / 2;
        const r = side * 0.34;
        const path = SHAPE_PATHS[shape];
        context.lineJoin = 'round';
        context.lineCap = 'round';
        // 阴影：整个贴纸（含白边）往右下偏一点的半透明深色。
        context.save();
        context.translate(side * 0.035, side * 0.05);
        context.beginPath();
        path(context, c, r);
        context.lineWidth = side * 0.13;
        context.strokeStyle = 'rgba(30,16,48,0.28)';
        context.fillStyle = 'rgba(30,16,48,0.28)';
        context.stroke();
        context.fill();
        context.restore();
        // 白边：描粗边再填充。
        context.beginPath();
        path(context, c, r);
        context.lineWidth = side * 0.13;
        context.strokeStyle = '#ffffff';
        context.fillStyle = '#ffffff';
        context.stroke();
        context.fill();
        // 本体。
        context.beginPath();
        path(context, c, r);
        context.fillStyle = css(color);
        context.fill();
        // 高光：左上一小块白。
        context.save();
        context.beginPath();
        path(context, c, r);
        context.clip();
        context.fillStyle = 'rgba(255,255,255,0.4)';
        context.beginPath();
        context.ellipse(c - r * 0.35, c - r * 0.4, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2);
        context.fill();
        context.restore();
        if (shape === 'cat') {
            // 眼睛与嘴。
            context.fillStyle = css(0x2b1f3d);
            context.beginPath();
            context.arc(c - r * 0.3, c + r * 0.08, r * 0.08, 0, Math.PI * 2);
            context.arc(c + r * 0.3, c + r * 0.08, r * 0.08, 0, Math.PI * 2);
            context.fill();
            context.strokeStyle = css(0x2b1f3d);
            context.lineWidth = r * 0.07;
            context.beginPath();
            context.arc(c - r * 0.09, c + r * 0.28, r * 0.09, 0.1, Math.PI - 0.1);
            context.arc(c + r * 0.09, c + r * 0.28, r * 0.09, 0.1, Math.PI - 0.1);
            context.stroke();
            context.fillStyle = 'rgba(255,120,160,0.55)';
            context.beginPath();
            context.ellipse(c - r * 0.5, c + r * 0.3, r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
            context.ellipse(c + r * 0.5, c + r * 0.3, r * 0.12, r * 0.07, 0, 0, Math.PI * 2);
            context.fill();
        }
        if (label) {
            let px = r * 0.62;
            const font = () => popFont(px, fallbackFont);
            while (px > 8 && measure(label, font()) > r * 1.7) px -= 1;
            context.font = font();
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillStyle = css(0x2b1f3d);
            context.fillText(label, c, c - r * 0.08);
        }
        return canvas;
    });

    const tape = (color: number, pattern: TapePattern) => cached(`tape:${color}:${pattern}`, () => {
        const length = 160;
        const width = 48;
        const { canvas, context } = canvasOf(length, width);
        const tooth = 6;
        // 两端锯齿的胶带外形。
        context.beginPath();
        context.moveTo(0, 0);
        for (let y = 0; y <= width; y += tooth) context.lineTo(y % (tooth * 2) === 0 ? 0 : tooth * 0.7, y);
        context.lineTo(length, width);
        for (let y = width; y >= 0; y -= tooth) context.lineTo(y % (tooth * 2) === 0 ? length : length - tooth * 0.7, y);
        context.closePath();
        context.fillStyle = css(color, 0.78);
        context.fill();
        context.save();
        context.clip();
        if (pattern === 'stripe') {
            context.strokeStyle = 'rgba(255,255,255,0.55)';
            context.lineWidth = 7;
            for (let x = -width; x < length + width; x += 18) {
                context.beginPath();
                context.moveTo(x, width);
                context.lineTo(x + width, 0);
                context.stroke();
            }
        } else if (pattern === 'dot') {
            context.fillStyle = 'rgba(255,255,255,0.65)';
            for (let y = 8; y < width; y += 16) {
                for (let x = (y / 16) % 2 === 0 ? 8 : 16; x < length; x += 16) {
                    context.beginPath();
                    context.arc(x, y, 3.2, 0, Math.PI * 2);
                    context.fill();
                }
            }
        } else {
            context.fillStyle = 'rgba(255,255,255,0.38)';
            for (let y = 0; y < width; y += 12) {
                for (let x = (y / 12) % 2 === 0 ? 0 : 12; x < length; x += 24) context.fillRect(x, y, 12, 12);
            }
        }
        context.restore();
        return canvas;
    });

    const pattern = (kind: Exclude<PatchPattern, 'plain'>) => cached(`pattern:${kind}`, () => {
        const tile = 24;
        const { canvas, context } = canvasOf(tile, tile);
        context.fillStyle = '#ffffff';
        context.strokeStyle = '#ffffff';
        if (kind === 'grid') {
            context.lineWidth = 1.2;
            context.beginPath();
            context.moveTo(0, 0.6);
            context.lineTo(tile, 0.6);
            context.moveTo(0.6, 0);
            context.lineTo(0.6, tile);
            context.stroke();
        } else if (kind === 'dots') {
            context.beginPath();
            context.arc(tile / 4, tile / 4, 2.4, 0, Math.PI * 2);
            context.arc((tile * 3) / 4, (tile * 3) / 4, 2.4, 0, Math.PI * 2);
            context.fill();
        } else {
            context.globalAlpha = 0.55;
            context.fillRect(0, 0, tile / 2, tile);
            context.fillRect(0, 0, tile, tile / 2);
        }
        return canvas;
    });

    /** 胶片：深色片基，上下两排齿孔挖空透出后面，中间三格画面（三种粉彩，各有一个白色小图案）。 */
    const paintFilm = (color: number, height: number) => {
        const frame = height * 1.18;
        const width = Math.round(frame * 3);
        const { canvas, context } = canvasOf(width, height);
        context.fillStyle = css(CANDY_INK, 0.92);
        context.fillRect(0, 0, width, height);
        // 齿孔：每格四个，圆角小方孔，挖空（destination-out）。
        const pitch = frame / 4;
        const holeW = pitch * 0.48;
        const holeH = height * 0.11;
        context.save();
        context.globalCompositeOperation = 'destination-out';
        for (let k = 0; k < 12; k += 1) {
            const x = k * pitch + (pitch - holeW) / 2;
            [height * 0.07, height * 0.93 - holeH].forEach(y => {
                context.beginPath();
                context.roundRect(x, y, holeW, holeH, holeH * 0.3);
                context.fill();
            });
        }
        context.restore();
        // 画面格：主色与两种糖果色轮着，左上一道浅色高光，中间一个白色小图案。
        const base = Math.max(0, (CANDY as readonly number[]).indexOf(color));
        const colors = [color, CANDY[(base + 2) % CANDY.length]!, CANDY[(base + 4) % CANDY.length]!];
        const icons: StickerShape[] = ['heart', 'star', 'sparkle'];
        for (let k = 0; k < 3; k += 1) {
            const x = k * frame + frame * 0.07;
            const y = height * 0.25;
            const w = frame * 0.86;
            const h = height * 0.5;
            context.fillStyle = css(colors[k]!, 0.92);
            context.beginPath();
            context.roundRect(x, y, w, h, h * 0.12);
            context.fill();
            context.fillStyle = 'rgba(255,255,255,0.28)';
            context.beginPath();
            context.roundRect(x + w * 0.06, y + h * 0.1, w * 0.4, h * 0.16, h * 0.08);
            context.fill();
            context.fillStyle = 'rgba(255,255,255,0.9)';
            context.save();
            context.beginPath();
            context.translate(x + w / 2, y + h / 2);
            SHAPE_PATHS[icons[k]!](context, 0, h * 0.24);
            context.fill();
            context.restore();
        }
        return canvas;
    };

    /** 剪切线：一段虚线（圆头）+ 底下一道浅阴影，线上下留白给剪刀。 */
    const paintCut = (color: number, height: number) => {
        const period = Math.max(10, height * 0.9);
        const { canvas, context } = canvasOf(period, height);
        const line = Math.max(2, height * 0.11);
        const dash = period * 0.55;
        context.lineCap = 'round';
        context.lineWidth = line;
        context.strokeStyle = 'rgba(30,16,48,0.35)';
        context.beginPath();
        context.moveTo(line, height / 2 + line * 0.6);
        context.lineTo(line + dash - line, height / 2 + line * 0.6);
        context.stroke();
        context.strokeStyle = css(color);
        context.beginPath();
        context.moveTo(line, height / 2);
        context.lineTo(line + dash - line, height / 2);
        context.stroke();
        return canvas;
    };

    /**
     * 蕾丝花边：白色蕾丝带身，上下两排细密的小波浪边（每个波浪里镂一个小孔），带身靠边各一排孔眼，
     * 中间穿一条糖果色缎带（带一道高光）。一节两个波浪。
     */
    const paintLace = (color: number, height: number) => {
        const scallop = Math.max(3, height * 0.21);
        const width = scallop * 4;
        const { canvas, context } = canvasOf(width, height);
        const top = height * 0.25;
        const bottom = height * 0.75;
        const centers = [scallop, scallop * 3];
        const shape = (dy: number) => {
            context.beginPath();
            context.rect(0, top + dy, width, bottom - top);
            centers.forEach(cx => {
                context.moveTo(cx + scallop, top + dy);
                context.arc(cx, top + dy, scallop, 0, Math.PI, true);
                context.moveTo(cx - scallop, bottom + dy);
                context.arc(cx, bottom + dy, scallop, Math.PI, 0, true);
            });
        };
        context.fillStyle = 'rgba(30,16,48,0.22)';
        shape(height * 0.05);
        context.fill();
        context.fillStyle = 'rgba(255,255,255,0.96)';
        shape(0);
        context.fill();
        // 镂空：波浪里的小孔、带身边上的孔眼（透出后面）。
        context.save();
        context.globalCompositeOperation = 'destination-out';
        centers.forEach(cx => {
            [[top - scallop * 0.45, scallop * 0.3], [bottom + scallop * 0.45, scallop * 0.3], [top + height * 0.075, height * 0.035], [bottom - height * 0.075, height * 0.035]]
                .forEach(([y, radius]) => {
                    context.beginPath();
                    context.arc(cx, y!, Math.max(0.8, radius!), 0, Math.PI * 2);
                    context.fill();
                });
        });
        context.restore();
        // 缎带。
        const ribbonTop = height * 0.4;
        const ribbonHeight = height * 0.2;
        context.fillStyle = css(color);
        context.fillRect(0, ribbonTop, width, ribbonHeight);
        context.fillStyle = 'rgba(255,255,255,0.45)';
        context.fillRect(0, ribbonTop + ribbonHeight * 0.18, width, Math.max(1, ribbonHeight * 0.16));
        context.fillStyle = 'rgba(43,31,61,0.16)';
        context.fillRect(0, ribbonTop + ribbonHeight * 0.86, width, Math.max(1, ribbonHeight * 0.14));
        return canvas;
    };

    const strip = (style: StripStyle, color: number, thickness: number) => {
        const height = Math.max(10, Math.round(thickness));
        return cached(`strip:${style}:${color}:${height}`, () => (
            style === 'film' ? paintFilm(color, height) : style === 'cut' ? paintCut(color, height) : paintLace(color, height)
        ));
    };

    /** 剪刀：两个指环 + 两片在轴心交叉的刀刃，白身深色描边（像贴纸），尖朝 +x。 */
    const scissors = (thickness: number) => {
        const side = Math.max(20, Math.round(thickness * 2.3));
        return cached(`scissors:${side}`, () => {
            const { canvas, context } = canvasOf(side, side);
            const c = side / 2;
            const ring = side * 0.15;
            context.lineJoin = 'round';
            context.lineCap = 'round';
            const outline = (path: () => void, fill: string) => {
                context.beginPath();
                path();
                context.lineWidth = side * 0.09;
                context.strokeStyle = css(CANDY_INK);
                context.stroke();
                context.fillStyle = fill;
                context.fill();
            };
            // 两片刀刃：从轴心往右上 / 右下伸出的细长尖叶。
            [-1, 1].forEach(dir => outline(() => {
                context.moveTo(c - side * 0.12, c + dir * side * 0.1);
                context.quadraticCurveTo(c + side * 0.15, c - dir * side * 0.02, c + side * 0.46, c - dir * side * 0.06);
                context.quadraticCurveTo(c + side * 0.12, c + dir * side * 0.08, c - side * 0.12, c + dir * side * 0.16);
                context.closePath();
            }, '#ffffff'));
            // 两个指环（粉色）。
            [-1, 1].forEach(dir => {
                context.beginPath();
                context.arc(c - side * 0.28, c + dir * side * 0.2, ring, 0, Math.PI * 2);
                context.lineWidth = side * 0.1;
                context.strokeStyle = css(CANDY_INK);
                context.stroke();
                context.lineWidth = side * 0.06;
                context.strokeStyle = css(CANDY[0]);
                context.stroke();
            });
            // 轴钉。
            context.beginPath();
            context.arc(c - side * 0.06, c, side * 0.04, 0, Math.PI * 2);
            context.fillStyle = css(CANDY_INK);
            context.fill();
            return canvas;
        });
    };

    const echo = (text: string, color: number, size: number, axis: 'x' | 'y') => {
        const px = Math.max(10, Math.round(size));
        return cached(`echo:${text}:${color}:${px}:${axis}`, () => {
            const font = popFont(px, fallbackFont);
            const textWidth = measure(text, font);
            const gapX = axis === 'x' ? px * 0.6 : px * 0.2;
            const width = Math.ceil(textWidth + gapX * 2);
            const height = Math.ceil(px * (axis === 'x' ? 1.25 : 1.3));
            const { canvas, context } = canvasOf(width, height);
            context.font = font;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.lineJoin = 'round';
            context.lineWidth = Math.max(1.5, px * 0.045);
            context.strokeStyle = css(color);
            context.strokeText(text, width / 2, height * 0.52);
            return canvas;
        });
    };

    const icon = (name: string, color: number, size: number) => {
        const node = resolveLucideIconNode(name) ?? resolveLucideIconNode(HANABI_FALLBACK_ICON);
        const side = Math.max(16, Math.round(size));
        return cached(`icon:${node ? name : '-'}:${color}:${side}`, () => {
            const { canvas, context } = canvasOf(side, side);
            // 24 单位的图标放进边长 side、四周留出白边与阴影的余量。
            const pad = side * 0.16;
            const scale = (side - pad * 2) / 24;
            context.translate(pad, pad);
            context.scale(scale, scale);
            context.lineJoin = 'round';
            context.lineCap = 'round';
            const path = node ? lucideIconPath2d(node) : null;
            const draw = (stroke: string, width: number, dx = 0, dy = 0) => {
                context.save();
                context.translate(dx, dy);
                context.strokeStyle = stroke;
                context.lineWidth = width;
                if (path) context.stroke(path);
                else {
                    // lucide 没加载上：画一朵五瓣小花（与贴纸的花同形）。
                    context.beginPath();
                    SHAPE_PATHS.flower(context, 12, 8);
                    context.stroke();
                }
                context.restore();
            };
            draw('rgba(30,16,48,0.3)', 7.2, 0.7, 1);
            draw('#ffffff', 7.2);
            draw(css(color), 2.8);
            return canvas;
        });
    };

    const sound = (text: string, color: number, size: number) => {
        const px = Math.max(12, Math.round(size));
        return cached(`sound:${text}:${color}:${px}`, () => {
            const font = popFont(px, fallbackFont);
            const stroke = px * 0.2;
            const shadow = px * 0.09;
            const width = Math.ceil(measure(text, font) + stroke * 2 + shadow + px * 0.2);
            const height = Math.ceil(px * 1.35 + stroke * 2 + shadow);
            const { canvas, context } = canvasOf(width, height);
            const x = width / 2 - shadow / 2;
            const y = height / 2 - shadow / 2;
            context.font = font;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.lineJoin = 'round';
            // 硬阴影 → 白边 → 彩色字 → 字里一道浅色高光边。
            context.lineWidth = stroke * 2;
            context.strokeStyle = 'rgba(43,31,61,0.9)';
            context.strokeText(text, x + shadow, y + shadow);
            context.strokeStyle = '#ffffff';
            context.strokeText(text, x, y);
            context.fillStyle = css(color);
            context.fillText(text, x, y);
            context.lineWidth = Math.max(1, px * 0.04);
            context.strokeStyle = 'rgba(43,31,61,0.85)';
            context.strokeText(text, x, y);
            return canvas;
        });
    };

    const label = (text: string, color: number, size: number) => {
        const px = Math.max(10, Math.round(size));
        return cached(`label:${text}:${color}:${px}`, () => {
            const font = popFont(px, fallbackFont);
            const padX = px * 0.7;
            const height = Math.ceil(px * 1.7);
            const width = Math.ceil(measure(text, font) + padX * 2);
            const { canvas, context } = canvasOf(width + 4, height + 4);
            context.fillStyle = 'rgba(43,31,61,0.85)';
            context.beginPath();
            context.roundRect(3, 3, width, height, height / 2);
            context.fill();
            context.fillStyle = '#ffffff';
            context.beginPath();
            context.roundRect(0, 0, width, height, height / 2);
            context.fill();
            context.fillStyle = css(color);
            context.beginPath();
            context.roundRect(2, 2, width - 4, height - 4, (height - 4) / 2);
            context.fill();
            context.font = font;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillStyle = css(0x2b1f3d);
            context.fillText(text, width / 2, height * 0.54);
            return canvas;
        });
    };

    return {
        sticker,
        tape,
        pattern,
        strip,
        scissors,
        echo,
        sound,
        icon,
        label,
        destroy: () => {
            cache.forEach(texture => texture.destroy(true));
            cache.clear();
        },
    };
};
