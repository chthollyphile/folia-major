import React, { useState } from 'react';
import { motionValue } from 'framer-motion';
import FloatingPlayerControls from '../../src/components/FloatingPlayerControls';
import VisualizerSubtitleOverlay from '../../src/components/visualizer/VisualizerSubtitleOverlay';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import { PlayerBottomBarLayoutContext } from '../../src/components/floating-player/PlayerBottomBarLayoutContext';
import { playerBottomBarLiveOffset } from '../../src/stores/motionSignals';
import { usePlayerBottomBarLayoutStore } from '../../src/stores/usePlayerBottomBarLayoutStore';
import { PLAYER_BOTTOM_BAR_BASE_OFFSET_PX } from '../../src/utils/playerBottomBarLayout';
import { PlayerState } from '../../src/types';
import type { PlayerControlSlotActionId } from '../../src/components/floating-player/playerControlSlotActions';
import { GridListSearchButton } from '../../src/components/shared/GridListSearchButton';
import OnlineProviderSwitcher from '../../src/library/suites/grid/account/OnlineProviderSwitcher';
import type { ProbeDefinition } from './definition';
// dev/probes/playerBottomBar.probe.tsx

const currentTime = motionValue(42);

/**
 * 底部基线的两件事只在真实浏览器里暴露：
 * 1. 定位模式下 pointer-events 是否真的挡住了进度条的 seek（层叠 + 命中测试）
 * 2. 拖动写 MotionValue 后，胶囊是否由 bottom 真正位移且不触发 React 重渲染
 * 探针把 liveOffset 的当前值镜像到 data 属性上，好让用例断言它。
 */
const PlayerBottomBarProbe: React.FC = () => {
    const isPositioning = usePlayerBottomBarLayoutStore(state => state.isPositioning);
    const startPositioning = usePlayerBottomBarLayoutStore(state => state.startPositioning);
    const [committedOffset, setCommittedOffset] = useState(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
    const [seekCount, setSeekCount] = useState(0);
    const [playerNavigations, setPlayerNavigations] = useState(0);
    const [slotHits, setSlotHits] = useState<string[]>([]);
    const [slotPrimary, setSlotPrimary] = useState<PlayerControlSlotActionId>('loop');
    const [slotSecondary, setSlotSecondary] = useState<PlayerControlSlotActionId>('lyrics-timeline');
    const [offsetMirror, setOffsetMirror] = useState(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
    // 控制条自动隐藏：字幕要平滑让位，用例靠采样这段过渡判断有没有动画
    const [chromeHidden, setChromeHidden] = useState(false);
    // 模拟「命令此刻不可用」（首页、Personal FM 等），界面类槽位应该置灰而不是静默失败
    const [commandsInvocable, setCommandsInvocable] = useState(true);

    // 只在探针里做这种镜像；产品代码不允许把这个值写进 React state。
    React.useEffect(() => playerBottomBarLiveOffset.on(
        'change',
        value => setOffsetMirror(Math.round(value)),
    ), []);

    return (
        <div
            className="relative h-screen bg-zinc-900"
            data-probe-positioning={isPositioning ? 'on' : 'off'}
            data-probe-offset={offsetMirror}
            data-probe-committed={committedOffset}
            data-probe-seeks={seekCount}
            data-probe-player-navigations={playerNavigations}
            data-probe-slot-hits={slotHits.join(',')}
        >
            <div className="absolute left-4 top-4 z-[80] flex flex-wrap gap-2">
                <button type="button" data-probe-action="start" onClick={startPositioning}>start positioning</button>
                <button type="button" data-probe-action="slot-like" onClick={() => setSlotPrimary('like')}>slot1=like</button>
                <button type="button" data-probe-action="slot-queue" onClick={() => setSlotSecondary('queue')}>slot2=queue</button>
                <button type="button" data-probe-action="toggle-chrome" onClick={() => setChromeHidden(v => !v)}>toggle chrome</button>
                <button type="button" data-probe-action="block-commands" onClick={() => setCommandsInvocable(false)}>block commands</button>
            </div>

            {/* 预览里的字幕：不在 Provider 内，必须始终停在默认位置，不受底栏偏移影响 */}
            <div data-probe-subtitle-preview className="absolute inset-0">
                <VisualizerSubtitleOverlay
                    currentTime={currentTime}
                    showText
                    activeLine={{ startTime: 0, endTime: 9, fullText: 'Preview line', translation: 'Preview subtitle' } as never}
                    recentCompletedLine={null}
                    nextLines={[]}
                    theme={DEFAULT_THEME}
                    translationFontSize="1rem"
                    upcomingFontSize="0.9rem"
                />
            </div>

            {/* 播放页宿主里的字幕：位置跟着同一条基线，控制条进出时走 spring */}
            <PlayerBottomBarLayoutContext.Provider value={true}>
            <div data-probe-subtitle-host className="absolute inset-0">
                <VisualizerSubtitleOverlay
                    currentTime={currentTime}
                    showText
                    activeLine={{ startTime: 0, endTime: 9, fullText: 'Probe line', translation: 'Probe subtitle' } as never}
                    recentCompletedLine={null}
                    nextLines={[]}
                    theme={DEFAULT_THEME}
                    translationFontSize="1rem"
                    upcomingFontSize="0.9rem"
                    isPlayerChromeHidden={chromeHidden}
                />
            </div>
            </PlayerBottomBarLayoutContext.Provider>

            <FloatingPlayerControls
                currentSong={{ name: 'Probe Song' }}
                playerState={PlayerState.PLAYING}
                currentTime={currentTime}
                duration={200}
                loopMode="all"
                currentView="player"
                audioSrc="probe://audio"
                canTogglePlay
                lyrics={null}
                onSeek={() => setSeekCount(count => count + 1)}
                onTogglePlay={() => { }}
                onToggleLoop={() => setSlotHits(hits => [...hits, 'loop'])}
                onNavigateToPlayer={() => setPlayerNavigations(count => count + 1)}
                isDaylight={false}
                slotPrimary={slotPrimary}
                slotSecondary={slotSecondary}
                slotContext={{
                    onShuffle: () => setSlotHits(hits => [...hits, 'shuffle']),
                    canShuffle: true,
                    onLike: () => setSlotHits(hits => [...hits, 'like']),
                    isLiked: false,
                    likeDisabled: false,
                    invokeCommandById: (id: string) => setSlotHits(hits => [...hits, `cmd:${id}`]),
                    canInvokeCommandById: () => commandsInvocable,
                }}
                onCommitBottomBarOffset={setCommittedOffset}
            />

            {/* 详情页右下操作按钮也消费同一抬升量。 */}
            <GridListSearchButton
                isDaylight={false}
                accentColor={DEFAULT_THEME.accentColor}
                listTitle="Probe list"
                searchTitle="Probe search"
                onOpenList={() => { }}
            />
            <OnlineProviderSwitcher
                providers={[{
                    providerId: 'netease',
                    displayName: 'NetEase Cloud Music',
                    shortName: 'NetEase',
                    availability: { configured: true },
                    status: 'anonymous',
                    user: null,
                    collections: [],
                }]}
                activeProviderId="netease"
                isDaylight={false}
                onSelect={() => { }}
                onLogout={() => { }}
                onBackToPlayer={() => { }}
            />
        </div>
    );
};

const definition: ProbeDefinition = {
    id: 'playerBottomBar',
    title: '浮动播放条 · 底部基线定位与按钮槽位',
    description: '定位模式下的拖动、虚线范围框、seek 是否被挡住，以及两个可自定义槽位的点击去向。',
    Component: PlayerBottomBarProbe,
};

export default definition;
