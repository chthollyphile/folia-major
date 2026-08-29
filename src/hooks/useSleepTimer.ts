import { useEffect, useRef } from 'react';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { runSleepTimerExpiryAction } from './sleepTimerExpiry';

// src/hooks/useSleepTimer.ts

type UseSleepTimerState = {
    enabled: boolean;
    hours: number;
    minutes: number;
    onExpireFallback: () => void;
};

const TICK_MS = 1000;

export const useSleepTimer = ({ enabled, hours, minutes, onExpireFallback }: UseSleepTimerState) => {
    const onExpireFallbackRef = useRef(onExpireFallback);
    const activationId = useSettingsUiStore(state => state.sleepTimerActivationId);

    useEffect(() => {
        onExpireFallbackRef.current = onExpireFallback;
    }, [onExpireFallback]);

    useEffect(() => {
        if (!enabled || (hours === 0 && minutes === 0)) {
            useSettingsUiStore.setState({ sleepTimerDeadlineMs: null });
            return;
        }

        const totalMs = (hours * 3600 + minutes * 60) * 1000;
        const deadline = Date.now() + totalMs;
        useSettingsUiStore.setState({ sleepTimerDeadlineMs: deadline });
        const timer = window.setInterval(() => {
            if (Date.now() >= deadline) {
                window.clearInterval(timer);
                useSettingsUiStore.setState({
                    sleepTimerEnabled: false,
                    sleepTimerDeadlineMs: null,
                });

                void runSleepTimerExpiryAction({
                    quitApp: window.electron?.quitApp,
                    onFallback: () => onExpireFallbackRef.current(),
                });
            }
        }, TICK_MS);

        return () => {
            window.clearInterval(timer);
            useSettingsUiStore.setState({ sleepTimerDeadlineMs: null });
        };
    }, [activationId, enabled, hours, minutes]);
};
