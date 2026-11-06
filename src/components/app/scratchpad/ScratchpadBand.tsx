import React, { memo, useMemo } from 'react';
import type { ScratchpadTab } from '../../../stores/useScratchpadStore';
import { selectDisplaySong, usePlaybackStore } from '../../../stores/usePlaybackStore';
import { scratchpadCoverUrl } from './scratchpadCover';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import ScratchpadShape from './ScratchpadShape';
import {
    SCRATCHPAD_PANEL_BAND_DECOS,
    SCRATCHPAD_TAB_SHAPES,
    scatterBandDecos,
    scatterSlimDecos,
    scratchpadShapeClipPath,
    type ScratchpadDeco,
    type ScratchpadShapeKind,
} from './scratchpadLook';

// src/components/app/scratchpad/ScratchpadBand.tsx
// 米白的信息条（设计稿 F）：计数斜块、编号、标题；条内纹理（速记簿网点、历史 60° 斜线、队列上下两排短刻度，标题那一段渐隐）；
// 标题右边的空白里撒一组这一页的几何体——实心、线框、墨色、镂空，和几张裁成这个形状的队列封面（接下来要放的几首）。
// 两种：左缘面板顶上那条（panel，缩成面板宽、右端斜切探出面板）与展开整页的那条（full，横贯整张纸，右端是这一页的按钮，
// 按钮由这一页自己经 actionsRef 那个空位画进来）。另有收起的细纸带（ScratchpadSlim）：展开整页时另外两页压在底下，点它换过去。
// 纹理与颜色在 scratchpad.css（按抽屉上的 data-page 换）。

type ScratchpadBandProps = {
    tab: ScratchpadTab;
    /** 01 / 02 / 03。 */
    index: string;
    title: string;
    count: number;
    /** panel：左缘面板顶上；full：展开整页；row：三行总览里的一行。 */
    variant?: 'panel' | 'full' | 'row';
    /** 展开整页与三行总览：标题下面一行小字（这一页的说明）。 */
    meta?: string;
    /** 展开整页与三行总览：条的宽度（整张纸那么宽），装饰按它撒。 */
    width?: number;
    /** 展开整页：右端按钮的空位。 */
    actionsRef?: React.Ref<HTMLDivElement>;
    /** 编号后面那个带下划线的链接：展开整页里是「‹ 三行总览」，三行总览里是「展开整页 ›」。 */
    link?: { label: string; onClick: () => void };
};

/** 装饰用的封面：正在放的那首之后的几首（没有正在放的就从头），有封面的取前 limit 张。 */
const useUpcomingCovers = (limit: number): string[] => {
    const playQueue = usePlaybackStore(state => state.playQueue);
    const displaySong = usePlaybackStore(selectDisplaySong);
    const displayKey = displaySong ? getPlaybackSongKey(displaySong) : null;
    return useMemo(() => {
        const current = displayKey === null ? -1 : playQueue.findIndex(song => getPlaybackSongKey(song) === displayKey);
        const covers: string[] = [];
        for (let index = current + 1; index < playQueue.length && covers.length < limit; index += 1) {
            const url = scratchpadCoverUrl(playQueue[index], 160);
            if (url) covers.push(url);
        }
        return covers;
    }, [displayKey, limit, playQueue]);
};

const decoStyle = (item: ScratchpadDeco): React.CSSProperties => ({
    left: item.x,
    top: item.y,
    width: item.size,
    height: item.size,
    transform: item.rotate ? `rotate(${item.rotate}deg)` : undefined,
});

const DECO_FILL: Record<Exclude<ScratchpadDeco['style'], 'image'>, string> = {
    fill: 'var(--scratchpad-mark)',
    ink: 'var(--scratchpad-ink)',
    hollow: 'var(--scratchpad-hollow)',
    wire: 'none',
};

/** 一组装饰：封面不够时，那一颗换成墨色的几何体。 */
const Decos: React.FC<{ shape: ScratchpadShapeKind; decos: readonly ScratchpadDeco[]; covers: readonly string[] }> = ({ shape, decos, covers }) => {
    let coverIndex = 0;
    return (
        <>
            {decos.map((item, key) => {
                const cover = item.style === 'image' && covers.length > 0 ? covers[coverIndex++ % covers.length] : undefined;
                if (cover) {
                    return (
                        <span key={key} className="scratchpad-band-deco is-cover" aria-hidden="true" style={{ ...decoStyle(item), clipPath: scratchpadShapeClipPath(shape, item.size) }}>
                            <img src={cover} alt="" loading="lazy" decoding="async" draggable={false} />
                        </span>
                    );
                }
                const style = item.style === 'image' ? 'ink' : item.style;
                return (
                    <ScratchpadShape
                        key={key}
                        kind={shape}
                        size={item.size}
                        className="scratchpad-band-deco"
                        style={{ position: 'absolute', ...decoStyle(item) }}
                        fill={DECO_FILL[style]}
                        stroke={style === 'wire' ? 'var(--scratchpad-ink)' : undefined}
                        strokeWidth={style === 'wire' ? 2 : undefined}
                    />
                );
            })}
        </>
    );
};

const ScratchpadBand: React.FC<ScratchpadBandProps> = ({ tab, index, title, count, variant = 'panel', meta, width = 0, actionsRef, link }) => {
    const shape = SCRATCHPAD_TAB_SHAPES[tab];
    const full = variant === 'full';
    const wide = variant !== 'panel';
    const covers = useUpcomingCovers(wide ? 6 : 3);
    // 宽度按 40px 一档取整再撒：窗口拖动改变大小时装饰不跟着每个像素重排。
    const widthStep = Math.round(width / 40) * 40;
    const decos = useMemo(
        () => (variant === 'panel' ? SCRATCHPAD_PANEL_BAND_DECOS[tab] : scatterBandDecos(tab, widthStep, variant)),
        [tab, variant, widthStep],
    );
    return (
        <div className={`scratchpad-band-wrap is-${variant}`}>
            <div className={`scratchpad-band is-${variant}`} data-testid="scratchpad-band" role="region" aria-label={title}>
                <span className="scratchpad-band-texture" aria-hidden="true" />
                {wide && <span className="scratchpad-band-skew" aria-hidden="true" />}
                <Decos shape={shape} decos={decos} covers={covers} />
                <div className="scratchpad-band-head">
                    <span className="scratchpad-band-count"><span>{count}</span></span>
                    <span className="scratchpad-band-heading">
                        <span className="scratchpad-band-index">
                            <span aria-hidden="true">{index}</span>
                            {link && <button type="button" className="scratchpad-band-link" onClick={link.onClick}>{link.label}</button>}
                        </span>
                        {wide ? <h2 className="scratchpad-band-title">{title}</h2> : <span className="scratchpad-band-title">{title}</span>}
                        {wide && meta && <span className="scratchpad-band-meta">{meta}</span>}
                    </span>
                </div>
                {full && <div className="scratchpad-band-actions" ref={actionsRef} />}
            </div>
        </div>
    );
};

type ScratchpadSlimProps = {
    tab: ScratchpadTab;
    index: string;
    title: string;
    countLabel: string;
    openLabel: string;
    onOpen: (tab: ScratchpadTab) => void;
};

/** 收起的信息条：一条细纸带，整条是换到那一页的按钮。 */
export const ScratchpadSlim: React.FC<ScratchpadSlimProps> = memo(({ tab, index, title, countLabel, openLabel, onOpen }) => {
    const shape = SCRATCHPAD_TAB_SHAPES[tab];
    const decos = useMemo(() => scatterSlimDecos(tab), [tab]);
    return (
        <button type="button" className="scratchpad-slim" data-page={tab} data-scratchpad-slim={tab} aria-label={`${openLabel} · ${title}`} onClick={() => onOpen(tab)}>
            <span className="scratchpad-band-texture" aria-hidden="true" />
            <Decos shape={shape} decos={decos} covers={[]} />
            <span className="scratchpad-slim-head">
                <ScratchpadShape kind={shape} size={14} fill="var(--scratchpad-mark)" />
                <span className="scratchpad-band-index">{index}</span>
                <span className="scratchpad-slim-title">{title}</span>
                <span className="scratchpad-slim-count">{countLabel}</span>
                <span className="scratchpad-slim-open">{openLabel} ›</span>
            </span>
        </button>
    );
});
ScratchpadSlim.displayName = 'ScratchpadSlim';

export default memo(ScratchpadBand);
