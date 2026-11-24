import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { SongResult, UnifiedSong } from '../../types';
import type { FoliaPlaylistSummary } from '../../types/foliaPlaylist';
import type { ProviderCollection } from '../../types/onlineMusic';
import PlaylistSelectionDialog, { type PlaylistSelectionDialogItem, type PlaylistSelectionSubject } from '../shared/PlaylistSelectionDialog';
import { getPlaybackSourceRef, resolveNavidromePlaybackCarrier } from '../../utils/appPlaybackGuards';
import { omni } from '../../services/onlineMusic/omni';
import { getSongArtistLabel, getSongCoverUrl } from '../../services/onlineMusic/songMetadata';
import { selectDisplaySong, usePlaybackStore } from '../../stores/usePlaybackStore';
import {
    readLastAddToPlaylistPane,
    readLastFoliaPlaylistId,
    rememberAddToPlaylistPane,
    rememberLastFoliaPlaylistId,
    useAddToPlaylistStore,
    type AddToPlaylistPane,
} from '../../stores/useAddToPlaylistStore';
import { useFoliaPlaylistsStore } from '../../stores/useFoliaPlaylistsStore';
import { useScratchpadStore } from '../../stores/useScratchpadStore';
import { addPickedSongsToFoliaPlaylist, createFoliaPlaylistFromPickedSongs } from '../../services/foliaPlaylist/foliaPlaylistService';
import { getTrackSourceKey } from '../../services/foliaPlaylist/trackSourceState';
import { foliaPlaylistEntryKeyOf } from '../../library/core/collection/mutations/collectionMutationCapabilities';
import { describeFoliaAddResult } from '../folia-playlists/foliaAddResult';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { onlineMutationFailureText } from '../../services/onlineMusic/failure/onlineMutationFailure';

// src/components/app/AddToPlaylistHost.tsx
// The playlist picker for the current song (and for the songs a scratchpad row or group, or a library
// card, asks it for); "new playlist" is made right in it.
//
// Lifted out of UnifiedPanel so it is not tied to the player panel being on screen: it answers a
// question about the song, not about the panel, and a command bound to a global shortcut has to be
// able to ask it from anywhere. The star button in the panel now only requests it.
//
// Two panes (Folia 聚合歌单规格 §7): **Folia** — "Liked songs" first, then Folia's own playlists, "new playlist" at
// the bottom; it takes songs of any source, several sources at once too — and **the source the songs come from**
// (titled with its name): the platform's heart and playlists, or Navidrome's star and playlists, as before.
// Only the Folia pane shows for local songs (local playlists are Folia's now), for a source with no account
// playlists and no likes, and for a request whose songs come from more than one source.
// The picker remembers the pane used last and the Folia playlist picked last (useAddToPlaylistStore).
//
// Everything the sources need to be told apart stays here, in one place, because the answer depends on a
// Navidrome fetch — see the note in useAddToPlaylistStore.

type AddToPlaylistHostProps = {
    isDaylight: boolean;
    // All four are handed the songs the picker is about: the shown song (the playback store's
    // current song is another one during a blend, and after any change of track under the open
    // dialog), or the ones it was asked for. The source pane only shows for songs of one source.
    onAddSongsToOnlinePlaylist: (playlist: ProviderCollection, songs: SongResult[]) => Promise<void>;
    onCreateOnlinePlaylistWithSongs: (name: string, songs: SongResult[]) => Promise<void>;
    onAddSongsToNavidromePlaylist: (playlistId: string, songs: SongResult[]) => Promise<void>;
    onCreateNavidromePlaylistWithSongs: (name: string, songs: SongResult[]) => Promise<void>;
    /** 这首歌在不在 Folia 的「我喜欢的音乐」里，和播放页红心同一份判断（重复导入的本地歌按 canonical 的那条算）。 */
    isFoliaSongLiked: (song: SongResult | null) => boolean;
};

type PlaylistEntry = PlaylistSelectionDialogItem;

/** 选择器里「我喜欢」那一行的 id（在线歌的红心、Navidrome 的星标；不会和平台的歌单 id 撞上）。 */
const LIKED_ENTRY_ID = '__folia-liked__';

const navidromeIdOf = (song: SongResult) => resolveNavidromePlaybackCarrier(song as UnifiedSong)?.navidromeData?.id;

// What kind of song this is to the picker, and whether its source takes it into a playlist.
const describeSong = (song: SongResult | null, hasOnlinePlaylists: boolean) => {
    const isStage = Boolean(song && (song as any).isStage === true);
    const isNavidrome = Boolean(song && (song as any).isNavidrome === true);
    const isLocal = Boolean(song && !isNavidrome && (((song as any).isLocal === true) || Boolean((song as any).localRef?.songId)));
    const playbackSourceRef = song ? getPlaybackSourceRef(song) : null;
    const isOnline = playbackSourceRef?.kind === 'online';
    const canAddOnlineSong = Boolean(song && isOnline && omni.canAddSongToPlaylist(song));
    const canCreateOnline = Boolean(song && isOnline && omni.canCreatePlaylistForSong(song));
    // 「我喜欢」是选择器里单独的一行（走平台的红心，不是往歌单里加）：有的平台的喜欢列表根本不是歌单。
    const canLike = Boolean(song && isOnline && omni.canLikeSong(song));
    return {
        isNavidrome, isLocal, isOnline, canAddOnlineSong, canCreateOnline, canLike,
        onlineProviderLabel: playbackSourceRef?.kind === 'online' ? omni.getProviderLabel(playbackSourceRef.providerId) : '',
        isApplicable: Boolean(song && !isStage && (isLocal || isOnline || isNavidrome)),
        // The source's own pane has something to offer: Navidrome always (a playlist can be made on the spot), an
        // online source that edits playlists (with one to pick or the right to make one) or takes likes. Local songs
        // have no pane of their own: their playlists are Folia's.
        hasSourcePane: (isOnline && ((canAddOnlineSong && (hasOnlinePlaylists || canCreateOnline)) || canLike)) || isNavidrome,
    };
};

export const AddToPlaylistHost: React.FC<AddToPlaylistHostProps> = ({
    isDaylight,
    onAddSongsToOnlinePlaylist,
    onCreateOnlinePlaylistWithSongs,
    onAddSongsToNavidromePlaylist,
    onCreateNavidromePlaylistWithSongs,
    isFoliaSongLiked,
}) => {
    const { t } = useTranslation();
    // The song as the listener sees it, so a blend shows the track that is on screen. It is what
    // the star button answers for.
    const shownSong = usePlaybackStore(selectDisplaySong);
    const foliaPlaylists = useFoliaPlaylistsStore(state => state.playlists);
    const { isOpen, requestedSongs, origin, close, setAvailability } = useAddToPlaylistStore(useShallow(state => ({
        isOpen: state.isOpen,
        requestedSongs: state.songs,
        origin: state.origin,
        close: state.close,
        setAvailability: state.setAvailability,
    })));
    // The songs the picker is about: the ones it was asked for (a scratchpad row or group, a library
    // card), else the one that was shown when it came up. The track can change under an open picker
    // (a blend lands, the queue advances), and the picker does not say which song it is for; what it
    // adds is the song the listener asked about.
    const [askedSongs, setAskedSongs] = useState<SongResult[] | null>(null);
    const pickerSongs = requestedSongs ?? (shownSong ? [shownSong] : null);
    // Which pane is up, and the Folia playlist picked last: both read when the picker comes up.
    const [pane, setPane] = useState<AddToPlaylistPane>('folia');
    const [lastFoliaPlaylistId, setLastFoliaPlaylistId] = useState<string | null>(null);
    if (isOpen && !askedSongs && pickerSongs) {
        setAskedSongs(pickerSongs);
        setPane(readLastAddToPlaylistPane());
        setLastFoliaPlaylistId(readLastFoliaPlaylistId());
    } else if (!isOpen && askedSongs) {
        setAskedSongs(null);
    }
    const [navidromePlaylists, setNavidromePlaylists] = useState<PlaylistEntry[]>([]);
    const starredNavidromeSongIds = useLibraryStore(state => state.starredNavidromeSongIds);

    // The dialog is about the songs it was asked for, whatever is playing by now. The source pane only
    // shows when they are all of one source, and there the first one speaks for them.
    const targetSongs = useMemo(
        () => (isOpen ? askedSongs : null) ?? (shownSong ? [shownSong] : []),
        [askedSongs, isOpen, shownSong],
    );
    const currentSong = targetSongs[0] ?? null;
    // Only the song's own platform's playlists take it (omni refuses the others): read for the song
    // the picker is about, not for the one playing — a scratchpad group is often of another platform.
    // The accounts are read so that a refreshed or signed-out account's list shows here.
    const accounts = useOnlineProviderAccountStore(state => state.accounts);
    // 喜欢列表由「我喜欢」那一行代表（红心），不在歌单里再出现一次。
    const songPlaylists = useMemo(
        () => (currentSong ? omni.getPlaylistsForSong(currentSong).filter(playlist => !(playlist.isLiked && omni.canLikeSong(currentSong))) : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- accounts is what getPlaylistsForSong reads
        [accounts, currentSong],
    );
    const shownPlaylistCount = useMemo(
        () => (shownSong ? omni.getPlaylistsForSong(shownSong).length : 0),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- accounts is what getPlaylistsForSong reads
        [accounts, shownSong],
    );
    const shown = describeSong(shownSong, shownPlaylistCount > 0);
    const { isNavidrome, isLocal, isOnline, canCreateOnline, canLike, onlineProviderLabel, hasSourcePane } = describeSong(currentSong, songPlaylists.length > 0);
    const isMultiSource = useMemo(() => new Set(targetSongs.map(getTrackSourceKey)).size > 1, [targetSongs]);
    // Every song the picker is about can go into a Folia playlist (a stage song belongs to no source and cannot).
    const isApplicable = targetSongs.length > 0 && targetSongs.every(song => describeSong(song, false).isApplicable);
    const showSourcePane = hasSourcePane && !isMultiSource;
    const activePane: AddToPlaylistPane = showSourcePane ? pane : 'folia';
    const inFolia = activePane === 'folia';
    const needsNavidromePlaylists = isNavidrome || shown.isNavidrome;

    const refreshNavidromePlaylists = useCallback(async () => {
        const { getNavidromeConfig, navidromeApi } = await import('../../services/navidromeService');
        const config = getNavidromeConfig();
        if (!config) {
            setNavidromePlaylists([]);
            return;
        }

        const playlists = await navidromeApi.getPlaylists(config);
        setNavidromePlaylists(playlists.map((playlist) => ({
            id: playlist.id,
            name: playlist.name,
            description: `${playlist.songCount} ${t('playlist.tracks')}`,
        })));
    }, [t]);

    useEffect(() => {
        if (!needsNavidromePlaylists) {
            setNavidromePlaylists([]);
            return;
        }

        void refreshNavidromePlaylists();
    }, [shownSong?.id, needsNavidromePlaylists, refreshNavidromePlaylists]);

    const availablePlaylists = useMemo<PlaylistEntry[]>(() => {
        const likedRow = (allLiked: boolean): PlaylistEntry => ({
            id: LIKED_ENTRY_ID,
            name: t('localMusic.favoritePlaylist'),
            kind: 'liked',
            note: allLiked ? t('playlist.alreadyLiked') : undefined,
        });
        const trackCount = (count: number) => `${count} ${t('playlist.tracks')}`;

        if (inFolia) {
            // Folia 的「我喜欢的音乐」就是收藏歌单本身（isFavorite）：画成红心那一行，排在最前；其后是聚合歌单。
            // 「已喜欢」和播放页的红心同一个口径：正在放的是重复导入的副本时，歌单里留的是 canonical 的那条。
            const allInFavorites = targetSongs.length > 0 && targetSongs.every(isFoliaSongLiked);
            const favorites = foliaPlaylists.filter(playlist => playlist.isFavorite);
            const others = foliaPlaylists.filter(playlist => !playlist.isFavorite);
            return [...favorites, ...others].map((playlist: FoliaPlaylistSummary): PlaylistEntry => {
                return {
                    id: playlist.id,
                    name: playlist.isFavorite ? t('localMusic.favoritePlaylist') : playlist.name,
                    description: trackCount(playlist.entryCount),
                    coverUrl: playlist.coverUrl,
                    kind: playlist.isFavorite ? 'liked' : undefined,
                    note: playlist.isFavorite && allInFavorites ? t('playlist.alreadyLiked') : undefined,
                    recent: !playlist.isFavorite && playlist.id === lastFoliaPlaylistId,
                };
            });
        }

        if (isOnline) {
            const playlists = songPlaylists.map((playlist: ProviderCollection): PlaylistEntry => ({
                id: String(playlist.id),
                name: playlist.name,
                description: typeof playlist.trackCount === 'number' && Number.isFinite(playlist.trackCount) && playlist.trackCount >= 0
                    ? `${playlist.trackCount} ${t('playlist.tracks')}` : undefined,
                coverUrl: playlist.coverUrl,
            }));
            if (!canLike) return playlists;
            return [likedRow(targetSongs.length > 0 && targetSongs.every(song => omni.isSongLiked(song))), ...playlists];
        }

        if (isNavidrome) {
            // Navidrome 的「我喜欢」是星标（与播放页的红心同一个星标集合）。
            const ids = targetSongs.map(navidromeIdOf);
            const allStarred = ids.length > 0 && ids.every(id => Boolean(id) && starredNavidromeSongIds.has(id!));
            return [likedRow(allStarred), ...navidromePlaylists];
        }

        return [];
    }, [canLike, foliaPlaylists, inFolia, isFoliaSongLiked, isOnline, isNavidrome, lastFoliaPlaylistId, navidromePlaylists, songPlaylists, starredNavidromeSongIds, t, targetSongs]);

    // 对话框顶上的「要放进去的歌」：一首写歌名与歌手 · 来源，一组写首数、前几首的名字与来源，封面最多叠三张。
    const subject = useMemo<PlaylistSelectionSubject | undefined>(() => {
        if (!currentSong) return undefined;
        const source = isMultiSource ? '' : isLocal ? t('scratchpad.sourceLocal') : isNavidrome ? t('navidrome.title') : onlineProviderLabel;
        const coverUrls = targetSongs.slice(0, 3).map(song => getSongCoverUrl(song) ?? '').filter(Boolean);
        if (targetSongs.length === 1) {
            return {
                title: currentSong.name,
                subtitle: [getSongArtistLabel(currentSong), source].filter(Boolean).join(' · '),
                coverUrls,
            };
        }
        return {
            title: t('playlist.songsToSave', { count: targetSongs.length }),
            subtitle: [targetSongs.slice(0, 3).map(song => song.name).join(' / '), source].filter(Boolean).join(' · '),
            coverUrls,
        };
    }, [currentSong, isLocal, isMultiSource, isNavidrome, onlineProviderLabel, t, targetSongs]);

    // A picker asked for a song that cannot go anywhere (a stage song): closing beats leaving a picker
    // up that cannot pick. Everything else has the Folia pane.
    useEffect(() => {
        if (isOpen && !isApplicable) {
            close();
        }
    }, [close, isApplicable, isOpen]);

    // Published rather than recomputed by each consumer: the star button and the command both need
    // this answer. Since the Folia pane takes any song, a song that is applicable can always be added.
    useEffect(() => {
        setAvailability({ isApplicable: shown.isApplicable, canAdd: shown.isApplicable });
    }, [setAvailability, shown.isApplicable]);

    const panes = useMemo(() => (showSourcePane ? [
        { id: 'folia', label: t('home.foliaTab') },
        { id: 'source', label: isNavidrome ? t('navidrome.title') : onlineProviderLabel },
    ] : undefined), [isNavidrome, onlineProviderLabel, showSourcePane, t]);

    // 放进 Folia 歌单之后的提示：加了几首、几首已在里面；速记簿交来的那一批带一个「清空速记簿」按钮
    // （保存是复制，速记簿不动；规格 §10）。
    const reportFoliaResult = (playlist: FoliaPlaylistSummary, result: Parameters<typeof describeFoliaAddResult>[0]) => {
        rememberLastFoliaPlaylistId(playlist.id);
        const message = describeFoliaAddResult(result, playlist.isFavorite ? t('localMusic.favoritePlaylist') : playlist.name, t);
        // 按下去清的是整本：只在交来的这一批就是整本、而且没有一首没收进去时才给（存一行、一组、选中的几首不给）。
        const batchKeys = new Set(targetSongs.map(foliaPlaylistEntryKeyOf));
        const notebook = useScratchpadStore.getState().entries;
        const offerClear = origin === 'scratchpad' && message.type !== 'error' && result.rejected === 0
            && notebook.length > 0 && notebook.every(entry => batchKeys.has(foliaPlaylistEntryKeyOf(entry.song)));
        setStatusMessage({
            ...message,
            ...(offerClear ? {
                actionLabel: t('foliaPlaylist.clearScratchpad'),
                // 按完提示就收起：留着的话按钮还在，像是没清掉。
                onAction: () => {
                    useScratchpadStore.getState().clear();
                    setStatusMessage(null);
                },
                durationMs: 8000,
            } : {}),
        });
    };

    // The dialog only waits on the add; a failure is told here (a group of the scratchpad can be refused
    // by the platform, or lose a song from the library under it), and the dialog closes as on success.
    const reportFailure = (error: unknown, text = t('status.playlistUpdateFailed')) => {
        console.warn('[AddToPlaylist] add failed', { count: targetSongs.length }, error);
        setStatusMessage({ type: 'error', text: onlineMutationFailureText(error, text, t) });
    };

    // 星标这几首 Navidrome 歌，并写进播放页红心读的那个星标集合。
    const starNavidromeSongs = async (songs: SongResult[]) => {
        const { getNavidromeConfig, navidromeApi } = await import('../../services/navidromeService');
        const config = getNavidromeConfig();
        if (!config) throw new Error('Navidrome is not configured');
        for (const song of songs) {
            const id = navidromeIdOf(song);
            if (!id) throw new Error('Picked song is not a Navidrome song');
            if (!await navidromeApi.star(config, id)) throw new Error('Navidrome did not take the star');
            useLibraryStore.getState().setStarredNavidromeSongIds(prev => (prev.has(id) ? prev : new Set(prev).add(id)));
        }
    };

    return (
        <div className="pointer-events-auto">
            <PlaylistSelectionDialog
                isOpen={isOpen}
                onClose={close}
                isDaylight={isDaylight}
                title={t('playlist.saveToPlaylist')}
                subject={subject}
                playlists={availablePlaylists}
                panes={panes}
                activePane={activePane}
                onPaneChange={(next) => {
                    const nextPane: AddToPlaylistPane = next === 'source' ? 'source' : 'folia';
                    setPane(nextPane);
                    rememberAddToPlaylistPane(nextPane);
                }}
                onSelect={async (playlistId) => {
                    const isLikedRow = String(playlistId) === LIKED_ENTRY_ID;
                    try {
                        if (!currentSong) throw new Error('Selected playlist is unavailable');
                        // 用了哪一栏就记哪一栏（只有一栏可选时不改记着的）。
                        if (showSourcePane) rememberAddToPlaylistPane(activePane);
                        if (inFolia) {
                            const { playlist, result } = await addPickedSongsToFoliaPlaylist(String(playlistId), targetSongs);
                            if (!playlist) throw new Error('Selected playlist is unavailable');
                            reportFoliaResult(playlist, result);
                            return;
                        }

                        if (isOnline && isLikedRow) {
                            // 红心：一首一首按平台的喜欢接口来（已经喜欢的再按一次「喜欢」不会取消）。
                            // 不能喜欢的条目（比如视频，方案 §4.4 的 itemTraits）跳过，不让它挡住后面的歌。
                            for (const song of targetSongs) {
                                if (omni.canLikeSong(song)) await omni.likeSong(song, true);
                            }
                            setStatusMessage({ type: 'success', text: t('status.liked') });
                            return;
                        }

                        if (isOnline) {
                            const playlist = songPlaylists.find(item => String(item.id) === String(playlistId));
                            if (!playlist) throw new Error('Selected playlist is unavailable');
                            await onAddSongsToOnlinePlaylist(playlist, targetSongs);
                            return;
                        }

                        if (isNavidrome && isLikedRow) {
                            await starNavidromeSongs(targetSongs);
                            setStatusMessage({ type: 'success', text: t('status.liked') });
                            return;
                        }

                        if (isNavidrome) {
                            await onAddSongsToNavidromePlaylist(String(playlistId), targetSongs);
                            await refreshNavidromePlaylists();
                        }
                    } catch (error) {
                        reportFailure(error, isLikedRow ? t('status.likeFailed') : undefined);
                    }
                }}
                onCreateNamed={(inFolia || isNavidrome || canCreateOnline) ? async (name) => {
                    if (!currentSong) return;
                    try {
                        if (showSourcePane) rememberAddToPlaylistPane(activePane);
                        if (inFolia) {
                            const { playlist, result } = await createFoliaPlaylistFromPickedSongs(name, targetSongs);
                            reportFoliaResult(playlist, result);
                            return;
                        }

                        if (isOnline) {
                            await onCreateOnlinePlaylistWithSongs(name, targetSongs);
                            return;
                        }

                        if (isNavidrome) {
                            await onCreateNavidromePlaylistWithSongs(name, targetSongs);
                            await refreshNavidromePlaylists();
                        }
                    } catch (error) {
                        reportFailure(error);
                    }
                } : undefined}
                createLabel={t(!inFolia && isNavidrome ? 'navidrome.createPlaylist' : 'localMusic.createPlaylist')}
            />
        </div>
    );
};

export default AddToPlaylistHost;
