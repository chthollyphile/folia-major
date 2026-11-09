import React from 'react';
import FloatingPlayerControls from '../../FloatingPlayerControls';
import SearchWorkspace from '../search/SearchWorkspace';
import DevDebugOverlay from '../../DevDebugOverlay';
import MemoryMonitorWindow from '../../debug/MemoryMonitorWindow';
import NowPlayingToast from './NowPlayingToast';
import HifiSignalPathPanel from '../../hifi/HifiSignalPathPanel';
import type { AppOverlaysModel } from './buildAppOverlaysModel';
import { countRender } from '../../../dev/renderCount';
import { useLatticeControlsStore } from '../../../stores/useLatticeControlsStore';
import { useBottomDockStore } from '../../../stores/useBottomDockStore';
import { useBottomLayoutTracking } from '../../../hooks/useBottomLayoutTracking';
import { useNowPlayingCardLayoutStore } from './now-playing-toast/nowPlayingCardLayoutStore';
import { useTransitionBorderCue } from './now-playing-toast/useTransitionBorderCue';

// Centralized app-level overlay renderer so App.tsx does not mount leaf overlays directly.
type AppOverlaysProps = {
    model: AppOverlaysModel;
};

const AppOverlays: React.FC<AppOverlaysProps> = ({ model }) => {
    countRender('AppOverlays');
    const isCurrentSongPosterVisible = useLatticeControlsStore(state => state.isCurrentSongPosterVisible);
    // 主窗口按宽度在紧凑档和桌面档之间切换（progress-bar v3）。紧凑档里卡片收进胶囊左端，这里不再单独画它；
    // 拖卡片位置的时候例外（那是给宽屏用的位置，得让人看见卡片才能拖）。
    useBottomLayoutTracking();
    const isCompact = useBottomDockStore(state => state.layout === 'compact');
    const isPositioningCard = useNowPlayingCardLayoutStore(state => state.isPositioning);
    const {
        searchOverlay,
        debugOverlay,
        memoryMonitor,
        floatingControls,
        nowPlayingToast,
    } = model;

    const showsCapsule = Boolean(floatingControls)
        && (floatingControls?.currentView !== 'lattice' || !isCurrentSongPosterVisible);
    // 紧凑档里卡片在胶囊左端；胶囊不在（播放页关掉了进度条、Lattice 上当前歌海报盖着）时卡片退回宽屏的样子，
    // 不能两边都不画。胶囊在但隐身了（播放页控件自动隐藏、纯歌词页）时，卡片必须在场的几种情况（常驻、
    // 预告下一首、混音描边）也退回宽屏的样子；限时显示的那次报幕不退，否则每次控件一隐藏卡片就重新弹一次。
    const transitionCue = useTransitionBorderCue();
    const cardMustStay = nowPlayingToast !== null && nowPlayingToast !== undefined
        && (nowPlayingToast.mode === 'always' || nowPlayingToast.isNextUp === true || transitionCue !== null);
    const capsuleCarriesCard = isCompact && showsCapsule && !floatingControls?.hideControlBar
        && !(floatingControls?.isHidden && cardMustStay);

    return (
        <>
            {searchOverlay && <SearchWorkspace {...searchOverlay} />}

            {debugOverlay && <DevDebugOverlay {...debugOverlay} />}

            {memoryMonitor && <MemoryMonitorWindow {...memoryMonitor} />}

            {floatingControls && showsCapsule && <FloatingPlayerControls {...floatingControls} />}

            {nowPlayingToast && (!capsuleCarriesCard || isPositioningCard) && <NowPlayingToast {...nowPlayingToast} />}

            {/* The one HiFi signal-path sheet: the badge, the controls tab tile and the palette command open it through hifiPanelStore. */}
            <HifiSignalPathPanel />
        </>
    );
};

export default React.memo(AppOverlays);
