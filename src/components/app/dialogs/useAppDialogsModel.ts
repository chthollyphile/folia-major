import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStatusToasts } from '../../../stores/useStatusMessageStore';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { useDesktopSettingsStore } from '../../../stores/useDesktopSettingsStore';
import { buildAppDialogsModel, type AppDialogsDeps } from './buildAppDialogsModel';

// src/components/app/dialogs/useAppDialogsModel.ts

/**
 * The dialog model with the three ambient values already filled in.
 *
 * `statusToasts`, `isDaylight` and `currentSong` all live in stores; App.tsx used to read them only
 * so it could hand them straight back here.
 */
export const useAppDialogsModel = (deps: AppDialogsDeps) => {
    const statusToasts = useStatusToasts();
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const wallpaperEntryConfirmDialog = useWallpaperEntryConfirmDialog(isDaylight);

    return useMemo(() => buildAppDialogsModel({
        ...deps,
        statusToasts,
        isDaylight,
        currentSong,
        wallpaperEntryConfirmDialog,
        // Spread rather than `deps`: the caller passes an object literal, so depending on the object
        // would rebuild this every render. The key set is fixed by the call site.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [...Object.values(deps), statusToasts, isDaylight, currentSong, wallpaperEntryConfirmDialog]);
};

/**
 * Props for the "enter wallpaper mode?" ConfirmDialog. The open flag lives in
 * useDesktopSettingsStore so every user-facing entry (settings card, command palette, tray
 * request) shares this one dialog; confirming is what actually enters wallpaper mode.
 */
export const useWallpaperEntryConfirmDialog = (isDaylight: boolean) => {
    const { t } = useTranslation();
    const isOpen = useDesktopSettingsStore(state => state.wallpaperEntryConfirmOpen);

    return useMemo(() => ({
        isOpen,
        isDaylight,
        title: t('options.wallpaperEnterConfirmTitle'),
        description: t('options.wallpaperEnterConfirmDesc'),
        confirmText: t('options.wallpaperEnterConfirmAction'),
        onConfirm: () => useDesktopSettingsStore.getState().confirmWallpaperEntry(),
        onClose: () => useDesktopSettingsStore.getState().cancelWallpaperEntry(),
    }), [isOpen, isDaylight, t]);
};
