import i18n from '../../i18n/config';
import type { LibraryHomePort, LibraryHomeScanProgress } from '../core/home/homeModel.contract';
import type { HomeSurfaceProps } from '../../components/app/home/homeSurfaceTypes';
import { PlayerState, type SongResult } from '../../types';
import type { PersonalFmLaunch, PersonalFmSelection } from '../../types/personalFm';
import { translateHomeMessage } from '../core/home/homeSources';
import { importFolder, resyncAllFolders, LOCAL_MUSIC_SCAN_PROGRESS_EVENT } from '../../services/localMusicService';
import { getLocalLibraryAvailability } from '../../services/localLibraryAvailability';
import { importLocalPlaylistFile } from '../../services/localPlaylistFileService';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { selectProviderPersonalFm, usePersonalFmModeStore } from '../../stores/usePersonalFmModeStore';
import { isSamePersonalFmSelection, normalizePersonalFmSelection, toPersonalFmRequestOptions } from '../../services/onlineMusic/fmModes';
import { omni } from '../../services/onlineMusic/omni';
import { wholeQueueWritesSoFar } from '../../services/wholeQueueWrites';
import { noteQueueStart, queueStartsSoFar } from '../../components/app/playback/start/queueStarts';
import { selectDisplaySong, usePlaybackStore } from '../../stores/usePlaybackStore';
import { getPlaybackSongKey, isSamePlaybackSong } from '../../utils/appPlaybackGuards';
import { registerPersonalFmLanding } from '../../components/app/playback/start/personalFmLanding';
import { dropPlaysInFlight } from '../../components/app/playback/currentSong';
import {
    createLocalGridViewCollection,
    createNavidromeGridViewCollection,
    createOnlineGridViewCollection,
} from '../../components/app/home/gridViewCollectionAdapters';

// src/library/app/createLibraryHomePort.ts
// 把首页 surface 的回调与本地曲库服务、omni、集合描述工厂装配成首页动作的端口（照 createLibraryDirectoryBatchPort
// 的做法）。core 的 libraryHomeActions 只说「导入文件夹、刷新曲库、播放私人 FM、打开这张卡」；调哪个服务、
// 提示怎么翻译与显示（alert 仍是 window.alert，状态消息走 onStatusMessage），都在这里。surface 按调用现读。

type HomePortSurface = Pick<HomeSurfaceProps, 'localSongs' | 'onRefreshLocalSongs' | 'onStatusMessage' | 'onPlaySong' | 'onResumePlayback' | 'onEnterPlaybackView'>;

export const createLibraryHomePort = (getSurface: () => HomePortSurface): LibraryHomePort => {
    // A later card click supersedes both catalogue loading and songs from the earlier click.
    let personalFmRequest = 0;
    // The selection stored before the cards still on their way: a card that brings nothing puts it back.
    let selectionBeforePending: { providerId: string; selection: PersonalFmSelection; applied: PersonalFmSelection } | null = null;
    // The radio the last card brought songs for (null: the Personal FM itself), until those songs are played.
    let launched: { songs: SongResult[]; providerId: string; station: string | null; selection: PersonalFmSelection | null } | null = null;
    return {
        localAvailability: () => getLocalLibraryAvailability(),
        importFolder: async () => (await importFolder()).length,
        resyncAllFolders: async () => (await resyncAllFolders())?.length ?? 0,
        importPlaylistFile: async (file) => {
            const result = await importLocalPlaylistFile(file, getSurface().localSongs);
            return {
                playlistName: result.playlist?.name ?? null,
                matchedCount: result.matchedSongIds.length,
                skippedCount: result.unmatchedPaths.length + result.ambiguousPaths.length,
            };
        },
        refreshLocalSongs: () => getSurface().onRefreshLocalSongs(),
        subscribeScanProgress: (listener) => {
            const handleScanProgress = (event: Event) => {
                listener((event as CustomEvent<LibraryHomeScanProgress>).detail ?? null);
            };
            window.addEventListener(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, handleScanProgress);
            return () => window.removeEventListener(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, handleScanProgress);
        },
        getPersonalFm: async (selection, cardProviderId, previewToken) => {
            const request = ++personalFmRequest;
            const activeProvider = () => useOnlineProviderAccountStore.getState().activeProviderId;
            const providerId = cardProviderId ?? activeProvider();
            // Nor do its songs cut off what the listener started after the click: another queue (a mode switch
            // in the command palette that played first, a playlist), or one replaced whole.
            const starts = queueStartsSoFar();
            const writes = wholeQueueWritesSoFar();
            const stillCurrent = () => request === personalFmRequest && activeProvider() === providerId
                && queueStartsSoFar() === starts && wholeQueueWritesSoFar() === writes;
            if (!stillCurrent()) return [];
            // The extra radio this card starts, if it is one: its mode choice stays in memory and the stored
            // Personal FM settings are not touched. It takes effect once its songs are in (below).
            const station = selection?.station || null;
            let stationSelection: PersonalFmSelection | null = null;
            // Put back when the card brings nothing to play, as the mode switch in the command palette does.
            // Only this click's own choice is taken back: a newer card, or a mode picked meanwhile in the
            // command palette, has stored its own, which stands.
            const putBack = () => {
                const pending = selectionBeforePending;
                if (!stillCurrent() || pending?.providerId !== providerId) return;
                if (!isSamePersonalFmSelection(selectProviderPersonalFm(usePersonalFmModeStore.getState(), providerId), pending.applied)) return;
                usePersonalFmModeStore.getState().setProviderSelection(providerId, pending.selection);
            };
            try {
                let options;
                if (station && selection) {
                    const catalog = await omni.getPersonalFmStationCatalog(providerId, station);
                    if (!catalog || !stillCurrent()) return [];
                    usePersonalFmModeStore.getState().setStationCatalog(providerId, station, catalog);
                    stationSelection = normalizePersonalFmSelection(selection, catalog);
                    options = toPersonalFmRequestOptions(stationSelection, station);
                } else if (selection) {
                    const catalog = await omni.getPersonalFmCatalog(providerId);
                    // A card belongs to the provider that displayed it, even if the listener switches meanwhile.
                    if (!stillCurrent()) return [];
                    const modes = usePersonalFmModeStore.getState();
                    modes.setCatalog(providerId, catalog);
                    // From before the oldest card still on its way: one it overtook never played its scene either.
                    const previous = selectionBeforePending?.providerId === providerId
                        ? selectionBeforePending.selection
                        : selectProviderPersonalFm(usePersonalFmModeStore.getState(), providerId);
                    // Stored before the songs come: the radio's later batches are asked for in the mode stored.
                    const applied = modes.setProviderSelection(providerId, selection);
                    selectionBeforePending = { providerId, selection: previous, applied };
                    options = toPersonalFmRequestOptions(applied);
                }
                const songs = await omni.getPersonalFm(previewToken !== undefined ? { ...options, previewToken } : options);
                if (!stillCurrent()) return [];
                if (!songs.length) {
                    putBack();
                    getSurface().onStatusMessage?.({ type: 'info', text: i18n.t('home.personalFmEmpty') });
                } else {
                    // Which radio these songs are from: it goes on air with them once they play (playPersonalFm). The
                    // Personal FM card (or a scene of it) puts an extra radio off, the card of a radio puts it on.
                    // The station goes on air only with this exact accepted queue, through the upstream landing hook.
                    launched = { songs, providerId, station: stationSelection ? station : null, selection: stationSelection };
                }
                return songs;
            } catch (error) {
                if (!stillCurrent()) return [];
                putBack();
                throw error;
            } finally {
                // The newest click has its answer, whatever it is: nothing is on its way any more.
                if (request === personalFmRequest) selectionBeforePending = null;
            }
        },
        continuePersonalFm: (song, selection, providerId) => {
            const state = usePlaybackStore.getState();
            const accepted = state.acceptedFmPlayback;
            if (useOnlineProviderAccountStore.getState().activeProviderId !== providerId
                || !accepted || accepted.providerId !== providerId
                || (accepted.selection.station || null) !== (selection.station || null)
                || !isSamePersonalFmSelection(accepted.selection, selection)
                || !isSamePlaybackSong(selectDisplaySong(state), song)
                || !isSamePlaybackSong(state.currentSong, song)
                || !accepted.songKeys.has(getPlaybackSongKey(song))
                || !state.playQueue.some(entry => isSamePlaybackSong(entry, song))) return false;
            const surface = getSurface();
            if (state.playerState === PlayerState.PAUSED && !surface.onResumePlayback) return false;
            const restoreSelection = () => {
                const modes = usePersonalFmModeStore.getState();
                if (selection.station) modes.startStation(providerId, selection.station, selection);
                else { modes.endStation(providerId); modes.setProviderSelection(providerId, selection); }
            };
            noteQueueStart();
            selectionBeforePending = null;
            launched = null;
            // An ended source has nothing to resume: replay the displayed song through the ordinary play route.
            if (state.playerState === PlayerState.IDLE) {
                registerPersonalFmLanding(state.playQueue, restoreSelection);
                surface.onPlaySong(song, state.playQueue, true);
                return true;
            }
            // Keep the sounding source and its watcher, while making every unfinished play give way to it.
            dropPlaysInFlight({ keepShownPlayback: true });
            restoreSelection();
            usePlaybackStore.getState().setIsFmMode(true);
            if (state.playerState !== PlayerState.PLAYING) {
                void surface.onResumePlayback!().catch(error => console.warn('[LibraryHome] Failed to resume Personal FM:', error));
            }
            surface.onEnterPlaybackView?.();
            return true;
        },
        playPersonalFm: (song, queue) => {
            const launch = launched?.songs === queue ? launched : null;
            launched = null;
            if (launch) registerPersonalFmLanding(queue, () => {
                const modes = usePersonalFmModeStore.getState();
                if (launch.station && launch.selection) modes.startStation(launch.providerId, launch.station, launch.selection);
                else modes.endStation(launch.providerId);
            });
            getSurface().onPlaySong(song, queue, true);
        },
        describeOnlineCollection: (collection, providerId) => createOnlineGridViewCollection(collection, providerId),
        describeLocalGroup: group => createLocalGridViewCollection(group),
        describeNavidromeCard: (card, type) => createNavidromeGridViewCollection(card, type),
        notify: (notice) => {
            const text = translateHomeMessage(i18n.t, notice.message);
            if (notice.kind === 'alert') {
                alert(text);
                return;
            }
            getSurface().onStatusMessage?.({ type: notice.type, text });
        },
    };
};
