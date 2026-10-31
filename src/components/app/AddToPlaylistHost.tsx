import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { LocalPlaylist, SongResult, UnifiedSong } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';
import PlaylistSelectionDialog, { type PlaylistSelectionDialogItem, type PlaylistSelectionSubject } from '../shared/PlaylistSelectionDialog';
import { getPlaybackSourceRef, resolveNavidromePlaybackCarrier } from '../../utils/appPlaybackGuards';
import { omni } from '../../services/onlineMusic/omni';
import { getSongArtistLabel, getSongCoverUrl } from '../../services/onlineMusic/songMetadata';
import { selectDisplaySong, usePlaybackStore } from '../../stores/usePlaybackStore';
import { useAddToPlaylistStore } from '../../stores/useAddToPlaylistStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { setStatusMessage } from '../../stores/useStatusMessageStore';

// src/components/app/AddToPlaylistHost.tsx
// The playlist picker for the current song (and for the songs a scratchpad row or group, or a library
// card, asks it for); "new playlist" is made right in it.
//
// Lifted out of UnifiedPanel so it is not tied to the player panel being on screen: it answers a
// question about the song, not about the panel, and a command bound to a global shortcut has to be
// able to ask it from anywhere. The star button in the panel now only requests it.
//
// Everything the three sources need to be told apart stays here, in one place, because the answer
// depends on a Navidrome fetch — see the note in useAddToPlaylistStore. Each source has a "Liked
// songs" row first: the local favorites playlist, the platform's heart for an online song (some
// platforms' liked list is no playlist at all), Navidrome's star.

type AddToPlaylistHostProps = {
    isDaylight: boolean;
    localPlaylists: LocalPlaylist[];
    // All six are handed the songs the picker is about: the shown song (the playback store's
    // current song is another one during a blend, and after any change of track under the open
    // dialog), or the scratchpad's row or group it was asked for — all of one source.
    onAddSongsToLocalPlaylist: (playlistId: string, songs: SongResult[]) => Promise<void>;
    onCreateLocalPlaylistWithSongs: (name: string, songs: SongResult[]) => Promise<void>;
    onAddSongsToOnlinePlaylist: (playlist: ProviderCollection, songs: SongResult[]) => Promise<void>;
    onCreateOnlinePlaylistWithSongs: (name: string, songs: SongResult[]) => Promise<void>;
    onAddSongsToNavidromePlaylist: (playlistId: string, songs: SongResult[]) => Promise<void>;
    onCreateNavidromePlaylistWithSongs: (name: string, songs: SongResult[]) => Promise<void>;
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
        // Local, Navidrome and some online providers can make a playlist on the spot, so having
        // none is not a refusal there.
        canAdd: isLocal || (isOnline && ((canAddOnlineSong && (hasOnlinePlaylists || canCreateOnline)) || canLike)) || isNavidrome,
    };
};

export const AddToPlaylistHost: React.FC<AddToPlaylistHostProps> = ({
    isDaylight,
    localPlaylists,
    onAddSongsToLocalPlaylist,
    onCreateLocalPlaylistWithSongs,
    onAddSongsToOnlinePlaylist,
    onCreateOnlinePlaylistWithSongs,
    onAddSongsToNavidromePlaylist,
    onCreateNavidromePlaylistWithSongs,
}) => {
    const { t } = useTranslation();
    // The song as the listener sees it, so a blend shows the track that is on screen. It is what
    // the star button answers for.
    const shownSong = usePlaybackStore(selectDisplaySong);
    const { isOpen, requestedSongs, close, setAvailability } = useAddToPlaylistStore(useShallow(state => ({
        isOpen: state.isOpen,
        requestedSongs: state.songs,
        close: state.close,
        setAvailability: state.setAvailability,
    })));
    // The songs the picker is about: the ones it was asked for (a scratchpad row or group, a library
    // card), else the one that was shown when it came up. The track can change under an open picker
    // (a blend lands, the queue advances), and the picker does not say which song it is for; what it
    // adds is the song the listener asked about.
    const [askedSongs, setAskedSongs] = useState<SongResult[] | null>(null);
    const pickerSongs = requestedSongs ?? (shownSong ? [shownSong] : null);
    if (isOpen && !askedSongs && pickerSongs) {
        setAskedSongs(pickerSongs);
    } else if (!isOpen && askedSongs) {
        setAskedSongs(null);
    }
    const [navidromePlaylists, setNavidromePlaylists] = useState<PlaylistEntry[]>([]);
    const starredNavidromeSongIds = useLibraryStore(state => state.starredNavidromeSongIds);

    // The dialog is about the songs it was asked for, whatever is playing by now. They are all of one
    // source, so the first one speaks for them.
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
    const { isNavidrome, isLocal, isOnline, canCreateOnline, canLike, onlineProviderLabel, isApplicable, canAdd } = describeSong(currentSong, songPlaylists.length > 0);
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

        if (isLocal) {
            // 本地的「我喜欢」就是收藏歌单本身（isFavorite）：画成红心那一行，排在最前。
            const localIds = targetSongs.map(song => (song as UnifiedSong).localRef?.songId).filter((id): id is string => Boolean(id));
            return localPlaylists.map((playlist): PlaylistEntry => ({
                id: playlist.id,
                name: playlist.isFavorite ? t('localMusic.favoritePlaylist') : playlist.name,
                description: trackCount(playlist.songIds.length),
                kind: playlist.isFavorite ? 'liked' : undefined,
                note: playlist.isFavorite && localIds.length > 0 && localIds.every(id => playlist.songIds.includes(id))
                    ? t('playlist.alreadyLiked')
                    : undefined,
            }));
        }

        if (isOnline) {
            const playlists = songPlaylists.map((playlist: ProviderCollection): PlaylistEntry => ({
                id: String(playlist.id),
                name: playlist.name,
                description: trackCount(playlist.trackCount || 0),
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
    }, [canLike, isLocal, isOnline, isNavidrome, localPlaylists, navidromePlaylists, songPlaylists, starredNavidromeSongIds, t, targetSongs]);

    // 对话框顶上的「要放进去的歌」：一首写歌名与歌手 · 来源，一组写首数、前几首的名字与来源，封面最多叠三张。
    const subject = useMemo<PlaylistSelectionSubject | undefined>(() => {
        if (!currentSong) return undefined;
        const source = isLocal ? t('scratchpad.sourceLocal') : isNavidrome ? t('navidrome.title') : onlineProviderLabel;
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
    }, [currentSong, isLocal, isNavidrome, onlineProviderLabel, t, targetSongs]);

    const disabledReason = shown.isOnline && !shown.canAddOnlineSong && !shown.canLike
        ? t('status.providerPlaylistMutationUnavailable', { provider: shown.onlineProviderLabel })
        : (!shown.canAdd ? t('localMusic.noPlaylistsFound') : undefined);

    // A picker asked for a song that has nowhere to go, or whose playlists went under it (the
    // account signed out): closing beats leaving a picker up that cannot pick.
    useEffect(() => {
        if (isOpen && !(isApplicable && canAdd)) {
            close();
        }
    }, [canAdd, close, isApplicable, isOpen]);

    // Published rather than recomputed by each consumer: the star button and the command both need
    // this answer, and only one of them can afford to be the thing that fetches it.
    useEffect(() => {
        setAvailability({ isApplicable: shown.isApplicable, canAdd: shown.isApplicable && shown.canAdd, disabledReason });
    }, [disabledReason, setAvailability, shown.canAdd, shown.isApplicable]);

    // The dialog only waits on the add; a failure is told here (a group of the scratchpad can be refused
    // by the platform, or lose a song from the library under it), and the dialog closes as on success.
    const reportFailure = (error: unknown, text = t('status.playlistUpdateFailed')) => {
        console.warn('[AddToPlaylist] add failed', { count: targetSongs.length }, error);
        setStatusMessage({ type: 'error', text });
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
                onSelect={async (playlistId) => {
                    const isLikedRow = String(playlistId) === LIKED_ENTRY_ID;
                    try {
                        if (!currentSong) throw new Error('Selected playlist is unavailable');
                        if (isLocal) {
                            await onAddSongsToLocalPlaylist(String(playlistId), targetSongs);
                            return;
                        }

                        if (isOnline && isLikedRow) {
                            // 红心：一首一首按平台的喜欢接口来（已经喜欢的再按一次「喜欢」不会取消）。
                            for (const song of targetSongs) await omni.likeSong(song, true);
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
                onCreateNamed={(isLocal || isNavidrome || canCreateOnline) ? async (name) => {
                    if (!currentSong) return;
                    try {
                        if (isLocal) {
                            await onCreateLocalPlaylistWithSongs(name, targetSongs);
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
                createLabel={t(isNavidrome ? 'navidrome.createPlaylist' : 'localMusic.createPlaylist')}
            />
        </div>
    );
};

export default AddToPlaylistHost;
