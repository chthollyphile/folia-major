import { useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import type { PlaybackRoute } from '../../types/hifi';

// src/components/hifi/useWebEngineYield.ts
// 路线切到 HiFi 的那一下让 Web 引擎让位：停掉 automix 的过渡，暂停并卸下两个 deck，挂起 AudioContext（Windows 上 Chromium
// 的共享流会挡住 WASAPI 独占）；切回 Web 时把 AudioContext 恢复过来，下一首 Web 歌才有声音。

/** App 渲染 deck 时写在 <audio> 上的属性，值是 deck 的 id；这里按它找到两个 deck。 */
export const PLAYBACK_DECK_ATTRIBUTE = 'data-playback-deck';

type UseWebEngineYieldParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    /** 只用它停掉进行中的过渡；App 每次渲染给的对象都不同，这里读最新的那个。 */
    automix: { abortTransition: () => void };
};

type WebEngineYieldPorts = {
    decks: () => HTMLAudioElement[];
    audioContext: () => AudioContext | null;
    abortTransition: () => void;
};

/** 页面上的两个 deck，再加上 audioRef 指着的那个（属性还没写上时也不漏）。 */
export const findPlaybackDecks = (activeDeck: HTMLAudioElement | null): HTMLAudioElement[] => {
    const decks = new Set<HTMLAudioElement>();
    if (typeof document !== 'undefined') {
        document.querySelectorAll<HTMLAudioElement>(`audio[${PLAYBACK_DECK_ATTRIBUTE}]`).forEach(deck => decks.add(deck));
    }
    if (activeDeck) decks.add(activeDeck);
    return [...decks];
};

/**
 * 暂停并卸下一个 deck。只去掉 src 属性停不住 <audio>：它会接着放已经载入的 currentSrc，所以要 load() 一次让它真的空下来。
 * 之后 React 渲染时 src 为空，不会再给它源。
 */
const unloadDeck = (deck: HTMLAudioElement) => {
    deck.pause();
    deck.removeAttribute('src');
    deck.load();
};

/** 切到 HiFi：过渡先停（它会再动 deck），再把两个 deck 都停下卸空，最后挂起 AudioContext。 */
export const yieldWebEngine = ({ decks, audioContext, abortTransition }: WebEngineYieldPorts) => {
    try {
        abortTransition();
    } catch (error) {
        console.warn('[HiFi] could not stop the automix transition before handing over to mpv', error);
    }
    const unloaded = decks();
    unloaded.forEach(unloadDeck);
    const context = audioContext();
    const suspends = context !== null && context.state === 'running';
    if (suspends) {
        context.suspend().catch(error => console.warn('[HiFi] could not suspend the AudioContext', error));
    }
    console.info('[HiFi] the Web engine yielded to mpv', { decks: unloaded.length, suspendedAudioContext: suspends });
};

/** 切回 Web：AudioContext 挂起着时恢复。Web 的自动播放直接 play() 元素、不碰 AudioContext，不恢复就是静音。 */
export const resumeWebEngine = (audioContext: AudioContext | null) => {
    if (!audioContext || audioContext.state !== 'suspended') return;
    audioContext.resume().catch(error => console.warn('[HiFi] could not resume the AudioContext for the Web engine', error));
};

/**
 * 订阅播放 store 的路线。zustand 的订阅在 setState 里同步执行，早于 React 渲染：beginHifiTrack 切路线的那一下 deck 已经
 * 停了，mpv 打开设备时 Web 引擎不再出声，deck 的事件也不会再驱动 HiFi 那首歌。返回退订函数。
 */
export const installWebEngineYield = (ports: WebEngineYieldPorts) => {
    // 自己记上一次的路线，不用订阅回调传来的 previous：嵌套的 setState（路由守卫在订阅里改路线）会让后面的订阅者拿到旧的那对。
    let lastRoute: PlaybackRoute = 'web';
    const check = () => {
        const route = usePlaybackStore.getState().playbackRoute;
        if (route === lastRoute) return;
        lastRoute = route;
        if (route === 'hifi') yieldWebEngine(ports);
        else resumeWebEngine(ports.audioContext());
    };
    check();
    return usePlaybackStore.subscribe(check);
};

// 挂在 App 里一次。
export function useWebEngineYield({ audioRef, audioContextRef, automix }: UseWebEngineYieldParams) {
    const automixRef = useRef(automix);
    useEffect(() => {
        automixRef.current = automix;
    });

    useEffect(() => installWebEngineYield({
        decks: () => findPlaybackDecks(audioRef.current),
        audioContext: () => audioContextRef.current,
        abortTransition: () => automixRef.current.abortTransition(),
    }), [audioContextRef, audioRef]);
}
