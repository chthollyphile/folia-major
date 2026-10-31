import React, { useEffect, useRef } from "react";
import { audioPower, beatImpact, spectrum } from "../../stores/motionSignals";
import {
    averageEnergy,
    computeWaveHeights,
    parseAccentColor,
    sampleSpectrumColumns,
    smoothColumns,
    WAVE_COLUMN_COUNT,
} from "./playerBarWave";
import "./PlayerBarGlow.css";

// src/components/floating-player/PlayerBarGlow.tsx
// 播放时浮动播放条底边的那层效果：一面会随音乐起伏、缓慢流动的水面波形。
//
// 这一层在胶囊**内部**（挂在胶囊的子节点里），贴在底边往上摊；z-index: -1 让它压在
// 按钮、进度条下面，浮在胶囊自己的底色上面，所以它照亮的是底边，不会盖住控件。
// 胶囊里 data-glass-light 的光晕层（liquidglass.ts 追加的子节点）是跟着指针走的白色
// 光斑，z-index: 0、在内容之上；两者亮部叠加也只是更亮，不会互相冲淡。
//
// 强度和形状都直接读全局音频信号（stores/motionSignals）：那里存的是 MotionValue，
// 读一次不触发任何渲染，所以这里用自己的 rAF 画 canvas，形状每帧重算，
// 不进 React state（见 skills/frontend-runtime-guardrails）。
//
// 频谱 → 每列能量 → 水面高度的计算放在 playerBarWave.ts（纯函数，可单测）；
// 这里只负责把高度画成水：主体填色 + 波峰高光 + 顺流而下的次层。

// 上升快、回落慢：跟得上鼓点，又不会一闪一闪（按 60fps 归一后的每帧比例）。
const WAVE_ATTACK = 0.55;
const WAVE_RELEASE = 0.12;

// 整层光的强度：上升快、回落慢（跟原来的光效一个口径）。
const GLOW_ATTACK = 16;
const GLOW_RELEASE = 3.6;

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1);

type PlayerBarGlowProps = {
    /** 只在播放时发光。 */
    active: boolean;
    /** 胶囊是展开还是收起：变了就重新量一次画布尺寸。 */
    expanded?: boolean;
};

const PlayerBarGlow: React.FC<PlayerBarGlowProps> = ({ active, expanded }) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // 重新量尺寸的动作留给展开/收起的那个 effect 调用。
    const measureRef = useRef<(() => void) | null>(null);
    // 播放状态进 ref：它只决定这一帧的形状，切换时不该重建帧循环（那会把平滑中的
    // 强度清零，水面就硬生生地断掉）。
    const activeRef = useRef(active);
    activeRef.current = active;

    useEffect(() => {
        // 展开/收起各量一次：胶囊的布局尺寸这时已经变了，画布要跟上，
        // 否则水面会按上一次的宽高摊开。
        measureRef.current?.();
    }, [expanded]);

    useEffect(() => {
        const root = rootRef.current;
        const canvas = canvasRef.current;
        if (!root || !canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let width = 0;
        let height = 0;
        let dpr = 1;

        // 用布局尺寸（clientWidth/clientHeight），不用 getBoundingClientRect：
        // 胶囊展开/收起走的是 framer-motion 的 layout 动画，动画期间整块被 transform 缩放，
        // getBoundingClientRect 给的是缩放后的视觉尺寸，画布会被当成缩放过的尺寸再被父级缩一次，
        // 水面就跟着变形。布局尺寸才是画布该有的坐标系。
        const applySize = (nextWidth: number, nextHeight: number) => {
            const targetWidth = Math.max(1, Math.round(nextWidth));
            const targetHeight = Math.max(1, Math.round(nextHeight));
            if (targetWidth === width && targetHeight === height) return;
            width = targetWidth;
            height = targetHeight;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        const measure = () => {
            applySize(root.clientWidth, root.clientHeight);
        };

        measure();
        // 胶囊展开/收起会改这块的布局尺寸，观察它就能跟着重新量。
        const observer = new ResizeObserver(() => measure());
        observer.observe(root);
        measureRef.current = measure;

        // 主题强调色会随主题换，过一会儿重新读一次就够了（读它要走样式计算，不能每帧做）。
        let accent = parseAccentColor(null);
        let framesSinceAccentRead = 0;
        const readAccent = () => {
            const computed = window.getComputedStyle(root);
            accent = parseAccentColor(
                computed.getPropertyValue("--player-bar-glow-accent") ||
                computed.getPropertyValue("--text-accent"),
            );
        };
        readAccent();

        const energy = new Float32Array(WAVE_COLUMN_COUNT);
        const raw = new Float32Array(WAVE_COLUMN_COUNT);

        let frame = 0;
        let level = 0;
        let time = 0;
        let last = performance.now();

        const drawSurface = (heights: Float32Array, alpha: number) => {
            const count = heights.length;
            if (count < 2 || width <= 0 || height <= 0) return;

            const crestPath = () => {
                ctx.beginPath();
                ctx.moveTo(0, height - heights[0]);
                for (let index = 1; index < count - 1; index += 1) {
                    const x0 = (index / (count - 1)) * width;
                    const x1 = ((index + 1) / (count - 1)) * width;
                    const y0 = height - heights[index];
                    const y1 = height - heights[index + 1];
                    // 用中点做二次贝塞尔：折线会看出棱角，中点平滑才像水面。
                    ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
                }
                ctx.lineTo(width, height - heights[count - 1]);
            };

            // 水体：从波峰往底边铺开。
            // 填色先过一道模糊：水的边不该有硬边，糊开才是水。
            // 这里只画体，不描线：波形靠色块的软边显形，描一条线就变成图表了。
            crestPath();
            ctx.lineTo(width, height);
            ctx.lineTo(0, height);
            ctx.closePath();

            // 颜色是射线型的：以底边中央为心，白色从心里射出去，越远越化到主题强调色。
            const radius = Math.max(Math.hypot(width / 2, height), 1);
            const gradient = ctx.createRadialGradient(width / 2, height, 0, width / 2, height, radius);
            gradient.addColorStop(0, `rgba(255, 255, 255)`);
            gradient.addColorStop(1, `rgba(${accent.r}, ${accent.g}, ${accent.b}, 1)`);
            ctx.save();
            // ctx.filter = `blur(${Math.max(4, Math.min(10, height * 0.12)).toFixed(1)}px)`;
            ctx.fillStyle = gradient;
            ctx.fill();
            ctx.restore();
        };

        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);
            const dt = Math.min((now - last) / 1000, 0.1);
            last = now;
            time += dt;

            const playing = activeRef.current;
            const spec = playing ? spectrum.get() : null;
            sampleSpectrumColumns(spec, WAVE_COLUMN_COUNT, raw);
            smoothColumns(energy, raw, dt, WAVE_ATTACK, WAVE_RELEASE);

            // 强度：整体能量打底，重拍再补一下（跟原来的光效一致）。
            const power = playing ? audioPower.get() / 255 : 0;
            const beat = playing ? beatImpact.get() : 0;
            const target = clamp01(averageEnergy(energy) * 2.4 + power * 0.35 + beat * 0.22);
            const rate = target > level ? GLOW_ATTACK : GLOW_RELEASE;
            level += (target - level) * Math.min(1, rate * dt);
            root.style.setProperty("--player-bar-glow-level", level.toFixed(3));

            ctx.clearRect(0, 0, width, height);

            framesSinceAccentRead += 1;
            if (framesSinceAccentRead >= 30) {
                framesSinceAccentRead = 0;
                readAccent();
            }

            if (level <= 0.002) return;

            const maxHeight = height * 0.92;
            // 两层水面：后一层慢半拍、矮一点，制造往前流的视差。
            const back = computeWaveHeights(energy, { time: time - 1.6, maxHeight, rippleScale: 1.25 });
            const front = computeWaveHeights(energy, { time, maxHeight });

            drawSurface(back, level * 0.4);
            drawSurface(front, level);
        };

        frame = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            measureRef.current = null;
        };
    }, []);

    return (
        <div ref={rootRef} className="player-bar-glow" aria-hidden="true">
            <canvas ref={canvasRef} className="player-bar-glow-canvas" />
        </div>
    );
};

export default PlayerBarGlow;
