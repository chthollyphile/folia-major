// Copyright (c) 2026 chthollyphile
import type { Container, Texture, TilingSprite } from 'pixi.js';
import { createRng } from '../hanabiRandom';
import type { PixiModule } from '../types';
import type { CollageTextureCache } from './collagePainters';
import { CANDY } from './collagePlan';

// src/components/visualizer/hanabi/collage/unitCollage.ts
// 整个场景单元一份的拼贴层（屏幕坐标，不放进上升的世界里）：
//   - back：满屏的网点底纹，按世界上升量的 0.35 倍视差往下流——画面空着的地方也看得出一直在往上走；
//   - front：画面左缘一条竖着的电影胶片（齿孔 + 一格格粉彩画面，不带字），跟着世界的上升一起往下走，像摄影机沿着它往上爬。
// 两层的位置只由 t 与 rise(t) 决定。

export interface UnitCollageView {
    back: Container;
    front: Container;
    update: (time: number, rise: number) => void;
    destroy: () => void;
}

/** 网点底纹的小格（白点，靠 tint 上色）。 */
const paintDotTile = (scale: number) => {
    const tile = 26;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(tile * scale);
    canvas.height = Math.ceil(tile * scale);
    const context = canvas.getContext('2d')!;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.arc(tile / 4, tile / 4, 1.6, 0, Math.PI * 2);
    context.arc((tile * 3) / 4, (tile * 3) / 4, 1.6, 0, Math.PI * 2);
    context.fill();
    return canvas;
};

export const createUnitCollage = (pixi: PixiModule, options: {
    width: number;
    height: number;
    resolution: number;
    seed: string;
    cache: CollageTextureCache;
    paper: number;
    /** tuning.collage（0..2）。 */
    amount: number;
    startTime: number;
}): UnitCollageView => {
    const { width, height, amount } = options;
    const unit = Math.min(width, height);
    const random = createRng(`${options.seed}:unit-collage`);
    const back = new pixi.Container();
    const front = new pixi.Container();
    const scale = Math.max(1, Math.min(2, options.resolution || 1));

    const dotTexture: Texture = new pixi.Texture({ source: new pixi.CanvasSource({ resource: paintDotTile(scale), resolution: scale }) });
    const dots: TilingSprite = new pixi.TilingSprite({ texture: dotTexture, width: width * 1.2, height: height * 1.2 });
    dots.position.set(-width * 0.1, -height * 0.1);
    dots.tint = options.paper;
    dots.alpha = 0.05 + 0.03 * Math.min(1, amount);
    back.addChild(dots);

    const thickness = Math.max(20, unit * 0.055);
    const rail: TilingSprite = new pixi.TilingSprite({
        texture: options.cache.strip('film', CANDY[Math.floor(random() * CANDY.length)]!, thickness),
        width: height * 1.3,
        height: thickness,
    });
    // 转成竖条：本地 +x 指向画面上方。
    rail.anchor.set(0.5);
    rail.rotation = -Math.PI / 2;
    rail.position.set(Math.max(thickness * 0.9, width * 0.022), height / 2);
    rail.alpha = 0.92;
    front.addChild(rail);
    const tile = rail.texture.width || 1;
    const drift = unit * 0.03;

    return {
        back,
        front,
        update: (time, rise) => {
            dots.tilePosition.y = rise * 0.35;
            // 胶片跟着世界往下走（本地 −x 是画面下方），外加一点自己的慢速走片。段落之间由运行时的转场交叉渐变接上。
            rail.tilePosition.x = (((-(rise + drift * (time - options.startTime))) % tile) + tile) % tile;
        },
        destroy: () => {
            back.destroy({ children: true });
            front.destroy({ children: true });
            dotTexture.destroy(true);
        },
    };
};
