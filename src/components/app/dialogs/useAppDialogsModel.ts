import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStatusMessage } from '../../../stores/useStatusMessageStore';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { useDesktopSettingsStore } from '../../../stores/useDesktopSettingsStore';
import { buildAppDialogsModel, type AppDialogsDeps } from './buildAppDialogsModel';

// src/components/app/dialogs/useAppDialogsModel.ts

/**
 * The dialog model with the three ambient values already filled in.
 *
 * `statusMsg`, `isDaylight` and `currentSong` all live in stores; App.tsx used to read them only so
 * it could hand them straight back here.
 */
export const useAppDialogsModel = (deps: AppDialogsDeps) => {
    const statusMsg = useStatusMessage();
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const wallpaperEntryConfirmDialog = useWallpaperEntryConfirmDialog(isDaylight);
    const externalPlayerRestartDialog = useExternalPlayerRestartDialog(deps, isDaylight);

    return useMemo(() => buildAppDialogsModel({
        ...deps,
        statusMsg,
        isDaylight,
        currentSong,
        wallpaperEntryConfirmDialog,
        externalPlayerRestartDialog,
        // Spread rather than `deps`: the caller passes an object literal, so depending on the object
        // would rebuild this every render. The key set is fixed by the call site.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [...Object.values(deps), statusMsg, isDaylight, currentSong, wallpaperEntryConfirmDialog, externalPlayerRestartDialog]);
};

/**
 * Props for the "close and reopen your player?" ConfirmDialog: asked once, the first time a play in
 * the listener's own player needs it closed to be steered (the answer is kept by the main process).
 * Confirming closes and reopens it and plays the song again; a cancel leaves the player alone.
 */
export const useExternalPlayerRestartDialog = (
    deps: Pick<AppDialogsDeps, 'pendingExternalPlayerRestart' | 'handleExternalPlayerRestartConfirm' | 'handleExternalPlayerRestartCancel'>,
    isDaylight: boolean,
) => {
    const { t } = useTranslation();
    const isOpen = Boolean(deps.pendingExternalPlayerRestart);

    return useMemo(() => ({
        isOpen,
        isDaylight,
        title: t('status.externalPlayerRestartTitle'),
        description: t('status.externalPlayerRestartDescription'),
        confirmText: t('status.externalPlayerRestartConfirm'),
        cancelText: t('status.externalPlayerRestartCancel'),
        onConfirm: () => void deps.handleExternalPlayerRestartConfirm(),
        onClose: deps.handleExternalPlayerRestartCancel,
    }), [isOpen, isDaylight, t, deps]);
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
