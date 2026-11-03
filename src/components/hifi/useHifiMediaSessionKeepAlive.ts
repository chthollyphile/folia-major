import { useEffect, useRef, useState } from 'react';
import type { PlaybackRoute } from '../../types/hifi';
import { useHifiSettingsStore } from '../../stores/useHifiSettingsStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { hifiMediaShim } from '../../services/hifi/hifiMediaShim';
import { useHifiTrackStore } from '../../services/hifi/hifiTrackStore';
import { useMainProcessMediaControls } from './useHifiMpris';

// src/components/hifi/useHifiMediaSessionKeepAlive.ts
// mpv 发声时页面里没有在放的媒体元素，Chromium 就不向系统登记媒体会话（Linux 的 MPRIS、Windows 的 SMTC、macOS 的正在播放）。
// HiFi 在放时这里循环放一段音量为 0 的静音 WAV，让会话一直在；元数据和按键动作照旧由 useMediaSessionBridge 给。
// 独占输出时不放：Chromium 在同一台设备上开一路流会挡住 mpv 的独占，那时系统媒体控制是已知的限制。
// Linux 上不放：系统媒体控制由主进程登记的 MPRIS 给（useHifiMpris），保活那路流会挡住 PipeWire 切换采样率（#835）；
// 主进程报登记不上时（没有会话总线等）照旧放，系统媒体控制总还有一路。

/** 写在保活元素上的属性，和 deck 的 data-playback-deck 区分开。 */
export const KEEP_ALIVE_ATTRIBUTE = 'data-hifi-media-session-keep-alive';

const SILENCE_SAMPLE_RATE = 44100;
// 比 5 秒长一点：Chromium 的媒体代码有把 5 秒以内的媒体当作短促提示音（transient）的规则。Linux 上实测 1 秒的循环
// 也登记成了可控制的会话（MPRIS 的 CanControl 为真，PlayPause 送到页面的 pause 处理），Windows 和 macOS 没测；多留这点余量只多占约半兆内存。
const SILENCE_SECONDS = 6;

/** 一段 44.1 kHz、16 bit、单声道的静音 WAV：44 字节的头，后面的样本全是 0。 */
export const buildSilentWav = (seconds = SILENCE_SECONDS, sampleRate = SILENCE_SAMPLE_RATE): ArrayBuffer => {
    const dataBytes = Math.round(seconds * sampleRate) * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const ascii = (offset: number, text: string) => {
        for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, dataBytes, true);
    return buffer;
};

/**
 * 输出是不是独占的：Windows 和 macOS 看独占开关（WASAPI 独占、Core Audio 的 hog 模式），Linux 上 ALSA 的 hw: 直连
 * 不论开关都独占设备。这时页面里再开一路 Chromium 的流会和 mpv 抢设备。
 */
export const isExclusiveHifiOutput = ({ platform, exclusive, audioDevice }: {
    platform: string | null;
    exclusive: boolean;
    audioDevice: string;
}): boolean => (
    ((platform === 'win32' || platform === 'darwin') && exclusive) || /^alsa\/hw:/i.test(audioDevice)
);

export type KeepAliveAction = 'play' | 'pause' | 'remove';

/**
 * 保活元素该做什么：不在 HiFi 路线上、输出独占或系统媒体控制由主进程给时拿掉，HiFi 在放时放，暂停、放完、载入中时停着。
 */
export const keepAliveAction = ({ route, enginePlaying, exclusiveOutput, mainProcessMediaControls = false }: {
    route: PlaybackRoute;
    enginePlaying: boolean;
    exclusiveOutput: boolean;
    mainProcessMediaControls?: boolean;
}): KeepAliveAction => {
    if (route !== 'hifi' || exclusiveOutput || mainProcessMediaControls) return 'remove';
    return enginePlaying ? 'play' : 'pause';
};

type KeepAlivePorts = {
    document: Document;
    createObjectURL: (blob: Blob) => string;
    revokeObjectURL: (url: string) => void;
};

const defaultPorts = (): KeepAlivePorts => ({
    document,
    createObjectURL: blob => URL.createObjectURL(blob),
    revokeObjectURL: url => URL.revokeObjectURL(url),
});

/**
 * 保活用的 <audio>：不是 deck，也不接进 Web Audio（AudioContext 在 HiFi 路线上是挂起的），第一次要放时才建。
 * 音量为 0 而不是静音：Chromium 不为静音的元素登记媒体会话，音量 0 的会登记（finding #9 的实测）。
 */
export const createMediaSessionKeepAlive = (ports: KeepAlivePorts = defaultPorts()) => {
    let element: HTMLAudioElement | null = null;
    let url: string | null = null;

    const ensure = () => {
        if (element) return element;
        url = ports.createObjectURL(new Blob([buildSilentWav()], { type: 'audio/wav' }));
        const audio = ports.document.createElement('audio');
        audio.setAttribute(KEEP_ALIVE_ATTRIBUTE, '');
        audio.hidden = true;
        audio.loop = true;
        audio.preload = 'auto';
        audio.volume = 0;
        audio.src = url;
        ports.document.body.appendChild(audio);
        element = audio;
        return audio;
    };

    return {
        play: () => {
            const audio = ensure();
            if (!audio.paused) return;
            Promise.resolve(audio.play()).catch((error: unknown) => {
                // 紧接着的 pause() 打断了这次 play()：本来就该停着。
                if (error instanceof DOMException && error.name === 'AbortError') return;
                console.warn('[HiFi] the media session keep-alive could not start', error);
            });
        },
        pause: () => {
            if (element && !element.paused) element.pause();
        },
        /** 停下、卸空、移出页面，撤掉 Blob URL。 */
        remove: () => {
            if (!element) return;
            element.pause();
            element.removeAttribute('src');
            element.load();
            element.remove();
            element = null;
            if (url) ports.revokeObjectURL(url);
            url = null;
        },
        element: () => element,
    };
};

export type MediaSessionKeepAlive = ReturnType<typeof createMediaSessionKeepAlive>;

// shim 的这几个事件说的是 mpv 放着还是停着；beginTrack / reset 不派发事件，换曲目和离开路线另外看。
const ENGINE_PLAYBACK_EVENTS = ['play', 'playing', 'pause', 'ended'] as const;

const currentPlatform = (): string | null => (typeof window !== 'undefined' ? window.electron?.platform ?? null : null);

// 挂在 App 里一次，挨着 useMediaSessionBridge。
export function useHifiMediaSessionKeepAlive() {
    const route = usePlaybackStore(state => state.playbackRoute);
    const trackKey = useHifiTrackStore(state => state.current?.trackKey ?? null);
    const exclusive = useHifiSettingsStore(state => state.exclusive);
    const audioDevice = useHifiSettingsStore(state => state.audioDevice);
    const [enginePlaying, setEnginePlaying] = useState(() => !hifiMediaShim.paused);

    useEffect(() => {
        const sync = () => setEnginePlaying(!hifiMediaShim.paused);
        sync();
        ENGINE_PLAYBACK_EVENTS.forEach(type => hifiMediaShim.addEventListener(type, sync));
        return () => ENGINE_PLAYBACK_EVENTS.forEach(type => hifiMediaShim.removeEventListener(type, sync));
    }, []);
    // 换曲目、离开路线时 shim 不派发事件：在这两处再读一次。
    useEffect(() => {
        setEnginePlaying(!hifiMediaShim.paused);
    }, [route, trackKey]);

    const exclusiveOutput = isExclusiveHifiOutput({ platform: currentPlatform(), exclusive, audioDevice });
    const mainProcessMediaControls = useMainProcessMediaControls();
    const action = keepAliveAction({ route, enginePlaying, exclusiveOutput, mainProcessMediaControls });

    useEffect(() => {
        if (route !== 'hifi' || !exclusiveOutput || mainProcessMediaControls) return;
        console.info('[HiFi] no media session keep-alive on an exclusive output: system media controls are unavailable', {
            platform: currentPlatform(),
            audioDevice,
        });
    }, [audioDevice, exclusiveOutput, mainProcessMediaControls, route]);

    const keepAliveRef = useRef<MediaSessionKeepAlive | null>(null);
    useEffect(() => {
        if (action === 'remove') {
            keepAliveRef.current?.remove();
            return;
        }
        keepAliveRef.current ??= createMediaSessionKeepAlive();
        if (action === 'play') keepAliveRef.current.play();
        else keepAliveRef.current.pause();
    }, [action]);
    useEffect(() => () => keepAliveRef.current?.remove(), []);
}
