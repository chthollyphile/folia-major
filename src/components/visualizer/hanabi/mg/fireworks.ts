// Copyright (c) 2026 chthollyphile
import type { Container, Sprite, Texture } from 'pixi.js';
import type { BurstEvent, CreateFireworks, LaunchEvent } from '../types';
import { burstActive, drawBursts, drawLaunch, launchDemand, launchEnd, planBurst, type BurstPlan, type SparkEmit, type SparkTexture } from './burstPlan';

// src/components/visualizer/hanabi/mg/fireworks.ts
// 烟花层：精灵池（上限 maxParticles）+ burstPlan 的闭式解。每帧 update(time, bursts, launches) 把池里的精灵
// 重新分配给此刻仍在燃烧的星、尾迹、闪光与升空尾迹，多出来的隐藏。画面只由 time 与事件决定。
// 每帧都有精灵显隐：Pixi 里改 visible / blendMode 会让所在渲染组整组重排绘制指令，所以烟花层自己是一个渲染组
// （重排只排这一池），叠加的闪光另用一个池画在上面，精灵不再来回换混合模式。

/** 方案缓存上限：超过就只保留此刻还活着的。 */
const PLAN_CACHE_LIMIT = 160;

interface SpritePool {
    layer: Container;
    sprites: Sprite[];
    used: number;
    shown: number;
}

export const createFireworks: CreateFireworks = (pixi, textures, options) => {
    const view = new pixi.Container({ isRenderGroup: true });
    const unit = Math.min(options.width, options.height);
    const maxParticles = Math.max(0, Math.floor(options.maxParticles));
    const poolOf = (blendMode: 'normal' | 'add'): SpritePool => {
        const layer = new pixi.Container();
        layer.blendMode = blendMode;
        view.addChild(layer);
        return { layer, sprites: [], used: 0, shown: 0 };
    };
    const normal = poolOf('normal');
    const additive = poolOf('add');
    let used = 0;
    // 事件对象在场景里是建好就不变的（节拍烟花按拍缓存），直接按对象缓存方案，不必每帧拼键。
    const plans = new Map<BurstEvent, BurstPlan>();
    const active: BurstPlan[] = [];

    const textureOf: Record<SparkTexture, Texture> = {
        glow: textures.glow,
        dot: textures.dot,
        star4: textures.star4,
        streak: textures.streak,
        flash: textures.glow,
    };

    // 池按需增长（两个池合起来不超过上限），之后只复用，不再新建。
    const emit: SparkEmit = (texture, x, y, width, height, rotation, alpha, tint) => {
        if (used >= maxParticles) return false;
        const pool = texture === 'flash' ? additive : normal;
        let sprite = pool.sprites[pool.used];
        if (!sprite) {
            sprite = new pixi.Sprite(textures.glow);
            sprite.anchor.set(0.5);
            pool.layer.addChild(sprite);
            pool.sprites.push(sprite);
        }
        pool.used += 1;
        sprite.texture = textureOf[texture];
        sprite.visible = true;
        sprite.position.set(x, y);
        sprite.rotation = rotation;
        sprite.width = width;
        sprite.height = height;
        sprite.alpha = alpha > 1 ? 1 : alpha;
        sprite.tint = tint;
        used += 1;
        return true;
    };

    const planOf = (event: BurstEvent) => {
        let plan = plans.get(event);
        if (!plan) {
            plan = planBurst(event, options.palette, { unit, amount: options.amount });
            plans.set(event, plan);
        }
        return plan;
    };

    const hideRest = (pool: SpritePool) => {
        for (let i = pool.used; i < pool.shown; i += 1) pool.sprites[i]!.visible = false;
        pool.shown = pool.used;
        pool.used = 0;
    };

    const update = (time: number, bursts: readonly BurstEvent[], launches: readonly LaunchEvent[]) => {
        used = 0;
        active.length = 0;
        // 先粗筛时间窗（duration 是上限），只给可能在燃烧的事件取方案。
        for (const event of bursts) {
            if (time < event.at || time > event.at + event.spec.duration) continue;
            const plan = planOf(event);
            if (burstActive(plan, time)) active.push(plan);
        }
        if (plans.size > PLAN_CACHE_LIMIT) {
            const keep = new Set(active);
            for (const [event, plan] of plans) if (!keep.has(plan)) plans.delete(event);
        }
        // 升空尾迹在下面、先画；它的精灵数很少，余下的全给烟花。
        let launchBudget = 0;
        for (const launch of launches) {
            if (time < launch.at || time > launchEnd(launch)) continue;
            launchBudget += launchDemand(launch, time);
        }
        launchBudget = Math.min(launchBudget, Math.floor(maxParticles * 0.2));
        for (const launch of launches) {
            if (used >= launchBudget) break;
            if (!drawLaunch(launch, time, unit, emit)) break;
        }
        drawBursts(active, time, maxParticles - used, emit);
        hideRest(normal);
        hideRest(additive);
        view.visible = used > 0;
    };

    return {
        view,
        update,
        destroy: () => {
            plans.clear();
            view.destroy({ children: true });
        },
    };
};
