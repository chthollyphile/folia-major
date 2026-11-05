import React, { useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import LyricMatchDialog from '../../modal/lyric-match/LyricMatchDialog';
import UnavailableReplacementDialog from '../../modal/UnavailableReplacementDialog';
import SettingsModal from '../../modal/SettingsModal';
import ConfirmDialog from '../../shared/ConfirmDialog';
import type { AppDialogsModel } from './buildAppDialogsModel';
import { StatusToast } from './StatusToast';
import LoadingDots from '../../shared/LoadingDots';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { useTranslation } from 'react-i18next';
import { countRender } from '../../../dev/renderCount';

// Centralized app-level dialog and toast renderer for the player shell.
type AppDialogsProps = {
    model: AppDialogsModel;
};

const AppDialogs: React.FC<AppDialogsProps> = ({ model }) => {
    countRender('AppDialogs');
    const { t } = useTranslation();
    const preparingPlayback = usePlaybackStore(state => state.isLoadingToPlay);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const { statusToast, lyricMatchDialog, unavailableReplacementDialog, settingsDialog, wallpaperEntryConfirmDialog } = model;
    // The settings window is the largest tree the app mounts at a click. Read deferred, it is
    // rendered in slices between frames rather than in the click's own task, which held every frame
    // (the panel closing, the picture) until all of it was built. Closing is not deferred: the
    // window leaves with the click.
    const isSettingsShown = useDeferredValue(settingsDialog != null);

    return (
        <>
            {createPortal(
                <div className="pointer-events-none fixed inset-x-0 top-[30px] z-[210] grid justify-items-center px-4">
                    <AnimatePresence>
                        {preparingPlayback && <div key="playback-loading" className="status-toast is-loading" style={{ gridArea: '2 / 1' }} role="status" aria-live="polite">
                                <LoadingDots isDaylight={isDaylight} />
                                <span className="sr-only">{t('status.loadingSong')}</span>
                            </div>}
                        {statusToast && !(preparingPlayback && statusToast.activity === 'playback-loading') &&
                            <StatusToast key={statusToast.toastKey} toast={statusToast} />}
                    </AnimatePresence>
                </div>,
                document.body,
            )}

            {lyricMatchDialog && <LyricMatchDialog {...lyricMatchDialog} />}
            {unavailableReplacementDialog && <UnavailableReplacementDialog {...unavailableReplacementDialog} />}
            {wallpaperEntryConfirmDialog && <ConfirmDialog {...wallpaperEntryConfirmDialog} />}
            <AnimatePresence>
                {isSettingsShown && settingsDialog && <SettingsModal {...settingsDialog} />}
            </AnimatePresence>
        </>
    );
};

export default React.memo(AppDialogs);
