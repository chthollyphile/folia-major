// Copyright (c) 2026 chthollyphile
import type { Container, Sprite, TilingSprite } from 'pixi.js';
import { clamp01, easeInCubic, easeOutBack, easeOutCubic, TAU } from '../mg/mgMath';
import type { HanabiTextures, PixiModule } from '../types';
import { STICKER_PX, type CollageTextureCache } from './collagePainters';
import { CANDY, CANDY_INK, type CollageItem, type CollagePlan } from './collagePlan';

// src/components/visualizer/hanabi/collage/collageViews.ts
// 把一个镜头的拼贴计划搭成 Pixi 的件，并逐帧摆姿态。全部精灵 / 平铺精灵（矩形用 Texture.WHITE 上色），不用 Graphics，
// 不用遮罩：装饰带「擦出」靠改平铺精灵的宽度与 tilePosition，图案钉在带上不跟着动。每帧画面只由 t 决定。
//   back：装饰带（胶片 / 剪切线 + 剪刀 / 蕾丝花边）、重复字、纸片、窗口、后层贴纸（在字底色块后面）
//   front：贴纸、胶带、标签、开花时的图标贴纸、跟着尾迹升空的小图标、间奏的贴纸气球（在字前面，但都摆在字组外面）

export interface ShotCollageView {
    back: Container;
    front: Container;
    update: (time: number) => void;
    destroy: () => void;
}

interface Part {
    update: (time: number) => void;
}

/** 弹出：0.32 秒 easeOutBack 到 1。 */
const popIn = (time: number, at: number, duration = 0.32) => easeOutBack((time - at) / duration, 2.4);
/** 退场进度 0..1。 */
const leave = (time: number, exitAt: number, exitDuration: number) => clamp01((time - exitAt) / Math.max(exitDuration, 0.05));

/** 贴纸精灵的缩放：形状半径约是纹理边长的 0.34，加白边约 0.4。 */
const stickerScale = (size: number) => size / (STICKER_PX * 0.8);

export const createShotCollage = (
    pixi: PixiModule,
    plan: CollagePlan,
    cache: CollageTextureCache,
    textures: HanabiTextures,
): ShotCollageView => {
    const back = new pixi.Container();
    const front = new pixi.Container();
    const parts: Part[] = [];

    const rect = (parent: Container, color: number, alpha = 1) => {
        const sprite = new pixi.Sprite(pixi.Texture.WHITE);
        sprite.tint = color;
        sprite.alpha = alpha;
        parent.addChild(sprite);
        return sprite;
    };
    const setRect = (sprite: Sprite, x: number, y: number, width: number, height: number) => {
        sprite.position.set(x, y);
        sprite.width = Math.max(0, width);
        sprite.height = Math.max(0, height);
    };

    const build = (item: CollageItem) => {
        switch (item.kind) {
            case 'strip': {
                const holder = new pixi.Container();
                holder.position.set(item.x, item.y);
                holder.rotation = item.rotation;
                // 胶片是直边，阴影用一块偏移的深色矩形；花边、剪切线的阴影画在纹理里。
                const shadow = item.style === 'film' ? rect(holder, CANDY_INK, 0.3) : null;
                const band: TilingSprite = new pixi.TilingSprite({
                    texture: cache.strip(item.style, item.color, item.thickness),
                    width: item.length,
                    height: item.thickness,
                });
                holder.addChild(band);
                // 剪切线：一把剪刀在「剪开」的那一头，剪的时候一开一合。
                const blade = item.style === 'cut' ? new pixi.Sprite(cache.scissors(item.thickness)) : null;
                if (blade) {
                    blade.anchor.set(0.5);
                    holder.addChild(blade);
                }
                back.addChild(holder);
                const half = item.length / 2;
                const tile = band.texture.width || 1;
                const lift = item.thickness * 0.14;
                // 剪刀剪过整条线要一段时间，看得见它走；另外两种是快速擦出。
                const wipe = item.style === 'cut' ? 1.25 : item.style === 'lace' ? 0.55 : 0.42;
                parts.push({
                    update: time => {
                        const raw = clamp01((time - item.at) / wipe);
                        const enter = item.style === 'cut' ? raw * raw * (3 - 2 * raw) : easeOutCubic(raw);
                        const exit = easeInCubic(leave(time, item.exitAt, item.exitDuration));
                        holder.visible = time > item.at && exit < 1;
                        if (!holder.visible) return;
                        // 从 from 那一端擦出，退场时朝另一端收走。
                        const startAt = item.from < 0 ? exit : 1 - enter;
                        const endAt = item.from < 0 ? enter : 1 - exit;
                        const x0 = -half + item.length * Math.min(startAt, endAt);
                        const width = item.length * Math.max(0, Math.abs(endAt - startAt));
                        band.position.set(x0, -item.thickness / 2);
                        band.width = width;
                        band.height = item.thickness;
                        // 图案钉在整条带上：带的左缘移动多少，tilePosition 反向补多少；再加上图案自己沿带子走。
                        band.tilePosition.x = ((item.speed * time - (x0 + half)) % tile + tile) % tile;
                        if (shadow) setRect(shadow, x0 + lift, -item.thickness / 2 + lift * 1.3, width, item.thickness);
                        if (blade) {
                            blade.visible = raw < 1 && exit <= 0;
                            if (!blade.visible) return;
                            const age = time - item.at;
                            blade.position.set(item.from < 0 ? x0 + width : x0, 0);
                            blade.scale.set(item.from < 0 ? 1 : -1, 1 - 0.3 * Math.abs(Math.sin(age * 16)));
                            blade.alpha = clamp01(age / 0.12);
                        }
                    },
                });
                return;
            }
            case 'echo': {
                const texture = cache.echo(item.text, item.color, item.size, item.axis);
                const strip: TilingSprite = new pixi.TilingSprite({
                    texture,
                    width: item.axis === 'x' ? item.width : texture.width,
                    height: item.axis === 'x' ? texture.height : item.height,
                });
                strip.anchor.set(0.5);
                strip.position.set(item.x, item.y);
                strip.rotation = item.rotation;
                back.addChild(strip);
                parts.push({
                    update: time => {
                        const enter = easeOutCubic((time - item.at) / 0.6);
                        const exit = leave(time, item.exitAt, item.exitDuration);
                        const alpha = item.alpha * enter * (1 - exit);
                        strip.visible = alpha > 0.002;
                        if (!strip.visible) return;
                        strip.alpha = alpha;
                        strip.scale.set(1 + 0.06 * (1 - enter));
                        if (item.axis === 'x') strip.tilePosition.x = item.speed * time;
                        else strip.tilePosition.y = item.speed * time;
                    },
                });
                return;
            }
            case 'patch': {
                const holder = new pixi.Container();
                holder.position.set(item.x, item.y);
                const hw = item.width / 2;
                const hh = item.height / 2;
                const border = Math.max(3, Math.min(item.width, item.height) * 0.025);
                const shadow = rect(holder, CANDY_INK, item.dark ? 0.35 : 0.3);
                setRect(shadow, -hw - border + border * 2.2, -hh - border + border * 2.6, item.width + border * 2, item.height + border * 2);
                const rim = rect(holder, 0xffffff, item.dark ? 0.9 : 1);
                setRect(rim, -hw - border, -hh - border, item.width + border * 2, item.height + border * 2);
                const fill = rect(holder, item.color, item.dark ? 0.86 : 1);
                setRect(fill, -hw, -hh, item.width, item.height);
                if (item.pattern !== 'plain') {
                    const pattern: TilingSprite = new pixi.TilingSprite({ texture: cache.pattern(item.pattern), width: item.width, height: item.height });
                    pattern.position.set(-hw, -hh);
                    pattern.alpha = item.dark ? 0.16 : 0.45;
                    holder.addChild(pattern);
                }
                back.addChild(holder);
                parts.push({
                    update: time => {
                        const enter = popIn(time, item.at, 0.36);
                        const exit = leave(time, item.exitAt, item.exitDuration);
                        holder.visible = time >= item.at && exit < 1;
                        if (!holder.visible) return;
                        holder.alpha = clamp01((time - item.at) / 0.12) * (1 - exit);
                        holder.scale.set(1.14 - 0.14 * enter);
                        holder.rotation = item.rotation + 0.12 * (1 - Math.min(1, enter));
                        holder.y = item.y + exit * item.height * 0.15;
                    },
                });
                return;
            }
            case 'window': {
                const holder = new pixi.Container();
                holder.position.set(item.x, item.y);
                holder.rotation = item.rotation;
                const hw = item.width / 2;
                const hh = item.height / 2;
                const border = Math.max(2.5, item.bar * 0.12);
                const offset = item.bar * 0.32;
                // 糖果粉的硬阴影：日系 PV 的界面窗口不用灰影。
                setRect(rect(holder, CANDY[0], 0.85), -hw + offset, -hh + offset, item.width, item.height);
                setRect(rect(holder, 0xffffff), -hw - border, -hh - border, item.width + border * 2, item.height + border * 2);
                setRect(rect(holder, 0x1d1838, 0.62), -hw, -hh + item.bar, item.width, item.height - item.bar);
                const titleColor = CANDY[(Math.abs(Math.round(item.x + item.y)) % CANDY.length)]!;
                setRect(rect(holder, titleColor), -hw, -hh, item.width, item.bar);
                // 标题栏右边三颗圆点按钮。
                [0xff8fb5, 0xffe27a, 0x8ff0c8].forEach((color, k) => {
                    const dot = new pixi.Sprite(textures.dot);
                    dot.anchor.set(0.5);
                    dot.tint = color;
                    dot.width = dot.height = item.bar * 0.42;
                    dot.position.set(hw - item.bar * (0.55 + k * 0.6), -hh + item.bar / 2);
                    holder.addChild(dot);
                });
                const title = new pixi.Sprite(cache.label(item.title, titleColor, item.bar * 0.48));
                title.anchor.set(0, 0.5);
                title.scale.set(0.92);
                title.position.set(-hw + item.bar * 0.25, -hh + item.bar / 2);
                holder.addChild(title);
                back.addChild(holder);
                parts.push({
                    update: time => {
                        const enter = popIn(time, item.at, 0.34);
                        const exit = leave(time, item.exitAt, item.exitDuration);
                        holder.visible = time >= item.at && exit < 1;
                        if (!holder.visible) return;
                        holder.alpha = clamp01((time - item.at) / 0.1) * (1 - easeInCubic(exit));
                        holder.scale.set((0.86 + 0.14 * enter) * (1 - 0.12 * exit));
                    },
                });
                return;
            }
            case 'sticker': {
                const sprite = new pixi.Sprite(cache.sticker(item.shape, item.color, item.label));
                sprite.anchor.set(0.5);
                sprite.position.set(item.x, item.y);
                (item.layer === 'back' ? back : front).addChild(sprite);
                const base = stickerScale(item.size);
                const phase = (item.x * 0.013 + item.y * 0.007) % TAU;
                parts.push({
                    update: time => {
                        const exit = leave(time, item.exitAt, Math.min(0.3, item.exitDuration));
                        sprite.visible = time >= item.at && exit < 1;
                        if (!sprite.visible) return;
                        const enter = popIn(time, item.at);
                        const age = time - item.at;
                        sprite.scale.set(base * enter * (1 - easeInCubic(exit)));
                        sprite.rotation = item.rotation + (1 - Math.min(1, enter)) * 0.8 + Math.sin(age * 2.6 + phase) * 0.07 + exit * 0.9;
                        sprite.y = item.y + Math.sin(age * 1.9 + phase) * item.size * 0.05;
                    },
                });
                return;
            }
            case 'tape': {
                const sprite = new pixi.Sprite(cache.tape(item.color, item.pattern));
                sprite.anchor.set(0.5);
                sprite.position.set(item.x, item.y);
                sprite.rotation = item.rotation;
                front.addChild(sprite);
                const sx = item.length / (sprite.texture.width || 1);
                const sy = item.width / (sprite.texture.height || 1);
                parts.push({
                    update: time => {
                        const exit = leave(time, item.exitAt, item.exitDuration);
                        sprite.visible = time >= item.at && exit < 1;
                        if (!sprite.visible) return;
                        // 「啪」地贴上：从稍大处压下来。
                        const stick = easeOutCubic((time - item.at) / 0.16);
                        sprite.scale.set(sx * (1.25 - 0.25 * stick), sy * (1.25 - 0.25 * stick));
                        sprite.alpha = stick * (1 - exit);
                    },
                });
                return;
            }
            case 'label': {
                const sprite = new pixi.Sprite(cache.label(item.text, item.color, item.size));
                sprite.anchor.set(0.5);
                sprite.position.set(item.x, item.y);
                sprite.rotation = item.rotation;
                front.addChild(sprite);
                parts.push({
                    update: time => {
                        const exit = leave(time, item.exitAt, item.exitDuration);
                        sprite.visible = time >= item.at && exit < 1;
                        if (!sprite.visible) return;
                        sprite.scale.set(popIn(time, item.at, 0.28) * (1 - easeInCubic(exit)));
                    },
                });
                return;
            }
            case 'headline': {
                const sprite = new pixi.Sprite(cache.sound(item.text, item.color, item.size));
                sprite.anchor.set(0.5);
                sprite.position.set(item.x, item.y);
                back.addChild(sprite);
                parts.push({
                    update: time => {
                        const exit = leave(time, item.exitAt, item.exitDuration);
                        sprite.visible = time >= item.at && exit < 1;
                        if (!sprite.visible) return;
                        const age = time - item.at;
                        sprite.scale.set(popIn(time, item.at, 0.4) * (1 - easeInCubic(exit)));
                        sprite.rotation = item.rotation + Math.sin(age * 1.6) * 0.015;
                        sprite.y = item.y + Math.sin(age * 2.1) * item.size * 0.04;
                    },
                });
                return;
            }
            case 'pop': {
                const sprite = new pixi.Sprite(cache.icon(item.icon, item.color, item.size));
                sprite.anchor.set(0.5);
                sprite.position.set(item.x, item.y);
                front.addChild(sprite);
                parts.push({
                    update: time => {
                        const age = time - item.at;
                        sprite.visible = age >= 0 && age <= item.duration;
                        if (!sprite.visible) return;
                        const fade = clamp01((age - (item.duration - 0.35)) / 0.35);
                        // 跟着开花蹦出来：从小弹过 1 再落定、转着摆两下；最后往上飘着淡出。
                        const pop = easeOutBack(age / 0.24, 3);
                        const swing = Math.exp(-age / 0.18) * Math.sin(age * 38) * 0.22;
                        sprite.scale.set(Math.max(0, pop) * (1 + 0.06 * fade));
                        sprite.rotation = item.rotation + swing;
                        sprite.y = item.y - fade * item.size * 0.6;
                        sprite.alpha = 1 - easeInCubic(fade);
                    },
                });
                return;
            }
            case 'whoosh': {
                const sprite = new pixi.Sprite(cache.icon(item.icon, item.color, item.size));
                sprite.anchor.set(0.5);
                front.addChild(sprite);
                parts.push({
                    update: time => {
                        const age = time - item.at;
                        const life = item.duration + 0.55;
                        sprite.visible = age >= 0 && age <= life;
                        if (!sprite.visible) return;
                        const p = easeOutCubic(age / item.duration);
                        // 贴着尾迹的头、偏右一点往上走，一路转着；到顶后停一下再淡出。
                        sprite.position.set(
                            item.fromX + (item.toX - item.fromX) * p + item.size * 0.8,
                            item.fromY + (item.toY - item.fromY) * p + item.size * 0.3,
                        );
                        sprite.alpha = clamp01(age / 0.08) * (1 - clamp01((age - item.duration - 0.2) / 0.35));
                        sprite.rotation = p * Math.PI * 1.5;
                        sprite.scale.set(0.7 + 0.3 * clamp01(age / item.duration));
                    },
                });
                return;
            }
            case 'floater': {
                const sprite = new pixi.Sprite(cache.sticker(item.shape, item.color, null));
                sprite.anchor.set(0.5);
                front.addChild(sprite);
                const base = stickerScale(item.size);
                const phase = (item.x * 0.017) % TAU;
                parts.push({
                    update: time => {
                        const age = time - item.at;
                        sprite.visible = age >= 0 && age <= item.duration;
                        if (!sprite.visible) return;
                        const p = age / item.duration;
                        sprite.position.set(item.x + Math.sin(age * 2.2 + phase) * item.sway, item.y - item.rise * p);
                        sprite.rotation = Math.sin(age * 1.7 + phase) * 0.25;
                        sprite.scale.set(base * Math.min(1, popIn(time, item.at, 0.3)));
                        sprite.alpha = 1 - clamp01((p - 0.82) / 0.18);
                    },
                });
                return;
            }
        }
    };

    plan.items.forEach(build);

    return {
        back,
        front,
        update: time => parts.forEach(part => part.update(time)),
        // 纹理归缓存（场景单元销毁时一起放），这里只拆显示树。
        destroy: () => {
            back.destroy({ children: true });
            front.destroy({ children: true });
        },
    };
};
