import React from 'react';
import { Check, ChevronLeft, ChevronRight, Disc3, FileUp, FolderOpen, ListMusic, ListPlus, Map, Pencil, Play, Plus, RefreshCw, Trash2, User } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import { getRelativeLuminance } from '../../../../utils/themeColorMath';
import {
    LOCAL_GRID_CONTROLS_GEOMETRY as C,
    LOCAL_GRID_MAP_GEOMETRY as M,
    ONLINE_COLLECTION_ACTIONS_GEOMETRY as A,
} from './localLibrary.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/library/localLibrary.surface.tsx

type SurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

const Pill: React.FC<{
    marker: string;
    rect: Parameters<typeof relativeRectStyle>[0];
    icon: React.ComponentType<{ className?: string }>;
    accent: string;
    line: string;
    outline: string;
    active?: boolean;
    danger?: boolean;
}> = ({ marker, rect, icon: Icon, accent, line, outline, active = false, danger = false }) => (
    <span
        {...{ [marker]: '' }}
        className="absolute flex items-center gap-[8%] rounded-full border px-[4%]"
        style={{
            ...relativeRectStyle(rect),
            borderColor: danger ? '#ef4444' : outline,
            backgroundColor: active ? accent : line,
            opacity: active ? 0.72 : 0.88,
        }}
    >
        <Icon className="h-[48%] w-auto shrink-0" />
        <span className="h-[12%] flex-1 rounded-full" style={{ backgroundColor: danger ? '#ef4444' : outline }} />
    </span>
);

/** 画在 accent 底上的图标颜色：accent 亮就用深色，暗就用浅色。 */
const inkOn = (background: string) => (getRelativeLuminance(background) > 0.4 ? '#18181b' : '#fafafa');

/** 本地首页右上角那组分类、导入和刷新控件。 */
const PonderLocalGridControlsSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-local-grid-controls-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            {/* 和真实的 GridViewTabs 同形：一个居中的胶囊，先是「全部」，隔一条竖线后是分类；
                当前分类带文字，其余只剩图标。 */}
            <div
                data-ponder-local-grid-capsule
                className="absolute rounded-full border"
                style={{ ...relativeRectStyle(C.capsule), borderColor: outline, backgroundColor: line }}
            />
            <span
                data-ponder-local-grid-map
                className="absolute flex items-center gap-[8%] px-[2%]"
                style={relativeRectStyle(C.map)}
            >
                <Map className="h-[48%] w-auto shrink-0" />
                <span className="h-[12%] flex-1 rounded-full" style={{ backgroundColor: outline }} />
            </span>
            <span
                aria-hidden="true"
                className="absolute w-px"
                style={{ left: `${(C.map.left + C.map.width + 0.0125) * 100}%`, top: '26%', height: '16%', backgroundColor: outline }}
            />
            <div data-ponder-local-grid-tabs className="absolute flex items-stretch gap-[1%] p-[0.6%]" style={relativeRectStyle(C.tabs)}>
                {[
                    [FolderOpen, true],
                    [Disc3, false],
                    [User, false],
                    [ListMusic, false],
                ].map(([Icon, active], index) => (
                    <span
                        key={index}
                        data-ponder-local-grid-tab={index}
                        className={`flex h-full items-center justify-center gap-[8%] rounded-full ${active ? 'flex-[2.6] px-[6%]' : 'flex-1'}`}
                        // 选中项画在 accent 底上，图标和文字线条按 accent 的亮度取深色或浅色；沿用 outline/line
                        // 这类半透明色会和底色糊成一块空白。
                        style={{ backgroundColor: active ? accent : 'transparent', color: active ? inkOn(accent) : undefined, opacity: active ? 0.72 : 0.7 }}
                    >
                        {React.createElement(Icon as React.ComponentType<{ className?: string }>, { className: 'h-[48%] w-auto shrink-0' })}
                        {active && <span className="h-[12%] flex-1 rounded-full" style={{ backgroundColor: inkOn(accent) }} />}
                    </span>
                ))}
            </div>
            <Pill marker="data-ponder-local-grid-import" rect={{ left: 0.6, top: 0.18, width: 0.15, height: 0.32 }} icon={FolderOpen} accent={accent} line={line} outline={outline} />
            <Pill marker="data-ponder-local-grid-refresh" rect={C.refresh} icon={RefreshCw} accent={accent} line={line} outline={outline} />
            <Pill marker="data-ponder-local-grid-playlist-import" rect={C.playlistImport} icon={FileUp} accent={accent} line={line} outline={outline} />
        </PonderSurfaceBase>
    </div>
);

/** 在线与服务器集合的信息面板动作；不混入本地文件重扫、标签整理等语义。 */
const PonderOnlineCollectionActionsSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-online-collection-actions-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Pill marker="data-ponder-online-play-all" rect={A.playAll} icon={Play} accent={accent} line={line} outline={outline} active />
            <Pill marker="data-ponder-online-add-queue" rect={A.addQueue} icon={ListPlus} accent={accent} line={line} outline={outline} />
            <Pill marker="data-ponder-online-add-playlist" rect={A.addPlaylist} icon={Plus} accent={accent} line={line} outline={outline} />
            <Pill marker="data-ponder-online-provider-action" rect={A.providerAction} icon={Pencil} accent={accent} line={line} outline={outline} />
            <Pill marker="data-ponder-online-destructive-action" rect={A.destructiveAction} icon={Trash2} accent={accent} line={line} outline={outline} danger />
        </PonderSurfaceBase>
    </div>
);

/**
 * 蜂窝阵列。上下留白是给错行让的：单靠 translateY 错开，最上和最下那排会整块凸到
 * `cards` 锚点之外 —— 高亮框一亮，凸出去的那半张就明摆着和框对不上。
 */
const MapCards: React.FC<{ accent: string; line: string; outline: string }> = ({ accent, line, outline }) => (
    <div data-ponder-local-grid-map-cards className="absolute grid grid-cols-5 grid-rows-3 gap-[3%] py-[4%]" style={relativeRectStyle(M.cards)}>
        {Array.from({ length: 14 }, (_, index) => (
            <span
                key={index}
                className="rounded-[14%] border"
                style={{
                    borderColor: outline,
                    backgroundColor: index === 7 ? accent : line,
                    opacity: index === 7 ? 0.65 : 0.55,
                    transform: `translateY(${index % 2 ? '-8%' : '12%'})`,
                }}
            />
        ))}
    </div>
);

/** 本地 GridMap：蜂窝集合总览，以及标题展开后的批量选择目录树。 */
const PonderLocalGridMapSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-local-grid-map-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <span data-ponder-local-grid-map-back className="absolute flex items-center justify-center rounded-full border" style={{ ...relativeRectStyle(M.back), borderColor: outline }}>
                <ChevronLeft className="h-1/2 w-1/2" />
            </span>
            <span data-ponder-local-grid-map-title className="absolute flex items-center justify-center gap-[5%] rounded-2xl border" style={{ ...relativeRectStyle(M.title), borderColor: outline, backgroundColor: line }}>
                <Map className="h-[42%] w-auto" />
                <span className="h-[12%] w-[42%] rounded-full" style={{ backgroundColor: outline }} />
            </span>
            <MapCards accent={accent} line={line} outline={outline} />
        </PonderSurfaceBase>

        <PonderSurfaceStateLayer state="tree-open" registerStateNode={registerStateNode}>
            <div
                data-ponder-local-grid-map-panel
                className="absolute z-10 rounded-3xl border bg-zinc-950/95 p-[2%] shadow-2xl backdrop-blur-2xl"
                style={{ ...relativeRectStyle(M.panel), borderColor: outline }}
            >
                <span className="block h-[3%] w-[52%] rounded-full" style={{ backgroundColor: outline }} />
                <div data-ponder-local-grid-map-tree className="absolute overflow-hidden rounded-2xl border" style={{ ...relativeRectStyle({ left: 0.06, right: 0.06, top: 0.17, height: 0.54 }), borderColor: outline }}>
                    {[0, 1, 2, 3, 4].map(index => (
                        <span key={index} data-ponder-local-grid-map-row className="flex h-[19%] items-center gap-[4%] px-[4%]" style={{ paddingLeft: `${4 + Math.min(index, 2) * 5}%` }}>
                            <ChevronRight className="h-[36%] w-auto opacity-55" />
                            <span className="flex aspect-square h-[34%] items-center justify-center rounded border" style={{ borderColor: outline, backgroundColor: index === 1 ? accent : undefined }}>
                                {index === 1 && <Check className="h-[70%] w-[70%]" />}
                            </span>
                            <span className="h-[8%] flex-1 rounded-full" style={{ backgroundColor: outline, opacity: 0.75 }} />
                            {index === 0 && <RefreshCw className="h-[30%] w-auto opacity-55" />}
                        </span>
                    ))}
                </div>
                <div data-ponder-local-grid-map-actions className="absolute inset-x-[6%] bottom-[4%] flex gap-[4%]">
                    {[Play, ListPlus, Plus].map((Icon, index) => (
                        <span key={index} className="flex h-6 flex-1 items-center justify-center rounded-full border" style={{ borderColor: outline, backgroundColor: index === 0 ? accent : undefined }}>
                            <Icon className="h-1/2 w-auto" />
                        </span>
                    ))}
                </div>
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'local-grid-controls': PonderLocalGridControlsSurface,
    'online-collection-actions': PonderOnlineCollectionActionsSurface,
    'local-grid-map': PonderLocalGridMapSurface,
} satisfies PonderSurfaceDeclarations;
