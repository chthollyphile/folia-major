import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { LibraryPlayerBackdrop } from '../../core/suite/suite.contract';
import { useLibraryWallLookStore } from '../../../stores/useLibraryWallLookStore';
import type { LibraryWallSeamStyle } from '../../../utils/libraryWallSeamStyle';
import { backdropReportFor, occludesPlayerFor, type BravaisWallLook } from './bravaisLook';

// src/library/suites/bravais/useBravaisWallLook.ts
// stage 读墙面偏好（app 层的 useLibraryWallLookStore，设置页与命令面板写它），并向宿主报告两件事：
// - 遮挡：实色档、且缝不是「始终透明」时完全盖住播放页报 true（宿主在首页完全显示后卸载 visualizer），其余报 false
//   （有窗、缝是半透明 / 透明的）。2026-10-09 起透明的缝也算透光处：实色墙 + 透明缝时 visualizer 不能卸载。
// - 透出的画面（backdrop）：歌词文字、模糊两个开关，只在墙或缝透着时才报 true（宿主只在首页显示着时按它调 visualizer）。
// 报告放在 effect 里（提交并绘制之后），实色档的墙面那时已经画好；卸载时不用复位，宿主自动复位。

export type BravaisSeamLook = {
    /** 信息条始终透明（设置）。 */
    seamClear: boolean;
    /** 实色模式的预设；透明开着时为 null（预设不生效）。 */
    seamStyle: LibraryWallSeamStyle | null;
    /** 报给宿主的模糊（有透出且开了模糊）：缝的透明材质据此用较淡的一档。 */
    backdropBlur: boolean;
};

export const useBravaisWallLook = (
    reportPlayerOcclusion: (occludes: boolean) => void,
    reportPlayerBackdrop: (backdrop: LibraryPlayerBackdrop) => void,
): { wallLook: BravaisWallLook; seamLook: BravaisSeamLook } => {
    const { look, windowsPerBlock, seamClear, seamStyle, backdropLyrics, backdropBlur } = useLibraryWallLookStore(useShallow(state => ({
        look: state.look,
        windowsPerBlock: state.windowsPerBlock,
        seamClear: state.seamClear,
        seamStyle: state.seamStyle,
        backdropLyrics: state.backdropLyrics,
        backdropBlur: state.backdropBlur,
    })));
    const backdrop = backdropReportFor(look, seamClear, backdropLyrics, backdropBlur);

    useEffect(() => {
        reportPlayerOcclusion(occludesPlayerFor(look, seamClear));
    }, [look, reportPlayerOcclusion, seamClear]);
    useEffect(() => {
        reportPlayerBackdrop({ lyrics: backdrop.lyrics, blur: backdrop.blur });
    }, [backdrop.blur, backdrop.lyrics, reportPlayerBackdrop]);

    const wallLook = useMemo(() => ({ look, windowsPerBlock }), [look, windowsPerBlock]);
    const seamLook = useMemo<BravaisSeamLook>(() => ({
        seamClear,
        seamStyle: seamClear ? null : seamStyle,
        backdropBlur: backdrop.blur,
    }), [backdrop.blur, seamClear, seamStyle]);
    return { wallLook, seamLook };
};
