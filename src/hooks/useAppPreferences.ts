import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { StatusMessage } from '../types';
import { getCustomCappellaEmojiPack } from '../services/cappellaEmojiPack';
import { getCustomCappellaAvatar } from '../services/cappellaAvatarPack';
import { getMonetBackgroundImage } from '../services/monetBackgroundImage';
import { getMonetPortraitImage } from '../services/monetPortraitImage';
import { restoreUploadedLyricsFont } from '../services/customLyricsFont';
import {
    resolveStoredMonetBackgroundTuning,
    resolveStoredMonetTuning,
    resolveStoredCappellaTuning,
    resolveStoredCustomLyricsFont,
    resolveVisualizerBackgroundMode,
    selectSettingsUiSnapshot,
    useSettingsUiStore,
} from '../stores/useSettingsUiStore';
import i18n from '../i18n/config';

export { resolveStoredCappellaTuning, resolveStoredCustomLyricsFont, resolveStoredMonetBackgroundTuning, resolveVisualizerBackgroundMode };

type StatusSetter = Dispatch<SetStateAction<StatusMessage | null>>;

export function useAppPreferences(setStatusMsg: StatusSetter) {
    const preferences = useSettingsUiStore(useShallow(selectSettingsUiSnapshot));
    const setStatusSetter = useSettingsUiStore(state => state.setStatusSetter);
    const setTransparentPlayerBackgroundFromSystem = useSettingsUiStore(state => state.setTransparentPlayerBackgroundFromSystem);
    const setDesktopPreferenceSnapshot = useSettingsUiStore(state => state.setDesktopPreferenceSnapshot);
    const setStoredCappellaEmojiPack = useSettingsUiStore(state => state.setStoredCappellaEmojiPack);
    const setCappellaCustomEmojiImages = useSettingsUiStore(state => state.setCappellaCustomEmojiImages);
    const setIsLoadingCappellaCustomEmojiPack = useSettingsUiStore(state => state.setIsLoadingCappellaCustomEmojiPack);
    const setStoredCappellaAvatarPack = useSettingsUiStore(state => state.setStoredCappellaAvatarPack);
    const setCappellaCustomAvatarImages = useSettingsUiStore(state => state.setCappellaCustomAvatarImages);
    const setIsLoadingCappellaCustomAvatarPack = useSettingsUiStore(state => state.setIsLoadingCappellaCustomAvatarPack);
    const setStoredMonetBackgroundImage = useSettingsUiStore(state => state.setStoredMonetBackgroundImage);
    const setMonetBackgroundImage = useSettingsUiStore(state => state.setMonetBackgroundImage);
    const setIsLoadingMonetBackgroundImage = useSettingsUiStore(state => state.setIsLoadingMonetBackgroundImage);
    const setStoredMonetPortraitImage = useSettingsUiStore(state => state.setStoredMonetPortraitImage);
    const setMonetPortraitImage = useSettingsUiStore(state => state.setMonetPortraitImage);
    const setIsLoadingMonetPortraitImage = useSettingsUiStore(state => state.setIsLoadingMonetPortraitImage);
    const handleSetMonetTuning = useSettingsUiStore(state => state.handleSetMonetTuning);
    const handleSetMonetBackgroundTuning = useSettingsUiStore(state => state.handleSetMonetBackgroundTuning);
    const clearLyricsCustomFontAfterRestoreFailure = useSettingsUiStore(state => state.clearLyricsCustomFontAfterRestoreFailure);
    const lyricsCustomFont = useSettingsUiStore(state => state.lyricsCustomFont);
    const storedCappellaEmojiPack = useSettingsUiStore(state => state.storedCappellaEmojiPack);
    const storedCappellaAvatarPack = useSettingsUiStore(state => state.storedCappellaAvatarPack);
    const storedMonetBackgroundImage = useSettingsUiStore(state => state.storedMonetBackgroundImage);
    const isLoadingMonetBackgroundImage = useSettingsUiStore(state => state.isLoadingMonetBackgroundImage);
    const storedMonetPortraitImage = useSettingsUiStore(state => state.storedMonetPortraitImage);
    const isLoadingMonetPortraitImage = useSettingsUiStore(state => state.isLoadingMonetPortraitImage);
    const monetBackgroundTuning = useSettingsUiStore(state => state.monetBackgroundTuning);
    const monetTuning = useSettingsUiStore(state => state.monetTuning);
    const isDaylight = useSettingsUiStore(state => state.isDaylight);

    useEffect(() => {
        setStatusSetter(setStatusMsg);
        return () => {
            setStatusSetter(null);
        };
    }, [setStatusMsg, setStatusSetter]);

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
        const nextImages = storedCappellaEmojiPack.map(image => ({
            id: image.id,
            name: image.name,
            url: URL.createObjectURL(image.blob),
        }));
        setCappellaCustomEmojiImages(nextImages);

        return () => {
            nextImages.forEach(image => URL.revokeObjectURL(image.url));
        };
    }, [setCappellaCustomEmojiImages, storedCappellaEmojiPack]);

    useEffect(() => {
        const nextImages = storedCappellaAvatarPack.map(image => ({
            id: image.id,
            name: image.name,
            url: URL.createObjectURL(image.blob),
        }));
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

        const nextImage = {
            id: storedMonetBackgroundImage.id,
            name: storedMonetBackgroundImage.name,
            url: URL.createObjectURL(storedMonetBackgroundImage.blob),
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

        const nextImage = {
            id: storedMonetPortraitImage.id,
            name: storedMonetPortraitImage.name,
            url: URL.createObjectURL(storedMonetPortraitImage.blob),
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

    return preferences;
}
