import React, { useEffect, useState } from 'react';
import { motionValue } from 'framer-motion';
import AppShell from '../../src/components/app/AppShell';
import AppDialogs from '../../src/components/app/dialogs/AppDialogs';
import CommandPalette from '../../src/components/command-palette/CommandPalette';
import type { CommandPaletteContext } from '../../src/components/command-palette/types';
import VisualizerShell from '../../src/components/visualizer/VisualizerShell';
import FloatingPlayerControls from '../../src/components/FloatingPlayerControls';
import NowPlayingToast from '../../src/components/app/overlays/NowPlayingToast';
import { usePlayerOverlayObstacle } from '../../src/hooks/usePlayerOverlayLayout';
import { FoliumStageLayerSlot, stageLayersRegistry } from '../../src/mods/folium/registries/stageLayers';
import { DEFAULT_THEME } from '../../src/services/baseThemes';
import { playerBottomBarLiveOffset } from '../../src/stores/motionSignals';
import { PlayerState } from '../../src/types';
import activateLayoutDemo from '../folium/player-layout-demo/client.mjs';
import type { ProbeDefinition } from './definition';
import { createFoliumClientApi } from '../../src/mods/folium/api';
import { PlayerBottomBarLayoutContext } from '../../src/components/floating-player/PlayerBottomBarLayoutContext';

// dev/probes/playerLayout.probe.tsx
// Real native controls and a existing stage-layer mod exercise pointer reveal and animated geometry.

const clock = motionValue(42);
const power = motionValue(0);
const bands = { bass: power, lowMid: power, mid: power, vocal: power, treble: power, high: power };
const noop = () => {};
const noCommand = async () => false;
// No commands are registered: this probe exercises only the real palette's overlay event boundary.
const commandContext = { scope: {} } as CommandPaletteContext;

const DemoLayer: React.FC = () => {
    useEffect(() => {
        activateLayoutDemo(createFoliumClientApi({
            id: 'player-layout-demo', name: 'Player layout example', version: '2.1.0', author: null, description: null,
            permissions: ['ui.stage'], experimental: ['player.layout'], embedOrigins: [],
            status: 'loaded', error: null, enabled: true, trustStale: false, devSource: false,
            signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
            folia: null, hasMain: false, clientUrl: null,
        }, { context: 'main', experimental: {}, onRelease: () => {}, stopped: () => false }));
        return () => {
            stageLayersRegistry.unregisterAll('player-layout-demo');
        };
    }, []);
    return <FoliumStageLayerSlot slot="app.overlay" theme={DEFAULT_THEME} isDaylight={false}
        paused className="absolute inset-0 pointer-events-none z-[1000]" />;
};

const PlayerLayoutProbe: React.FC = () => {
    const [active, setActive] = useState(true);
    const [enabled, setEnabled] = useState(true);
    const [backHits, setBackHits] = useState(0);
    const [cardHits, setCardHits] = useState(0);
    const [panel, setPanel] = useState(false);
    const [lowerPanel, setLowerPanel] = useState(false);
    const [toast, setToast] = useState(false);
    const [toastVersion, setToastVersion] = useState(0);
    const [hidden, setHidden] = useState(false);
    const [staticVisuals, setStaticVisuals] = useState(false);
    const [settings, setSettings] = useState(false);
    const [command, setCommand] = useState(false);
    const [customChrome, setCustomChrome] = useState(true);
    const { ref: panelRef } = usePlayerOverlayObstacle('player-panel', 'panel');
    useEffect(() => () => playerBottomBarLiveOffset.set(32), []);
    return <>
        <AppShell appStyle={{ background: '#171321' }} theme={DEFAULT_THEME} isElectronWindow={false}
            hideFullscreenButton={false} usesCustomWindowChrome={customChrome} useCustomWindowRadius={false}
            showTransparentWindowBorder={false} isPlayerView={active} isTitlebarRevealed
            alwaysShowMainWindowTitlebar={false} isMainWindowClickThroughEnabled={false}
            showMainWindowClickThroughToggle={false} onToggleMainWindowClickThrough={noop}
            isDaylight={false} audioElement={null}>
            <div data-probe-layout data-back-hits={backHits} data-card-hits={cardHits} className="absolute inset-0">
                <PlayerBottomBarLayoutContext.Provider value={active}>
                    <VisualizerShell theme={DEFAULT_THEME} audioPower={power} audioBands={bands}
                        renderBackground={false} sharedProps={{ onBack: () => setBackHits(v => v + 1), isPanelOpen: panel, staticMode: staticVisuals }}>
                        <div className="text-white/30">Native player layout</div>
                        <div data-probe-shell-child onMouseMove={event => event.stopPropagation()}
                            className="absolute left-20 top-20 w-8 h-8" />
                    </VisualizerShell>
                </PlayerBottomBarLayoutContext.Provider>
                <FloatingPlayerControls currentSong={{ name: 'Layout probe' }} playerState={PlayerState.PLAYING}
                    currentTime={clock} duration={180} loopMode="all" currentView="player" audioSrc={null}
                    canTogglePlay lyrics={null} onSeek={noop} onTogglePlay={noop} onToggleLoop={noop}
                    onNavigateToPlayer={noop} isDaylight={false} isHidden={hidden}
                    slotPrimary="loop" slotSecondary="lyrics-timeline" slotContext={{
                        onShuffle: noop, canShuffle: true, onLike: noop, isLiked: false, likeDisabled: false,
                        invokeCommandById: noop, canInvokeCommandById: () => true,
                    }} onCommitBottomBarOffset={noop} />
                <NowPlayingToast song={{ title: 'Native song card', artist: 'Probe', coverUrl: null }}
                    trackKey="probe" mode="always" isDaylight={false} onActivate={() => setCardHits(v => v + 1)}
                    activateLabel="Activate native card" />
                {panel && <div ref={panelRef} data-probe-panel style={{ top: lowerPanel ? '40%' : 96 }}
                    className="absolute right-8 bottom-24 w-80 bg-zinc-800 rounded-3xl z-60" />}
                {enabled && <DemoLayer />}
            </div>
        </AppShell>
        <AppDialogs model={{
            statusToast: toast ? { type: 'success', text: `Native status toast ${toastVersion}`, toastKey: `probe-${toastVersion}`, isDaylight: false } : null,
            settingsDialog: settings ? {
                onClose: () => setSettings(false), initialTab: 'help', theme: DEFAULT_THEME, bgMode: 'default',
                onApplyDefaultTheme: noop, hasCustomTheme: false,
                themeParkInitialTheme: { light: DEFAULT_THEME, dark: DEFAULT_THEME },
                isCustomThemePreferred: false, songThemeAutoSwitchEnabled: false, songThemeAutoGenerateEnabled: false,
                onSaveCustomTheme: noop, onSaveAiTheme: noop, onApplyCustomTheme: noop,
                onToggleCustomThemePreferred: noop, onToggleSongThemeAutoSwitch: noop,
                themeGenerationSource: 'cover', onChangeThemeGenerationSource: noop, onToggleSongThemeAutoGenerate: noop,
                loadLyricFilterPreview: async () => null, currentLyrics: null, lyricCurrentTime: clock,
                onSaveLyricFilterPattern: noop, onAudioOutputDeviceChange: () => true,
                replayGainMode: 'off', onReplayGainModeChange: noop,
            } : null,
        }} />
        <CommandPalette activeIndex={0} activePreview={null} activeCommand={null} availableCommands={[]}
            context={commandContext} isDaylight={false} isComposing={false} isExecuting={false} isOpen={command}
            matches={[]} pinnedCommands={[]} query="" theme={DEFAULT_THEME}
            onActiveCommandChange={noop} onActiveIndexChange={noop} onClose={() => setCommand(false)}
            onCompositionEnd={noop} onCompositionStart={noop} onExecuteActive={noCommand}
            onExecuteMatch={noCommand} onExecutePinnedCommand={noCommand} onQueryChange={noop} onQueryCommit={noop} />
        <div className="fixed left-1/2 -translate-x-1/2 top-40 z-[11000] flex flex-wrap gap-2 text-white text-xs">
            <button data-probe-action="settings" onClick={() => setSettings(v => !v)}>Toggle settings</button>
            <button data-probe-action="command" onClick={() => setCommand(v => !v)}>Toggle commands</button>
            <button data-probe-action="titlebar" onClick={() => setCustomChrome(v => !v)}>Toggle custom titlebar</button>
            <button data-probe-action="panel" onClick={() => { setLowerPanel(false); setPanel(v => !v); }}>Toggle panel</button>
            <button data-probe-action="lower-panel" onClick={() => { setLowerPanel(true); setPanel(true); }}>Lower panel</button>
            <button data-probe-action="toast" onClick={() => setToast(v => !v)}>Toggle toast</button>
            <button data-probe-action="replace-toast" onClick={() => setToastVersion(v => v + 1)}>Replace toast</button>
            <button data-probe-action="lift" onClick={() => playerBottomBarLiveOffset.set(120)}>Lift bottom bar</button>
            <button data-probe-action="chrome" onClick={() => setHidden(v => !v)}>Toggle chrome</button>
            <button data-probe-action="static" onClick={() => setStaticVisuals(v => !v)}>Toggle static visuals</button>
            <button data-probe-action="mod" onClick={() => setEnabled(v => !v)}>Toggle mod</button>
            <button data-probe-action="page" onClick={() => setActive(v => !v)}>Toggle player page</button>
        </div>
    </>;
};

const definition: ProbeDefinition = {
    id: 'playerLayout', title: '播放器覆盖层 · 公开几何与控件避让',
    description: '示例模组声明 player.layout 后只通过 ctx.getLayout() 定位，检查隐藏返回按钮唤出、侧栏、卡片、Toast、底栏移动和页面切换。',
    Component: PlayerLayoutProbe,
};
export default definition;
