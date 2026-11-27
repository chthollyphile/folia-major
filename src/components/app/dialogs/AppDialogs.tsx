import React, { useDeferredValue } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import LyricMatchDialog from '../../modal/lyric-match/LyricMatchDialog';
import UnavailableReplacementDialog from '../../modal/UnavailableReplacementDialog';
import SettingsModal from '../../modal/SettingsModal';
import ConfirmDialog from '../../shared/ConfirmDialog';
import PerfCheckOffer from '../../perfCheck/PerfCheckOffer';
import type { AppDialogsModel } from './buildAppDialogsModel';
import { StatusToast } from './StatusToast';
import { countRender } from '../../../dev/renderCount';

// Centralized app-level dialog and toast renderer for the player shell.
type AppDialogsProps = {
    model: AppDialogsModel;
};

const AppDialogs: React.FC<AppDialogsProps> = ({ model }) => {
    countRender('AppDialogs');
    const { statusToasts, lyricMatchDialog, unavailableReplacementDialog, settingsDialog, wallpaperEntryConfirmDialog } = model;
    // The settings window is the largest tree the app mounts at a click. Read deferred, it is
    // rendered in slices between frames rather than in the click's own task, which held every frame
    // (the panel closing, the picture) until all of it was built. Closing is not deferred: the
    // window leaves with the click.
    const isSettingsShown = useDeferredValue(settingsDialog != null);

    // The store keeps at most five, oldest first. Newest first here puts the newest toast at the top
    // under the search bar; the oldest is the last one and drops off when a sixth arrives.
    const shown = [...statusToasts].reverse();

    return (
        <>
            {createPortal(
                <div className="status-toast-stack pointer-events-none fixed right-4 top-[80px] z-[210] flex flex-col items-end gap-2">
                    <AnimatePresence>
                        {shown.map(toast => (
                            <StatusToast key={toast.toastKey} toast={toast} />
                        ))}
                    </AnimatePresence>
                </div>,
                document.body,
            )}

            {lyricMatchDialog && <LyricMatchDialog {...lyricMatchDialog} />}
            {unavailableReplacementDialog && <UnavailableReplacementDialog {...unavailableReplacementDialog} />}
            {wallpaperEntryConfirmDialog && <ConfirmDialog {...wallpaperEntryConfirmDialog} />}
            {/* The performance check's offer on the first automix / 智能动感 switch-on, and its chosen settings. */}
            <PerfCheckOffer />
            <AnimatePresence>
                {isSettingsShown && settingsDialog && <SettingsModal {...settingsDialog} />}
            </AnimatePresence>
        </>
    );
};

export default React.memo(AppDialogs);
