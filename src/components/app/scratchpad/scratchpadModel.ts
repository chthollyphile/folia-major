import type { TFunction } from 'i18next';
import type { LucideIcon } from 'lucide-react';
import type { SongResult } from '../../../types';
import { omni } from '../../../services/onlineMusic/omni';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import { canOpenPlaylistPickerFor } from '../../../stores/useAddToPlaylistStore';

// src/components/app/scratchpad/scratchpadModel.ts
// 列表与画布共用的小判断：一首歌的来源怎么称呼、它所在的组能不能进歌单；以及按钮的描述（组头、行内、浮动菜单都用它）。

/** 来源的称呼（组头与行上的小标签）。 */
export const scratchpadSourceLabel = (song: SongResult, t: TFunction): string => {
    const source = getPlaybackSourceRef(song);
    if (source.kind === 'online') return omni.getProviderLabel(source.providerId);
    if (source.kind === 'navidrome') return t('navidrome.title');
    return t('scratchpad.sourceLocal');
};

/** 这首（以及和它同组的歌）能不能交给歌单选择器（含「我喜欢」）；规则与资料库卡片上的按钮是同一条。 */
export const canAddScratchpadSongToPlaylist = canOpenPlaylistPickerFor;

/** 一颗按钮：组头、行内与选中后的浮动菜单都按它画。 */
export type ScratchpadAction = {
    id: string;
    label: string;
    icon: LucideIcon;
    run: () => void;
    disabled?: boolean;
    /** 悬停提示（缺省是 label）：不能用时说明为什么。 */
    title?: string;
};

/** 展开整页右边那一列的操作提示：每页四条（拖空白框选、Ctrl + 点加选，再加这一页能做的两件事）。 */
export const scratchpadTips = (
    tab: 'notes' | 'history' | 'queue',
    t: TFunction,
    modifier: string,
    canReorder = true,
): { key: string; label: string }[] => {
    const tip = (key: string, label: string) => ({ key: t(`scratchpad.${key}`, { mod: modifier }), label: t(`scratchpad.${label}`) });
    const common = [tip('tipMarqueeKey', 'tipMarquee'), tip('tipAddKey', 'tipAdd')];
    if (tab === 'notes') return [...common, tip('tipReorderKey', 'tipReorderGroup'), tip('tipEscKey', 'tipEsc')];
    if (tab === 'history') return [...common, tip('tipPlayKey', 'tipPlay'), tip('tipDeleteKey', 'tipDelete')];
    return [...common, ...(canReorder ? [tip('tipReorderKey', 'tipReorder')] : []), tip('tipPlayKey', 'tipPlay')];
};
