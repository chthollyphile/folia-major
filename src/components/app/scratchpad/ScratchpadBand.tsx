import React, { memo, useMemo } from 'react';
import type { ScratchpadTab } from '../../../stores/useScratchpadStore';
import { selectDisplaySong, usePlaybackStore } from '../../../stores/usePlaybackStore';
import { getSongCoverUrl } from '../../../services/onlineMusic/songMetadata';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import ScratchpadShape from './ScratchpadShape';
import { SCRATCHPAD_PANEL_BAND_DECOS, SCRATCHPAD_TAB_SHAPES, scratchpadShapeClipPath, type ScratchpadDeco } from './scratchpadLook';

// src/components/app/scratchpad/ScratchpadBand.tsx
// 左缘面板顶上那条米白信息条（设计稿 F 的信息条缩成面板宽）：计数斜块、编号、标题；条内纹理（速记簿网点、历史 60° 斜线、
// 队列上下两排短刻度，标题那一段渐隐）；标题右边的空白里撒一组这一页的几何体——实心、线框、墨色、镂空，和一两张裁成这个形状的
// 队列封面（接下来要放的几首）。右端斜切、探出面板一截。纹理与颜色在 scratchpad.css（按抽屉上的 data-page 换）。

type ScratchpadBandProps = {
    tab: ScratchpadTab;
    /** 01 / 02 / 03。 */
    index: string;
    title: string;
    count: number;
};

/** 装饰用的封面：正在放的那首之后的几首（没有正在放的就从头），有封面的取前三张。 */
const useUpcomingCovers = (): string[] => {
    const playQueue = usePlaybackStore(state => state.playQueue);
    const displaySong = usePlaybackStore(selectDisplaySong);
    const displayKey = displaySong ? getPlaybackSongKey(displaySong) : null;
    return useMemo(() => {
        const current = displayKey === null ? -1 : playQueue.findIndex(song => getPlaybackSongKey(song) === displayKey);
        const covers: string[] = [];
        for (let index = current + 1; index < playQueue.length && covers.length < 3; index += 1) {
            const url = getSongCoverUrl(playQueue[index]);
            if (url) covers.push(url);
        }
        return covers;
    }, [displayKey, playQueue]);
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

const ScratchpadBand: React.FC<ScratchpadBandProps> = ({ tab, index, title, count }) => {
    const shape = SCRATCHPAD_TAB_SHAPES[tab];
    const covers = useUpcomingCovers();
    let coverIndex = 0;
    return (
        <div className="scratchpad-band-wrap">
            <div className="scratchpad-band" data-testid="scratchpad-band">
                <span className="scratchpad-band-texture" aria-hidden="true" />
                {SCRATCHPAD_PANEL_BAND_DECOS[tab].map((item, key) => {
                    // 封面不够时，那一颗换成墨色的几何体。
                    const cover = item.style === 'image' ? covers[coverIndex++] : undefined;
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
                <div className="scratchpad-band-head">
                    <span className="scratchpad-band-count"><span>{count}</span></span>
                    <span className="scratchpad-band-heading">
                        <span className="scratchpad-band-index" aria-hidden="true">{index}</span>
                        <span className="scratchpad-band-title">{title}</span>
                    </span>
                </div>
            </div>
        </div>
    );
};

export default memo(ScratchpadBand);
