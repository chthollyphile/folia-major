import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import type { PlayerChromeVisibilityMode } from '../types/remoteControl';

// src/hooks/usePlayerChromeAutoHide.ts
// Coordinates persisted player-chrome modes with the legacy auto-hide setting.
const PLAYER_CHROME_VISIBILITY_MODE_STORAGE_KEY = 'player_chrome_visibility_mode';

const isPlayerChromeVisibilityMode = (value: string | null): value is PlayerChromeVisibilityMode => (
    value === 'always-hidden' || value === 'always-visible' || value === 'auto-hide'
);
type UsePlayerChromeAutoHideOptions = {
    autoHidePlayerChrome: boolean;
    initialPlayerChromeHidden: boolean;
    suppressPointerReveal?: boolean;
    setIsPlayerChromeHidden: React.Dispatch<React.SetStateAction<boolean>>;
    setAutoHidePlayerChromePreference: (enabled: boolean) => void;
    onModeChange?: (mode: PlayerChromeVisibilityMode) => void;
};

const getNextPlayerChromeVisibilityMode = (mode: PlayerChromeVisibilityMode): PlayerChromeVisibilityMode => {
    if (mode === 'always-hidden') return 'always-visible';
    if (mode === 'always-visible') return 'auto-hide';
    return 'always-hidden';
};

const getInitialPlayerChromeVisibilityMode = (autoHidePlayerChrome: boolean, initialPlayerChromeHidden: boolean): PlayerChromeVisibilityMode => {
    const storedMode = localStorage.getItem(PLAYER_CHROME_VISIBILITY_MODE_STORAGE_KEY);
    if (isPlayerChromeVisibilityMode(storedMode)) {
        return storedMode;
    }

    if (autoHidePlayerChrome) return 'auto-hide';
    return initialPlayerChromeHidden ? 'always-hidden' : 'always-visible';
};

export const usePlayerChromeAutoHide = ({
    autoHidePlayerChrome,
    initialPlayerChromeHidden,
    suppressPointerReveal = false,
    setIsPlayerChromeHidden,
    setAutoHidePlayerChromePreference,
    onModeChange,
}: UsePlayerChromeAutoHideOptions) => {
    const [playerChromeVisibilityMode, setPlayerChromeVisibilityMode] = useState<PlayerChromeVisibilityMode>(() => (
        getInitialPlayerChromeVisibilityMode(autoHidePlayerChrome, initialPlayerChromeHidden)
    ));
    const playerChromeVisibilityModeRef = useRef(playerChromeVisibilityMode);
    const timeoutIdRef = useRef<number | undefined>(undefined);
    const rafIdRef = useRef<number | undefined>(undefined);
    const isSynchronizingPreferenceRef = useRef(false);
    const hasInitializedPreferenceSyncRef = useRef(false);

    // One path for the cycle button and for a mode picked directly (the remote window's three-way choice).
    const setPlayerChromeVisibilityModeTo = useCallback((nextMode: PlayerChromeVisibilityMode) => {
        if (!isPlayerChromeVisibilityMode(nextMode) || nextMode === playerChromeVisibilityModeRef.current) {
            return;
        }
        const shouldAutoHide = nextMode === 'auto-hide';
        playerChromeVisibilityModeRef.current = nextMode;
        setPlayerChromeVisibilityMode(nextMode);
        if (autoHidePlayerChrome !== shouldAutoHide) {
            isSynchronizingPreferenceRef.current = true;
            setAutoHidePlayerChromePreference(shouldAutoHide);
        }
        onModeChange?.(nextMode);
    }, [autoHidePlayerChrome, onModeChange, setAutoHidePlayerChromePreference]);

    const cyclePlayerChromeVisibilityMode = useCallback(() => {
        setPlayerChromeVisibilityModeTo(getNextPlayerChromeVisibilityMode(playerChromeVisibilityModeRef.current));
    }, [setPlayerChromeVisibilityModeTo]);

    useEffect(() => {
        localStorage.setItem(PLAYER_CHROME_VISIBILITY_MODE_STORAGE_KEY, playerChromeVisibilityMode);
    }, [playerChromeVisibilityMode]);

    useEffect(() => {
        if (!hasInitializedPreferenceSyncRef.current) {
            hasInitializedPreferenceSyncRef.current = true;
            const shouldAutoHide = playerChromeVisibilityModeRef.current === 'auto-hide';
            if (autoHidePlayerChrome !== shouldAutoHide) {
                isSynchronizingPreferenceRef.current = true;
                setAutoHidePlayerChromePreference(shouldAutoHide);
            }
            return;
        }

        if (isSynchronizingPreferenceRef.current) {
            isSynchronizingPreferenceRef.current = false;
            return;
        }

        const nextMode = autoHidePlayerChrome ? 'auto-hide' : 'always-visible';
        playerChromeVisibilityModeRef.current = nextMode;
        setPlayerChromeVisibilityMode(nextMode);
    }, [autoHidePlayerChrome, setAutoHidePlayerChromePreference]);

    useEffect(() => {
        let isThrottled = false;
        let isPointerHeld = false;

        const clearAutoHideTimer = () => {
            window.clearTimeout(timeoutIdRef.current);
            timeoutIdRef.current = undefined;
        };

        const scheduleAutoHide = (delay: number) => {
            clearAutoHideTimer();
            if (isPointerHeld) return;
            timeoutIdRef.current = window.setTimeout(() => {
                timeoutIdRef.current = undefined;
                setIsPlayerChromeHidden(true);
            }, delay);
        };

        const showAndResetTimer = () => {
            setIsPlayerChromeHidden(false);
            scheduleAutoHide(3000);
        };

        const handleMouseOut = (event: MouseEvent) => {
            const hasLeftWindow = !event.relatedTarget || event.clientY <= 0 || event.clientX <= 0
                || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
            if (hasLeftWindow) {
                scheduleAutoHide(300);
            }
        };

        const handleMouseMove = (event: MouseEvent) => {
            // A pointer released outside the window does not reliably deliver pointerup here.
            // Repair the held state as soon as the mouse comes back without a pressed button.
            if (isPointerHeld && event.buttons === 0) {
                isPointerHeld = false;
            }
            if (isThrottled) return;
            isThrottled = true;
            rafIdRef.current = requestAnimationFrame(() => {
                showAndResetTimer();
                isThrottled = false;
            });
        };
        const handlePointerDown = () => {
            isPointerHeld = true;
            clearAutoHideTimer();
            setIsPlayerChromeHidden(false);
        };
        const handlePointerUp = () => {
            isPointerHeld = false;
            showAndResetTimer();
        };
        const handleWindowBlur = () => {
            isPointerHeld = false;
            scheduleAutoHide(300);
        };

        if (playerChromeVisibilityMode === 'always-hidden') {
            setIsPlayerChromeHidden(true);
            return clearAutoHideTimer;
        }

        if (playerChromeVisibilityMode === 'always-visible') {
            setIsPlayerChromeHidden(false);
            return clearAutoHideTimer;
        }

        // Click-through still forwards mouse-move into the renderer, so auto-hide would read the
        // cursor passing over an untouchable window as user presence and pop the chrome back up.
        if (suppressPointerReveal) {
            clearAutoHideTimer();
            setIsPlayerChromeHidden(true);
            return clearAutoHideTimer;
        }

        showAndResetTimer();
        window.addEventListener('mouseout', handleMouseOut);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('pointerdown', handlePointerDown);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);
        window.addEventListener('wheel', showAndResetTimer, { passive: true });
        window.addEventListener('blur', handleWindowBlur);

        return () => {
            clearAutoHideTimer();
            if (rafIdRef.current !== undefined) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = undefined;
            }
            window.removeEventListener('mouseout', handleMouseOut);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('pointerdown', handlePointerDown);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);
            window.removeEventListener('wheel', showAndResetTimer);
            window.removeEventListener('blur', handleWindowBlur);
        };
    }, [playerChromeVisibilityMode, suppressPointerReveal, setIsPlayerChromeHidden]);

    return { playerChromeVisibilityMode, cyclePlayerChromeVisibilityMode, setPlayerChromeVisibilityModeTo };
};
