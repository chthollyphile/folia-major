import React from 'react';
import { ChevronDown, ChevronLeft, Mouse } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase, type PonderSurfaceStateRegistrar } from './PonderSurfaceStateLayer';
import { relativeRectStyle } from './relativeRectStyle';
import {
    BRAVAIS_ARTIST_SLOT,
    BRAVAIS_BACK_RINGS,
    BRAVAIS_ENTRANCE_WAVES,
    BRAVAIS_FOCUS_BLOCK_SLOTS,
    BRAVAIS_FOCUS_INDEX,
    BRAVAIS_FOCUS_SLOT,
    BRAVAIS_OPEN_RINGS,
    BRAVAIS_ORIGIN_SLOT,
    BRAVAIS_PAN,
    BRAVAIS_SCROLL,
    BRAVAIS_SEAM,
    BRAVAIS_SEAM_CLOSE_SHIFT,
    BRAVAIS_VISIBLE_SLOTS,
    BRAVAIS_WALL_GEOMETRY as G,
    BRAVAIS_WORLD_SLOTS,
    bravaisCollectionItem,
    bravaisHomeItem,
    bravaisRadioItem,
    bravaisWindowedItem,
    isBravaisWindowSlot,
    type BravaisSlot,
    type BravaisWallItem,
} from './ponderBravaisGeometry';
import {
    BRAVAIS_WALL_BACKGROUND,
    BravaisCollectionSeam,
    BravaisFocusCard,
    BravaisHomeSeam,
    BravaisTile,
    BravaisTiles,
    BravaisToolsButton,
    BravaisToolsPanel,
    BravaisVisualizerBackdrop,
    pageBackgroundFor,
    type BravaisLook,
} from './PonderBravaisWallParts';
import type { PonderRelativeRect } from '../../../types/ponder';

// src/components/ponder/surfaces/PonderBravaisWallSurface.tsx
// bravais 墙（教程 bravais-wall）的合成界面：基础层是首页那面墙（缝在正中，左右两半各一块），
// 每一次操作的结果预先画成一层，时间线只写 opacity / transform。
//
// 翻牌在真实实现里是每张磁贴各自绕 Y 轴转半圈、按到起点的距离错开；这里压成几「圈」，每一圈是一个结果层，
// 时间线依次放出来 —— 看到的是从起点向外一波一波换内容。圈都是叠加层：新内容的磁贴不透明，正好盖住同位置的旧磁贴。
// 位置一律来自 ponderBravaisGeometry，与 bravaisWall.target.ts 的锚点是同一组数。

type PonderBravaisWallSurfaceProps = {
    accent: string;
    line: string;
    outline: string;
    registerStateNode?: PonderSurfaceStateRegistrar;
};

const FULL_PAGE: PonderRelativeRect = { left: 0, top: 0, width: 1, height: 1 };
const LEFT_HALF: PonderRelativeRect = { left: 0, top: 0, width: BRAVAIS_SEAM.left, height: 1 };
const RIGHT_HALF: PonderRelativeRect = { left: BRAVAIS_SEAM.left + BRAVAIS_SEAM.width, top: 0, width: 1 - BRAVAIS_SEAM.left - BRAVAIS_SEAM.width, height: 1 };

const slotsIn = (keys: readonly string[]) => BRAVAIS_VISIBLE_SLOTS.filter(slot => keys.includes(slot.key));

/**
 * 一面墙：屏幕固定的墙面底色与光晕 + 磁贴 + 缝。
 * 平移时磁贴两个方向都跟着走，缝只跟横向（缝竖着贯穿整屏，纵向拖动时它不动；横向拖动时它属于墙，跟墙一起走）。
 */
const Wall: React.FC<{
    accent: string;
    slots: readonly BravaisSlot[];
    itemFor: (slot: BravaisSlot) => BravaisWallItem | null;
    offset?: { x: number; y: number };
}> = ({ accent, slots, itemFor, offset }) => (
    <div data-ponder-bravais-wall className="absolute inset-0" style={pageBackgroundFor(FULL_PAGE, accent)}>
        <div className="absolute inset-0" style={offset ? { transform: `translate(${offset.x * 100}%, ${offset.y * 100}%)` } : undefined}>
            <BravaisTiles slots={slots} itemFor={itemFor} accent={accent} />
        </div>
        <div className="absolute inset-0" style={offset ? { transform: `translateX(${offset.x * 100}%)` } : undefined}>
            <BravaisHomeSeam activeTab={0} accent={accent} />
        </div>
    </div>
);

/** 滚轮的示意：一只鼠标，下面一个向下的箭头。 */
const WheelGlyph: React.FC = () => (
    <span
        data-ponder-bravais-wheel
        className="flex flex-col items-center justify-center rounded-full text-white/85"
        style={{ ...relativeRectStyle({ left: 0.29, top: 0.44, width: 0.04, aspect: 1.9 }), backgroundColor: 'rgba(0,0,0,0.55)' }}
    >
        <Mouse className="h-[38%] w-auto" />
        <ChevronDown className="h-[30%] w-auto animate-bounce" />
    </span>
);

/** 一块洞：evenodd 路径里的一个矩形（坐标系 0..1000）。 */
const holePath = (rect: PonderRelativeRect) => {
    const x = (rect.left ?? 0) * 1000;
    const y = (rect.top ?? 0) * 1000;
    const w = (rect.width ?? 0) * 1000;
    const h = (rect.height ?? 0) * 1000;
    return `M${x} ${y}h${w}v${h}h${-w}Z`;
};

/**
 * 透光档的墙：最底下是透出来的可视化，上面一块实色底板只在窗位挖洞（真实实现是按块的内联 SVG，evenodd 路径），
 * 再上面是磁贴。部分透明：每块固定几格是窗，内容跳过窗位往后排；全透明：所有内容磁贴都是窗，只留标题与压暗。
 */
const SeeThroughWall: React.FC<{ accent: string; look: Exclude<BravaisLook, 'solid'> }> = ({ accent, look }) => {
    const holes = look === 'partial'
        ? BRAVAIS_VISIBLE_SLOTS.filter(isBravaisWindowSlot)
        : BRAVAIS_VISIBLE_SLOTS;
    return (
        <div data-ponder-bravais-look={look} className="absolute inset-0">
            <BravaisVisualizerBackdrop accent={accent} />
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
                <path
                    fillRule="evenodd"
                    fill={BRAVAIS_WALL_BACKGROUND}
                    d={`M0 0H1000V1000H0Z${holes.map(slot => holePath(slot.rect)).join('')}`}
                />
            </svg>
            {look === 'partial'
                ? (
                    <>
                        <BravaisTiles slots={BRAVAIS_VISIBLE_SLOTS} itemFor={bravaisWindowedItem} accent={accent} />
                        {holes.map(slot => (
                            <span
                                key={slot.key}
                                data-ponder-bravais-window={slot.key}
                                style={{ ...relativeRectStyle(slot.rect), boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' }}
                            />
                        ))}
                    </>
                )
                : <BravaisTiles slots={BRAVAIS_VISIBLE_SLOTS} itemFor={bravaisHomeItem} accent={accent} clear />}
            <BravaisHomeSeam activeTab={0} accent={accent} translucent />
        </div>
    );
};

const shiftRect = (rect: PonderRelativeRect, dx: number): PonderRelativeRect => ({ ...rect, left: (rect.left ?? 0) + dx });

/** 进 Lattice 之后：缝合上（两半墙靠拢），每张磁贴翻成队列里的一张海报；左上角是 Lattice 常驻的返回，右下角工具按钮不变。 */
const LatticeWall: React.FC<{ accent: string }> = ({ accent }) => (
    <div data-ponder-bravais-lattice className="absolute inset-0" style={pageBackgroundFor(FULL_PAGE, accent)}>
        {BRAVAIS_WORLD_SLOTS.map((slot, index) => (
            <BravaisTile
                key={slot.key}
                accent={accent}
                rect={shiftRect(slot.rect, slot.half === 'left' ? BRAVAIS_SEAM_CLOSE_SHIFT : -BRAVAIS_SEAM_CLOSE_SHIFT)}
                item={{
                    kind: 'track',
                    hue: (bravaisHomeItem(slot).hue + 140) % 360,
                    number: String(index + 1).padStart(2, '0'),
                    titleWidth: 0.42 + (index % 5) * 0.07,
                }}
            />
        ))}
        <span
            className="flex items-center justify-center rounded-full"
            style={{ ...relativeRectStyle({ left: 0.02, top: 0.035, width: 0.036, square: true }), backgroundColor: 'rgba(255,255,255,0.1)' }}
        >
            <ChevronLeft className="h-[56%] w-[56%] text-white/80" />
        </span>
        <BravaisToolsButton />
    </div>
);

const homeFocusItem = bravaisHomeItem(BRAVAIS_FOCUS_SLOT);

const PonderBravaisWallSurface: React.FC<PonderBravaisWallSurfaceProps> = ({ accent, registerStateNode }) => (
    <div className="absolute inset-0 overflow-hidden" data-ponder-bravais-wall-structure style={{ backgroundColor: BRAVAIS_WALL_BACKGROUND }}>
        <PonderSurfaceBase registerStateNode={registerStateNode}>
            <Wall accent={accent} slots={BRAVAIS_WORLD_SLOTS} itemFor={bravaisHomeItem} />
        </PonderSurfaceBase>

        {/* 平移是整面墙重画一遍、差一个位移：替换基础层，屏幕上不会同时有两面错开的墙。 */}
        <PonderSurfaceStateLayer state="wall-panned" registerStateNode={registerStateNode} replaces>
            <Wall accent={accent} slots={BRAVAIS_WORLD_SLOTS} itemFor={bravaisHomeItem} offset={BRAVAIS_PAN} />
        </PonderSurfaceStateLayer>
        <PonderSurfaceStateLayer state="wall-scrolled" registerStateNode={registerStateNode} replaces>
            <Wall accent={accent} slots={BRAVAIS_WORLD_SLOTS} itemFor={bravaisHomeItem} offset={BRAVAIS_SCROLL} />
            <WheelGlyph />
        </PonderSurfaceStateLayer>

        {/* 换页签：整墙抬起退场（两半变回空墙面），缝里换成新页签，再从左上角一波一波落回新内容。 */}
        <PonderSurfaceStateLayer state="tab-out" registerStateNode={registerStateNode}>
            {[LEFT_HALF, RIGHT_HALF].map((half, index) => (
                <span key={index} style={{ ...relativeRectStyle(half), ...pageBackgroundFor(half, accent) }} />
            ))}
        </PonderSurfaceStateLayer>
        <PonderSurfaceStateLayer state="tab-seam" registerStateNode={registerStateNode}>
            <BravaisHomeSeam activeTab={1} accent={accent} />
        </PonderSurfaceStateLayer>
        {BRAVAIS_ENTRANCE_WAVES.map((wave, index) => (
            <PonderSurfaceStateLayer key={index} state={`tab-in-${index}`} registerStateNode={registerStateNode}>
                <BravaisTiles slots={slotsIn(wave)} itemFor={bravaisRadioItem} accent={accent} />
            </PonderSurfaceStateLayer>
        ))}

        {/* 指针停在歌手上：双色调淡出，露出原来的颜色。 */}
        <PonderSurfaceStateLayer state="artist-color" registerStateNode={registerStateNode}>
            <BravaisTile item={bravaisHomeItem(BRAVAIS_ARTIST_SLOT)} rect={BRAVAIS_ARTIST_SLOT.rect} accent={accent} colored />
        </PonderSurfaceStateLayer>

        {/* 打开集合：起点那张原地成为 01 号，其余从它开始一圈一圈翻成集合里的歌；缝里翻成集合的信息条。 */}
        {BRAVAIS_OPEN_RINGS.map((ring, index) => (
            <PonderSurfaceStateLayer key={index} state={`open-ring-${index}`} registerStateNode={registerStateNode}>
                <BravaisTiles slots={slotsIn(ring)} itemFor={bravaisCollectionItem} accent={accent} />
            </PonderSurfaceStateLayer>
        ))}
        <PonderSurfaceStateLayer state="open-seam" registerStateNode={registerStateNode}>
            <BravaisCollectionSeam accent={accent} />
        </PonderSurfaceStateLayer>
        {/* 返回：缝里翻回首页，墙从缝开始往两边翻回去；键盘焦点落回当初点的那张。 */}
        <PonderSurfaceStateLayer state="back-seam" registerStateNode={registerStateNode}>
            <BravaisHomeSeam activeTab={0} accent={accent} />
        </PonderSurfaceStateLayer>
        {BRAVAIS_BACK_RINGS.map((ring, index) => (
            <PonderSurfaceStateLayer key={index} state={`back-ring-${index}`} registerStateNode={registerStateNode}>
                <BravaisTiles slots={slotsIn(ring)} itemFor={bravaisHomeItem} accent={accent} focusedKey={BRAVAIS_ORIGIN_SLOT.key} />
            </PonderSurfaceStateLayer>
        ))}

        {/* 聚焦卡：块内让位 —— 只有这一块重新排，被点的歌放大成 6×6，其余七张挤进剩下的 L 形；块外一动不动。 */}
        <PonderSurfaceStateLayer state="focus-expanded" registerStateNode={registerStateNode}>
            <span data-ponder-bravais-block style={{ ...relativeRectStyle(G.block), ...pageBackgroundFor(G.block, accent) }} />
            {BRAVAIS_FOCUS_BLOCK_SLOTS.map((slot, index) => (index === BRAVAIS_FOCUS_INDEX ? null : (
                <BravaisTile key={slot.key} slotKey={`focus:${slot.key}`} item={bravaisHomeItem(slot)} rect={slot.rect} accent={accent} />
            )))}
            <BravaisFocusCard item={homeFocusItem} accent={accent} state="open" />
        </PonderSurfaceStateLayer>
        <PonderSurfaceStateLayer state="focus-queued" registerStateNode={registerStateNode}>
            <BravaisFocusCard item={homeFocusItem} accent={accent} state="queued" />
        </PonderSurfaceStateLayer>
        <PonderSurfaceStateLayer state="focus-playing" registerStateNode={registerStateNode}>
            <BravaisFocusCard item={homeFocusItem} accent={accent} state="playing" />
        </PonderSurfaceStateLayer>

        {/* 右下角工具按钮不属于墙：平移、翻牌都不动它。单独一层常驻，不被任何结果层替换。 */}
        <PonderSurfaceStateLayer state="tools-dock" registerStateNode={registerStateNode} visible>
            <BravaisToolsButton />
        </PonderSurfaceStateLayer>
        <PonderSurfaceStateLayer state="tools-open" registerStateNode={registerStateNode}>
            <BravaisToolsButton open />
            <BravaisToolsPanel accent={accent} look="solid" />
        </PonderSurfaceStateLayer>
        {/* 透光换档：整面墙换一次画法（替换基础层）；面板不收起，所以每一档自带一份面板，值换成新的那一档。 */}
        <PonderSurfaceStateLayer state="look-windows" registerStateNode={registerStateNode} replaces>
            <SeeThroughWall accent={accent} look="partial" />
            <BravaisToolsButton open />
            <BravaisToolsPanel accent={accent} look="partial" />
        </PonderSurfaceStateLayer>
        <PonderSurfaceStateLayer state="look-clear" registerStateNode={registerStateNode} replaces>
            <SeeThroughWall accent={accent} look="clear" />
            <BravaisToolsButton open />
            <BravaisToolsPanel accent={accent} look="clear" />
        </PonderSurfaceStateLayer>
        <PonderSurfaceStateLayer state="look-solid" registerStateNode={registerStateNode} replaces>
            <Wall accent={accent} slots={BRAVAIS_VISIBLE_SLOTS} itemFor={bravaisHomeItem} />
            <BravaisToolsButton open />
            <BravaisToolsPanel accent={accent} look="solid" />
        </PonderSurfaceStateLayer>

        <PonderSurfaceStateLayer state="lattice-handoff" registerStateNode={registerStateNode}>
            <LatticeWall accent={accent} />
        </PonderSurfaceStateLayer>
    </div>
);

export default PonderBravaisWallSurface;
