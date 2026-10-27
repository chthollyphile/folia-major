import { PlayerState } from '../../types';
import type { ReplayGainMode, SongResult } from '../../types';
import type { OmniProviderId } from '../../types/onlineMusic';
import { omni } from '../../services/onlineMusic/omni';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { selectDisplayPlayerState, usePlaybackStore } from '../../stores/usePlaybackStore';
import { useSleepTimerStore } from '../../stores/useSleepTimerStore';
import { isOnlinePlaybackSong } from '../../utils/appPlaybackGuards';
import { canShuffleQueue } from '../../utils/playbackNeighbors';
import {
    ControlError,
    optionalBoolean,
    optionalInteger,
    optionalNumber,
    requireString,
} from '../errors';
import {
    clamp,
    currentPlaybackStateName,
    findLocalSong,
    mapOnlineError,
    playResolvedSong,
    resolvePlayView,
    withControlPlayView,
    readVolume,
    resolveSongArgument,
    searchItemToSong,
    searchSongs,
    seekPlaybackTo,
    summarizeLocalSong,
    summarizeSong,
} from '../helpers';
import type { ControlHandler } from '../types';

// src/control/handlers/playback.ts
// Search-and-play, transport, seek, volume, repeat, shuffle, like, the sleep timer and ReplayGain.
// Playback always goes through the App's own `context.playback`; settings go through store actions.

const currentSongOrFail = () => {
    const song = usePlaybackStore.getState().currentSong;
    if (!song) {
        throw new ControlError('no_song', 'No song is current');
    }
    return song;
};

const readSleepTimer = () => {
    const state = useSleepTimerStore.getState();
    return {
        enabled: state.sleepTimerEnabled,
        hours: state.sleepTimerHours,
        minutes: state.sleepTimerMinutes,
        deadlineMs: state.sleepTimerDeadlineMs,
        remainingMs: state.sleepTimerDeadlineMs === null
            ? null
            : Math.max(0, state.sleepTimerDeadlineMs - Date.now()),
    };
};

export const playbackHandlers: Record<string, ControlHandler> = {
    folia_play_search: async (args, deps) => {
        const query = requireString(args.query, 'query');
        const index = optionalInteger(args.index, 'index') ?? 0;
        const provider = typeof args.provider === 'string' ? args.provider : undefined;
        const source = typeof args.source === 'string' ? args.source : undefined;
        const outcome = await searchSongs(deps, {
            query,
            ...(source !== undefined ? { source } : {}),
            ...(provider !== undefined ? { provider } : {}),
            limit: Math.min(50, Math.max(1, index + 1)),
            offset: 0,
        });
        const item = outcome.items[index];
        if (!item) {
            throw new ControlError('no_results', `No result at index ${index} for "${query}"`, {
                query,
                index,
                returned: outcome.items.length,
            });
        }
        const song = await searchItemToSong(deps, item);
        const view = resolvePlayView(args.view) ?? 'player';
        await playResolvedSong(deps, song, view);
        return { query, index, view, song: summarizeSong(song) };
    },

    folia_play: async (args, deps) => {
        const localId = typeof args.localId === 'string' ? args.localId : undefined;
        const query = typeof args.query === 'string' ? args.query : undefined;
        const provider = typeof args.provider === 'string' ? args.provider : undefined;
        const providerSongId = typeof args.id === 'string' || typeof args.id === 'number' ? String(args.id) : undefined;
        const index = optionalInteger(args.index, 'index') ?? 0;
        const replaceQueue = args.queue === true;
        // AI/CLI 放歌默认落到播放页：那里才有歌词动画。用户把「按下播放后打开哪个界面」设成
        // 留在原处时，`playSong` 内部不会跳转，从命令行放歌就会看起来「没反应」。
        const view = resolvePlayView(args.view) ?? 'player';

        if (localId !== undefined) {
            const local = findLocalSong(deps, localId);
            if (!local) {
                throw new ControlError('no_song', `Local song "${localId}" is not in the library`);
            }
            await withControlPlayView(view, () => deps.playLocalSong(local));
            return { local: true, queued: false, view, song: summarizeLocalSong(local) };
        }

        if (args.song !== undefined) {
            const song = await resolveSongArgument(deps, args.song);
            await playResolvedSong(deps, song, view);
            return { local: false, queued: false, view, song: summarizeSong(song) };
        }

        if (query !== undefined) {
            const outcome = await searchSongs(deps, {
                query,
                ...(provider !== undefined ? { provider } : {}),
                limit: Math.min(50, Math.max(1, index + 1)),
                offset: 0,
            });
            const item = outcome.items[index];
            if (!item) {
                throw new ControlError('no_results', `No result at index ${index} for "${query}"`, {
                    query,
                    index,
                    returned: outcome.items.length,
                });
            }
            const song = await searchItemToSong(deps, item);
            if (replaceQueue) {
                const queueSongs: SongResult[] = [];
                for (const candidate of outcome.items) {
                    queueSongs.push(await searchItemToSong(deps, candidate));
                }
                await withControlPlayView(view, () => deps.context.playback.playSong(song, queueSongs));
            } else {
                await playResolvedSong(deps, song, view);
            }
            return { local: false, queued: replaceQueue, view, song: summarizeSong(song) };
        }

        if (provider !== undefined && providerSongId !== undefined) {
            const detail = await omni.getSongDetail(provider as OmniProviderId, providerSongId);
            if (!detail) {
                throw new ControlError('no_song', `Provider "${provider}" has no song "${providerSongId}"`, {
                    provider,
                    id: providerSongId,
                });
            }
            await playResolvedSong(deps, detail, view);
            return { local: false, queued: false, view, song: summarizeSong(detail) };
        }

        throw new ControlError(
            'bad_request',
            'folia_play needs one of: song, localId, query, or provider + id',
        );
    },

    folia_transport: (args, deps) => {
        const action = requireString(args.action, 'action');
        const context = deps.context.playback;
        let queueCleared = false;
        switch (action) {
            case 'play':
                if (selectDisplayPlayerState(usePlaybackStore.getState()) !== PlayerState.PLAYING) {
                    context.togglePlay();
                }
                break;
            case 'pause':
                if (selectDisplayPlayerState(usePlaybackStore.getState()) === PlayerState.PLAYING) {
                    context.togglePlay();
                }
                break;
            case 'toggle':
                context.togglePlay();
                break;
            case 'next':
                context.next();
                break;
            case 'prev':
                context.prev();
                break;
            case 'stop':
                if (selectDisplayPlayerState(usePlaybackStore.getState()) === PlayerState.PLAYING) {
                    context.togglePlay();
                }
                if (!usePlaybackStore.getState().isFmMode) {
                    context.clearQueue();
                    queueCleared = true;
                }
                break;
            default:
                throw new ControlError('bad_request', `Unknown transport action "${action}"`);
        }
        return { action, playerState: currentPlaybackStateName(), queueCleared };
    },

    folia_seek: (args) => {
        const seconds = optionalNumber(args.seconds, 'seconds');
        const percent = optionalNumber(args.percent, 'percent');
        if (seconds === undefined && percent === undefined) {
            throw new ControlError('bad_request', 'Provide seconds or percent');
        }
        if (seconds !== undefined && percent !== undefined) {
            throw new ControlError('bad_request', 'Provide only one of seconds or percent');
        }
        currentSongOrFail();
        const duration = usePlaybackStore.getState().duration;
        const target = seconds ?? (duration > 0 ? (duration * percent!) / 100 : 0);
        const positionSeconds = seekPlaybackTo(target);
        return {
            positionSeconds,
            durationSeconds: duration,
            percent: duration > 0 ? clamp((positionSeconds / duration) * 100, 0, 100) : null,
        };
    },

    folia_volume: (args) => {
        const level = optionalNumber(args.level, 'level');
        const delta = optionalNumber(args.delta, 'delta');
        const mute = optionalBoolean(args.mute, 'mute');
        if (level !== undefined) {
            useAudioSettingsStore.getState().handleSetVolume(clamp(level / 100, 0, 1));
        }
        if (delta !== undefined) {
            const current = useAudioSettingsStore.getState().volume;
            useAudioSettingsStore.getState().handleSetVolume(clamp(current + delta / 100, 0, 1));
        }
        if (mute !== undefined) {
            useAudioSettingsStore.getState().handleSetMuted(mute);
        }
        return readVolume();
    },

    folia_loop: (args) => {
        const mode = args.mode === undefined ? undefined : (args.mode as 'off' | 'all' | 'one');
        const cycle = optionalBoolean(args.cycle, 'cycle');
        if (mode !== undefined) {
            useAudioSettingsStore.getState().handleSetLoopMode(mode);
        } else if (cycle === true) {
            useAudioSettingsStore.getState().handleToggleLoopMode();
        }
        return { mode: useAudioSettingsStore.getState().loopMode };
    },

    folia_shuffle: (_args, deps) => {
        const state = usePlaybackStore.getState();
        if (!canShuffleQueue(state.playQueue.length, state.isFmMode, state.activePlaybackContext === 'stage')) {
            throw new ControlError('unavailable', 'The queue cannot be shuffled right now', {
                queueLength: state.playQueue.length,
                isFmMode: state.isFmMode,
            });
        }
        deps.context.playback.shuffleQueue();
        return { shuffled: true, queueLength: usePlaybackStore.getState().playQueue.length };
    },

    folia_like: async (args) => {
        const song = currentSongOrFail();
        if (!isOnlinePlaybackSong(song)) {
            throw new ControlError('unsupported', 'Only online songs can be liked');
        }
        const liked = optionalBoolean(args.liked, 'liked');
        try {
            if (liked === undefined) {
                return { liked: await omni.toggleSongLike(song) };
            }
            await omni.likeSong(song, liked);
            return { liked };
        } catch (error) {
            throw mapOnlineError(error, 'unsupported', 'Could not change the like state');
        }
    },

    folia_sleep_timer: (args) => {
        const minutes = optionalInteger(args.minutes, 'minutes');
        const hours = optionalInteger(args.hours, 'hours');
        const cancel = optionalBoolean(args.cancel, 'cancel');
        const status = optionalBoolean(args.status, 'status');
        if (cancel === true) {
            useSleepTimerStore.getState().handleToggleSleepTimer(false);
            return readSleepTimer();
        }
        if (status === true || (minutes === undefined && hours === undefined)) {
            return readSleepTimer();
        }
        if (hours !== undefined) {
            useSleepTimerStore.getState().handleSetSleepTimerHours(hours);
        }
        if (minutes !== undefined) {
            useSleepTimerStore.getState().handleSetSleepTimerMinutes(minutes);
        }
        const current = useSleepTimerStore.getState();
        if (current.sleepTimerHours === 0 && current.sleepTimerMinutes === 0) {
            throw new ControlError('bad_request', 'The sleep timer needs a duration above zero');
        }
        useSleepTimerStore.getState().handleToggleSleepTimer(true);
        return readSleepTimer();
    },

    folia_replaygain: (args, deps) => {
        const mode = requireString(args.mode, 'mode') as ReplayGainMode;
        deps.context.playback.setReplayGainMode(mode);
        return { mode: usePlaybackStore.getState().replayGainMode };
    },
};
