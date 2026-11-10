import React, { useState } from 'react';
import GlobalLyricOffsetRuler from '../../src/components/modal/settings/GlobalLyricOffsetRuler';
import { settingsTokens } from '../../src/components/modal/settings/kit/kitTheme';
import { kitMotionTokens } from '../../src/components/modal/settings/kit/motion';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import { clampGlobalLyricTimelineOffsetMs, GLOBAL_LYRIC_TIMELINE_OFFSET_LIMIT_MS } from '../../src/stores/useLyricSettingsStore';
import type { ProbeDefinition } from './definition';
// dev/probes/globalLyricOffsetRuler.probe.tsx

/**
 * 刻度尺的坑都在浏览器里：mask 裁掉边缘后中线还得留住、刻度带的 transform 与命中区
 * 是否互相盖住、pointer capture 拖动是否跟手。这里复刻校准卡片的深色外框来看真实观感。
 */
const GlobalLyricOffsetRulerProbe: React.FC = () => {
    const [valueMs, setValueMs] = useState(0);

    return (
        <div
            className="flex min-h-screen items-center justify-center p-10"
            // 刻度尺的颜色和动效取设置外框给的变量，平时由弹窗给，探针里自己给。
            style={{ ['--text-primary' as string]: '#fafafa', ...settingsTokens(false, DEFAULT_THEME), ...kitMotionTokens(false) }}
            data-probe-offset={valueMs}
        >
            <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="mb-4 text-center font-mono text-3xl font-semibold tabular-nums text-white">
                    {valueMs > 0 ? `+${valueMs}` : valueMs}
                    <span className="ml-1 text-sm text-white/50">ms</span>
                </div>
                <GlobalLyricOffsetRuler
                    valueMs={valueMs}
                    limitMs={GLOBAL_LYRIC_TIMELINE_OFFSET_LIMIT_MS}
                    ariaLabel="Global timing offset"
                    onChange={(next) => setValueMs(clampGlobalLyricTimelineOffsetMs(next))}
                />
            </div>
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'globalLyricOffsetRuler',
    title: '全局时间偏移 · 刻度尺',
    description: '中线固定、刻度带跟手的延迟校准尺。验证 mask 边缘、命中区与拖动跟手度。',
    Component: GlobalLyricOffsetRulerProbe,
};

export default definition;
