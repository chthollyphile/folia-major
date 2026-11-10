import React from 'react';
import {
    ArrowDownAZ,
    Command,
    List,
    ListPlus,
    Pencil,
    Play,
    Plus,
    RefreshCw,
    Search,
    SlidersHorizontal,
    Tags,
    Trash2,
    X,
} from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from '../PonderSurfaceStateLayer';
import {
    GRID_ACTION_BUTTON_GEOMETRY as A,
    GRID_VIEW_CARDS_GEOMETRY as G,
    LOCAL_FOLDER_ACTIONS_GEOMETRY as F,
    LOCAL_TRACK_LIST_GEOMETRY as T,
} from './gridView.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations } from '../surfaceDeclarations';

// src/components/ponder/surfaces/library/gridView.surface.tsx
// 集合页那一族：右下角的操作按钮、网格里的卡片、信息面板底部的来源动作、曲目列表侧板。
//
// 四块放一个文件，因为它们讲的是同一个页面的四个角落，改一处常常要顺手看另一处；
// 而它们和设置面板那几组（PonderSettingsSectionSurfaces / PonderAppearanceSettingsSurfaces）
// 没有任何共同的形状，混在一起只会让两边都难找。

type SurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

/** 信息面板和动作列里那种整宽的胶囊按钮。 */
const PillRow: React.FC<{
    rect: Parameters<typeof relativeRectStyle>[0];
    line: string;
    outline: string;
    icon: typeof Play;
    marker: string;
    tone?: 'plain' | 'primary' | 'danger';
    accent: string;
}> = ({ rect, line, outline, icon: Icon, marker, tone = 'plain', accent }) => (
    <span
        {...{ [marker]: true }}
        className="flex items-center justify-center gap-[6%] rounded-full border"
        style={{
            ...relativeRectStyle(rect),
            borderColor: tone === 'danger' ? '#ef4444' : tone === 'primary' ? accent : outline,
            backgroundColor: tone === 'danger' ? 'rgba(239,68,68,0.12)' : tone === 'primary' ? `${accent}1f` : 'rgba(255,255,255,0.04)',
            color: tone === 'danger' ? '#ef4444' : tone === 'primary' ? accent : undefined,
        }}
    >
        <Icon className="h-[38%] w-auto opacity-80" />
        <span
            className="h-1 w-[34%] rounded-full"
            style={{ backgroundColor: tone === 'danger' ? '#ef4444' : tone === 'primary' ? accent : line }}
        />
    </span>
);

/** 网格里的一张卡：封面、歌名、底部两颗动作。中间那张是焦点。 */
const GridCard: React.FC<{
    accent: string;
    line: string;
    outline: string;
    focused?: boolean;
    style?: React.CSSProperties;
}> = ({ accent, line, outline, focused, style }) => (
    <span
        data-ponder-grid-view-card
        className="flex flex-col overflow-hidden rounded-xl border"
        style={{
            ...style,
            borderColor: focused ? accent : outline,
            backgroundColor: focused ? `${accent}14` : 'rgba(255,255,255,0.03)',
            opacity: focused ? 1 : 0.5,
        }}
    >
        <span className="flex-1" style={{ backgroundColor: line }} />
        <span className="h-[34%] shrink-0" />
    </span>
);

/**
 * 海报墙右下角那颗按钮：点开列表，向左滑是第二个动作。
 *
 * 滑轨常态看不见，画成虚线；轨道尽头那枚图标就是滑过去会到的地方，而它是可配置的。
 */
const PonderGridActionButtonSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-grid-action-button-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <div className="grid grid-cols-4 gap-[2%]" style={relativeRectStyle(A.shelf)}>
                {[0, 1, 2, 3].map(index => (
                    <span key={index} className="rounded-xl border" style={{ borderColor: outline, backgroundColor: line, opacity: index === 1 ? 0.9 : 0.5 }} />
                ))}
            </div>

            <div
                data-ponder-grid-action-track
                className="rounded-full border border-dashed"
                style={{ ...relativeRectStyle(A.track), borderColor: outline }}
            />
            <span
                data-ponder-grid-action-track-end
                className="flex items-center justify-center rounded-full"
                style={{ ...relativeRectStyle(A.trackEnd), color: accent, opacity: 0.55 }}
            >
                <Search className="h-3/5 w-auto" />
            </span>
            <span
                data-ponder-grid-action-button
                className="flex items-center justify-center rounded-full border"
                style={{ ...relativeRectStyle(A.button), borderColor: outline, backgroundColor: line }}
            >
                <List className="h-1/2 w-1/2 opacity-70" />
            </span>
        </PonderSurfaceBase>

        {/* 点一下：曲目列表从右边切进来。 */}
        <PonderSurfaceStateLayer state="list-open" registerStateNode={registerStateNode}>
            <div
                data-ponder-grid-action-list
                className="flex flex-col gap-[3%] rounded-2xl border bg-zinc-950/95 p-[4%]"
                style={{ ...relativeRectStyle(A.listPanel), borderColor: outline }}
            >
                {[0, 1, 2, 3, 4, 5].map(index => (
                    <span key={index} className="flex h-[9%] shrink-0 items-center gap-[4%]">
                        <span className="aspect-square h-full rounded-md" style={{ backgroundColor: index === 0 ? accent : line, opacity: index === 0 ? 0.6 : 1 }} />
                        <span className="h-1.5 rounded-full" style={{ width: `${70 - index * 6}%`, backgroundColor: line }} />
                    </span>
                ))}
            </div>
        </PonderSurfaceStateLayer>

        {/* 向左滑：默认到本页筛选，设置里也可以改成命令窗口。 */}
        <PonderSurfaceStateLayer state="slide-target-open" registerStateNode={registerStateNode}>
            <div
                data-ponder-grid-action-slide-target
                className="flex items-center gap-[3%] rounded-full border bg-zinc-950/95 px-[3%]"
                style={{ ...relativeRectStyle(A.filterBar), borderColor: accent }}
            >
                <Search className="h-[42%] w-auto" style={{ color: accent }} />
                <span className="h-1.5 w-[40%] rounded-full" style={{ backgroundColor: line }} />
                <span className="flex-1" />
                <Command className="h-[34%] w-auto opacity-35" />
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

/** 卡片在登记表里的名字：编辑模式替换的是它，不是往上面盖一层。 */
const GRID_VIEW_CARDS_STATE = 'cards-normal';

/** 三张卡，中间那张是焦点。两种形态共用，只差焦点卡上挂什么。 */
const CardRow: React.FC<{
    accent: string;
    line: string;
    outline: string;
    children: React.ReactNode;
}> = ({ accent, line, outline, children }) => (
    <div className="relative" style={relativeRectStyle(G.cards)}>
        <GridCard accent={accent} line={line} outline={outline} style={relativeRectStyle({ left: 0.02, top: 0.06, width: 0.28, height: 0.88 })} />
        <GridCard accent={accent} line={line} outline={outline} focused style={relativeRectStyle(G.card)} />
        <GridCard accent={accent} line={line} outline={outline} style={relativeRectStyle({ right: 0.02, top: 0.06, width: 0.28, height: 0.88 })} />
        {/* 卡上的东西必须挂在卡自己的坐标系里：直接铺在这一层会按整排的宽度算，
            歌名会拉成一条横跨三张卡的长条。 */}
        <div className="absolute" style={relativeRectStyle(G.card)}>
            <span className="h-1.5 rounded-full" style={{ ...relativeRectStyle(G.title), backgroundColor: line }} />
            {children}
        </div>
    </div>
);

/**
 * 网格里的卡片：常态、编辑模式、以及焦点卡上那颗手动匹配的铅笔。
 *
 * 常态下卡片底部有播放和加入队列两颗；编辑模式里这两颗整排换掉，右上角只剩一个叉。
 * 所以编辑模式是**替换**常态那一层，而不是盖一块深色把它糊住 —— 糊住的话底下那两颗
 * 还会隐隐透出来，读起来像「变灰了」而不是「没有了」。
 */
const PonderGridViewCardsSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-grid-view-cards-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <PonderSurfaceStateLayer state={GRID_VIEW_CARDS_STATE} registerStateNode={registerStateNode} visible>
                <CardRow accent={accent} line={line} outline={outline}>
                    <span
                        data-ponder-grid-view-actions
                        className="flex items-center justify-center gap-[10%]"
                        style={relativeRectStyle(G.actions)}
                    >
                        <span className="flex aspect-square h-full items-center justify-center rounded-full" style={{ backgroundColor: accent }}>
                            <Play className="h-1/2 w-1/2" style={{ color: 'rgba(9,9,11,0.85)' }} />
                        </span>
                        <span className="flex aspect-square h-full items-center justify-center rounded-full border" style={{ borderColor: outline }}>
                            <Plus className="h-1/2 w-1/2 opacity-70" />
                        </span>
                    </span>
                </CardRow>
            </PonderSurfaceStateLayer>
        </PonderSurfaceBase>

        {/* 焦点卡上悬停歌名，右端才浮出这颗铅笔。纯叠加：常态那一层要留着。 */}
        <PonderSurfaceStateLayer state="metadata-pencil" registerStateNode={registerStateNode}>
            <div className="relative" style={relativeRectStyle(G.cards)}>
                <div className="absolute" style={relativeRectStyle(G.card)}>
                    <span
                        data-ponder-grid-view-pencil
                        className="flex items-center justify-center rounded-md border"
                        style={{ ...relativeRectStyle(G.pencil), borderColor: outline, backgroundColor: 'rgba(9,9,11,0.85)', color: accent }}
                    >
                        <Pencil className="h-1/2 w-1/2" />
                    </span>
                </div>
            </div>
        </PonderSurfaceStateLayer>

        {/* 编辑模式：整排换掉，底部那两颗不在了，右上角多一个叉。 */}
        <PonderSurfaceStateLayer state="edit-mode" registerStateNode={registerStateNode} replaces={GRID_VIEW_CARDS_STATE}>
            <CardRow accent={accent} line={line} outline={outline}>
                <span
                    data-ponder-grid-view-remove
                    className="flex items-center justify-center rounded-full"
                    style={{ ...relativeRectStyle(G.removeBadge), backgroundColor: '#ef4444' }}
                >
                    <X className="h-1/2 w-1/2" style={{ color: '#fff' }} />
                </span>
            </CardRow>
        </PonderSurfaceStateLayer>
    </div>
);

/** 信息面板底部那一列来源动作。最后一颗是删除。 */
const PonderLocalFolderActionsSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-local-folder-actions-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <PillRow marker="data-ponder-folder-play-all" rect={F.playAll} line={line} outline={outline} accent={accent} icon={Play} tone="primary" />
            <PillRow marker="data-ponder-folder-add-queue" rect={F.addQueue} line={line} outline={outline} accent={accent} icon={ListPlus} />
            <PillRow marker="data-ponder-folder-reimport" rect={F.reimport} line={line} outline={outline} accent={accent} icon={RefreshCw} />
            <PillRow marker="data-ponder-folder-organize" rect={F.organize} line={line} outline={outline} accent={accent} icon={Tags} />
            <PillRow marker="data-ponder-folder-remove" rect={F.remove} line={line} outline={outline} accent={accent} icon={Trash2} tone="danger" />
        </PonderSurfaceBase>

        {/* 删除是不可逆的，所以它先弹一个确认框，文案还分根文件夹和子文件夹两种。 */}
        <PonderSurfaceStateLayer state="delete-confirm" registerStateNode={registerStateNode} className="bg-zinc-950/60">
            <div
                data-ponder-folder-delete-confirm
                className="absolute inset-x-[6%] top-1/2 flex -translate-y-1/2 flex-col gap-[8%] rounded-2xl border bg-zinc-950/98 p-[6%]"
                style={{ borderColor: '#ef4444' }}
            >
                <span className="h-2 w-[54%] rounded-full" style={{ backgroundColor: line }} />
                <span className="h-1 w-[86%] rounded-full opacity-50" style={{ backgroundColor: line }} />
                <span className="h-1 w-[64%] rounded-full opacity-50" style={{ backgroundColor: line }} />
                <span className="flex gap-[6%] pt-[4%]">
                    <span className="h-6 flex-1 rounded-full border" style={{ borderColor: outline }} />
                    <span className="h-6 flex-1 rounded-full" style={{ backgroundColor: '#ef4444', opacity: 0.85 }} />
                </span>
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

/** 曲目列表侧板：头上那两颗排序控件只在本地文件夹里出现。 */
const PonderLocalTrackListSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-local-track-list-structure>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <div className="flex items-center" style={relativeRectStyle(T.header)}>
                <span className="h-1.5 w-[40%] rounded-full opacity-60" style={{ backgroundColor: line }} />
            </div>
            <span
                data-ponder-track-sort-direction
                className="flex items-center justify-center rounded-full border"
                style={{ ...relativeRectStyle(T.direction), borderColor: outline }}
            >
                <ArrowDownAZ className="h-1/2 w-1/2 opacity-70" />
            </span>
            <span
                data-ponder-track-sort-menu
                className="flex items-center justify-center rounded-full border"
                style={{ ...relativeRectStyle(T.sortMenu), borderColor: outline }}
            >
                <SlidersHorizontal className="h-1/2 w-1/2 opacity-70" />
            </span>

            <div className="flex flex-col gap-[3%]" style={relativeRectStyle(T.rows)}>
                {[0, 1, 2, 3, 4, 5, 6].map(index => (
                    <span key={index} className="flex h-[11%] shrink-0 items-center gap-[3%]">
                        <span className="aspect-square h-full rounded-md" style={{ backgroundColor: index === 0 ? accent : line, opacity: index === 0 ? 0.6 : 1 }} />
                        <span className="h-1.5 rounded-full" style={{ width: `${74 - index * 5}%`, backgroundColor: line }} />
                    </span>
                ))}
            </div>
        </PonderSurfaceBase>

        {/* 点开排序菜单：三种字段三选一。 */}
        <PonderSurfaceStateLayer state="sort-menu-open" registerStateNode={registerStateNode}>
            <div
                data-ponder-track-sort-menu-open
                className="flex flex-col justify-evenly rounded-xl border bg-zinc-950/98 p-[4%]"
                style={{ ...relativeRectStyle(T.menu), borderColor: outline }}
            >
                {[0, 1, 2].map(index => (
                    <span
                        key={index}
                        className="flex h-[26%] items-center gap-[6%] rounded-lg px-[5%]"
                        style={{ backgroundColor: index === 0 ? `${accent}26` : undefined }}
                    >
                        <span className="aspect-square h-[46%] rounded-sm" style={{ backgroundColor: index === 0 ? accent : line }} />
                        <span className="h-1 flex-1 rounded-full" style={{ backgroundColor: line }} />
                    </span>
                ))}
            </div>
        </PonderSurfaceStateLayer>
    </div>
);

export default {
    'grid-action-button': PonderGridActionButtonSurface,
    'grid-view-cards': PonderGridViewCardsSurface,
    'local-folder-actions': PonderLocalFolderActionsSurface,
    'local-track-list': PonderLocalTrackListSurface,
} satisfies PonderSurfaceDeclarations;
