import React, { type MouseEvent } from 'react';
import { NotebookPen, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisItem } from './bravaisLayer';
import type { BravaisFocusCardActions } from './BravaisFocusCardBody';

// src/library/suites/bravais/BravaisTileQuickActions.tsx
// 歌曲磁贴与聚焦卡右上角悬浮才出现的两颗按钮：加入速记簿、收藏到歌单（应用的歌单选择器，含「我喜欢」）。
// 显隐只靠 CSS（磁贴 :hover / 键盘聚焦，bravaisCollection.css 的 .bravais-tile-quick），不为悬停多一次 React 渲染；
// 能不能做由 surface 判定（canCollect / canSaveToPlaylist），一颗都没有就不画。点击不冒泡到磁贴（磁贴的点击是展开）。

/** 太小的磁贴（拼贴里的 1×1 碎片）不放：两颗按钮会把封面盖满。 */
export const BRAVAIS_QUICK_ACTIONS_MIN_WIDTH = 120;

type BravaisTileQuickActionsProps = {
    slotKey: string;
    item: BravaisItem;
    actions: Pick<BravaisFocusCardActions, 'canCollect' | 'collect' | 'canSaveToPlaylist' | 'saveToPlaylist'>;
    /** 聚焦卡上：右上角已有「⋯」，排到它左边。 */
    beside?: 'more';
};

const BravaisTileQuickActions: React.FC<BravaisTileQuickActionsProps> = ({ slotKey, item, actions, beside }) => {
    const { t } = useTranslation();
    if (item.kind !== 'track' || item.unavailable) return null;
    const buttons = [
        ...(actions.canCollect(item.key)
            ? [{ id: 'collect', label: t('scratchpad.collect'), icon: NotebookPen, run: () => actions.collect(slotKey) }]
            : []),
        ...(actions.canSaveToPlaylist(item.key)
            ? [{ id: 'save-to-playlist', label: t('playlist.saveToPlaylist'), icon: Star, run: () => actions.saveToPlaylist(slotKey) }]
            : []),
    ];
    if (buttons.length === 0) return null;
    return (
        <span className="bravais-tile-quick" data-beside={beside}>
            {buttons.map(({ id, label, icon: Icon, run }) => (
                <button
                    key={id}
                    type="button"
                    data-bravais-action={id}
                    aria-label={label}
                    title={label}
                    onClick={(event: MouseEvent<HTMLButtonElement>) => {
                        event.stopPropagation();
                        // 鼠标点的：焦点交还给墙（留在按钮上的话方向键、Enter 都归它，按钮也一直亮着）。
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

export default BravaisTileQuickActions;
