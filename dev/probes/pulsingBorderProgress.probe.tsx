import React, { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import PulsingBorderProgressRing from './pulsing-border-progress/PulsingBorderProgressRing';
import { DEFAULT_BORDER_COLORS, DEFAULT_BORDER_TUNING, type BorderTuning } from './pulsing-border-progress/PulsingBorderProgress';
import NowPlayingPulseCard from './pulsing-border-progress/NowPlayingPulseCard';
import BorderTuningControls from './pulsing-border-progress/BorderTuningControls';
import type { ProbeDefinition } from './definition';
// dev/probes/pulsingBorderProgress.probe.tsx

/**
 * 实验性组件：在 Paper Shaders 的 pulsing-border 上改出的 0→100 进度描边。
 *
 * 要看的是三件事：
 * 1. 进度是在着色器里按周长裁的（见 pulsingBorderProgressShader.ts），端点应该是软的圆头，
 *    不该出现之前 conic-gradient 遮罩那种从圆心切下来的直边；
 * 2. 同一个着色器换个圆角就是卡片边框，圆角矩形上的推进速度要匀，长边不能突然变快；
 * 3. 进度走 MotionValue 直写 uniform，自动播放时不应该触发 React 重渲染。
 *
 * 下方输入框和滑动条控制进度，参数面板用来找发光强度和描边粗细的可用区间。
 */

const DEMO_COVER = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="g" cx="50%" cy="38%" r="70%">
      <stop offset="0%" stop-color="#ffd8a8"/>
      <stop offset="45%" stop-color="#e8763c"/>
      <stop offset="100%" stop-color="#2b1b4d"/>
    </radialGradient>
  </defs>
  <rect width="200" height="200" fill="url(#g)"/>
  <circle cx="100" cy="86" r="34" fill="#fff3d6" opacity="0.85"/>
  <path d="M46 150h108l-18-34H64z" fill="#2b1b4d" opacity="0.55"/>
  <g fill="#2b1b4d" opacity="0.4">
    <rect x="68" y="116" width="6" height="34"/>
    <rect x="97" y="116" width="6" height="34"/>
    <rect x="126" y="116" width="6" height="34"/>
  </g>
</svg>`)}`;

const AUTO_DURATION_SEC = 12;

const PulsingBorderProgressProbe: React.FC = () => {
    const progress = useMotionValue(38);
    const percentText = useTransform(progress, value => Math.round(value).toString());
    const rangeRef = useRef<HTMLInputElement>(null);
    const numberRef = useRef<HTMLInputElement>(null);
    const [autoRun, setAutoRun] = useState(false);
    const [tuning, setTuning] = useState<BorderTuning>(DEFAULT_BORDER_TUNING);

    // 自动播放时两个输入框跟着动，但不走 state：逐帧 setState 会让整页重渲染。
    useEffect(() => {
        const sync = (value: number) => {
            const text = String(Math.round(value * 10) / 10);
            if (rangeRef.current && document.activeElement !== rangeRef.current) rangeRef.current.value = text;
            if (numberRef.current && document.activeElement !== numberRef.current) numberRef.current.value = text;
        };
        sync(progress.get());
        return progress.on('change', sync);
    }, [progress]);

    useEffect(() => {
        if (!autoRun) return;
        const controls = animate(progress, [0, 100], {
            duration: AUTO_DURATION_SEC,
            ease: 'linear',
            repeat: Infinity,
        });
        return () => controls.stop();
    }, [autoRun, progress]);

    const applyManualProgress = (raw: string) => {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return;
        setAutoRun(false);
        progress.set(Math.min(100, Math.max(0, parsed)));
    };

    return (
        <div className="mx-auto flex max-w-5xl flex-col gap-8 p-10 font-sans text-zinc-100">
            <header>
                <h1 className="text-lg font-bold">PulsingBorder 进度描边</h1>
                <p className="mt-1 text-sm text-zinc-400">
                    pulsing-borde - exp
                </p>
            </header>

            <div className="flex flex-wrap items-center gap-10">
                <PulsingBorderProgressRing progress={progress} size={280} pad={34} tuning={tuning} colors={DEFAULT_BORDER_COLORS}>
                    <div className="flex flex-col items-center">
                        <div className="flex items-baseline">
                            <motion.span className="text-5xl font-semibold tabular-nums text-zinc-50">{percentText}</motion.span>
                            <span className="ml-1 text-xl text-zinc-400">%</span>
                        </div>
                        <span className="mt-1 text-[10px] uppercase tracking-[0.35em] text-zinc-500">complete</span>
                    </div>
                </PulsingBorderProgressRing>

                <div className="flex flex-col gap-4">
                    {(['light', 'dark'] as const).map(variant => (
                        <NowPlayingPulseCard
                            key={variant}
                            progress={progress}
                            variant={variant}
                            coverUrl={DEMO_COVER}
                            label="正在播放"
                            title="秘密のメリーゴーランド (ft. Sohbana)"
                            artist="ミカヅキ BIGWAVE"
                            tuning={tuning}
                        />
                    ))}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <span className="text-xs font-semibold text-zinc-300">进度</span>
                <input
                    ref={numberRef}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    defaultValue={progress.get()}
                    data-probe-progress-number=""
                    className="w-20 rounded-lg border border-white/15 bg-zinc-900 px-2 py-1 text-sm tabular-nums text-zinc-100"
                    onChange={event => applyManualProgress(event.target.value)}
                />
                <input
                    ref={rangeRef}
                    type="range"
                    min={0}
                    max={100}
                    step={0.1}
                    defaultValue={progress.get()}
                    data-probe-progress-range=""
                    className="min-w-[220px] flex-1 accent-fuchsia-400"
                    onChange={event => applyManualProgress(event.target.value)}
                />
                <button
                    type="button"
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                    onClick={() => setAutoRun(prev => !prev)}
                >
                    {autoRun ? '暂停' : `自动跑 ${AUTO_DURATION_SEC}s`}
                </button>
                <button
                    type="button"
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                    onClick={() => applyManualProgress('0')}
                >
                    归零
                </button>
            </div>

            <BorderTuningControls
                tuning={tuning}
                onChange={patch => setTuning(prev => ({ ...prev, ...patch }))}
                onReset={() => setTuning(DEFAULT_BORDER_TUNING)}
            />
        </div>
    );
};

const probe: ProbeDefinition = {
    id: 'pulsingBorderProgress',
    title: 'PulsingBorder 进度描边（实验）',
    description: '改写 Paper Shaders 的 pulsing-border，加 u_progress 做 0→100 进度描边：圆环 + 「正在播放」卡片圆角边框。',
    Component: PulsingBorderProgressProbe,
};

export default probe;
