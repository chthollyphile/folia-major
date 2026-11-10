// Copyright (c) 2026 chthollyphile
import type { Sprite, Texture } from 'pixi.js';
import { createRng } from '../hanabiRandom';
import type { AmbientLayer, BurstEvent, BurstKind, CreateAmbient, HanabiPalette } from '../types';
import { drawBursts, planBurst, type BurstPlan, type SparkEmit, type SparkTexture } from './burstPlan';
import { clamp01, GOLD, hash01, hashString, mixColor, TAU, WHITE, wrap } from './mgMath';

// src/components/visualizer/hanabi/mg/ambient.ts
// 环境层（整单元一份）：back = 薄烟、远处星点（缓慢闪烁）、远方的小烟花；front = 上升的火星、前景散景。
// 两层都按屏幕坐标画（0..width × 0..height），每个点在自己的视差层里随 rise 下移，并在纵向 [−margin, height + margin) 里无缝循环，
// 所以上升多少屏也不会空。远方小烟花按种子排在整个单元的时间里，也用 burstPlan 的闭式解。

/** 各层的视差系数：远处 0.2–0.6，前景 1.2–1.5。 */
export const AMBIENT_PARALLAX = {
    starsNear: 0.42,
    starsFar: 0.2,
    smoke: 0.3,
    distant: 0.55,
    embers: 1.25,
    bokeh: 1.45,
} as const;

/** 视差层里一个点的屏幕 y：y0 + rise × parallax + drift，在 [−margin, height + margin) 里循环（换位只发生在画面外）。 */
export const parallaxY = (y0: number, rise: number, parallax: number, drift: number, height: number, margin: number) =>
    wrap(y0 + rise * parallax + drift + margin, height + margin * 2) - margin;

/** 远方小烟花：第 k 发的时刻、位置与规格（纯函数，按种子确定）。 */
export interface DistantBurst {
    at: number;
    x: number;
    /** 在视差层里的纵向位置（0..span）。 */
    y0: number;
    event: BurstEvent;
}

const DISTANT_KINDS: BurstKind[] = ['kiku', 'botan', 'ring', 'yanagi', 'senrin', 'kamuro', 'strobe', 'kiku', 'botan'];
export const DISTANT_DURATION = 2.6;

export const distantBurstAt = (seed: string, k: number, rate: number, startTime: number, width: number, span: number): DistantBurst => {
    const salt = hashString(seed) % 9973;
    const h = (i: number) => hash01(k * 17 + i, salt + 0.37);
    const at = startTime + (k + 0.1 + h(1) * 0.8) / rate;
    const kind = DISTANT_KINDS[Math.floor(h(2) * DISTANT_KINDS.length) % DISTANT_KINDS.length]!;
    const x = width * (0.06 + h(3) * 0.88);
    const y0 = span * h(4);
    return {
        at,
        x,
        y0,
        event: {
            x,
            y: 0,
            at,
            seed: `${seed}:distant:${k}`,
            scale: 1,
            squash: 0.35 + h(6) * 0.65,
            rotation: (h(7) - 0.5) * 0.8,
            spec: {
                kind,
                count: 26 + Math.floor(h(5) * 20),
                radius: 0.045 + h(8) * 0.045,
                duration: DISTANT_DURATION * (0.75 + h(9) * 0.25),
                colors: [Math.floor(h(10) * 5), Math.floor(h(11) * 5), Math.floor(h(12) * 5)],
                trail: 0.3 + h(13) * 0.4,
                twinkle: h(14) * 0.6,
            },
        },
    };
};

/** time 时可能在燃烧的远方小烟花序号范围 [first, last]。 */
export const distantRange = (time: number, rate: number, startTime: number, endTime: number) => {
    if (rate <= 0) return [0, -1] as const;
    const count = Math.max(0, Math.floor((endTime - startTime) * rate));
    const first = Math.max(0, Math.floor((time - DISTANT_DURATION - startTime) * rate) - 1);
    const last = Math.min(count - 1, Math.floor((time - startTime) * rate));
    return [first, last] as const;
};

interface Dot {
    sprite: Sprite;
    x: number;
    y0: number;
    size: number;
    alpha: number;
    parallax: number;
    speed: number;
    freq: number;
    phase: number;
    sway: number;
}

const tintedSpark = (palette: HanabiPalette, i: number) => palette.sparks[i % Math.max(1, palette.sparks.length)] ?? WHITE;

/** 薄烟只用 glow 纹理中间这一块（边长比例）。 */
const SMOKE_CROP = 0.8;

export const createAmbient: CreateAmbient = (options): AmbientLayer => {
    const { pixi, textures, width, height, palette } = options;
    const unit = Math.min(width, height);
    const density = Math.max(0, Math.min(2, options.density));
    const rng = createRng(`${options.seed}:ambient`);
    // 两层各是一个渲染组：远方小烟花的精灵池每帧都有显隐，星点、火星出入画面也会显隐（Pixi 改 visible 要整组重排绘制指令），
    // 重排只排这一层。远方小烟花叠加的闪光另用一层画在上面，精灵不再来回换混合模式。
    const back = new pixi.Container({ isRenderGroup: true });
    const front = new pixi.Container({ isRenderGroup: true });
    const smokeLayer = new pixi.Container();
    const starLayer = new pixi.Container();
    const distantLayer = new pixi.Container();
    const distantFlashLayer = new pixi.Container();
    distantFlashLayer.blendMode = 'add';
    back.addChild(smokeLayer, starLayer, distantLayer, distantFlashLayer);
    const emberLayer = new pixi.Container();
    const bokehLayer = new pixi.Container();
    front.addChild(bokehLayer, emberLayer);

    const margin = unit * 0.36;
    const span = height + margin * 2;
    const sprite = (texture: Texture, parent: typeof back) => {
        const s = new pixi.Sprite(texture);
        s.anchor.set(0.5);
        parent.addChild(s);
        return s;
    };
    const dots = (count: number, parent: typeof back, make: (i: number) => Omit<Dot, 'sprite'> & { texture: Texture; tint: number }) =>
        Array.from({ length: count }, (_, i): Dot => {
            const spec = make(i);
            const s = sprite(spec.texture, parent);
            s.tint = spec.tint;
            return { ...spec, sprite: s };
        });

    const starTint = mixColor(WHITE, palette.glow, 0.25);
    const stars = dots(Math.round(110 * density), starLayer, () => {
        const bright = rng() < 0.08;
        const depth = rng();
        return {
            texture: bright ? textures.star4 : textures.dot,
            tint: bright ? mixColor(WHITE, palette.glow, 0.4) : starTint,
            x: rng() * width,
            y0: rng() * span,
            size: unit * (bright ? 0.012 + rng() * 0.01 : 0.002 + rng() * 0.004),
            alpha: bright ? 0.7 : 0.2 + rng() * 0.55,
            parallax: AMBIENT_PARALLAX.starsFar + depth * (AMBIENT_PARALLAX.starsNear - AMBIENT_PARALLAX.starsFar),
            speed: 0,
            freq: 0.15 + rng() * 0.7,
            phase: rng() * TAU,
            sway: 0,
        };
    });
    // 薄烟的精灵很大（0.6–1.1 个 unit）又很淡：glow 纹理半径 0.8 以外那圈乘上烟的透明度不到 1/255，
    // 裁掉那圈、按 0.8 倍画，每团烟少填约 36% 的像素，画面看不出差别。
    const glowFrame = textures.glow.frame;
    const smokeTexture = new pixi.Texture({
        source: textures.glow.source,
        frame: new pixi.Rectangle(
            glowFrame.x + glowFrame.width * (1 - SMOKE_CROP) / 2,
            glowFrame.y + glowFrame.height * (1 - SMOKE_CROP) / 2,
            glowFrame.width * SMOKE_CROP,
            glowFrame.height * SMOKE_CROP,
        ),
    });
    const smoke = dots(Math.round(5 * Math.min(1.5, density)), smokeLayer, i => ({
        texture: smokeTexture,
        tint: mixColor(tintedSpark(palette, i), 0x9aa0b4, 0.6),
        x: width * (0.1 + rng() * 0.8),
        y0: rng() * span,
        size: unit * (0.6 + rng() * 0.5) * SMOKE_CROP,
        alpha: 0.035 + rng() * 0.035,
        parallax: AMBIENT_PARALLAX.smoke,
        speed: 0,
        freq: 0.03 + rng() * 0.04,
        phase: rng() * TAU,
        sway: unit * (0.05 + rng() * 0.08),
    }));
    const embers = dots(Math.round(40 * density), emberLayer, i => ({
        texture: textures.glow,
        tint: mixColor(GOLD, tintedSpark(palette, i), 0.3),
        x: rng() * width,
        y0: rng() * span,
        // glow 纹理的亮芯只占三成：画面上约 3–7 px 的火星。
        size: unit * (0.012 + rng() * 0.016),
        alpha: 0.55 + rng() * 0.45,
        parallax: AMBIENT_PARALLAX.embers + rng() * 0.1,
        speed: unit * (0.05 + rng() * 0.12),
        freq: 0.4 + rng() * 0.9,
        phase: rng() * TAU,
        sway: unit * (0.008 + rng() * 0.02),
    }));
    const bokeh = dots(Math.round(6 * density), bokehLayer, i => ({
        texture: textures.glow,
        tint: tintedSpark(palette, i + 2),
        x: rng() * width,
        y0: rng() * span,
        size: unit * (0.08 + rng() * 0.1),
        alpha: 0.06 + rng() * 0.08,
        parallax: AMBIENT_PARALLAX.bokeh,
        speed: unit * (0.01 + rng() * 0.02),
        freq: 0.1 + rng() * 0.2,
        phase: rng() * TAU,
        sway: unit * 0.02,
    }));

    // 远方小烟花：固定大小的精灵池（普通 / 叠加闪光两个池，合起来不超过上限）。
    const distantPools = [distantLayer, distantFlashLayer].map(layer => ({ layer, sprites: [] as Sprite[], used: 0, shown: 0 }));
    const distantMax = Math.round(240 * Math.min(1.5, density));
    const distantPlans = new Map<number, { burst: DistantBurst; plan: BurstPlan }>();
    let distantUsed = 0;
    let offsetY = 0;
    const distantTexture: Record<SparkTexture, Texture> = {
        glow: textures.glow,
        dot: textures.dot,
        star4: textures.star4,
        streak: textures.streak,
        flash: textures.glow,
    };
    const emitDistant: SparkEmit = (texture, x, y, w, h, rotation, alpha, tint) => {
        if (distantUsed >= distantMax) return false;
        const pool = distantPools[texture === 'flash' ? 1 : 0]!;
        let s = pool.sprites[pool.used];
        if (!s) {
            s = sprite(textures.glow, pool.layer);
            pool.sprites.push(s);
        }
        pool.used += 1;
        s.texture = distantTexture[texture];
        s.visible = true;
        s.position.set(x, y + offsetY);
        s.rotation = rotation;
        s.width = w;
        s.height = h;
        // 远处的更淡。
        s.alpha = Math.min(1, alpha) * 0.6;
        s.tint = tint;
        distantUsed += 1;
        return true;
    };
    const activeDistant: BurstPlan[] = [];

    const place = (dot: Dot, x: number, y: number, size: number, alpha: number) => {
        const visible = alpha > 0.004 && y > -size && y < height + size;
        dot.sprite.visible = visible;
        if (!visible) return;
        dot.sprite.position.set(x, y);
        dot.sprite.width = size;
        dot.sprite.height = size;
        dot.sprite.alpha = alpha;
    };

    const update = (time: number, rise: number) => {
        for (const dot of stars) {
            const y = parallaxY(dot.y0, rise, dot.parallax, 0, height, margin);
            const twinkle = 0.55 + 0.45 * Math.sin(time * dot.freq * TAU + dot.phase);
            place(dot, dot.x, y, dot.size * (0.85 + 0.3 * twinkle), dot.alpha * twinkle);
        }
        for (const dot of smoke) {
            const y = parallaxY(dot.y0, rise, dot.parallax, -time * unit * 0.01, height, margin);
            const x = dot.x + Math.sin(time * dot.freq * TAU + dot.phase) * dot.sway;
            place(dot, x, y, dot.size * (1 + 0.1 * Math.sin(time * 0.2 + dot.phase)), dot.alpha);
        }
        for (const dot of embers) {
            const y = parallaxY(dot.y0, rise, dot.parallax, -time * dot.speed, height, margin);
            const x = dot.x + Math.sin(time * dot.freq * TAU + dot.phase) * dot.sway;
            const flicker = hash01(Math.floor(time * 14 + dot.phase * 10), dot.phase) < 0.25 ? 0.35 : 1;
            // 越往上越暗：像飘起来慢慢燃尽的火星。
            const fade = 0.35 + 0.65 * clamp01(y / height);
            place(dot, x, y, dot.size * (0.8 + 0.4 * flicker), dot.alpha * flicker * fade);
        }
        for (const dot of bokeh) {
            const y = parallaxY(dot.y0, rise, dot.parallax, -time * dot.speed, height, margin);
            const x = dot.x + Math.sin(time * dot.freq * TAU + dot.phase) * dot.sway;
            place(dot, x, y, dot.size, dot.alpha * (0.8 + 0.2 * Math.sin(time * 0.5 + dot.phase)));
        }

        distantUsed = 0;
        if (options.distantBursts > 0 && distantMax > 0) {
            const [first, last] = distantRange(time, options.distantBursts, options.startTime, options.endTime);
            for (const key of distantPlans.keys()) if (key < first || key > last) distantPlans.delete(key);
            for (let k = first; k <= last; k += 1) {
                let entry = distantPlans.get(k);
                if (!entry) {
                    const burst = distantBurstAt(options.seed, k, options.distantBursts, options.startTime, width, span);
                    entry = { burst, plan: planBurst(burst.event, palette, { unit, amount: Math.min(1.5, density) }) };
                    distantPlans.set(k, entry);
                }
                if (time < entry.plan.at || time > entry.plan.end) continue;
                offsetY = parallaxY(entry.burst.y0, rise, AMBIENT_PARALLAX.distant, 0, height, margin);
                activeDistant.length = 0;
                activeDistant.push(entry.plan);
                drawBursts(activeDistant, time, distantMax - distantUsed, emitDistant);
            }
        }
        for (const pool of distantPools) {
            for (let i = pool.used; i < pool.shown; i += 1) pool.sprites[i]!.visible = false;
            pool.shown = pool.used;
            pool.used = 0;
        }
    };

    return {
        back,
        front,
        update,
        destroy: () => {
            distantPlans.clear();
            back.destroy({ children: true });
            front.destroy({ children: true });
            smokeTexture.destroy(false);
        },
    };
};
