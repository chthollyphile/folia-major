import React from 'react';
import { useMotionValue } from 'framer-motion';
import VisualizerSubtitleOverlay from '../../src/components/visualizer/VisualizerSubtitleOverlay';
import { useVisualizerRuntime } from '../../src/components/visualizer/runtime';
import { resolveSubtitleFontSizes } from '../../src/components/visualizer/subtitleFontSizes';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import type { Line, SubtitleContentMode } from '../../src/types';
import type { ProbeDefinition } from './definition';
// dev/probes/subtitleDualRow.probe.tsx

/**
 * 共用底部副字幕的双行样式（issue #425）：罗马音在上、翻译在下。
 *
 * 挂的是真实的 VisualizerSubtitleOverlay，只把歌词行和内容模式交给按钮切换。
 * 要看的是：两种都有时两行叠放且罗马音在上；只有一种时只剩一行、不留空行；两种都没有时不渲染字幕行。
 * 时钟按钮覆盖短句间隔、长间奏和跳转（issue #486），不会逐帧刷新整个探针。
 */

const LINES: Record<string, Line> = {
    both: { startTime: 1, endTime: 2, fullText: 'おはよう', romanization: 'ohayou', translation: '早安', words: [] },
    romanizationOnly: { startTime: 1, endTime: 2, fullText: 'おはよう', romanization: 'ohayou', words: [] },
    translationOnly: { startTime: 1, endTime: 2, fullText: 'おはよう', translation: '早安', words: [] },
    neither: { startTime: 1, endTime: 2, fullText: 'おはよう', words: [] },
};

const MODES: SubtitleContentMode[] = ['translation', 'romanization', 'both', 'none'];
const NEXT_LINES: Line[] = [
    { startTime: 3, endTime: 4, fullText: 'こんにちは', romanization: 'konnichiwa', translation: '午安', words: [] },
    { startTime: 20, endTime: 22, fullText: 'こんばんは', romanization: 'konbanwa', translation: '晚安', words: [] },
];
const CLOCK_TIMES = [0, 1.5, 2.1, 2.5, 3.2, 4.1, 5.4, 5.5, 10, 20.5, 22.1, 23.5];

const SubtitleDualRowProbe: React.FC = () => {
    const [mode, setMode] = React.useState<SubtitleContentMode>('both');
    const [lineKey, setLineKey] = React.useState<keyof typeof LINES>('both');
    const currentTime = useMotionValue(1.5);
    const [currentLineIndex, setCurrentLineIndex] = React.useState(0);
    const lines = React.useMemo(() => [LINES[lineKey], ...NEXT_LINES], [lineKey]);
    const runtime = useVisualizerRuntime({ currentTime, currentLineIndex, lines });
    const renders = React.useRef(0);
    renders.current += 1;
    const seek = (time: number) => {
        currentTime.set(time);
        const index = lines.findIndex(line => time >= line.startTime && time <= line.endTime);
        if (index !== currentLineIndex) setCurrentLineIndex(index);
    };

    return (
        <div data-probe-renders={renders.current} className="min-h-screen p-8 text-zinc-200" style={{ background: DEFAULT_THEME.backgroundColor }}>
            <div className="flex flex-wrap gap-2 text-xs">
                {MODES.map(value => (
                    <button
                        key={value}
                        type="button"
                        data-probe-mode={value}
                        className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5"
                        onClick={() => setMode(value)}
                    >
                        {value}
                    </button>
                ))}
                {Object.keys(LINES).map(value => (
                    <button
                        key={value}
                        type="button"
                        data-probe-line={value}
                        className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5"
                        onClick={() => setLineKey(value)}
                    >
                        {value}
                    </button>
                ))}
                {CLOCK_TIMES.map(time => (
                    <button key={time} type="button" data-probe-time={time} onClick={() => seek(time)}>
                        {time}s
                    </button>
                ))}
            </div>
            <div className="relative mt-6 h-96 w-full overflow-hidden rounded-xl border border-white/10">
                <VisualizerSubtitleOverlay
                    currentTime={currentTime}
                    showText
                    activeLine={runtime.activeLine}
                    recentCompletedLine={runtime.recentCompletedLine}
                    nextLines={[]}
                    theme={DEFAULT_THEME}
                    {...resolveSubtitleFontSizes(1)}
                    subtitleContentMode={mode}
                />
            </div>
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'subtitleDualRow',
    title: '副字幕双行（罗马音 + 翻译）',
    description: '「罗马音 + 翻译」模式下两行叠放、罗马音在上；只有一种数据时只显示一行，不留空行。',
    Component: SubtitleDualRowProbe,
};

export default definition;
