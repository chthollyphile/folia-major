import { useEffect, useMemo, useRef } from 'react';
import { create } from 'zustand';
import { PlayerState } from '../../types';
import type { SongResult } from '../../types';
import type { HifiMprisArtwork, HifiMprisCommand, HifiMprisState, HifiMprisStatus } from '../../types/hifi';
import type { UseMediaSessionBridgeOptions } from '../../hooks/useMediaSessionBridge';
import { getProviderSongMetadata, getSongAlbumLabel, getSongCoverUrl } from '../../services/onlineMusic/songMetadata';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { hifiMediaShim } from '../../services/hifi/hifiMediaShim';
import { useHifiTrackStore } from '../../services/hifi/hifiTrackStore';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';

// src/components/hifi/useHifiMpris.ts
// Linux：HiFi 在放时系统媒体控制由主进程登记的 MPRIS 提供（electron/hifi/mpris/），不靠页面里的静音保活：保活是
// Chromium 的一路流，挡住 PipeWire 切换设备采样率（#835）。这里把当前曲目、播放状态和位置推过去，收它转来的按键，
// 也收它登记成没成：没成（没有会话总线、名字拿不到）时页面退回静音保活，系统媒体控制总还有一路。

type UseHifiMprisOptions = Pick<UseMediaSessionBridgeOptions,
    | 'currentSong'
    | 'cachedCoverUrl'
    | 'playerState'
    | 'isNowPlayingStageActive'
    | 'unknownArtistLabel'
    | 'mediaSessionPlayRef'
    | 'mediaSessionPauseRef'
    | 'mediaSessionPrevRef'
    | 'mediaSessionNextRef'
    | 'isNowPlayingControlDisabledRef'>;

type HifiMprisApi = {
    setMprisState: (state: HifiMprisState) => Promise<void>;
    setMprisArtwork: (trackKey: string, artwork: HifiMprisArtwork | null) => Promise<void>;
    onMprisCommand: (callback: (command: HifiMprisCommand) => void) => () => void;
    onMprisStatus?: (callback: (status: HifiMprisStatus) => void) => () => void;
};

const ARTWORK_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']);

/** 主进程登记 MPRIS 的接口；不是 Linux 或 preload 没有这几个方法时为 null，那时保活照旧。 */
export const getHifiMprisApi = (): HifiMprisApi | null => {
    if (typeof window === 'undefined' || window.electron?.platform !== 'linux') return null;
    const hifi = window.electron?.hifi;
    if (!hifi?.setMprisState || !hifi.setMprisArtwork || !hifi.onMprisCommand) return null;
    return {
        setMprisState: hifi.setMprisState,
        setMprisArtwork: hifi.setMprisArtwork,
        onMprisCommand: hifi.onMprisCommand,
        onMprisStatus: hifi.onMprisStatus,
    };
};

/** 主进程报来的 MPRIS 登记结果；还没报过时为 null，那时先当作登记得上（不放会挡住 PipeWire 切采样率的保活）。 */
export const useHifiMprisStatusStore = create<{ registered: boolean | null }>(() => ({ registered: null }));

/** 系统媒体控制是不是由主进程的 MPRIS 给：是的话页面不放保活。主进程报了登记不上时为假，保活照旧。 */
export const hasMainProcessMediaControls = (registered = useHifiMprisStatusStore.getState().registered): boolean => (
    getHifiMprisApi() !== null && registered !== false
);

/** hasMainProcessMediaControls 的 hook 版：主进程报来新的登记结果时重新算。 */
export const useMainProcessMediaControls = (): boolean => hasMainProcessMediaControls(useHifiMprisStatusStore(state => state.registered));

export const mprisStatusOf = (playerState: PlayerState, isNowPlayingStageActive: boolean): 'Playing' | 'Paused' | 'Stopped' => {
    if (isNowPlayingStageActive) return 'Stopped';
    return playerState === PlayerState.PLAYING ? 'Playing' : 'Paused';
};

/** 一次推送的状态：位置取 shim 的，配上取它的时刻。 */
export const buildMprisState = ({ song, trackKey, status, unknownArtistLabel, seeked, nowMs }: {
    song: SongResult;
    trackKey: string;
    status: 'Playing' | 'Paused' | 'Stopped';
    unknownArtistLabel: string;
    seeked: boolean;
    nowMs: number;
}): HifiMprisState => {
    const artists = getProviderSongMetadata(song).artists.map(artist => artist.name).filter(Boolean);
    const duration = hifiMediaShim.duration;
    return {
        active: true,
        trackKey,
        title: song.name,
        artists: artists.length > 0 ? artists : [unknownArtistLabel],
        album: getSongAlbumLabel(song),
        durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
        status,
        positionSec: hifiMediaShim.currentTime,
        atMs: nowMs,
        seeked,
    };
};

/**
 * 封面：先在页面里读成字节（blob:、本地封面的自定义协议主进程外面打不开），读不到时 http(s) 的交原址，
 * 由主进程下载成文件（原址可能带凭据，不挂到会话总线上）。
 */
export const readMprisArtwork = async (url: string, fetchImpl: typeof fetch = fetch): Promise<HifiMprisArtwork | null> => {
    try {
        const response = await fetchImpl(url);
        if (!response.ok) throw new Error(`Artwork request failed: ${response.status}`);
        const blob = await response.blob();
        if (blob.size > 0 && ARTWORK_MIME_TYPES.has(blob.type)) {
            return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type };
        }
    } catch (error) {
        // 封面地址可能带着凭据（Navidrome 的 getCoverArt），不写进日志。
        console.info('[MPRIS] could not read the cover in the page', error instanceof Error ? error.name : typeof error);
    }
    return /^https?:\/\//i.test(url) ? { url } : null;
};

// 挂在 App 里一次，挨着 useMediaSessionBridge，选项也和它的一样。
export function useHifiMpris({
    currentSong,
    cachedCoverUrl,
    playerState,
    isNowPlayingStageActive,
    unknownArtistLabel,
    mediaSessionPlayRef,
    mediaSessionPauseRef,
    mediaSessionPrevRef,
    mediaSessionNextRef,
    isNowPlayingControlDisabledRef,
}: UseHifiMprisOptions) {
    const route = usePlaybackStore(state => state.playbackRoute);
    const hifiTrack = useHifiTrackStore(state => state.current);
    const trackKey = hifiTrack?.trackKey ?? null;
    // 无缝换曲时 trackKey 先换、显示的歌后到：那一下用 HiFi 这首自己的歌，曲目 id、曲名和封面总是同一首的。
    const displayIsTrack = currentSong !== null && hifiTrack !== null && getPlaybackSongKey(currentSong) === hifiTrack.songKey;
    const song = displayIsTrack ? currentSong : hifiTrack?.song ?? null;
    const api = useMemo(getHifiMprisApi, []);
    const active = api !== null && route === 'hifi' && song !== null && trackKey !== null;
    const status = mprisStatusOf(playerState, isNowPlayingStageActive);
    const playerStateRef = useRef(playerState);
    playerStateRef.current = playerState;
    // 推过活动状态之后才需要推一次不活动：Web 路线上换歌、播放暂停时不用每次都告诉主进程。
    const sentActiveRef = useRef(false);

    useEffect(() => {
        if (!api) return;
        if (!active || !song || trackKey === null) {
            if (!sentActiveRef.current) return;
            sentActiveRef.current = false;
            api.setMprisState({ active: false }).catch(error => console.warn('[MPRIS] could not clear the HiFi player', error));
            return;
        }
        sentActiveRef.current = true;
        const push = (seeked: boolean) => {
            const state = buildMprisState({ song, trackKey, status, unknownArtistLabel, seeked, nowMs: Date.now() });
            api.setMprisState(state).catch(error => console.warn('[MPRIS] could not update the HiFi player', error));
        };
        const onChange = () => push(false);
        const onSeeked = () => push(true);
        push(false);
        // 位置和时长只在这几个时刻重报：在放时主进程自己往后推。
        hifiMediaShim.addEventListener('durationchange', onChange);
        hifiMediaShim.addEventListener('playing', onChange);
        hifiMediaShim.addEventListener('pause', onChange);
        hifiMediaShim.addEventListener('seeked', onSeeked);
        return () => {
            hifiMediaShim.removeEventListener('durationchange', onChange);
            hifiMediaShim.removeEventListener('playing', onChange);
            hifiMediaShim.removeEventListener('pause', onChange);
            hifiMediaShim.removeEventListener('seeked', onSeeked);
        };
    }, [active, api, song, status, trackKey, unknownArtistLabel]);

    const coverUrl = song ? ((displayIsTrack ? cachedCoverUrl : null) || getSongCoverUrl(song) || '') : '';
    useEffect(() => {
        if (!api || !active || trackKey === null) return;
        let disposed = false;
        if (!coverUrl) {
            api.setMprisArtwork(trackKey, null).catch(() => {});
            return;
        }
        void readMprisArtwork(coverUrl).then(artwork => {
            if (disposed) return;
            api.setMprisArtwork(trackKey, artwork).catch(error => console.warn('[MPRIS] could not send the cover', error));
        });
        return () => {
            disposed = true;
        };
    }, [active, api, coverUrl, trackKey]);

    useEffect(() => {
        if (!api) return;
        // 和页面的 Media Session 处理一样：被禁用（Stage 接管）时不动。
        return api.onMprisCommand(command => {
            if (usePlaybackStore.getState().playbackRoute !== 'hifi' || isNowPlayingControlDisabledRef.current) return;
            console.info('[MPRIS] system media control', { command });
            const play = () => {
                mediaSessionPlayRef.current().catch(error => console.error('[MPRIS] play failed', error));
            };
            switch (command) {
                case 'play': play(); break;
                case 'pause': case 'stop': mediaSessionPauseRef.current(); break;
                case 'playpause':
                    if (playerStateRef.current === PlayerState.PLAYING) mediaSessionPauseRef.current();
                    else play();
                    break;
                case 'next': void mediaSessionNextRef.current(); break;
                case 'previous': mediaSessionPrevRef.current(); break;
                default: break;
            }
        });
    }, [api, isNowPlayingControlDisabledRef, mediaSessionNextRef, mediaSessionPauseRef, mediaSessionPlayRef, mediaSessionPrevRef]);

    useEffect(() => {
        if (!api?.onMprisStatus) return;
        return api.onMprisStatus(status => {
            const registered = status?.registered === true;
            if (useHifiMprisStatusStore.getState().registered === registered) return;
            if (!registered) console.warn('[MPRIS] main could not register MPRIS: falling back to the page keep-alive');
            useHifiMprisStatusStore.setState({ registered });
        });
    }, [api]);

    useEffect(() => () => {
        if (!sentActiveRef.current) return;
        sentActiveRef.current = false;
        getHifiMprisApi()?.setMprisState({ active: false }).catch(() => {});
    }, []);
}
