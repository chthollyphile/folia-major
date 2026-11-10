// Copyright (c) 2026 chthollyphile
import type { Texture } from 'pixi.js';
import type { CreateHanabiTextures } from '../types';

// src/components/visualizer/hanabi/mg/textures.ts
// 整个单元共享的粒子纹理：画在 Canvas 2D 上、白色（着色靠 tint），按渲染倍率画，导出不糊。适配器持有，destroy 时释放。

const canvasOf = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return { canvas, context: canvas.getContext('2d')! };
};

const WHITE = (alpha: number) => `rgba(255,255,255,${alpha})`;

/** 实心小圆：边缘留一像素的软边抗锯齿。 */
const drawDot = (size: number) => {
    const { canvas, context } = canvasOf(size, size);
    const r = size / 2;
    const gradient = context.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, WHITE(1));
    gradient.addColorStop(Math.max(0, 1 - 2 / r), WHITE(1));
    gradient.addColorStop(1, WHITE(0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    return canvas;
};

/** 柔边光点：很亮的小芯 + 迅速衰减的光晕（星头、闪光、烟雾都用它）。 */
const drawGlow = (size: number) => {
    const { canvas, context } = canvasOf(size, size);
    const r = size / 2;
    const gradient = context.createRadialGradient(r, r, 0, r, r, r);
    gradient.addColorStop(0, WHITE(1));
    gradient.addColorStop(0.1, WHITE(0.95));
    gradient.addColorStop(0.22, WHITE(0.55));
    gradient.addColorStop(0.42, WHITE(0.18));
    gradient.addColorStop(0.7, WHITE(0.05));
    gradient.addColorStop(1, WHITE(0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    return canvas;
};

/** 四角星：四条内凹的尖芒（MG 的干净几何）+ 小小的柔光芯。 */
const drawStar4 = (size: number) => {
    const { canvas, context } = canvasOf(size, size);
    const c = size / 2;
    const r = size * 0.48;
    const halo = context.createRadialGradient(c, c, 0, c, c, r * 0.5);
    halo.addColorStop(0, WHITE(0.9));
    halo.addColorStop(1, WHITE(0));
    context.fillStyle = halo;
    context.fillRect(0, 0, size, size);
    const pinch = r * 0.1;
    context.fillStyle = WHITE(1);
    context.beginPath();
    context.moveTo(c, c - r);
    context.quadraticCurveTo(c + pinch, c - pinch, c + r, c);
    context.quadraticCurveTo(c + pinch, c + pinch, c, c + r);
    context.quadraticCurveTo(c - pinch, c + pinch, c - r, c);
    context.quadraticCurveTo(c - pinch, c - pinch, c, c - r);
    context.closePath();
    context.fill();
    return canvas;
};

/** 纵向拖尾：上亮下暗（不到零，接成一串时不起珠子），横向软边。 */
const drawStreak = (width: number, height: number) => {
    const { canvas, context } = canvasOf(width, height);
    const vertical = context.createLinearGradient(0, 0, 0, height);
    vertical.addColorStop(0, WHITE(1));
    vertical.addColorStop(0.6, WHITE(0.6));
    vertical.addColorStop(1, WHITE(0.28));
    context.fillStyle = vertical;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'destination-in';
    const horizontal = context.createLinearGradient(0, 0, width, 0);
    horizontal.addColorStop(0, WHITE(0));
    horizontal.addColorStop(0.3, WHITE(0.85));
    horizontal.addColorStop(0.5, WHITE(1));
    horizontal.addColorStop(0.7, WHITE(0.85));
    horizontal.addColorStop(1, WHITE(0));
    context.fillStyle = horizontal;
    context.fillRect(0, 0, width, height);
    return canvas;
};

/** 细圆环（冲击波、散景的边）。 */
const drawRing = (size: number) => {
    const { canvas, context } = canvasOf(size, size);
    const c = size / 2;
    const line = Math.max(1.5, size * 0.05);
    context.strokeStyle = WHITE(1);
    context.lineWidth = line;
    context.beginPath();
    context.arc(c, c, c - line, 0, Math.PI * 2);
    context.stroke();
    return canvas;
};

/** 实心方块：彩纸、网点、线条（拉伸成细长条就是一条硬边线）。 */
const drawSquare = (size: number) => {
    const { canvas, context } = canvasOf(size, size);
    context.fillStyle = WHITE(1);
    context.fillRect(0, 0, size, size);
    return canvas;
};

/** 三角碎片：等边三角形，重心在纹理中心。 */
const drawTriangle = (size: number) => {
    const { canvas, context } = canvasOf(size, size);
    const c = size / 2;
    const r = size * 0.48;
    context.fillStyle = WHITE(1);
    context.beginPath();
    for (let i = 0; i < 3; i += 1) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
        const x = c + Math.cos(a) * r;
        const y = c + Math.sin(a) * r * 1.0 + r * 0.12;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();
    return canvas;
};

/** 樱花瓣：上宽下尖，顶端一个小缺口。 */
const drawPetal = (width: number, height: number) => {
    const { canvas, context } = canvasOf(width, height);
    const cx = width / 2;
    const top = height * 0.06;
    const bottom = height * 0.96;
    const notch = height * 0.16;
    context.fillStyle = WHITE(1);
    context.beginPath();
    context.moveTo(cx, bottom);
    context.bezierCurveTo(cx - width * 0.62, height * 0.62, cx - width * 0.5, top, cx - width * 0.14, top);
    context.lineTo(cx, top + notch);
    context.lineTo(cx + width * 0.14, top);
    context.bezierCurveTo(cx + width * 0.5, top, cx + width * 0.62, height * 0.62, cx, bottom);
    context.closePath();
    context.fill();
    return canvas;
};

export const createHanabiTextures: CreateHanabiTextures = (pixi, resolution) => {
    const scale = Math.max(0.5, Math.min(4, resolution || 1));
    const px = (base: number) => Math.max(4, Math.min(1024, Math.round(base * scale)));
    const make = (canvas: HTMLCanvasElement): Texture => pixi.Texture.from(canvas);
    const textures = {
        dot: make(drawDot(px(32))),
        glow: make(drawGlow(px(96))),
        star4: make(drawStar4(px(96))),
        streak: make(drawStreak(px(16), px(128))),
        ring: make(drawRing(px(160))),
        square: make(drawSquare(px(8))),
        triangle: make(drawTriangle(px(48))),
        petal: make(drawPetal(px(32), px(44))),
    };
    return {
        ...textures,
        destroy: () => Object.values(textures).forEach(texture => texture.destroy(true)),
    };
};
