import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { StatusMessage } from '../types';
import { getCustomCappellaEmojiPack } from '../services/cappellaEmojiPack';
import { getCustomCappellaAvatar } from '../services/cappellaAvatarPack';
import { restoreUploadedLyricsFont } from '../services/customLyricsFont';
import {
    resolveStoredCappellaTuning,
    resolveStoredCustomLyricsFont,
    selectSettingsUiSnapshot,
    useSettingsUiStore,
} from '../stores/useSettingsUiStore';

export { resolveStoredCappellaTuning, resolveStoredCustomLyricsFont };

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
    const clearLyricsCustomFontAfterRestoreFailure = useSettingsUiStore(state => state.clearLyricsCustomFontAfterRestoreFailure);
    const ensureBuiltinCappellaEmojiPack = useSettingsUiStore(state => state.ensureBuiltinCappellaEmojiPack);
    const lyricsCustomFont = useSettingsUiStore(state => state.lyricsCustomFont);
    const storedCappellaEmojiPack = useSettingsUiStore(state => state.storedCappellaEmojiPack);
    const storedCappellaAvatarPack = useSettingsUiStore(state => state.storedCappellaAvatarPack);
    const cappellaEmojiPackSource = useSettingsUiStore(state => state.cappellaTuning.emojiPackSource);
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
                        text: '上传字体不可用，已恢复内置字体',
                    });
                }
            } catch (error) {
                console.warn('[Preferences] Failed to restore uploaded lyrics font:', error);
                if (isCancelled) {
                    return;
                }

                clearLyricsCustomFontAfterRestoreFailure({
                    type: 'error',
                    text: '加载上传字体失败，已恢复内置字体',
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
        ensureBuiltinCappellaEmojiPack();
    }, [cappellaEmojiPackSource, ensureBuiltinCappellaEmojiPack, storedCappellaEmojiPack.length]);

    return preferences;
}
