import { memo, useEffect, useRef } from 'react';
import { spectrum } from '../../../../stores/motionSignals';

// src/components/app/lattice/radio/RadioSpectrum.tsx
// 电台墙左上角发射点外面的一圈圆形频谱：一圈径向短条，长短跟着播放器分析器的频谱（motionSignals.spectrum，
// 播放循环每帧写）。只画在一块 canvas 上，不进 React state；播放时自己跑 requestAnimationFrame，
// 暂停后短条缩回去、缩完就停；降低动态效果时只画一圈静止的短刻度。低频在下半圈（上半圈伸出画面外）。

const BAR_COUNT = 36;
/** 短条内端所在的圆（相对画布边长）。 */
const INNER_RADIUS = 0.17;
/** 静止时的短条长度与最长时多出来的长度（相对画布边长）。 */
const REST_LENGTH = 0.02;
const REACH = 0.25;
/** 每帧向目标靠拢的比例：起得快、落得慢一点，不至于闪。 */
const RISE = 0.45;
const FALL = 0.12;
/** 画布的像素比上限：都是细线，再高只是多传像素（3 倍屏上画布是 2 倍时的 2.25 倍大）。 */
const MAX_PIXEL_RATIO = 2;

/** 第 i 根短条读的频谱位置（0 = 低频，1 = 高频）：左右对称，低频在正下方，高频在正上方。 */
const barFrequency = (index: number) => {
    return Math.abs(1 - (index / BAR_COUNT) * 2);
};

const readTargets = (targets: Float32Array, playing: boolean) => {
    const data = spectrum.get();
    if (!playing || data.length === 0) {
        targets.fill(0);
        return;
    }
    // 跳过最低的几个 bin（直流和次声），只用到频谱的前 45%：再往上几乎总是空的。
    const low = 4;
    const high = Math.max(low + 1, Math.floor(data.length * 0.45));
    for (let index = 0; index < BAR_COUNT; index += 1) {
        // 低频占得多一些（接近对数刻度）。
        const position = barFrequency(index) ** 1.6;
        const bin = Math.min(high - 1, low + Math.floor(position * (high - low)));
        const value = (data[bin] + data[Math.min(high - 1, bin + 1)]) / 510;
        // 压一下中间值，安静处更稀疏，不至于一圈都顶满。
        targets[index] = value ** 1.7;
    }
};

function RadioSpectrum({ playing, reducedMotion }: { playing: boolean; reducedMotion: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // 跨过播放 / 暂停的切换留着：暂停时从当时的长度缩回去，而不是一下子归零。
    const levelsRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        const levels = levelsRef.current;
        const targets = new Float32Array(BAR_COUNT);
        let size = 0;
        let ratio = 1;
        let ink = '';
        let frame = 0;
        let raf = 0;

        const measure = () => {
            const box = canvas.getBoundingClientRect();
            ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
            size = Math.min(box.width, box.height);
            canvas.width = Math.max(1, Math.round(box.width * ratio));
            canvas.height = Math.max(1, Math.round(box.height * ratio));
            // 颜色来自主题（RadioWall.css 给画布的 color）：尺寸变时、以及播放中每隔一阵重读一次。
            ink = getComputedStyle(canvas).color;
        };

        const draw = () => {
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
            if (size === 0) return;
            const center = size / 2;
            const inner = size * INNER_RADIUS;
            context.strokeStyle = ink;
            context.lineCap = 'round';
            context.lineWidth = Math.max(1.5, size * 0.008);
            for (let index = 0; index < BAR_COUNT; index += 1) {
                const level = levels[index];
                const angle = (index / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
                const length = size * (REST_LENGTH + REACH * level);
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                context.globalAlpha = 0.35 + 0.55 * level;
                context.beginPath();
                context.moveTo(center + cos * inner, center + sin * inner);
                context.lineTo(center + cos * (inner + length), center + sin * (inner + length));
                context.stroke();
            }
            context.globalAlpha = 1;
        };

        const tick = () => {
            raf = 0;
            frame += 1;
            if (frame % 120 === 0) ink = getComputedStyle(canvas).color;
            readTargets(targets, playing);
            let moving = false;
            for (let index = 0; index < BAR_COUNT; index += 1) {
                const delta = targets[index] - levels[index];
                levels[index] += delta * (delta > 0 ? RISE : FALL);
                if (Math.abs(delta) > 0.002) moving = true;
            }
            // 短条都没动（分析器没有数据：音频跨域、还没接上）时不重画同一帧：每画一次画布都要整块重新交给合成器。
            if (moving || frame % 120 === 0) draw();
            // 暂停后缩回静止长度就停，不空转。
            if (playing || moving) raf = requestAnimationFrame(tick);
        };

        measure();
        const observer = new ResizeObserver(() => {
            measure();
            draw();
        });
        observer.observe(canvas);
        if (reducedMotion) draw();
        else raf = requestAnimationFrame(tick);
        return () => {
            if (raf) cancelAnimationFrame(raf);
            observer.disconnect();
        };
    }, [playing, reducedMotion]);

    return <canvas ref={canvasRef} className="lattice-radio-spectrum" />;
}

export default memo(RadioSpectrum);
