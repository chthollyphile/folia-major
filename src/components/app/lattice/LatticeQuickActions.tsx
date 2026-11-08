import { type MouseEvent } from 'react';
import { NotebookPen, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { collectToScratchpad } from '../../../stores/useScratchpadStore';
import { canOpenPlaylistPickerFor, openAddSongsToPlaylist } from '../../../stores/useAddToPlaylistStore';
import { isStagePlaybackSong } from '../../../utils/appPlaybackGuards';
import type { LatticeSongTile } from './latticeModel';

// src/components/app/lattice/LatticeQuickActions.tsx
// Lattice 墙上歌曲海报右上角、指针停在海报上才出现的两颗按钮：加入速记簿、收藏到歌单（应用的歌单选择器，含「我喜欢」）。
// 与资料库墙 bravais 的磁贴悬浮按钮（BravaisTileQuickActions）同一组动作；显隐只靠 CSS（Lattice.css 的 .lattice-quick），
// 不为悬停多一次 React 渲染。按钮在海报里：墙的拖动（useWallPointerPan）和海报的点击（展开）都跳过按钮，不用另拦。

/** 太小的海报不放：两颗按钮会把封面盖满。 */
const LATTICE_QUICK_ACTIONS_MIN_WIDTH = 120;

type LatticeQuickActionsProps = {
    tile: LatticeSongTile;
    /** 海报的宽（世界坐标），太小不画。 */
    width: number;
    /** 展开的海报上才进 Tab 顺序：墙上几百张海报每张多两个 Tab 停靠点，键盘在墙上就走不动了。 */
    expanded: boolean;
};

const LatticeQuickActions = ({ tile, width, expanded }: LatticeQuickActionsProps) => {
    const { t } = useTranslation();
    if (width < LATTICE_QUICK_ACTIONS_MIN_WIDTH) return null;
    const { song } = tile;
    const buttons = [
        ...(!isStagePlaybackSong(song)
            ? [{
                id: 'collect',
                label: t('scratchpad.collect'),
                icon: NotebookPen,
                // 收进来的一行小字写从哪来的：队列海报是播放队列，探索页的海报是它所在的那一栏。
                run: () => collectToScratchpad([song], tile.label === undefined
                    ? { label: t('scratchpad.originQueue') }
                    : tile.heading ? { label: t('scratchpad.originExploreSection', { section: tile.heading }) } : undefined),
            }]
            : []),
        ...(canOpenPlaylistPickerFor(song)
            ? [{ id: 'save-to-playlist', label: t('playlist.saveToPlaylist'), icon: Star, run: () => openAddSongsToPlaylist([song]) }]
            : []),
    ];
    if (buttons.length === 0) return null;
    return (
        <span className="lattice-quick">
            {buttons.map(({ id, label, icon: Icon, run }) => (
                <button
                    key={id}
                    type="button"
                    className="lattice-quick-button"
                    data-lattice-action={id}
                    aria-label={label}
                    title={label}
                    tabIndex={expanded ? 0 : -1}
                    onClick={(event: MouseEvent<HTMLButtonElement>) => {
                        event.stopPropagation();
                        // 鼠标点的：焦点交还给墙（留在按钮上的话按钮一直亮着，方向键也归它）。
                        if (event.detail > 0) event.currentTarget.blur();
                        run();
                    }}
                >
                    <Icon aria-hidden />
                </button>
            ))}
        </span>
    );
};

export default LatticeQuickActions;
