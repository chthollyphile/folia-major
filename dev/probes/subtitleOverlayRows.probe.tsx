import React from 'react';
import VisualizerSubtitleOverlay from '../../src/components/visualizer/VisualizerSubtitleOverlay';
import { resolveSubtitleFontSizes } from '../../src/components/visualizer/subtitleFontSizes';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import type { Line, SubtitleOverlayLayout } from '../../src/types';
import type { ProbeDefinition } from './definition';
// dev/probes/subtitleOverlayRows.probe.tsx

/**
 * 共用底部字幕的单行 / 双行 / 三行布局（SubtitleOverlayLayout）。
 *
 * 挂的是真实的 VisualizerSubtitleOverlay，只把歌词行和行布局交给按钮切换。
 * 要看的是：行按布局从上到下排、第一行之后的行小一档；这一句缺哪种数据就少哪一行、不留空行；
 * 「下一句」依次取接下来的两句；单行布局这一句什么都没有时，照旧改为预览接下来的歌词。
 */

const LINES: Record<string, Line> = {
    both: { startTime: 1, endTime: 2, fullText: 'おはよう', romanization: 'ohayou', translation: '早安', words: [] },
    romanizationOnly: { startTime: 1, endTime: 2, fullText: 'おはよう', romanization: 'ohayou', words: [] },
    translationOnly: { startTime: 1, endTime: 2, fullText: 'おはよう', translation: '早安', words: [] },
    neither: { startTime: 1, endTime: 2, fullText: 'おはよう', words: [] },
};

const NEXT_LINES: Line[] = [
    { startTime: 2, endTime: 3, fullText: 'こんにちは', translation: '午安', words: [] },
    { startTime: 3, endTime: 4, fullText: 'こんばんは', translation: '晚上好', words: [] },
];

const LAYOUTS: SubtitleOverlayLayout[] = [
    'translation',
    'romanization',
    'current',
    'current+next',
    'current+translation',
    'current+romanization+translation',
    'current+next+next',
];

const SubtitleOverlayRowsProbe: React.FC = () => {
    const [layout, setLayout] = React.useState<SubtitleOverlayLayout>('current+romanization+translation');
    const [lineKey, setLineKey] = React.useState<keyof typeof LINES>('both');

    return (
        <div className="min-h-screen p-8 text-zinc-200" style={{ background: DEFAULT_THEME.backgroundColor }}>
            <div className="flex flex-wrap gap-2 text-xs">
                {LAYOUTS.map(value => (
                    <button
                        key={value}
                        type="button"
                        data-probe-layout={value}
                        className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5"
                        onClick={() => setLayout(value)}
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
            </div>
            <div className="relative mt-6 h-96 w-full overflow-hidden rounded-xl border border-white/10">
                <VisualizerSubtitleOverlay
                    showText
                    activeLine={LINES[lineKey]}
                    recentCompletedLine={null}
                    nextLines={NEXT_LINES}
                    theme={DEFAULT_THEME}
                    {...resolveSubtitleFontSizes(1)}
                    subtitleOverlayLayout={layout}
                />
            </div>
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'subtitleOverlayRows',
    title: '底部字幕单行 / 双行 / 三行',
    description: '各种行布局从上到下排、第一行之后小一档；缺数据的行省略不留空；「下一句」依次取接下来的两句。',
    Component: SubtitleOverlayRowsProbe,
};

export default definition;
