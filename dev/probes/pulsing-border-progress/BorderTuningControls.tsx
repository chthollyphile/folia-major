import React from 'react';
import type { BorderTuning } from './PulsingBorderProgress';
// dev/probes/pulsing-border-progress/BorderTuningControls.tsx

/** 描边参数面板，用来找「像进度条」而不是「像特效」的那组值。 */

interface SliderSpec {
    key: keyof BorderTuning;
    label: string;
    min: number;
    max: number;
    step: number;
}

const SLIDERS: SliderSpec[] = [
    { key: 'thickness', label: 'thickness', min: 0, max: 0.3, step: 0.005 },
    { key: 'softness', label: 'softness', min: 0, max: 1, step: 0.01 },
    { key: 'intensity', label: 'intensity', min: 0, max: 1, step: 0.01 },
    { key: 'bloom', label: 'bloom', min: 0, max: 1, step: 0.01 },
    { key: 'spots', label: 'spots', min: 1, max: 4, step: 1 },
    { key: 'spotSize', label: 'spotSize', min: 0, max: 1, step: 0.01 },
    { key: 'pulse', label: 'pulse', min: 0, max: 1, step: 0.01 },
    { key: 'smoke', label: 'smoke', min: 0, max: 1, step: 0.01 },
    { key: 'speed', label: 'speed', min: 0, max: 3, step: 0.05 },
    { key: 'fade', label: 'fade（端点羽化）', min: 0, max: 0.12, step: 0.002 },
    { key: 'head', label: 'head（端点高光）', min: 0, max: 1.5, step: 0.05 },
    { key: 'base', label: 'base（完成段底色）', min: 0, max: 1, step: 0.01 },
    { key: 'track', label: 'track（轨道）', min: 0, max: 1, step: 0.01 },
];

interface BorderTuningControlsProps {
    tuning: BorderTuning;
    onChange: (patch: Partial<BorderTuning>) => void;
    onReset: () => void;
}

const BorderTuningControls: React.FC<BorderTuningControlsProps> = ({ tuning, onChange, onReset }) => (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300">参数调节</span>
            <button
                type="button"
                className="rounded-lg border border-white/15 px-2 py-1 text-[11px] text-zinc-300 hover:bg-white/10"
                onClick={onReset}
            >
                恢复默认
            </button>
        </div>
        <div className="grid grid-cols-2 gap-x-5 gap-y-2">
            {SLIDERS.map(spec => (
                <label key={spec.key} className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <span className="w-32 shrink-0">{spec.label}</span>
                    <input
                        type="range"
                        className="min-w-0 flex-1 accent-fuchsia-400"
                        min={spec.min}
                        max={spec.max}
                        step={spec.step}
                        value={tuning[spec.key]}
                        onChange={event => onChange({ [spec.key]: Number(event.target.value) } as Partial<BorderTuning>)}
                    />
                    <span className="w-10 shrink-0 text-right tabular-nums text-zinc-300">{tuning[spec.key]}</span>
                </label>
            ))}
        </div>
    </div>
);

export default BorderTuningControls;
