import React, { useState } from 'react';
import FmTab from '../../src/components/panelTab/FmTab';
import { panelTokens } from '../../src/components/panelTab/shell/panelTheme';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../src/services/baseThemes';
import { PlayerState } from '../../src/types';
import type { ProbeDefinition } from './definition';
// dev/probes/fmTab.probe.tsx

/**
 * FM 面板只在私人 FM 播放时出现，整应用测试很难走到那个状态。这里单独挂它，用来看模式入口
 * 胶囊的位置和明暗两套配色，以及没有模式能力的 provider 下入口是否整块消失。
 */
const FmTabProbe: React.FC = () => {
    const [isDaylight, setIsDaylight] = useState(false);
    const [supported, setSupported] = useState(true);
    const [openCount, setOpenCount] = useState(0);

    return (
        <div
            className="flex min-h-screen flex-col items-center justify-center gap-6 p-10"
            style={{
                backgroundColor: isDaylight ? '#f4f4f5' : '#0b0b0d',
                ['--bg-color' as string]: isDaylight ? '#f4f4f5' : '#0b0b0d',
                ['--text-primary' as string]: isDaylight ? '#18181b' : '#fafafa',
            }}
            data-probe-open-count={openCount}
        >
            <div className="flex gap-3 text-xs" style={{ color: isDaylight ? '#18181b' : '#fafafa' }}>
                <button data-probe-toggle="daylight" onClick={() => setIsDaylight(value => !value)}>
                    toggle daylight
                </button>
                <button data-probe-toggle="supported" onClick={() => setSupported(value => !value)}>
                    toggle fm modes
                </button>
            </div>
            {/* 面板的颜色和动效变量平时由面板外框给，探针里自己给。 */}
            <div
                className="st-window w-[360px] rounded-2xl border border-white/10 p-3"
                style={panelTokens(isDaylight, isDaylight ? DAYLIGHT_THEME : DEFAULT_THEME, false)}
            >
                <FmTab
                    playerState={PlayerState.PLAYING}
                    modeLabel="场景 · 助眠"
                    onOpenModePicker={supported ? () => setOpenCount(count => count + 1) : undefined}
                    onTogglePlay={() => {}}
                    onNextTrack={() => {}}
                    onPrevTrack={() => {}}
                    onTrash={() => {}}
                    onLike={() => {}}
                    isLiked={false}
                />
            </div>
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'fmTab',
    title: '播放面板 · 私人 FM',
    description: 'FM 控制面板与模式入口胶囊。验证入口位置、明暗配色，以及不支持模式时入口是否消失。',
    Component: FmTabProbe,
};

export default definition;
