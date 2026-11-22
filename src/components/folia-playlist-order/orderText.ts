import { createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';

// src/components/folia-playlist-order/orderText.ts
// 排序编辑器排的是什么：一张歌单里的歌，或者歌单本身（Folia 页的「调整歌单顺序」）。编辑器是同一个，只是文案里的
// 「歌」换成「歌单」：提到名词的那几句在 foliaPlaylistOrder 里另有一份，其余共用 localPlaylistOrder。

export type OrderNoun = 'songs' | 'playlists';

export const OrderNounContext = createContext<OrderNoun>('songs');

/** 换成「歌单」说法的那几句（foliaPlaylistOrder 里有的 key）。 */
const PLAYLIST_KEYS: ReadonlySet<string> = new Set([
    'edit', 'list', 'songCount', 'dragSong', 'dragCount', 'insertBefore', 'insertHint', 'stageHint', 'listEmpty',
    'finishStaging', 'selectedCount', 'sort', 'sortTitle', 'sortNotice', 'changed',
]);

/** 编辑器里的文案：按排的是歌还是歌单取对应的那一句。 */
export const useOrderText = (): ((key: string, params?: Record<string, unknown>) => string) => {
    const { t } = useTranslation();
    const noun = useContext(OrderNounContext);
    return (key, params) => t(`${noun === 'playlists' && PLAYLIST_KEYS.has(key) ? 'foliaPlaylistOrder' : 'localPlaylistOrder'}.${key}`, params ?? {});
};
