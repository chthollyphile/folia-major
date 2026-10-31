import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { LocalPlaylist, SongResult } from '../../types';
import type { ProviderCollection } from '../../types/onlineMusic';
import PlaylistSelectionDialog from '../shared/PlaylistSelectionDialog';
import TextInputDialog from '../shared/TextInputDialog';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { omni } from '../../services/onlineMusic/omni';
import { selectDisplaySong, usePlaybackStore } from '../../stores/usePlaybackStore';
import { useAddToPlaylistStore } from '../../stores/useAddToPlaylistStore';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { setStatusMessage } from '../../stores/useStatusMessageStore';

// src/components/app/AddToPlaylistHost.tsx
// The playlist picker for the current song, and the "new playlist" prompt behind it.
//
// Lifted out of UnifiedPanel so it is not tied to the player panel being on screen: it answers a
// question about the song, not about the panel, and a command bound to a global shortcut has to be
// able to ask it from anywhere. The star button in the panel now only requests it.
//
// Everything the three sources need to be told apart stays here, in one place, because the answer
// depends on a Navidrome fetch — see the note in useAddToPlaylistStore.

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

type PlaylistEntry = { id: string; name: string; description?: string };

// What kind of song this is to the picker, and whether its source takes it into a playlist.
const describeSong = (song: SongResult | null, hasOnlinePlaylists: boolean) => {
    const isStage = Boolean(song && (song as any).isStage === true);
    const isNavidrome = Boolean(song && (song as any).isNavidrome === true);
    const isLocal = Boolean(song && !isNavidrome && (((song as any).isLocal === true) || Boolean((song as any).localRef?.songId)));
    const playbackSourceRef = song ? getPlaybackSourceRef(song) : null;
    const isOnline = playbackSourceRef?.kind === 'online';
    const canAddOnlineSong = Boolean(song && isOnline && omni.canAddSongToPlaylist(song));
    const canCreateOnline = Boolean(song && isOnline && omni.canCreatePlaylistForSong(song));
    return {
        isNavidrome, isLocal, isOnline, canAddOnlineSong, canCreateOnline,
        onlineProviderLabel: playbackSourceRef?.kind === 'online' ? omni.getProviderLabel(playbackSourceRef.providerId) : '',
        isApplicable: Boolean(song && !isStage && (isLocal || isOnline || isNavidrome)),
        // Local, Navidrome and some online providers can make a playlist on the spot, so having
        // none is not a refusal there.
        canAdd: isLocal || (isOnline && canAddOnlineSong && (hasOnlinePlaylists || canCreateOnline)) || isNavidrome,
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
    // The songs the picker is about: the ones it was asked for (a scratchpad row or group), else the
    // one that was shown when it came up. The track can change under an open picker (a blend lands,
    // the queue advances), and the picker does not say which song it is for; what it adds is the song
    // the listener asked about.
    const [askedSongs, setAskedSongs] = useState<SongResult[] | null>(null);
    const pickerSongs = requestedSongs ?? (shownSong ? [shownSong] : null);
    if (isOpen && !askedSongs && pickerSongs) {
        setAskedSongs(pickerSongs);
    } else if (!isOpen && askedSongs) {
        setAskedSongs(null);
    }
    // The songs the "new playlist" prompt is for: the ones the picker it came from was about.
    const [createFor, setCreateFor] = useState<SongResult[] | null>(null);
    const [navidromePlaylists, setNavidromePlaylists] = useState<PlaylistEntry[]>([]);

    // The dialogs are about the songs they were asked for, whatever is playing by now. They are all
    // of one source, so the first one speaks for them.
    const targetSongs = createFor ?? (isOpen ? askedSongs : null) ?? (shownSong ? [shownSong] : []);
    const currentSong = targetSongs[0] ?? null;
    // Only the song's own platform's playlists take it (omni refuses the others): read for the song
    // the picker is about, not for the one playing — a scratchpad group is often of another platform.
    // The accounts are read so that a refreshed or signed-out account's list shows here.
    const accounts = useOnlineProviderAccountStore(state => state.accounts);
    const songPlaylists = useMemo(
        () => (currentSong ? omni.getPlaylistsForSong(currentSong) : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- accounts is what getPlaylistsForSong reads
        [accounts, currentSong],
    );
    const shownPlaylistCount = useMemo(
        () => (shownSong ? omni.getPlaylistsForSong(shownSong).length : 0),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- accounts is what getPlaylistsForSong reads
        [accounts, shownSong],
    );
    const shown = describeSong(shownSong, shownPlaylistCount > 0);
    const { isNavidrome, isLocal, isOnline, canCreateOnline, isApplicable, canAdd } = describeSong(currentSong, songPlaylists.length > 0);
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
        if (isLocal) {
            return localPlaylists.map((playlist) => ({
                id: playlist.id,
                name: playlist.name,
                description: `${playlist.songIds.length} ${t('playlist.tracks')}`,
            }));
        }

        if (isOnline) {
            return songPlaylists.map((playlist) => ({
                id: String(playlist.id),
                name: playlist.name,
                description: `${playlist.trackCount || 0} ${t('playlist.tracks')}`,
            }));
        }

        if (isNavidrome) {
            return navidromePlaylists;
        }

        return [];
    }, [isLocal, isOnline, isNavidrome, localPlaylists, navidromePlaylists, songPlaylists, t]);

    const disabledReason = shown.isOnline && !shown.canAddOnlineSong
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

    // The dialogs only wait on the add; a failure is told here (a group of the scratchpad can be refused
    // by the platform, or lose a song from the library under it), and the dialog closes as on success.
    const reportFailure = (error: unknown) => {
        console.warn('[AddToPlaylist] add failed', { count: targetSongs.length }, error);
        setStatusMessage({ type: 'error', text: t('status.playlistUpdateFailed') });
    };

    return (
        <div className="pointer-events-auto">
            <PlaylistSelectionDialog
                isOpen={isOpen}
                onClose={close}
                isDaylight={isDaylight}
                title={t('localMusic.addToPlaylist')}
                // A group of the scratchpad says how many songs go in; one song says nothing more.
                description={targetSongs.length > 1
                    ? t('libraryBravais.trackCount', { count: targetSongs.length })
                    : (t('home.playlists') || 'Playlists')}
                playlists={availablePlaylists}
                onSelect={async (playlistId) => {
                    try {
                        if (!currentSong) throw new Error('Selected playlist is unavailable');
                        if (isLocal) {
                            await onAddSongsToLocalPlaylist(String(playlistId), targetSongs);
                            return;
                        }

                        if (isOnline) {
                            const playlist = songPlaylists.find(item => String(item.id) === String(playlistId));
                            if (!playlist) throw new Error('Selected playlist is unavailable');
                            await onAddSongsToOnlinePlaylist(playlist, targetSongs);
                            return;
                        }

                        if (isNavidrome) {
                            await onAddSongsToNavidromePlaylist(String(playlistId), targetSongs);
                            await refreshNavidromePlaylists();
                        }
                    } catch (error) {
                        reportFailure(error);
                    }
                }}
                onCreate={(isLocal || isNavidrome || canCreateOnline) ? () => {
                    setCreateFor(targetSongs);
                    close();
                } : undefined}
                createLabel={t(isNavidrome ? 'navidrome.createPlaylist' : 'localMusic.createPlaylist')}
            />

            <TextInputDialog
                isOpen={createFor !== null}
                onClose={() => setCreateFor(null)}
                isDaylight={isDaylight}
                title={t(isNavidrome ? 'navidrome.createPlaylist' : 'localMusic.createPlaylist')}
                description={t('localMusic.enterPlaylistName')}
                placeholder={t('localMusic.enterPlaylistName')}
                confirmLabel={t('options.save')}
                onConfirm={async (name) => {
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
                }}
            />
        </div>
    );
};

export default AddToPlaylistHost;
