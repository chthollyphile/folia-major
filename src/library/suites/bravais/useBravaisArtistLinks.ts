import { useMemo, useRef } from 'react';
import type { SongResult } from '../../../types';
import type { LibraryArtistAlbum } from '../../core/artist/artist.contract';
import type { LibraryArtistSurfaceProps } from '../../core/suite/suite.contract';
import type { ArtistView } from '../../core/artist/useArtistView';
import { resolveTrackAlbumLink, resolveTrackArtistLinks } from '../../core/shared/trackLinks';
import { canResolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';
import type { useBravaisSessionFocus } from './useBravaisSessionFocus';

// src/library/suites/bravais/useBravaisArtistLinks.ts
// 歌手页层描述上的回调（身份稳定，执行时读最新的映射与动作）：单击专辑磁贴进入专辑；热门歌曲的播放 / 入队；聚焦卡上的
// 专辑链接与其他歌手的链接（推入下一层，core 的 trackLinks 规则）。歌手页自己的名字不给链接——点了宿主也不压栈
// （同一个歌手），留着只会是个死链接。打开嵌套层、播放之前把这一项写回浏览会话（返回时焦点回到它）。

type Focus = ReturnType<typeof useBravaisSessionFocus>;

export type BravaisArtistLinksInput = {
    collection: LibraryArtistSurfaceProps['collection'];
    view: ArtistView;
    /** 层内条目 key → 热门歌曲 / 专辑。 */
    songByKey: ReadonlyMap<string, SongResult>;
    albumByKey: ReadonlyMap<string, LibraryArtistAlbum>;
    focus: Focus;
    onOpenAlbum: LibraryArtistSurfaceProps['onOpenAlbum'];
    onOpenArtist: LibraryArtistSurfaceProps['onOpenArtist'];
    onBack: () => void;
    onDone: () => void;
};

/** 这一页歌手自己的身份（在线 / Navidrome 是描述 id，本地还认实体 id）。 */
const ownArtistIds = (collection: LibraryArtistSurfaceProps['collection']) => {
    const ids = new Set<string>([String(collection.id)]);
    if (collection.source === 'local' && collection.entityId) ids.add(String(collection.entityId));
    return ids;
};

export const useBravaisArtistLinks = (input: BravaisArtistLinksInput) => {
    const latest = useRef(input);
    latest.current = input;

    return useMemo(() => {
        const songOf = (key: string) => latest.current.songByKey.get(key);
        const offers = (action: Parameters<ArtistView['offers']>[0]) => latest.current.view.offers(action);
        const albumLink = (key: string) => {
            const song = songOf(key);
            return song && offers('open-album') ? resolveTrackAlbumLink(song, canResolveSongCatalogRef) : null;
        };
        const artistLink = (key: string, index: number) => {
            const song = songOf(key);
            if (!song || !offers('open-artist')) return null;
            const link = resolveTrackArtistLinks(song, canResolveSongCatalogRef)[index];
            if (!link || link.targetId === undefined) return null;
            return ownArtistIds(latest.current.collection).has(String(link.targetId)) ? null : link;
        };
        return {
            /** 单击专辑磁贴：进入专辑（stage 已把被点的 slot 记成起点）。 */
            onOpenItem: (key: string) => {
                const album = latest.current.albumByKey.get(key);
                if (!album || !offers('open-album')) return;
                latest.current.focus.persistFocus(key);
                latest.current.view.actions.openAlbum(album);
            },
            onPlayItem: (key: string) => {
                const song = songOf(key);
                if (!song || !offers('play')) return;
                latest.current.focus.persistFocus(key);
                latest.current.view.actions.playSong(song);
            },
            onEnqueueItem: (key: string) => {
                const song = songOf(key);
                if (song && offers('enqueue')) latest.current.view.actions.enqueueSong(song);
            },
            canOpenAlbum: (key: string) => Boolean(albumLink(key)),
            onOpenAlbum: (key: string) => {
                const song = songOf(key);
                const link = albumLink(key);
                if (!song || !link) return;
                latest.current.focus.persistFocus(key);
                latest.current.onOpenAlbum(link.targetId, { ...link.album }, song);
            },
            canOpenArtist: (key: string, index: number) => Boolean(artistLink(key, index)),
            onOpenArtist: (key: string, index: number) => {
                const song = songOf(key);
                const link = artistLink(key, index);
                if (!song || !link || link.targetId === undefined) return;
                latest.current.focus.persistFocus(key);
                latest.current.onOpenArtist(link.targetId, { ...link.artist }, song);
            },
            onFocusEntry: (key: string | null) => latest.current.focus.noteFocus(key),
            onBack: () => latest.current.onBack(),
            onDone: () => latest.current.onDone(),
            onPlayScope: () => latest.current.view.actions.playScope(),
            onEnqueueScope: () => {
                latest.current.view.actions.enqueueScope();
            },
        };
    }, []);
};
