import { useEffect } from 'react';
import { useBackgroundLyricHoldStore } from './backgroundLyricHoldStore';

// src/components/app/backgroundThrottling/useBackgroundLyricHold.ts
// Holds the lyric animation while 后台节流 is in force and the window is out of sight. The main
// process says both (electron/backgroundThrottling.cjs): whether the switch is in force, and whether
// the window is minimised or hidden to the tray. A page Chromium reports hidden (covered, where it
// can tell) counts too. Losing the focus alone does not: a window still on screen keeps moving.

type BackgroundThrottlingState = { active: boolean; hidden: boolean };

const isLyricHeld = (state: BackgroundThrottlingState, visibility: DocumentVisibilityState) => (
    state.active && (state.hidden || visibility === 'hidden')
);

export const useBackgroundLyricHold = () => {
    useEffect(() => {
        const electron = window.electron;
        if (!electron?.getBackgroundThrottlingState) {
            return;
        }
        let state: BackgroundThrottlingState = { active: false, hidden: false };
        let disposed = false;
        const sync = () => {
            const held = isLyricHeld(state, document.visibilityState);
            if (useBackgroundLyricHoldStore.getState().held !== held) {
                useBackgroundLyricHoldStore.setState({ held });
            }
        };

        const unsubscribe = electron.onBackgroundThrottlingChanged?.((next) => {
            state = next;
            sync();
        });
        electron.getBackgroundThrottlingState()
            .then((next) => {
                if (disposed) return;
                state = next;
                sync();
            })
            .catch(error => console.warn('[BackgroundThrottling] Reading the switch failed', error));
        document.addEventListener('visibilitychange', sync);

        return () => {
            disposed = true;
            unsubscribe?.();
            document.removeEventListener('visibilitychange', sync);
            useBackgroundLyricHoldStore.setState({ held: false });
        };
    }, []);
};
