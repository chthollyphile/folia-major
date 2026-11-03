import { useMemo, type MutableRefObject } from 'react';
import { useLibrarySuiteChromeRegistration } from '../../core/suite/useLibrarySuiteChromeRegistration';
import type { WallSlot } from '../../../components/wall/wallSlots';
import { locatePlayingSongOnPage } from '../../../components/app/playing-song-locator/playingSongLocator';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import type { BravaisDisplay } from './bravaisDisplay';
import { useLibraryWallLookStore } from '../../../stores/useLibraryWallLookStore';
import { nextWallLook, stepWindowsPerBlock } from './bravaisLook';
import { useBravaisSeamStore } from './bravaisSeamLevel';
import { useBravaisUiStore } from './bravaisUiStore';
import type { BravaisFrameState } from './useBravaisFrame';
import { findItemSlotNearSeam } from './useBravaisLocate';

// src/library/suites/bravais/useBravaisChromeActions.ts
// bravais 的外观动作（B2 的 suite-chrome）：缝的三级开口（展开 / 收起成书脊 / 折叠）、在这里裂开缝、定位正在播放。
// B6b③ 追加透光的循环档位与每块窗数的步进。
// 元数据（文案、关键词、执行键）静态声明在 entry.ts 的 chromeActions；这里只注册「此刻能不能做」与「怎么做」，
// 只在 stage 此刻可交互（当前层归 bravais）时注册。isAvailable 在命令面板列命令时现读帧状态与 store，不进 React。

export const BRAVAIS_SUITE_ID = 'bravais';

/** 透光的三条外观动作：循环档位；部分透明且没到边界时多开 / 少开一个窗。 */
const wallLookHandlers = (hasLayer: () => boolean) => {
    const wallLook = () => useLibraryWallLookStore.getState();
    const step = (delta: 1 | -1) => ({
        isAvailable: () => hasLayer() && stepWindowsPerBlock(wallLook(), delta) !== null,
        run: () => {
            const next = stepWindowsPerBlock(wallLook(), delta);
            if (next !== null) wallLook().setWindowsPerBlock(next);
        },
    });
    return {
        'wall-look': { isAvailable: hasLayer, run: () => wallLook().setLook(nextWallLook(wallLook().look)) },
        'more-windows': step(1),
        'fewer-windows': step(-1),
    };
};

export const useBravaisChromeActions = ({
    active,
    displayRef,
    frameRef,
    isCollapsed,
    reopenHere,
    showSlot,
    openList,
}: {
    active: boolean;
    displayRef: MutableRefObject<BravaisDisplay | null>;
    frameRef: MutableRefObject<BravaisFrameState>;
    /** 缝本该张开却被挤到屏外收起了。 */
    isCollapsed: () => boolean;
    reopenHere: () => void;
    /** 定位到墙上的一份（stage 的 showSlot：歌曲展开聚焦卡）。 */
    showSlot: (slot: WallSlot) => void;
    /** B7：打开列表面板。 */
    openList?: () => void;
}) => {
    const handlers = useMemo(() => {
        const level = () => useBravaisSeamStore.getState().level;
        const setLevel = useBravaisSeamStore.getState().setLevel;
        const hasLayer = () => displayRef.current !== null;
        /** 正在播放的那首离缝最近的一份（无限拼贴上有好几份）。 */
        const nowPlayingSlot = () => {
            const display = displayRef.current;
            const key = display?.layer.nowPlayingKey;
            return display && key ? findItemSlotNearSeam(display, key, frameRef.current) : null;
        };
        /** 这一层被「定位正在播放」问时用的页键（集合层才有；首页层没有，照旧自己在墙上找）。 */
        const locatePageKey = () => displayRef.current?.layer.locate?.pageKey ?? null;
        return {
            'seam-full': { isAvailable: () => hasLayer() && level() !== 'full', run: () => setLevel('full') },
            'seam-spine': { isAvailable: () => hasLayer() && level() !== 'spine', run: () => setLevel('spine') },
            'seam-hide': { isAvailable: () => hasLayer() && level() !== 'hidden', run: () => setLevel('hidden') },
            'seam-here': { isAvailable: () => hasLayer() && level() !== 'hidden' && isCollapsed(), run: reopenHere },
            // B7：打开列表（grid 的 toggle-track-list 在 bravais 的对应）；只有支持面板的层、面板还没开时可用。
            list: {
                isAvailable: () => {
                    const layer = displayRef.current?.layer;
                    return Boolean(openList && layer?.surface !== 'home' && layer?.entries?.hasPanel && useBravaisUiStore.getState().panelFor !== layer.key);
                },
                run: () => openList?.(),
            },
            // B9：打开目录树（首页「本地」有批量的那几行；面板 = 批量模式）。
            directory: {
                isAvailable: () => {
                    const layer = displayRef.current?.layer;
                    return Boolean(openList && layer?.surface === 'home' && layer.entries?.hasPanel && useBravaisUiStore.getState().panelFor !== layer.key);
                },
                run: () => openList?.(),
            },
            // 集合层与网格的集合页一样问定位器（有歌在放就能按，不在墙上时状态行说「这里没有」，useBravaisLocate 回答）；
            // 首页层不参与，歌在墙上才可用。工具按钮上方的定位按钮（BravaisStageChrome）按下也走这里。
            'locate-playing': {
                isAvailable: () => (locatePageKey() !== null ? usePlaybackStore.getState().currentSong !== null : nowPlayingSlot() !== null),
                run: () => {
                    const pageKey = locatePageKey();
                    if (pageKey !== null) {
                        locatePlayingSongOnPage(pageKey);
                        return;
                    }
                    const slot = nowPlayingSlot();
                    if (slot) showSlot(slot);
                },
            },
            // 透光（B6b③）：写 app 层偏好，stage 读它换档（同一层的数据更新，只翻开窗 / 关窗与内容挪了的 slot）。
            ...wallLookHandlers(hasLayer),
        };
    }, [displayRef, frameRef, isCollapsed, openList, reopenHere, showSlot]);

    useLibrarySuiteChromeRegistration({ suiteId: BRAVAIS_SUITE_ID, isInteractive: active, handlers });
    // 实测反馈 1：右下角的定位按钮（BravaisStageChrome）直接用同一份实现（定位正在播放），不另写一遍。
    return handlers;
};
