// Copyright (c) 2026 chthollyphile
import type { Container, Sprite, Texture } from 'pixi.js';
import type { Theme } from '../../../types';
import { hexOfCss } from './color';
import type { PixiModule } from './types';

// src/components/visualizer/hanabi/hanabiSky.ts
// 夜空底：运行时铺在所有段落场景与片尾卡之下的一整块竖向渐变（上深靛、中堇、近地平线一抹桃紫的祭典光），
// 色相往主题强调色偏一点。和绘光的暗场一样放在运行时层级，不随段落转场一起淡出——转场时共享背景不会透出来闪一下。
// 不透明度每帧从 tuning.sky 现读，拖滑块不重建；为 0 时整层不画，烟花直接开在用户选的背景上。

type Hsl = [number, number, number];

const hslOfHex = (hex: number): Hsl => {
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, s, l];
};

const cssOfHsl = ([h, s, l]: Hsl) => `hsl(${(((h % 1) + 1) % 1) * 360}deg ${s * 100}% ${l * 100}%)`;

/** 色相沿最短方向往 target 转 amount。 */
const leanHue = (from: number, to: number, amount: number) => {
    let delta = to - from;
    if (delta > 0.5) delta -= 1;
    if (delta < -0.5) delta += 1;
    return from + delta * amount;
};

/** 夜空的四个色标（自上而下）；主题强调色没有色相（灰、黑白主题）时保持原样。 */
export const resolveHanabiSkyStops = (theme: Theme): Array<{ at: number; color: string }> => {
    const [hue, saturation] = hslOfHex(hexOfCss(theme.accentColor, 0xff7a8a));
    const lean = (base: number) => (saturation < 0.2 ? base : leanHue(base, hue, 0.3));
    return [
        { at: 0, color: cssOfHsl([lean(0.66), 0.62, 0.06]) },
        { at: 0.45, color: cssOfHsl([lean(0.7), 0.5, 0.11]) },
        { at: 0.82, color: cssOfHsl([lean(0.8), 0.48, 0.19]) },
        { at: 1, color: cssOfHsl([lean(0.9), 0.55, 0.27]) },
    ];
};

const paintSky = (theme: Theme) => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 512;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    resolveHanabiSkyStops(theme).forEach(stop => gradient.addColorStop(stop.at, stop.color));
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
};

export class HanabiSkyLayer {
    readonly view: Container;
    private readonly sprite: Sprite;
    private texture: Texture | null = null;
    private theme: Theme | null = null;

    constructor(private readonly pixi: PixiModule) {
        this.view = new pixi.Container();
        this.sprite = new pixi.Sprite();
        this.view.addChild(this.sprite);
    }

    /** 每帧调用：主题变了才重画渐变，尺寸与不透明度直接改。 */
    update(theme: Theme, alpha: number, width: number, height: number) {
        this.view.visible = alpha > 0.002;
        if (!this.view.visible) return;
        if (theme !== this.theme) {
            this.theme = theme;
            const previous = this.texture;
            this.texture = this.pixi.Texture.from(paintSky(theme));
            this.sprite.texture = this.texture;
            previous?.destroy(true);
        }
        this.sprite.width = width;
        this.sprite.height = height;
        this.view.alpha = alpha;
    }

    destroy() {
        this.texture?.destroy(true);
        this.texture = null;
        this.view.destroy({ children: true });
    }
}
