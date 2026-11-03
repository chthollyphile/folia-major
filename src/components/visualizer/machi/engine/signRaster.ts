import { resolveLucideIconNode } from '../../../../services/lucideIconResolver';
import { lucideIconPath2d } from '../../lucidePath2d';
import type { WordColorRange } from '../../wordColoring';
import type { MachiBoardLayout, MachiMeasure } from './boardLayout';

// src/components/visualizer/machi/engine/signRaster.ts
// 町景招牌的共用 Canvas 2D 画法：字体与测量、主题图标（线稿）、缩字与折行、歌词屏字面（上半张未唱、下半张已唱，
// 关键词用自己的颜色）、LED 跑马灯的字条。各场景自己的招牌画法在场景目录里（便利店是 konbiniSignPaint.ts）。
// 字体栈与字重由调用方按主题给（resolveThemeFontStack / resolveThemeFontWeight），测量与绘制用同一个字体。
// 图标先加载好再画（loadLucideIcons）。

export interface MachiFont {
    stack: string;
    weight: number;
}

/** 量字用的参考字号。 */
export const MACHI_REFERENCE_PX = 100;

export const fontSpec = (font: MachiFont, px: number) => `${font.weight} ${px.toFixed(1)}px ${font.stack}`;

let measureContext: CanvasRenderingContext2D | null = null;

/** 按参考字号量字宽（缓存在这一个字体上）。 */
export const createMachiMeasure = (font: MachiFont): MachiMeasure => {
    if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
    const cache = new Map<string, number>();
    const spec = fontSpec(font, MACHI_REFERENCE_PX);
    return (text: string) => {
        if (!text) return 0;
        let width = cache.get(text);
        if (width === undefined) {
            measureContext!.font = spec;
            width = measureContext!.measureText(text).width;
            if (cache.size > 4000) cache.clear();
            cache.set(text, width);
        }
        return width;
    };
};

export const createCanvas = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

export const context2d = (canvas: HTMLCanvasElement) => canvas.getContext('2d')!;

/** 一个主题图标，画成线稿（stroke），放在 (x, y) 起、边长 size 的方框里。 */
export const drawIcon = (
    context: CanvasRenderingContext2D,
    name: string | undefined,
    fallbacks: readonly string[],
    x: number,
    y: number,
    size: number,
    color: string,
    lineWidth = 2.2,
) => {
    const node = [name, ...fallbacks].map(candidate => (candidate ? resolveLucideIconNode(candidate) : null)).find(Boolean);
    context.save();
    context.translate(x, y);
    context.scale(size / 24, size / 24);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    if (node) context.stroke(lucideIconPath2d(node));
    else {
        context.beginPath();
        context.arc(12, 12, 8, 0, Math.PI * 2);
        context.stroke();
    }
    context.restore();
};

/** 霓虹灯管写字（描边）：外面一圈光晕（同色），里面一道近白的芯。 */
export const strokeNeonText = (context: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, glow: number) => {
    context.shadowColor = color;
    context.shadowBlur = glow;
    context.strokeStyle = color;
    context.lineWidth = glow * 0.45;
    context.strokeText(text, x, y);
    context.shadowBlur = glow * 0.4;
    context.strokeStyle = '#ffffff';
    context.lineWidth = glow * 0.14;
    context.strokeText(text, x, y);
    context.shadowBlur = 0;
};

/** 把一段字缩到 maxWidth 以内的字号。 */
export const fitFont = (context: CanvasRenderingContext2D, font: MachiFont, text: string, maxWidth: number, maxPx: number, minPx = 8) => {
    let px = maxPx;
    context.font = fontSpec(font, px);
    const width = context.measureText(text).width;
    if (width > maxWidth) px = Math.max(minPx, (px * maxWidth) / width);
    context.font = fontSpec(font, px);
    return px;
};

/** 按宽度折行（中日韩逐字，拉丁按词），最多 maxLines 行，超出的末行加省略号。 */
export const wrapText = (context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) => {
    const units = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+\s*|\s+/gu) ?? [];
    const lines: string[] = [];
    let current = '';
    units.forEach(unit => {
        const next = current + unit;
        if (current && context.measureText(next.trimEnd()).width > maxWidth) {
            lines.push(current.trimEnd());
            current = unit.trimStart();
        } else current = next;
    });
    if (current.trim()) lines.push(current.trimEnd());
    if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines);
        let last = kept[maxLines - 1]!;
        while (last.length > 1 && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
        kept[maxLines - 1] = `${last}…`;
        return kept;
    }
    return lines;
};

export interface MachiBoardPaint {
    layout: MachiBoardLayout;
    font: MachiFont;
    unlit: string;
    lit: string;
    /** 关键词着色的字符范围（按 fullText 的 UTF-16 下标）。 */
    keywordRanges: readonly WordColorRange[];
    /** 曲名卡：第一行用 lit 色，第二行用 unlit 色，整面都“亮着”。 */
    card?: boolean;
}

/** 广告屏字面：canvas 上半张是未唱的字，下半张是唱到的字（着色器按点亮位置在两者之间切）。 */
export const paintMachiBoard = (canvas: HTMLCanvasElement, paint: MachiBoardPaint) => {
    const context = context2d(canvas);
    const half = canvas.height / 2;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    const { layout, font } = paint;
    const scaleY = half / layout.height;
    const scaleX = canvas.width / layout.width;
    layout.rows.forEach((row, rowIndex) => {
        const px = row.fontPx;
        context.font = fontSpec(font, px * scaleX);
        row.glyphs.forEach(glyph => {
            const x = glyph.x0 * scaleX;
            const y = row.centerY * scaleY;
            const keyword = paint.keywordRanges.find(range => glyph.offset >= range.startOffset && glyph.offset < range.endOffset);
            // 上半：未唱。
            context.fillStyle = paint.card && rowIndex === 0 ? paint.lit : paint.unlit;
            context.fillText(glyph.text, x, y);
            // 下半：唱到的字。屏幕上的字是干净的像素，不画光晕（光晕会糊字，也会被 bloom 再放大一圈）。
            const color = paint.card ? (rowIndex === 0 ? paint.lit : paint.unlit) : (keyword?.color ?? paint.lit);
            context.fillStyle = color;
            context.fillText(glyph.text, x, y + half);
        });
    });
};

/** LED 跑马灯的字条：黑底白字一长条，着色器按点阵采样、着 LED 色、横向滚动。返回字条的实际宽度（像素）。 */
export const paintMachiLedStrip = (canvas: HTMLCanvasElement, font: MachiFont, text: string) => {
    const context = context2d(canvas);
    const { width, height } = canvas;
    context.fillStyle = '#000000';
    context.fillRect(0, 0, width, height);
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    context.fillStyle = '#ffffff';
    const px = fitFont(context, font, text, width * 0.94, height * 0.78, height * 0.4);
    context.font = fontSpec(font, px);
    // 字条按自己的宽度循环：末尾留一段空白再接开头。
    const used = Math.min(width, context.measureText(text).width + height * 3);
    context.fillText(text, height * 1.5, height * 0.54);
    return used;
};
