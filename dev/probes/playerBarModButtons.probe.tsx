import React, { useEffect, useState } from 'react';
import { motionValue } from 'framer-motion';
import FloatingPlayerControls from '../../src/components/FloatingPlayerControls';
import { progressButtonsRegistry } from '../../src/mods/folium/registries/progress';
import { createFoliumIcon } from '../../src/mods/folium/icons';
import type { FoliumProgressContext } from '../../src/mods/folium/contract';
import { PlayerState } from '../../src/types';
import type { ProbeDefinition } from './definition';
// dev/probes/playerBarModButtons.probe.tsx

const currentTime = motionValue(284);

// The same buttons mods/more-progress-buttons draws: 22px boxes with a 15px icon.
const MOD_BUTTONS = [
    { id: 'shuffle', slot: 'progress.leading', icon: 'shuffle' },
    { id: 'volume', slot: 'progress.trailing', order: 510, icon: 'volume-2' },
    { id: 'like', slot: 'progress.trailing', order: 520, icon: 'heart' },
] as const;
// What the mod writes into --folium-player-bar-extra for these three buttons.
const MOD_EXTRA_PX = 94;

const mountModButton = (icon: string) => (container: HTMLElement, ctx: FoliumProgressContext) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.probeModButton = icon;
    button.style.cssText = 'all:unset;display:flex;align-items:center;justify-content:center;width:22px;height:22px;opacity:0.7;';
    button.style.color = ctx.getColors().text;
    void createFoliumIcon(icon, { size: 15 }).then((svg) => { if (svg) button.appendChild(svg); });
    container.appendChild(button);
    return () => button.remove();
};

/**
 * 模组往进度条两侧加按钮会压短轨道，公开变量 --folium-player-bar-extra 把胶囊加宽补回来。
 * 宽度是真实 Tailwind 产物里 min()/calc() 算出来的，只有真实浏览器量得准。
 * 探针可以切换：模组按钮有无、变量有无、胶囊展开（暂停）或收起（播放）。
 */
const PlayerBarModButtonsProbe: React.FC = () => {
    const [buttons, setButtons] = useState(false);
    const [extra, setExtra] = useState(false);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        if (!buttons) return undefined;
        MOD_BUTTONS.forEach((def) => progressButtonsRegistry.register('probe-mod', {
            id: def.id,
            slot: def.slot,
            order: 'order' in def ? def.order : undefined,
            mount: mountModButton(def.icon),
        }));
        return () => progressButtonsRegistry.unregisterAll('probe-mod');
    }, [buttons]);

    useEffect(() => {
        if (!extra) return undefined;
        document.documentElement.style.setProperty('--folium-player-bar-extra', `${MOD_EXTRA_PX}px`);
        return () => { document.documentElement.style.removeProperty('--folium-player-bar-extra'); };
    }, [extra]);

    return (
        <div
            className="relative h-screen bg-zinc-900"
            data-probe-mod-buttons={buttons ? 'on' : 'off'}
            data-probe-extra={extra ? 'on' : 'off'}
            data-probe-expanded={expanded ? 'on' : 'off'}
        >
            <div className="absolute left-4 top-4 z-[80] flex flex-wrap gap-2 text-white">
                <button type="button" data-probe-action="buttons" onClick={() => setButtons(v => !v)}>mod buttons</button>
                <button type="button" data-probe-action="extra" onClick={() => setExtra(v => !v)}>bar extra</button>
                <button type="button" data-probe-action="expand" onClick={() => setExpanded(v => !v)}>expand</button>
            </div>

            <FloatingPlayerControls
                currentSong={{ name: '月の雫' }}
                playerState={expanded ? PlayerState.PAUSED : PlayerState.PLAYING}
                currentTime={currentTime}
                duration={312}
                loopMode="all"
                currentView="player"
                audioSrc="probe://audio"
                canTogglePlay
                lyrics={null}
                onSeek={() => { }}
                onTogglePlay={() => { }}
                onToggleLoop={() => { }}
                onNavigateToPlayer={() => { }}
                isDaylight={false}
                slotPrimary="loop"
                slotSecondary="lyrics-timeline"
                slotContext={{
                    onShuffle: () => { },
                    canShuffle: true,
                    onLike: () => { },
                    isLiked: false,
                    likeDisabled: false,
                    invokeCommandById: () => { },
                    canInvokeCommandById: () => true,
                }}
                onCommitBottomBarOffset={() => { }}
            />
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'playerBarModButtons',
    title: '浮动播放条 · 模组按钮与胶囊加宽',
    description: '模组在进度条两侧加按钮后，--folium-player-bar-extra 能否把轨道长度补回来（展开与收起两种状态）。',
    Component: PlayerBarModButtonsProbe,
};

export default definition;
