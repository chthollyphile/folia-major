import type { TFunction } from 'i18next';
import type { SongResult } from '../../../types';
import { omni } from '../../../services/onlineMusic/omni';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import { canOpenPlaylistPickerFor } from '../../../stores/useAddToPlaylistStore';

// src/components/app/scratchpad/scratchpadModel.ts
// 列表与画布共用的小判断：一首歌的来源怎么称呼、它所在的组能不能进歌单。

/** 来源的称呼（组头与行上的小标签）。 */
export const scratchpadSourceLabel = (song: SongResult, t: TFunction): string => {
    const source = getPlaybackSourceRef(song);
    if (source.kind === 'online') return omni.getProviderLabel(source.providerId);
    if (source.kind === 'navidrome') return t('navidrome.title');
    return t('scratchpad.sourceLocal');
};

/** 这首（以及和它同组的歌）能不能交给歌单选择器（含「我喜欢」）；规则与资料库卡片上的按钮是同一条。 */
export const canAddScratchpadSongToPlaylist = canOpenPlaylistPickerFor;
