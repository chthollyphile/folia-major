import { useEffect, useRef, useState } from 'react';
import { subscribeToTransitionCue, type TransitionCue } from '../../../../services/automix/transitionCue';
import { useSettingsUiStore } from '../../../../stores/useSettingsUiStore';

// src/components/app/overlays/now-playing-toast/useTransitionBorderCue.ts

/** 值得画的最短混音时长，和 AutomixTransitionAnimation 取同一个门槛：
 *  更短的（beat cut、splice）本来就是要让人察觉不到的，画出来只剩一次闪光。 */
const MIN_DRAWN_SECONDS = 5;

export const useTransitionBorderCue = (): TransitionCue | null => {
    const [cue, setCue] = useState<TransitionCue | null>(null);
    const endsAtRef = useRef(0);

    useEffect(() => subscribeToTransitionCue(next => {
        if (next === null) {
            if (performance.now() < endsAtRef.current) setCue(null);
            return;
        }
        const settings = useSettingsUiStore.getState();
        if (!settings.transitionAnimation || settings.transitionMode !== 'automix') return;
        if (!(next.seconds >= MIN_DRAWN_SECONDS)) return;
        endsAtRef.current = performance.now() + next.seconds * 1000;
        setCue(next);
    }), []);

    useEffect(() => {
        if (!cue) return;
        const timer = window.setTimeout(() => setCue(null), cue.seconds * 1000);
        return () => window.clearTimeout(timer);
    }, [cue]);

    return cue;
};
