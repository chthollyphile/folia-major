import React, { type MouseEvent } from 'react';
import { Check, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisItem } from './bravaisLayer';
import { BRAVAIS_SPECIAL_ICONS } from './bravaisSpecialIcons';

// src/library/suites/bravais/BravaisTileMarks.tsx
// 首页磁贴右上角的两种记号（B9，设计稿 §10.5）：
// - 眼睛按钮：只有歌单类卡片有（core 判定可隐藏），平时悬停才出现，管理隐藏视图里常驻（stage 根节点的
//   is-managing-hidden）；点它切换隐藏（directory-toggle-hidden），不冒泡到磁贴的点击。
// - 勾：批量模式里选中的卡片（未选中的由磁贴本身灰度 + 半透明）。
// 左上角的类型标签也在这里（BravaisTileBadge）：特殊集合的标签是强调色底 + 小图标。

/**
 * 左上角的类型标签（Lattice 的 .lattice-poster-badge）。特殊集合（item.special：我喜欢的音乐、私人 FM、全部歌曲…）的标签
 * 换一身：强调色底、底色字，前面一个小图标（与缝里直达入口同一个，bravaisSpecialIcons），挂 is-special 与
 * data-bravais-special；文字仍是种类（歌单 / 电台 / 文件夹），读屏不念图标。普通卡片原样。
 * 歌曲的序号（item.badgeIsIndex：集合页、歌手页的歌曲）挂 is-index：「只显示正在播放的序号」开着时，墙面根上的
 * has-badge-current-only 把不是正在播放的那些藏起来（wall.css）；带文字的类型标签（首页卡片、探索页）照旧。
 */
export const BravaisTileBadge: React.FC<{ item: BravaisItem; current: boolean }> = ({ item, current }) => {
    const Icon = item.special ? BRAVAIS_SPECIAL_ICONS[item.special] : null;
    return (
        <span
            className={`lattice-poster-badge${item.badgeIsIndex ? ' is-index' : ''}${current ? ' is-current' : ''}${Icon ? ' is-special' : ''}`}
            data-bravais-special={item.special}
        >
            {Icon && <Icon aria-hidden className="bravais-badge-icon" />}
            {item.badge}
        </span>
    );
};

type BravaisTileMarksProps = {
    item: BravaisItem;
    onToggleHidden?: () => void;
};

const BravaisTileMarks: React.FC<BravaisTileMarksProps> = ({ item, onToggleHidden }) => {
    const { t } = useTranslation();
    const hidden = Boolean(item.hidden);
    const label = t(hidden ? 'libraryBravaisHome.unhide' : 'libraryBravaisHome.hide');
    const toggle = (event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onToggleHidden?.();
    };
    return (
        <>
            {item.hideable && onToggleHidden && (
                <button
                    type="button"
                    className={`bravais-tile-eye${hidden ? ' is-hidden' : ''}`}
                    data-bravais-action="toggle-hidden"
                    aria-pressed={hidden}
                    aria-label={label}
                    title={label}
                    onClick={toggle}
                >
                    {hidden ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                </button>
            )}
            {item.selected && (
                <span className="bravais-tile-check" data-bravais-selected aria-hidden>
                    <Check />
                </span>
            )}
        </>
    );
};

export default BravaisTileMarks;
