import { useEffect, useRef } from 'react';
import { useAppChromeStore } from '../stores/useAppChromeStore';
import { usePlayerChromeSettingsStore } from '../stores/usePlayerChromeSettingsStore';
import { isWithinClickThroughUnlockHotspot } from '../utils/clickThroughUnlockHotspot';
import { useClickThroughPointerLock } from './useClickThroughPointerLock';

// src/hooks/useElectronWindowChrome.ts
//
// Everything the Electron main window needs done to the document and to the click-through state:
// the transparent document background, discovering and following the main process's click-through
// flag, and the hover hotspot that temporarily unlocks pointer events so the toggle stays clickable
// while click-through is on.
//
// All three are side effects on globals with no return value, so they were three bare useEffects in
// App.tsx keyed on the same two conditions. Nothing else reads what they write except through the
// chrome store, which they already go through.

export const useElectronWindowChrome = () => {
    const lastPointer = useRef<{ screenX: number; clientX: number } | undefined>(undefined);
    const isElectronWindow = Boolean((window as typeof window & { electron?: unknown; }).electron);
    const transparentPlayerBackground = usePlayerChromeSettingsStore(state => state.transparentPlayerBackground);
    const enablePlayerPageNativeBlur = usePlayerChromeSettingsStore(state => state.enablePlayerPageNativeBlur);
    const isPlayerPageTransparent = transparentPlayerBackground || enablePlayerPageNativeBlur;
    const isMainWindowClickThroughEnabled = useAppChromeStore(state => state.isMainWindowClickThroughEnabled);
    const setIsMainWindowClickThroughEnabled = useAppChromeStore(state => state.setIsMainWindowClickThroughEnabled);
    const setIsClickThroughToggleHotspotActive = useAppChromeStore(state => state.setIsClickThroughToggleHotspotActive);

    useEffect(() => {
        if (window.electron?.platform !== 'darwin') return;
        const rememberPointer = (event: MouseEvent) => {
            lastPointer.current = { screenX: event.screenX, clientX: event.clientX };
        };
        window.addEventListener('mousemove', rememberPointer);
        window.addEventListener('mousedown', rememberPointer);
        return () => {
            window.removeEventListener('mousemove', rememberPointer);
            window.removeEventListener('mousedown', rememberPointer);
        };
    }, []);

    useEffect(() => {
        const body = document.body;
        const html = document.documentElement;
        const previousBodyBackgroundColor = body.style.backgroundColor;
        const previousHtmlBackgroundColor = html.style.backgroundColor;
        const shouldUseTransparentDocumentBackground = isElectronWindow && isPlayerPageTransparent;

        if (shouldUseTransparentDocumentBackground) {
            body.style.backgroundColor = 'transparent';
            html.style.backgroundColor = 'transparent';
        } else {
            body.style.backgroundColor = '';
            html.style.backgroundColor = '';
        }

        return () => {
            body.style.backgroundColor = previousBodyBackgroundColor;
            html.style.backgroundColor = previousHtmlBackgroundColor;
        };
    }, [isElectronWindow, isPlayerPageTransparent]);

    useEffect(() => {
        if (!isElectronWindow || !window.electron?.getMainWindowClickThroughEnabled || !window.electron?.onMainWindowClickThroughChanged) {
            setIsMainWindowClickThroughEnabled(false);
            return;
        }

        let mounted = true;

        void window.electron.getMainWindowClickThroughEnabled().then((enabled) => {
            if (mounted) {
                setIsMainWindowClickThroughEnabled(Boolean(enabled));
            }
        }).catch(() => {
            if (mounted) {
                setIsMainWindowClickThroughEnabled(false);
            }
        });

        const unsubscribe = window.electron.onMainWindowClickThroughChanged((state) => {
            const enabled = Boolean(state?.enabled);
            setIsMainWindowClickThroughEnabled(enabled);
            setIsClickThroughToggleHotspotActive(enabled && Boolean(state?.unlockHoverActive));
        });

        return () => {
            mounted = false;
            unsubscribe?.();
        };
    }, [isElectronWindow]);

    useEffect(() => {
        if (!isElectronWindow || !isMainWindowClickThroughEnabled || !window.electron?.setMainWindowClickThroughUnlockHover) {
            setIsClickThroughToggleHotspotActive(false);
            void window.electron?.setMainWindowClickThroughUnlockHover?.(false);
            return;
        }

        if (window.electron.platform === 'darwin') {
            // The main process polls the real cursor, even while another window receives clicks.
            const syncViewport = () => void window.electron!.setMainWindowClickThroughUnlockHover(false, window.innerWidth, lastPointer.current);
            syncViewport();
            window.addEventListener('resize', syncViewport);
            return () => window.removeEventListener('resize', syncViewport);
        }

        const syncToggleHotspot = (active: boolean) => {
            setIsClickThroughToggleHotspotActive(prev => (prev === active ? prev : active));
            void window.electron!.setMainWindowClickThroughUnlockHover(active);
        };

        const handleMouseMove = (event: MouseEvent) => {
            const withinHotspot = isWithinClickThroughUnlockHotspot(event.clientX, event.clientY, window.innerWidth);

            setIsClickThroughToggleHotspotActive(prev => {
                if (prev === withinHotspot) {
                    return prev;
                }

                void window.electron!.setMainWindowClickThroughUnlockHover(withinHotspot);
                return withinHotspot;
            });
        };

        const handleMouseLeave = () => {
            syncToggleHotspot(false);
        };

        // `mouseleave` never fires on `window`; the document gets it when the pointer exits the
        // viewport. On Wayland the main process can't poll the cursor, so this is the only signal
        // that drops the unlock when the pointer leaves straight from the hotspot.
        window.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseleave', handleMouseLeave);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseleave', handleMouseLeave);
            syncToggleHotspot(false);
        };
    }, [isElectronWindow, isMainWindowClickThroughEnabled]);

    useClickThroughPointerLock(isMainWindowClickThroughEnabled);
};
