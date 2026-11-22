import type { TFunction } from 'i18next';
import type { FoliaPlaylistAddResult } from '../../types/foliaPlaylist';

// src/components/folia-playlists/foliaAddResult.ts
// 往一张 Folia 歌单里加完歌之后提示里写什么（收藏框、速记簿整本 / 一页 / 一组、把队列存成歌单共用）：
// 「加了 N 首，M 首已在歌单里」。一首都没加进去时不算成功：全都已经在里面是一句说明，全都收不进是失败。

export type FoliaAddResultMessage = { type: 'success' | 'info' | 'error'; text: string; note?: string };

export const describeFoliaAddResult = (result: FoliaPlaylistAddResult, playlistName: string, t: TFunction): FoliaAddResultMessage => {
    const { added, duplicates, rejected } = result;
    // 有几首没收进去（曲库里已经没有的本地歌、没有来源的歌）：成功的提示下面补一句，不让它们悄悄少掉。
    const note = rejected > 0 ? t('foliaPlaylist.rejectedNote', { count: rejected }) : undefined;
    if (added > 0 && duplicates > 0) {
        return { type: 'success', text: t('foliaPlaylist.addedSome', { name: playlistName, added, duplicates }), note };
    }
    if (added > 0) return { type: 'success', text: t('foliaPlaylist.added', { name: playlistName, added }), note };
    if (duplicates > 0) return { type: 'info', text: t('foliaPlaylist.allDuplicates', { name: playlistName, duplicates }), note };
    return { type: 'error', text: t('foliaPlaylist.noneAdded') };
};
