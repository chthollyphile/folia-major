import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { PlayerState } from '../../types';
import type { StageLoopMode } from '../../types';
import type { NextTrackOptions } from '../../types/appPlayback';
import type { HifiErrorCode, HifiPlaybackStatus } from '../../types/hifi';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { selectHifiEngineConfig, useHifiSettingsStore } from '../../stores/useHifiSettingsStore';
import { setDuration, setPlayerState, usePlaybackStore } from '../../stores/usePlaybackStore';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { hifiEngine, useHifiEngineStore } from '../../services/hifi/hifiEngine';
import {
    hifiPlaybackClock,
    hifiTransport,
    installHifiPlayback,
    isHifiRoute,
    isHifiTrackWaitingForDevice,
    loadDeferredHifiTrack,
    useHifiTrackStore,
    type HifiTrack,
} from '../../services/hifi/hifiPlayback';
import {
    armQueueEndReplay,
    bindHifiPlayIntent,
    clearQueueEndReplay,
    holdHifiTrackForDevice,
    isHifiTrackStarted,
    markHifiTrackStarted,
    moveHifiTrackToWeb,
    spendHifiPlayIntent,
    type HifiPlaySong,
} from './hifiRouteTransport';
import { useHifiGaplessPreload } from './useHifiGaplessPreload';

// src/components/hifi/useHifiPlaybackBridge.ts
// HiFi 路线在 React 这一侧的接线：装上推送驱动、把设置和循环推给主进程、载入就绪后自动播放、引擎状态写回播放 store、
// 放完换下一首（队尾放开设备）、失败或关掉 HiFi 时让这首在 Web 引擎上接着放。
// 传输控制和跳转用的两个函数（resumeHifiPlayback、seekHifiRoute），连同播放意图和队尾重放，在 hifiRouteTransport，调用方直接从那里导入。
// 无缝接播（预载下一首、mpv 接上后换过去）在 useHifiGaplessPreload，由这里挂上。

type UseHifiPlaybackBridgeParams = {
    handleNextTrack: (options?: NextTrackOptions) => Promise<void> | void;
    playSong: HifiPlaySong;
    /** 起播时记下的“载入好就播”；自动播放用掉它，和 Web 引擎的自动播放是同一个 ref。 */
    shouldAutoPlayRef: MutableRefObject<boolean>;
    isLyricsLoading: boolean;
    effectiveLoopMode: StageLoopMode;
    isFmMode: boolean;
};

// 熔断的提示整个会话只弹一次：之后的歌都走 Web 引擎，不会再有 HiFi 的失败。
let circuitToastShown = false;

const showCircuitOpenToast = (t: TFunction) => {
    if (circuitToastShown) return;
    circuitToastShown = true;
    setStatusMessage({ type: 'error', text: t('hifi.errors.CIRCUIT_OPEN') });
};

const isValidDuration = (durationSec: number | null): durationSec is number => (
    typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0
);

/** 设备忙时停住等重试的系统：别的程序在那里能独占设备，Web 引擎在同一台设备上也出不了声。不知道平台时照旧回落。 */
const holdsForBusyDevice = () => {
    const platform = typeof window !== 'undefined' ? window.electron?.platform ?? null : null;
    return platform === 'win32' || platform === 'darwin';
};

// 挂在 App 里一次。每帧的值不经这里：时钟由 hifiPlayback 驱动，可视化桥逐帧读它。
export function useHifiPlaybackBridge({
    handleNextTrack,
    playSong,
    shouldAutoPlayRef,
    isLyricsLoading,
    effectiveLoopMode,
    isFmMode,
}: UseHifiPlaybackBridgeParams) {
    // Read here rather than passed in: store fields or i18n.
    const { t } = useTranslation();
    const playbackRoute = usePlaybackStore(state => state.playbackRoute);
    const trackKey = useHifiTrackStore(state => state.current?.trackKey ?? null);
    const loadState = useHifiTrackStore(state => state.loadState);
    const promotedByGapless = useHifiTrackStore(state => state.current?.promotedByGapless === true);
    const volume = useAudioSettingsStore(state => state.volume);
    const isMuted = useAudioSettingsStore(state => state.isMuted);
    const mpvPath = useHifiSettingsStore(state => state.mpvPath);
    const audioDevice = useHifiSettingsStore(state => state.audioDevice);
    const exclusive = useHifiSettingsStore(state => state.exclusive);
    const dsdMode = useHifiSettingsStore(state => state.dsdMode);
    const softwareVolume = useHifiSettingsStore(state => state.softwareVolume);
    const loopFile = effectiveLoopMode === 'one' && !isFmMode;

    // 推送回调里用的最新版本；渲染期不写 ref，放进 effect。
    const latestRef = useRef({ handleNextTrack, playSong, t, loopFile });
    useEffect(() => {
        latestRef.current = { handleNextTrack, playSong, t, loopFile };
    });

    // 排在自动播放之前：同一次提交里它先拿到意图的 ref。
    useEffect(() => bindHifiPlayIntent(shouldAutoPlayRef), [shouldAutoPlayRef]);

    useEffect(() => {
        installHifiPlayback();
    }, []);

    useHifiGaplessPreload({ handleNextTrack, playSong, loopMode: effectiveLoopMode, isFmMode });

    // 应用音量原样交给选择器（它换成 mpv 的音量曲线），静音单独下发。和上一次一样的配置 hifiEngine.configure 自己会跳过，
    // 音量拖动时不会每一下都走 IPC。
    useEffect(() => {
        const settings = { mpvPath, audioDevice, exclusive, dsdMode, softwareVolume };
        void hifiEngine.configure(selectHifiEngineConfig(settings, volume, isMuted));
    }, [audioDevice, dsdMode, exclusive, isMuted, mpvPath, softwareVolume, volume]);

    // 换到 HiFi 的那一首随载入带上了 loop-file；这里只管在 HiFi 上改了循环（含进出私人 FM），以及接管时对齐一次。
    useEffect(() => {
        if (playbackRoute !== 'hifi') return;
        void hifiEngine.setLoopFile(loopFile);
    }, [loopFile, playbackRoute]);

    // 载入落定时再对一次：mpv 还在拉起时发的 setLoopFile 主进程只记下，随后被载入请求里的 loop-file 盖掉。
    useEffect(() => {
        if (playbackRoute !== 'hifi' || loadState !== 'ready' || !trackKey) return;
        const engine = useHifiEngineStore.getState().engine;
        const wanted = latestRef.current.loopFile;
        if (engine?.trackKey === trackKey && engine.loopFile !== wanted) void hifiEngine.setLoopFile(wanted);
    }, [loadState, playbackRoute, trackKey]);

    // 自动播放：和 usePlaybackAudioBridge 对 <audio> 的规则一样，歌词还在载入时先不用掉意图。没有意图就是恢复成暂停的样子。
    // 恢复时延后载入的那一首：有意图就现在载入（载入好了再走这里开播），没有就摆成停着的样子，等第一次播放或跳转。
    useEffect(() => {
        if (playbackRoute !== 'hifi' || !trackKey) return;
        // mpv 无缝接上的那一首已经在放：意图归之后认领它的那次 playSong（见 useHifiGaplessPreload），这里只记成开播过。
        if (promotedByGapless) {
            markHifiTrackStarted(trackKey);
            return;
        }
        if (loadState === 'deferred') {
            if (shouldAutoPlayRef.current) {
                void loadDeferredHifiTrack();
                return;
            }
            if (isHifiTrackStarted(trackKey)) return;
            markHifiTrackStarted(trackKey);
            const durationSec = hifiPlaybackClock.state().durationSec;
            if (isValidDuration(durationSec) && usePlaybackStore.getState().duration !== durationSec) setDuration(durationSec);
            setPlayerState(PlayerState.PAUSED);
            return;
        }
        if (loadState !== 'ready' || isHifiTrackStarted(trackKey)) return;
        if (shouldAutoPlayRef.current) {
            if (isLyricsLoading) return;
            spendHifiPlayIntent(trackKey);
            void hifiTransport.resume();
            setPlayerState(PlayerState.PLAYING);
            return;
        }
        markHifiTrackStarted(trackKey);
        // 接管窗口重建前还在放的那首时，它可能本来就在放。
        setPlayerState(hifiTransport.isPaused() ? PlayerState.PAUSED : PlayerState.PLAYING);
    }, [isLyricsLoading, loadState, playbackRoute, promotedByGapless, shouldAutoPlayRef, trackKey]);

    // 引擎状态 → 播放 store、放完、失败。只在当前曲目的状态翻转时动作，同一状态的重复推送（音频参数变了之类）不动。
    useEffect(() => {
        let lastSeen: { trackKey: string; status: HifiPlaybackStatus } | null = null;
        // 已经交给 Web 引擎的那一首（失败回落，或关掉了 HiFi）：只交一次，只提示一次。
        let handedOverTrackKey: string | null = null;
        // 已经换过下一首的那一首：同一次放完只换一次。它又放起来或停在中途（下一首没起播，听的人按了播放、跳了一下）就放开，
        // 再放完时照样换。
        let endedTrackKey: string | null = null;

        // 挪到 Web 引擎时用的是那一刻最新的 playSong。
        const moveToWeb = (track: HifiTrack, label: string) => moveHifiTrackToWeb(latestRef.current.playSong, track, label);

        /**
         * 回落：提示一次、记下这首本次会话走 Web，再让它在 Web 引擎上接着放。那之后又开始了一次播放（点了别的歌、换了下一首）
         * 就不重放：重放会把那次更新的播放顶掉。
         */
        const fail = (track: HifiTrack, code: HifiErrorCode) => {
            if (handedOverTrackKey === track.trackKey) return;
            // 别的程序独占着设备（Windows、macOS）：停在这里等它放开，不交给 Web 引擎，见 holdHifiTrackForDevice。
            // 每次重试再忙都会到这里，所以不记 handedOverTrackKey。Linux 上忙多半是 PipeWire 占着声卡，Web 引擎经 PipeWire 照样出声，照旧回落。
            if (code === 'DEVICE_BUSY' && holdsForBusyDevice() && isHifiTrackWaitingForDevice(track.trackKey)) {
                setStatusMessage({ type: 'error', text: latestRef.current.t('hifi.notice.deviceBusyHeld') });
                console.warn('[HiFi] the output device is held by another app, the song waits for a retry', { trackKey: track.trackKey });
                holdHifiTrackForDevice(track.trackKey);
                return;
            }
            handedOverTrackKey = track.trackKey;
            const { t: translate } = latestRef.current;
            if (code === 'CIRCUIT_OPEN' || useHifiEngineStore.getState().circuitOpen) showCircuitOpenToast(translate);
            else setStatusMessage({ type: 'error', text: translate(`hifi.errors.${code}`) });
            hifiEngine.markSongForcedWeb(track.songKey);
            if (track.stillWanted?.() === false) {
                console.warn('[HiFi] playback failed after a newer play started, the song is not replayed', { trackKey: track.trackKey, code });
                return;
            }
            console.warn('[HiFi] playback failed, the song plays on the Web engine', { trackKey: track.trackKey, code });
            moveToWeb(track, 'replay on the Web engine');
        };

        /** 放完：和 <audio> 的 onEnded 一样换下一首；队尾没有下一首时停掉 mpv，独占的设备当场放开。 */
        const end = async (track: HifiTrack) => {
            if (endedTrackKey === track.trackKey) return;
            endedTrackKey = track.trackKey;
            await latestRef.current.handleNextTrack({ allowStopOnMissing: true, shouldNavigateToPlayer: false });
            // 有下一首时 handleNextTrack 不等它载入就返回，那时曲目还是这一首；队尾的 stopAtQueueEnd 才把状态写成 IDLE。
            if (!isHifiRoute() || useHifiTrackStore.getState().current?.trackKey !== track.trackKey) return;
            if (usePlaybackStore.getState().playerState !== PlayerState.IDLE) return;
            armQueueEndReplay(track, () => latestRef.current.playSong);
            console.info('[HiFi] queue ended, mpv stopped to release the output device', { trackKey: track.trackKey });
            void hifiEngine.stop();
        };

        const sync = () => {
            const track = useHifiTrackStore.getState().current;
            const engine = useHifiEngineStore.getState().engine;
            if (!isHifiRoute() || !track || !engine || engine.trackKey !== track.trackKey) return;
            const playback = usePlaybackStore.getState();
            if (isValidDuration(engine.durationSec) && playback.duration !== engine.durationSec) {
                setDuration(engine.durationSec);
            }
            if (lastSeen?.trackKey === track.trackKey && lastSeen.status === engine.status) return;
            lastSeen = { trackKey: track.trackKey, status: engine.status };
            if (endedTrackKey === track.trackKey && (engine.status === 'playing' || engine.status === 'paused')) endedTrackKey = null;
            if (engine.status === 'error') {
                // 还在载入时的 'error' 归载入的结果管（刚离开 Web 引擎时的 DEVICE_BUSY 还在重试）；落定是失败时走 loadState。
                if (useHifiTrackStore.getState().loadState !== 'loading') fail(track, engine.errorCode ?? 'UNKNOWN');
            } else if (engine.status === 'ended') {
                end(track).catch(error => console.warn('[HiFi] moving on after the end failed', error));
            } else if (engine.status === 'playing') {
                // 无缝接上的那一首：播放意图（如果有）是正在落地的那次播放的，留给认领它的时候。
                if (track.promotedByGapless) markHifiTrackStarted(track.trackKey);
                else spendHifiPlayIntent(track.trackKey);
                if (playback.playerState !== PlayerState.PLAYING || playback.isLoadingToPlay) setPlayerState(PlayerState.PLAYING);
            } else if (engine.status === 'paused' && isHifiTrackStarted(track.trackKey)) {
                if (playback.playerState === PlayerState.PLAYING) setPlayerState(PlayerState.PAUSED);
            }
        };

        const unsubscribeEngine = useHifiEngineStore.subscribe((state, previous) => {
            if (state.circuitOpen && !previous.circuitOpen) showCircuitOpenToast(latestRef.current.t);
            if (state.engine !== previous.engine) sync();
        });
        const unsubscribeTrack = useHifiTrackStore.subscribe((state, previous) => {
            if (state.current !== previous.current) sync();
            if (state.loadState === 'failed' && previous.loadState !== 'failed' && state.current && isHifiRoute()) {
                fail(state.current, state.loadError ?? 'LOAD_FAILED');
            }
        });
        // 载入失败只走上面的 loadState；这里是开播之后的致命错误（mpv 崩了、设备没了），没带 trackKey 的算当前这首。
        const unsubscribeError = hifiEngine.onError((event) => {
            const track = useHifiTrackStore.getState().current;
            if (!event.fatal || !track || !isHifiRoute()) return;
            if (event.trackKey !== null && event.trackKey !== track.trackKey) return;
            fail(track, event.code);
        });
        // 关掉 HiFi（或 Navidrome 不再走 HiFi）当场生效：这一首挪到 Web 引擎上接着放，路由守卫随之停掉 mpv、放开设备。
        // 不记 forcedWeb：再打开 HiFi，这首歌下次照样走 mpv。
        const unsubscribeSettings = useHifiSettingsStore.subscribe((state, previous) => {
            const track = useHifiTrackStore.getState().current;
            if (!track || !isHifiRoute() || handedOverTrackKey === track.trackKey) return;
            const switchedOff = (previous.enabled && !state.enabled)
                || (track.origin === 'navidrome' && previous.navidrome && !state.navidrome);
            if (!switchedOff || track.stillWanted?.() === false) return;
            handedOverTrackKey = track.trackKey;
            console.info('[HiFi] HiFi was switched off, the song moves to the Web engine', { trackKey: track.trackKey });
            moveToWeb(track, 'move to the Web engine');
        });
        return () => {
            unsubscribeEngine();
            unsubscribeTrack();
            unsubscribeError();
            unsubscribeSettings();
            clearQueueEndReplay();
        };
    }, []);
}
