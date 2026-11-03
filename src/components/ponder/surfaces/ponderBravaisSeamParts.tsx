import React from 'react';
import type { LucideIcon } from 'lucide-react';
import type { PonderRelativeRect } from '../../../types/ponder';
import { relativeRectStyle } from './relativeRectStyle';
import {
    BRAVAIS_WALL_LEFT,
    BRAVAIS_WALL_RIGHT,
    bravaisWallTileRect,
    type BravaisWallTile,
} from './ponderBravaisSeamGeometry';

// src/components/ponder/surfaces/ponderBravaisSeamParts.tsx
// bravais 信息条教程的合成界面零件：两半面墙、缝的纸、竖排「字」、缝里的图标按钮。
//
// 不 import bravais 自己的组件或 CSS：components 层不反向依赖 library/suites（分层边界），
// 而且教程画的是轮廓不是业务状态。竖排文字画成一列小方块 —— 换语言也成立，
// 又比一根竖条更像「一个字一个字竖着写」，这正是这条缝在排版上最认得出的地方。

export type BravaisSeamColors = { accent: string; line: string; outline: string };

/** 缝的纸色：比墙底浅一档的深色纸，带外阴影 —— 真实缝比墙面高出一层。 */
export const BRAVAIS_SEAM_PAPER = 'rgba(32,32,36,0.98)';
/** 缝里的墨色：竖排的「字」用它，比占位条亮得多 —— 页签和标题在真实界面里是读得清的字，不是底纹。 */
export const BRAVAIS_SEAM_INK = 'rgba(244,244,245,0.82)';
/** 浮在缝上的菜单 / 平台列表：不透明，比纸再亮一点。 */
export const BRAVAIS_SEAM_POPUP = 'rgba(44,44,50,1)';

/**
 * 竖排的一串字：count 个小方块，size 是每个方块相对容器宽度的比例（或固定 px）。
 * 百分比的 size 时自己撑满容器的宽度：按内容收缩的话百分比无处可依，方块会缩成 0。
 */
export const VerticalGlyphs: React.FC<{
    count: number;
    size: string;
    color: string;
    opacity?: number;
    /** 方块之间的间距。用 px：容器高度按内容定，百分比的间距会算成 0。 */
    gap?: string;
    className?: string;
}> = ({ count, size, color, opacity = 0.85, gap = '3px', className = '' }) => (
    <span className={`flex flex-col items-center ${size.endsWith('%') ? 'w-full' : ''} ${className}`} style={{ gap }}>
        {Array.from({ length: count }, (_, index) => (
            <span key={index} className="block shrink-0 rounded-[22%]" style={{ width: size, aspectRatio: '1 / 1', backgroundColor: color, opacity }} />
        ))}
    </span>
);

/** 横排的一串字（「书库」、面包屑里的层名）。 */
export const HorizontalGlyphs: React.FC<{ count: number; height: string; color: string; opacity?: number }> = ({ count, height, color, opacity = 0.8 }) => (
    <span className="flex h-full items-center gap-[2px]">
        {Array.from({ length: count }, (_, index) => (
            <span key={index} className="block shrink-0 rounded-[22%]" style={{ height, aspectRatio: '1 / 1', backgroundColor: color, opacity }} />
        ))}
    </span>
);

/** 一行横排的文字占位。 */
export const TextBar: React.FC<{ width: string; color: string; className?: string; opacity?: number }> = ({ width, color, className = 'h-1.5', opacity = 1 }) => (
    <span className={`block rounded-full ${className}`} style={{ width, backgroundColor: color, opacity }} />
);

/** 缝里的方形图标按钮（工具格、书脊上那一列）。 */
export const SeamIcon: React.FC<{
    rect: PonderRelativeRect;
    icon: LucideIcon;
    marker?: string;
    pressed?: boolean;
    accent?: string;
    outline?: string;
}> = ({ rect, icon: Icon, marker, pressed, accent, outline }) => (
    <span
        {...(marker ? { [marker]: true } : {})}
        className="flex items-center justify-center rounded-[28%]"
        style={{
            ...relativeRectStyle(rect),
            backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : undefined,
            boxShadow: pressed && outline ? `inset 0 0 0 1px ${outline}` : undefined,
            color: pressed ? accent : undefined,
        }}
    >
        <Icon className="h-[46%] w-[46%] opacity-75" />
    </span>
);

/** 一张磁贴：海报底色、左上角的种类小牌、左下角的标题与副标题。 */
const WallTile: React.FC<{ rect: PonderRelativeRect; colors: BravaisSeamColors; accent?: boolean; blank?: boolean; linked?: boolean }> = ({
    rect,
    colors,
    accent,
    blank,
    linked,
}) => (
    <span
        data-ponder-bravais-tile={blank ? 'wall' : 'content'}
        className="overflow-hidden rounded-[3px] border"
        style={{
            ...relativeRectStyle(rect),
            borderColor: linked ? colors.accent : colors.outline,
            boxShadow: linked ? `0 0 0 2px ${colors.accent}` : undefined,
            background: blank
                ? 'rgba(255,255,255,0.025)'
                : accent
                    ? `linear-gradient(165deg, ${colors.accent} 0%, rgba(24,24,27,0.9) 92%)`
                    : `linear-gradient(165deg, ${colors.line} 0%, rgba(24,24,27,0.85) 95%)`,
            opacity: blank ? 0.7 : accent ? 0.5 : 0.9,
        }}
    >
        {!blank && (
            <>
                <span className="absolute left-[6%] top-[6%] h-[7%] w-[26%] rounded-[2px] bg-black/40" />
                <span className="absolute bottom-[14%] left-[6%] h-[7%] w-[56%] rounded-full bg-white/35" />
                <span className="absolute bottom-[8%] left-[6%] h-[3.5%] w-[30%] rounded-full bg-white/20" />
            </>
        )}
    </span>
);

/**
 * 缝两侧的两半面墙。seamWidth 决定两半各让出多少：磁贴尺寸不变，整半墙往外滑 ——
 * 换档时画面上是墙在让位，而不是磁贴被挤窄。
 *
 * keep 给出时是「过滤中」的有限拼贴：只有离缝最近的那几张还是内容，其余翻成墙面留白。
 */
export const BravaisWall: React.FC<{
    colors: BravaisSeamColors;
    seamWidth: number;
    /** 换页签之后那面墙：同样的格子，换一批亮的磁贴。 */
    variant?: 'a' | 'b';
    keep?: { left: readonly number[]; right: readonly number[] };
    linked?: { side: 'left' | 'right'; index: number };
}> = ({ colors, seamWidth, variant = 'a', keep, linked }) => {
    const accentOf = (tile: BravaisWallTile, index: number) => (variant === 'a' ? tile.accent : index % 4 === 1);
    const tiles = (side: 'left' | 'right', pattern: readonly BravaisWallTile[]) => pattern.map((tile, index) => (
        <WallTile
            key={`${side}-${index}`}
            rect={bravaisWallTileRect(tile, side, seamWidth)}
            colors={colors}
            accent={keep ? keep[side].indexOf(index) === 0 : accentOf(tile, index)}
            blank={keep ? !keep[side].includes(index) : false}
            linked={linked?.side === side && linked.index === index}
        />
    ));
    return (
        <div className="absolute inset-0" data-ponder-bravais-wall={seamWidth === 0 ? 'closed' : 'split'}>
            {tiles('left', BRAVAIS_WALL_LEFT)}
            {tiles('right', BRAVAIS_WALL_RIGHT)}
        </div>
    );
};

/** 右下角那颗墙面工具按钮（与 Lattice 同一颗）。 */
export const WallToolsButton: React.FC<{ rect: PonderRelativeRect; icon: LucideIcon; outline: string; pressed?: boolean }> = ({ rect, icon: Icon, outline, pressed }) => (
    <span
        data-ponder-bravais-tools-button
        className="flex items-center justify-center rounded-full border"
        style={{ ...relativeRectStyle(rect), borderColor: outline, backgroundColor: pressed ? 'rgba(255,255,255,0.16)' : 'rgba(9,9,11,0.85)' }}
    >
        <Icon className="h-[46%] w-[46%] opacity-75" />
    </span>
);

/** 缝本身：一条竖贯整页的纸，带外阴影。children 按缝的 0..1 坐标摆。 */
export const SeamPaper: React.FC<{ rect: PonderRelativeRect; outline: string; marker: string; children?: React.ReactNode }> = ({
    rect,
    outline,
    marker,
    children,
}) => (
    <div
        {...{ [marker]: true }}
        data-ponder-bravais-seam
        style={{
            ...relativeRectStyle(rect),
            backgroundColor: BRAVAIS_SEAM_PAPER,
            boxShadow: `0 0 0 1px ${outline}, 0 0 22px rgba(0,0,0,0.55)`,
        }}
    >
        {children}
    </div>
);
