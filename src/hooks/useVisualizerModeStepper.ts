import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getVisualizerModeLabel } from '../components/visualizer/registry';
import type { VisualizerMode } from '../types';
import { setStatusMessage } from '../stores/useStatusMessageStore';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { RANDOM_VISUALIZER_CHOICE, selectLyricStyleChoice } from '../components/visualizer/random/lyricStyleChoices';

// src/hooks/useVisualizerModeStepper.ts
// 面板里用箭头逐个切换歌词动画。每步都弹一次切换提示会刷屏，
// 所以步进时静音，停下来之后只提示最终落在哪个模式。

const STEP_NOTIFY_DELAY_MS = 700;

/** 在有序模式列表里从 fromMode 沿 direction 走一格，首尾相接。 */
const stepFrom = (fromMode: VisualizerMode, direction: -1 | 1, modes: VisualizerMode[]) => {
    if (modes.length === 0) {
        return fromMode;
    }

    const index = modes.indexOf(fromMode);
    if (index < 0) {
        return modes[0];
    }

    return modes[(index + direction + modes.length) % modes.length];
};

export const useVisualizerModeStepper = (modes: VisualizerMode[]) => {
    const { t } = useTranslation();
    const modesRef = useRef(modes);
    const notifyTimerRef = useRef<number | null>(null);

    modesRef.current = modes;

    const cancelScheduledNotify = useCallback(() => {
        if (notifyTimerRef.current !== null) {
            window.clearTimeout(notifyTimerRef.current);
            notifyTimerRef.current = null;
        }
    }, []);

    const scheduleNotify = useCallback(() => {
        cancelScheduledNotify();

        notifyTimerRef.current = window.setTimeout(() => {
            notifyTimerRef.current = null;

  const stateVisualizer = useVisualizerSettingsStore.getState();
            setStatusMessage({
                type: 'info',
                text: t('notifications.visualizerSwitched', {
                    mode: stateVisualizer.randomVisualizerModePerSong ? t('ui.visualizerRandom') : getVisualizerModeLabel(stateVisualizer.visualizerMode, key => t(key)),
                }),
            });
        }, STEP_NOTIFY_DELAY_MS);
    }, [cancelScheduledNotify, t]);

    const step = useCallback((direction: -1 | 1) => {
        const availableModes = modesRef.current;
        if (availableModes.length < 2) {
            return;
        }

        const stateVisualizer = useVisualizerSettingsStore.getState();
        const from = stateVisualizer.randomVisualizerModePerSong ? RANDOM_VISUALIZER_CHOICE : stateVisualizer.visualizerMode;
        const target = stepFrom(from, direction, availableModes);
        selectLyricStyleChoice(target, mode => stateVisualizer.handleSetVisualizerMode(mode, { notify: false }), false);
        scheduleNotify();
    }, [scheduleNotify]);

    useEffect(() => () => cancelScheduledNotify(), [cancelScheduledNotify]);

    return step;
};
