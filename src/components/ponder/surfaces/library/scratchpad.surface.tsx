import React from 'react';
import { ListPlus, Maximize2, Minimize2, Music2, NotebookPen, Play, SquareCheck, Star, Trash2, X } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase } from '../PonderSurfaceStateLayer';
import {
    SCRATCHPAD_CANVAS as C,
    SCRATCHPAD_CANVAS_GROUP_SIZES,
    SCRATCHPAD_CARD as K,
    SCRATCHPAD_DRAG,
    SCRATCHPAD_DRAWER as D,
    SCRATCHPAD_GEOMETRY as G,
    SCRATCHPAD_GROUP_SIZES,
    SCRATCHPAD_HOVER_ROW,
    SCRATCHPAD_SELECTED,
    SCRATCHPAD_WALL_TILES,
    scratchpadCanvasHeaderRect,
    scratchpadCanvasSlotRect,
    scratchpadGroupActionsRect,
    scratchpadGroupHeaderRect,
    scratchpadRowActionsRect,
    scratchpadRowRect,
} from './scratchpad.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations, PonderSurfaceProps as SurfaceProps } from '../surfaceDeclarations';

// src/components/ponder/surfaces/library/scratchpad.surface.tsx
// 速记簿：一面资料库磁贴墙，左缘贴着速记簿的把手；指针停在一张歌曲磁贴上时右上角出两颗按钮。
//
// 结果层：磁贴上的两颗按钮（card-hover）、收进去之后把手上的首数（collected）、从左缘滑出的抽屉（drawer）
// 和抽屉里悬停的那一行（row-hover）、展开成的画布（canvas），拖过一张之后的画布（canvas-reordered，
// 只替换 canvas），以及框选与选中后的那一排（canvas-selected）。

type Paint = Pick<SurfaceProps, 'accent' | 'line' | 'outline'>;

/** 第几张封面用什么颜色：主题色按不同浓度调出来，几张挨着的封面看得出不是同一张。 */
const COVER_MIX = [62, 34, 80, 22, 50, 70, 40, 28];
const coverColor = (accent: string, index: number) => (
    `color-mix(in srgb, ${accent} ${COVER_MIX[index % COVER_MIX.length]}%, var(--st-card))`
);

/** 一条灰色的字。 */
const Bar: React.FC<{ width: string; height?: string; color: string; opacity?: number }> = ({ width, height = '100%', color, opacity = 1 }) => (
    <span className="block rounded-full" style={{ width, height, backgroundColor: color, opacity }} />
);

/** 一颗圆形图标按钮（抽屉与画布里那种）。 */
const IconDot: React.FC<{ icon: React.ComponentType<{ className?: string }>; outline: string; filled?: string }> = ({ icon: Icon, outline, filled }) => (
    <span
        className="flex aspect-square h-full shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: filled, boxShadow: filled ? undefined : `inset 0 0 0 1px ${outline}` }}
    >
        <Icon className="h-[52%] w-auto opacity-80" />
    </span>
);

/** 底下的资料库墙、指针停着的那张歌曲磁贴，和左缘的把手（还没有收进任何歌）。 */
const WallPage: React.FC<Paint> = ({ accent, line, outline }) => (
    <>
        {SCRATCHPAD_WALL_TILES.map((rect, index) => (
            <span
                key={index}
                className="overflow-hidden rounded-md"
                style={{ ...relativeRectStyle(rect), backgroundColor: coverColor(accent, index + 3), opacity: 0.55 }}
            >
                <span className="absolute inset-x-[8%] bottom-[7%] flex flex-col gap-[3px]">
                    <Bar width="58%" height="6px" color={line} opacity={0.8} />
                    <Bar width="34%" height="4px" color={line} opacity={0.5} />
                </span>
            </span>
        ))}
        <span
            data-ponder-scratchpad-card
            className="overflow-hidden rounded-md"
            style={{ ...relativeRectStyle(G.card), backgroundColor: coverColor(accent, 0), boxShadow: `0 0 0 1px ${outline}` }}
        >
            <span style={{ ...relativeRectStyle(K.title) }}><Bar width="100%" color="var(--st-on-accent)" /></span>
            <span style={{ ...relativeRectStyle(K.artist) }}><Bar width="100%" color="var(--st-on-accent)" opacity={0.6} /></span>
        </span>
        <span
            data-ponder-scratchpad-handle
            className="flex flex-col items-center justify-center gap-[10%] rounded-r-lg"
            style={{ ...relativeRectStyle(G.handle), backgroundColor: 'var(--st-menu)', boxShadow: `inset 0 0 0 1px ${outline}` }}
        >
            <NotebookPen className="h-auto w-[56%] opacity-75" />
        </span>
    </>
);

/** 磁贴右上角的两颗：加入速记簿、收藏到歌单。磁贴本身描一圈，表示指针停在它上面。 */
const CardHover: React.FC<Paint> = ({ accent }) => (
    <span className="rounded-md" style={{ ...relativeRectStyle(G.card), boxShadow: `0 0 0 2px ${accent}` }}>
        {[{ rect: K.collect, Icon: NotebookPen }, { rect: K.save, Icon: Star }].map(({ rect, Icon }, index) => (
            <span
                key={index}
                className="flex items-center justify-center rounded-full"
                style={{ ...relativeRectStyle(rect), backgroundColor: 'rgb(0 0 0 / 55%)', color: '#fff' }}
            >
                <Icon className="h-[46%] w-auto" />
            </span>
        ))}
    </span>
);

/** 收进去一首之后：把手（指针移到左缘时展开的样子）在图标下面写出首数。 */
const Collected: React.FC<Paint> = ({ accent, outline }) => (
    <span
        className="flex flex-col items-center justify-center gap-[8%] rounded-r-lg"
        style={{ ...relativeRectStyle(G.handle), backgroundColor: 'var(--st-menu)', boxShadow: `inset 0 0 0 1px ${outline}, 0 0 0 2px ${accent}` }}
    >
        <NotebookPen className="h-auto w-[56%] opacity-75" />
        <span className="text-[9px] font-semibold leading-none opacity-85">1</span>
    </span>
);

/** 抽屉里的一行：封面、歌名、歌手 · 出处。 */
const DrawerRow: React.FC<Paint & { group: number; row: number; index: number }> = ({ group, row, index, accent, line }) => (
    <span className="flex items-center gap-[4%] px-[3%]" style={relativeRectStyle(scratchpadRowRect(group, row))}>
        <span className="aspect-square h-[70%] shrink-0 rounded-md" style={{ backgroundColor: coverColor(accent, index) }} />
        <span className="flex min-w-0 flex-1 flex-col gap-[10%]">
            <Bar width={`${44 + (index * 13) % 30}%`} height="7px" color={line} opacity={0.95} />
            <Bar width={`${56 + (index * 7) % 24}%`} height="5px" color={line} opacity={0.5} />
        </span>
    </span>
);

/** 从左缘滑出来的抽屉：标题、说明、按来源分的两组、最底下一排。 */
const Drawer: React.FC<Paint> = ({ accent, line, outline }) => {
    let index = 0;
    return (
        <div
            data-ponder-scratchpad-drawer
            className="overflow-hidden rounded-r-xl"
            style={{ ...relativeRectStyle(G.drawer), backgroundColor: 'var(--st-win)', boxShadow: `0 0 0 1px ${outline}, 0 12px 32px rgb(0 0 0 / 28%)` }}
        >
            <span className="flex items-center gap-[8%]" style={relativeRectStyle(D.title)}>
                <Bar width="52%" height="62%" color={line} opacity={0.95} />
                <Bar width="26%" height="36%" color={line} opacity={0.5} />
            </span>
            <span style={relativeRectStyle(D.expand)}><IconDot icon={Maximize2} outline={outline} /></span>
            <span style={relativeRectStyle(D.close)}><IconDot icon={X} outline={outline} /></span>
            <span style={relativeRectStyle(D.hint)}><Bar width="100%" height="50%" color={line} opacity={0.4} /></span>
            {SCRATCHPAD_GROUP_SIZES.map((size, group) => (
                <React.Fragment key={group}>
                    <span
                        className="flex items-center gap-[4%] rounded-md px-[3%]"
                        style={{ ...relativeRectStyle(scratchpadGroupHeaderRect(group)), backgroundColor: line }}
                    >
                        <Bar width={group === 0 ? '18%' : '12%'} height="22%" color={outline} />
                        <Bar width="10%" height="16%" color={outline} opacity={0.6} />
                    </span>
                    <span className="flex justify-end gap-[12%]" style={relativeRectStyle(scratchpadGroupActionsRect(group))}>
                        <IconDot icon={ListPlus} outline={outline} />
                        <IconDot icon={Star} outline={outline} />
                    </span>
                    {Array.from({ length: size }, (_, row) => (
                        <DrawerRow key={row} group={group} row={row} index={index++} accent={accent} line={line} outline={outline} />
                    ))}
                </React.Fragment>
            ))}
            <span className="flex items-center justify-center gap-[6%] rounded-full" style={{ ...relativeRectStyle(D.enqueueAll), boxShadow: `inset 0 0 0 1px ${outline}` }}>
                <ListPlus className="h-[42%] w-auto opacity-75" />
                <Bar width="38%" height="18%" color={line} opacity={0.8} />
            </span>
            <span className="flex items-center justify-center gap-[6%] rounded-full" style={{ ...relativeRectStyle(D.replaceQueue), boxShadow: `inset 0 0 0 1px ${outline}` }}>
                <Play className="h-[42%] w-auto opacity-75" />
                <Bar width="46%" height="18%" color={line} opacity={0.8} />
            </span>
            <span className="flex items-center justify-center rounded-full" style={{ ...relativeRectStyle(D.clear), boxShadow: `inset 0 0 0 1px ${outline}` }}>
                <Trash2 className="h-[42%] w-auto opacity-75" />
            </span>
        </div>
    );
};

/** 抽屉里悬停着的那一行：底色亮一档，右端出四颗。坐标系与抽屉相同，所以整层按抽屉定位。 */
const RowHover: React.FC<Paint> = ({ line, outline }) => {
    const { group, row } = SCRATCHPAD_HOVER_ROW;
    return (
        <div style={relativeRectStyle(G.drawer)}>
            <span className="rounded-md" style={{ ...relativeRectStyle(scratchpadRowRect(group, row)), backgroundColor: line, opacity: 0.55 }} />
            <span
                className="flex justify-end gap-[6%] rounded-full px-[2%]"
                style={{ ...relativeRectStyle(scratchpadRowActionsRect(group, row)), backgroundColor: 'var(--st-win)' }}
            >
                {[Play, ListPlus, Star, X].map((Icon, index) => <IconDot key={index} icon={Icon} outline={outline} />)}
            </span>
        </div>
    );
};

/** 画布上的一张卡片：方形封面、歌名、歌手。 */
const CanvasCard: React.FC<Paint & { group: number; slot: number; index: number; selected?: boolean }> = ({ group, slot, index, selected, accent, line, outline }) => (
    <span
        className="rounded-lg"
        style={{
            ...relativeRectStyle(scratchpadCanvasSlotRect(group, slot)),
            backgroundColor: 'var(--st-card)',
            boxShadow: selected ? `0 0 0 2px ${accent}` : `inset 0 0 0 1px ${outline}`,
        }}
    >
        {/* 留白用 inset 写：百分比的 padding 算的是整张画布的宽，不是这张卡自己的。 */}
        <span className="absolute inset-[7%] flex flex-col gap-[5px]">
            <span className="flex aspect-square w-full items-center justify-center rounded-md" style={{ backgroundColor: coverColor(accent, index) }}>
                <Music2 className="h-[30%] w-auto opacity-40" />
            </span>
            <Bar width={`${50 + (index * 11) % 36}%`} height="6px" color={line} opacity={0.95} />
            <Bar width={`${34 + (index * 7) % 24}%`} height="4px" color={line} opacity={0.5} />
        </span>
    </span>
);

/** 画布第一组卡片的顺序（每一项是第几张封面）。拖过之后第三张到了最前面。 */
const CANVAS_ORDER = Array.from({ length: SCRATCHPAD_CANVAS_GROUP_SIZES[0] }, (_, index) => index);
const REORDERED = (() => {
    const order = [...CANVAS_ORDER];
    const [moved] = order.splice(SCRATCHPAD_DRAG.from, 1);
    order.splice(SCRATCHPAD_DRAG.to, 0, moved);
    return order;
})();

/** 展开成的画布：两组各一条组头（多一颗「选中本组」）、一排卡片，最底下一排。firstGroup 是第一组的顺序。 */
const Canvas: React.FC<Paint & { firstGroup: readonly number[] }> = ({ firstGroup, accent, line, outline }) => (
    <div
        data-ponder-scratchpad-canvas
        className="overflow-hidden rounded-r-xl"
        style={{ ...relativeRectStyle(G.canvas), backgroundColor: 'var(--st-win)', boxShadow: `0 0 0 1px ${outline}` }}
    >
        <span className="flex items-center gap-[8%]" style={relativeRectStyle(C.title)}>
            <Bar width="52%" height="62%" color={line} opacity={0.95} />
            <Bar width="26%" height="36%" color={line} opacity={0.5} />
        </span>
        <span style={relativeRectStyle(C.collapse)}><IconDot icon={Minimize2} outline={outline} /></span>
        <span style={relativeRectStyle(C.close)}><IconDot icon={X} outline={outline} /></span>
        <span style={relativeRectStyle(C.hint)}><Bar width="100%" height="50%" color={line} opacity={0.4} /></span>
        {SCRATCHPAD_CANVAS_GROUP_SIZES.map((size, group) => (
            <React.Fragment key={group}>
                <span
                    className="flex items-center gap-[1.2%] rounded-md px-[1%]"
                    style={{ ...relativeRectStyle(scratchpadCanvasHeaderRect(group)), backgroundColor: line }}
                >
                    <Bar width={group === 0 ? '6%' : '4%'} height="22%" color={outline} />
                    <Bar width="3%" height="16%" color={outline} opacity={0.6} />
                    <span className="flex-1" />
                    <span className="flex h-[70%] gap-[0.6%]">
                        {[SquareCheck, ListPlus, Star].map((Icon, index) => <IconDot key={index} icon={Icon} outline={outline} />)}
                    </span>
                </span>
                {Array.from({ length: size }, (_, slot) => (
                    <CanvasCard
                        key={slot}
                        group={group}
                        slot={slot}
                        index={group === 0 ? firstGroup[slot] : SCRATCHPAD_CANVAS_GROUP_SIZES[0] + slot}
                        accent={accent}
                        line={line}
                        outline={outline}
                    />
                ))}
            </React.Fragment>
        ))}
        <span className="flex items-center justify-end gap-[0.8%]" style={relativeRectStyle(C.footer)}>
            <span className="flex h-full w-[9%] items-center justify-center gap-[8%] rounded-full" style={{ boxShadow: `inset 0 0 0 1px ${outline}` }}>
                <ListPlus className="h-[42%] w-auto opacity-75" />
                <Bar width="40%" height="18%" color={line} opacity={0.8} />
            </span>
            <span className="flex h-full w-[10%] items-center justify-center gap-[8%] rounded-full" style={{ boxShadow: `inset 0 0 0 1px ${outline}` }}>
                <Play className="h-[42%] w-auto opacity-75" />
                <Bar width="46%" height="18%" color={line} opacity={0.8} />
            </span>
            <span className="flex aspect-square h-full items-center justify-center rounded-full" style={{ boxShadow: `inset 0 0 0 1px ${outline}` }}>
                <Trash2 className="h-[42%] w-auto opacity-75" />
            </span>
        </span>
    </div>
);

/** 框选：一道虚线框、框住的两张描边，最底下一排换成「已选 2 首」、对它们的三颗（入队、加入歌单、移出）和取消选择。 */
const CanvasSelected: React.FC<Paint> = ({ accent, line, outline }) => (
    <div style={relativeRectStyle(G.canvas)}>
        <span
            className="rounded-md"
            style={{ ...relativeRectStyle(C.marquee), border: `1.5px dashed ${accent}`, backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)` }}
        />
        {SCRATCHPAD_SELECTED.slots.map(slot => (
            <span
                key={slot}
                className="rounded-lg"
                style={{ ...relativeRectStyle(scratchpadCanvasSlotRect(SCRATCHPAD_SELECTED.group, slot)), boxShadow: `0 0 0 2px ${accent}` }}
            />
        ))}
        <span
            data-ponder-scratchpad-selection
            className="flex items-center gap-[0.8%] rounded-full px-[1%]"
            style={{ ...relativeRectStyle(C.selectionBar), backgroundColor: 'var(--st-win)', boxShadow: `inset 0 0 0 1px ${accent}` }}
        >
            <Bar width="6%" height="22%" color={accent} />
            <span className="flex-1" />
            {[ListPlus, Star, Trash2].map((Icon, index) => (
                <span key={index} className="flex h-full w-[8%] items-center justify-center gap-[8%] rounded-full" style={{ boxShadow: `inset 0 0 0 1px ${outline}` }}>
                    <Icon className="h-[42%] w-auto opacity-75" />
                    <Bar width="40%" height="18%" color={line} opacity={0.8} />
                </span>
            ))}
            <span className="h-[80%]"><IconDot icon={X} outline={outline} /></span>
        </span>
    </div>
);

const PonderScratchpadSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => {
    const paint = { accent, line, outline };
    return (
        <div className="absolute inset-0 overflow-hidden" data-ponder-scratchpad-structure>
            <PonderSurfaceBase registerStateNode={registerStateNode}>
                <WallPage {...paint} />
            </PonderSurfaceBase>

            <PonderSurfaceStateLayer state="card-hover" registerStateNode={registerStateNode}>
                <CardHover {...paint} />
            </PonderSurfaceStateLayer>
            <PonderSurfaceStateLayer state="collected" registerStateNode={registerStateNode}>
                <Collected {...paint} />
            </PonderSurfaceStateLayer>
            <PonderSurfaceStateLayer state="drawer" registerStateNode={registerStateNode}>
                <Drawer {...paint} />
            </PonderSurfaceStateLayer>
            <PonderSurfaceStateLayer state="row-hover" registerStateNode={registerStateNode}>
                <RowHover {...paint} />
            </PonderSurfaceStateLayer>
            <PonderSurfaceStateLayer state="canvas" registerStateNode={registerStateNode}>
                <Canvas firstGroup={CANVAS_ORDER} {...paint} />
            </PonderSurfaceStateLayer>
            <PonderSurfaceStateLayer state="canvas-reordered" registerStateNode={registerStateNode} replaces="canvas">
                <Canvas firstGroup={REORDERED} {...paint} />
            </PonderSurfaceStateLayer>
            <PonderSurfaceStateLayer state="canvas-selected" registerStateNode={registerStateNode}>
                <CanvasSelected {...paint} />
            </PonderSurfaceStateLayer>
        </div>
    );
};

export default {
    scratchpad: PonderScratchpadSurface,
} satisfies PonderSurfaceDeclarations;
