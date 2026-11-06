import React from 'react';
import { ChevronLeft, FoldHorizontal, ListPlus, Maximize2, Music2, NotebookPen, Play, SquareCheck, Star, Trash2, X } from 'lucide-react';
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
import ScratchpadShape from '../../../app/scratchpad/ScratchpadShape';
import type { ScratchpadShapeKind } from '../../../app/scratchpad/scratchpadLook';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations, PonderSurfaceProps as SurfaceProps } from '../surfaceDeclarations';

// src/components/ponder/surfaces/library/scratchpad.surface.tsx
// 速记簿：一面资料库磁贴墙，左缘贴着速记簿的标签（米白小条）；指针停在一张歌曲磁贴上时右上角出两颗按钮。
// 速记簿是 Bravais 样式：米白的纸、黑墨、点缀色（这里用教程的主题色），面板分区靠深浅不同的黑。
//
// 结果层：磁贴上的两颗按钮（card-hover）、收进去之后标签上的首数（collected）、从左缘滑出的面板（drawer）
// 和面板里悬停的那一行（row-hover）、面板换到第二页播放历史（history）、展开整页（canvas），拖过一张之后的整页
// （canvas-reordered，只替换 canvas），以及框选与浮在选中卡片旁边的板（canvas-selected）。

type Paint = Pick<SurfaceProps, 'accent' | 'line' | 'outline'>;

/** 构成主义的纸与墨（固定，不随主题）。 */
const PAPER = '#f4f0e6';
const INK = '#141414';
/** 面板的两块黑：页签列更深一档。 */
const RAIL = 'color-mix(in srgb, var(--st-win) 72%, #000)';
const SHEET = 'var(--st-win)';

/** 第几张封面用什么颜色：主题色按不同浓度调出来，几张挨着的封面看得出不是同一张。 */
const COVER_MIX = [62, 34, 80, 22, 50, 70, 40, 28];
const coverColor = (accent: string, index: number) => (
    `color-mix(in srgb, ${accent} ${COVER_MIX[index % COVER_MIX.length]}%, var(--st-card))`
);

/** 一条灰色的字。 */
const Bar: React.FC<{ width: string; height?: string; color: string; opacity?: number }> = ({ width, height = '100%', color, opacity = 1 }) => (
    <span className="block rounded-full" style={{ width, height, backgroundColor: color, opacity }} />
);

/** 一颗方的图标按钮（面板与整页里那种，不描边）。 */
const IconSquare: React.FC<{ icon: React.ComponentType<{ className?: string }>; filled?: string }> = ({ icon: Icon, filled }) => (
    <span className="flex aspect-square h-full shrink-0 items-center justify-center" style={{ backgroundColor: filled }}>
        <Icon className="h-[52%] w-auto opacity-80" />
    </span>
);

/** 一颗方角描边按钮（F 的按钮）：实心的那颗纸色填满。 */
const KButton: React.FC<{ rect: React.CSSProperties; ink: string; paper: string; solid?: boolean; icon: React.ComponentType<{ className?: string }>; label?: string }> = ({ rect, ink, paper, solid, icon: Icon, label }) => (
    <span
        className="flex items-center justify-center gap-[6%]"
        style={{ ...rect, boxShadow: `inset 0 0 0 2px ${ink}`, backgroundColor: solid ? ink : undefined, color: solid ? paper : ink }}
    >
        <Icon className="h-[46%] w-auto" />
        {label && <Bar width={label} height="16%" color={solid ? paper : ink} opacity={0.85} />}
    </span>
);

/** 米白信息条：点缀色的顶边、墨色的底边、计数斜块、编号与标题，右端撒几颗这一页的几何体。 */
const Band: React.FC<{ rect: React.CSSProperties; accent: string; shape: ScratchpadShapeKind; big?: boolean }> = ({ rect, accent, shape, big }) => (
    <span
        className="overflow-hidden"
        style={{ ...rect, backgroundColor: PAPER, borderTop: `3px solid ${accent}`, borderBottom: `2px solid ${INK}`, boxSizing: 'border-box', boxShadow: '0 10px 24px rgb(0 0 0 / 35%)' }}
    >
        <span className="absolute top-[14%] bottom-[14%]" style={{ left: big ? '16.5%' : '4%', width: big ? '4.6%' : '17%', backgroundColor: shape === 'circle' ? accent : INK, transform: 'skewX(-14deg)' }} />
        <span className="absolute flex flex-col gap-[10%]" style={{ left: big ? '24.5%' : '25%', top: '20%', width: '30%', height: '60%' }}>
            <Bar width="14%" height="14%" color={INK} opacity={0.7} />
            <Bar width={big ? '50%' : '64%'} height="34%" color={INK} />
        </span>
        {[0.62, 0.7, 0.78, 0.86].map((left, index) => (
            <ScratchpadShape
                key={index}
                kind={shape}
                size={big ? 26 - index * 4 : 14 - index * 2}
                fill={index % 2 === 0 ? accent : 'none'}
                stroke={index % 2 === 0 ? undefined : INK}
                strokeWidth={1.5}
                style={{ position: 'absolute', left: `${left * 100}%`, top: `${index % 2 === 0 ? 18 : 46}%` }}
            />
        ))}
    </span>
);

/** 底下的资料库墙、指针停着的那张歌曲磁贴，和左缘的标签（还没有收进任何歌）。 */
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
        <Handle accent={accent} count={0} />
    </>
);

/** 左缘的标签：米白竖条，点缀色顶边、圆形记号、竖排的名字（画成一道墨），收进歌之后多一块斜着的首数。 */
const Handle: React.FC<{ accent: string; count: number }> = ({ accent, count }) => (
    <span
        data-ponder-scratchpad-handle
        className="flex flex-col items-center gap-[8%] pt-[12%]"
        style={{ ...relativeRectStyle(G.handle), backgroundColor: PAPER, borderTop: `3px solid ${accent}`, boxSizing: 'border-box', clipPath: 'polygon(0 0, 100% 0, 100% 96%, 0 100%)' }}
    >
        <ScratchpadShape kind="circle" size={9} fill={accent} />
        <span className="w-[24%] rounded-full" style={{ height: '40%', backgroundColor: INK, opacity: 0.85 }} />
        {count > 0 && (
            <span className="flex items-center justify-center px-[10%] text-[9px] font-black leading-none" style={{ backgroundColor: accent, color: PAPER, transform: 'skewX(-14deg)', height: '12%' }}>
                <span style={{ transform: 'skewX(14deg)' }}>{count}</span>
            </span>
        )}
    </span>
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

/** 收进去一首之后：标签（指针移到左缘时展开的样子）上写出首数。 */
const Collected: React.FC<Paint> = ({ accent }) => <Handle accent={accent} count={1} />;

/** 面板左边那一列：收起、三个竖排页签（开着的那页垫一块斜着的米白纸）。 */
const Rail: React.FC<Paint & { active: 'notes' | 'history' }> = ({ active, accent, line }) => (
    <>
        <span style={{ ...relativeRectStyle(D.rail), backgroundColor: RAIL }} />
        <span style={relativeRectStyle(D.close)}><IconSquare icon={FoldHorizontal} /></span>
        {([['notes', D.notesTab, 'circle'], ['history', D.historyTab, 'tri'], ['queue', D.queueTab, 'chev']] as const).map(([id, rect, shape]) => {
            const on = id === active;
            return (
                <span key={id} className="flex flex-col items-center gap-[8%] pt-[14%]" style={relativeRectStyle(rect)}>
                    {on && <span className="absolute inset-0" style={{ backgroundColor: PAPER, transform: 'skewY(-6deg)' }} />}
                    <ScratchpadShape kind={shape} size={8} fill={on ? accent : line} style={{ position: 'relative' }} />
                    <span className="relative w-[22%] rounded-full" style={{ height: '50%', backgroundColor: on ? INK : line, opacity: on ? 0.9 : 0.55 }} />
                </span>
            );
        })}
    </>
);

/** 面板内容区顶上那几块：信息条（右端压一颗墨色的「展开整页」）、放大的问候、短杠、说明。 */
const SheetHead: React.FC<Paint & { shape: ScratchpadShapeKind }> = ({ accent, line, shape }) => (
    <>
        <Band rect={relativeRectStyle(D.band)} accent={accent} shape={shape} />
        <span className="flex items-center justify-center" style={{ ...relativeRectStyle(D.expand), backgroundColor: INK, color: PAPER }}>
            <Maximize2 className="h-[48%] w-auto" />
        </span>
        <span style={relativeRectStyle(D.greeting)}><Bar width="86%" height="64%" color={line} opacity={0.95} /></span>
        <span style={{ ...relativeRectStyle(D.rule), backgroundColor: accent }} />
        <span style={relativeRectStyle(D.hint)}><Bar width="92%" height="60%" color={line} opacity={0.4} /></span>
    </>
);

/** 面板里的一行（笔记本上的一条）：封面、歌名、斜体的歌手 · 出处，底下一道极淡的横格。 */
const DrawerRow: React.FC<Paint & { group: number; row: number; index: number }> = ({ group, row, index, accent, line }) => (
    <span className="flex items-center gap-[6%] pl-[5%] pr-[3%]" style={{ ...relativeRectStyle(scratchpadRowRect(group, row)), boxShadow: `inset 0 -1px 0 color-mix(in srgb, ${line} 25%, transparent)` }}>
        <span className="aspect-square h-[72%] shrink-0" style={{ backgroundColor: coverColor(accent, index) }} />
        <span className="flex min-w-0 flex-1 flex-col gap-[10%]">
            <Bar width={`${44 + (index * 13) % 30}%`} height="7px" color={line} opacity={0.95} />
            <Bar width={`${56 + (index * 7) % 24}%`} height="5px" color={line} opacity={0.5} />
        </span>
    </span>
);

/** 从左缘滑出来的面板：页签列、信息条与问候、按来源分的两组、最底下一排。 */
const Drawer: React.FC<Paint> = ({ accent, line, outline }) => {
    let index = 0;
    return (
        <div
            data-ponder-scratchpad-drawer
            style={{ ...relativeRectStyle(G.drawer), backgroundColor: SHEET, boxShadow: '0 12px 32px rgb(0 0 0 / 35%)' }}
        >
            <Rail active="notes" accent={accent} line={line} outline={outline} />
            <SheetHead accent={accent} line={line} outline={outline} shape="circle" />
            {SCRATCHPAD_GROUP_SIZES.map((size, group) => (
                <React.Fragment key={group}>
                    <span className="flex items-center gap-[4%] pl-[5%]" style={relativeRectStyle(scratchpadGroupHeaderRect(group))}>
                        <ScratchpadShape kind="circle" size={7} fill={accent} />
                        <Bar width={group === 0 ? '22%' : '14%'} height="26%" color={line} />
                        <Bar width="10%" height="18%" color={line} opacity={0.5} />
                        <span className="h-[8%] w-[9%]" style={{ backgroundColor: accent }} />
                    </span>
                    <span className="flex justify-end gap-[10%]" style={relativeRectStyle(scratchpadGroupActionsRect(group))}>
                        <IconSquare icon={ListPlus} />
                        <IconSquare icon={Star} />
                    </span>
                    {Array.from({ length: size }, (_, row) => (
                        <DrawerRow key={row} group={group} row={row} index={index++} accent={accent} line={line} outline={outline} />
                    ))}
                </React.Fragment>
            ))}
            <KButton rect={relativeRectStyle(D.enqueueAll)} ink={line} paper={SHEET} solid icon={ListPlus} label="40%" />
            <KButton rect={relativeRectStyle(D.replaceQueue)} ink={line} paper={SHEET} icon={Play} label="46%" />
            <KButton rect={relativeRectStyle(D.clear)} ink={line} paper={SHEET} icon={Trash2} />
        </div>
    );
};

/** 面板里悬停着的那一行：底色亮一档，右端出四颗。坐标系与面板相同，所以整层按面板定位。 */
const RowHover: React.FC<Paint> = ({ line }) => {
    const { group, row } = SCRATCHPAD_HOVER_ROW;
    return (
        <div style={relativeRectStyle(G.drawer)}>
            <span style={{ ...relativeRectStyle(scratchpadRowRect(group, row)), backgroundColor: line, opacity: 0.18 }} />
            <span
                className="flex justify-end gap-[4%] px-[2%]"
                style={{ ...relativeRectStyle(scratchpadRowActionsRect(group, row)), backgroundColor: SHEET }}
            >
                {[Play, ListPlus, Star, X].map((Icon, index) => <IconSquare key={index} icon={Icon} />)}
            </span>
        </div>
    );
};

/** 第二页播放历史：页签换过来；按天分段（今天三首、昨天两首），页眉写大号的日子，每首的封面是一张微歪的小相片。 */
const History: React.FC<Paint> = ({ accent, line, outline }) => {
    let index = 2;
    return (
        <div
            data-ponder-scratchpad-history
            style={{ ...relativeRectStyle(G.drawer), backgroundColor: SHEET, boxShadow: '0 12px 32px rgb(0 0 0 / 35%)' }}
        >
            <Rail active="history" accent={accent} line={line} outline={outline} />
            <SheetHead accent={accent} line={line} outline={outline} shape="tri" />
            {SCRATCHPAD_GROUP_SIZES.map((size, group) => (
                <React.Fragment key={group}>
                    <span className="flex items-end gap-[4%] pb-[1%] pl-[5%]" style={relativeRectStyle(scratchpadGroupHeaderRect(group))}>
                        <ScratchpadShape kind="tri" size={7} fill={accent} />
                        <Bar width="9%" height="62%" color={line} />
                        <Bar width="20%" height="20%" color={line} opacity={0.6} />
                    </span>
                    {Array.from({ length: size }, (_, row) => (
                        <span key={row} className="flex items-center gap-[5%] pl-[5%] pr-[3%]" style={relativeRectStyle(scratchpadRowRect(group, row))}>
                            <span
                                className="flex h-[84%] shrink-0 flex-col p-[2px] pb-[5px]"
                                style={{ aspectRatio: '44 / 52', backgroundColor: '#ece6d8', transform: `rotate(${[-2.2, 1.4, -0.6, 2, -1.5][(index + row) % 5]}deg)` }}
                            >
                                <span className="w-full flex-1" style={{ backgroundColor: coverColor(accent, index++), filter: 'sepia(0.42)' }} />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-[10%]">
                                <Bar width={`${40 + (index * 13) % 30}%`} height="7px" color={line} opacity={0.95} />
                                <span className="flex items-center gap-[4%]">
                                    <Bar width="46%" height="5px" color={line} opacity={0.5} />
                                    <Bar width="14%" height="5px" color={line} opacity={0.75} />
                                </span>
                            </span>
                        </span>
                    ))}
                </React.Fragment>
            ))}
        </div>
    );
};

/** 整页上的一张笔记本卡：封面在上，下面红页边线、歌名、斜体的歌手。 */
const CanvasCard: React.FC<Paint & { group: number; slot: number; index: number; selected?: boolean }> = ({ group, slot, index, selected, accent }) => (
    <span
        style={{
            ...relativeRectStyle(scratchpadCanvasSlotRect(group, slot)),
            backgroundColor: '#efe9dc',
            boxShadow: selected ? `0 0 0 1px ${INK}, 0 0 0 4px ${PAPER}, 0 0 0 5px ${INK}` : '0 6px 14px rgb(0 0 0 / 35%)',
        }}
    >
        <span className="absolute inset-x-0 top-0 flex h-[62%] items-center justify-center" style={{ backgroundColor: coverColor(accent, index) }}>
            <Music2 className="h-[30%] w-auto opacity-40" />
        </span>
        <span className="absolute bottom-0 left-[11%] top-[62%] w-[2px]" style={{ backgroundColor: `color-mix(in srgb, ${accent} 55%, transparent)` }} />
        <span className="absolute bottom-[10%] left-[18%] right-[8%] flex flex-col gap-[5px]">
            <Bar width={`${50 + (index * 11) % 36}%`} height="6px" color={INK} opacity={0.85} />
            <Bar width={`${34 + (index * 7) % 24}%`} height="4px" color={INK} opacity={0.45} />
        </span>
    </span>
);

/** 整页第一组卡片的顺序（每一项是第几张封面）。拖过之后第三张到了最前面。 */
const CANVAS_ORDER = Array.from({ length: SCRATCHPAD_CANVAS_GROUP_SIZES[0] }, (_, index) => index);
const REORDERED = (() => {
    const order = [...CANVAS_ORDER];
    const [moved] = order.splice(SCRATCHPAD_DRAG.from, 1);
    order.splice(SCRATCHPAD_DRAG.to, 0, moved);
    return order;
})();

/**
 * 展开整页：顶上横贯的信息条（左端返回钮、右端这一页的按钮），右上角黑三角（问候），两组各一条组头（多一颗「选中本组」）
 * 与一排笔记本卡，右边一列跳到栏与提示，底下两条细纸带。firstGroup 是第一组的顺序。
 */
const Canvas: React.FC<Paint & { firstGroup: readonly number[] }> = ({ firstGroup, accent, line, outline }) => (
    <div
        data-ponder-scratchpad-canvas
        className="overflow-hidden"
        style={{ ...relativeRectStyle(G.canvas), backgroundColor: 'color-mix(in srgb, var(--st-win) 85%, #000)' }}
    >
        <Band rect={relativeRectStyle(C.band)} accent={accent} shape="circle" big />
        <span className="flex gap-[4%]" style={relativeRectStyle(C.bandActions)}>
            <KButton rect={{ position: 'relative', height: '100%', flex: '1 1 0' }} ink={INK} paper={PAPER} solid icon={ListPlus} label="38%" />
            <KButton rect={{ position: 'relative', height: '100%', flex: '1.3 1 0' }} ink={INK} paper={PAPER} icon={Play} label="44%" />
            <KButton rect={{ position: 'relative', height: '100%', aspectRatio: '1' }} ink={INK} paper={PAPER} icon={Trash2} />
        </span>
        <span style={{ ...relativeRectStyle(C.triangle), backgroundColor: INK, clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }} />
        <span className="flex justify-end" style={relativeRectStyle(C.greeting)}><Bar width="80%" height="70%" color={PAPER} /></span>
        <span style={{ ...relativeRectStyle(C.collapse), backgroundColor: INK, color: PAPER }} className="flex items-center justify-center">
            <ChevronLeft className="h-[60%] w-auto" />
        </span>
        {SCRATCHPAD_CANVAS_GROUP_SIZES.map((size, group) => (
            <React.Fragment key={group}>
                <span className="flex items-center gap-[1%] px-[0.6%]" style={relativeRectStyle(scratchpadCanvasHeaderRect(group))}>
                    <ScratchpadShape kind="circle" size={9} fill={accent} />
                    <Bar width={group === 0 ? '9%' : '6%'} height="30%" color={line} />
                    <Bar width="4%" height="20%" color={line} opacity={0.55} />
                    <span className="h-[9%] w-[3%]" style={{ backgroundColor: accent }} />
                    <span className="flex-1" />
                    <span className="flex h-[80%] gap-[0.4%]">
                        {[SquareCheck, ListPlus, Star].map((Icon, index) => <IconSquare key={index} icon={Icon} />)}
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
        <span className="flex flex-col gap-[3%]" style={relativeRectStyle(C.side)}>
            <Bar width="34%" height="10px" color={line} opacity={0.45} />
            {[0.9, 0.7, 0.55].map((opacity, index) => (
                <span key={index} className="flex h-[7%] items-center gap-[6%] px-[6%]" style={{ backgroundColor: index === 0 ? `color-mix(in srgb, ${line} 18%, transparent)` : undefined }}>
                    <ScratchpadShape kind="circle" size={6} fill={index === 0 ? accent : line} />
                    <Bar width="56%" height="22%" color={line} opacity={opacity} />
                </span>
            ))}
            <span className="flex-1" />
            {[0, 1, 2, 3].map(index => (
                <span key={index} className="flex h-[4%] items-center gap-[6%] px-[6%]">
                    <ScratchpadShape kind="circle" size={5} fill={accent} />
                    <Bar width={`${30 + index * 8}%`} height="30%" color={line} opacity={0.6} />
                </span>
            ))}
        </span>
        {[C.slimUpper, C.slimLower].map((rect, index) => (
            <span key={index} className="flex items-center gap-[1%] pl-[13%]" style={{ ...relativeRectStyle(rect), backgroundColor: PAPER, borderTop: `2px solid ${accent}`, boxSizing: 'border-box' }}>
                <ScratchpadShape kind={index === 0 ? 'tri' : 'chev'} size={9} fill={accent} />
                <Bar width="8%" height="30%" color={INK} opacity={0.85} />
                <Bar width="6%" height="22%" color={INK} opacity={0.5} />
            </span>
        ))}
    </div>
);

/** 框选：屏幕方向的框、框住的两张描一圈纸色的粗框，它们旁边浮出一块墨色的板：「已选 2 首」、对它们的三颗（入队、加入歌单、移出）和取消选择。 */
const CanvasSelected: React.FC<Paint> = ({ accent }) => (
    <div style={relativeRectStyle(G.canvas)}>
        <span style={{ ...relativeRectStyle(C.marquee), border: `1.5px solid ${accent}`, backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)` }} />
        {SCRATCHPAD_SELECTED.slots.map(slot => (
            <span
                key={slot}
                style={{ ...relativeRectStyle(scratchpadCanvasSlotRect(SCRATCHPAD_SELECTED.group, slot)), boxShadow: `0 0 0 1px ${INK}, 0 0 0 4px ${PAPER}, 0 0 0 5px ${INK}` }}
            />
        ))}
        <span
            data-ponder-scratchpad-selection
            className="flex items-center gap-[2%] px-[1.5%]"
            style={{ ...relativeRectStyle(C.menu), backgroundColor: INK, color: PAPER, boxShadow: '0 8px 20px rgb(0 0 0 / 40%)' }}
        >
            <Bar width="12%" height="22%" color={accent} opacity={0.95} />
            {[ListPlus, Star, Trash2].map((Icon, index) => (
                <span key={index} className="flex h-[66%] flex-1 items-center justify-center gap-[8%]" style={{ boxShadow: `inset 0 0 0 1.5px ${PAPER}` }}>
                    <Icon className="h-[56%] w-auto shrink-0 opacity-85" />
                    <Bar width="40%" height="16%" color={PAPER} opacity={0.75} />
                </span>
            ))}
            <span className="h-[62%]"><IconSquare icon={X} /></span>
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
            <PonderSurfaceStateLayer state="history" registerStateNode={registerStateNode}>
                <History {...paint} />
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
