import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { StatusMessage } from '../types';
import { getCustomCappellaEmojiPack } from '../services/cappellaEmojiPack';
import { getCustomCappellaAvatar } from '../services/cappellaAvatarPack';
import { getMonetBackgroundImage } from '../services/monetBackgroundImage';
import { getMonetPortraitImage } from '../services/monetPortraitImage';
import { restoreUploadedLyricsFont } from '../services/customLyricsFont';
import { resolveStoredCappellaTuning } from '../components/visualizer/cappella/tuning';
import { resolveStoredMonetBackgroundTuning } from '../components/visualizer/backgrounds/monet/tuning';
import { resolveStoredMonetTuning } from '../components/visualizer/monet/tuning';
import { resolveVisualizerBackgroundMode } from '../stores/visualizerSettingsPersistence';
import i18n from '../i18n/config';
import { setStatusMessage } from '../stores/useStatusMessageStore';
import { createSafeObjectUrl } from '../utils/blobGuards';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { useVisualizerAssetStore } from '../stores/useVisualizerAssetStore';
import { useTypographySettingsStore } from '../stores/useTypographySettingsStore';
import { resolveStoredCustomLyricsFont } from '../stores/useTypographySettingsStore';
import { usePlayerChromeSettingsStore } from '../stores/usePlayerChromeSettingsStore';
import { readSystemThemeIsDaylight } from '../stores/useThemeSettingsStore';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useDesktopSettingsStore } from '../stores/useDesktopSettingsStore';

export { resolveStoredCappellaTuning, resolveStoredCustomLyricsFont, resolveStoredMonetBackgroundTuning, resolveVisualizerBackgroundMode };

export function useAppPreferences() {
    const followSystemTheme = useThemeSettingsStore(state => state.followSystemTheme);
    const setTransparentPlayerBackgroundFromSystem = usePlayerChromeSettingsStore(state => state.setTransparentPlayerBackgroundFromSystem);
    const setDesktopPreferenceSnapshot = useDesktopSettingsStore(state => state.setDesktopPreferenceSnapshot);
    const setStoredCappellaEmojiPack = useVisualizerAssetStore(state => state.setStoredCappellaEmojiPack);
    const setCappellaCustomEmojiImages = useVisualizerAssetStore(state => state.setCappellaCustomEmojiImages);
    const setIsLoadingCappellaCustomEmojiPack = useVisualizerAssetStore(state => state.setIsLoadingCappellaCustomEmojiPack);
    const setStoredCappellaAvatarPack = useVisualizerAssetStore(state => state.setStoredCappellaAvatarPack);
    const setCappellaCustomAvatarImages = useVisualizerAssetStore(state => state.setCappellaCustomAvatarImages);
    const setIsLoadingCappellaCustomAvatarPack = useVisualizerAssetStore(state => state.setIsLoadingCappellaCustomAvatarPack);
    const setStoredMonetBackgroundImage = useVisualizerAssetStore(state => state.setStoredMonetBackgroundImage);
    const setMonetBackgroundImage = useVisualizerAssetStore(state => state.setMonetBackgroundImage);
    const setIsLoadingMonetBackgroundImage = useVisualizerAssetStore(state => state.setIsLoadingMonetBackgroundImage);
    const setStoredMonetPortraitImage = useVisualizerAssetStore(state => state.setStoredMonetPortraitImage);
    const setMonetPortraitImage = useVisualizerAssetStore(state => state.setMonetPortraitImage);
    const setIsLoadingMonetPortraitImage = useVisualizerAssetStore(state => state.setIsLoadingMonetPortraitImage);
    const handleSetMonetTuning = useVisualizerSettingsStore(state => state.handleSetMonetTuning);
    const handleSetMonetBackgroundTuning = useVisualizerSettingsStore(state => state.handleSetMonetBackgroundTuning);
    const clearLyricsCustomFontAfterRestoreFailure = useTypographySettingsStore(state => state.clearLyricsCustomFontAfterRestoreFailure);
    const lyricsCustomFont = useTypographySettingsStore(state => state.lyricsCustomFont);
    const storedCappellaEmojiPack = useVisualizerAssetStore(state => state.storedCappellaEmojiPack);
    const storedCappellaAvatarPack = useVisualizerAssetStore(state => state.storedCappellaAvatarPack);
    const storedMonetBackgroundImage = useVisualizerAssetStore(state => state.storedMonetBackgroundImage);
    const isLoadingMonetBackgroundImage = useVisualizerAssetStore(state => state.isLoadingMonetBackgroundImage);
    const storedMonetPortraitImage = useVisualizerAssetStore(state => state.storedMonetPortraitImage);
    const isLoadingMonetPortraitImage = useVisualizerAssetStore(state => state.isLoadingMonetPortraitImage);
    const monetBackgroundTuning = useVisualizerSettingsStore(state => state.monetBackgroundTuning);
    const monetTuning = useVisualizerSettingsStore(state => state.monetTuning);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const setDaylightPreferenceFromSystem = useThemeSettingsStore(state => state.setDaylightPreferenceFromSystem);

    useEffect(() => {
        const root = document.documentElement;
        if (isDaylight) {
            root.style.setProperty('--scrollbar-track', '#cccbcc');
            root.style.setProperty('--scrollbar-thumb', '#ecececff');
            root.style.setProperty('--scrollbar-thumb-hover', '#ffffffff');
        } else {
            root.style.setProperty('--scrollbar-track', '#18181b');
            root.style.setProperty('--scrollbar-thumb', '#3f3f46');
            root.style.setProperty('--scrollbar-thumb-hover', '#52525b');
        }
    }, [isDaylight]);

    // Keep the persisted daylight value in sync with OS changes only while auto-follow is enabled.
    useEffect(() => {
        if (!followSystemTheme || typeof window.matchMedia !== 'function') {
            return;
        }

        const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
        const syncWithSystemTheme = (isLight: boolean) => {
            setDaylightPreferenceFromSystem(isLight);
        };

        const handleSystemThemeChange = (event: MediaQueryListEvent) => {
            syncWithSystemTheme(event.matches);
        };

        const initialSystemTheme = readSystemThemeIsDaylight();
        if (initialSystemTheme !== null) {
            syncWithSystemTheme(initialSystemTheme);
        }

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleSystemThemeChange);
            return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
        }

        mediaQuery.addListener(handleSystemThemeChange);
        return () => mediaQuery.removeListener(handleSystemThemeChange);
    }, [followSystemTheme, setDaylightPreferenceFromSystem]);

    useEffect(() => {
        if (!window.electron?.getWindowTransparentMode) {
            return;
        }

        let isCancelled = false;

        const syncTransparentPlayerBackground = async () => {
            try {
                const enabled = await window.electron!.getWindowTransparentMode();
                if (!isCancelled) {
                    setTransparentPlayerBackgroundFromSystem(enabled);
                }
            } catch {
                // Ignore startup sync failures and keep local preference fallback.
            }
        };

        void syncTransparentPlayerBackground();
        return () => {
            isCancelled = true;
        };
    }, [setTransparentPlayerBackgroundFromSystem]);

    useEffect(() => {
        if (!window.electron?.getSettings) {
            return;
        }

        let isCancelled = false;

        const syncDesktopPreferences = async () => {
            try {
                const settings = await window.electron!.getSettings();
                if (!isCancelled) {
                    setDesktopPreferenceSnapshot(settings);
                }
            } catch {
                // Ignore desktop preference sync failures and keep local fallback.
            }
        };

        void syncDesktopPreferences();
        return () => {
            isCancelled = true;
        };
    }, [setDesktopPreferenceSnapshot]);

    useEffect(() => {
        return window.electron?.onWallpaperModeChanged?.((settings) => {
            setDesktopPreferenceSnapshot(settings);
        });
    }, [setDesktopPreferenceSnapshot]);

    useEffect(() => {
        // The tray asked to enter wallpaper mode. Tray lives in the main process and cannot show
        // the in-app dialog, so it goes through the same gated entry as the settings card.
        return window.electron?.onWallpaperEntryRequested?.(() => {
            useDesktopSettingsStore.getState().handleToggleWallpaperMode(true);
        });
    }, []);

    useEffect(() => {
        // Main refused a transparent-enable toggle (classic Windows wallpaper mode): the toggle
        // stays in its previous state, this only explains why nothing happened.
        return window.electron?.onWallpaperTransparentRefused?.(() => {
            usePlayerChromeSettingsStore.getState().handleWallpaperTransparentRefused();
        });
    }, []);

    useEffect(() => {
        // macOS wallpaper mode refused to enter because Input Monitoring is not granted: the
        // main process surfaces the System Settings prompt, this explains what to do next.
        return window.electron?.onWallpaperInputMonitorRequested?.(() => {
            setStatusMessage({
                type: 'info',
                text: i18n.t('notifications.macWallpaperInputMonitoringNeeded'),
            });
        });
    }, []);

    useEffect(() => {
        // macOS wallpaper mode with Stage Manager on and the desktop icons shown: without the
        // Accessibility grant a click on the wallpaper still sends the stage aside (issue #698).
        return window.electron?.onWallpaperAccessibilitySuggested?.(() => {
            setStatusMessage({
                type: 'info',
                text: i18n.t('notifications.macWallpaperAccessibilitySuggested'),
            });
        });
    }, []);

    useEffect(() => {
        let isCancelled = false;

        const loadCustomEmojiPack = async () => {
            try {
                const storedPack = await getCustomCappellaEmojiPack();
                if (!isCancelled) {
                    setStoredCappellaEmojiPack(storedPack);
                }
            } finally {
                if (!isCancelled) {
                    setIsLoadingCappellaCustomEmojiPack(false);
                }
            }
        };

        void loadCustomEmojiPack();
        return () => {
            isCancelled = true;
        };
    }, [setIsLoadingCappellaCustomEmojiPack, setStoredCappellaEmojiPack]);

    useEffect(() => {
        let isCancelled = false;

        const loadCustomAvatarPack = async () => {
            try {
                const storedPack = await getCustomCappellaAvatar();
                if (!isCancelled) {
                    setStoredCappellaAvatarPack(storedPack);
                }
            } finally {
                if (!isCancelled) {
                    setIsLoadingCappellaCustomAvatarPack(false);
                }
            }
        };

        void loadCustomAvatarPack();
        return () => {
            isCancelled = true;
        };
    }, [setIsLoadingCappellaCustomAvatarPack, setStoredCappellaAvatarPack]);

    useEffect(() => {
        let isCancelled = false;

        const loadMonetBackgroundImage = async () => {
            try {
                const storedImage = await getMonetBackgroundImage();
                if (!isCancelled) {
                    setStoredMonetBackgroundImage(storedImage);
                }
            } finally {
                if (!isCancelled) {
                    setIsLoadingMonetBackgroundImage(false);
                }
            }
        };

        void loadMonetBackgroundImage();
        return () => {
            isCancelled = true;
        };
    }, [setIsLoadingMonetBackgroundImage, setStoredMonetBackgroundImage]);

    useEffect(() => {
        let isCancelled = false;

        const loadMonetPortraitImage = async () => {
            try {
                const storedImage = await getMonetPortraitImage();
                if (!isCancelled) {
                    setStoredMonetPortraitImage(storedImage);
                }
            } finally {
                if (!isCancelled) {
                    setIsLoadingMonetPortraitImage(false);
                }
            }
        };

        void loadMonetPortraitImage();
        return () => {
            isCancelled = true;
        };
    }, [setIsLoadingMonetPortraitImage, setStoredMonetPortraitImage]);

    useEffect(() => {
        if (lyricsCustomFont?.source !== 'uploaded' || !lyricsCustomFont.fontId) {
            return;
        }

        let isCancelled = false;

        const restoreUploadedFont = async () => {
            try {
                const restoredFont = await restoreUploadedLyricsFont(lyricsCustomFont.fontId!);
                if (isCancelled) {
                    return;
                }

                if (!restoredFont) {
                    clearLyricsCustomFontAfterRestoreFailure({
                        type: 'info',
                        text: i18n.t('notifications.uploadedFontUnavailable'),
                    });
                }
            } catch (error) {
                console.warn('[Preferences] Failed to restore uploaded lyrics font:', error);
                if (isCancelled) {
                    return;
                }

                clearLyricsCustomFontAfterRestoreFailure({
                    type: 'error',
                    text: i18n.t('notifications.uploadedFontLoadFailed'),
                });
            }
        };

        void restoreUploadedFont();
        return () => {
            isCancelled = true;
        };
    }, [clearLyricsCustomFontAfterRestoreFailure, lyricsCustomFont?.fontId, lyricsCustomFont?.source]);

    useEffect(() => {
        const nextImages = storedCappellaEmojiPack.flatMap(image => {
            const url = createSafeObjectUrl(image.blob);
            return url ? [{ id: image.id, name: image.name, url }] : [];
        });
        setCappellaCustomEmojiImages(nextImages);

        return () => {
            nextImages.forEach(image => URL.revokeObjectURL(image.url));
        };
    }, [setCappellaCustomEmojiImages, storedCappellaEmojiPack]);

    useEffect(() => {
        const nextImages = storedCappellaAvatarPack.flatMap(image => {
            const url = createSafeObjectUrl(image.blob);
            return url ? [{ id: image.id, name: image.name, url }] : [];
        });
        setCappellaCustomAvatarImages(nextImages);

        return () => {
            nextImages.forEach(image => URL.revokeObjectURL(image.url));
        };
    }, [setCappellaCustomAvatarImages, storedCappellaAvatarPack]);

    useEffect(() => {
        if (!storedMonetBackgroundImage?.blob) {
            setMonetBackgroundImage(null);
            return;
        }

        const url = createSafeObjectUrl(storedMonetBackgroundImage.blob);
        if (!url) {
            setMonetBackgroundImage(null);
            return;
        }
        const nextImage = {
            id: storedMonetBackgroundImage.id,
            name: storedMonetBackgroundImage.name,
            url,
        };
        setMonetBackgroundImage(nextImage);

        return () => {
            URL.revokeObjectURL(nextImage.url);
        };
    }, [setMonetBackgroundImage, storedMonetBackgroundImage]);

    useEffect(() => {
        if (!storedMonetPortraitImage?.blob) {
            setMonetPortraitImage(null);
            return;
        }

        const url = createSafeObjectUrl(storedMonetPortraitImage.blob);
        if (!url) {
            setMonetPortraitImage(null);
            return;
        }
        const nextImage = {
            id: storedMonetPortraitImage.id,
            name: storedMonetPortraitImage.name,
            url,
        };
        setMonetPortraitImage(nextImage);

        return () => {
            URL.revokeObjectURL(nextImage.url);
        };
    }, [setMonetPortraitImage, storedMonetPortraitImage]);

    useEffect(() => {
        if (
            isLoadingMonetBackgroundImage
            || storedMonetBackgroundImage
            || monetBackgroundTuning.backgroundSource !== 'uploaded-global'
        ) {
            return;
        }

        handleSetMonetBackgroundTuning(resolveStoredMonetBackgroundTuning({
            ...monetBackgroundTuning,
            backgroundSource: 'cover-derived',
        }));
    }, [handleSetMonetBackgroundTuning, isLoadingMonetBackgroundImage, monetBackgroundTuning, storedMonetBackgroundImage]);

    useEffect(() => {
        if (
            isLoadingMonetPortraitImage
            || storedMonetPortraitImage
            || monetTuning.portraitSource !== 'custom'
        ) {
            return;
        }

        handleSetMonetTuning(resolveStoredMonetTuning({
            ...monetTuning,
            portraitSource: 'cover',
        }));
    }, [handleSetMonetTuning, isLoadingMonetPortraitImage, monetTuning, storedMonetPortraitImage]);

}
